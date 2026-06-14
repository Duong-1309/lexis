/**
 * Build dictionary SQLite databases from JMdict (Japanese) and CC-CEDICT (Chinese).
 * Run once after cloning: npm run build:dicts
 *
 * Uses node:sqlite (Node 22+ built-in) — no native compilation needed.
 *
 * Output:
 *   assets/dicts/jmdict.db   — Japanese dictionary (FTS5)
 *   assets/dicts/cedict.db   — Chinese dictionary
 */

import https from 'https'
import fs from 'fs'
import path from 'path'
import zlib from 'zlib'
import { execSync } from 'child_process'
import { DatabaseSync } from 'node:sqlite'
import { XMLParser } from 'fast-xml-parser'

const DICTS_DIR = path.join(__dirname, '..', 'assets', 'dicts')
fs.mkdirSync(DICTS_DIR, { recursive: true })

// ─── helpers ─────────────────────────────────────────────────────────────────

function download(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(dest)) { console.log(`  cached: ${path.basename(dest)}`); resolve(); return }
    console.log(`  downloading ${url}`)
    const file = fs.createWriteStream(dest)
    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close()
        fs.unlinkSync(dest)
        download(res.headers.location!, dest).then(resolve).catch(reject)
        return
      }
      res.pipe(file)
      file.on('finish', () => file.close(() => resolve()))
    }).on('error', (e) => { try { fs.unlinkSync(dest) } catch {} ; reject(e) })
  })
}

function gunzip(src: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(dest)) { resolve(); return }
    fs.createReadStream(src)
      .pipe(zlib.createGunzip())
      .pipe(fs.createWriteStream(dest))
      .on('finish', resolve)
      .on('error', reject)
  })
}

// ─── JMdict ──────────────────────────────────────────────────────────────────

async function buildJMdict(): Promise<void> {
  console.log('\n[JMdict] Building Japanese dictionary...')
  const dbPath = path.join(DICTS_DIR, 'jmdict.db')
  const gzPath = path.join(DICTS_DIR, 'JMdict_e.gz')
  const xmlPath = path.join(DICTS_DIR, 'JMdict_e.xml')

  await download('https://www.edrdg.org/pub/Nihongo/JMdict_e.gz', gzPath)
  await gunzip(gzPath, xmlPath)

  console.log('  parsing XML...')
  let xml = fs.readFileSync(xmlPath, 'utf-8')
  // Strip DTD — fast-xml-parser has a 1000 entity expansion limit that JMdict exceeds.
  // Convert &entity; refs to their names (e.g. &n; → n) which is what we want for POS codes.
  xml = xml.replace(/<!DOCTYPE[\s\S]*?\]>/m, '')
  xml = xml.replace(/&([a-zA-Z0-9_-]+);/g, '$1')

  const parser = new XMLParser({
    ignoreAttributes: false,
    processEntities: false,
    isArray: (name) =>
      ['k_ele', 'r_ele', 'sense', 'gloss', 'pos', 'misc', 'field', 'dial',
        'ke_inf', 're_inf', 'stagk', 'stagr', 'xref', 'ant'].includes(name),
  })
  const parsed = parser.parse(xml)
  const entries: unknown[] = parsed?.JMdict?.entry ?? []
  console.log(`  parsed ${entries.length} entries`)

  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec(`
    CREATE TABLE entries (
      id        INTEGER PRIMARY KEY,
      writings  TEXT NOT NULL,
      readings  TEXT NOT NULL,
      data_json TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE entries_fts USING fts5(
      writings, readings,
      content='entries', content_rowid='id',
      tokenize='trigram'
    );
  `)

  const insert = db.prepare('INSERT INTO entries (id, writings, readings, data_json) VALUES (?,?,?,?)')
  const insertFts = db.prepare('INSERT INTO entries_fts(rowid, writings, readings) VALUES (?,?,?)')

  let count = 0
  let batch: { id: number; writings: string; readings: string; data: string }[] = []

  const flushBatch = () => {
    if (!batch.length) return
    db.exec('BEGIN')
    for (const row of batch) {
      insert.run(row.id, row.writings, row.readings, row.data)
      insertFts.run(row.id, row.writings, row.readings)
    }
    db.exec('COMMIT')
    count += batch.length
    batch = []
    if (count % 10000 === 0) process.stdout.write(`\r  inserting... ${count}`)
  }

  for (const entry of entries as Record<string, unknown>[]) {
    const id = Number(entry['ent_seq'])
    const kEle = (entry['k_ele'] as Record<string, unknown>[] | undefined) ?? []
    const rEle = (entry['r_ele'] as Record<string, unknown>[] | undefined) ?? []
    const senses = (entry['sense'] as Record<string, unknown>[] | undefined) ?? []

    const writings = kEle.map((k) => String(k['keb'] ?? '')).filter(Boolean)
    const readings = rEle.map((r) => String(r['reb'] ?? '')).filter(Boolean)

    const data = {
      id,
      writings: writings.map((w) => ({ value: w, common: false })),
      readings: readings.map((r) => ({ value: r, common: false })),
      senses: senses.map((s) => ({
        partOfSpeech: ((s['pos'] as string[]) ?? []).map(String),
        definitions: ((s['gloss'] as unknown[]) ?? []).map((g) =>
          typeof g === 'object' && g !== null
            ? String((g as Record<string, unknown>)['#text'] ?? g)
            : String(g)
        ),
        misc: ((s['misc'] as string[]) ?? []).map(String),
      })),
    }

    batch.push({
      id,
      writings: [...writings, ...readings].join(' '),
      readings: readings.join(' '),
      data: JSON.stringify(data),
    })

    if (batch.length >= 500) flushBatch()
  }
  flushBatch()

  db.close()
  console.log(`\n  done: ${count} entries → ${dbPath}`)
}

// ─── CEDICT ──────────────────────────────────────────────────────────────────

async function buildCEDICT(): Promise<void> {
  console.log('\n[CEDICT] Building Chinese dictionary...')
  const dbPath = path.join(DICTS_DIR, 'cedict.db')
  const gzPath = path.join(DICTS_DIR, 'cedict.txt.gz')
  const txtPath = path.join(DICTS_DIR, 'cedict.txt')

  await download('https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz', gzPath)
  await gunzip(gzPath, txtPath)

  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec(`
    CREATE TABLE entries (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      traditional   TEXT NOT NULL,
      simplified    TEXT NOT NULL,
      pinyin        TEXT NOT NULL,
      pinyin_pretty TEXT NOT NULL,
      definitions   TEXT NOT NULL
    );
    CREATE INDEX idx_simplified  ON entries(simplified);
    CREATE INDEX idx_traditional ON entries(traditional);
    CREATE VIRTUAL TABLE entries_fts USING fts5(
      simplified, traditional,
      content='entries', content_rowid='id'
    );
  `)

  const insert = db.prepare(
    'INSERT INTO entries (traditional, simplified, pinyin, pinyin_pretty, definitions) VALUES (?,?,?,?,?)'
  )
  const insertFts = db.prepare('INSERT INTO entries_fts(rowid, simplified, traditional) VALUES (?,?,?)')

  const toneMap: Record<string, string> = { '1': '̄', '2': '́', '3': '̌', '4': '̀', '5': '' }
  const vowels = 'aeiouüāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ'

  function toPrettyPinyin(pinyin: string): string {
    return pinyin.replace(/([a-züÜ]+)(\d)/gi, (_, syl: string, tone: string) => {
      const mark = toneMap[tone] ?? ''
      if (!mark) return syl
      for (let i = syl.length - 1; i >= 0; i--) {
        if (vowels.includes(syl[i].toLowerCase())) {
          return syl.slice(0, i + 1) + mark + syl.slice(i + 1)
        }
      }
      return syl + mark
    })
  }

  const lines = fs.readFileSync(txtPath, 'utf-8').split('\n').map((l) => l.trimEnd())
  let count = 0
  let batch: { trad: string; simp: string; pinyin: string; pretty: string; defs: string }[] = []

  const flushBatch = () => {
    if (!batch.length) return
    db.exec('BEGIN')
    for (const row of batch) {
      const result = insert.run(row.trad, row.simp, row.pinyin, row.pretty, row.defs)
      insertFts.run(Number(result.lastInsertRowid), row.simp, row.trad)
    }
    db.exec('COMMIT')
    count += batch.length
    batch = []
  }

  for (const line of lines) {
    if (line.startsWith('#') || !line.trim()) continue
    const match = line.match(/^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+\/(.+)\/$/)
    if (!match) continue
    const [, trad, simp, pinyin, defStr] = match
    const defs = defStr.split('/').map((d) => d.trim()).filter(Boolean)
    batch.push({ trad, simp, pinyin, pretty: toPrettyPinyin(pinyin), defs: JSON.stringify(defs) })
    if (batch.length >= 500) flushBatch()
  }
  flushBatch()

  db.close()
  console.log(`  done: ${count} entries → ${dbPath}`)
}

// ─── WordNet (English) ───────────────────────────────────────────────────────

const POS_LABEL: Record<string, string> = { n: 'noun', v: 'verb', a: 'adjective', s: 'adjective', r: 'adverb' }

async function buildWordNet(): Promise<void> {
  console.log('\n[WordNet] Building English dictionary...')
  const dbPath = path.join(DICTS_DIR, 'wordnet.db')
  const tgzPath = path.join(DICTS_DIR, 'wn3.1.dict.tar.gz')
  const extractDir = path.join(DICTS_DIR, 'wn31')

  await download('https://wordnetcode.princeton.edu/wn3.1.dict.tar.gz', tgzPath)

  const dictDir = path.join(extractDir, 'dict')
  if (!fs.existsSync(dictDir)) {
    console.log('  extracting...')
    fs.mkdirSync(extractDir, { recursive: true })
    execSync(`tar xzf "${tgzPath}" -C "${extractDir}"`, { stdio: 'pipe' })
  }

  console.log('  parsing synsets...')

  // Step 1: parse all data files → offset → { pos, definition, examples }
  type SynsetData = { pos: string; definition: string; examples: string[] }
  const synsets = new Map<string, SynsetData>()

  for (const pos of ['noun', 'verb', 'adj', 'adv']) {
    const content = fs.readFileSync(path.join(dictDir, `data.${pos}`), 'utf-8')
    for (const line of content.split('\n')) {
      if (line.startsWith('  ') || !line.trim()) continue
      const pipeIdx = line.indexOf(' | ')
      if (pipeIdx === -1) continue

      const tokens = line.slice(0, pipeIdx).trim().split(' ')
      const offset = tokens[0]
      const ssType = tokens[2]

      // Parse gloss: "definition; "example1"; "example2""
      const gloss = line.slice(pipeIdx + 3).trim()
      const semiIdx = gloss.indexOf('; "')
      const definition = semiIdx === -1 ? gloss : gloss.slice(0, semiIdx).trim()
      const examples: string[] = []
      const exMatches = gloss.match(/"([^"]+)"/g)
      if (exMatches) examples.push(...exMatches.map((e) => e.slice(1, -1)))

      synsets.set(offset, { pos: POS_LABEL[ssType] ?? ssType, definition, examples })
    }
  }

  // Step 2: parse index files → lemma → list of senses
  type Sense = { pos: string; definition: string; examples: string[] }
  const lemmaMap = new Map<string, Sense[]>()

  for (const pos of ['noun', 'verb', 'adj', 'adv']) {
    const content = fs.readFileSync(path.join(dictDir, `index.${pos}`), 'utf-8')
    for (const line of content.split('\n')) {
      if (line.startsWith('  ') || !line.trim()) continue
      const tokens = line.split(' ')
      const lemma = tokens[0].replace(/_/g, ' ')
      const synsetCnt = parseInt(tokens[2])
      const pCnt = parseInt(tokens[3])
      const offsetStart = 4 + pCnt + 2

      const senses: Sense[] = []
      for (let i = 0; i < synsetCnt; i++) {
        const synset = synsets.get(tokens[offsetStart + i])
        if (synset) senses.push(synset)
      }
      if (senses.length) lemmaMap.set(lemma, senses)
    }
  }

  // Step 3: parse exception files → inflected form → base lemma
  const forms = new Map<string, string>() // form → lemma
  for (const pos of ['noun', 'verb', 'adj', 'adv']) {
    const excPath = path.join(dictDir, `${pos}.exc`)
    if (!fs.existsSync(excPath)) continue
    for (const line of fs.readFileSync(excPath, 'utf-8').split('\n')) {
      const [form, lemma] = line.trim().split(' ')
      if (form && lemma && lemmaMap.has(lemma)) forms.set(form, lemma)
    }
  }

  console.log(`  ${lemmaMap.size} lemmas, ${forms.size} exception forms`)

  // Step 4: build SQLite
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec(`
    CREATE TABLE entries (
      id    INTEGER PRIMARY KEY AUTOINCREMENT,
      lemma TEXT NOT NULL,
      data_json TEXT NOT NULL
    );
    CREATE UNIQUE INDEX idx_lemma ON entries(lemma);
    CREATE VIRTUAL TABLE entries_fts USING fts5(
      lemma, content='entries', content_rowid='id', tokenize='trigram'
    );
    CREATE TABLE forms (form TEXT NOT NULL, lemma TEXT NOT NULL);
    CREATE INDEX idx_form ON forms(form);
  `)

  const insertEntry = db.prepare('INSERT INTO entries (lemma, data_json) VALUES (?,?)')
  const insertFts = db.prepare('INSERT INTO entries_fts(rowid, lemma) VALUES (?,?)')
  const insertForm = db.prepare('INSERT INTO forms (form, lemma) VALUES (?,?)')

  let count = 0
  let batch: { lemma: string; data: string }[] = []

  const flushEntries = () => {
    if (!batch.length) return
    db.exec('BEGIN')
    for (const row of batch) {
      const result = insertEntry.run(row.lemma, row.data)
      insertFts.run(Number(result.lastInsertRowid), row.lemma)
    }
    db.exec('COMMIT')
    count += batch.length
    batch = []
  }

  for (const [lemma, senses] of lemmaMap) {
    // Group senses by POS
    const byPos = new Map<string, { defs: string[]; examples: string[] }>()
    for (const s of senses) {
      if (!byPos.has(s.pos)) byPos.set(s.pos, { defs: [], examples: [] })
      const g = byPos.get(s.pos)!
      if (!g.defs.includes(s.definition)) {
        g.defs.push(s.definition)
        if (s.examples[0]) g.examples.push(s.examples[0])
      }
    }

    const dictSenses = Array.from(byPos.entries()).map(([pos, g]) => ({
      partOfSpeech: [pos],
      definitions: g.defs.slice(0, 6),
      examples: g.examples.slice(0, 2),
    }))

    batch.push({
      lemma,
      data: JSON.stringify({ word: lemma, language: 'en', readings: [], senses: dictSenses }),
    })
    if (batch.length >= 500) flushEntries()
  }
  flushEntries()

  // Insert exception forms
  db.exec('BEGIN')
  for (const [form, lemma] of forms) insertForm.run(form, lemma)
  db.exec('COMMIT')

  db.close()
  console.log(`  done: ${count} entries → ${dbPath}`)
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const targets = process.argv.slice(2)
  const all = targets.length === 0
  console.log('Building dictionaries...')
  if (all || targets.includes('ja')) await buildJMdict()
  if (all || targets.includes('zh')) await buildCEDICT()
  if (all || targets.includes('en')) await buildWordNet()
  console.log('\nAll done.')
}

main().catch((e) => { console.error(e); process.exit(1) })
