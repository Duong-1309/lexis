import { app, BrowserWindow, ipcMain, dialog, protocol, Notification, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import windowStateKeeper from 'electron-window-state'
import { randomUUID } from 'crypto'
import log from 'electron-log'
import { autoUpdater, UpdateInfo } from 'electron-updater'
import { db } from './services/db'
import { dictService } from './services/dictionary'
import { audioService } from './services/audio'
import { aiService } from './services/ai'
import { parseSRT } from './services/parsers/srt'
import { parseASS } from './services/parsers/ass'
import { parseEPUBChapters, loadEPUBChapter } from './services/parsers/epub'
import { parsePlainText } from './services/parsers/text'
import { fetchWebArticle } from './services/parsers/web'
import { calculateNextReview } from './services/srs'
import { getSettings, setSettings } from './services/settings'
import { getDailyMissions, claimMissionReward } from './services/missions'
import { dictDownloadService } from './services/dictionary-download'
import type { DictionaryId } from '../src/types/index'
import type {
  IPCResult,
  MediaSource,
  Language,
  NativeLanguage,
  DraftCard,
  CardUpdate,
  ReviewRating,
  PatternDraft,
  PatternUpdate,
  PatternFilters,
  DrillPromptDraft,
  DrillAttemptDraft,
  DrillEvaluationInput,
} from '../src/types/index'

let mainWindow: BrowserWindow | null = null
let reminderTimer: NodeJS.Timeout | null = null
let updateCheckTimer: NodeJS.Timeout | null = null

// ─── Auto-updater setup ─────────────────────────────────────────────────────────

function setupAutoUpdater(): void {
  autoUpdater.logger = log
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    log.info('Checking for update...')
    mainWindow?.webContents.send('updater:checking')
  })

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    log.info('Update available:', info.version)
    mainWindow?.webContents.send('updater:available', {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: info.releaseNotes,
    })
  })

  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    log.info('Update not available, current version is latest:', info.version)
    mainWindow?.webContents.send('updater:not-available', {
      version: info.version,
    })
  })

  autoUpdater.on('download-progress', (progress) => {
    log.info(`Download progress: ${progress.percent.toFixed(1)}%`)
    mainWindow?.webContents.send('updater:progress', {
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total,
    })
  })

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    log.info('Update downloaded:', info.version)
    mainWindow?.webContents.send('updater:downloaded', {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: info.releaseNotes,
    })
  })

  autoUpdater.on('error', (error) => {
    log.error('Auto-updater error:', error)
    mainWindow?.webContents.send('updater:error', error.message)
  })
}

function startUpdateChecker(): void {
  const settings = getSettings()
  if (!settings.checkForUpdates) return

  // Check on startup (after 10s delay)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => log.error('Update check failed:', err))
  }, 10_000)

  // Check every 4 hours
  if (updateCheckTimer) clearInterval(updateCheckTimer)
  updateCheckTimer = setInterval(
    () => {
      const s = getSettings()
      if (s.checkForUpdates) {
        autoUpdater.checkForUpdates().catch((err) => log.error('Update check failed:', err))
      }
    },
    4 * 60 * 60 * 1000,
  )
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

function minutesSinceMidnight(value: string): number {
  const [hours, minutes] = value.split(':').map((part) => Number(part))
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0
  return hours * 60 + minutes
}

function isWithinQuietHours(nowMinutes: number, start: string, end: string): boolean {
  const startMinutes = minutesSinceMidnight(start)
  const endMinutes = minutesSinceMidnight(end)
  if (startMinutes === endMinutes) return false
  if (startMinutes < endMinutes) return nowMinutes >= startMinutes && nowMinutes < endMinutes
  return nowMinutes >= startMinutes || nowMinutes < endMinutes
}

function maybeSendLearningReminder(): void {
  const settings = getSettings()
  if (!settings.reminders.enabled) return
  if (!Notification.isSupported()) return

  const now = new Date()
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  if (isWithinQuietHours(nowMinutes, settings.reminders.quietHoursStart, settings.reminders.quietHoursEnd)) return

  const dueSummary = db.getDueReminderSummary()
  if (dueSummary.dueCount > 0) {
    const dueKey = `${todayKey()}:${dueSummary.oldestDueDate ?? 'due'}:${dueSummary.dueCount}`
    if (settings.reminders.lastDueNotifiedKey === dueKey) return

    new Notification({
      title: 'Lexis review is ready',
      body: `${dueSummary.dueCount} card${dueSummary.dueCount === 1 ? '' : 's'} due now.`,
    }).show()
    setSettings({
      reminders: {
        ...settings.reminders,
        lastDueNotifiedKey: dueKey,
      },
    })
    return
  }

  if (settings.reminders.lastNotifiedDate === todayKey()) return
  if (nowMinutes < minutesSinceMidnight(settings.scheduling.dailyDueTime)) return

  const stats = db.getMiningStats()
  if (stats.validLearningDay) return

  new Notification({
    title: 'Protect your Lexis streak',
    body: 'Complete one review, drill, or mined sentence to protect today.',
  }).show()
  setSettings({
    reminders: {
      ...settings.reminders,
      lastNotifiedDate: todayKey(),
    },
  })
}

function startReminderScheduler(): void {
  if (reminderTimer) clearInterval(reminderTimer)
  maybeSendLearningReminder()
  reminderTimer = setInterval(maybeSendLearningReminder, 60_000)
}

function createWindow(): void {
  // Restore window state (size + position)
  const windowState = windowStateKeeper({
    defaultWidth: 1280,
    defaultHeight: 800,
  })

  mainWindow = new BrowserWindow({
    x: windowState.x,
    y: windowState.y,
    width: windowState.width,
    height: windowState.height,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1a1a2e',
  })

  // Track window state changes
  windowState.manage(mainWindow)

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
    if (process.env.LEXIS_OPEN_DEVTOOLS === '1') {
      mainWindow.webContents.openDevTools()
    }
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function wrapResult<T>(fn: () => T | Promise<T>): Promise<IPCResult<T>> {
  return Promise.resolve()
    .then(() => fn())
    .then((data) => ({ data, error: null }))
    .catch((err: Error) => ({ data: null, error: err.message }))
}

function importSubtitleFromPath(filePath: string, language: Language = 'ja'): MediaSource {
  const ext = path.extname(filePath).toLowerCase()
  if (!['.srt', '.ass', '.ssa'].includes(ext)) {
    throw new Error(`Unsupported format: ${ext}. Use .srt, .ass, or .ssa`)
  }
  const title = path.basename(filePath, ext)
  const content = fs.readFileSync(filePath, 'utf-8')
  const entries = ext === '.srt' ? parseSRT(content) : parseASS(content)

  const source = db.insertMediaSource({
    type: 'subtitle',
    title,
    filePath,
    language,
    sentenceCount: entries.length,
  })

  db.insertSentences(
    entries.map((e, i) => ({
      sourceId: source.id,
      content: e.text,
      position: i,
      startTimeMs: e.startTimeMs,
      endTimeMs: e.endTimeMs,
    })),
  )

  return source as MediaSource
}

function importTextSource(input: {
  title: string
  text: string
  language: Language
  sourceUrl?: string
  type?: 'text' | 'web'
}): MediaSource {
  const title = input.title.trim()
  const text = input.text.trim()
  if (!title) throw new Error('Title is required')
  if (!text) throw new Error('Text is required')

  const parsed = parsePlainText(text, input.language)
  if (parsed.sentences.length === 0) {
    throw new Error('No readable sentences found')
  }

  const source = db.insertMediaSource({
    type: input.type ?? 'text',
    title,
    sourceUrl: input.sourceUrl,
    language: input.language,
    wordCount: parsed.wordCount,
    sentenceCount: parsed.sentences.length,
  })

  db.insertSentences(
    parsed.sentences.map((content, position) => ({
      sourceId: source.id,
      content,
      position,
    })),
  )

  return source as MediaSource
}

function setupIPCHandlers(): void {
  // ─── media ──────────────────────────────────────────────────────────────────
  ipcMain.handle('media:import-file', async (_event, type: 'subtitle' | 'epub', language: Language = 'ja') => {
    return wrapResult(async () => {
      const filters =
        type === 'subtitle'
          ? [{ name: 'Subtitles', extensions: ['srt', 'ass', 'ssa'] }]
          : [{ name: 'EPUB', extensions: ['epub'] }]

      const result = await dialog.showOpenDialog(mainWindow!, {
        filters,
        properties: ['openFile'],
      })

      if (result.canceled || result.filePaths.length === 0) {
        throw new Error('cancelled')
      }

      if (type === 'epub') {
        const filePath = result.filePaths[0]
        const title = path.basename(filePath, '.epub')
        const chapters = await parseEPUBChapters(filePath)
        return db.insertMediaSource({
          type: 'epub',
          title,
          filePath,
          language,
          sentenceCount: chapters.length,
        }) as MediaSource
      }
      return importSubtitleFromPath(result.filePaths[0], language)
    })
  })

  ipcMain.handle('media:import-from-path', (_event, filePath: string, language: Language = 'ja') =>
    wrapResult(async () => {
      const ext = path.extname(filePath).toLowerCase()
      if (ext === '.epub') {
        const title = path.basename(filePath, '.epub')
        const chapters = await parseEPUBChapters(filePath)
        return db.insertMediaSource({
          type: 'epub',
          title,
          filePath,
          language,
          sentenceCount: chapters.length,
        }) as MediaSource
      }
      return importSubtitleFromPath(filePath, language)
    }),
  )

  ipcMain.handle('media:import-text', (_event, input: { title: string; text: string; language: Language }) =>
    wrapResult(() => importTextSource(input)),
  )

  ipcMain.handle('media:import-url', async (_event, url: string, language: Language) => {
    return wrapResult(async () => {
      const article = await fetchWebArticle(url)
      return importTextSource({
        title: article.title,
        text: article.text,
        language,
        sourceUrl: url,
        type: 'web',
      })
    })
  })

  ipcMain.handle('media:list', () => wrapResult(() => db.getMediaSources()))

  ipcMain.handle('media:delete', (_event, sourceId: number) =>
    wrapResult(() => db.deleteMediaSource(sourceId)),
  )

  ipcMain.handle('media:mark-opened', (_event, sourceId: number) =>
    wrapResult(() => db.markOpened(sourceId)),
  )

  // ─── reader ─────────────────────────────────────────────────────────────────
  ipcMain.handle('reader:load-subtitle', (_event, sourceId: number) =>
    wrapResult(() => db.getSentencesBySourceId(sourceId)),
  )

  ipcMain.handle('reader:load-epub-chapters', (_event, sourceId: number) =>
    wrapResult(async () => {
      const source = db.getMediaSourceById(sourceId)
      if (!source?.filePath) throw new Error('EPUB source not found')
      return parseEPUBChapters(source.filePath)
    }),
  )

  ipcMain.handle(
    'reader:load-epub-chapter',
    (_event, sourceId: number, chapterId: string) =>
      wrapResult(async () => {
        const source = db.getMediaSourceById(sourceId)
        if (!source?.filePath) throw new Error('EPUB source not found')
        return loadEPUBChapter(source.filePath, chapterId)
      }),
  )

  ipcMain.handle(
    'reader:save-progress',
    (_event, sourceId: number, position: number, chapterId?: string) =>
      wrapResult(() => db.saveProgress(sourceId, position, chapterId)),
  )

  ipcMain.handle('reader:get-progress', (_event, sourceId: number) =>
    wrapResult(() => db.getProgress(sourceId)),
  )

  ipcMain.handle('reader:mined-words', (_event, sourceId: number) =>
    wrapResult(() => db.getMinedWordsForSource(sourceId)),
  )

  // ─── dictionary ─────────────────────────────────────────────────────────────
  ipcMain.handle('dictionary:lookup', (_event, word: string, lang: Language) =>
    wrapResult(() => dictService.lookup(word, lang)),
  )

  ipcMain.handle('dictionary:tokenize', (_event, text: string, lang: Language) =>
    wrapResult(() => dictService.tokenize(text, lang)),
  )

  ipcMain.handle('dictionary:autocomplete', (_event, prefix: string, lang: Language) =>
    wrapResult(() => dictService.autocomplete(prefix, lang)),
  )

  ipcMain.handle('dictionary:list-dicts', () =>
    wrapResult(() => dictDownloadService.listDictionaries()),
  )

  ipcMain.handle('dictionary:download', async (_event, id: DictionaryId) =>
    wrapResult(async () => {
      await dictDownloadService.downloadDictionary(id, mainWindow)
      // After download, open the dictionary
      const dictIdToLang: Record<DictionaryId, Language> = {
        jmdict: 'ja',
        cedict: 'zh',
        wordnet: 'en',
      }
      const lang = dictIdToLang[id]
      const dictPath = dictDownloadService.getDictionaryPath(id)
      if (dictPath && lang) {
        dictService.openDictionary(lang, dictPath)
      }
    }),
  )

  ipcMain.handle('dictionary:delete', (_event, id: DictionaryId) =>
    wrapResult(() => {
      const dictIdToLang: Record<DictionaryId, Language> = {
        jmdict: 'ja',
        cedict: 'zh',
        wordnet: 'en',
      }
      const lang = dictIdToLang[id]
      if (lang) {
        dictService.closeDictionary(lang)
      }
      dictDownloadService.deleteDictionary(id)
    }),
  )

  ipcMain.handle('dictionary:is-available', (_event, lang: Language) =>
    wrapResult(() => dictDownloadService.isDictionaryAvailableForLanguage(lang)),
  )

  // ─── audio ───────────────────────────────────────────────────────────────────
  ipcMain.handle('audio:get-path', (_event, word: string, lang: Language, reading?: string) =>
    wrapResult(() => audioService.getAudio(word, lang, reading)),
  )

  // ─── decks ───────────────────────────────────────────────────────────────────
  ipcMain.handle('decks:list', () => wrapResult(() => db.getDecks()))
  ipcMain.handle('decks:create', (_event, name: string, description?: string) =>
    wrapResult(() => db.createDeck(name, description)),
  )
  ipcMain.handle('decks:rename', (_event, id: number, name: string) =>
    wrapResult(() => db.renameDeck(id, name)),
  )
  ipcMain.handle('decks:delete', (_event, id: number) =>
    wrapResult(() => db.deleteDeck(id)),
  )

  // ─── cards ───────────────────────────────────────────────────────────────────
  ipcMain.handle('cards:due', (_event, deckId: number) =>
    wrapResult(() => db.getDueCards(deckId)),
  )
  ipcMain.handle('cards:all', (_event, deckId: number) =>
    wrapResult(() => db.getAllCards(deckId)),
  )
  ipcMain.handle('cards:create', (_event, draft: DraftCard) =>
    wrapResult(() => db.insertCard(draft)),
  )
  ipcMain.handle('cards:review', (_event, cardId: number, rating: ReviewRating, timeTakenMs?: number) =>
    wrapResult(() => {
      const card = db.getCard(cardId)
      if (!card) throw new Error(`Card ${cardId} not found`)
      const result = calculateNextReview(card, rating)
      db.updateCardSRS(cardId, result)
      db.logReview({
        cardId,
        rating,
        intervalBefore: card.interval,
        intervalAfter: result.interval,
        easeBefore: card.easeFactor,
        timeTakenMs,
      })
      return result
    }),
  )
  ipcMain.handle('cards:suspend', (_event, id: number) =>
    wrapResult(() => db.suspendCard(id)),
  )
  ipcMain.handle('cards:unsuspend', (_event, ids: number[]) =>
    wrapResult(() => db.unsuspendCards(ids)),
  )
  ipcMain.handle('cards:move', (_event, ids: number[], deckId: number) =>
    wrapResult(() => db.moveCards(ids, deckId)),
  )
  ipcMain.handle('cards:delete', (_event, id: number) =>
    wrapResult(() => db.deleteCard(id)),
  )
  ipcMain.handle('cards:is-duplicate', (_event, word: string, language: Language) =>
    wrapResult(() => db.isDuplicate(word, language)),
  )
  ipcMain.handle('cards:update', (_event, id: number, updates: CardUpdate) =>
    wrapResult(() => db.updateCardContent(id, updates)),
  )

  // ─── patterns ───────────────────────────────────────────────────────────────
  ipcMain.handle('patterns:create', (_event, draft: PatternDraft) =>
    wrapResult(() => db.createPattern(draft)),
  )
  ipcMain.handle('patterns:update', (_event, id: number, updates: PatternUpdate) =>
    wrapResult(() => db.updatePattern(id, updates)),
  )
  ipcMain.handle('patterns:list', (_event, filters?: PatternFilters) =>
    wrapResult(() => db.listPatterns(filters ?? {})),
  )
  ipcMain.handle('patterns:get', (_event, id: number) =>
    wrapResult(() => db.getPattern(id)),
  )
  ipcMain.handle('patterns:delete', (_event, id: number) =>
    wrapResult(() => db.deletePattern(id)),
  )
  ipcMain.handle('patterns:is-duplicate', (_event, patternText: string, language: Language, excludeId?: number) =>
    wrapResult(() => db.isDuplicatePattern(patternText, language, excludeId)),
  )

  // ─── drills ─────────────────────────────────────────────────────────────────
  ipcMain.handle('drills:create-prompt', (_event, draft: DrillPromptDraft) =>
    wrapResult(() => db.createDrillPrompt(draft)),
  )
  ipcMain.handle('drills:list-prompts', (_event, patternId: number) =>
    wrapResult(() => db.listDrillPrompts(patternId)),
  )
  ipcMain.handle('drills:save-attempt', (_event, draft: DrillAttemptDraft) =>
    wrapResult(() => db.saveDrillAttempt(draft)),
  )
  ipcMain.handle('drills:list-attempts', (_event, patternId: number) =>
    wrapResult(() => db.listDrillAttempts(patternId)),
  )
  ipcMain.handle('drills:create-review-card', (_event, attemptId: number, deckId: number) =>
    wrapResult(() => db.createReviewCardFromAttempt(attemptId, deckId)),
  )

  // ─── ai ─────────────────────────────────────────────────────────────────────
  ipcMain.handle('ai:has-key', () => wrapResult(async () => aiService.hasApiKey()))

  ipcMain.handle(
    'ai:translate-definition',
    (_event, word: string, definition: string, targetLang: Language, nativeLang: NativeLanguage) =>
      wrapResult(async () => {
        const cached = db.getCachedTranslation(word, targetLang, nativeLang)
        if (cached) return cached
        const translation = await aiService.translateDefinition(word, definition, targetLang, nativeLang)
        db.cacheTranslation({ word, targetLang, nativeLang, translation })
        return translation
      }),
  )

  ipcMain.handle(
    'ai:explain-grammar',
    (event, sentence: string, targetWord: string, language: Language, nativeLanguage?: NativeLanguage) =>
      wrapResult(async () => {
        if (!aiService.hasApiKey()) throw new Error('No API key configured. Add your API key in Settings.')
        const streamId = randomUUID()
        aiService.explainGrammar(sentence, targetWord, language, streamId, event.sender, nativeLanguage)
        return { streamId }
      }),
  )

  ipcMain.handle('ai:translate', (event, sentence: string, language: Language, nativeLanguage?: NativeLanguage) =>
    wrapResult(async () => {
      if (!aiService.hasApiKey()) throw new Error('No API key configured. Add your API key in Settings.')
      const streamId = randomUUID()
      aiService.translateWithContext(sentence, language, streamId, event.sender, nativeLanguage)
      return { streamId }
    }),
  )

  ipcMain.handle('ai:examples', (event, word: string, language: Language, count?: number, nativeLanguage?: NativeLanguage) =>
    wrapResult(async () => {
      if (!aiService.hasApiKey()) throw new Error('No API key configured. Add your API key in Settings.')
      const streamId = randomUUID()
      aiService.generateExamples(word, language, count ?? 3, streamId, event.sender, nativeLanguage)
      return { streamId }
    }),
  )

  ipcMain.handle('ai:evaluate-drill-answer', (_event, input: DrillEvaluationInput) =>
    wrapResult(() => aiService.evaluateDrillAnswer(input)),
  )

  ipcMain.handle('ai:cancel-stream', (_event, streamId: string) =>
    wrapResult(async () => aiService.cancelStream(streamId)),
  )

  // ─── stats ───────────────────────────────────────────────────────────────────
  ipcMain.handle('stats:get-mining', () => wrapResult(() => db.getMiningStats()))
  ipcMain.handle('stats:daily-history', (_event, days: number) =>
    wrapResult(() => db.getMinedCountByDay(days)),
  )

  // ─── missions ───────────────────────────────────────────────────────────────
  ipcMain.handle('missions:get-daily', () => wrapResult(() => getDailyMissions(db)))
  ipcMain.handle('missions:claim-reward', (_event, missionId: string) =>
    wrapResult(() => claimMissionReward(db, missionId)),
  )

  // ─── settings ────────────────────────────────────────────────────────────────
  ipcMain.handle('settings:get', () => wrapResult(() => getSettings()))

  ipcMain.handle('settings:set', (_event, updates: Record<string, unknown>) =>
    wrapResult(() => {
      const previous = getSettings()
      setSettings(updates)
      const next = getSettings()
      if (previous.nativeLanguage !== next.nativeLanguage) {
        db.clearDefinitionTranslations()
      }
      // Re-initialize AI service whenever provider or keys change
      if (
        updates.aiProvider !== undefined ||
        updates.anthropicApiKey !== undefined ||
        updates.openaiApiKey !== undefined
      ) {
        const s = getSettings()
        aiService.initialize(s.aiProvider, s.anthropicApiKey, s.openaiApiKey)
      }
      if (updates.reminders !== undefined) {
        startReminderScheduler()
      }
    }),
  )

  ipcMain.handle('settings:test-key', (_event, apiKey: string, provider: string) =>
    wrapResult(() => aiService.testKey(apiKey, provider as 'anthropic' | 'openai')),
  )
  ipcMain.handle('settings:select-dir', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
    })
    return { data: result.canceled ? null : result.filePaths[0], error: null }
  })

  // ─── updater ────────────────────────────────────────────────────────────────
  ipcMain.handle('updater:get-version', () =>
    wrapResult(() => app.getVersion()),
  )

  ipcMain.handle('updater:check', () =>
    wrapResult(async () => {
      const result = await autoUpdater.checkForUpdates()
      return result?.updateInfo
        ? {
            version: result.updateInfo.version,
            releaseDate: result.updateInfo.releaseDate,
            releaseNotes: result.updateInfo.releaseNotes,
          }
        : null
    }),
  )

  ipcMain.handle('updater:open-download', (_event, version: string) =>
    wrapResult(async () => {
      const url = `https://github.com/Duong-1309/lexis/releases/tag/v${version}`
      await shell.openExternal(url)
    }),
  )
}

// ─── App lifecycle ────────────────────────────────────────────────────────────

protocol.registerSchemesAsPrivileged([
  { scheme: 'lexis-audio', privileges: { bypassCSP: true, supportFetchAPI: true } },
])

app.whenReady().then(() => {
  const userDataPath = app.getPath('userData')

  db.initialize(userDataPath)
  db.runMigrations()

  audioService.initialize(userDataPath)
  dictDownloadService.initialize(userDataPath)

  const settings = getSettings()
  aiService.initialize(settings.aiProvider, settings.anthropicApiKey, settings.openaiApiKey)

  // Dictionary paths: user downloaded (priority) and bundled (fallback)
  const userDictsDir = dictDownloadService.getDictsDir()
  const bundledDictsDir = app.isPackaged
    ? path.join(process.resourcesPath, 'dicts')
    : path.join(__dirname, '../../assets/dicts')
  dictService.setDictsDir(userDictsDir)

  // Try to open dictionaries from downloaded or bundled location
  dictService.tryOpenDictionary('ja', userDictsDir, bundledDictsDir)
  dictService.tryOpenDictionary('zh', userDictsDir, bundledDictsDir)
  dictService.tryOpenDictionary('en', userDictsDir, bundledDictsDir)

  protocol.registerFileProtocol('lexis-audio', (request, callback) => {
    const filename = decodeURIComponent(request.url.replace('lexis-audio://', ''))
    callback({ path: audioService.cachedPath(filename) })
  })

  setupIPCHandlers()
  createWindow()
  startReminderScheduler()
  setupAutoUpdater()
  startUpdateChecker()

  log.info('Lexis app started')
})

app.on('before-quit', () => {
  if (reminderTimer) clearInterval(reminderTimer)
  if (updateCheckTimer) clearInterval(updateCheckTimer)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (mainWindow === null) createWindow()
})
