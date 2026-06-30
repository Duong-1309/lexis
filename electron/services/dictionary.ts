import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import log from 'electron-log'
import type { Language, DictEntry, DictReading, DictSense, Token } from '../../src/types/index'

// kuromoji types
interface KuromojiToken {
  surface_form: string
  reading?: string
  basic_form: string
  pos: string
  pos_detail_1: string
  word_position: number  // 1-indexed byte offset in text
}
interface KuromojiTokenizer {
  tokenize(text: string): KuromojiToken[]
}

// ─── Cache ───────────────────────────────────────────────────────────────────

const MAX_CACHE = 500
class LRUCache<K, V> {
  private map = new Map<K, V>()
  constructor(private max: number) {}
  get(k: K): V | undefined {
    const v = this.map.get(k)
    if (v !== undefined) { this.map.delete(k); this.map.set(k, v) }
    return v
  }
  set(k: K, v: V): void {
    if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value as K)
    this.map.set(k, v)
  }
}

// ─── Service ─────────────────────────────────────────────────────────────────

class DictionaryService {
  private dbs = new Map<string, Database.Database>()
  private cache = new LRUCache<string, DictEntry[]>(MAX_CACHE)
  private kuromojiTokenizer: KuromojiTokenizer | null = null
  private kuromojiReady = false
  private kuromojiLoading: Promise<void> | null = null
  private dictsDir = ''

  setDictsDir(dir: string): void {
    this.dictsDir = dir
  }

  // Open a dictionary DB (read-only after build)
  openDictionary(lang: Language, dbPath: string): void {
    if (!fs.existsSync(dbPath)) {
      log.warn(`Dictionary not found: ${dbPath}`)
      return
    }
    try {
      // Close existing if open
      if (this.dbs.has(lang)) {
        this.dbs.get(lang)?.close()
        this.dbs.delete(lang)
      }
      const db = new Database(dbPath, { readonly: true })
      this.dbs.set(lang, db)
      log.info(`Opened dictionary for ${lang}: ${dbPath}`)
    } catch (e) {
      log.error(`Failed to open dictionary ${dbPath}:`, e)
    }
  }

  // Try to open dictionary from user data dir (downloaded) or bundled dir
  tryOpenDictionary(lang: Language, userDictsDir: string, bundledDictsDir: string): boolean {
    const langToFile: Record<string, string> = {
      ja: 'jmdict.db',
      zh: 'cedict.db',
      en: 'wordnet.db',
    }
    const filename = langToFile[lang]
    if (!filename) return false

    // First try user downloaded location
    const userPath = path.join(userDictsDir, filename)
    if (fs.existsSync(userPath)) {
      this.openDictionary(lang, userPath)
      return true
    }

    // Then try bundled location
    const bundledPath = path.join(bundledDictsDir, filename)
    if (fs.existsSync(bundledPath)) {
      this.openDictionary(lang, bundledPath)
      return true
    }

    return false
  }

  isDictionaryLoaded(lang: Language): boolean {
    return this.dbs.has(lang)
  }

  closeDictionary(lang: Language): void {
    if (this.dbs.has(lang)) {
      this.dbs.get(lang)?.close()
      this.dbs.delete(lang)
      log.info(`Closed dictionary for ${lang}`)
    }
  }

  private async initKuromoji(): Promise<void> {
    if (this.kuromojiReady) return
    if (this.kuromojiLoading) return this.kuromojiLoading

    this.kuromojiLoading = new Promise<void>((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const kuromoji = require('kuromoji') as {
        builder(opts: { dicPath: string }): { build(cb: (err: Error | null, t: KuromojiTokenizer) => void): void }
      }
      const dicPath = path.join(require.resolve('kuromoji/package.json'), '..', 'dict')
      kuromoji.builder({ dicPath }).build((err, tokenizer) => {
        if (err) { reject(err); return }
        this.kuromojiTokenizer = tokenizer
        this.kuromojiReady = true
        log.info('Kuromoji tokenizer ready')
        resolve()
      })
    })

    return this.kuromojiLoading
  }

  // ─── Lookup ────────────────────────────────────────────────────────────────

  lookup(word: string, lang: Language): DictEntry[] {
    const normalizedWord = this.normalizeLookupTerm(word, lang)
    if (!normalizedWord) return []

    const cacheKey = `${lang}:${normalizedWord}`
    const cached = this.cache.get(cacheKey)
    if (cached) return cached

    let results: DictEntry[] = []
    if (lang === 'ja') results = this.lookupJMdict(normalizedWord)
    else if (lang === 'zh') results = this.lookupCEDICT(normalizedWord)
    else if (lang === 'en') results = this.lookupWordNet(normalizedWord)

    this.cache.set(cacheKey, results)
    return results
  }

  private normalizeLookupTerm(word: string, lang: Language): string {
    const trimmed = word.trim()
    if (!trimmed) return ''

    if (lang === 'en') {
      const match = trimmed.match(/[a-zA-ZÀ-ɏ]+(?:'[a-zA-Z]+)*/)
      return match?.[0].toLowerCase() ?? ''
    }

    return trimmed.replace(/^[\s"'“”‘’([{<]+|[\s"'“”‘’)\]}>.,;:!?]+$/g, '')
  }

  private escapeFts5Query(term: string): string {
    return `"${term.replace(/"/g, '""')}"`
  }

  private lookupJMdict(word: string): DictEntry[] {
    const db = this.dbs.get('ja')
    if (!db) return []

    try {
      // Try exact writings/readings first, then FTS
      const rows = db.prepare(`
        SELECT e.id, e.data_json FROM entries e
        WHERE e.writings LIKE ? OR e.readings LIKE ?
        LIMIT 10
      `).all(`%${word}%`, `%${word}%`) as { id: number; data_json: string }[]

      if (rows.length === 0) {
        const ftsRows = db.prepare(`
          SELECT e.id, e.data_json FROM entries_fts
          JOIN entries e ON e.id = entries_fts.rowid
          WHERE entries_fts MATCH ?
          LIMIT 10
        `).all(this.escapeFts5Query(word)) as { id: number; data_json: string }[]
        return ftsRows.map((r) => this.parseJMdictEntry(r.data_json))
      }

      return rows.map((r) => this.parseJMdictEntry(r.data_json))
    } catch (e) {
      log.error('JMdict lookup error:', e)
      return []
    }
  }

  private parseJMdictEntry(json: string): DictEntry {
    const raw = JSON.parse(json) as {
      id: number
      writings: Array<{ value: string; common: boolean }>
      readings: Array<{ value: string; common: boolean }>
      senses: Array<{ partOfSpeech: string[]; definitions: string[]; misc: string[] }>
    }

    const readings: DictReading[] = raw.readings.map((r) => ({
      value: r.value,
      common: r.common,
    }))

    const senses: DictSense[] = raw.senses.map((s) => ({
      partOfSpeech: s.partOfSpeech,
      definitions: s.definitions.filter(Boolean),
      misc: s.misc,
    }))

    return {
      word: raw.writings[0]?.value ?? raw.readings[0]?.value ?? '',
      language: 'ja',
      readings,
      senses,
    }
  }

  private lookupCEDICT(word: string): DictEntry[] {
    const db = this.dbs.get('zh')
    if (!db) return []

    try {
      const rows = db.prepare(`
        SELECT id, traditional, simplified, pinyin_pretty, definitions
        FROM entries
        WHERE simplified = ? OR traditional = ?
        LIMIT 10
      `).all(word, word) as { id: number; traditional: string; simplified: string; pinyin_pretty: string; definitions: string }[]

      return rows.map((r) => ({
        word: r.simplified,
        language: 'zh' as Language,
        readings: [{ value: r.pinyin_pretty, common: true }],
        senses: [{
          partOfSpeech: [],
          definitions: JSON.parse(r.definitions) as string[],
        }],
      }))
    } catch (e) {
      log.error('CEDICT lookup error:', e)
      return []
    }
  }

  // ─── Tokenize ──────────────────────────────────────────────────────────────

  async tokenize(text: string, lang: Language): Promise<Token[]> {
    if (lang === 'ja') return this.tokenizeJapanese(text)
    if (lang === 'zh') return this.tokenizeChinese(text)
    return this.tokenizeSimple(text)
  }

  private async tokenizeJapanese(text: string): Promise<Token[]> {
    await this.initKuromoji()
    if (!this.kuromojiTokenizer) return this.tokenizeSimple(text)

    const tokens = this.kuromojiTokenizer.tokenize(text)
    return tokens.map((t) => ({
      surface: t.surface_form,
      dictionaryForm: t.basic_form && t.basic_form !== '*' ? t.basic_form : t.surface_form,
      reading: t.reading,
      partOfSpeech: t.pos,
      offset: t.word_position - 1,
    }))
  }

  private tokenizeChinese(text: string): Token[] {
    const tokens: Token[] = []
    const cjk = /[一-鿿㐀-䶿]/
    let buf = ''
    let bufStart = 0
    let isCjk = false
    let i = 0

    const flush = () => {
      if (!buf) return
      if (isCjk) {
        let off = bufStart
        for (const ch of buf) {
          tokens.push({ surface: ch, dictionaryForm: ch, partOfSpeech: 'noun', offset: off })
          off += ch.length
        }
      } else {
        const words = buf.split(/(\s+)/)
        let off = bufStart
        for (const w of words) {
          if (w.trim()) tokens.push({ surface: w, dictionaryForm: w, offset: off })
          off += w.length
        }
      }
      buf = ''
    }

    for (const ch of text) {
      const c = cjk.test(ch)
      if (c !== isCjk) { flush(); isCjk = c; bufStart = i }
      buf += ch
      i += ch.length
    }
    flush()
    return tokens
  }

  private tokenizeSimple(text: string): Token[] {
    const tokens: Token[] = []
    // Match words (including contractions like don't, you're) or punctuation runs
    const re = /[a-zA-ZÀ-ɏ]+(?:'[a-zA-Z]+)*|[^\s\w]+/g
    let match: RegExpExecArray | null
    while ((match = re.exec(text)) !== null) {
      const surface = match[0]
      if (/[a-zA-ZÀ-ɏ]/.test(surface)) {
        tokens.push({ surface, dictionaryForm: surface.toLowerCase(), offset: match.index })
      }
    }
    return tokens
  }

  private lookupWordNet(word: string): DictEntry[] {
    const db = this.dbs.get('en')
    if (!db) return []

    try {
      // Strip common contraction suffixes: don't→do, I'm→I, you've→you
      const rawLower = word.toLowerCase()
      const isContraction = /'(t|s|re|ve|ll|d|m)$/.test(rawLower)
      let lower = rawLower.replace(/'(t|s|re|ve|ll|d|m)$/, '')

      let rows = db.prepare('SELECT data_json FROM entries WHERE lemma = ?')
        .all(lower) as { data_json: string }[]

      // Check exception forms table (went→go, mice→mouse, etc.)
      if (!rows.length) {
        const formRows = db.prepare('SELECT lemma FROM forms WHERE form = ?')
          .all(lower) as { lemma: string }[]
        if (formRows.length) {
          rows = db.prepare('SELECT data_json FROM entries WHERE lemma = ?')
            .all(formRows[0].lemma) as { data_json: string }[]
        }
      }

      // Apply simple suffix rules (runs→run, running→run, etc.)
      if (!rows.length) {
        const lemma = this.lemmatizeEnglish(lower)
        if (lemma) {
          rows = db.prepare('SELECT data_json FROM entries WHERE lemma = ?')
            .all(lemma) as { data_json: string }[]
        }
      }

      // FTS trigram fallback. Keep it for substantial lookup terms, but avoid
      // noisy semantic matches for short function words and contractions.
      if (!rows.length && !isContraction && lower.length >= 4) {
        const ftsRows = db.prepare(`
          SELECT e.data_json FROM entries_fts
          JOIN entries e ON e.id = entries_fts.rowid
          WHERE entries_fts MATCH ? LIMIT 10
        `).all(this.escapeFts5Query(lower)) as { data_json: string }[]

        // Filter FTS results: only keep entries where lemma starts with or contains searched term
        rows = ftsRows.filter((r) => {
          const entry = JSON.parse(r.data_json) as DictEntry
          const lemma = entry.word.toLowerCase()
          return lemma.startsWith(lower) || lemma.includes(lower) || lower.startsWith(lemma)
        })
      }

      return rows.map((r) => JSON.parse(r.data_json) as DictEntry)
    } catch (e) {
      log.error('WordNet lookup error:', e)
      return []
    }
  }

  private lemmatizeEnglish(word: string): string | null {
    const db = this.dbs.get('en')
    const has = (w: string) => {
      if (!db) return false
      return (db.prepare('SELECT 1 FROM entries WHERE lemma = ?').all(w) as unknown[]).length > 0
    }

    const rules: Array<[RegExp, string]> = [
      [/ies$/, 'y'],   // cries→cry
      [/ves$/, 'f'],   // wolves→wolf
      [/ves$/, 'fe'],  // knives→knife
      [/es$/, ''],     // boxes→box
      [/s$/, ''],      // cats→cat
      [/ied$/, 'y'],   // cried→cry
      [/ing$/, ''],    // running→runn (double consonant handled below)
      [/ing$/, 'e'],   // naming→name
      [/ed$/, ''],     // called→call
      [/ed$/, 'e'],    // named→name
      [/er$/, ''],     // faster→fast
      [/est$/, ''],    // fastest→fast
    ]

    for (const [pattern, replacement] of rules) {
      if (!pattern.test(word)) continue
      const stem = word.replace(pattern, replacement)
      if (stem.length < 2 || stem === word) continue
      if (has(stem)) return stem
      // Double consonant: running→run (runn→run)
      if (stem.length > 2 && stem[stem.length - 1] === stem[stem.length - 2]) {
        const deduped = stem.slice(0, -1)
        if (has(deduped)) return deduped
      }
    }
    return null
  }

  // ─── Autocomplete ──────────────────────────────────────────────────────────

  autocomplete(prefix: string, lang: Language): string[] {
    if (lang === 'ja') {
      const db = this.dbs.get('ja')
      if (!db) return []
      try {
        const rows = db.prepare(`
          SELECT writings FROM entries WHERE readings LIKE ? OR writings LIKE ? LIMIT 10
        `).all(`${prefix}%`, `${prefix}%`) as { writings: string }[]
        return rows.map((r) => r.writings.split(' ')[0]).filter(Boolean)
      } catch { return [] }
    }
    if (lang === 'zh') {
      const db = this.dbs.get('zh')
      if (!db) return []
      try {
        const rows = db.prepare(
          'SELECT simplified FROM entries WHERE simplified LIKE ? LIMIT 10'
        ).all(`${prefix}%`) as { simplified: string }[]
        return rows.map((r) => r.simplified)
      } catch { return [] }
    }
    if (lang === 'en') {
      const db = this.dbs.get('en')
      if (!db) return []
      try {
        const rows = db.prepare(
          'SELECT lemma FROM entries WHERE lemma LIKE ? LIMIT 10'
        ).all(`${prefix.toLowerCase()}%`) as { lemma: string }[]
        return rows.map((r) => r.lemma)
      } catch { return [] }
    }
    return []
  }

  close(): void {
    for (const db of this.dbs.values()) db.close()
    this.dbs.clear()
  }
}

export { DictionaryService }
export const dictService = new DictionaryService()
