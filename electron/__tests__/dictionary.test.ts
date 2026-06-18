/**
 * Unit tests for DictionaryService.
 * better-sqlite3 and kuromoji are mocked — no native Electron ABI required.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'

// ─── Module mocks (hoisted before imports) ───────────────────────────────────

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// Shared mock references so tests can control return values
const mockAll = vi.hoisted(() => vi.fn<[], unknown[]>().mockReturnValue([]))
const mockPrepare = vi.hoisted(() => vi.fn(() => ({ all: mockAll })))
const mockDbClose = vi.hoisted(() => vi.fn())

vi.mock('better-sqlite3', () => ({
  default: vi.fn(() => ({ prepare: mockPrepare, close: mockDbClose })),
}))

// Kuromoji mock returns two tokens for any input
vi.mock('kuromoji', () => ({
  builder: vi.fn().mockReturnValue({
    build: vi.fn().mockImplementation((cb: (err: null, t: object) => void) =>
      cb(null, {
        tokenize: vi.fn().mockReturnValue([
          {
            surface_form: '食べ',
            basic_form: '食べる',
            reading: 'タベ',
            pos: '動詞',
            pos_detail_1: '自立',
            word_position: 1,
          },
          {
            surface_form: 'た',
            basic_form: 'た',
            reading: 'タ',
            pos: '助動詞',
            pos_detail_1: '*',
            word_position: 3,
          },
        ]),
      }),
    ),
  }),
}))

import { DictionaryService } from '../services/dictionary'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeJMdictRow(
  word: string,
  reading: string,
  definitions: string[],
): { id: number; data_json: string } {
  return {
    id: 1,
    data_json: JSON.stringify({
      id: 1,
      writings: [{ value: word, common: true }],
      readings: [{ value: reading, common: true }],
      senses: [{ partOfSpeech: ['動詞'], definitions, misc: [] }],
    }),
  }
}

function makeCEDICTRow(
  simplified: string,
  pinyin: string,
  defs: string[],
) {
  return {
    id: 1,
    traditional: simplified,
    simplified,
    pinyin_pretty: pinyin,
    definitions: JSON.stringify(defs),
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('DictionaryService', () => {
  let service: DictionaryService

  beforeEach(() => {
    vi.clearAllMocks()
    mockAll.mockReturnValue([])
    service = new DictionaryService()
  })

  afterEach(() => {
    service.close()
    vi.restoreAllMocks()
  })

  // ─── openDictionary ──────────────────────────────────────────────────────

  describe('openDictionary', () => {
    it('skips when file does not exist', () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(false)
      service.openDictionary('ja', '/nonexistent/jmdict.db')
      // lookup should return [] because no DB was opened
      expect(service.lookup('食べる', 'ja')).toEqual([])
    })

    it('registers DB when file exists', () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)
      service.openDictionary('ja', '/fake/jmdict.db')
      // DB is now registered; lookup calls prepare()
      service.lookup('食べる', 'ja')
      expect(mockPrepare).toHaveBeenCalled()
    })
  })

  // ─── lookup — no DB ──────────────────────────────────────────────────────

  describe('lookup (no DB open)', () => {
    it('returns [] for Japanese when no DB registered', () => {
      expect(service.lookup('食べる', 'ja')).toEqual([])
    })

    it('returns [] for Chinese when no DB registered', () => {
      expect(service.lookup('食', 'zh')).toEqual([])
    })

    it('returns [] for unsupported language', () => {
      expect(service.lookup('hello', 'en')).toEqual([])
    })
  })

  // ─── lookup — JMdict ─────────────────────────────────────────────────────

  describe('lookup — JMdict', () => {
    beforeEach(() => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)
      service.openDictionary('ja', '/fake/jmdict.db')
    })

    it('parses JMdict rows into DictEntry', () => {
      mockAll.mockReturnValueOnce([makeJMdictRow('食べる', 'たべる', ['to eat', 'to consume'])])

      const results = service.lookup('食べる', 'ja')

      expect(results).toHaveLength(1)
      expect(results[0].word).toBe('食べる')
      expect(results[0].language).toBe('ja')
      expect(results[0].readings[0].value).toBe('たべる')
      expect(results[0].senses[0].definitions).toEqual(['to eat', 'to consume'])
      expect(results[0].senses[0].partOfSpeech).toEqual(['動詞'])
    })

    it('returns [] when no rows match', () => {
      mockAll.mockReturnValue([])
      const results = service.lookup('xyz', 'ja')
      expect(results).toEqual([])
    })

    it('falls back to FTS when LIKE match returns nothing', () => {
      // First call (LIKE) → empty; second call (FTS) → result
      mockAll
        .mockReturnValueOnce([])
        .mockReturnValueOnce([makeJMdictRow('食べる', 'たべる', ['to eat'])])

      const results = service.lookup('食べる', 'ja')
      expect(results).toHaveLength(1)
      expect(mockPrepare).toHaveBeenCalledTimes(2)
    })
  })

  // ─── lookup — CEDICT ─────────────────────────────────────────────────────

  describe('lookup — CEDICT', () => {
    beforeEach(() => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)
      service.openDictionary('zh', '/fake/cedict.db')
    })

    it('parses CEDICT rows into DictEntry', () => {
      mockAll.mockReturnValueOnce([makeCEDICTRow('食', 'shí', ['food', 'to eat'])])

      const results = service.lookup('食', 'zh')

      expect(results).toHaveLength(1)
      expect(results[0].word).toBe('食')
      expect(results[0].language).toBe('zh')
      expect(results[0].readings[0].value).toBe('shí')
      expect(results[0].senses[0].definitions).toEqual(['food', 'to eat'])
    })
  })

  // ─── lookup — WordNet ────────────────────────────────────────────────────

  describe('lookup — WordNet', () => {
    beforeEach(() => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)
      service.openDictionary('en', '/fake/wordnet.db')
    })

    it('normalizes punctuation and quotes FTS fallback queries', () => {
      mockAll.mockReturnValue([])

      const results = service.lookup('Suddenly, without warning', 'en')
      const callArgs = mockAll.mock.calls.map((call) => call[0])

      expect(results).toEqual([])
      expect(callArgs).toContain('suddenly')
      expect(callArgs).toContain('"suddenly"')
      expect(callArgs).not.toContain('Suddenly, without warning')
    })

    it('returns [] for punctuation-only lookup text', () => {
      const results = service.lookup(',', 'en')

      expect(results).toEqual([])
      expect(mockPrepare).not.toHaveBeenCalled()
    })

    it('does not run fuzzy fallback for contractions', () => {
      mockAll.mockReturnValue([])

      const results = service.lookup("You're", 'en')
      const callArgs = mockAll.mock.calls.map((call) => call[0])

      expect(results).toEqual([])
      expect(callArgs).toContain('you')
      expect(callArgs).not.toContain('"you"')
    })
  })

  // ─── LRU cache ───────────────────────────────────────────────────────────

  describe('LRU cache', () => {
    beforeEach(() => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)
      service.openDictionary('ja', '/fake/jmdict.db')
    })

    it('returns cached result on second call without hitting DB', () => {
      mockAll.mockReturnValueOnce([makeJMdictRow('食べる', 'たべる', ['to eat'])])

      const first = service.lookup('食べる', 'ja')
      const second = service.lookup('食べる', 'ja')

      expect(first).toEqual(second)
      // prepare() called once for the first lookup; second is served from cache
      expect(mockPrepare).toHaveBeenCalledTimes(1)
    })

    it('cache key is lang + word', () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)
      service.openDictionary('zh', '/fake/cedict.db')

      mockAll
        .mockReturnValueOnce([makeJMdictRow('食', 'しょく', ['food (ja)'])])
        .mockReturnValueOnce([makeCEDICTRow('食', 'shí', ['food (zh)'])])

      const jaResult = service.lookup('食', 'ja')
      const zhResult = service.lookup('食', 'zh')

      expect(jaResult[0].senses[0].definitions[0]).toBe('food (ja)')
      expect(zhResult[0].senses[0].definitions[0]).toBe('food (zh)')
    })
  })

  // ─── autocomplete ─────────────────────────────────────────────────────────

  describe('autocomplete', () => {
    it('returns [] when no DB is open', () => {
      expect(service.autocomplete('食', 'ja')).toEqual([])
      expect(service.autocomplete('食', 'zh')).toEqual([])
    })

    it('returns candidates from JMdict when DB is open', () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)
      service.openDictionary('ja', '/fake/jmdict.db')
      mockAll.mockReturnValueOnce([{ writings: '食べる 食べます' }, { writings: '食事' }])

      const results = service.autocomplete('食', 'ja')
      expect(results).toEqual(['食べる', '食事'])
    })

    it('returns candidates from CEDICT when DB is open', () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true)
      service.openDictionary('zh', '/fake/cedict.db')
      mockAll.mockReturnValueOnce([{ simplified: '食' }, { simplified: '食物' }])

      const results = service.autocomplete('食', 'zh')
      expect(results).toEqual(['食', '食物'])
    })

    it('returns [] for unsupported language', () => {
      expect(service.autocomplete('eat', 'en')).toEqual([])
    })
  })

  // ─── tokenize — Chinese ──────────────────────────────────────────────────

  describe('tokenize (zh)', () => {
    it('splits CJK characters individually', async () => {
      const tokens = await service.tokenize('食物', 'zh')
      expect(tokens).toHaveLength(2)
      expect(tokens[0].surface).toBe('食')
      expect(tokens[0].dictionaryForm).toBe('食')
      expect(tokens[0].partOfSpeech).toBe('noun')
      expect(tokens[0].offset).toBe(0)
      expect(tokens[1].surface).toBe('物')
      expect(tokens[1].offset).toBeGreaterThan(0)
    })

    it('handles mixed CJK and ASCII', async () => {
      const tokens = await service.tokenize('hello食物', 'zh')
      const surfaces = tokens.map((t) => t.surface)
      expect(surfaces).toContain('hello')
      expect(surfaces).toContain('食')
      expect(surfaces).toContain('物')
    })

    it('returns correct offset for each token', async () => {
      const tokens = await service.tokenize('三国', 'zh')
      expect(tokens[0].offset).toBe(0)
      expect(tokens[1].offset).toBe('三'.length) // 3 bytes in UTF-16
    })
  })

  // ─── tokenize — simple (en/etc) ──────────────────────────────────────────

  describe('tokenize (en)', () => {
    it('splits on whitespace and punctuation', async () => {
      const tokens = await service.tokenize('Hello, world!', 'en')
      const surfaces = tokens.map((t) => t.surface)
      expect(surfaces).toContain('Hello')
      expect(surfaces).toContain('world')
    })

    it('lowercases dictionaryForm', async () => {
      const tokens = await service.tokenize('Hello World', 'en')
      expect(tokens[0].dictionaryForm).toBe('hello')
      expect(tokens[1].dictionaryForm).toBe('world')
    })

    it('assigns correct offsets', async () => {
      const tokens = await service.tokenize('hello world', 'en')
      expect(tokens[0].offset).toBe(0)
      expect(tokens[1].offset).toBe(6) // after "hello "
    })
  })

  // ─── tokenize — Japanese ────────────────────────────────────────────────

  describe('tokenize (ja)', () => {
    it('uses kuromoji tokenizer and maps fields correctly', async () => {
      const tokens = await service.tokenize('食べた', 'ja')

      expect(tokens).toHaveLength(2)
      expect(tokens[0].surface).toBe('食べ')
      expect(tokens[0].dictionaryForm).toBe('食べる')
      expect(tokens[0].reading).toBe('タベ')
      expect(tokens[0].partOfSpeech).toBe('動詞')
      expect(tokens[0].offset).toBe(0) // word_position 1 → 0-indexed
      expect(tokens[1].surface).toBe('た')
      expect(tokens[1].offset).toBe(2) // word_position 3 → 2-indexed
    })

    it('uses surface as dictionaryForm when basic_form is *', async () => {
      const { builder } = await import('kuromoji') as unknown as { builder: ReturnType<typeof vi.fn> }
      builder.mockReturnValueOnce({
        build: vi.fn().mockImplementation((cb: (err: null, t: object) => void) =>
          cb(null, {
            tokenize: vi.fn().mockReturnValue([
              { surface_form: 'は', basic_form: '*', reading: 'ハ', pos: '助詞', pos_detail_1: '係助詞', word_position: 1 },
            ])
          })
        )
      })
      // Need a fresh service to re-init kuromoji with the new mock
      const fresh = new DictionaryService()
      const tokens = await fresh.tokenize('は', 'ja')
      expect(tokens[0].dictionaryForm).toBe('は') // fell back to surface
      fresh.close()
    })
  })
})
