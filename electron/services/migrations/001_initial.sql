PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA foreign_keys=ON;
PRAGMA cache_size=-64000;

CREATE TABLE IF NOT EXISTS schema_version (
  version     INTEGER PRIMARY KEY,
  applied_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS media_sources (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  type          TEXT    NOT NULL CHECK(type IN ('subtitle', 'epub', 'web', 'text')),
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
