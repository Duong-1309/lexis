# Data Model — Lexis SQLite Schema
# File: docs/DATA_MODEL.md

---

## Overview

Lexis uses two categories of SQLite databases:

1. **User database** (`lexis.db`) — read-write, stores all user-created data
2. **Dictionary databases** (`jmdict.db`, `cedict.db`) — read-only, bundled dictionaries

---

## User Database Schema (`lexis.db`)

### Migration 001 — Initial Schema (Sprint 1)

Embedded inline in `electron/services/db.class.ts` (not a file — avoids build path issues).

```sql
CREATE TABLE media_sources (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  type           TEXT    NOT NULL CHECK(type IN ('subtitle', 'epub', 'web')),
  title          TEXT    NOT NULL,
  file_path      TEXT,
  source_url     TEXT,
  language       TEXT    NOT NULL,
  word_count     INTEGER,
  sentence_count INTEGER,
  cover_image    BLOB,
  added_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  last_opened    TEXT
);

CREATE TABLE sentences (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id     INTEGER NOT NULL REFERENCES media_sources(id) ON DELETE CASCADE,
  content       TEXT    NOT NULL,
  translation   TEXT,
  position      INTEGER NOT NULL,
  start_time_ms INTEGER,
  end_time_ms   INTEGER,
  chapter_id    TEXT
);

CREATE TABLE reading_progress (
  source_id  INTEGER PRIMARY KEY REFERENCES media_sources(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL DEFAULT 0,
  chapter_id TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE mined_words (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  word        TEXT    NOT NULL,
  reading     TEXT,
  language    TEXT    NOT NULL,
  source_id   INTEGER REFERENCES media_sources(id) ON DELETE SET NULL,
  sentence_id INTEGER REFERENCES sentences(id) ON DELETE SET NULL,
  card_id     INTEGER REFERENCES cards(id) ON DELETE SET NULL,
  mined_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE dict_cache (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  word        TEXT    NOT NULL,
  language    TEXT    NOT NULL,
  result_json TEXT    NOT NULL,
  cached_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(word, language)
);
```

### Migration 002 — SRS Flashcard System (Sprint 3)

```sql
-- ─────────────────────────────────────────────────
-- DECKS
-- Named collections of flashcards
-- ─────────────────────────────────────────────────
CREATE TABLE decks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL UNIQUE,
  description TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Default deck inserted automatically on first run
INSERT INTO decks (name, description) VALUES ('Default', 'Default deck');

-- ─────────────────────────────────────────────────
-- CARDS
-- Flashcards with SM-2 scheduling fields
-- ─────────────────────────────────────────────────
CREATE TABLE cards (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  deck_id         INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  front_html      TEXT    NOT NULL,
  back_html       TEXT    NOT NULL,
  tags_json       TEXT    NOT NULL DEFAULT '[]',

  -- Source context (for reference only, not required)
  word            TEXT,
  reading         TEXT,
  language        TEXT,
  source_sentence TEXT,
  source_id       INTEGER REFERENCES media_sources(id) ON DELETE SET NULL,

  -- SM-2 scheduling fields
  due_date     TEXT    NOT NULL DEFAULT (date('now')),  -- YYYY-MM-DD
  interval     INTEGER NOT NULL DEFAULT 0,    -- days until next review (0 = new)
  ease_factor  REAL    NOT NULL DEFAULT 2.5,  -- SM-2 E-Factor, min 1.3
  reps         INTEGER NOT NULL DEFAULT 0,    -- consecutive successful reviews
  lapses       INTEGER NOT NULL DEFAULT 0,    -- times answered "Again"
  card_state   TEXT    NOT NULL DEFAULT 'new'
                       CHECK(card_state IN ('new', 'learning', 'review', 'suspended')),

  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  last_reviewed TEXT
);

CREATE INDEX idx_cards_deck      ON cards(deck_id);
CREATE INDEX idx_cards_due       ON cards(due_date, card_state);
CREATE INDEX idx_cards_word      ON cards(word, language);

-- ─────────────────────────────────────────────────
-- REVIEW LOG
-- Immutable history of every review event
-- ─────────────────────────────────────────────────
CREATE TABLE review_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id         INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  reviewed_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  rating          INTEGER NOT NULL CHECK(rating IN (1, 2, 3, 4)),
                          -- 1=Again  2=Hard  3=Good  4=Easy
  interval_before INTEGER NOT NULL DEFAULT 0,
  interval_after  INTEGER NOT NULL DEFAULT 0,
  ease_before     REAL    NOT NULL DEFAULT 2.5,
  time_taken_ms   INTEGER
);

CREATE INDEX idx_review_log_card ON review_log(card_id, reviewed_at DESC);
CREATE INDEX idx_review_log_date ON review_log(reviewed_at DESC);
```

---

## SM-2 Algorithm

Implementation in `electron/services/srs.ts`.

```text
Input:  card (interval, ease_factor, reps, lapses), rating (1–4)
Output: updated (interval, ease_factor, reps, lapses, due_date, card_state)

1. Update ease_factor:
   ease_factor = ease_factor + (0.1 - (5 - rating) * (0.08 + (5 - rating) * 0.02))
   ease_factor = max(1.3, ease_factor)

2. If rating == 1 (Again):
   interval = 1
   reps = 0
   lapses += 1
   card_state = 'learning'

3. If rating == 2 (Hard):
   interval = max(1, round(interval * 1.2))
   reps = max(0, reps - 1)

4. If rating >= 3 (Good / Easy):
   if reps == 0:   interval = 1
   elif reps == 1: interval = 6
   else:           interval = round(interval * ease_factor)
   if rating == 4 (Easy): interval = round(interval * 1.3)
   reps += 1
   card_state = if interval >= 21 then 'review' else 'learning'

5. due_date = today + interval days
```

---

## Dictionary Database Schema

### JMdict (`jmdict.db`) — READ ONLY

```sql
CREATE TABLE entries (
  id        INTEGER PRIMARY KEY,   -- JMdict ent_seq
  writings  TEXT NOT NULL,         -- space-separated kanji forms
  readings  TEXT NOT NULL,         -- space-separated readings
  data_json TEXT NOT NULL          -- full JMdictEntry as JSON
);

CREATE VIRTUAL TABLE entries_fts USING fts5(
  writings, readings,
  content='entries', content_rowid='id',
  tokenize='trigram'
);

CREATE TABLE jlpt_levels (
  word  TEXT PRIMARY KEY,
  level INTEGER NOT NULL   -- 1=N1 (hardest) … 5=N5 (easiest)
);
```

### CEDICT (`cedict.db`) — READ ONLY

```sql
CREATE TABLE entries (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  traditional   TEXT NOT NULL,
  simplified    TEXT NOT NULL,
  pinyin        TEXT NOT NULL,
  pinyin_pretty TEXT NOT NULL,
  definitions   TEXT NOT NULL,   -- JSON array
  hsk_level     INTEGER
);

CREATE INDEX idx_cedict_simplified  ON entries(simplified);
CREATE INDEX idx_cedict_traditional ON entries(traditional);

CREATE VIRTUAL TABLE entries_fts USING fts5(
  simplified, traditional,
  content='entries', content_rowid='id'
);
```

---

## TypeScript Types

File: `src/types/index.ts`

```typescript
export type Language     = 'ja' | 'zh' | 'ko' | 'en' | 'fr' | 'es'
export type MediaType    = 'subtitle' | 'epub' | 'web'
export type CardState    = 'new' | 'learning' | 'review' | 'suspended'
export type ReviewRating = 1 | 2 | 3 | 4   // Again / Hard / Good / Easy
export type CardTemplate = 'Basic' | 'Cloze'

// ─── Media ───────────────────────────────────────────────────────────────────

export interface MediaSource {
  id: number; type: MediaType; title: string
  filePath?: string; sourceUrl?: string; language: Language
  wordCount?: number; sentenceCount?: number
  addedAt: string; lastOpened?: string
}

export interface Sentence {
  id: number; sourceId: number; content: string; translation?: string
  position: number; startTimeMs?: number; endTimeMs?: number; chapterId?: string
}

// ─── Flashcards ───────────────────────────────────────────────────────────────

export interface Deck {
  id: number; name: string; description?: string; createdAt: string
  // computed at query time:
  cardCount?: number; dueCount?: number; newCount?: number
}

export interface Card {
  id: number; deckId: number
  frontHtml: string; backHtml: string; tags: string[]
  word?: string; reading?: string; language?: Language
  sourceSentence?: string; sourceId?: number
  // SRS
  dueDate: string; interval: number; easeFactor: number
  reps: number; lapses: number; cardState: CardState
  createdAt: string; lastReviewed?: string
}

export interface DraftCard {
  deckId: number
  frontHtml: string; backHtml: string; tags: string[]
  template: CardTemplate
  word?: string; reading?: string; language?: Language
  sourceSentence?: string; sourceId?: number
}

export interface ReviewLog {
  id: number; cardId: number; reviewedAt: string
  rating: ReviewRating
  intervalBefore: number; intervalAfter: number
  easeBefore: number; timeTakenMs?: number
}

export interface ReviewSession {
  cards: Card[]        // due cards for today, shuffled
  totalDue: number
  newCount: number
  reviewCount: number
}

// ─── Dictionary ───────────────────────────────────────────────────────────────

export interface DictEntry {
  word: string; language: Language
  readings: DictReading[]; senses: DictSense[]
  jlptLevel?: number; hskLevel?: number; commonWord?: boolean
}

export interface DictReading { value: string; common: boolean; pitchPattern?: string }

export interface DictSense {
  partOfSpeech: string[]; definitions: string[]
  examples?: Array<{ source: string; translation: string }>
  misc?: string[]
}

export interface Token { surface: string; dictionaryForm: string; reading?: string; pos?: string }

// ─── Stats ───────────────────────────────────────────────────────────────────

export interface DayStat { date: string; mined: number; reviewed: number }

export interface ReviewStats {
  reviewedToday: number; accuracy: number   // 0–1
  avgTimeMs: number; streak: number
}
```

---

## Key Queries

### Due cards for today

```sql
SELECT * FROM cards
WHERE deck_id = ?
  AND card_state != 'suspended'
  AND due_date <= date('now')
ORDER BY card_state DESC, due_date ASC   -- 'review' before 'new'/'learning'
LIMIT 100;
```

### Deck summary (counts)

```sql
SELECT
  d.*,
  COUNT(c.id)                                           AS card_count,
  SUM(c.due_date <= date('now') AND c.card_state != 'suspended') AS due_count,
  SUM(c.card_state = 'new')                             AS new_count
FROM decks d
LEFT JOIN cards c ON c.deck_id = d.id
GROUP BY d.id;
```

### Daily review history (last 30 days)

```sql
SELECT
  date(reviewed_at) AS date,
  COUNT(*)          AS reviewed,
  SUM(rating >= 3)  AS correct
FROM review_log
WHERE reviewed_at >= date('now', '-30 days')
GROUP BY date(reviewed_at)
ORDER BY date ASC;
```

### Word already has a card?

```sql
SELECT COUNT(*) FROM cards
WHERE word = ? AND language = ? AND card_state != 'suspended';
```

---

End of Data Model v2.0 — updated for built-in SRS (Sprint 3)
