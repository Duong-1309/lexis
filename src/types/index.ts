export type Language = 'ja' | 'zh' | 'ko' | 'en' | 'fr' | 'es'
export type MediaType = 'subtitle' | 'epub' | 'web'
export type CardTemplate = 'Basic' | 'Cloze'
export type CardState = 'new' | 'learning' | 'review' | 'suspended'
export type ReviewRating = 1 | 2 | 3 | 4 // Again / Hard / Good / Easy

// ─── Media ───────────────────────────────────────────────────────────────────

export interface MediaSource {
  id: number
  type: MediaType
  title: string
  filePath?: string
  sourceUrl?: string
  language: Language
  wordCount?: number
  sentenceCount?: number
  addedAt: string
  lastOpened?: string
}

export interface MediaSourceInsert {
  type: MediaType
  title: string
  filePath?: string
  sourceUrl?: string
  language: Language
  wordCount?: number
  sentenceCount?: number
}

export interface Sentence {
  id: number
  sourceId: number
  content: string
  translation?: string
  position: number
  startTimeMs?: number
  endTimeMs?: number
  chapterId?: string
}

export interface SentenceInsert {
  sourceId: number
  content: string
  position: number
  startTimeMs?: number
  endTimeMs?: number
  chapterId?: string
}

export interface MinedWord {
  id: number
  word: string
  reading?: string
  language: Language
  sourceId?: number
  sentenceId?: number
  cardId?: number
  minedAt: string
}

// ─── Flashcards ───────────────────────────────────────────────────────────────

export interface Deck {
  id: number
  name: string
  description?: string
  createdAt: string
  cardCount?: number
  dueCount?: number
  newCount?: number
}

export interface Card {
  id: number
  deckId: number
  frontHtml: string
  backHtml: string
  tags: string[]
  word?: string
  reading?: string
  language?: Language
  sourceSentence?: string
  sourceId?: number
  dueDate: string
  interval: number
  easeFactor: number
  reps: number
  lapses: number
  cardState: CardState
  createdAt: string
  lastReviewed?: string
}

export interface DraftCard {
  deckId: number
  frontHtml: string
  backHtml: string
  tags: string[]
  template: CardTemplate
  word?: string
  reading?: string
  language?: Language
  sourceSentence?: string
  sourceId?: number
}

export interface CardUpdate {
  deckId?: number
  frontHtml: string
  backHtml: string
  tags: string[]
  word?: string
  reading?: string
  language?: Language
  sourceSentence?: string
  sourceId?: number
}

export interface ReviewLog {
  id: number
  cardId: number
  reviewedAt: string
  rating: ReviewRating
  intervalBefore: number
  intervalAfter: number
  easeBefore: number
  timeTakenMs?: number
}

export interface SRSResult {
  interval: number
  easeFactor: number
  reps: number
  lapses: number
  cardState: CardState
  dueDate: string
}

export interface ReviewSession {
  cards: Card[]
  totalDue: number
  newCount: number
  reviewCount: number
}

// ─── Dictionary ───────────────────────────────────────────────────────────────

export interface DictReading {
  value: string
  common: boolean
  pitchPattern?: string
}

export interface DictSense {
  partOfSpeech: string[]
  definitions: string[]
  examples?: Array<{ source: string; translation: string }>
  misc?: string[]
}

export interface DictEntry {
  word: string
  language: Language
  readings: DictReading[]
  senses: DictSense[]
  jlptLevel?: number
  hskLevel?: number
  commonWord?: boolean
}

export interface Token {
  surface: string
  dictionaryForm: string
  reading?: string
  partOfSpeech?: string
  offset: number
}

// ─── Shared ───────────────────────────────────────────────────────────────────

export interface IPCResult<T> {
  data: T | null
  error: string | null
}

export interface DayStat {
  date: string
  count: number
}

export interface MiningStats {
  totalMined: number
  minedToday: number
  currentStreak: number
  longestStreak: number
  byLanguage: Record<string, number>
  recentWords: MinedWord[]
  dailyHistory: DayStat[]
}

export interface ReadingProgress {
  sourceId: number
  position: number
  chapterId?: string
  updatedAt: string
}

export interface EPUBChapter {
  id: string
  title: string
  order: number
}

export interface AudioResult {
  filename: string
  source: 'forvo' | 'tts' | 'cache'
}

export type AIProvider = 'anthropic' | 'openai'

export interface UserSettings {
  defaultDeckId: number
  aiProvider: AIProvider
  anthropicApiKey: string
  openaiApiKey: string
  forvoApiKey: string
  readerFontSize: number
  readerLineHeight: number
  readerFont: string
  theme: 'light' | 'dark' | 'system'
  language: string
  checkForUpdates: boolean
  firstLaunchDone: boolean
}

// ─── window.lexis API surface ─────────────────────────────────────────────────

export interface MediaAPI {
  importFile(type: 'subtitle' | 'epub', language?: Language): Promise<IPCResult<MediaSource>>
  importFromPath(filePath: string, language?: Language): Promise<IPCResult<MediaSource>>
  importUrl(url: string, language: Language): Promise<IPCResult<MediaSource>>
  list(): Promise<IPCResult<MediaSource[]>>
  delete(sourceId: number): Promise<IPCResult<void>>
  markOpened(sourceId: number): Promise<IPCResult<void>>
}

export interface ReaderAPI {
  loadSubtitleSentences(sourceId: number): Promise<IPCResult<Sentence[]>>
  loadEPUBChapters(sourceId: number): Promise<IPCResult<EPUBChapter[]>>
  loadEPUBChapter(sourceId: number, chapterId: string): Promise<IPCResult<string>>
  saveProgress(sourceId: number, position: number, chapterId?: string): Promise<IPCResult<void>>
  getProgress(sourceId: number): Promise<IPCResult<ReadingProgress | null>>
  getMinedWordsForSource(sourceId: number): Promise<IPCResult<string[]>>
}

export interface DictionaryAPI {
  lookup(word: string, language: Language): Promise<IPCResult<DictEntry[]>>
  tokenize(text: string, language: Language): Promise<IPCResult<Token[]>>
  autocomplete(prefix: string, language: Language): Promise<IPCResult<string[]>>
}

export interface AudioAPI {
  getAudioPath(word: string, language: Language, reading?: string): Promise<IPCResult<AudioResult>>
}

export interface DecksAPI {
  list(): Promise<IPCResult<Deck[]>>
  create(name: string, description?: string): Promise<IPCResult<Deck>>
  rename(id: number, name: string): Promise<IPCResult<void>>
  delete(id: number): Promise<IPCResult<void>>
}

export interface CardsAPI {
  due(deckId: number): Promise<IPCResult<Card[]>>
  all(deckId: number): Promise<IPCResult<Card[]>>
  create(draft: DraftCard): Promise<IPCResult<Card>>
  review(cardId: number, rating: ReviewRating, timeTakenMs?: number): Promise<IPCResult<SRSResult>>
  suspend(id: number): Promise<IPCResult<void>>
  unsuspend(ids: number[]): Promise<IPCResult<void>>
  move(ids: number[], deckId: number): Promise<IPCResult<void>>
  delete(id: number): Promise<IPCResult<void>>
  isDuplicate(word: string, language: Language): Promise<IPCResult<boolean>>
  update(id: number, updates: CardUpdate): Promise<IPCResult<void>>
}

export interface AIAPI {
  hasApiKey(): Promise<IPCResult<boolean>>
  explainGrammar(sentence: string, targetWord: string, language: Language): Promise<IPCResult<{ streamId: string }>>
  translateWithContext(sentence: string, targetLanguage: string): Promise<IPCResult<{ streamId: string }>>
  generateExamples(word: string, language: Language, count?: number): Promise<IPCResult<{ streamId: string }>>
  cancelStream(streamId: string): Promise<IPCResult<void>>
  onStreamChunk(callback: (streamId: string, chunk: string) => void): void
  onStreamDone(callback: (streamId: string) => void): void
  onStreamError(callback: (streamId: string, error: string) => void): void
  removeStreamListeners(): void
}

export interface StatsAPI {
  getMiningStats(): Promise<IPCResult<MiningStats>>
  getDailyHistory(days: number): Promise<IPCResult<DayStat[]>>
}

export interface SettingsAPI {
  get(): Promise<IPCResult<UserSettings>>
  set(updates: Partial<UserSettings>): Promise<IPCResult<void>>
  testAIKey(apiKey: string, provider: AIProvider): Promise<IPCResult<boolean>>
  selectDirectory(): Promise<IPCResult<string | null>>
}

export interface LexisAPI {
  media: MediaAPI
  reader: ReaderAPI
  dictionary: DictionaryAPI
  audio: AudioAPI
  decks: DecksAPI
  cards: CardsAPI
  ai: AIAPI
  stats: StatsAPI
  settings: SettingsAPI
}

declare global {
  interface Window {
    lexis: LexisAPI
  }
}
