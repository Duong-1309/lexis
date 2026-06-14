import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import os from 'os'
import path from 'path'
import fs from 'fs'
import { DatabaseService } from '../db.test-helper'

let dbService: DatabaseService
let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lexis-test-'))
  dbService = new DatabaseService()
  dbService.initialize(tmpDir)
  dbService.runMigrations()
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('DatabaseService — media_sources', () => {
  it('inserts and retrieves a media source', () => {
    const source = dbService.insertMediaSource({
      type: 'subtitle',
      title: 'Test Subtitle',
      filePath: '/tmp/test.srt',
      language: 'ja',
    })
    expect(source.id).toBeGreaterThan(0)
    expect(source.title).toBe('Test Subtitle')
    expect(source.language).toBe('ja')

    const retrieved = dbService.getMediaSourceById(source.id)
    expect(retrieved).not.toBeNull()
    expect(retrieved!.title).toBe('Test Subtitle')
  })

  it('returns all media sources', () => {
    dbService.insertMediaSource({ type: 'subtitle', title: 'A', language: 'ja' })
    dbService.insertMediaSource({ type: 'epub', title: 'B', language: 'zh' })
    const sources = dbService.getMediaSources()
    expect(sources).toHaveLength(2)
  })

  it('deletes a media source', () => {
    const source = dbService.insertMediaSource({ type: 'subtitle', title: 'Del', language: 'en' })
    dbService.deleteMediaSource(source.id)
    expect(dbService.getMediaSourceById(source.id)).toBeNull()
  })
})

describe('DatabaseService — sentences', () => {
  it('inserts and retrieves sentences by sourceId', () => {
    const source = dbService.insertMediaSource({ type: 'subtitle', title: 'S', language: 'ja' })
    dbService.insertSentences([
      { sourceId: source.id, content: '今日は', position: 0, startTimeMs: 0, endTimeMs: 1000 },
      { sourceId: source.id, content: '元気ですか', position: 1, startTimeMs: 1000, endTimeMs: 2000 },
    ])
    const sentences = dbService.getSentencesBySourceId(source.id)
    expect(sentences).toHaveLength(2)
    expect(sentences[0].content).toBe('今日は')
    expect(sentences[1].position).toBe(1)
  })

  it('returns sentences in position order', () => {
    const source = dbService.insertMediaSource({ type: 'subtitle', title: 'S', language: 'en' })
    dbService.insertSentences([
      { sourceId: source.id, content: 'Third', position: 2 },
      { sourceId: source.id, content: 'First', position: 0 },
      { sourceId: source.id, content: 'Second', position: 1 },
    ])
    const sentences = dbService.getSentencesBySourceId(source.id)
    expect(sentences[0].content).toBe('First')
    expect(sentences[2].content).toBe('Third')
  })
})

describe('DatabaseService — mined words', () => {
  it('inserts a mined word and checks if word is mined', () => {
    const source = dbService.insertMediaSource({ type: 'subtitle', title: 'S', language: 'ja' })
    dbService.insertMinedWord({
      word: '食べる',
      reading: 'たべる',
      language: 'ja',
      sourceId: source.id,
    })
    expect(dbService.isWordMined('食べる', 'Japanese::N4')).toBe(false) // status = queued, not synced
  })
})

describe('DatabaseService — cards queue', () => {
  it('inserts a card and marks it synced', () => {
    const card = dbService.insertCard({
      deckName: 'Japanese::N4',
      modelName: 'Basic',
      frontHtml: '<p>食べる</p>',
      backHtml: '<p>to eat</p>',
      tags: ['lexis', 'ja'],
    })
    expect(card.id).toBeGreaterThan(0)
    expect(card.synced).toBe(false)

    dbService.markCardSynced(card.id, 12345)
    const pending = dbService.getPendingCards()
    expect(pending.find((c) => c.id === card.id)).toBeUndefined()
  })

  it('getPendingCards returns only unsynced cards', () => {
    dbService.insertCard({ deckName: 'D', modelName: 'Basic', frontHtml: 'F1', backHtml: 'B1', tags: [] })
    const card2 = dbService.insertCard({ deckName: 'D', modelName: 'Basic', frontHtml: 'F2', backHtml: 'B2', tags: [] })
    dbService.markCardSynced(card2.id, 99)

    const pending = dbService.getPendingCards()
    expect(pending).toHaveLength(1)
    expect(pending[0].frontHtml).toBe('F1')
  })

  it('deleteCard removes a pending card', () => {
    const card = dbService.insertCard({ deckName: 'D', modelName: 'Basic', frontHtml: 'F', backHtml: 'B', tags: [] })
    dbService.deleteCard(card.id)
    expect(dbService.getPendingCards()).toHaveLength(0)
  })
})
