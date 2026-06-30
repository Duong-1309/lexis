/**
 * WordNet Dictionary Test Script
 * Run: npx tsx scripts/test-wordnet.ts
 */

import { DatabaseSync } from 'node:sqlite'
import path from 'path'
import fs from 'fs'

const DICT_PATH = path.join(__dirname, '../assets/dicts/wordnet.db')

interface DictEntry {
  word: string
  language: string
  readings: unknown[]
  senses: Array<{
    partOfSpeech: string[]
    definitions: string[]
    examples?: string[]
  }>
}

let passed = 0
let failed = 0

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✓ ${message}`)
    passed++
  } else {
    console.log(`  ✗ ${message}`)
    failed++
  }
}

function assertIncludes(arr: string[], value: string, message: string): void {
  assert(arr.includes(value), message)
}

function assertNotIncludes(arr: string[], value: string, message: string): void {
  assert(!arr.includes(value), message)
}

function assertMatches(text: string, pattern: RegExp, message: string): void {
  assert(pattern.test(text), message)
}

function assertNotMatches(text: string, pattern: RegExp, message: string): void {
  assert(!pattern.test(text), message)
}

async function main() {
  console.log('\n=== WordNet Dictionary Tests ===\n')

  if (!fs.existsSync(DICT_PATH)) {
    console.error(`❌ WordNet database not found at ${DICT_PATH}`)
    console.error('   Run: npm run build:dicts en')
    process.exit(1)
  }

  const db = new DatabaseSync(DICT_PATH, { open: true })

  function lookup(word: string): DictEntry | null {
    const row = db.prepare('SELECT data_json FROM entries WHERE lemma = ?').get(word) as { data_json: string } | undefined
    return row ? JSON.parse(row.data_json) : null
  }

  function getAllPOS(entry: DictEntry): string[] {
    return [...new Set(entry.senses.flatMap(s => s.partOfSpeech))]
  }

  // === Basic lookups ===
  console.log('Basic lookups:')

  const introduce = lookup('introduce')
  assert(introduce !== null, '"introduce" found')
  if (introduce) {
    const pos = getAllPOS(introduce)
    assertIncludes(pos, 'verb', '"introduce" is a verb')
    assertNotIncludes(pos, 'adverb', '"introduce" is NOT an adverb')
  }

  const computer = lookup('computer')
  assert(computer !== null, '"computer" found')
  if (computer) {
    const pos = getAllPOS(computer)
    assertIncludes(pos, 'noun', '"computer" is a noun')
    assertNotIncludes(pos, 'verb', '"computer" is NOT a verb')
  }

  const beautiful = lookup('beautiful')
  assert(beautiful !== null, '"beautiful" found')
  if (beautiful) {
    assertIncludes(getAllPOS(beautiful), 'adjective', '"beautiful" is an adjective')
  }

  const quickly = lookup('quickly')
  assert(quickly !== null, '"quickly" found')
  if (quickly) {
    const pos = getAllPOS(quickly)
    assertIncludes(pos, 'adverb', '"quickly" is an adverb')
    assertNotIncludes(pos, 'verb', '"quickly" is NOT a verb')
  }

  const run = lookup('run')
  assert(run !== null, '"run" found')
  if (run) {
    const pos = getAllPOS(run)
    assertIncludes(pos, 'noun', '"run" has noun sense')
    assertIncludes(pos, 'verb', '"run" has verb sense')
  }

  // === POS correctness - no cross-contamination ===
  console.log('\nPOS correctness (no cross-contamination):')

  const verbOnlyWords = ['introduce', 'develop', 'create', 'understand', 'explain']
  for (const word of verbOnlyWords) {
    const entry = lookup(word)
    if (entry) {
      const pos = getAllPOS(entry)
      assertIncludes(pos, 'verb', `"${word}" is a verb`)
      assertNotIncludes(pos, 'adverb', `"${word}" is NOT an adverb`)
    } else {
      assert(false, `"${word}" not found`)
    }
  }

  const advOnlyWords = ['quickly', 'silently', 'joylessly', 'carefully']
  for (const word of advOnlyWords) {
    const entry = lookup(word)
    if (entry) {
      const pos = getAllPOS(entry)
      assertIncludes(pos, 'adverb', `"${word}" is an adverb`)
      assertNotIncludes(pos, 'verb', `"${word}" is NOT a verb`)
    } else {
      assert(false, `"${word}" not found`)
    }
  }

  // === Definition content sanity ===
  console.log('\nDefinition content sanity:')

  if (introduce) {
    const allDefs = introduce.senses.flatMap(s => s.definitions).join(' ').toLowerCase()
    assertMatches(allDefs, /bring|present|acquaint|insert|put/, '"introduce" defs contain relevant words')
    assertNotMatches(allDefs, /joyless|without joy/, '"introduce" defs do NOT contain "joyless"')
  }

  const joylessly = lookup('joylessly')
  if (joylessly) {
    const allDefs = joylessly.senses.flatMap(s => s.definitions).join(' ').toLowerCase()
    assertMatches(allDefs, /joy|manner/, '"joylessly" defs contain "joy" or "manner"')
  }

  // === Database integrity ===
  console.log('\nDatabase integrity:')

  const countResult = db.prepare('SELECT COUNT(*) as cnt FROM entries').get() as { cnt: number }
  assert(countResult.cnt > 100000, `Entry count > 100k (got ${countResult.cnt})`)
  assert(countResult.cnt < 200000, `Entry count < 200k (got ${countResult.cnt})`)

  const sampleRows = db.prepare('SELECT data_json FROM entries LIMIT 10').all() as { data_json: string }[]
  let validJson = true
  for (const row of sampleRows) {
    try {
      const entry = JSON.parse(row.data_json) as DictEntry
      if (!entry.word || entry.senses.length === 0) validJson = false
    } catch {
      validJson = false
    }
  }
  assert(validJson, 'Sample entries have valid JSON')

  // === Summary ===
  console.log('\n=== Summary ===')
  console.log(`Passed: ${passed}`)
  console.log(`Failed: ${failed}`)

  db.close()

  if (failed > 0) {
    console.log('\n❌ Some tests failed!')
    process.exit(1)
  } else {
    console.log('\n✓ All tests passed!')
    process.exit(0)
  }
}

main().catch(console.error)
