import { contextBridge, ipcRenderer } from 'electron'
import type {
  Language,
  MediaSource,
  Sentence,
  EPUBChapter,
  ReadingProgress,
  DictEntry,
  Token,
  AudioResult,
  Deck,
  Card,
  DraftCard,
  CardUpdate,
  SRSResult,
  ReviewRating,
  MiningStats,
  DayStat,
  UserSettings,
  IPCResult,
  LexisAPI,
} from '../src/types/index'

const lexisAPI: LexisAPI = {
  media: {
    importFile: (type, language) => ipcRenderer.invoke('media:import-file', type, language),
    importFromPath: (filePath, language) => ipcRenderer.invoke('media:import-from-path', filePath, language),
    importUrl: (url, language) => ipcRenderer.invoke('media:import-url', url, language),
    list: () => ipcRenderer.invoke('media:list'),
    delete: (sourceId) => ipcRenderer.invoke('media:delete', sourceId),
    markOpened: (sourceId) => ipcRenderer.invoke('media:mark-opened', sourceId),
  },

  reader: {
    loadSubtitleSentences: (sourceId) => ipcRenderer.invoke('reader:load-subtitle', sourceId),
    loadEPUBChapters: (sourceId) => ipcRenderer.invoke('reader:load-epub-chapters', sourceId),
    loadEPUBChapter: (sourceId, chapterId) =>
      ipcRenderer.invoke('reader:load-epub-chapter', sourceId, chapterId),
    saveProgress: (sourceId, position, chapterId) =>
      ipcRenderer.invoke('reader:save-progress', sourceId, position, chapterId),
    getProgress: (sourceId) => ipcRenderer.invoke('reader:get-progress', sourceId),
    getMinedWordsForSource: (sourceId) => ipcRenderer.invoke('reader:mined-words', sourceId),
  },

  dictionary: {
    lookup: (word, language) => ipcRenderer.invoke('dictionary:lookup', word, language),
    tokenize: (text, language) => ipcRenderer.invoke('dictionary:tokenize', text, language),
    autocomplete: (prefix, language) =>
      ipcRenderer.invoke('dictionary:autocomplete', prefix, language),
  },

  audio: {
    getAudioPath: (word, language, reading) =>
      ipcRenderer.invoke('audio:get-path', word, language, reading),
  },

  decks: {
    list: () => ipcRenderer.invoke('decks:list'),
    create: (name: string, description?: string) =>
      ipcRenderer.invoke('decks:create', name, description),
    rename: (id: number, name: string) => ipcRenderer.invoke('decks:rename', id, name),
    delete: (id: number) => ipcRenderer.invoke('decks:delete', id),
  },

  cards: {
    due: (deckId: number) => ipcRenderer.invoke('cards:due', deckId),
    all: (deckId: number) => ipcRenderer.invoke('cards:all', deckId),
    create: (draft: DraftCard) => ipcRenderer.invoke('cards:create', draft),
    review: (cardId: number, rating: ReviewRating, timeTakenMs?: number) =>
      ipcRenderer.invoke('cards:review', cardId, rating, timeTakenMs),
    suspend: (id: number) => ipcRenderer.invoke('cards:suspend', id),
    unsuspend: (ids: number[]) => ipcRenderer.invoke('cards:unsuspend', ids),
    move: (ids: number[], deckId: number) => ipcRenderer.invoke('cards:move', ids, deckId),
    delete: (id: number) => ipcRenderer.invoke('cards:delete', id),
    isDuplicate: (word: string, language: Language) =>
      ipcRenderer.invoke('cards:is-duplicate', word, language),
    update: (id: number, updates: CardUpdate) =>
      ipcRenderer.invoke('cards:update', id, updates),
  },

  ai: {
    hasApiKey: () => ipcRenderer.invoke('ai:has-key'),
    explainGrammar: (sentence, targetWord, language) =>
      ipcRenderer.invoke('ai:explain-grammar', sentence, targetWord, language),
    translateWithContext: (sentence, targetLanguage) =>
      ipcRenderer.invoke('ai:translate', sentence, targetLanguage),
    generateExamples: (word, language, count) =>
      ipcRenderer.invoke('ai:examples', word, language, count),
    cancelStream: (streamId) => ipcRenderer.invoke('ai:cancel-stream', streamId),
    onStreamChunk: (callback) => {
      ipcRenderer.on('ai:stream-chunk', (_event, streamId: string, chunk: string) =>
        callback(streamId, chunk),
      )
    },
    onStreamDone: (callback) => {
      ipcRenderer.on('ai:stream-done', (_event, streamId: string) => callback(streamId))
    },
    onStreamError: (callback) => {
      ipcRenderer.on('ai:stream-error', (_event, streamId: string, error: string) =>
        callback(streamId, error),
      )
    },
    removeStreamListeners: () => {
      ipcRenderer.removeAllListeners('ai:stream-chunk')
      ipcRenderer.removeAllListeners('ai:stream-done')
      ipcRenderer.removeAllListeners('ai:stream-error')
    },
  },

  stats: {
    getMiningStats: () => ipcRenderer.invoke('stats:get-mining'),
    getDailyHistory: (days) => ipcRenderer.invoke('stats:daily-history', days),
  },

  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (updates) => ipcRenderer.invoke('settings:set', updates),
    testAIKey: (apiKey, provider) => ipcRenderer.invoke('settings:test-key', apiKey, provider),
    selectDirectory: () => ipcRenderer.invoke('settings:select-dir'),
  },
}

contextBridge.exposeInMainWorld('lexis', lexisAPI)
