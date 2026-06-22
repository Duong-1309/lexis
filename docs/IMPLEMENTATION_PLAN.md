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

## Sprint 6 — Native Language Flow + Rich Cards + SRS Fixes

### Sprint 6 Goal

The full learning loop works correctly for a Vietnamese speaker: look up a Japanese/Chinese/English word → see definition in Vietnamese → create a rich card → review with audio.

### Sprint 6 Status

**Done (2026-06-14):**

- `DeckBrowser.tsx` ✅ — table, search/filter, bulk actions, `CardEditModal`, export JSON
- `StatsDashboard.tsx` ✅ — derived from local `review_log` + `cards`, bar chart, streak
- Stats + DeckBrowser embedded in app layout ✅
- Hotkeys scoped by workflow (Shift+A reader-only, 1–4 review-only) ✅
- DevTools gated to dev mode ✅
- `buildDraft` HTML-escaping + case-insensitive highlight fix ✅

**Remaining (implementation plan below):**

---

### Task 6.A — Migration 003

Add to `db.class.ts` `MIGRATIONS` array (version 3):

```sql
ALTER TABLE cards ADD COLUMN native_definition TEXT;
ALTER TABLE cards ADD COLUMN part_of_speech    TEXT;
ALTER TABLE cards ADD COLUMN level_info        TEXT;   -- JSON: {"jlpt":5}
ALTER TABLE cards ADD COLUMN audio_word        TEXT;
ALTER TABLE cards ADD COLUMN step_index        INTEGER NOT NULL DEFAULT 0;

CREATE TABLE definition_translations (
  word        TEXT NOT NULL,
  target_lang TEXT NOT NULL,
  native_lang TEXT NOT NULL,
  translation TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (word, target_lang, native_lang)
);
```

Add DB methods: `getCachedTranslation(word, targetLang, nativeLang)`, `cacheTranslation(entry)`.

---

### Task 6.B — AI Translation Service

Update `electron/services/ai.ts`:

```typescript
async translateDefinition(
  word: string,
  definition: string,
  targetLang: Language,
  nativeLang: NativeLanguage,
): Promise<string>
```

- Non-streaming (single `messages.create` call, no stream)
- Prompt: _"Translate this {targetLang} dictionary definition to {nativeLang}. Word: {word}. Definition: {definition}. Return only the translation, concise, no extra explanation."_
- Returns the translated string

Add IPC: `ai:translate-definition` in `main.ts` + `preload.ts` + `types/index.ts`:

```typescript
// main.ts
ipcMain.handle('ai:translate-definition', async (_e, word, definition, targetLang, nativeLang) =>
  wrapResult(async () => {
    const cached = db.getCachedTranslation(word, targetLang, nativeLang)
    if (cached) return cached
    const translation = await aiService.translateDefinition(word, definition, targetLang, nativeLang)
    db.cacheTranslation({ word, targetLang, nativeLang, translation })
    return translation
  })
)
```

---

### Task 6.C — Settings: nativeLanguage

Update `electron/services/settings.ts`:

- Add `nativeLanguage: 'vi'` to default settings object
- Update `UserSettings` type in `src/types/index.ts`

---

### Task 6.D — LookupPanel: Vietnamese Definition

Update `src/components/Lookup/LookupPanel.tsx`:

After dict lookup resolves (`results` populated):

1. Read `nativeLanguage` from settings store (or fetch once at mount)
2. If `nativeLanguage !== 'en'` and AI has key:
   - Set `translating = true`
   - Call `window.lexis.ai.translateDefinition(word, englishDef, language, nativeLanguage)`
   - On resolve: set `nativeDefinition` in local state, `translating = false`
3. Display:

   ```text
   ăn, dùng bữa        ← nativeDefinition (large, primary)  [skeleton while loading]
   to eat               ← English original (small, muted)
   JLPT N5 · Verb       ← level + POS badge
   ```

4. If no API key: show English only (no error, silent fallback)

---

### Task 6.E — Rich Card Builder

Update `src/store/cardStore.ts` — `buildDraft`:

Accept new opts: `nativeDefinition`, `partOfSpeech`, `levelInfo`, `audioWord`.

Generate structured card HTML:

```typescript
// Front
`<div class="card-word">${word}${reading ? `【${reading}】` : ''}</div>
 <div class="card-meta">${levelBadge} · ${partOfSpeech}</div>`

// Back
`<div class="card-native-def">${nativeDefinition}</div>
 <div class="card-en-def">${englishDefinition}</div>
 <div class="card-sentence"><em>${highlightedSentence}</em></div>`
```

Pass `nativeDefinition` and dict metadata from `LookupPanel.handleAddToDeck` + `useHotkeys` Shift+A handler.

Update `DraftCard` type to include: `nativeDefinition?`, `partOfSpeech?`, `levelInfo?`, `audioWord?`.

---

### Task 6.F — Audio Button in ReviewSession

Update `src/components/Review/ReviewSession.tsx`:

- When card face shows (front or back), render `<AudioButton word={card.audioWord ?? card.word} language={card.language} />`
- Reuse existing `AudioButton` component from `src/components/Lookup/AudioButton.tsx`
- Position: bottom-right corner of card face
- Keyboard: `P` plays audio during review (add to session hotkeys)

---

### Task 6.G — SM-2 Bug Fixes + Learning Steps

Update `electron/services/srs.ts`:

1. **Fix Hard reps bug**: remove `reps = Math.max(0, reps - 1)` — reps unchanged on Hard
2. **Add relearning**: `rating === 1` sets `step_index = 1` (not full reset to new)
3. **Add fuzz**: `interval = Math.round(interval * (0.95 + Math.random() * 0.10))`
4. **Add learning steps**: check `step_index < 3` before applying daily interval logic:
   - `step_index === 0` or `1` + Good/Easy → advance to next step
   - `step_index === 2` + Good/Easy → `step_index = 3`, `interval = 1`, graduate
5. **Add relearning state**: `card_state = 'learning'` when `step_index < 3`

Update `ReviewSession.tsx`:

- Cards at `step_index < 3` that are rated Good stay in the current session queue at their step delay
- Session tracks these separately from the daily due list

Update unit tests in `electron/__tests__/srs.test.ts`:

- Add tests for learning steps, relearning, fuzz range, Hard reps fix

### Sprint 6 Acceptance Tests

- [ ] Japanese word lookup → Vietnamese definition appears within 2s (or instantly from cache)
- [ ] Same word lookup again → instant (cache hit, no AI call)
- [ ] Press A → Card back shows Vietnamese definition as primary
- [ ] Card front shows JLPT level badge + POS
- [ ] Audio button appears on review card (front and back)
- [ ] P key plays audio during review
- [ ] Hard rating no longer decrements reps
- [ ] Again on a graduated card → enters relearning step (not reset to new)
- [ ] New card → 1min step → 10min step → graduates with interval=1
- [ ] `npm run typecheck` — 0 errors
- [ ] `npm run test` — all pass

### Sprint 6 Runtime Test Plan / Issues to Watch

Use this checklist while testing the app manually. Fix issues as they appear in real use.

- [ ] `Shift+A` creates the same rich card as the Add to Deck button:
  - Vietnamese/native definition is preserved on the card back
  - English definition appears as secondary text
  - POS and JLPT/HSK metadata appear on the card front when available
  - Source sentence and highlighted target word are preserved
  - `audioWord` is saved for review playback
- [ ] Due dates display in the configured timezone:
  - Deck Browser does not show raw UTC timestamps such as `05:xx` for Vietnam users
  - Mined-word tooltip displays `Due now`, minutes, hours, or days correctly
  - Stats/due counts remain consistent with local review expectations
- [ ] Review learning queue feels acceptable:
  - New card Good → returns after the 1-minute learning step
  - Second Good → schedules the 10-minute step
  - Final Good → graduates to interval-based scheduling
  - Waiting screen is not confusing or disruptive during normal review
- [ ] Card editor never exposes raw generated HTML during normal editing:
  - CardBuilder back editor shows readable text, not `<strong>...`
  - Deck Browser edit modal shows readable text, not raw HTML
  - Review still renders styled HTML correctly after editing
- [ ] Settings framework behaves as a stable future config surface:
  - `Scheduling` values save/reload: timezone, learning steps, daily due time, limits
  - `Cards` values save/reload: default template, native definition first, auto-play audio
  - Saved settings are not yet required to change SRS/card behavior until explicitly wired

---

## Sprint 7 — Pattern Drill Foundation

### Sprint 7 Goal

Lexis becomes a Sentence Mining + Pattern Drill app, not just a flashcard/SRS app. Users can mine a sentence as a reusable pattern, create active-production prompts, write their own answer, receive correction, and save the attempt for later review.

### Sprint 7 Status

**Done (2026-06-18):**

- Migration 004 foundation implemented in `electron/services/db.class.ts`
- Shared Pattern/Drill types and `window.lexis.patterns` / `window.lexis.drills` API surface added
- IPC handlers wired for pattern CRUD, drill prompt/attempt persistence, and review-card creation from attempt
- `ai:evaluate-drill-answer` contract wired with structured non-streaming AI evaluation
- PatternBuilder MVP added and LookupPanel can open "Mine Pattern" from current word/sentence context
- Reader subtitle/EPUB selection can feed lookup/pattern mining without layout-shifting inline actions
- PatternBuilder can use the full source sentence or turn the selected Slot Phrase into a `[slot]` with preview
- PatternDrillPanel MVP added: list mined patterns, write a free-production answer, AI-evaluate it, save attempt, and create review card
- Selection flow split: single-word selection uses dictionary/native definition only; phrase/sentence selection uses AI Translate, Explain, and Examples without dictionary word-definition fallback
- Selection flow is language-agnostic for subtitle/EPUB mining: whitespace, multilingual sentence punctuation, full-sentence selection, and long CJK/Hangul selections route to sentence/pattern AI actions
- Pattern duplicate checks run before save using normalized text (case, punctuation, symbols, and whitespace)
- Mined patterns highlight as full sentences in Reader and take priority over word highlights; hover shows pattern tooltip
- Pattern Drill creates default free-production prompts, stores prompt-linked attempts, creates review cards, and keeps drill cards out of Reader word-highlight maps
- Drills sidebar includes search, language filter, latest-attempt status badges, and Next Pattern practice navigation
- Manual runtime test pass completed by user on 2026-06-18

### Sprint 7 Closeout Test Notes

- [x] Subtitle and EPUB phrase/sentence selections open AI actions consistently
- [x] English and non-English subtitle selections route through the same mining flow
- [x] Translate/Explain/Examples outputs are captured into PatternBuilder draft fields
- [x] Duplicate pattern warning appears before save and still rechecks on save
- [x] Mined pattern sentences highlight in subtitle and EPUB readers
- [x] Sentence highlight hover shows pattern tooltip; word hover still shows card tooltip
- [x] Pattern Drill supports Check Answer, Make Card, Review Now, latest attempt badges, and Next Pattern
- [x] Deck Browser displays drill cards by user sentence instead of source sentence/pattern text
- [x] `npm run typecheck` — 0 errors
- [x] `npm run test` — all pass
- [x] `npm run build` — pass

### Sprint 7 Tasks

#### Task 7.1 — Product/UX: Mine Mode Selector

Reader/Lookup must expose the mining decision explicitly:

- Mine as Word
- Mine as Sentence
- Mine as Pattern

Implementation notes:

- Current Add to Deck / `Shift+A` remains Word mode
- Add sentence-level action from selected sentence
- Add pattern action from selected phrase/sentence
- Keep reading flow fast; deep editing happens after save

#### Task 7.2 — Data Model: Migration 004

Add planned tables from `docs/DATA_MODEL.md`:

- `patterns`
- `drill_prompts`
- `drill_attempts`

Add row mapping methods:

- `createPattern`
- `updatePattern`
- `getPattern`
- `listPatterns`
- `deletePattern`
- `createDrillPrompt`
- `listDrillPrompts`
- `saveDrillAttempt`
- `listDrillAttempts`

#### Task 7.3 — Types + IPC Contracts

Add shared types:

- `Pattern`
- `PatternDraft`
- `PatternUpdate`
- `DrillType`
- `DrillPrompt`
- `DrillAttempt`
- `DrillEvaluationInput`
- `DrillEvaluation`

Add IPC surfaces:

- `window.lexis.patterns`
- `window.lexis.drills`
- `window.lexis.ai.evaluateDrillAnswer`

#### Task 7.4 — AI Drill Evaluation

Implement non-streaming structured evaluation in `electron/services/ai.ts`.

Input:

- language
- pattern text
- prompt
- expected answer, optional
- user answer
- native language

Output:

- score 0-100
- verdict: `correct` | `needs_fix` | `incorrect`
- corrected answer
- concise feedback
- actionable suggestions
- short natural example sentences using the pattern
- mistake types

Important rubric:

- Missing target pattern is a major issue even if grammar is acceptable
- Slightly unnatural but understandable answers should be `needs_fix`
- Store original user mistake; do not overwrite it with correction

#### Task 7.5 — Pattern Builder MVP

Create UI for "Mine as Pattern":

- Pattern text input
- Native meaning input
- Explanation textarea
- Example sentence from source
- Deck selector
- Tags
- Save pattern

Prefill from selected sentence/phrase. AI pattern suggestion can be added later; MVP can allow manual entry.

#### Task 7.6 — Drill Session MVP

Create a basic active-production screen:

- Show pattern and prompt
- User writes answer
- Button: Check
- Show score/verdict/correction/feedback
- Button: Try Again
- Button: Save Attempt
- Button: Create Review Card

Drill types for MVP:

- free production implemented first
- translation prompt flow planned next

#### Task 7.7 — Review Card from Attempt

Generate SRS card from saved attempt:

Front:

```text
Use "{pattern_text}":
{prompt}
```

Back:

```text
{corrected_answer}

Your answer:
{user_answer}

Feedback:
{feedback}
```

#### Task 7.8 — Tests

Unit tests:

- pattern CRUD
- drill prompt CRUD
- drill attempt persistence
- review card generation from attempt
- AI evaluation JSON parsing/fallback behavior

### Sprint 7 Acceptance Tests

- [x] User can mine selected sentence/phrase as a Pattern
- [x] Pattern links back to source sentence/source media
- [x] User can start a drill from a pattern
- [x] User can submit an answer and receive structured correction
- [x] Drill attempt is saved with original answer and corrected answer
- [x] Saved attempt can generate an SRS card
- [x] `npm run typecheck` — 0 errors
- [x] `npm run test` — all pass

---

## Sprint 8 — Input Sources + End-to-End Mining

### Sprint 8 Goal

Plain text paste and web URL import support the full mining flow. E2E tests cover word, sentence, and pattern mining.

### Sprint 8 Tasks

#### Task 8.1 — Plain Text Paste Source

New IPC `media:import-text` in `main.ts`: ✅

- Accept raw text + title + language
- Split into sentences (period/question/exclamation boundaries, respecting CJK)
- Insert into `media_sources` + `sentences` tables
- Return `MediaSource`

Update `ImportModal.tsx`: add "Paste Text" tab with textarea + title field. ✅

#### Task 8.2 — Web URL Source

Wire up `electron/services/parsers/web.ts` to: ✅

- `media:import-url` IPC ✅
- Update `ImportModal.tsx`: "Web URL" tab with URL input ✅
- Use `@mozilla/readability` to extract article text ✅

#### Task 8.3 — Native Language Settings Finalization

- Add "Native Language" segmented control: Tiếng Việt | English ✅
- Changing native language clears or invalidates `definition_translations` ✅

#### Task 8.4 — E2E Tests

```typescript
// tests/e2e/mining-workflow.spec.ts
// 1. Launch app → import sample.srt
// 2. Click sentence → click word → LookupPanel shows
// 3. Wait for Vietnamese definition to appear
// 4. Press Shift+A → CardBuilder opens with VI definition
// 5. Ctrl+Enter → card saved
// 6. Open review → card appears → rate Good → session advances
// 7. Mine selected sentence as Pattern
// 8. Start drill → submit answer → save attempt
```

### Sprint 8 Acceptance Tests

- [x] Plain text paste creates readable source in library
- [x] Web URL import extracts article
- [x] Settings: changing native language clears translation cache
- [x] E2E word mining passes
- [x] E2E pattern drill MVP passes

---

## Sprint 9 — Packaging + Polish ✅ DONE

### Sprint 9 Goal

Shippable desktop installer after Sentence Mining + Pattern Drill MVP is stable.

### Sprint 9 Status

**Done (2026-06-20):**

- `electron-builder.yml` configured for macOS (DMG, universal), Windows (NSIS), Linux (AppImage)
- Window state persistence via `electron-window-state`
- App icons generated for all platforms
- Onboarding modal (`WelcomeModal.tsx`) with dictionary download step
- `npm run dist` produces working installer (tested on macOS arm64)

### Sprint 9 Tasks

#### Task 9.1 — Packaging ✅

Configure `electron-builder.yml`:

- macOS: `.dmg` (arm64 + x64 universal) ✅
- Windows: NSIS installer ✅
- Linux: AppImage ✅

Verify: `npm run dist` → working installer on current platform. ✅

#### Task 9.2 — Window Polish ✅

- Window state persistence via `electron-window-state` ✅
- App icon in `buildResources/` ✅
- Onboarding modal on first launch (`firstLaunchDone` setting flag) ✅

#### Task 9.3 — Final Regression

- Existing cards/decks still load ✅
- Existing Sprint 6 rich card flow works ✅
- Pattern/drill tables migrate cleanly ✅
- Offline reader/dictionary/SRS works without AI key ✅
- AI-only features degrade gracefully without key ✅

### Sprint 9 Acceptance Tests

- [x] `npm run dist` produces working installer
- [x] Installed app loads in < 3 seconds
- [x] All unit tests pass
- [ ] All e2e tests pass (pending full suite run)

---

## Sprint 10 — User Lifecycle + Motivation Loop ✅ DONE

### Sprint 10 Goal

After the core Sentence Mining + Pattern Drill MVP is stable, Lexis should guide
the learner through a daily loop: create learning material, receive reminders,
complete focused tasks, protect streaks, and earn lightweight rewards. This
sprint is about habit formation and user experience flow, not monetization.

### Sprint 10 Status

**Done (2026-06-20):**

- Daily learning lifecycle with dashboard next-action guidance
- Smart notifications/reminders for due cards and streak protection
- Streak tracking with risk warnings
- Daily missions system with coin rewards
- Coin economy (earn/spend) for streak recovery
- Item system types defined (placeholder for future expansion)
- On-demand dictionary downloads reducing app size by ~150MB
- Universal macOS builds (arm64 + x64)
- App icons for all platforms

### Sprint 10 Product Flow

1. **Create** — user imports content, mines sentences/patterns, makes cards, and
   creates drill attempts.
2. **Schedule** — due cards, pending drill reviews, and daily mining goals become
   today's workload.
3. **Notify** — app reminds the user when due workload exists or a streak is at
   risk.
4. **Complete Tasks** — user clears daily tasks such as review due cards, mine N
   sentences, finish N drills, or correct old mistakes.
5. **Reward** — completed tasks award coins and update streak progress.
6. **Protect** — user can spend coins to recover a missed day or activate a
   streak shield.
7. **Return** — dashboard shows what to do next, why it matters, and the next
   best action.

### Sprint 10 Tasks

#### Task 10.1 — Daily Learning Lifecycle

- Add a daily dashboard state derived from cards, drill attempts, and mining
  history.
- Show today's workload: due cards, due drill cards, suggested mining count, and
  unfinished tasks.
- Add one primary next action so the user never has to decide from scratch.

#### Task 10.2 — Notifications + Reminders

- Add smart reminder setting: enabled/disabled only. ✅
- Trigger local desktop notification automatically when cards become due. ✅
- If no cards are due, send at most one daily streak-risk nudge after the daily due time. ✅

#### Task 10.3 — Streak Rules ✅

- Define what counts as a valid learning day:
  - review at least one due card, or
  - complete at least one pattern drill, or
  - mine at least one sentence/pattern.
- Track current streak, longest streak, last active day, and streak risk state.
- Show streak status on dashboard and review completion.
- Streak risk warning banner shows when `hoursUntilDayEnd < 6` and no valid action done.

#### Task 10.4 — Daily Missions ✅

- Generate small daily tasks from real app behavior:
  - review due cards
  - mine sentences from current source
  - complete pattern drills
  - convert an old attempt into a card
- Keep tasks lightweight and optional; no blocking core learning flow.
- MissionsPanel shows progress and allows claiming rewards.

#### Task 10.5 — Coin Economy MVP ✅

- Award coins for completing missions and maintaining streaks.
- Spend coins on utility actions:
  - streak rescue after one missed day
  - streak shield before a risky day
  - optional extra daily challenge reroll
- Keep the economy local-only and non-monetized.
- Coin balance displayed in StatusBar.

#### Task 10.6 — Item System Placeholder ✅

- Reserve data model/API space for future items.
- Do not build full inventory/shop yet.
- Future item examples: streak freeze, focus boost, review boost, cosmetic
  badges, temporary mission multiplier.
- Types defined: `ItemCategory`, `ItemRarity`, `ShopItem`, `UserInventory`.

#### Task 10.7 — On-Demand Dictionary Downloads ✅

- Remove bundled dictionaries from app package to reduce app size (472MB → 321MB).
- Implement `DictionaryDownloadService` in `electron/services/dictionary-download.ts`:
  - Track downloaded vs bundled dictionaries
  - Download progress reporting via IPC
  - Manifest file for version tracking
- Add Settings UI (`DictionaryManager.tsx`) to manage dictionary downloads.
- Update onboarding (`WelcomeModal.tsx`) to include language selection step.
- Bundled dicts still recognized in dev mode from `assets/dicts/`.

#### Task 10.8 — App Icons + Universal Builds ✅

- Generate app icons for all platforms:
  - macOS: `icon.icns` (1.8 MB)
  - Windows: `icon.ico` (370 KB)
  - Linux: `icons/` directory with multiple sizes
- Update `electron-builder.yml` for universal macOS builds (x64 + arm64 + universal).
- DMG reduced from 173MB to 123MB.

#### Task 10.9 — Reading Progress Tracking ✅

- **Progress display in Sidebar**: Each imported source shows a progress bar with percentage.
  - Blue progress bar while reading, green when 100% complete.
  - Progress calculated as `position / sentenceCount * 100`.
- **Auto-save progress**: Progress saved automatically as user reads.
  - Subtitle/Text view: Tracks scroll position with 500ms debounce, saves sentence index at viewport center.
  - EPUB view: Saves chapter index and chapter ID when chapter changes.
- **Auto-resume position**: When reopening a source, automatically scrolls to saved position.
  - Subtitle/Text: Scrolls to saved sentence index.
  - EPUB: Auto-opens saved chapter.
- **Delete source**: Delete button (X) appears on hover for each source in Sidebar.
  - Confirmation dialog warns that mined cards won't be affected.
  - Uses existing `media:delete` IPC handler.
- Leverages existing `reading_progress` table and `reader:save-progress`/`reader:get-progress` IPC handlers.

#### Task 10.10 — Dictionary Build-from-Source ✅

- Changed from pre-built dictionary downloads to build-from-source approach.
- **Bundled**: English (WordNet) - 44MB, always included with app.
- **On-demand**: Japanese (JMdict) and Chinese (CEDICT) - built locally from source XML/text files.
  - Downloads ~10MB source for JMdict, ~4MB for CEDICT.
  - Builds SQLite FTS5 database locally (~90MB for JMdict, ~21MB for CEDICT).
- Progress reporting during build shows stages: "Downloading...", "Parsing...", "Building database...".
- App size reduced significantly by not bundling large dictionary files.

#### Task 10.11 — Settings UI Redesign ✅

- Reorganized Settings page from flat layout to sidebar navigation.
- Four tabs: General, AI & API, Review, Reader.
- Fixed modal size (720x580px) for consistency.
- Reader tab includes live font preview.

#### Task 10.12 — Update System ✅

- **electron-builder publish config**: GitHub Releases with explicit `owner`/`repo` fields.
- **Update check**: `electron-updater` checks for updates on startup (10s delay) and every 4 hours.
- **IPC handlers**: `updater:get-version`, `updater:check`, `updater:open-download`.
- **Preload API**: `window.lexis.updater` with simplified methods.
- **Settings UI**: "About & Updates" section in General tab showing:
  - App version
  - Check for updates button
  - Download button (opens browser to GitHub release page)
  - Release notes/changelog display (rendered HTML)
  - Toggle for automatic update checks
- **Flow**: Check → Show "Download vX.X.X" button → Opens browser → User downloads DMG manually.
- **Why manual download?**: macOS Squirrel.Mac requires code-signed apps for auto-update. Unsigned apps get "code signature did not pass validation" error.
- **Future**: Apple Developer code signing ($99/year) would enable true auto-update.
- **Build config**: `identity: null`, `hardenedRuntime: false` for unsigned builds.
- **Build script**: `postdist:mac` auto-organizes files into `release/vX.X.X/` folders.

#### Task 10.13 — First Public Release v1.0.0 ✅

- **GitHub Repository**: https://github.com/Duong-1309/lexis
- **License**: GPL-3.0
- **README**: Features, installation, development setup, tech stack
- **Release v1.0.0**: Initial release with all Sprint 1-10 features
- **Artifacts uploaded**:
  - `Lexis-1.0.0-arm64.dmg` (143MB) — Apple Silicon
  - `Lexis-1.0.0-arm64.dmg.blockmap` — Differential updates
  - `latest-mac.yml` — Auto-updater metadata
- **macOS unsigned app workaround**: `xattr -cr /Applications/Lexis.app`

#### Task 10.14 — YouTube Subtitle Import ✅

- **yt-dlp integration**: On-demand download of yt-dlp binary (~35MB).
- **New files**:
  - `electron/services/parsers/vtt.ts` — VTT subtitle parser (YouTube format)
  - `electron/services/parsers/youtube.ts` — yt-dlp wrapper service
  - `electron/services/ytdlp-download.ts` — On-demand yt-dlp binary download
- **IPC handlers**:
  - `youtube:check-available` — Fast check if yt-dlp binary exists
  - `youtube:is-downloaded` — Check download status
  - `youtube:download-ytdlp` — Download yt-dlp binary with progress
  - `youtube:get-info` — Fetches video info and available subtitles
  - `youtube:import` — Downloads and imports subtitles as MediaSource
- **UI**: New "YouTube" tab in ImportModal with:
  - Download button for yt-dlp (one-time ~35MB download)
  - Download progress bar
  - URL input field
  - Fetch button to retrieve video info
  - Subtitle language selector (manual vs auto-generated)
  - Import button
- **Database**: Migration v6 adds 'youtube' to `media_sources.type` CHECK constraint.
- **macOS compatibility**: Removes quarantine attribute after download (`xattr -d com.apple.quarantine`).
- **Release v1.0.1**: YouTube import with system yt-dlp requirement.
- **Release v1.1.0**: On-demand yt-dlp download (no terminal required).

### Sprint 10 Acceptance Tests

- [x] Dashboard shows one clear next action for a returning user
- [x] Streak increments after a valid learning action
- [x] Streak risk appears when the day is near ending and no valid action is done
- [x] Local reminder can be configured and triggered
- [x] Daily missions can be completed and award coins
- [x] Coins can be spent to rescue or protect a streak (placeholder: item types defined)
- [x] Core mining/review/drill flows still work without missions enabled
- [x] Dictionary downloads work from Settings and onboarding
- [x] App builds successfully for macOS (universal), Windows, Linux
- [x] App size reduced from ~500MB to ~320MB
- [x] Reading progress bar shows in Sidebar for each source
- [x] Auto-resume reading position when reopening a source
- [x] Delete source button works with confirmation
- [x] Dictionary build-from-source works for JMdict and CEDICT
- [x] Settings UI uses sidebar navigation
- [x] Auto-update UI shows version and update status in Settings
- [x] Release notes displayed when update available
- [x] First release v1.0.0 published on GitHub
- [x] YouTube URL → fetch video info → select subtitle language → import
- [x] yt-dlp not installed → warning banner with install instructions
- [x] YouTube subtitles parsed correctly (VTT format) with timestamps
- [x] Release v1.0.1 published with YouTube import feature
- [x] Release v1.1.0: On-demand yt-dlp download (no terminal required)
- [x] Release v1.2.0: Source management (edit/delete), search in Reader, SRS 2-step learning

---

## Sprint 11 — Import Library Management (Planned)

### Sprint 11 Goal

Users can organize, edit, and manage imported content: rename titles, group into folders/collections, add tags, filter/search library, and bulk operations.

### Sprint 11 Tasks

#### Task 11.1 — Edit Source Title

- Add edit button/icon next to source title in Sidebar
- Click → inline edit or modal with title input
- Update `media_sources.title` in database
- IPC: `media:rename(sourceId, newTitle)`
- Applies to: YouTube, Web, EPUB, Text, Subtitle imports

#### Task 11.2 — Folders/Collections

- Add `collections` table:
  ```sql
  CREATE TABLE collections (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT,           -- hex color for visual distinction
    icon TEXT,            -- optional emoji/icon
    parent_id INTEGER,    -- for nested folders (optional)
    sort_order INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  ALTER TABLE media_sources ADD COLUMN collection_id INTEGER REFERENCES collections(id);
  ```
- UI: Collapsible folder tree in Sidebar
- Drag-and-drop sources into folders
- Create/rename/delete folders
- IPC: `collections:create`, `collections:rename`, `collections:delete`, `media:move-to-collection`

#### Task 11.3 — Source Tags

- Add `source_tags` table:
  ```sql
  CREATE TABLE tags (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    color TEXT            -- hex color
  );

  CREATE TABLE source_tags (
    source_id INTEGER NOT NULL REFERENCES media_sources(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (source_id, tag_id)
  );
  ```
- UI: Tag chips on source items, tag selector in source details
- Create tags on-the-fly
- Filter library by tag
- IPC: `tags:create`, `tags:list`, `media:add-tag`, `media:remove-tag`

#### Task 11.4 — Library Search & Filter

- Search bar in Sidebar header
- Search by: title, tags, collection, source type
- Filter by:
  - Type: subtitle, epub, youtube, web, text
  - Language: en, ja, zh, ko, fr, es
  - Progress: unread, in-progress, completed
  - Date: imported this week/month/year
- Sort by: name, date imported, last opened, progress

#### Task 11.5 — Bulk Operations

- Multi-select sources (Cmd/Ctrl+click, Shift+click)
- Bulk actions:
  - Move to collection
  - Add/remove tags
  - Delete selected
  - Export (future)
- Selection UI: checkboxes on hover, selection count badge

#### Task 11.6 — Source Details Panel

- Right-click source → "Show Details" or dedicated info button
- Modal/panel showing:
  - Editable title
  - Source type + language
  - Import date, last opened
  - Progress (sentences read / total)
  - Tags (editable)
  - Collection (editable)
  - Source URL (for web/youtube)
  - File path (for local files)
  - Stats: words mined, patterns mined

### Sprint 11 Acceptance Tests

- [ ] Can rename any imported source title
- [ ] Can create folders and move sources into them
- [ ] Can add/remove tags on sources
- [ ] Can search library by title
- [ ] Can filter by type, language, progress
- [ ] Multi-select and bulk delete works
- [ ] Source details panel shows all metadata

---

## Sprint 12 — Speech-to-Text & Speaking Practice (Planned)

### Sprint 12 Goal

Users can practice speaking through 3 modes: Pronunciation Practice (speak and compare), Dictation (listen and type), and Shadowing (listen, repeat, get feedback). STT uses Web Speech API by default with optional Whisper.cpp for offline/higher accuracy.

### Sprint 12 Product Flow

1. **Pronunciation Practice**
   - User sees a sentence from their mined content
   - User clicks mic → speaks the sentence
   - App transcribes using STT
   - App compares transcription with target, highlights differences
   - Score: word accuracy %, phoneme-level feedback (if available)

2. **Dictation Mode**
   - App plays audio of a sentence (TTS or extracted audio)
   - User types what they hear
   - App compares typed text with original
   - Highlights correct/incorrect words
   - Track accuracy over time

3. **Shadowing Mode**
   - App plays sentence audio
   - User repeats immediately after (or with delay)
   - App records user's voice
   - STT transcribes user's speech
   - Compare with target, show feedback
   - Optional: overlay waveforms for timing comparison

### Sprint 12 Tasks

#### Task 12.1 — Audio Recording Service

Create `electron/services/audio-recorder.ts`:

```typescript
interface AudioRecorderService {
  // Request microphone permission
  requestPermission(): Promise<boolean>

  // Start recording
  startRecording(): Promise<void>

  // Stop and get audio buffer
  stopRecording(): Promise<AudioBuffer>

  // Get audio as WAV file (for Whisper)
  getWavBlob(): Promise<Blob>

  // Check if recording
  isRecording(): boolean
}
```

- Use Web Audio API for recording
- Convert to WAV format for Whisper compatibility
- IPC: `audio:request-mic-permission`, `audio:start-recording`, `audio:stop-recording`

#### Task 12.2 — Web Speech API STT (Phase 1)

Create `src/services/web-speech-stt.ts` (renderer process):

```typescript
interface WebSpeechSTT {
  // Check if available
  isAvailable(): boolean

  // Start recognition
  startListening(language: Language): void

  // Stop recognition
  stopListening(): void

  // Events
  onResult(callback: (transcript: string, isFinal: boolean) => void): void
  onError(callback: (error: string) => void): void
}
```

- Uses `window.SpeechRecognition` or `window.webkitSpeechRecognition`
- Runs in renderer (no IPC needed)
- Supports interim results for real-time feedback
- Language codes: en-US, ja-JP, zh-CN, ko-KR, fr-FR, es-ES

#### Task 12.3 — Whisper.cpp Integration (Phase 2)

Create `electron/services/whisper-stt.ts`:

```typescript
interface WhisperService {
  // Check if model is downloaded
  isModelDownloaded(size: 'tiny' | 'base'): boolean

  // Download model (~75MB tiny, ~150MB base)
  downloadModel(size: 'tiny' | 'base', onProgress: (p: number) => void): Promise<void>

  // Transcribe audio file
  transcribe(wavPath: string, language: Language): Promise<TranscriptionResult>

  // Delete model
  deleteModel(size: 'tiny' | 'base'): Promise<void>
}

interface TranscriptionResult {
  text: string
  segments: Array<{
    start: number  // seconds
    end: number
    text: string
    confidence: number
  }>
  language: string
}
```

- Use `whisper.cpp` via child process or WASM
- Models stored in `{userData}/models/whisper/`
- Support: ggml-tiny.bin (~75MB), ggml-base.bin (~150MB)
- On-demand download like yt-dlp

#### Task 12.4 — STT Unified Interface

Create `electron/services/stt.ts`:

```typescript
interface STTService {
  // Get available engines
  getAvailableEngines(): Promise<STTEngine[]>

  // Get current engine
  getCurrentEngine(): STTEngine

  // Set preferred engine
  setPreferredEngine(engine: 'web-speech' | 'whisper-tiny' | 'whisper-base'): void

  // Transcribe (uses best available engine)
  transcribe(audio: AudioBuffer | string, language: Language): Promise<string>
}

type STTEngine = {
  id: string
  name: string
  offline: boolean
  downloaded: boolean
  size?: number
}
```

- Fallback chain: Whisper (if downloaded) → Web Speech API
- Settings UI to choose preferred engine

#### Task 12.5 — Text Comparison & Scoring

Create `src/utils/text-comparison.ts`:

```typescript
interface ComparisonResult {
  score: number              // 0-100 accuracy
  wordResults: WordResult[]  // per-word breakdown
  errors: ErrorType[]        // categorized errors
}

interface WordResult {
  expected: string
  actual: string | null      // null if missing
  status: 'correct' | 'wrong' | 'missing' | 'extra'
  position: number
}

type ErrorType =
  | 'missing_word'
  | 'extra_word'
  | 'wrong_word'
  | 'word_order'
  | 'pronunciation'  // sounds similar but wrong

function compareTranscription(
  expected: string,
  actual: string,
  language: Language
): ComparisonResult
```

- Normalize text (lowercase, remove punctuation)
- Handle homophones and common STT errors
- Language-specific rules (particles in Japanese, tones in Chinese)

#### Task 12.6 — Pronunciation Practice UI

Create `src/components/Practice/PronunciationPractice.tsx`:

```
┌─────────────────────────────────────────────────────────┐
│  Pronunciation Practice          [Settings] [Close]     │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  "The quick brown fox jumps over the lazy dog."        │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │  🎤  Hold to speak...                            │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  Your speech:                                           │
│  "The quick brown [fox] jumps over the [lazy] dog."   │
│                     ^^^                 ^^^^            │
│                   (missed)            (wrong: "lady")   │
│                                                         │
│  Score: 85%    [Try Again]    [Next Sentence →]        │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

- Source sentences from: current reader, mined patterns, custom input
- Real-time waveform while recording
- Color-coded word comparison (green=correct, red=wrong, yellow=missing)
- Track history and improvement over time

#### Task 12.7 — Dictation Mode UI

Create `src/components/Practice/DictationPractice.tsx`:

```
┌─────────────────────────────────────────────────────────┐
│  Dictation Practice              [Settings] [Close]     │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  🔊 [▶ Play]  [▶ Play Slow]  [Repeat: 2]               │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Type what you hear...                           │   │
│  │  _                                               │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  [Check Answer]                                         │
│                                                         │
│  ─────────────────────────────────────────────────────  │
│  After check:                                           │
│  Your answer:  "The quick brown fox jumps..."          │
│  Correct:      "The quick brown fox jumps..."          │
│  Score: 100%   ✓ Perfect!                              │
│                                                         │
│  [Next Sentence →]                                      │
└─────────────────────────────────────────────────────────┘
```

- Audio sources: TTS, YouTube audio (if available), extracted audio
- Adjustable playback speed (0.5x, 0.75x, 1x)
- Hint system: show first letter, show word count
- Keyboard shortcuts: Space=play, Enter=check

#### Task 12.8 — Shadowing Mode UI

Create `src/components/Practice/ShadowingPractice.tsx`:

```
┌─────────────────────────────────────────────────────────┐
│  Shadowing Practice              [Settings] [Close]     │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  "The quick brown fox jumps over the lazy dog."        │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Original:  ▂▃▅▇█▇▅▃▂▁▂▃▅▇█▇▅▃▂                │   │
│  │  Your voice: ▂▃▅▇█▇▅▃▂▁▂▃▅▇█▇▅▃▂               │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  Mode: [Immediate] [Delayed 1s] [Delayed 2s]           │
│                                                         │
│  [▶ Start]  [⏹ Stop]  [🔄 Reset]                       │
│                                                         │
│  Results:                                               │
│  - Timing: 92% match                                   │
│  - Accuracy: 88%                                       │
│  - Missed words: "lazy"                                │
│                                                         │
│  [Save Attempt]  [Next Sentence →]                     │
└─────────────────────────────────────────────────────────┘
```

- Play audio → auto-record user after delay
- Waveform visualization for timing comparison
- Three modes: immediate echo, 1s delay, 2s delay
- Integration with Pattern Drill (shadowing as drill type)

#### Task 12.9 — Practice Session & Stats

Create `src/components/Practice/PracticeSession.tsx`:

- Unified practice session combining all modes
- Session config: mode, duration, source (current reader, deck, all)
- Track stats:
  - Total practice time
  - Sentences practiced
  - Average accuracy by mode
  - Improvement over time (weekly/monthly graphs)
- Save practice history to DB:
  ```sql
  CREATE TABLE practice_sessions (
    id INTEGER PRIMARY KEY,
    mode TEXT NOT NULL,        -- 'pronunciation' | 'dictation' | 'shadowing'
    source_id INTEGER,
    sentence_id INTEGER,
    language TEXT NOT NULL,
    score INTEGER,             -- 0-100
    transcript TEXT,           -- user's transcribed speech
    target_text TEXT,
    duration_ms INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  ```

#### Task 12.10 — Settings & Model Management

Update Settings UI:

```
Speech Recognition
├── Engine: [Web Speech API ▼] / [Whisper Tiny] / [Whisper Base]
├── Whisper Models:
│   ├── Tiny (75 MB)  [Download] / [Downloaded ✓] [Delete]
│   └── Base (150 MB) [Download] / [Downloaded ✓] [Delete]
├── Auto-detect language: [✓]
└── Microphone: [Default ▼]

Practice Settings
├── Default mode: [Pronunciation ▼]
├── Shadowing delay: [1 second ▼]
├── Playback speed: [1.0x ▼]
└── Show hints: [✓]
```

### Sprint 12 Acceptance Tests

- [ ] Web Speech API transcribes spoken English sentence
- [ ] Web Speech API works for Japanese, Chinese, Korean
- [ ] Whisper model downloads with progress bar
- [ ] Whisper transcribes offline accurately
- [ ] Fallback: Whisper → Web Speech API when model not downloaded
- [ ] Pronunciation practice shows word-by-word comparison
- [ ] Dictation mode plays audio and checks typed answer
- [ ] Shadowing mode records and compares with original
- [ ] Practice stats saved and displayed
- [ ] Settings allow switching STT engine

### Sprint 12 Technical Notes

**Whisper.cpp options:**
1. **whisper.cpp binary** - Compile for each platform, call via child_process
2. **whisper-node** - Node.js bindings (may have ABI issues with Electron)
3. **whisper.wasm** - WebAssembly version, runs in renderer (slower but portable)

**Recommendation:** Start with whisper.wasm for portability, optimize later if needed.

**Model hosting:**
- Host models on GitHub Releases or CDN
- Same pattern as yt-dlp download
- Checksum verification after download

---

## Release v1.2.0 ✅ DONE

### Release Goal

Bug fixes + Import Library Management MVP + Search in Reader.

### What's New

#### Source Management
- [x] **Edit source title** — Click edit icon in content header, inline editing
- [x] **Delete confirmation** — Custom modal with keyboard shortcuts (Enter/Escape)
- [x] **Source details tooltip** — Hover sidebar items (300ms delay) to see word count, URL, dates

#### Search in Reader
- [x] **Ctrl+F search** — Find text in subtitle/text view and EPUB chapters
- [x] **Match navigation** — ▲▼ buttons or Enter/Shift+Enter to jump between matches
- [x] **Highlight** — Current match bright yellow, other matches light yellow

#### SRS Improvements
- [x] **Faster graduation** — Reduced learning steps from 3 to 2 (1min → 10min → graduate)
- [x] **Better review display** — Shows learning card count in review session

#### Bug Fixes
- [x] **Word click line shift** — Fixed by removing px-px padding from tokens
- [x] **Multi-line selection** — Fixed text selection spanning multiple lines
- [x] **Dictionary all senses** — Now shows ALL meanings for translation and cards

### Deferred to v1.3.0+

- Folders/Collections (Sprint 11.2)
- Tags system (Sprint 11.3)
- Full search & filter (Sprint 11.4)
- Bulk operations (Sprint 11.5)
- Speech-to-Text (Sprint 12)
- SRS Algorithm Improvements (Sprint 13)
- Loading states, error messages, keyboard shortcuts help

---

## SRS Algorithm Backlog (Sprint 13 - Planned)

### Gap Analysis: algorithm.txt vs Current Implementation

Based on `algorithm.txt` recommendations and Anki/FSRS best practices.

### Phase 1 — Quick Fixes (v1.2.0) ✅ DONE

- [x] **Reduce learning steps from 3 to 2**
  - Changed: Graduate at `stepIndex >= 2` instead of `>= 3`
  - Now: 1min → 10min → graduate (2 steps)

- [ ] **Fix queue priority order** (deferred to v1.3.0)
  - Current: `ORDER BY card_state DESC` (alphabetical = wrong)
  - Target: `relearning > learning > review > new`

- [ ] **Allow ending session with learning cards pending** (deferred to v1.3.0)
  - Current: Must rate Good on ALL learning cards to end
  - Target: "End Session" button saves learning cards for later

### Phase 2 — Config & Limits (v1.3.0)

- [ ] **Add `newCardsPerDay` limit**
  - Default: 20
  - Configurable in Settings
  - Query: Only fetch N new cards per day

- [ ] **Add `maxReviewPerDay` limit**
  - Default: 200 (or unlimited)
  - Configurable in Settings
  - Warning when approaching limit

- [ ] **Make learning steps configurable**
  ```typescript
  // Settings UI
  learningStepsMinutes: [1, 10]      // default
  relearningStepsMinutes: [10]       // default
  graduatingIntervalDays: 1
  easyIntervalDays: 4
  ```

- [ ] **Add 'relearning' card state**
  - Current: only 'new', 'learning', 'review', 'suspended'
  - Add: 'relearning' for lapsed cards re-entering steps

- [ ] **Separate queues in ReviewSession**
  - Due review cards (overdue first)
  - Learning/relearning cards (by due time)
  - New cards (limited by daily cap)

### Phase 3 — FSRS Preparation (v1.4.0+)

- [ ] **Extend Card schema for FSRS**
  ```sql
  ALTER TABLE cards ADD COLUMN difficulty REAL;      -- D: 1-10
  ALTER TABLE cards ADD COLUMN stability REAL;       -- S: days
  ALTER TABLE cards ADD COLUMN last_reviewed_at TEXT;
  ```

- [ ] **Enhance ReviewLog for FSRS training**
  ```sql
  ALTER TABLE review_log ADD COLUMN elapsed_days REAL;
  ALTER TABLE review_log ADD COLUMN state_before TEXT;
  ALTER TABLE review_log ADD COLUMN state_after TEXT;
  ```

- [ ] **Create Scheduler interface**
  ```typescript
  interface Scheduler {
    review(card: Card, rating: Rating, now: Date): Card;
    getNextInterval(card: Card, rating: Rating): number;
    estimateRetention(card: Card, now: Date): number;
  }

  class SM2Scheduler implements Scheduler {}
  class FSRSLiteScheduler implements Scheduler {}
  ```

- [ ] **Implement FSRS-lite**
  - Difficulty, Stability, Retrievability model
  - `desiredRetention` setting (default 0.9)
  - Forgetting curve: `R(t, S) = (1 + t / (9 × S)) ^ -1`

- [ ] **Settings: Scheduler selection**
  - SM-2 (current, default)
  - FSRS-lite (experimental)

### Data Model Changes Required

**Card table additions:**
```sql
-- Phase 2
ALTER TABLE cards ADD COLUMN relearning_step INTEGER DEFAULT 0;

-- Phase 3 (FSRS)
ALTER TABLE cards ADD COLUMN difficulty REAL DEFAULT 5.0;
ALTER TABLE cards ADD COLUMN stability REAL;
ALTER TABLE cards ADD COLUMN last_reviewed_at TEXT;
```

**ReviewLog enhancements:**
```sql
ALTER TABLE review_log ADD COLUMN elapsed_days REAL;
ALTER TABLE review_log ADD COLUMN state_before TEXT;
ALTER TABLE review_log ADD COLUMN state_after TEXT;
ALTER TABLE review_log ADD COLUMN retrievability REAL;  -- for FSRS
```

**Settings additions:**
```typescript
interface SRSSettings {
  scheduler: 'sm2' | 'fsrs-lite';
  newCardsPerDay: number;           // default 20
  maxReviewsPerDay: number;         // default 200, 0 = unlimited
  learningSteps: number[];          // default [1, 10] minutes
  relearningSteps: number[];        // default [10] minutes
  graduatingInterval: number;       // default 1 day
  easyInterval: number;             // default 4 days
  desiredRetention: number;         // default 0.9 (FSRS only)
}
```

### Reference

See `algorithm.txt` for detailed algorithm explanations:
- SM-2 formula and implementation
- FSRS-lite simplified implementation
- Learning steps logic
- Queue priority rules

---

## Known Bugs & Issues

### Bug: Word click causes line height shift (Priority: High)

**Reported:** 2026-06-22

**Symptom:** When clicking on a word in Reader, the line expands/shifts, causing adjacent words to move. This makes the user accidentally click on the wrong word.

**Likely cause:** CSS styling on selected/highlighted word adds padding, border, or changes box model, causing text reflow.

**Location:** `src/components/Reader/SentenceRow.tsx` or related CSS

**Fix approach:**
- Use `outline` instead of `border` (doesn't affect layout)
- Use `box-shadow` for highlight effect
- Ensure `display: inline` with no padding/margin changes on click
- Or use `box-sizing: border-box` with fixed dimensions

**Status:** Fixed (removed `px-px` padding from tokens) - needs verification

---

### Bug: Multi-line sentence selection not working (Priority: High)

**Reported:** 2026-06-22

**Symptom:** When selecting a sentence that spans 2 lines, the selection/tokenization doesn't work properly.

**Likely cause:** 
- Text selection detection issue with multi-line content
- Tokenization may be failing for long sentences
- Click event handling may have issues with wrapped text

**Location:** `src/components/Reader/SentenceRow.tsx`

**Fix approach:**
- Check `window.getSelection()` handling for multi-line selections
- Verify tokenization works for long sentences
- Test click event propagation on wrapped content

**Status:** Open

---

## Definition of Done (all sprints)

1. TypeScript compiles with 0 errors (`npm run typecheck`)
2. Unit tests pass (`npm run test`)
3. No `any` types or `// @ts-ignore` (except documented exceptions)
4. All IPC calls use `wrapResult` pattern — never throws across IPC boundary
5. Errors shown to user gracefully — no silent failures, no raw crashes
6. Features work offline (no network = graceful degradation, not broken)

---

End of Implementation Plan v2.7 (Sprint 10 complete, v1.1.0 released, Sprint 11-13 planned)
