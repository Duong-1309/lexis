import Database from 'better-sqlite3'
import path from 'path'
import log from 'electron-log'
import type {
  MediaSource,
  MediaSourceInsert,
  Sentence,
  SentenceInsert,
  MinedWord,
  Deck,
  Card,
  DraftCard,
  SRSResult,
  ReviewRating,
  ReviewLog,
  CardState,
  CardUpdate,
  ReadingProgress,
  DayStat,
  MiningStats,
  Language,
  NativeLanguage,
  Pattern,
  PatternDraft,
  PatternUpdate,
  PatternFilters,
  DrillPrompt,
  DrillPromptDraft,
  DrillAttempt,
  DrillAttemptDraft,
  DrillType,
  DrillVerdict,
} from '../../src/types/index'

interface DbMediaSource {
  id: number
  type: string
  title: string
  file_path: string | null
  source_url: string | null
  language: string
  word_count: number | null
  sentence_count: number | null
  added_at: string
  last_opened: string | null
}

interface DbSentence {
  id: number
  source_id: number
  content: string
  translation: string | null
  position: number
  start_time_ms: number | null
  end_time_ms: number | null
  chapter_id: string | null
}

interface DbReadingProgress {
  source_id: number
  position: number
  chapter_id: string | null
  updated_at: string
}

interface DbMinedWord {
  id: number
  word: string
  reading: string | null
  language: string
  source_id: number | null
  sentence_id: number | null
  anki_note_id: number | null
  anki_deck: string | null
  status: string
  mined_at: string
}

interface DbDeck {
  id: number
  name: string
  description: string | null
  created_at: string
  card_count?: number
  due_count?: number
  new_count?: number
}

interface DbCard {
  id: number
  deck_id: number
  front_html: string
  back_html: string
  tags_json: string
  word: string | null
  reading: string | null
  language: string | null
  native_definition: string | null
  part_of_speech: string | null
  level_info: string | null
  audio_word: string | null
  step_index: number
  source_sentence: string | null
  source_id: number | null
  due_date: string
  interval: number
  ease_factor: number
  reps: number
  lapses: number
  card_state: string
  created_at: string
  last_reviewed: string | null
}

interface DbReviewLog {
  id: number
  card_id: number
  reviewed_at: string
  rating: number
  interval_before: number
  interval_after: number
  ease_before: number
  time_taken_ms: number | null
}

interface DbDayStat {
  date: string
  count: number
}

interface DbPattern {
  id: number
  deck_id: number | null
  language: string
  pattern_text: string
  meaning_native: string | null
  explanation: string | null
  example_sentence: string | null
  source_sentence_id: number | null
  source_id: number | null
  tags_json: string
  created_at: string
  updated_at: string
}

interface DbDrillPrompt {
  id: number
  pattern_id: number
  type: string
  prompt_native: string | null
  prompt_target: string | null
  expected_answer: string | null
  variables_json: string
  created_at: string
}

interface DbDrillAttempt {
  id: number
  pattern_id: number
  prompt_id: number | null
  card_id: number | null
  user_answer: string
  corrected_answer: string | null
  feedback: string | null
  score: number | null
  verdict: string | null
  mistake_types_json: string
  created_at: string
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function cleanPatternText(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, '')
    .trim()
}

function normalizePatternKey(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export class DatabaseService {
  private db!: Database.Database
  private initialized = false

  initialize(userDataPath: string): void {
    const dbPath = path.join(userDataPath, 'lexis.db')
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this.db.pragma('foreign_keys = ON')
    this.db.pragma('cache_size = -64000')
    this.initialized = true
    log.info(`Database opened at ${dbPath}`)
  }

  runMigrations(): void {
    this.assertInitialized()

    const MIGRATIONS: Array<{ version: number; sql: string }> = [
      {
        version: 1,
        sql: `
          CREATE TABLE IF NOT EXISTS media_sources (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            type          TEXT    NOT NULL CHECK(type IN ('subtitle', 'epub', 'web')),
            title         TEXT    NOT NULL,
            file_path     TEXT,
            source_url    TEXT,
            language      TEXT    NOT NULL,
            word_count    INTEGER,
            sentence_count INTEGER,
            cover_image   BLOB,
            added_at      TEXT    NOT NULL DEFAULT (datetime('now')),
            last_opened   TEXT
          );
          CREATE INDEX IF NOT EXISTS idx_media_sources_language ON media_sources(language);
          CREATE INDEX IF NOT EXISTS idx_media_sources_added ON media_sources(added_at DESC);

          CREATE TABLE IF NOT EXISTS sentences (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            source_id     INTEGER NOT NULL REFERENCES media_sources(id) ON DELETE CASCADE,
            content       TEXT    NOT NULL,
            translation   TEXT,
            position      INTEGER NOT NULL,
            start_time_ms INTEGER,
            end_time_ms   INTEGER,
            chapter_id    TEXT
          );
          CREATE INDEX IF NOT EXISTS idx_sentences_source ON sentences(source_id, position);

          CREATE TABLE IF NOT EXISTS reading_progress (
            source_id     INTEGER PRIMARY KEY REFERENCES media_sources(id) ON DELETE CASCADE,
            position      INTEGER NOT NULL DEFAULT 0,
            chapter_id    TEXT,
            updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
          );

          CREATE TABLE IF NOT EXISTS mined_words (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            word            TEXT    NOT NULL,
            reading         TEXT,
            language        TEXT    NOT NULL,
            source_id       INTEGER REFERENCES media_sources(id) ON DELETE SET NULL,
            sentence_id     INTEGER REFERENCES sentences(id) ON DELETE SET NULL,
            anki_note_id    INTEGER,
            anki_deck       TEXT,
            status          TEXT    NOT NULL DEFAULT 'queued'
                                    CHECK(status IN ('queued', 'synced', 'failed')),
            mined_at        TEXT    NOT NULL DEFAULT (datetime('now'))
          );
          CREATE INDEX IF NOT EXISTS idx_mined_words_word ON mined_words(word, language);
          CREATE INDEX IF NOT EXISTS idx_mined_words_status ON mined_words(status);
          CREATE INDEX IF NOT EXISTS idx_mined_words_date ON mined_words(mined_at DESC);
          CREATE INDEX IF NOT EXISTS idx_mined_words_deck ON mined_words(anki_deck);

          CREATE TABLE IF NOT EXISTS cards_queue (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            mined_word_id   INTEGER REFERENCES mined_words(id) ON DELETE CASCADE,
            deck_name       TEXT    NOT NULL,
            model_name      TEXT    NOT NULL DEFAULT 'Basic',
            front_html      TEXT    NOT NULL,
            back_html       TEXT    NOT NULL,
            tags_json       TEXT    NOT NULL DEFAULT '[]',
            audio_path      TEXT,
            audio_filename  TEXT,
            synced          INTEGER NOT NULL DEFAULT 0,
            anki_note_id    INTEGER,
            created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
            synced_at       TEXT
          );
          CREATE INDEX IF NOT EXISTS idx_cards_queue_synced ON cards_queue(synced, created_at);

          CREATE TABLE IF NOT EXISTS dict_cache (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            word            TEXT    NOT NULL,
            language        TEXT    NOT NULL,
            result_json     TEXT    NOT NULL,
            cached_at       TEXT    NOT NULL DEFAULT (datetime('now')),
            UNIQUE(word, language)
          );
          CREATE INDEX IF NOT EXISTS idx_dict_cache_lookup ON dict_cache(word, language);
        `,
      },
      {
        version: 2,
        sql: `
          CREATE TABLE IF NOT EXISTS decks (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT    NOT NULL UNIQUE,
            description TEXT,
            created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
          );

          INSERT OR IGNORE INTO decks (name, description) VALUES ('Default', 'Default deck');

          CREATE TABLE IF NOT EXISTS cards (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            deck_id         INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
            front_html      TEXT    NOT NULL,
            back_html       TEXT    NOT NULL,
            tags_json       TEXT    NOT NULL DEFAULT '[]',
            word            TEXT,
            reading         TEXT,
            language        TEXT,
            source_sentence TEXT,
            source_id       INTEGER REFERENCES media_sources(id) ON DELETE SET NULL,
            due_date     TEXT    NOT NULL DEFAULT (date('now')),
            interval     INTEGER NOT NULL DEFAULT 0,
            ease_factor  REAL    NOT NULL DEFAULT 2.5,
            reps         INTEGER NOT NULL DEFAULT 0,
            lapses       INTEGER NOT NULL DEFAULT 0,
            card_state   TEXT    NOT NULL DEFAULT 'new'
                                 CHECK(card_state IN ('new', 'learning', 'review', 'suspended')),
            created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
            last_reviewed TEXT
          );

          CREATE INDEX IF NOT EXISTS idx_cards_deck ON cards(deck_id);
          CREATE INDEX IF NOT EXISTS idx_cards_due  ON cards(due_date, card_state);
          CREATE INDEX IF NOT EXISTS idx_cards_word ON cards(word, language);

          CREATE TABLE IF NOT EXISTS review_log (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            card_id         INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
            reviewed_at     TEXT    NOT NULL DEFAULT (datetime('now')),
            rating          INTEGER NOT NULL CHECK(rating IN (1, 2, 3, 4)),
            interval_before INTEGER NOT NULL DEFAULT 0,
            interval_after  INTEGER NOT NULL DEFAULT 0,
            ease_before     REAL    NOT NULL DEFAULT 2.5,
            time_taken_ms   INTEGER
          );

          CREATE INDEX IF NOT EXISTS idx_review_log_card ON review_log(card_id, reviewed_at DESC);
          CREATE INDEX IF NOT EXISTS idx_review_log_date ON review_log(reviewed_at DESC);
        `,
      },
      {
        version: 3,
        sql: `
          ALTER TABLE cards ADD COLUMN native_definition TEXT;
          ALTER TABLE cards ADD COLUMN part_of_speech    TEXT;
          ALTER TABLE cards ADD COLUMN level_info        TEXT;
          ALTER TABLE cards ADD COLUMN audio_word        TEXT;
          ALTER TABLE cards ADD COLUMN step_index        INTEGER NOT NULL DEFAULT 0;

          CREATE TABLE IF NOT EXISTS definition_translations (
            word        TEXT NOT NULL,
            target_lang TEXT NOT NULL,
            native_lang TEXT NOT NULL,
            translation TEXT NOT NULL,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (word, target_lang, native_lang)
          );
        `,
      },
      {
        version: 4,
        sql: `
          CREATE TABLE IF NOT EXISTS patterns (
            id                 INTEGER PRIMARY KEY AUTOINCREMENT,
            deck_id            INTEGER REFERENCES decks(id) ON DELETE SET NULL,
            language           TEXT    NOT NULL,
            pattern_text       TEXT    NOT NULL,
            meaning_native     TEXT,
            explanation        TEXT,
            example_sentence   TEXT,
            source_sentence_id INTEGER REFERENCES sentences(id) ON DELETE SET NULL,
            source_id          INTEGER REFERENCES media_sources(id) ON DELETE SET NULL,
            tags_json          TEXT    NOT NULL DEFAULT '[]',
            created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
            updated_at         TEXT    NOT NULL DEFAULT (datetime('now'))
          );

          CREATE INDEX IF NOT EXISTS idx_patterns_deck ON patterns(deck_id);
          CREATE INDEX IF NOT EXISTS idx_patterns_lang ON patterns(language);

          CREATE TABLE IF NOT EXISTS drill_prompts (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            pattern_id      INTEGER NOT NULL REFERENCES patterns(id) ON DELETE CASCADE,
            type            TEXT    NOT NULL CHECK(type IN (
                              'translation',
                              'transform',
                              'substitution',
                              'free_production',
                              'cloze'
                            )),
            prompt_native   TEXT,
            prompt_target   TEXT,
            expected_answer TEXT,
            variables_json  TEXT NOT NULL DEFAULT '{}',
            created_at      TEXT NOT NULL DEFAULT (datetime('now'))
          );

          CREATE INDEX IF NOT EXISTS idx_drill_prompts_pattern ON drill_prompts(pattern_id);

          CREATE TABLE IF NOT EXISTS drill_attempts (
            id                 INTEGER PRIMARY KEY AUTOINCREMENT,
            pattern_id          INTEGER NOT NULL REFERENCES patterns(id) ON DELETE CASCADE,
            prompt_id           INTEGER REFERENCES drill_prompts(id) ON DELETE SET NULL,
            card_id             INTEGER REFERENCES cards(id) ON DELETE SET NULL,
            user_answer         TEXT    NOT NULL,
            corrected_answer    TEXT,
            feedback            TEXT,
            score               INTEGER CHECK(score BETWEEN 0 AND 100),
            verdict             TEXT CHECK(verdict IN ('correct', 'needs_fix', 'incorrect')),
            mistake_types_json  TEXT NOT NULL DEFAULT '[]',
            created_at          TEXT NOT NULL DEFAULT (datetime('now'))
          );

          CREATE INDEX IF NOT EXISTS idx_drill_attempts_pattern
            ON drill_attempts(pattern_id, created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_drill_attempts_card ON drill_attempts(card_id);
        `,
      },
    ]

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version     INTEGER PRIMARY KEY,
        applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)

    for (const migration of MIGRATIONS) {
      const alreadyApplied = this.db
        .prepare('SELECT 1 FROM schema_version WHERE version = ?')
        .get(migration.version)

      if (!alreadyApplied) {
        this.db.exec(migration.sql)
        this.db.prepare('INSERT OR IGNORE INTO schema_version (version) VALUES (?)').run(migration.version)
        log.info(`Applied migration v${migration.version}`)
      }
    }
  }

  // ─── Media Sources ───────────────────────────────────────────────────────────

  insertMediaSource(source: MediaSourceInsert): MediaSource {
    this.assertInitialized()
    const stmt = this.db.prepare(`
      INSERT INTO media_sources (type, title, file_path, source_url, language, word_count, sentence_count)
      VALUES (@type, @title, @filePath, @sourceUrl, @language, @wordCount, @sentenceCount)
    `)
    const result = stmt.run({
      type: source.type,
      title: source.title,
      filePath: source.filePath ?? null,
      sourceUrl: source.sourceUrl ?? null,
      language: source.language,
      wordCount: source.wordCount ?? null,
      sentenceCount: source.sentenceCount ?? null,
    })
    return this.getMediaSourceById(result.lastInsertRowid as number)!
  }

  getMediaSources(): MediaSource[] {
    this.assertInitialized()
    const rows = this.db
      .prepare('SELECT * FROM media_sources ORDER BY last_opened DESC, added_at DESC')
      .all() as DbMediaSource[]
    return rows.map(this.rowToMediaSource)
  }

  getMediaSourceById(id: number): MediaSource | null {
    this.assertInitialized()
    const row = this.db
      .prepare('SELECT * FROM media_sources WHERE id = ?')
      .get(id) as DbMediaSource | undefined
    return row ? this.rowToMediaSource(row) : null
  }

  deleteMediaSource(id: number): void {
    this.assertInitialized()
    this.db.prepare('DELETE FROM media_sources WHERE id = ?').run(id)
  }

  markOpened(id: number): void {
    this.assertInitialized()
    this.db
      .prepare("UPDATE media_sources SET last_opened = datetime('now') WHERE id = ?")
      .run(id)
  }

  // ─── Sentences ───────────────────────────────────────────────────────────────

  insertSentences(sentences: SentenceInsert[]): void {
    this.assertInitialized()
    const stmt = this.db.prepare(`
      INSERT INTO sentences (source_id, content, position, start_time_ms, end_time_ms, chapter_id)
      VALUES (@sourceId, @content, @position, @startTimeMs, @endTimeMs, @chapterId)
    `)
    const insertMany = this.db.transaction((rows: SentenceInsert[]) => {
      for (const row of rows) {
        stmt.run({
          sourceId: row.sourceId,
          content: row.content,
          position: row.position,
          startTimeMs: row.startTimeMs ?? null,
          endTimeMs: row.endTimeMs ?? null,
          chapterId: row.chapterId ?? null,
        })
      }
    })
    insertMany(sentences)
  }

  getSentencesBySourceId(sourceId: number): Sentence[] {
    this.assertInitialized()
    const rows = this.db
      .prepare('SELECT * FROM sentences WHERE source_id = ? ORDER BY position ASC')
      .all(sourceId) as DbSentence[]
    return rows.map(this.rowToSentence)
  }

  // ─── Reading Progress ────────────────────────────────────────────────────────

  saveProgress(sourceId: number, position: number, chapterId?: string): void {
    this.assertInitialized()
    this.db
      .prepare(`
        INSERT INTO reading_progress (source_id, position, chapter_id, updated_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(source_id) DO UPDATE SET
          position = excluded.position,
          chapter_id = excluded.chapter_id,
          updated_at = excluded.updated_at
      `)
      .run(sourceId, position, chapterId ?? null)
  }

  getProgress(sourceId: number): ReadingProgress | null {
    this.assertInitialized()
    const row = this.db
      .prepare('SELECT * FROM reading_progress WHERE source_id = ?')
      .get(sourceId) as DbReadingProgress | undefined
    if (!row) return null
    return {
      sourceId: row.source_id,
      position: row.position,
      chapterId: row.chapter_id ?? undefined,
      updatedAt: row.updated_at,
    }
  }

  // ─── Mined Words ─────────────────────────────────────────────────────────────

  insertMinedWord(word: {
    word: string
    reading?: string
    language: Language
    sourceId?: number
    sentenceId?: number
  }): MinedWord {
    this.assertInitialized()
    const result = this.db
      .prepare(`
        INSERT INTO mined_words (word, reading, language, source_id, sentence_id)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(
        word.word,
        word.reading ?? null,
        word.language,
        word.sourceId ?? null,
        word.sentenceId ?? null,
      )
    const row = this.db
      .prepare('SELECT * FROM mined_words WHERE id = ?')
      .get(result.lastInsertRowid) as DbMinedWord
    return this.rowToMinedWord(row)
  }

  getMinedWords(): MinedWord[] {
    this.assertInitialized()
    const rows = this.db
      .prepare('SELECT * FROM mined_words ORDER BY mined_at DESC')
      .all() as DbMinedWord[]
    return rows.map(this.rowToMinedWord)
  }

  getMinedWordsForSource(sourceId: number): string[] {
    this.assertInitialized()
    const rows = this.db
      .prepare('SELECT DISTINCT word FROM mined_words WHERE source_id = ?')
      .all(sourceId) as { word: string }[]
    return rows.map((r) => r.word)
  }

  // ─── Decks ────────────────────────────────────────────────────────────────────

  createDeck(name: string, description?: string): Deck {
    this.assertInitialized()
    const result = this.db
      .prepare('INSERT INTO decks (name, description) VALUES (?, ?)')
      .run(name, description ?? null)
    return this.getDeckById(result.lastInsertRowid as number)!
  }

  ensureDefaultDeck(): Deck {
    this.assertInitialized()
    const existing = this.db
      .prepare("SELECT * FROM decks WHERE name = 'Default' ORDER BY id ASC LIMIT 1")
      .get() as DbDeck | undefined
    if (existing) return this.rowToDeck(existing)

    return this.createDeck('Default', 'Default deck')
  }

  getDecks(): Deck[] {
    this.assertInitialized()
    this.ensureDefaultDeck()
    const rows = this.db
      .prepare(`
        SELECT
          d.*,
          COUNT(c.id) AS card_count,
          SUM(CASE WHEN c.due_date <= datetime('now') AND c.card_state != 'suspended' THEN 1 ELSE 0 END) AS due_count,
          SUM(CASE WHEN c.card_state = 'new' THEN 1 ELSE 0 END) AS new_count
        FROM decks d
        LEFT JOIN cards c ON c.deck_id = d.id
        GROUP BY d.id
        ORDER BY d.name ASC
      `)
      .all() as DbDeck[]
    return rows.map(this.rowToDeck)
  }

  getDeckById(id: number): Deck | null {
    this.assertInitialized()
    const row = this.db.prepare('SELECT * FROM decks WHERE id = ?').get(id) as DbDeck | undefined
    return row ? this.rowToDeck(row) : null
  }

  renameDeck(id: number, name: string): void {
    this.assertInitialized()
    this.db.prepare('UPDATE decks SET name = ? WHERE id = ?').run(name, id)
  }

  deleteDeck(id: number): void {
    this.assertInitialized()
    const deck = this.getDeckById(id)
    if (!deck) throw new Error(`Deck ${id} not found`)
    const cardCount = this.db
      .prepare('SELECT COUNT(*) as count FROM cards WHERE deck_id = ?')
      .get(id) as { count: number }
    if (cardCount.count > 0) {
      throw new Error('Deck must be empty before it can be deleted')
    }
    const deckCount = this.db.prepare('SELECT COUNT(*) as count FROM decks').get() as { count: number }
    if (deck.name === 'Default' && deckCount.count <= 1) {
      throw new Error('Default deck cannot be deleted while it is the only deck')
    }
    this.db.prepare('DELETE FROM decks WHERE id = ?').run(id)
  }

  // ─── Cards ────────────────────────────────────────────────────────────────────

  insertCard(draft: DraftCard): Card {
    this.assertInitialized()
    const deck = this.getDeckById(draft.deckId) ?? this.ensureDefaultDeck()
    const result = this.db
      .prepare(`
        INSERT INTO cards
          (deck_id, front_html, back_html, tags_json, word, reading, language,
           native_definition, part_of_speech, level_info, audio_word,
           source_sentence, source_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        deck.id,
        draft.frontHtml,
        draft.backHtml,
        JSON.stringify(draft.tags),
        draft.word ?? null,
        draft.reading ?? null,
        draft.language ?? null,
        draft.nativeDefinition ?? null,
        draft.partOfSpeech ?? null,
        draft.levelInfo ? JSON.stringify(draft.levelInfo) : null,
        draft.audioWord ?? null,
        draft.sourceSentence ?? null,
        draft.sourceId ?? null,
      )
    return this.getCard(result.lastInsertRowid as number)!
  }

  getCard(id: number): Card | null {
    this.assertInitialized()
    const row = this.db.prepare('SELECT * FROM cards WHERE id = ?').get(id) as DbCard | undefined
    return row ? this.rowToCard(row) : null
  }

  updateCardSRS(id: number, result: SRSResult): void {
    this.assertInitialized()
    this.db
      .prepare(`
        UPDATE cards
        SET due_date = ?, interval = ?, ease_factor = ?, reps = ?, lapses = ?,
            card_state = ?, step_index = ?, last_reviewed = datetime('now')
        WHERE id = ?
      `)
      .run(result.dueDate, result.interval, result.easeFactor, result.reps, result.lapses, result.cardState, result.stepIndex, id)
  }

  getDueCards(deckId: number, limit = 100): Card[] {
    this.assertInitialized()
    const rows = this.db
      .prepare(`
        SELECT * FROM cards
        WHERE deck_id = ? AND card_state != 'suspended' AND due_date <= datetime('now')
        ORDER BY card_state DESC, due_date ASC
        LIMIT ?
      `)
      .all(deckId, limit) as DbCard[]
    return rows.map(this.rowToCard)
  }

  getAllCards(deckId: number): Card[] {
    this.assertInitialized()
    const rows = this.db
      .prepare('SELECT * FROM cards WHERE deck_id = ? ORDER BY created_at DESC')
      .all(deckId) as DbCard[]
    return rows.map(this.rowToCard)
  }

  suspendCard(id: number): void {
    this.assertInitialized()
    this.db.prepare("UPDATE cards SET card_state = 'suspended' WHERE id = ?").run(id)
  }

  unsuspendCards(ids: number[]): void {
    this.assertInitialized()
    if (ids.length === 0) return
    const stmt = this.db.prepare(`
      UPDATE cards
      SET card_state = CASE
        WHEN reps = 0 THEN 'new'
        WHEN interval >= 21 THEN 'review'
        ELSE 'learning'
      END
      WHERE id = ?
    `)
    const updateMany = this.db.transaction((cardIds: number[]) => {
      for (const id of cardIds) stmt.run(id)
    })
    updateMany(ids)
  }

  moveCards(ids: number[], deckId: number): void {
    this.assertInitialized()
    if (ids.length === 0) return
    if (!this.getDeckById(deckId)) throw new Error(`Deck ${deckId} not found`)
    const stmt = this.db.prepare('UPDATE cards SET deck_id = ? WHERE id = ?')
    const moveMany = this.db.transaction((cardIds: number[]) => {
      for (const id of cardIds) stmt.run(deckId, id)
    })
    moveMany(ids)
  }

  deleteCard(id: number): void {
    this.assertInitialized()
    this.db.prepare('DELETE FROM cards WHERE id = ?').run(id)
  }

  updateCardContent(id: number, updates: CardUpdate): void {
    this.assertInitialized()
    if (updates.deckId !== undefined && !this.getDeckById(updates.deckId)) {
      throw new Error(`Deck ${updates.deckId} not found`)
    }
    this.db
      .prepare(`
        UPDATE cards
        SET deck_id = COALESCE(?, deck_id),
            front_html = ?,
            back_html = ?,
            tags_json = ?,
            word = ?,
            reading = ?,
            language = ?,
            source_sentence = ?,
            source_id = ?
        WHERE id = ?
      `)
      .run(
        updates.deckId ?? null,
        updates.frontHtml,
        updates.backHtml,
        JSON.stringify(updates.tags),
        updates.word ?? null,
        updates.reading ?? null,
        updates.language ?? null,
        updates.sourceSentence ?? null,
        updates.sourceId ?? null,
        id,
      )
  }

  isDuplicate(word: string, language: Language): boolean {
    this.assertInitialized()
    const row = this.db
      .prepare(
        "SELECT COUNT(*) as count FROM cards WHERE word = ? AND language = ? AND card_state != 'suspended'",
      )
      .get(word, language) as { count: number }
    return row.count > 0
  }

  // ─── Patterns + Active Production Drills ────────────────────────────────────

  createPattern(draft: PatternDraft): Pattern {
    this.assertInitialized()
    if (draft.deckId !== undefined && !this.getDeckById(draft.deckId)) {
      throw new Error(`Deck ${draft.deckId} not found`)
    }
    const patternText = cleanPatternText(draft.patternText)
    if (!patternText) throw new Error('Pattern is required')
    const duplicate = this.findDuplicatePattern(patternText, draft.language)
    if (duplicate) {
      throw new Error(`Duplicate pattern already exists: "${duplicate.patternText}"`)
    }
    log.info('[LexisDebug] create-pattern', {
      deckId: draft.deckId,
      language: draft.language,
      patternText,
      meaningNative: draft.meaningNative,
      explanation: draft.explanation,
      exampleSentence: draft.exampleSentence,
      sourceSentenceId: draft.sourceSentenceId,
      sourceId: draft.sourceId,
      tags: draft.tags,
    })
    const result = this.db
      .prepare(`
        INSERT INTO patterns (
          deck_id, language, pattern_text, meaning_native, explanation,
          example_sentence, source_sentence_id, source_id, tags_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        draft.deckId ?? null,
        draft.language,
        patternText,
        draft.meaningNative ?? null,
        draft.explanation ?? null,
        draft.exampleSentence ?? null,
        draft.sourceSentenceId ?? null,
        draft.sourceId ?? null,
        JSON.stringify(draft.tags),
      )
    return this.getPattern(result.lastInsertRowid as number)!
  }

  updatePattern(id: number, updates: PatternUpdate): void {
    this.assertInitialized()
    const current = this.getPattern(id)
    if (!current) throw new Error(`Pattern ${id} not found`)
    if (updates.deckId !== undefined && !this.getDeckById(updates.deckId)) {
      throw new Error(`Deck ${updates.deckId} not found`)
    }
    const nextPatternText = updates.patternText !== undefined
      ? cleanPatternText(updates.patternText)
      : current.patternText
    if (!nextPatternText) throw new Error('Pattern is required')
    const duplicate = this.findDuplicatePattern(nextPatternText, updates.language ?? current.language, id)
    if (duplicate) {
      throw new Error(`Duplicate pattern already exists: "${duplicate.patternText}"`)
    }

    this.db
      .prepare(`
        UPDATE patterns
        SET deck_id = ?,
            language = ?,
            pattern_text = ?,
            meaning_native = ?,
            explanation = ?,
            example_sentence = ?,
            source_sentence_id = ?,
            source_id = ?,
            tags_json = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `)
      .run(
        updates.deckId ?? current.deckId ?? null,
        updates.language ?? current.language,
        nextPatternText,
        updates.meaningNative ?? current.meaningNative ?? null,
        updates.explanation ?? current.explanation ?? null,
        updates.exampleSentence ?? current.exampleSentence ?? null,
        updates.sourceSentenceId ?? current.sourceSentenceId ?? null,
        updates.sourceId ?? current.sourceId ?? null,
        JSON.stringify(updates.tags ?? current.tags),
        id,
      )
  }

  getPattern(id: number): Pattern | null {
    this.assertInitialized()
    const row = this.db.prepare('SELECT * FROM patterns WHERE id = ?').get(id) as DbPattern | undefined
    return row ? this.rowToPattern(row) : null
  }

  listPatterns(filters: PatternFilters = {}): Pattern[] {
    this.assertInitialized()
    const conditions: string[] = []
    const params: Array<string | number> = []

    if (filters.deckId !== undefined) {
      conditions.push('deck_id = ?')
      params.push(filters.deckId)
    }
    if (filters.language !== undefined) {
      conditions.push('language = ?')
      params.push(filters.language)
    }
    if (filters.query?.trim()) {
      conditions.push(`(
        lower(pattern_text) LIKE ?
        OR lower(COALESCE(meaning_native, '')) LIKE ?
        OR lower(COALESCE(explanation, '')) LIKE ?
      )`)
      const query = `%${filters.query.trim().toLowerCase()}%`
      params.push(query, query, query)
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const rows = this.db
      .prepare(`SELECT * FROM patterns ${where} ORDER BY updated_at DESC, created_at DESC`)
      .all(...params) as DbPattern[]
    return rows.map(this.rowToPattern)
  }

  isDuplicatePattern(patternText: string, language: Language, excludeId?: number): boolean {
    this.assertInitialized()
    return this.findDuplicatePattern(patternText, language, excludeId) !== null
  }

  private findDuplicatePattern(patternText: string, language: Language, excludeId?: number): Pattern | null {
    const key = normalizePatternKey(patternText)
    if (!key) return null
    const rows = this.db
      .prepare('SELECT * FROM patterns WHERE language = ?')
      .all(language) as DbPattern[]
    const duplicate = rows.find((row) =>
      row.id !== excludeId && normalizePatternKey(row.pattern_text) === key,
    )
    return duplicate ? this.rowToPattern(duplicate) : null
  }

  deletePattern(id: number): void {
    this.assertInitialized()
    this.db.prepare('DELETE FROM patterns WHERE id = ?').run(id)
  }

  createDrillPrompt(draft: DrillPromptDraft): DrillPrompt {
    this.assertInitialized()
    if (!this.getPattern(draft.patternId)) throw new Error(`Pattern ${draft.patternId} not found`)
    const result = this.db
      .prepare(`
        INSERT INTO drill_prompts (
          pattern_id, type, prompt_native, prompt_target, expected_answer, variables_json
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(
        draft.patternId,
        draft.type,
        draft.promptNative ?? null,
        draft.promptTarget ?? null,
        draft.expectedAnswer ?? null,
        JSON.stringify(draft.variables ?? {}),
      )
    return this.getDrillPrompt(result.lastInsertRowid as number)!
  }

  getDrillPrompt(id: number): DrillPrompt | null {
    this.assertInitialized()
    const row = this.db
      .prepare('SELECT * FROM drill_prompts WHERE id = ?')
      .get(id) as DbDrillPrompt | undefined
    return row ? this.rowToDrillPrompt(row) : null
  }

  listDrillPrompts(patternId: number): DrillPrompt[] {
    this.assertInitialized()
    const rows = this.db
      .prepare('SELECT * FROM drill_prompts WHERE pattern_id = ? ORDER BY created_at DESC')
      .all(patternId) as DbDrillPrompt[]
    return rows.map(this.rowToDrillPrompt)
  }

  saveDrillAttempt(draft: DrillAttemptDraft): DrillAttempt {
    this.assertInitialized()
    if (!this.getPattern(draft.patternId)) throw new Error(`Pattern ${draft.patternId} not found`)
    if (draft.promptId !== undefined && !this.getDrillPrompt(draft.promptId)) {
      throw new Error(`Drill prompt ${draft.promptId} not found`)
    }
    if (draft.cardId !== undefined && !this.getCard(draft.cardId)) {
      throw new Error(`Card ${draft.cardId} not found`)
    }

    const result = this.db
      .prepare(`
        INSERT INTO drill_attempts (
          pattern_id, prompt_id, card_id, user_answer, corrected_answer,
          feedback, score, verdict, mistake_types_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        draft.patternId,
        draft.promptId ?? null,
        draft.cardId ?? null,
        draft.userAnswer,
        draft.correctedAnswer ?? null,
        draft.feedback ?? null,
        draft.score ?? null,
        draft.verdict ?? null,
        JSON.stringify(draft.mistakeTypes ?? []),
      )
    return this.getDrillAttempt(result.lastInsertRowid as number)!
  }

  getDrillAttempt(id: number): DrillAttempt | null {
    this.assertInitialized()
    const row = this.db
      .prepare('SELECT * FROM drill_attempts WHERE id = ?')
      .get(id) as DbDrillAttempt | undefined
    return row ? this.rowToDrillAttempt(row) : null
  }

  listDrillAttempts(patternId: number): DrillAttempt[] {
    this.assertInitialized()
    const rows = this.db
      .prepare('SELECT * FROM drill_attempts WHERE pattern_id = ? ORDER BY created_at DESC')
      .all(patternId) as DbDrillAttempt[]
    return rows.map(this.rowToDrillAttempt)
  }

  createReviewCardFromAttempt(attemptId: number, deckId: number): Card {
    this.assertInitialized()
    const attempt = this.getDrillAttempt(attemptId)
    if (!attempt) throw new Error(`Drill attempt ${attemptId} not found`)
    const pattern = this.getPattern(attempt.patternId)
    if (!pattern) throw new Error(`Pattern ${attempt.patternId} not found`)
    if (!this.getDeckById(deckId)) throw new Error(`Deck ${deckId} not found`)

    const prompt = attempt.promptId ? this.getDrillPrompt(attempt.promptId) : null
    const promptText = prompt?.promptNative ?? prompt?.promptTarget ?? pattern.exampleSentence ?? pattern.patternText
    const corrected = attempt.correctedAnswer ?? attempt.userAnswer

    const card = this.insertCard({
      deckId,
      template: 'DrillAttempt',
      frontHtml: [
        '<div style="color:#60a5fa;font-size:0.8em;font-weight:600;text-transform:uppercase;letter-spacing:0.04em">Pattern Drill</div>',
        `<div><strong>Your sentence:</strong><br>${escapeHtml(attempt.userAnswer)}</div>`,
        `<div style="color:#9ca3af;font-size:0.9em"><strong>Pattern:</strong> ${escapeHtml(pattern.patternText)}</div>`,
      ].join('<br>'),
      backHtml: [
        `<div><strong>Corrected:</strong><br>${escapeHtml(corrected)}</div>`,
        attempt.feedback ? `<div><strong>Feedback:</strong><br>${escapeHtml(attempt.feedback).replace(/\n/g, '<br>')}</div>` : '',
        pattern.exampleSentence && pattern.exampleSentence !== attempt.userAnswer
          ? `<div style="color:#9ca3af;font-size:0.9em"><strong>Source sentence:</strong><br>${escapeHtml(pattern.exampleSentence)}</div>`
          : '',
        `<div style="color:#6b7280;font-size:0.85em"><strong>Task:</strong> ${escapeHtml(promptText)}</div>`,
      ].filter(Boolean).join('<br><br>'),
      tags: ['drill', pattern.language, ...pattern.tags],
      word: attempt.userAnswer,
      language: pattern.language,
      nativeDefinition: pattern.meaningNative,
      sourceSentence: pattern.exampleSentence,
      sourceId: pattern.sourceId,
    })

    this.db.prepare('UPDATE drill_attempts SET card_id = ? WHERE id = ?').run(card.id, attemptId)
    return card
  }

  // ─── Review Log ───────────────────────────────────────────────────────────────

  logReview(entry: Omit<ReviewLog, 'id' | 'reviewedAt'>): void {
    this.assertInitialized()
    this.db
      .prepare(`
        INSERT INTO review_log
          (card_id, rating, interval_before, interval_after, ease_before, time_taken_ms)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(
        entry.cardId,
        entry.rating,
        entry.intervalBefore,
        entry.intervalAfter,
        entry.easeBefore,
        entry.timeTakenMs ?? null,
      )
  }

  // ─── Stats ────────────────────────────────────────────────────────────────────

  getCardCountByDay(days: number): DayStat[] {
    this.assertInitialized()
    const rows = this.db
      .prepare(`
        SELECT date(created_at) as date, COUNT(*) as count
        FROM cards
        WHERE created_at >= date('now', '-' || ? || ' days')
        GROUP BY date(created_at)
        ORDER BY date ASC
      `)
      .all(days) as DbDayStat[]
    return rows
  }

  getMinedCountByDay(days: number): DayStat[] {
    return this.getCardCountByDay(days)
  }

  getTotalCards(): number {
    this.assertInitialized()
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM cards')
      .get() as { count: number }
    return row.count
  }

  getTotalMined(): number {
    return this.getTotalCards()
  }

  getCardsCreatedToday(): number {
    this.assertInitialized()
    const row = this.db
      .prepare("SELECT COUNT(*) as count FROM cards WHERE date(created_at) = date('now')")
      .get() as { count: number }
    return row.count
  }

  getMinedToday(): number {
    return this.getCardsCreatedToday()
  }

  getReviewsToday(): number {
    this.assertInitialized()
    const row = this.db
      .prepare("SELECT COUNT(*) as count FROM review_log WHERE date(reviewed_at) = date('now')")
      .get() as { count: number }
    return row.count
  }

  getDueToday(): number {
    this.assertInitialized()
    const row = this.db
      .prepare("SELECT COUNT(*) as count FROM cards WHERE due_date <= datetime('now') AND card_state != 'suspended'")
      .get() as { count: number }
    return row.count
  }

  getCurrentStreak(): number {
    this.assertInitialized()
    const rows = this.db
      .prepare(`
        WITH daily AS (
          SELECT DISTINCT date(reviewed_at) as day
          FROM review_log
          ORDER BY day DESC
        ),
        numbered AS (
          SELECT
            day,
            ROW_NUMBER() OVER (ORDER BY day DESC) as rn,
            CAST(julianday(date('now')) - julianday(day) AS INTEGER) as days_ago
          FROM daily
        )
        SELECT COUNT(*) as streak
        FROM numbered
        WHERE days_ago = rn - 1
      `)
      .get() as { streak: number }
    return rows.streak
  }

  getLongestStreak(): number {
    this.assertInitialized()
    const row = this.db
      .prepare(`
        WITH daily AS (
          SELECT DISTINCT date(reviewed_at) as day
          FROM review_log
        ),
        gaps AS (
          SELECT day,
            CAST(julianday(day) - julianday(LAG(day, 1, NULL) OVER (ORDER BY day ASC)) AS INTEGER) as gap
          FROM daily
        ),
        groups AS (
          SELECT day,
            SUM(CASE WHEN gap IS NULL OR gap > 1 THEN 1 ELSE 0 END) OVER (ORDER BY day ASC) as grp
          FROM gaps
        ),
        runs AS (
          SELECT grp, COUNT(*) as run_len FROM groups GROUP BY grp
        )
        SELECT COALESCE(MAX(run_len), 0) as longest FROM runs
      `)
      .get() as { longest: number }
    return row.longest
  }

  getRetentionRate(): number {
    this.assertInitialized()
    const row = this.db
      .prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN rating >= 3 THEN 1 ELSE 0 END) as correct
        FROM review_log
      `)
      .get() as { total: number; correct: number | null }
    if (row.total === 0) return 0
    return Math.round(((row.correct ?? 0) / row.total) * 100)
  }

  getRecentCards(limit = 10): Card[] {
    this.assertInitialized()
    const rows = this.db
      .prepare('SELECT * FROM cards ORDER BY created_at DESC LIMIT ?')
      .all(limit) as DbCard[]
    return rows.map(this.rowToCard)
  }

  getMiningStats(): MiningStats {
    this.assertInitialized()
    const totalCards = this.getTotalCards()
    const cardsCreatedToday = this.getCardsCreatedToday()
    const reviewsToday = this.getReviewsToday()
    const dueToday = this.getDueToday()
    const retentionRate = this.getRetentionRate()
    const currentStreak = this.getCurrentStreak()
    const dailyHistory = this.getCardCountByDay(30)
    const recentCards = this.getRecentCards(10)

    const byLangRows = this.db
      .prepare(
        'SELECT language, COUNT(*) as count FROM cards WHERE language IS NOT NULL GROUP BY language',
      )
      .all() as { language: string; count: number }[]

    const byLanguage: Record<string, number> = {}
    for (const row of byLangRows) {
      byLanguage[row.language] = row.count
    }

    const longestStreak = this.getLongestStreak()

    return {
      totalCards,
      cardsCreatedToday,
      reviewsToday,
      dueToday,
      retentionRate,
      currentStreak,
      longestStreak,
      byLanguage,
      recentCards,
      dailyHistory,
    }
  }

  // ─── Dict Cache ───────────────────────────────────────────────────────────────

  getDictCache(word: string, language: string): string | null {
    this.assertInitialized()
    const row = this.db
      .prepare('SELECT result_json FROM dict_cache WHERE word = ? AND language = ?')
      .get(word, language) as { result_json: string } | undefined
    return row?.result_json ?? null
  }

  setDictCache(word: string, language: string, resultJson: string): void {
    this.assertInitialized()
    this.db
      .prepare(`
        INSERT INTO dict_cache (word, language, result_json)
        VALUES (?, ?, ?)
        ON CONFLICT(word, language) DO UPDATE SET result_json = excluded.result_json, cached_at = datetime('now')
      `)
      .run(word, language, resultJson)
  }

  cleanOldDictCache(): void {
    this.assertInitialized()
    this.db
      .prepare("DELETE FROM dict_cache WHERE cached_at < datetime('now', '-30 days')")
      .run()
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  private assertInitialized(): void {
    if (!this.initialized) throw new Error('DatabaseService not initialized')
  }

  private rowToMediaSource(row: DbMediaSource): MediaSource {
    return {
      id: row.id,
      type: row.type as MediaSource['type'],
      title: row.title,
      filePath: row.file_path ?? undefined,
      sourceUrl: row.source_url ?? undefined,
      language: row.language as Language,
      wordCount: row.word_count ?? undefined,
      sentenceCount: row.sentence_count ?? undefined,
      addedAt: row.added_at,
      lastOpened: row.last_opened ?? undefined,
    }
  }

  private rowToSentence(row: DbSentence): Sentence {
    return {
      id: row.id,
      sourceId: row.source_id,
      content: row.content,
      translation: row.translation ?? undefined,
      position: row.position,
      startTimeMs: row.start_time_ms ?? undefined,
      endTimeMs: row.end_time_ms ?? undefined,
      chapterId: row.chapter_id ?? undefined,
    }
  }

  private rowToMinedWord(row: DbMinedWord): MinedWord {
    return {
      id: row.id,
      word: row.word,
      reading: row.reading ?? undefined,
      language: row.language as Language,
      sourceId: row.source_id ?? undefined,
      sentenceId: row.sentence_id ?? undefined,
      minedAt: row.mined_at,
    }
  }

  private rowToDeck(row: DbDeck): Deck {
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      createdAt: row.created_at,
      cardCount: row.card_count ?? 0,
      dueCount: row.due_count ?? 0,
      newCount: row.new_count ?? 0,
    }
  }

  private rowToCard(row: DbCard): Card {
    return {
      id: row.id,
      deckId: row.deck_id,
      frontHtml: row.front_html,
      backHtml: row.back_html,
      tags: JSON.parse(row.tags_json) as string[],
      word: row.word ?? undefined,
      reading: row.reading ?? undefined,
      language: row.language as Language | undefined,
      nativeDefinition: row.native_definition ?? undefined,
      partOfSpeech: row.part_of_speech ?? undefined,
      levelInfo: row.level_info
        ? (JSON.parse(row.level_info) as { jlpt?: number; hsk?: number })
        : undefined,
      audioWord: row.audio_word ?? undefined,
      stepIndex: row.step_index,
      sourceSentence: row.source_sentence ?? undefined,
      sourceId: row.source_id ?? undefined,
      dueDate: row.due_date,
      interval: row.interval,
      easeFactor: row.ease_factor,
      reps: row.reps,
      lapses: row.lapses,
      cardState: row.card_state as CardState,
      createdAt: row.created_at,
      lastReviewed: row.last_reviewed ?? undefined,
    }
  }

  private rowToPattern(row: DbPattern): Pattern {
    return {
      id: row.id,
      deckId: row.deck_id ?? undefined,
      language: row.language as Language,
      patternText: row.pattern_text,
      meaningNative: row.meaning_native ?? undefined,
      explanation: row.explanation ?? undefined,
      exampleSentence: row.example_sentence ?? undefined,
      sourceSentenceId: row.source_sentence_id ?? undefined,
      sourceId: row.source_id ?? undefined,
      tags: JSON.parse(row.tags_json) as string[],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  private rowToDrillPrompt(row: DbDrillPrompt): DrillPrompt {
    return {
      id: row.id,
      patternId: row.pattern_id,
      type: row.type as DrillType,
      promptNative: row.prompt_native ?? undefined,
      promptTarget: row.prompt_target ?? undefined,
      expectedAnswer: row.expected_answer ?? undefined,
      variables: JSON.parse(row.variables_json) as Record<string, string>,
      createdAt: row.created_at,
    }
  }

  private rowToDrillAttempt(row: DbDrillAttempt): DrillAttempt {
    return {
      id: row.id,
      patternId: row.pattern_id,
      promptId: row.prompt_id ?? undefined,
      cardId: row.card_id ?? undefined,
      userAnswer: row.user_answer,
      correctedAnswer: row.corrected_answer ?? undefined,
      feedback: row.feedback ?? undefined,
      score: row.score ?? undefined,
      verdict: row.verdict ? row.verdict as DrillVerdict : undefined,
      mistakeTypes: JSON.parse(row.mistake_types_json) as string[],
      createdAt: row.created_at,
    }
  }

  getCachedTranslation(word: string, targetLang: Language, nativeLang: NativeLanguage): string | null {
    this.assertInitialized()
    const row = this.db
      .prepare('SELECT translation FROM definition_translations WHERE word = ? AND target_lang = ? AND native_lang = ?')
      .get(word, targetLang, nativeLang) as { translation: string } | undefined
    return row?.translation ?? null
  }

  cacheTranslation(entry: {
    word: string
    targetLang: Language
    nativeLang: NativeLanguage
    translation: string
  }): void {
    this.assertInitialized()
    this.db
      .prepare(`
        INSERT OR REPLACE INTO definition_translations (word, target_lang, native_lang, translation)
        VALUES (?, ?, ?, ?)
      `)
      .run(entry.word, entry.targetLang, entry.nativeLang, entry.translation)
  }
}

export const db = new DatabaseService()
