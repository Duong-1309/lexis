# Implementation Plan — Lexis v2

`docs/IMPLEMENTATION_PLAN.md`

> **v2 direction**: Built-in SRS flashcard system (Anki-style) instead of AnkiConnect.
> No external Anki dependency. Cards are created, scheduled, and reviewed entirely inside Lexis.

---

## How to Use This Document

Each sprint has a **Goal**, ordered **Tasks**, and **Acceptance tests**.
Do NOT start the next sprint until all acceptance tests for the current sprint pass.

---

## Sprint 1 — Foundation ✅ DONE

**Delivered:**

- Electron + React + TypeScript + electron-vite scaffold
- SQLite DB at `{userData}/lexis.db` (WAL mode, migration system)
- SRT and ASS/SSA parsers (20 unit tests passing)
- Import modal with drag-and-drop + native file picker
- 3-column layout: Sidebar | ReaderPanel | Lookup placeholder
- StatusBar

---

## Sprint 2 — Dictionary + Tokenizer ✅ DONE

### Sprint 2 Goal

Click any word in a subtitle sentence → LookupPanel shows definition, reading, and examples.
Japanese words show hiragana + JLPT level. Chinese words show pinyin + HSK level.

**Delivered (includes English extension beyond original plan):**

- `scripts/build-dict.ts` — downloads and builds JMdict (ja), CEDICT (zh), WordNet 3.1 (en) into SQLite
  - JMdict: 217,516 entries, FTS5 trigram, DTD-stripped XML parse
  - CEDICT: 125,010 entries, FTS5, pinyin normalization
  - WordNet 3.1: 147,478 entries + 4,827 exception morphology forms, FTS5 trigram
  - Run: `npm run build:dicts` (all) or `npm run build:dicts en` (English only)
- `electron/services/dictionary.ts` — DictionaryService with LRU-500 cache:
  - `lookupJMdict`, `lookupCEDICT`, `lookupWordNet` (exact → exceptions table → suffix lemmatizer → FTS)
  - `lemmatizeEnglish` — suffix rules: ies/ves/es/s/ied/ing/ed/er/est
  - `tokenizeJapanese` (kuromoji, lazy-loaded), `tokenizeChinese` (CJK boundary split), `tokenizeSimple` (EN/FR/ES with contraction support)
  - IPC: `dictionary:lookup`, `dictionary:tokenize`, `dictionary:autocomplete`
- `electron/services/audio.ts` — AudioService, `lexis-audio://` protocol
- `src/components/Lookup/LookupPanel.tsx` + `AudioButton.tsx`
- `src/store/lookupStore.ts` (Zustand)
- `src/components/Reader/SentenceRow.tsx` — tokenize on select, word-click handler
- `src/components/ImportModal.tsx` — language selector (en/ja/zh/ko/fr/es), drag-drop + file picker
- 23 unit tests in `electron/__tests__/dictionary.test.ts`

**Key implementation notes:**

- `build-dict.ts` uses `node:sqlite` (built-in, no ABI issues); runtime service uses `better-sqlite3` (Electron ABI)
- Electron env var: `ELECTRON_RENDERER_URL` (not `VITE_DEV_SERVER_URL`) for dev server URL
- Dev script: `env -u ELECTRON_RUN_AS_NODE electron-vite dev` (unset breaks Electron API)
- `postinstall`: `electron-rebuild -f -w better-sqlite3` (required after npm install)

### Sprint 2 Tasks

#### Task 2.1 — Dictionary Build Script

Create `scripts/build-dict.ts`:

```typescript
// Downloads and converts JMdict + CEDICT to SQLite FTS5 format
// Run once: npm run build:dicts

async function buildJMdict(outputPath: string): Promise<void>
// 1. Download JMdict.gz from edrdg.org
// 2. Parse XML with fast-xml-parser
// 3. Insert into SQLite with FTS5 trigram tokenizer

async function buildCEDICT(outputPath: string): Promise<void>
// 1. Download CC-CEDICT.gz from mdbg.net
// 2. Parse line format: traditional simplified [pinyin] /def1/def2/
// 3. Insert into SQLite
```

Schema: see `docs/DATA_MODEL.md` → Dictionary Database Schema.

#### Task 2.2 — Dictionary Service

Create `electron/services/dictionary.ts`:

```typescript
class DictionaryService {
  openDictionary(lang: Language, dbPath: string): void
  lookup(word: string, lang: Language): DictEntry[]
  tokenize(text: string, lang: Language): Token[]
  autocomplete(prefix: string, lang: Language): string[]
}
```

- Japanese tokenizer: `kuromoji` npm package (`npm install kuromoji @types/kuromoji`)
- Chinese: simple space/character split (jieba optional)
- Cache results in `dict_cache` table (TTL 30 days)

#### Task 2.3 — IPC Handlers

Add to `electron/main.ts`:

```typescript
ipcMain.handle('dictionary:lookup', (_, word, lang) =>
  wrapResult(() => dictService.lookup(word, lang)))
ipcMain.handle('dictionary:tokenize', (_, text, lang) =>
  wrapResult(() => dictService.tokenize(text, lang)))
ipcMain.handle('dictionary:autocomplete', (_, prefix, lang) =>
  wrapResult(() => dictService.autocomplete(prefix, lang)))
```

#### Task 2.4 — Audio Service

Create `electron/services/audio.ts`:

```typescript
class AudioService {
  initialize(userDataPath: string): void  // creates audio-cache/ dir
  async getAudio(word: string, lang: Language, reading?: string): Promise<AudioResult>
}
```

- Try Forvo API first (if key configured)
- Fall back to Web Speech TTS via renderer
- Cache audio files in `{userData}/audio-cache/`
- Register `lexis-audio://` protocol in main.ts for serving cached files

#### Task 2.5 — Word Tokenization in Reader

Update `SentenceRow.tsx`:

- When sentence is selected → call `window.lexis.dictionary.tokenize(content, lang)`
- Render each token as a `<span>` with click handler
- Click token → update `lookupStore` → trigger lookup

Create `src/hooks/useWordSelection.ts` for click + text-selection handling.

#### Task 2.6 — LookupPanel

Create `src/components/Lookup/LookupPanel.tsx`:

- Word + readings header (furigana / pinyin)
- JLPT/HSK badge
- Senses list grouped by part-of-speech
- Example sentences (collapsible)
- AudioButton
- "Add to deck →" button (wired in Sprint 3)

Create `src/components/Lookup/AudioButton.tsx`.
Create `src/store/lookupStore.ts` (Zustand).

#### Task 2.7 — Tests

```typescript
// dictionary.test.ts
// - lookup("食べる") → entry with reading "たべる"
// - lookup("吃饭")  → CEDICT entry with pinyin
// - lookup nonexistent → []
// - tokenize("東京に行く") → correct tokens
// - cache hit on second lookup
```

### Sprint 2 Acceptance Tests

- [ ] Click word in sentence → LookupPanel shows definition
- [ ] Japanese: shows hiragana reading + JLPT level badge
- [ ] Chinese: shows pinyin
- [ ] Audio button plays pronunciation
- [ ] Lookup < 150ms (console.time check)
- [ ] All dictionary unit tests pass

---

## Sprint 3 — SRS Flashcard Core

### Sprint 3 Goal

Complete mining workflow: look up word → press **A** → Card Builder opens pre-filled →
confirm → card saved to deck with SM-2 scheduling.

### Sprint 3 Tasks

#### Task 3.1 — DB Migration 002

Add migration v2 to `db.class.ts` `MIGRATIONS` array:

Tables: `decks`, `cards`, `review_log` — full schema in `docs/DATA_MODEL.md`.

Insert default deck on migration: `INSERT INTO decks (name) VALUES ('Default')`.

#### Task 3.2 — SRS Engine

Create `electron/services/srs.ts`:

```typescript
export interface SRSResult {
  interval: number       // days
  easeFactor: number
  reps: number
  lapses: number
  cardState: CardState
  dueDate: string        // YYYY-MM-DD
}

export function calculateNextReview(card: Card, rating: ReviewRating): SRSResult
```

SM-2 algorithm — see `docs/DATA_MODEL.md` → SM-2 Algorithm section.

Write unit tests in `__tests__/srs.test.ts`:

- Rating 1 (Again) → interval = 1, reps reset, lapses +1
- Rating 3 (Good) first review → interval = 1
- Rating 3 (Good) second review → interval = 6
- Rating 3 (Good) third review → interval ≈ prev × ease_factor
- Rating 4 (Easy) → extra interval bonus
- ease_factor never drops below 1.3

#### Task 3.3 — Deck + Card DB Methods

Add to `DatabaseService`:

```typescript
// Decks
createDeck(name: string, description?: string): Deck
getDecks(): Deck[]           // with due/new counts
getDeckById(id: number): Deck | null
renameDeck(id: number, name: string): void
deleteDeck(id: number): void

// Cards
insertCard(draft: DraftCard): Card
getCard(id: number): Card | null
updateCardSRS(id: number, result: SRSResult): void
getDueCards(deckId: number, limit?: number): Card[]
getAllCards(deckId: number): Card[]
suspendCard(id: number): void
deleteCard(id: number): void
isDuplicate(word: string, language: Language): boolean

// Review log
logReview(entry: Omit<ReviewLog, 'id'>): void
```

#### Task 3.4 — IPC Handlers

Add `decks:*` and `cards:*` handlers to `electron/main.ts` and `electron/preload.ts`:

```typescript
// decks
ipcMain.handle('decks:list',   () => wrapResult(() => db.getDecks()))
ipcMain.handle('decks:create', (_, name, desc) => wrapResult(() => db.createDeck(name, desc)))
ipcMain.handle('decks:rename', (_, id, name)   => wrapResult(() => db.renameDeck(id, name)))
ipcMain.handle('decks:delete', (_, id)          => wrapResult(() => db.deleteDeck(id)))

// cards
ipcMain.handle('cards:due',     (_, deckId) => wrapResult(() => db.getDueCards(deckId)))
ipcMain.handle('cards:all',     (_, deckId) => wrapResult(() => db.getAllCards(deckId)))
ipcMain.handle('cards:create',  (_, draft)  => wrapResult(() => db.insertCard(draft)))
ipcMain.handle('cards:review',  (_, cardId, rating, timeTakenMs) => wrapResult(() => {
  const card = db.getCard(cardId)!
  const result = calculateNextReview(card, rating)
  db.updateCardSRS(cardId, result)
  db.logReview({ cardId, rating, ...result, timeTakenMs })
  return result
}))
ipcMain.handle('cards:suspend', (_, id) => wrapResult(() => db.suspendCard(id)))
ipcMain.handle('cards:delete',  (_, id) => wrapResult(() => db.deleteCard(id)))
ipcMain.handle('cards:is-duplicate', (_, word, lang) =>
  wrapResult(() => db.isDuplicate(word, lang)))
```

#### Task 3.5 — Card Builder UI

Create `src/components/CardBuilder/CardBuilder.tsx`:

- Modal overlay (Escape to close)
- Left panel: editable front/back (textarea with basic HTML)
- Right panel: live preview (flip toggle)
- Deck selector dropdown (loaded from `window.lexis.decks.list()`)
- Tags input (chip-style)
- Template toggle: Basic / Cloze
- Duplicate warning banner if `cards:is-duplicate` returns true
- Bottom bar: Cancel | **Add to Deck** button

Pre-fill logic (called from LookupPanel "Add to deck →" button):

```typescript
front = word (+ reading in brackets if Japanese)
back  = first definition + source sentence (word bolded)
tags  = [language, source title (slugified)]
```

Create `src/store/cardStore.ts` (Zustand — tracks draft card state).

#### Task 3.6 — Hotkey

Create `src/hooks/useHotkeys.ts`:

```typescript
// Shift+A — open CardBuilder with current lookup word
// Escape — close CardBuilder / clear selection
// Space — play audio for current lookup result
```

Register on `window` in `App.tsx`.

### Sprint 3 Acceptance Tests

- [ ] DB migration v2 runs cleanly on first launch after update
- [ ] "Default" deck exists after fresh install
- [ ] Press **A** with a looked-up word → CardBuilder opens pre-filled
- [ ] Duplicate warning appears if word already has a card
- [ ] Click "Add to Deck" → card saved, success toast shown
- [ ] `window.lexis.cards.due(1)` returns the new card on same day
- [ ] All SRS unit tests pass

---

## Sprint 4 — Review Session

### Sprint 4 Goal

User can open a deck → start a review session → flip cards → rate them →
SM-2 schedules next review. Session ends when no more due cards.

### Sprint 4 Tasks

#### Task 4.1 — Review Session Screen

Create `src/components/Review/ReviewSession.tsx`:

Full-screen overlay (above the 3-column layout):

```text
┌─────────────────────────────────────────────┐
│  Deck: Default   [ 12 remaining ]   [✕ End] │
├─────────────────────────────────────────────┤
│                                             │
│         [   FRONT HTML   ]                  │
│                                             │
│         ──────────────────                  │
│              [ Show ]                       │
│                                             │
└─────────────────────────────────────────────┘

After "Show":

│         [   BACK HTML    ]                  │
│                                             │
│  [Again]   [Hard]   [Good]   [Easy]         │
```

State machine: `front-only` → (click Show) → `revealed` → (rate) → next card.

#### Task 4.2 — Card Flip Animation

CSS transition on the card container:

```css
.card-flip {
  transition: transform 0.3s ease;
  transform-style: preserve-3d;
}
.card-flip.flipped {
  transform: rotateY(180deg);
}
```

#### Task 4.3 — Rating Buttons

```typescript
// Rating button labels + keyboard shortcuts
// [Again] key=1   [Hard] key=2   [Good] key=3   [Easy] key=4
// Show estimated next interval below each button:
// Again → 1d  Hard → 3d  Good → 8d  Easy → 12d
```

Call `window.lexis.cards.review(cardId, rating, timeTakenMs)` on click.

Track `timeTakenMs` from when card was shown to when rated.

#### Task 4.4 — Session Summary Screen

After all cards reviewed, show summary:

- Cards reviewed today
- Correct rate (rating ≥ 3 / total)
- Time spent
- Streak update
- "Back to library" button

#### Task 4.5 — Review Entry Point

Add "Review" button in Sidebar (below import button):

- Shows badge with total due count across all decks
- Click → opens deck picker → select deck → starts ReviewSession

Create `src/components/Review/DeckPicker.tsx`:

- List decks with `(due / total)` counts
- Click deck → start session for that deck

#### Task 4.6 — Tests

```typescript
// review-session.test.ts
// - After rating=1, card.interval = 1, card.lapses = 1
// - After rating=3 × 3 reviews, interval grows correctly
// - Session ends when getDueCards returns []
// - review_log entry created for each review
```

### Sprint 4 Acceptance Tests

- [ ] Click "Review" → deck picker → select deck → review session starts
- [ ] Cards with `due_date <= today` appear in session
- [ ] "Show" reveals back side
- [ ] Rating a card advances to next card
- [ ] Card's `due_date` and `interval` updated in DB after rating
- [ ] Session summary shows correct counts
- [ ] Keyboard shortcuts 1/2/3/4 work for rating
- [ ] New cards added in Sprint 3 appear in review session same day

---

## Sprint 5 — AI Features + EPUB

### Sprint 5 Goal

Grammar explanations and context translations via Claude. DRM-free EPUB import.

### Sprint 5 Tasks

#### Task 5.1 — AI Service

Create `electron/services/ai.ts`:

```typescript
class AIService {
  setApiKey(key: string): void
  hasApiKey(): boolean
  async *explainGrammar(sentence, word, lang): AsyncGenerator<string>
  async *translateWithContext(sentence, targetLang): AsyncGenerator<string>
  async *generateExamples(word, lang, count): AsyncGenerator<string>
}
```

Model: `claude-sonnet-4-6`. Streaming via `event.sender.send` IPC push.

#### Task 5.2 — AI Panel in LookupPanel

Create `src/components/Lookup/AIPanel.tsx`:

- "Explain grammar" / "Translate" / "Examples" buttons
- Disabled with tooltip if no API key
- Streaming text with blinking cursor
- "Configure API key in Settings →" link if missing key

#### Task 5.3 — EPUB Parser

Create `electron/services/parsers/epub.ts` using `epubjs`.

- Extract chapter list + HTML content
- Sanitize HTML (strip scripts/styles, keep ruby/em/strong)
- DRM detection: check `META-INF/encryption.xml` → show clear error

Update `ReaderPanel.tsx` to support EPUB mode (render chapter HTML,
intercept clicks for word lookup, handle `<ruby>` tags).

#### Task 5.4 — Settings UI

Create `src/components/Settings/SettingsPage.tsx`:

- API Keys: Anthropic key (with Test button), Forvo key
- Reader: font size slider, line height, font family
- Appearance: theme toggle (light/dark/system)

### Sprint 5 Acceptance Tests

- [ ] Grammar explanation streams character by character
- [ ] Cancelling mid-stream stops generation
- [ ] No API key → buttons disabled with setup prompt
- [ ] DRM-free EPUB imports and renders chapters
- [ ] DRM EPUB shows clear error, does not crash
- [ ] Word lookup works in EPUB same as subtitle reader

---

## Sprint 6 — Deck Browser + Stats + Packaging

### Sprint 6 Goal

Shippable v1.0: browse/manage cards, stats dashboard, packaged app.

### Sprint 6 Tasks

#### Task 6.1 — Deck Browser

Create `src/components/Decks/DeckBrowser.tsx`:

- Table of all cards in a deck (word, state, due date, ease, lapses)
- Search/filter bar
- Bulk actions: suspend, delete
- Edit card modal (edit front/back HTML, tags)
- Export deck as JSON

#### Task 6.2 — Stats Dashboard

Create `src/components/Stats/StatsDashboard.tsx`:

- Summary: cards reviewed today / streak / total cards / retention rate
- Daily bar chart for last 30 days (reviews + new cards, using `recharts`)
- Per-deck breakdown table
- Heatmap calendar (GitHub-style, last 3 months)

#### Task 6.3 — Window Polish

- Window state persistence via `electron-window-state`
- App icon in `buildResources/`
- Onboarding modal on first launch (first-time UX)

#### Task 6.4 — Packaging

Configure `electron-builder.yml` for:

- macOS: `.dmg` (arm64 + x64 universal)
- Windows: NSIS installer
- Linux: AppImage

Verify: `npm run dist` → working installer on current platform.

#### Task 6.5 — E2E Tests

```typescript
// tests/e2e/mining-workflow.spec.ts
// 1. Launch app
// 2. Import sample.srt
// 3. Click a sentence
// 4. Click a word → LookupPanel shows
// 5. Press A → CardBuilder opens
// 6. Click "Add to Deck"
// 7. Open Review session → card appears
// 8. Rate card → session advances
```

### Sprint 6 Acceptance Tests

- [ ] Card browser shows all cards with correct SRS state
- [ ] Editing a card updates front/back correctly
- [ ] Stats reflect actual review history from review_log
- [ ] Streak calculates correctly (no gaps = continues)
- [ ] `npm run dist` produces working installer
- [ ] Installed app loads in < 3 seconds
- [ ] All e2e tests pass

---

## Definition of Done (all sprints)

1. TypeScript compiles with 0 errors (`npm run typecheck`)
2. Unit tests pass (`npm run test`)
3. No `any` types or `// @ts-ignore` (except documented exceptions)
4. All IPC calls use `wrapResult` pattern — never throws across IPC boundary
5. Errors shown to user gracefully — no silent failures, no raw crashes
6. Features work offline (no network = graceful degradation, not broken)

---

End of Implementation Plan v2.0
