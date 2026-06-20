/**
 * Build dictionary SQLite databases from source files at runtime.
 * Adapts scripts/build-dict.ts to use better-sqlite3 for Electron.
 */

import https from 'https'
import fs from 'fs'
import path from 'path'
import zlib from 'zlib'
import { execSync } from 'child_process'
import Database from 'better-sqlite3'
import { XMLParser } from 'fast-xml-parser'
import { BrowserWindow } from 'electron'
import type { DictionaryId } from '../../src/types/index'

type ProgressCallback = (stage: string, progress: number) => void

// Source URLs
const SOURCES: Record<DictionaryId, { url: string; type: 'gz' | 'tgz' }> = {
  jmdict: {
    url: 'https://www.edrdg.org/pub/Nihongo/JMdict_e.gz',
    type: 'gz',
  },
  cedict: {
    url: 'https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz',
    type: 'gz',
  },
  wordnet: {
    url: 'https://wordnetcode.princeton.edu/wn3.1.dict.tar.gz',
    type: 'tgz',
  },
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function downloadWithProgress(
  url: string,
  dest: string,
  onProgress: (downloaded: number, total: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(dest)) {
      resolve()
      return
    }

    const file = fs.createWriteStream(dest)

    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close()
        fs.unlinkSync(dest)
        downloadWithProgress(res.headers.location!, dest, onProgress)
          .then(resolve)
          .catch(reject)
        return
      }

      if (res.statusCode !== 200) {
        file.close()
        fs.unlinkSync(dest)
        reject(new Error(`HTTP ${res.statusCode}`))
        return
      }

      const total = parseInt(res.headers['content-length'] ?? '0', 10)
      let downloaded = 0

      res.on('data', (chunk: Buffer) => {
        downloaded += chunk.length
        onProgress(downloaded, total)
      })

      res.pipe(file)
      file.on('finish', () => file.close(() => resolve()))
    }).on('error', (e) => {
      try { fs.unlinkSync(dest) } catch {}
      reject(e)
    })
  })
}

function gunzip(src: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(dest)) {
      resolve()
      return
    }
    fs.createReadStream(src)
      .pipe(zlib.createGunzip())
      .pipe(fs.createWriteStream(dest))
      .on('finish', resolve)
      .on('error', reject)
  })
}

// ─── JMdict Builder ──────────────────────────────────────────────────────────

async function buildJMdict(
  dictsDir: string,
  onProgress: ProgressCallback
): Promise<string> {
  const dbPath = path.join(dictsDir, 'jmdict.db')
  const gzPath = path.join(dictsDir, 'JMdict_e.gz')
  const xmlPath = path.join(dictsDir, 'JMdict_e.xml')

  // Download
  onProgress('Downloading JMdict...', 0)
  await downloadWithProgress(SOURCES.jmdict.url, gzPath, (dl, total) => {
    onProgress('Downloading JMdict...', total > 0 ? Math.round((dl / total) * 30) : 0)
  })

  // Extract
  onProgress('Extracting...', 30)
  await gunzip(gzPath, xmlPath)

  // Parse XML
  onProgress('Parsing XML...', 35)
  let xml = fs.readFileSync(xmlPath, 'utf-8')
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

  // Build SQLite
  onProgress('Building database...', 50)
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
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

  const insertMany = db.transaction((batch: { id: number; writings: string; readings: string; data: string }[]) => {
    for (const row of batch) {
      insert.run(row.id, row.writings, row.readings, row.data)
      insertFts.run(row.id, row.writings, row.readings)
    }
  })

  let count = 0
  let batch: { id: number; writings: string; readings: string; data: string }[] = []
  const totalEntries = entries.length

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

    if (batch.length >= 500) {
      insertMany(batch)
      count += batch.length
      batch = []
      onProgress('Building database...', 50 + Math.round((count / totalEntries) * 50))
    }
  }

  if (batch.length > 0) {
    insertMany(batch)
  }

  db.close()
  onProgress('Done', 100)

  // Cleanup source files
  try { fs.unlinkSync(gzPath) } catch {}
  try { fs.unlinkSync(xmlPath) } catch {}

  return dbPath
}

// ─── CEDICT Builder ──────────────────────────────────────────────────────────

async function buildCEDICT(
  dictsDir: string,
  onProgress: ProgressCallback
): Promise<string> {
  const dbPath = path.join(dictsDir, 'cedict.db')
  const gzPath = path.join(dictsDir, 'cedict.txt.gz')
  const txtPath = path.join(dictsDir, 'cedict.txt')

  // Download
  onProgress('Downloading CEDICT...', 0)
  await downloadWithProgress(SOURCES.cedict.url, gzPath, (dl, total) => {
    onProgress('Downloading CEDICT...', total > 0 ? Math.round((dl / total) * 30) : 0)
  })

  // Extract
  onProgress('Extracting...', 30)
  await gunzip(gzPath, txtPath)

  // Build SQLite
  onProgress('Building database...', 40)
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
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

  const toneMap: Record<string, string> = { '1': '\u0304', '2': '\u0301', '3': '\u030C', '4': '\u0300', '5': '' }
  const vowels = 'aeiou\u00FC\u0101\u00E1\u01CE\u00E0\u0113\u00E9\u011B\u00E8\u012B\u00ED\u01D0\u00EC\u014D\u00F3\u01D2\u00F2\u016B\u00FA\u01D4\u00F9\u01D6\u01D8\u01DA\u01DC'

  function toPrettyPinyin(pinyin: string): string {
    return pinyin.replace(/([a-z\u00FC\u00DC]+)(\d)/gi, (_, syl: string, tone: string) => {
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

  const lines = fs.readFileSync(txtPath, 'utf-8').split('\n')
  const totalLines = lines.length

  const insertMany = db.transaction((batch: { trad: string; simp: string; pinyin: string; pretty: string; defs: string }[]) => {
    for (const row of batch) {
      const result = insert.run(row.trad, row.simp, row.pinyin, row.pretty, row.defs)
      insertFts.run(result.lastInsertRowid, row.simp, row.trad)
    }
  })

  let count = 0
  let batch: { trad: string; simp: string; pinyin: string; pretty: string; defs: string }[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd()
    if (line.startsWith('#') || !line.trim()) continue
    const match = line.match(/^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+\/(.+)\/$/)
    if (!match) continue
    const [, trad, simp, pinyin, defStr] = match
    const defs = defStr.split('/').map((d) => d.trim()).filter(Boolean)
    batch.push({ trad, simp, pinyin, pretty: toPrettyPinyin(pinyin), defs: JSON.stringify(defs) })

    if (batch.length >= 500) {
      insertMany(batch)
      count += batch.length
      batch = []
      onProgress('Building database...', 40 + Math.round((i / totalLines) * 60))
    }
  }

  if (batch.length > 0) {
    insertMany(batch)
  }

  db.close()
  onProgress('Done', 100)

  // Cleanup
  try { fs.unlinkSync(gzPath) } catch {}
  try { fs.unlinkSync(txtPath) } catch {}

  return dbPath
}

// ─── WordNet Builder ─────────────────────────────────────────────────────────

const POS_LABEL: Record<string, string> = { n: 'noun', v: 'verb', a: 'adjective', s: 'adjective', r: 'adverb' }

async function buildWordNet(
  dictsDir: string,
  onProgress: ProgressCallback
): Promise<string> {
  const dbPath = path.join(dictsDir, 'wordnet.db')
  const tgzPath = path.join(dictsDir, 'wn3.1.dict.tar.gz')
  const extractDir = path.join(dictsDir, 'wn31')

  // Download
  onProgress('Downloading WordNet...', 0)
  await downloadWithProgress(SOURCES.wordnet.url, tgzPath, (dl, total) => {
    onProgress('Downloading WordNet...', total > 0 ? Math.round((dl / total) * 20) : 0)
  })

  // Extract
  onProgress('Extracting...', 20)
  const dictDir = path.join(extractDir, 'dict')
  if (!fs.existsSync(dictDir)) {
    fs.mkdirSync(extractDir, { recursive: true })
    execSync(`tar xzf "${tgzPath}" -C "${extractDir}"`, { stdio: 'pipe' })
  }

  // Parse synsets
  onProgress('Parsing synsets...', 30)
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

      const gloss = line.slice(pipeIdx + 3).trim()
      const semiIdx = gloss.indexOf('; "')
      const definition = semiIdx === -1 ? gloss : gloss.slice(0, semiIdx).trim()
      const examples: string[] = []
      const exMatches = gloss.match(/"([^"]+)"/g)
      if (exMatches) examples.push(...exMatches.map((e) => e.slice(1, -1)))

      synsets.set(offset, { pos: POS_LABEL[ssType] ?? ssType, definition, examples })
    }
  }

  // Parse index files
  onProgress('Parsing lemmas...', 50)
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

  // Parse exception files
  const forms = new Map<string, string>()
  for (const pos of ['noun', 'verb', 'adj', 'adv']) {
    const excPath = path.join(dictDir, `${pos}.exc`)
    if (!fs.existsSync(excPath)) continue
    for (const line of fs.readFileSync(excPath, 'utf-8').split('\n')) {
      const [form, lemma] = line.trim().split(' ')
      if (form && lemma && lemmaMap.has(lemma)) forms.set(form, lemma)
    }
  }

  // Build SQLite
  onProgress('Building database...', 60)
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
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

  const insertEntries = db.transaction((batch: { lemma: string; data: string }[]) => {
    for (const row of batch) {
      const result = insertEntry.run(row.lemma, row.data)
      insertFts.run(result.lastInsertRowid, row.lemma)
    }
  })

  let count = 0
  let batch: { lemma: string; data: string }[] = []
  const totalLemmas = lemmaMap.size

  for (const [lemma, senses] of lemmaMap) {
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

    if (batch.length >= 500) {
      insertEntries(batch)
      count += batch.length
      batch = []
      onProgress('Building database...', 60 + Math.round((count / totalLemmas) * 35))
    }
  }

  if (batch.length > 0) {
    insertEntries(batch)
  }

  // Insert exception forms
  const insertForms = db.transaction((formsList: [string, string][]) => {
    for (const [form, lemma] of formsList) {
      insertForm.run(form, lemma)
    }
  })
  insertForms(Array.from(forms.entries()))

  db.close()
  onProgress('Done', 100)

  // Cleanup
  try { fs.unlinkSync(tgzPath) } catch {}
  try { fs.rmSync(extractDir, { recursive: true }) } catch {}

  return dbPath
}

// ─── Main Export ─────────────────────────────────────────────────────────────

export async function buildDictionary(
  id: DictionaryId,
  dictsDir: string,
  mainWindow: BrowserWindow | null
): Promise<string> {
  const onProgress: ProgressCallback = (stage, progress) => {
    mainWindow?.webContents.send('dictionary:download-progress', {
      id,
      progress,
      stage,
      downloadedBytes: 0,
      totalBytes: 0,
    })
  }

  fs.mkdirSync(dictsDir, { recursive: true })

  switch (id) {
    case 'jmdict':
      return buildJMdict(dictsDir, onProgress)
    case 'cedict':
      return buildCEDICT(dictsDir, onProgress)
    case 'wordnet':
      return buildWordNet(dictsDir, onProgress)
    default:
      throw new Error(`Unknown dictionary: ${id}`)
  }
}
