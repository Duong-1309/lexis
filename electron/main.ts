import { app, BrowserWindow, ipcMain, dialog, protocol } from 'electron'
import path from 'path'
import fs from 'fs'
import { randomUUID } from 'crypto'
import log from 'electron-log'
import { db } from './services/db'
import { dictService } from './services/dictionary'
import { audioService } from './services/audio'
import { aiService } from './services/ai'
import { parseSRT } from './services/parsers/srt'
import { parseASS } from './services/parsers/ass'
import { parseEPUBChapters, loadEPUBChapter } from './services/parsers/epub'
import { calculateNextReview } from './services/srs'
import { getSettings, setSettings } from './services/settings'
import type { IPCResult, MediaSource, Language, DraftCard, CardUpdate, ReviewRating } from '../src/types/index'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
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

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
    mainWindow.webContents.openDevTools()
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

  ipcMain.handle('media:import-url', async (_event, url: string, language: Language) => {
    return wrapResult(async () => {
      // TODO Sprint 4
      throw new Error('Web import not yet implemented (Sprint 4)')
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

  // ─── ai ─────────────────────────────────────────────────────────────────────
  ipcMain.handle('ai:has-key', () => wrapResult(async () => aiService.hasApiKey()))

  ipcMain.handle(
    'ai:explain-grammar',
    (event, sentence: string, targetWord: string, language: Language) =>
      wrapResult(async () => {
        const streamId = randomUUID()
        aiService.explainGrammar(sentence, targetWord, language, streamId, event.sender)
        return { streamId }
      }),
  )

  ipcMain.handle('ai:translate', (event, sentence: string, language: Language) =>
    wrapResult(async () => {
      const streamId = randomUUID()
      aiService.translateWithContext(sentence, language, streamId, event.sender)
      return { streamId }
    }),
  )

  ipcMain.handle('ai:examples', (event, word: string, language: Language, count?: number) =>
    wrapResult(async () => {
      const streamId = randomUUID()
      aiService.generateExamples(word, language, count ?? 3, streamId, event.sender)
      return { streamId }
    }),
  )

  ipcMain.handle('ai:cancel-stream', (_event, streamId: string) =>
    wrapResult(async () => aiService.cancelStream(streamId)),
  )

  // ─── stats ───────────────────────────────────────────────────────────────────
  ipcMain.handle('stats:get-mining', () => wrapResult(() => db.getMiningStats()))
  ipcMain.handle('stats:daily-history', (_event, days: number) =>
    wrapResult(() => db.getMinedCountByDay(days)),
  )

  // ─── settings ────────────────────────────────────────────────────────────────
  ipcMain.handle('settings:get', () => wrapResult(() => getSettings()))

  ipcMain.handle('settings:set', (_event, updates: Record<string, unknown>) =>
    wrapResult(() => {
      setSettings(updates)
      // Re-initialize AI service whenever provider or keys change
      if (
        updates.aiProvider !== undefined ||
        updates.anthropicApiKey !== undefined ||
        updates.openaiApiKey !== undefined
      ) {
        const s = getSettings()
        aiService.initialize(s.aiProvider, s.anthropicApiKey, s.openaiApiKey)
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

  const settings = getSettings()
  aiService.initialize(settings.aiProvider, settings.anthropicApiKey, settings.openaiApiKey)

  // Open dictionaries if built
  const dictsDir = app.isPackaged
    ? path.join(process.resourcesPath, 'dicts')
    : path.join(__dirname, '../../assets/dicts')
  dictService.setDictsDir(dictsDir)
  dictService.openDictionary('ja', path.join(dictsDir, 'jmdict.db'))
  dictService.openDictionary('zh', path.join(dictsDir, 'cedict.db'))
  dictService.openDictionary('en', path.join(dictsDir, 'wordnet.db'))

  protocol.registerFileProtocol('lexis-audio', (request, callback) => {
    const filename = decodeURIComponent(request.url.replace('lexis-audio://', ''))
    callback({ path: audioService.cachedPath(filename) })
  })

  setupIPCHandlers()
  createWindow()

  log.info('Lexis app started')
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (mainWindow === null) createWindow()
})
