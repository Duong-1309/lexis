import { expect, test } from '@playwright/test'
import fs from 'fs'
import http, { type Server } from 'http'
import path from 'path'

let staticServer: Server | null = null

function contentType(filePath: string): string {
  if (filePath.endsWith('.js')) return 'text/javascript'
  if (filePath.endsWith('.css')) return 'text/css'
  if (filePath.endsWith('.html')) return 'text/html'
  return 'application/octet-stream'
}

test.describe('mining workflow', () => {
  test.setTimeout(60_000)

  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(60_000)
    const root = path.resolve(process.cwd(), 'out/renderer')
    staticServer = http.createServer((request, response) => {
      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1:4173')
      const pathname = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname
      const filePath = path.join(root, pathname)
      if (!filePath.startsWith(root) || !fs.existsSync(filePath)) {
        response.writeHead(404)
        response.end('Not found')
        return
      }
      response.writeHead(200, { 'Content-Type': contentType(filePath) })
      response.end(fs.readFileSync(filePath))
    })
    await new Promise<void>((resolve) => staticServer?.listen(4173, '127.0.0.1', resolve))
  })

  test.afterAll(() => {
    staticServer?.close()
    staticServer = null
  })

  test.beforeEach(async ({ page }) => {
    const browserLogs: string[] = []
    page.on('console', (message) => browserLogs.push(`${message.type()}: ${message.text()}`))
    page.on('pageerror', (error) => browserLogs.push(`pageerror: ${error.message}`))
    await page.addInitScript(() => {
      let nextId = 1
      const decks = [{ id: 1, name: 'Default', description: 'Default deck', createdAt: new Date().toISOString() }]
      const sources: Array<Record<string, unknown>> = []
      const sentencesBySource = new Map<number, Array<Record<string, unknown>>>()
      const patterns: Array<Record<string, unknown>> = []
      const prompts: Array<Record<string, unknown>> = []
      const attempts: Array<Record<string, unknown>> = []
      const cards: Array<Record<string, unknown>> = []
      const ok = <T,>(data: T) => Promise.resolve({ data, error: null })

      window.lexis = {
        media: {
          importFile: async () => ({ data: null, error: 'not implemented in e2e harness' }),
          importFromPath: async () => ({ data: null, error: 'not implemented in e2e harness' }),
          importText: async (input) => {
            const source = {
              id: nextId++,
              type: 'text',
              title: input.title,
              language: input.language,
              sentenceCount: 2,
              addedAt: new Date().toISOString(),
            }
            sources.unshift(source)
            sentencesBySource.set(source.id, [
              {
                id: nextId++,
                sourceId: source.id,
                content: 'Chemistry is the study of matter.',
                position: 0,
              },
              {
                id: nextId++,
                sourceId: source.id,
                content: 'Electrons change their energy levels.',
                position: 1,
              },
            ])
            return ok(source)
          },
          importUrl: async () => ({ data: null, error: 'not implemented in e2e harness' }),
          list: async () => ok(sources),
          delete: async () => ok(undefined),
          markOpened: async () => ok(undefined),
        },
        reader: {
          loadSubtitleSentences: async (sourceId) => ok(sentencesBySource.get(sourceId) ?? []),
          loadEPUBChapters: async () => ok([]),
          loadEPUBChapter: async () => ok(''),
          saveProgress: async () => ok(undefined),
          getProgress: async () => ok(null),
          getMinedWordsForSource: async () => ok([]),
        },
        dictionary: {
          lookup: async () => ok([]),
          tokenize: async () => ok([]),
          autocomplete: async () => ok([]),
        },
        audio: {
          getAudioPath: async () => ok(null),
        },
        decks: {
          list: async () => ok(decks),
          create: async (name, description) => {
            const deck = { id: nextId++, name, description, createdAt: new Date().toISOString() }
            decks.push(deck)
            return ok(deck)
          },
          rename: async () => ok(undefined),
          delete: async () => ok(undefined),
        },
        cards: {
          due: async () => ok(cards),
          all: async () => ok(cards),
          create: async (draft) => {
            const card = {
              id: nextId++,
              deckId: draft.deckId,
              frontHtml: draft.frontHtml,
              backHtml: draft.backHtml,
              tags: draft.tags,
              template: draft.template,
              word: draft.word,
              language: draft.language,
              stepIndex: 0,
              dueDate: new Date().toISOString(),
              interval: 0,
              easeFactor: 2.5,
              reps: 0,
              lapses: 0,
              cardState: 'new',
              createdAt: new Date().toISOString(),
            }
            cards.push(card)
            return ok(card)
          },
          review: async () => ok({
            interval: 0,
            easeFactor: 2.5,
            reps: 1,
            lapses: 0,
            cardState: 'learning',
            stepIndex: 1,
            dueDate: new Date().toISOString(),
          }),
          suspend: async () => ok(undefined),
          unsuspend: async () => ok(undefined),
          move: async () => ok(undefined),
          delete: async () => ok(undefined),
          isDuplicate: async () => ok(false),
          update: async () => ok(undefined),
        },
        patterns: {
          create: async (draft) => {
            const pattern = {
              id: nextId++,
              ...draft,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }
            patterns.push(pattern)
            return ok(pattern)
          },
          update: async () => ok(undefined),
          list: async () => ok(patterns),
          get: async (id) => ok(patterns.find((pattern) => pattern.id === id) ?? null),
          delete: async () => ok(undefined),
          isDuplicate: async () => ok(false),
        },
        drills: {
          createPrompt: async (draft) => {
            const prompt = { id: nextId++, ...draft, createdAt: new Date().toISOString() }
            prompts.push(prompt)
            return ok(prompt)
          },
          listPrompts: async (patternId) => ok(prompts.filter((prompt) => prompt.patternId === patternId)),
          saveAttempt: async (draft) => {
            const attempt = { id: nextId++, ...draft, createdAt: new Date().toISOString() }
            attempts.push(attempt)
            return ok(attempt)
          },
          listAttempts: async (patternId) => ok(attempts.filter((attempt) => attempt.patternId === patternId)),
          createReviewCard: async (attemptId, deckId) => {
            const attempt = attempts.find((item) => item.id === attemptId)
            const card = {
              id: nextId++,
              deckId,
              frontHtml: String(attempt?.userAnswer ?? ''),
              backHtml: String(attempt?.correctedAnswer ?? ''),
              tags: ['drill', 'pattern', 'en'],
              template: 'DrillAttempt',
              word: String(attempt?.userAnswer ?? ''),
              language: 'en',
              stepIndex: 0,
              dueDate: new Date().toISOString(),
              interval: 0,
              easeFactor: 2.5,
              reps: 0,
              lapses: 0,
              cardState: 'new',
              createdAt: new Date().toISOString(),
            }
            cards.push(card)
            return ok(card)
          },
        },
        ai: {
          hasApiKey: async () => ok(false),
          translateDefinition: async () => ok(''),
          explainGrammar: async () => ok({ streamId: 'mock' }),
          translateWithContext: async () => ok({ streamId: 'mock' }),
          generateExamples: async () => ok({ streamId: 'mock' }),
          evaluateDrillAnswer: async () => ok({
            correctedAnswer: 'Biology is the study of life.',
            feedback: 'Looks good.',
            score: 95,
            verdict: 'correct',
            suggestions: [],
            examples: [],
            mistakeTypes: [],
          }),
          cancelStream: async () => ok(undefined),
          onStreamChunk: () => {},
          onStreamDone: () => {},
          onStreamError: () => {},
          removeStreamListeners: () => {},
        },
        stats: {
          getMiningStats: async () => ok({
            totalCards: cards.length,
            cardsCreatedToday: cards.length,
            reviewsToday: 0,
            dueToday: cards.length,
            patternsMinedToday: patterns.length,
            drillAttemptsToday: attempts.length,
            retentionRate: 0,
            currentStreak: cards.length + patterns.length + attempts.length > 0 ? 1 : 0,
            longestStreak: cards.length + patterns.length + attempts.length > 0 ? 1 : 0,
            validLearningDay: cards.length + patterns.length + attempts.length > 0,
            nextAction: {
              type: cards.length > 0 ? 'review' : 'mine',
              label: cards.length > 0 ? 'Review due cards' : 'Mine one sentence',
              detail: cards.length > 0 ? `${cards.length} cards due today` : 'Mine from current source',
              count: cards.length,
            },
            byLanguage: {},
            recentCards: cards,
            dailyHistory: [],
          }),
          getDailyHistory: async () => ok([]),
        },
        settings: {
          get: async () => ok({
            defaultDeckId: 1,
            nativeLanguage: 'vi',
            aiProvider: 'anthropic',
            anthropicApiKey: '',
            openaiApiKey: '',
            forvoApiKey: '',
            timeZone: 'UTC',
            scheduling: {
              learningStepsMinutes: [1, 10],
              dailyDueTime: '04:00',
              newCardsPerDay: 20,
              reviewsPerDay: 200,
            },
            cards: {
              defaultTemplate: 'Basic',
              showNativeDefinitionFirst: true,
              autoPlayAudio: false,
            },
            readerFontSize: 16,
            readerLineHeight: 1.6,
            readerFont: 'sans-serif',
            theme: 'dark',
            checkForUpdates: true,
            firstLaunchDone: false,
          }),
          set: async () => ok(undefined),
          testAIKey: async () => ok(false),
          selectDirectory: async () => ok(null),
        },
      }
    })

    await page.goto('/')
    await page.waitForTimeout(500)
    if (await page.getByRole('button', { name: 'Import' }).count() === 0) {
      const bodyText = await page.locator('body').innerText().catch(() => '')
      throw new Error(`Import button not rendered.\nBody:\n${bodyText}\nLogs:\n${browserLogs.join('\n')}`)
    }
  })

  test('imports text, creates a pattern drill attempt, and creates a review card', async ({ page }) => {
    await page.getByRole('button', { name: 'Import' }).click()
    await page.getByRole('button', { name: 'Paste Text' }).click()
    await page.getByPlaceholder('Title').fill('E2E Text')
    await page.getByPlaceholder('Paste text here').fill(
      'Chemistry is the study of matter. Electrons change their energy levels.',
    )
    await page.getByRole('button', { name: 'Import text' }).click()

    await expect(page.getByText('E2E Text')).toBeVisible()
    await expect(page.getByText('Chemistry is the study of matter.')).toBeVisible()

    const result = await page.evaluate(async () => {
      const sources = await window.lexis.media.list()
      if (sources.error || !sources.data) throw new Error(sources.error ?? 'No sources')
      const source = sources.data.find((item) => item.title === 'E2E Text')
      if (!source) throw new Error('Imported source not found')

      const sentences = await window.lexis.reader.loadSubtitleSentences(source.id)
      if (sentences.error || !sentences.data?.[0]) throw new Error(sentences.error ?? 'No sentences')
      const sentence = sentences.data[0]

      const decks = await window.lexis.decks.list()
      if (decks.error || !decks.data?.[0]) throw new Error(decks.error ?? 'No decks')
      const deck = decks.data[0]

      const pattern = await window.lexis.patterns.create({
        deckId: deck.id,
        language: 'en',
        patternText: 'the study of',
        meaningNative: 'nghiên cứu về',
        explanation: 'Use this pattern to describe an academic subject.',
        exampleSentence: sentence.content,
        sourceSentenceId: sentence.id,
        sourceId: source.id,
        tags: ['e2e'],
      })
      if (pattern.error || !pattern.data) throw new Error(pattern.error ?? 'No pattern')

      const prompt = await window.lexis.drills.createPrompt({
        patternId: pattern.data.id,
        type: 'free_production',
        promptNative: 'Create a new sentence using the pattern.',
        promptTarget: 'the study of',
        variables: {},
      })
      if (prompt.error || !prompt.data) throw new Error(prompt.error ?? 'No prompt')

      const attempt = await window.lexis.drills.saveAttempt({
        patternId: pattern.data.id,
        promptId: prompt.data.id,
        userAnswer: 'Biology is the study of life.',
        correctedAnswer: 'Biology is the study of life.',
        feedback: 'Saved from E2E smoke test.',
        score: 95,
        verdict: 'correct',
        mistakeTypes: [],
      })
      if (attempt.error || !attempt.data) throw new Error(attempt.error ?? 'No attempt')

      const card = await window.lexis.drills.createReviewCard(attempt.data.id, deck.id)
      if (card.error || !card.data) throw new Error(card.error ?? 'No review card')

      const due = await window.lexis.cards.due(deck.id)
      if (due.error || !due.data) throw new Error(due.error ?? 'No due cards')

      return {
        sourceType: source.type,
        sentenceCount: sentences.data.length,
        cardWord: card.data.word,
        dueCardIds: due.data.map((item) => item.id),
      }
    })

    expect(result.sourceType).toBe('text')
    expect(result.sentenceCount).toBe(2)
    expect(result.cardWord).toBe('Biology is the study of life.')
    expect(result.dueCardIds.length).toBeGreaterThan(0)
  })
})
