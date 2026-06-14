# IPC API Contracts
# File: docs/API_CONTRACTS.md

This document defines the complete `window.lexis` API exposed via Electron's contextBridge.
Every function in this interface must be implemented in `electron/preload.ts` and handled
in `electron/main.ts`.

All functions return `Promise<IPCResult<T>>` — never throw, always return `{ data, error }`.

---

## TypeScript Interface (Full)

```typescript
// The complete type for window.lexis
// Defined in: src/types/index.ts (shared between main and renderer)
// Implemented in: electron/preload.ts

interface LexisAPI {
  media: MediaAPI;
  reader: ReaderAPI;
  dictionary: DictionaryAPI;
  audio: AudioAPI;
  anki: AnkiAPI;
  cards: CardsAPI;
  ai: AIAPI;
  stats: StatsAPI;
  settings: SettingsAPI;
}

declare global {
  interface Window {
    lexis: LexisAPI;
  }
}
```

---

## `window.lexis.media` — Media Source Management

```typescript
interface MediaAPI {
  /**
   * Open system file picker for subtitle or EPUB import.
   * Returns the parsed media source after successful import.
   */
  importFile(type: 'subtitle' | 'epub'): Promise<IPCResult<MediaSource>>;

  /**
   * Import a web article from URL.
   * Uses Readability.js to extract main content.
   */
  importUrl(url: string, language: Language): Promise<IPCResult<MediaSource>>;

  /**
   * Get all media sources (sorted by last_opened DESC).
   */
  list(): Promise<IPCResult<MediaSource[]>>;

  /**
   * Delete a media source and all its sentences/progress.
   * Cards already synced to Anki are NOT deleted from Anki.
   */
  delete(sourceId: number): Promise<IPCResult<void>>;

  /**
   * Update last_opened timestamp for a source.
   */
  markOpened(sourceId: number): Promise<IPCResult<void>>;
}
```

### IPC Channel: `media:import-file`
**Main handler behavior:**
1. Open `dialog.showOpenDialog` with appropriate filters
2. Read file content
3. Parse based on file extension (`.srt` → `parseSRT`, `.ass` → `parseASS`, `.epub` → `parseEPUB`)
4. Insert into `media_sources` table
5. Batch-insert parsed sentences into `sentences` table
6. Return `MediaSource`

---

## `window.lexis.reader` — Content Loading for Display

```typescript
interface ReaderAPI {
  /**
   * Load all sentences for a subtitle source.
   * Returns sentences in position order.
   */
  loadSubtitleSentences(sourceId: number): Promise<IPCResult<Sentence[]>>;

  /**
   * Load EPUB chapter list (metadata only, no content).
   */
  loadEPUBChapters(sourceId: number): Promise<IPCResult<EPUBChapter[]>>;

  /**
   * Load the HTML content of a specific EPUB chapter.
   * HTML is sanitized (DOMPurify equivalent in main process).
   */
  loadEPUBChapter(sourceId: number, chapterId: string): Promise<IPCResult<string>>;

  /**
   * Save reading progress for a source.
   */
  saveProgress(sourceId: number, position: number, chapterId?: string): Promise<IPCResult<void>>;

  /**
   * Get saved reading progress for a source.
   */
  getProgress(sourceId: number): Promise<IPCResult<ReadingProgress | null>>;

  /**
   * Get set of already-mined words for a source (for visual highlighting).
   * Returns a Set of word strings.
   */
  getMinedWordsForSource(sourceId: number): Promise<IPCResult<string[]>>;
}

interface EPUBChapter {
  id: string;
  title: string;
  order: number;
}

interface ReadingProgress {
  sourceId: number;
  position: number;
  chapterId?: string;
  updatedAt: string;
}
```

---

## `window.lexis.dictionary` — Word Lookup

```typescript
interface DictionaryAPI {
  /**
   * Look up a word in the appropriate dictionary.
   * Automatically selects dictionary based on language.
   * Uses cache → FTS5 DB pipeline (see ARCHITECTURE.md §2.2).
   */
  lookup(word: string, language: Language): Promise<IPCResult<DictEntry[]>>;

  /**
   * Tokenize text into individual words/morphemes.
   * Uses kuromoji for Japanese, jieba for Chinese, simple split for others.
   * Returns array of tokens with their dictionary forms.
   */
  tokenize(text: string, language: Language): Promise<IPCResult<Token[]>>;

  /**
   * Suggest completions for a partial word (for search).
   * Returns up to 10 suggestions.
   */
  autocomplete(prefix: string, language: Language): Promise<IPCResult<string[]>>;
}

interface Token {
  surface: string;      // original form as it appears in text
  dictionaryForm: string; // base/dictionary form
  reading?: string;     // pronunciation
  partOfSpeech?: string;
  offset: number;       // character offset in original string
}
```

### IPC Channel: `dictionary:lookup`
**Main handler behavior:**
1. Check in-memory LRU cache
2. If miss, check `dict_cache` SQLite table
3. If miss, query appropriate FTS5 dictionary DB
4. Store result in both caches
5. Return `DictEntry[]`

**Performance contract:** Must complete within 150ms for local lookups.

---

## `window.lexis.audio` — Pronunciation Audio

```typescript
interface AudioAPI {
  /**
   * Get audio for a word. Returns a local file path.
   * Checks cache first, then fetches from Forvo, falls back to TTS.
   * The returned path can be used in an HTML <audio> element.
   * 
   * Note: Renderer loads audio via a custom protocol registered in main:
   * lexis-audio://filename.mp3 → serves file from audio-cache directory
   */
  getAudioPath(
    word: string, 
    language: Language, 
    reading?: string
  ): Promise<IPCResult<AudioResult>>;
}

interface AudioResult {
  // Use with: <audio src={`lexis-audio://${filename}`} />
  filename: string;
  source: 'forvo' | 'tts' | 'cache';
}
```

**Custom Protocol:** Register `lexis-audio://` in main process:
```typescript
protocol.registerFileProtocol('lexis-audio', (request, callback) => {
  const filename = request.url.replace('lexis-audio://', '');
  callback({ path: path.join(audioCacheDir, filename) });
});
```

---

## `window.lexis.anki` — AnkiConnect Integration

```typescript
interface AnkiAPI {
  /**
   * Check if AnkiConnect is reachable.
   * Should be called on interval (every 10s) to maintain status indicator.
   */
  checkConnection(): Promise<IPCResult<boolean>>;

  /**
   * Get all deck names from Anki.
   */
  getDeckNames(): Promise<IPCResult<string[]>>;

  /**
   * Add a single note to Anki.
   * Returns the Anki note ID.
   */
  addNote(card: Card): Promise<IPCResult<number>>;

  /**
   * Check if a note with this word already exists in the specified deck.
   * Returns array of matching note IDs (empty = no duplicate).
   */
  findDuplicates(word: string, deckName: string): Promise<IPCResult<number[]>>;

  /**
   * Sync all pending cards from the local queue to Anki.
   * Called automatically when connection is restored.
   * Returns count of successfully synced cards.
   */
  syncQueue(): Promise<IPCResult<{ synced: number; failed: number }>>;

  /**
   * Get count of pending (unsynced) cards in queue.
   */
  getPendingCount(): Promise<IPCResult<number>>;
}
```

### IPC Channel: `anki:add-note`
**Main handler behavior:**
1. If AnkiConnect unreachable → save to `cards_queue` (synced=false) → return success with note: "queued"
2. If audio exists → call `storeMediaFile` to upload audio to Anki media folder
3. Call `addNote` on AnkiConnect
4. On success → insert into `mined_words` with `anki_note_id`, update `cards_queue` synced=true
5. On failure → save to queue → return with error message

---

## `window.lexis.cards` — Card Queue Management

```typescript
interface CardsAPI {
  /**
   * Get all pending (unsynced) cards.
   */
  getPendingCards(): Promise<IPCResult<Card[]>>;

  /**
   * Get all cards (for history view), paginated.
   */
  getCards(page: number, pageSize: number): Promise<IPCResult<{
    cards: Card[];
    total: number;
  }>>;

  /**
   * Delete a pending card from the queue (without syncing).
   */
  deleteCard(cardId: number): Promise<IPCResult<void>>;
}
```

---

## `window.lexis.ai` — AI Features (Streaming)

AI responses stream via IPC events, not standard invoke/result.

```typescript
interface AIAPI {
  /**
   * Check if an Anthropic API key is configured.
   */
  hasApiKey(): Promise<IPCResult<boolean>>;

  /**
   * Start a grammar explanation stream.
   * Returns a streamId. Listen on 'ai:stream-chunk' and 'ai:stream-done' events.
   */
  explainGrammar(
    sentence: string, 
    targetWord: string, 
    language: Language
  ): Promise<IPCResult<{ streamId: string }>>;

  /**
   * Start a context translation stream.
   */
  translateWithContext(
    sentence: string,
    targetLanguage: string
  ): Promise<IPCResult<{ streamId: string }>>;

  /**
   * Generate example sentences for a word.
   */
  generateExamples(
    word: string,
    language: Language,
    count?: number
  ): Promise<IPCResult<{ streamId: string }>>;

  /**
   * Cancel an active stream.
   */
  cancelStream(streamId: string): Promise<IPCResult<void>>;

  // Event listeners (set up in preload via ipcRenderer.on)
  onStreamChunk(callback: (streamId: string, chunk: string) => void): void;
  onStreamDone(callback: (streamId: string) => void): void;
  onStreamError(callback: (streamId: string, error: string) => void): void;
  removeStreamListeners(): void;
}
```

### Streaming Implementation Pattern

**Main process (main.ts):**
```typescript
ipcMain.handle('ai:explain-grammar', async (event, sentence, word, lang) => {
  const streamId = crypto.randomUUID();
  
  // Start streaming in background
  (async () => {
    try {
      const stream = await aiService.explainGrammar(sentence, word, lang);
      for await (const chunk of stream) {
        event.sender.send('ai:stream-chunk', streamId, chunk);
      }
      event.sender.send('ai:stream-done', streamId);
    } catch (err) {
      event.sender.send('ai:stream-error', streamId, err.message);
    }
  })();
  
  return { data: { streamId }, error: null };
});
```

**Renderer hook (`useAIStream.ts`):**
```typescript
function useAIStream() {
  const [text, setText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);

  const startStream = useCallback(async (
    action: 'explainGrammar' | 'translate' | 'examples',
    ...args: unknown[]
  ) => {
    setText('');
    setIsStreaming(true);
    
    const result = await window.lexis.ai[action](...args);
    if (result.error) { setIsStreaming(false); return; }
    
    const { streamId } = result.data!;
    
    window.lexis.ai.onStreamChunk((id, chunk) => {
      if (id === streamId) setText(prev => prev + chunk);
    });
    window.lexis.ai.onStreamDone((id) => {
      if (id === streamId) setIsStreaming(false);
    });
    
    return () => window.lexis.ai.removeStreamListeners();
  }, []);

  return { text, isStreaming, startStream };
}
```

---

## `window.lexis.stats` — Mining Statistics

```typescript
interface StatsAPI {
  /**
   * Get overall mining statistics for the stats dashboard.
   */
  getMiningStats(): Promise<IPCResult<MiningStats>>;

  /**
   * Get mining history for the last N days.
   */
  getDailyHistory(days: number): Promise<IPCResult<DayStat[]>>;
}

interface MiningStats {
  totalMined: number;
  minedToday: number;
  currentStreak: number;    // consecutive days with at least 1 mined word
  longestStreak: number;
  byLanguage: Record<string, number>;
  recentWords: MinedWord[];  // last 10 mined words
  dailyHistory: DayStat[];   // last 30 days
}
```

---

## `window.lexis.settings` — User Preferences

```typescript
interface SettingsAPI {
  /**
   * Get all user settings.
   */
  get(): Promise<IPCResult<UserSettings>>;

  /**
   * Update one or more settings.
   */
  set(updates: Partial<UserSettings>): Promise<IPCResult<void>>;

  /**
   * Test Anthropic API key validity.
   * Makes a minimal API call to verify the key.
   */
  testAnthropicKey(apiKey: string): Promise<IPCResult<boolean>>;

  /**
   * Open OS file picker to select a directory.
   * Used for settings like custom audio cache location.
   */
  selectDirectory(): Promise<IPCResult<string | null>>;
}

interface UserSettings {
  // Anki
  ankiConnectUrl: string;           // default: "http://localhost:8765"
  defaultDeckByLanguage: Record<Language, string>;
  defaultCardTemplate: 'Basic' | 'Cloze';

  // APIs
  anthropicApiKey: string;          // stored encrypted in OS keychain
  forvoApiKey: string;

  // Reader
  readerFontSize: number;           // 12-24, default 16
  readerLineHeight: number;         // 1.4-2.2, default 1.6
  readerFont: string;               // font family name

  // App
  theme: 'light' | 'dark' | 'system';
  language: string;                 // UI language (en, ja, zh, etc.)
  checkForUpdates: boolean;
}
```

---

## IPC Channel Reference Table

| Channel | Direction | Handler | Description |
|---------|-----------|---------|-------------|
| `media:import-file` | Renderer→Main | main.ts | Open file dialog + parse |
| `media:import-url` | Renderer→Main | main.ts | Fetch + extract web article |
| `media:list` | Renderer→Main | db.ts | Get all media sources |
| `media:delete` | Renderer→Main | db.ts | Delete source + cascade |
| `media:mark-opened` | Renderer→Main | db.ts | Update last_opened |
| `reader:load-subtitle` | Renderer→Main | db.ts | Load sentences for source |
| `reader:load-epub-chapters` | Renderer→Main | db.ts | Load chapter list |
| `reader:load-epub-chapter` | Renderer→Main | epub.ts | Load chapter HTML |
| `reader:save-progress` | Renderer→Main | db.ts | Save reading position |
| `reader:get-progress` | Renderer→Main | db.ts | Get reading position |
| `reader:mined-words` | Renderer→Main | db.ts | Get mined words for source |
| `dictionary:lookup` | Renderer→Main | dictionary.ts | Look up word |
| `dictionary:tokenize` | Renderer→Main | dictionary.ts | Tokenize text |
| `dictionary:autocomplete` | Renderer→Main | dictionary.ts | Word prefix search |
| `audio:get-path` | Renderer→Main | audio.ts | Get/fetch audio file |
| `anki:check-connection` | Renderer→Main | anki.ts | Ping AnkiConnect |
| `anki:get-decks` | Renderer→Main | anki.ts | Get deck list |
| `anki:add-note` | Renderer→Main | anki.ts | Add note (or queue) |
| `anki:find-duplicates` | Renderer→Main | anki.ts | Check for existing notes |
| `anki:sync-queue` | Renderer→Main | anki.ts | Drain pending queue |
| `anki:pending-count` | Renderer→Main | anki.ts | Count queued cards |
| `cards:get-pending` | Renderer→Main | db.ts | List pending cards |
| `cards:get-all` | Renderer→Main | db.ts | Paginated card history |
| `cards:delete` | Renderer→Main | db.ts | Delete pending card |
| `ai:explain-grammar` | Renderer→Main | ai.ts | Start grammar stream |
| `ai:translate` | Renderer→Main | ai.ts | Start translation stream |
| `ai:examples` | Renderer→Main | ai.ts | Start examples stream |
| `ai:cancel-stream` | Renderer→Main | ai.ts | Cancel active stream |
| `ai:stream-chunk` | Main→Renderer | N/A | Streaming chunk event |
| `ai:stream-done` | Main→Renderer | N/A | Stream complete event |
| `ai:stream-error` | Main→Renderer | N/A | Stream error event |
| `stats:get-mining` | Renderer→Main | db.ts | Get mining stats |
| `stats:daily-history` | Renderer→Main | db.ts | Get daily counts |
| `settings:get` | Renderer→Main | settings.ts | Get all settings |
| `settings:set` | Renderer→Main | settings.ts | Update settings |
| `settings:test-key` | Renderer→Main | ai.ts | Test API key |
| `settings:select-dir` | Renderer→Main | main.ts | Open dir picker |

---

*End of API Contracts v1.0*
