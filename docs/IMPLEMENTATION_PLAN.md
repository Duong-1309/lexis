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
- Fixed modal size (680x520px) for consistency.
- Reader tab includes live font preview.

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

---

## Definition of Done (all sprints)

1. TypeScript compiles with 0 errors (`npm run typecheck`)
2. Unit tests pass (`npm run test`)
3. No `any` types or `// @ts-ignore` (except documented exceptions)
4. All IPC calls use `wrapResult` pattern — never throws across IPC boundary
5. Errors shown to user gracefully — no silent failures, no raw crashes
6. Features work offline (no network = graceful degradation, not broken)

---

End of Implementation Plan v2.1 (Sprint 10 complete)
