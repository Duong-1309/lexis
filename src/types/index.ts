export type Language = 'ja' | 'zh' | 'ko' | 'en' | 'fr' | 'es'
export type NativeLanguage = 'vi' | 'en'
export type MediaType = 'subtitle' | 'epub' | 'web' | 'text'
export type CardTemplate = 'Basic' | 'Cloze' | 'Word' | 'Sentence' | 'Pattern' | 'DrillAttempt'
export type CardState = 'new' | 'learning' | 'review' | 'suspended'
export type ReviewRating = 1 | 2 | 3 | 4 // Again / Hard / Good / Easy
export type DrillType = 'translation' | 'transform' | 'substitution' | 'free_production' | 'cloze'
export type DrillVerdict = 'correct' | 'needs_fix' | 'incorrect'

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
  nativeDefinition?: string
  partOfSpeech?: string
  levelInfo?: { jlpt?: number; hsk?: number }
  audioWord?: string
  stepIndex: number
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
  nativeDefinition?: string
  partOfSpeech?: string
  levelInfo?: { jlpt?: number; hsk?: number }
  audioWord?: string
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
  stepIndex: number
  dueDate: string
}

export interface ReviewSession {
  cards: Card[]
  totalDue: number
  newCount: number
  reviewCount: number
}

// ─── Patterns + Active Production Drills ─────────────────────────────────────

export interface Pattern {
  id: number
  deckId?: number
  language: Language
  patternText: string
  meaningNative?: string
  explanation?: string
  exampleSentence?: string
  sourceSentenceId?: number
  sourceId?: number
  tags: string[]
  createdAt: string
  updatedAt: string
}

export interface PatternDraft {
  deckId?: number
  language: Language
  patternText: string
  meaningNative?: string
  explanation?: string
  exampleSentence?: string
  slotPhrase?: string
  sourceSentenceId?: number
  sourceId?: number
  tags: string[]
}

export type PatternUpdate = Partial<PatternDraft>

export interface PatternFilters {
  deckId?: number
  language?: Language
  query?: string
}

export interface DrillPrompt {
  id: number
  patternId: number
  type: DrillType
  promptNative?: string
  promptTarget?: string
  expectedAnswer?: string
  variables: Record<string, string>
  createdAt: string
}

export interface DrillPromptDraft {
  patternId: number
  type: DrillType
  promptNative?: string
  promptTarget?: string
  expectedAnswer?: string
  variables?: Record<string, string>
}

export interface DrillAttempt {
  id: number
  patternId: number
  promptId?: number
  cardId?: number
  userAnswer: string
  correctedAnswer?: string
  feedback?: string
  score?: number
  verdict?: DrillVerdict
  mistakeTypes: string[]
  createdAt: string
}

export interface DrillAttemptDraft {
  patternId: number
  promptId?: number
  cardId?: number
  userAnswer: string
  correctedAnswer?: string
  feedback?: string
  score?: number
  verdict?: DrillVerdict
  mistakeTypes?: string[]
}

export interface DrillEvaluationInput {
  language: Language
  patternText: string
  prompt: string
  expectedAnswer?: string
  userAnswer: string
  nativeLanguage: NativeLanguage
}

export interface DrillEvaluation {
  score: number
  verdict: DrillVerdict
  correctedAnswer: string
  feedback: string
  suggestions: string[]
  examples: string[]
  mistakeTypes: string[]
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

// ─── Dictionary Management ────────────────────────────────────────────────────

export type DictionaryId = 'jmdict' | 'cedict' | 'wordnet'

export interface DictionaryInfo {
  id: DictionaryId
  language: Language
  name: string
  description: string
  size: number // bytes
  sizeFormatted: string
  url: string
  downloaded: boolean
  downloading: boolean
  progress: number // 0-100
  version: string
  updatedAt?: string
  bundled?: boolean // true if available in app bundle
  source?: 'user' | 'bundled' // where the dictionary was loaded from
}

export interface DictionaryManifest {
  dictionaries: Record<DictionaryId, { version: string; downloadedAt: string }>
}

export interface DictionaryDownloadProgress {
  id: DictionaryId
  progress: number
  downloadedBytes: number
  totalBytes: number
  stage?: string // e.g., "Downloading...", "Building database..."
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

export type DailyNextActionType = 'review' | 'drill' | 'mine' | 'done'

export interface DailyNextAction {
  type: DailyNextActionType
  label: string
  detail: string
  count?: number
}

// ─── Missions ─────────────────────────────────────────────────────────────────

export type MissionType = 'review_cards' | 'mine_cards' | 'complete_drills' | 'convert_attempt'

export interface Mission {
  id: string
  type: MissionType
  title: string
  description: string
  targetCount: number
  currentCount: number
  coinReward: number
  completed: boolean
  claimedAt?: string
}

export interface DailyMissions {
  date: string
  missions: Mission[]
  totalCoins: number
  claimedCoins: number
}

// ─── Items (placeholder for future shop system) ──────────────────────────────

export type ItemCategory = 'theme' | 'avatar' | 'badge' | 'boost'
export type ItemRarity = 'common' | 'rare' | 'epic' | 'legendary'

export interface ShopItem {
  id: string
  name: string
  description: string
  category: ItemCategory
  rarity: ItemRarity
  coinCost: number
  iconUrl?: string
  previewUrl?: string
  unlocked: boolean
  equippedAt?: string
}

export interface UserInventory {
  items: ShopItem[]
  equippedTheme?: string
  equippedAvatar?: string
  equippedBadges: string[]
}

// ─── Stats ────────────────────────────────────────────────────────────────────

export interface MiningStats {
  totalCards: number
  cardsCreatedToday: number
  reviewsToday: number
  dueToday: number
  patternsMinedToday: number
  drillAttemptsToday: number
  retentionRate: number
  currentStreak: number
  longestStreak: number
  validLearningDay: boolean
  hoursUntilDayEnd: number
  nextAction: DailyNextAction
  byLanguage: Record<string, number>
  recentCards: Card[]
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

export interface SchedulingSettings {
  learningStepsMinutes: number[]
  dailyDueTime: string
  newCardsPerDay: number
  reviewsPerDay: number
}

export interface CardSettings {
  defaultTemplate: CardTemplate
  showNativeDefinitionFirst: boolean
  autoPlayAudio: boolean
}

export interface ReminderSettings {
  enabled: boolean
  reminderTime: string
  quietHoursStart: string
  quietHoursEnd: string
  lastNotifiedDate?: string
  lastDueNotifiedKey?: string
}

export interface UserSettings {
  defaultDeckId: number
  nativeLanguage: NativeLanguage
  aiProvider: AIProvider
  anthropicApiKey: string
  openaiApiKey: string
  forvoApiKey: string
  timeZone: string
  scheduling: SchedulingSettings
  reminders: ReminderSettings
  cards: CardSettings
  readerFontSize: number
  readerLineHeight: number
  readerFont: string
  theme: 'light' | 'dark' | 'system'
  checkForUpdates: boolean
  firstLaunchDone: boolean
  coinBalance: number
}

// ─── window.lexis API surface ─────────────────────────────────────────────────

export interface MediaAPI {
  importFile(type: 'subtitle' | 'epub', language?: Language): Promise<IPCResult<MediaSource>>
  importFromPath(filePath: string, language?: Language): Promise<IPCResult<MediaSource>>
  importText(input: { title: string; text: string; language: Language }): Promise<IPCResult<MediaSource>>
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
  // Dictionary management
  listDictionaries(): Promise<IPCResult<DictionaryInfo[]>>
  downloadDictionary(id: DictionaryId): Promise<IPCResult<void>>
  deleteDictionary(id: DictionaryId): Promise<IPCResult<void>>
  isDictionaryAvailable(language: Language): Promise<IPCResult<boolean>>
  onDownloadProgress(callback: (progress: DictionaryDownloadProgress) => void): void
  removeDownloadListeners(): void
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

export interface PatternsAPI {
  create(draft: PatternDraft): Promise<IPCResult<Pattern>>
  update(id: number, updates: PatternUpdate): Promise<IPCResult<void>>
  list(filters?: PatternFilters): Promise<IPCResult<Pattern[]>>
  get(id: number): Promise<IPCResult<Pattern | null>>
  delete(id: number): Promise<IPCResult<void>>
  isDuplicate(patternText: string, language: Language, excludeId?: number): Promise<IPCResult<boolean>>
}

export interface DrillsAPI {
  createPrompt(draft: DrillPromptDraft): Promise<IPCResult<DrillPrompt>>
  listPrompts(patternId: number): Promise<IPCResult<DrillPrompt[]>>
  saveAttempt(draft: DrillAttemptDraft): Promise<IPCResult<DrillAttempt>>
  listAttempts(patternId: number): Promise<IPCResult<DrillAttempt[]>>
  createReviewCard(attemptId: number, deckId: number): Promise<IPCResult<Card>>
}

export interface AIAPI {
  hasApiKey(): Promise<IPCResult<boolean>>
  translateDefinition(
    word: string,
    definition: string,
    targetLang: Language,
    nativeLang: NativeLanguage,
  ): Promise<IPCResult<string>>
  explainGrammar(
    sentence: string,
    targetWord: string,
    language: Language,
    nativeLanguage?: NativeLanguage,
  ): Promise<IPCResult<{ streamId: string }>>
  translateWithContext(
    sentence: string,
    targetLanguage: string,
    nativeLanguage?: NativeLanguage,
  ): Promise<IPCResult<{ streamId: string }>>
  generateExamples(
    word: string,
    language: Language,
    count?: number,
    nativeLanguage?: NativeLanguage,
  ): Promise<IPCResult<{ streamId: string }>>
  evaluateDrillAnswer(input: DrillEvaluationInput): Promise<IPCResult<DrillEvaluation>>
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

export interface MissionsAPI {
  getDailyMissions(): Promise<IPCResult<DailyMissions>>
  claimMissionReward(missionId: string): Promise<IPCResult<{ coinsEarned: number; newBalance: number }>>
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
  patterns: PatternsAPI
  drills: DrillsAPI
  ai: AIAPI
  stats: StatsAPI
  missions: MissionsAPI
  settings: SettingsAPI
}

declare global {
  interface Window {
    lexis: LexisAPI
  }
}
