# System Architecture Document
# Lexis — Electron Desktop App

**Version:** 1.0  
**Status:** Approved for implementation  

---

## 1. Architecture Overview

Lexis follows the standard Electron two-process architecture with strict security separation. The main process owns all privileged operations (file system, network, database); the renderer process owns all UI. They communicate exclusively through a whitelisted IPC bridge.

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Electron Shell                               │
│                                                                     │
│  ┌──────────────────────────────┐  IPC (contextBridge)             │
│  │      Main Process            │◄─────────────────────────────┐   │
│  │      (Node.js)               │                              │   │
│  │                              │                              │   │
│  │  ┌──────────────────────┐    │       ┌────────────────────┐ │   │
│  │  │  Services            │    │       │  Renderer Process  │ │   │
│  │  │  ─────────────────   │    │       │  (Chromium/React)  │ │   │
│  │  │  db.ts (SQLite)      │    │       │                    │ │   │
│  │  │  dictionary.ts       │    │       │  React Components  │ │   │
│  │  │  srs.ts              │    │       │  Zustand Stores    │ │   │
│  │  │  ai.ts               │    │       │  Tailwind CSS      │ │   │
│  │  │  audio.ts            │    │       │                    │ │   │
│  │  │  parsers/            │    │       └────────────────────┘ │   │
│  │  └──────────────────────┘    │              ▲               │   │
│  │                              │              │               │   │
│  │  ┌──────────────────────┐    │       ┌──────┴───────┐      │   │
│  │  │  preload.ts          │────┼──────►│  window.lexis│      │   │
│  │  │  (contextBridge)     │    │       │  (exposed API)│      │   │
│  │  └──────────────────────┘    │       └──────────────┘      │   │
│  └──────────────────────────────┘                              │   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Local Storage Layer                                        │   │
│  │  ─────────────────────────────────────────────────────────  │   │
│  │  {userData}/lexis.db        — User data (SQLite WAL)        │   │
│  │  {userData}/jmdict.db       — Japanese dictionary (RO)      │   │
│  │  {userData}/cedict.db       — Chinese dictionary (RO)       │   │
│  │  {userData}/audio-cache/    — Downloaded audio files        │   │
│  │  {userData}/settings.json   — electron-store preferences    │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘

External Services (optional, internet required):
  Forvo API      → pronunciation audio when configured
  Anthropic API  → AI explanations/translations when selected
  OpenAI API     → AI explanations/translations/drill checks when selected
```

---

## 2. Main Process — Services

### 2.1 `db.ts` — Database Service

**Responsibility:** Single SQLite connection, migrations, all CRUD operations.

```typescript
// Pattern: singleton connection opened once at app start
class DatabaseService {
  private db: Database.Database;
  private dictDb: Map<string, Database.Database>; // lang → readonly DB

  initialize(userDataPath: string): void
  runMigrations(): void
  
  // Media sources
  insertMediaSource(source: MediaSourceInsert): MediaSource
  getMediaSources(): MediaSource[]
  getMediaSourceById(id: number): MediaSource | null
  
  // Sentences
  insertSentences(sentences: SentenceInsert[]): void
  getSentencesBySourceId(sourceId: number): Sentence[]
  
  // Mined words + local SRS cards
  insertMinedWord(word: MinedWordInsert): MinedWord
  getMinedWords(): MinedWord[]
  createPattern(draft: PatternDraft): Pattern
  getPatterns(deckId?: number): Pattern[]
  createDrillAttempt(draft: DrillAttemptDraft): DrillAttempt
  getDrillAttempts(patternId: number): DrillAttempt[]
  createDeck(name: string, description?: string): Deck
  getDecks(): Deck[]
  insertCard(draft: DraftCard): Card
  getDueCards(deckId: number, limit?: number): Card[]
  updateCardSRS(id: number, result: SRSResult): void
  logReview(entry: ReviewLogInsert): void
  
  // Stats
  getMinedCountByDay(days: number): DayStat[]
  getTotalMined(): number
}
```

**WAL Mode Setup:**
```sql
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA cache_size=-64000;  -- 64MB cache
PRAGMA foreign_keys=ON;
```

### 2.2 `dictionary.ts` — Dictionary Service

**Responsibility:** Word lookup with two-tier caching.

```
Lookup Request
     │
     ▼
┌─────────────┐    hit     ┌──────────────────┐
│  In-memory  │───────────►│  Return cached   │
│  LRU cache  │            │  result          │
│  (500 words)│            └──────────────────┘
└─────────────┘
     │ miss
     ▼
┌─────────────┐    hit     ┌──────────────────┐
│  SQLite     │───────────►│  Store in LRU    │
│  dict_cache │            │  Return result   │
│  table      │            └──────────────────┘
└─────────────┘
     │ miss
     ▼
┌─────────────┐
│  Query      │
│  bundled    │
│  dict DB    │ (JMdict FTS5 / CEDICT FTS5)
│  (read-only)│
└─────────────┘
     │
     ▼
┌─────────────┐
│  Store in   │
│  cache +    │
│  Return     │
└─────────────┘
```

```typescript
class DictionaryService {
  private memCache: LRUCache<string, DictEntry[]>;
  
  lookup(word: string, lang: Language): DictEntry[]
  lookupWithContext(word: string, sentence: string, lang: Language): DictEntry[]
  tokenize(text: string, lang: Language): string[]  // kuromoji / jieba
  searchPrefix(prefix: string, lang: Language): string[]  // autocomplete
}
```

**JMdict Query Strategy:**
```sql
-- Primary: exact match on writings
SELECT * FROM entries 
WHERE writings MATCH ? 
LIMIT 10;

-- Fallback: reading match
SELECT * FROM entries 
WHERE readings MATCH ? 
LIMIT 10;
```

**CEDICT Query Strategy:**
```sql
-- Match simplified or traditional
SELECT * FROM entries
WHERE simplified = ? OR traditional = ?
LIMIT 10;
```

### 2.3 `srs.ts` — Local Scheduling Engine

**Responsibility:** Pure SM-2 scheduling calculation for local cards.

```typescript
export interface SRSResult {
  interval: number
  easeFactor: number
  reps: number
  lapses: number
  cardState: CardState
  dueDate: string
}

export function calculateNextReview(card: Card, rating: ReviewRating): SRSResult
```

The IPC handler for `cards:review` loads the card, calls `calculateNextReview`,
updates the card scheduling fields, and writes an immutable `review_log` row.

### 2.4 `ai.ts` — AI Service

**Responsibility:** AI provider calls for grammar explanation, context translation, and examples.

```typescript
class AIService {
  private provider: 'anthropic' | 'openai';
  
  async explainGrammar(
    sentence: string, 
    targetWord: string, 
    language: Language
  ): AsyncIterable<string>  // streaming
  
  async translateWithContext(
    sentence: string, 
    targetLanguage: string
  ): AsyncIterable<string>  // streaming
  
  async generateExamples(
    word: string, 
    language: Language,
    count: number
  ): AsyncIterable<string>  // streaming
  
  initialize(provider: AIProvider, anthropicKey: string, openAIKey: string): void
  testKey(key: string, provider: AIProvider): Promise<boolean>
  hasApiKey(): boolean

  async evaluateDrillAnswer(
    input: DrillEvaluationInput
  ): Promise<DrillEvaluation>  // non-streaming, structured
}
```

### 2.5 `patterns.ts` / Pattern Drill Service (planned)

**Responsibility:** Manage mined patterns, generated drill prompts, user
production attempts, and AI feedback persistence.

```typescript
class PatternService {
  createPattern(draft: PatternDraft): Pattern
  updatePattern(id: number, updates: PatternUpdate): void
  listPatterns(filters?: PatternFilters): Pattern[]
  getPattern(id: number): Pattern | null

  createPrompt(patternId: number, type: DrillType): DrillPrompt
  evaluateAttempt(input: DrillEvaluationInput): Promise<DrillEvaluation>
  saveAttempt(draft: DrillAttemptDraft): DrillAttempt
  createReviewCardFromAttempt(attemptId: number, deckId: number): Card
}
```

Pattern Drill is intentionally separate from `srs.ts`. SRS schedules cards and
review events; Pattern Drill owns active production attempts and corrections.

```
Reader selection
  -> Mine as Pattern
  -> PatternService.createPattern
  -> DrillSession prompt
  -> AIService.evaluateDrillAnswer
  -> PatternService.saveAttempt
  -> optional cards:create from attempt
```

**Grammar Explain System Prompt:**
```
You are a language teacher assistant. Analyze the grammar of the provided sentence.
For each grammatical element, explain:
1. The element (word/phrase)
2. Its grammatical function
3. Why it takes this form

Be concise. Use bullet points. Target intermediate learners.
Language: {language}
```

### 2.6 `audio.ts` — Audio Service

```typescript
class AudioService {
  private cacheDir: string;
  
  async getAudio(
    word: string, 
    lang: Language, 
    reading?: string
  ): Promise<AudioResult>
  
  private async fetchForvo(word: string, lang: Language): Promise<Buffer | null>
  private generateTTS(word: string, lang: Language): Promise<Buffer>
  private getCachedPath(word: string, lang: Language): string
  private saveToCacheDir(filename: string, data: Buffer): string
}

interface AudioResult {
  filename: string;   // served through lexis-audio://
  source: 'forvo' | 'tts' | 'cache';
}
```

### 2.7 `parsers/srt.ts`

```typescript
interface SubtitleEntry {
  index: number;
  startTime: number;  // milliseconds
  endTime: number;
  text: string;       // plain text, tags stripped
  rawText: string;    // original with tags
}

function parseSRT(content: string): SubtitleEntry[]
function parseASS(content: string): SubtitleEntry[]
function stripTags(text: string): string  // remove <i>, <b>, ASS override tags
```

### 2.8 `parsers/epub.ts`

```typescript
interface EPUBChapter {
  id: string;
  title: string;
  order: number;
  htmlContent: string;  // sanitized HTML
  textContent: string;  // plain text for search/mining
}

interface EPUBBook {
  title: string;
  author: string;
  language: string;
  chapters: EPUBChapter[];
  coverImage?: string;  // base64 data URL
}

async function parseEPUB(filePath: string): Promise<EPUBBook>
```

---

## 3. Renderer Process — React Architecture

### 3.1 Component Tree

```
App
├── TitleBar (custom, frameless window)
├── Sidebar
│   ├── MediaLibrary
│   │   └── MediaItem (list)
│   └── NavigationLinks (Reader, Stats, Settings)
├── MainContent
│   ├── ReaderView
│   │   ├── ReaderPanel
│   │   │   ├── SentenceRow (×N)
│   │   │   │   └── WordToken (×N, clickable)
│   │   │   └── EPUBChapterNav
│   │   └── LookupPanel
│   │       ├── DefinitionCard (×N)
│   │       ├── AudioButton
│   │       └── AIPanel (collapsible)
│   ├── CardBuilderModal (overlay)
│   │   ├── CardPreview (front/back toggle)
│   │   ├── FieldEditor (front)
│   │   ├── FieldEditor (back)
│   │   └── TagEditor
│   ├── StatsView
│   │   ├── StreakCard
│   │   ├── DailyChart
│   │   └── RecentlyMined
│   ├── ReviewSession
│   │   ├── ReviewCard
│   │   └── RatingButtons
│   ├── DeckBrowser
│   │   ├── CardTable
│   │   └── CardEditModal
│   └── SettingsView
│       ├── AISettings
│       ├── APIKeySettings
│       └── DictionarySettings
└── StatusBar
    ├── SourceStatus
    └── MiningStatsBadge
```

### 3.2 Zustand Store Design

```typescript
// readerStore.ts
interface ReaderStore {
  currentSource: MediaSource | null;
  sentences: Sentence[];
  selectedSentence: Sentence | null;
  selectedWord: string | null;
  
  setSource: (source: MediaSource) => void;
  setSentences: (sentences: Sentence[]) => void;
  selectSentence: (sentence: Sentence) => void;
  selectWord: (word: string) => void;
  clearSelection: () => void;
}

// lookupStore.ts
interface LookupStore {
  results: DictEntry[];
  isLoading: boolean;
  currentWord: string | null;
  currentLang: Language | null;
  audioStatus: 'idle' | 'loading' | 'playing' | 'error';
  
  lookup: (word: string, lang: Language) => Promise<void>;
  playAudio: () => Promise<void>;
  clearLookup: () => void;
}

// cardStore.ts
interface CardStore {
  draftCard: DraftCard | null;
  decks: Deck[];
  selectedDeckId: number;
  isSending: boolean;
  
  openBuilder: (sentence: Sentence, lookupResult: DictEntry) => void;
  updateDraftField: (field: 'front' | 'back', value: string) => void;
  addTag: (tag: string) => void;
  removeTag: (tag: string) => void;
  saveCard: () => Promise<void>;
  cancelCard: () => void;
}

// settingsStore.ts (persisted via electron-store)
interface SettingsStore {
  aiProvider: 'anthropic' | 'openai';
  anthropicApiKey: string;
  openaiApiKey: string;
  forvoApiKey: string;
  defaultDeckId: number;
  readerFontSize: number;
  theme: 'light' | 'dark' | 'system';
  
  updateSetting: <K extends keyof SettingsStore>(key: K, value: SettingsStore[K]) => void;
}
```

### 3.3 Layout Design

Main layout is a three-column split:

```
┌─────────────────────────────────────────────────────────────┐
│  [←] Lexis                          Due today: 12 cards     │  ← TitleBar (32px)
├───────────────┬────────────────────────┬────────────────────┤
│               │                        │                    │
│  Media        │  Reader Panel          │  Lookup Panel      │
│  Library      │                        │                    │
│  (200px)      │  Sentence list or      │  Word definition   │
│               │  EPUB text             │  Audio button      │
│  [+] Import   │                        │  AI panel          │
│               │                        │                    │
│  Recent:      │  Selected sentence     │  [Shift+A] Mine    │
│  • file1.srt  │  highlighted           │                    │
│  • book.epub  │                        │                    │
│               │  (flex: 1)             │  (320px fixed)     │
├───────────────┴────────────────────────┴────────────────────┤
│  Ready  |  Current source: subtitles  |  Mined today: 12    │  ← StatusBar (28px)
└─────────────────────────────────────────────────────────────┘
```

---

## 4. IPC Channel Design

All IPC channels follow the naming convention: `{service}:{action}`

Channels are defined in `electron/preload.ts` and all go through `ipcRenderer.invoke` (request/response pattern). No fire-and-forget channels except for streaming AI responses (which use `ipcRenderer.on`).

See `docs/API_CONTRACTS.md` for the complete channel list and TypeScript interfaces.

---

## 5. Database Architecture

See `docs/DATA_MODEL.md` for complete schema, indexes, and migration scripts.

### Database Files

| File | Mode | Purpose |
|------|------|---------|
| `{userData}/lexis.db` | Read-Write, WAL | User data |
| `{userData}/jmdict.db` | Read-Only | Japanese dictionary |
| `{userData}/cedict.db` | Read-Only | Chinese dictionary |
| `{userData}/wordnet.db` | Read-Only | English dictionary |

### Migration Strategy

- Migrations are embedded in `electron/services/db.class.ts` to avoid packaged path issues.
- `db.class.ts` runs all pending migrations at startup using a `schema_version` table.
- Never modify a migration that has been shipped — always add a new one.

---

## 6. Security Model

### contextBridge Whitelist

The preload script exposes ONLY the following namespaces via `contextBridge.exposeInMainWorld('lexis', {...})`:

- `lexis.media` — import, list, delete media sources
- `lexis.reader` — load sentences/chapters for display
- `lexis.dictionary` — lookup words
- `lexis.audio` — get audio for word
- `lexis.decks` — local deck management
- `lexis.cards` — local card creation, duplicate checks, review scheduling
- `lexis.ai` — grammar explain, translate (streaming)
- `lexis.stats` — mining stats
- `lexis.settings` — get/set user preferences

**No direct Node.js, no `require`, no file system access from renderer.**

### Content Security Policy

```html
<!-- In index.html -->
<meta http-equiv="Content-Security-Policy" 
      content="default-src 'self'; 
               script-src 'self'; 
               style-src 'self' 'unsafe-inline';
               img-src 'self' data: blob:;
               font-src 'self' data:;
               connect-src 'none'">
```

All external HTTP requests (Forvo, Anthropic, OpenAI) happen in the main process — the renderer never makes direct HTTP calls.

---

## 7. Build & Packaging

### electron-builder Configuration (`electron-builder.yml`)

```yaml
appId: com.lexis.app
productName: Lexis
directories:
  output: dist
  buildResources: buildResources

files:
  - "!**/__tests__/**"
  - "!**/*.test.ts"
  - "!docs/**"
  - "!scripts/**"

extraResources:
  - from: assets/dicts/
    to: dicts/
    filter: ["*.db"]

win:
  target: nsis
  icon: buildResources/icon.ico

mac:
  target: dmg
  icon: buildResources/icon.icns
  hardenedRuntime: true
  entitlements: buildResources/entitlements.plist

linux:
  target: AppImage
  icon: buildResources/icons/

nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
```

### Dictionary Build Script (`scripts/build-dict.ts`)

Run once before packaging. Downloads JMdict XML, CEDICT, and WordNet, converts them to SQLite databases, and saves them to `assets/dicts/`.

```bash
npm run build:dicts
# Output: assets/dicts/jmdict.db, cedict.db, wordnet.db
```

---

## 8. Error Handling Strategy

### Main Process Errors
- Wrap all service methods in try/catch
- Log errors with `electron-log` to `{userData}/logs/main.log`
- Return `{ data: null, error: errorMessage }` via IPC — never throw across IPC boundary

### Renderer Process Errors
- React Error Boundary at the component level for each major panel
- Show inline error states (not modals) for recoverable errors
- Show full-screen error + "Reload app" button for unrecoverable errors

### Local SRS/Card Errors
- Missing deck/card: return a clear IPC error and show an inline user-facing message.
- Duplicate card: warn before creation, but allow the user to continue when appropriate.
- Review update failure: leave the existing card unchanged and do not write a partial review log.

---

*End of Architecture v1.0*
