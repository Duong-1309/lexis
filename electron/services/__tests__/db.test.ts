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

    const retrieved = dbService.getMediaSourceById(source.id)
    expect(retrieved?.title).toBe('Test Subtitle')
  })

  it('deletes a media source', () => {
    const source = dbService.insertMediaSource({ type: 'subtitle', title: 'Del', language: 'en' })
    dbService.deleteMediaSource(source.id)
    expect(dbService.getMediaSourceById(source.id)).toBeNull()
  })
})

describe('DatabaseService — local decks and cards', () => {
  it('creates a manual Basic card due today', () => {
    const deck = dbService.getDecks()[0]
    const card = dbService.insertCard({
      deckId: deck.id,
      template: 'Basic',
      frontHtml: 'front',
      backHtml: 'back',
      tags: ['manual'],
      word: 'front',
      language: 'en',
    })

    expect(card.id).toBeGreaterThan(0)
    expect(card.deckId).toBe(deck.id)
    expect(card.cardState).toBe('new')
    expect(card.interval).toBe(0)
    expect(dbService.getDueCards(deck.id).map((c) => c.id)).toContain(card.id)
  })

  it('creates a manual Cloze card due today', () => {
    const deck = dbService.getDecks()[0]
    const card = dbService.insertCard({
      deckId: deck.id,
      template: 'Cloze',
      frontHtml: '{{c1::front}} in context',
      backHtml: 'back',
      tags: ['cloze'],
      word: 'front',
      language: 'en',
    })

    expect(card.frontHtml).toContain('{{c1::front}}')
    expect(dbService.getDueCards(deck.id).map((c) => c.id)).toContain(card.id)
  })

  it('deletes an empty deck', () => {
    const deck = dbService.createDeck('Empty')
    dbService.deleteDeck(deck.id)
    expect(dbService.getDeckById(deck.id)).toBeNull()
  })

  it('recreates a default deck when inserting a card with a deleted deck id', () => {
    const originalDefault = dbService.getDecks()[0]
    const spareDeck = dbService.createDeck('Spare')
    dbService.deleteDeck(originalDefault.id)

    const card = dbService.insertCard({
      deckId: originalDefault.id,
      template: 'Basic',
      frontHtml: 'front',
      backHtml: 'back',
      tags: [],
    })

    const defaultDeck = dbService.getDecks().find((deck) => deck.name === 'Default')
    expect(defaultDeck).toBeDefined()
    expect(card.deckId).toBe(defaultDeck?.id)
    expect(card.deckId).not.toBe(originalDefault.id)
    expect(dbService.getDeckById(spareDeck.id)).not.toBeNull()
  })

  it('rejects deleting a non-empty deck', () => {
    const deck = dbService.createDeck('Not Empty')
    dbService.insertCard({
      deckId: deck.id,
      template: 'Basic',
      frontHtml: 'front',
      backHtml: 'back',
      tags: [],
    })

    expect(() => dbService.deleteDeck(deck.id)).toThrow(/empty/)
  })

  it('moves multiple cards and updates deck counts', () => {
    const from = dbService.createDeck('From')
    const to = dbService.createDeck('To')
    const cardA = dbService.insertCard({ deckId: from.id, template: 'Basic', frontHtml: 'A', backHtml: 'A', tags: [] })
    const cardB = dbService.insertCard({ deckId: from.id, template: 'Basic', frontHtml: 'B', backHtml: 'B', tags: [] })

    dbService.moveCards([cardA.id, cardB.id], to.id)

    expect(dbService.getAllCards(from.id)).toHaveLength(0)
    expect(dbService.getAllCards(to.id).map((c) => c.id).sort()).toEqual([cardA.id, cardB.id].sort())
    expect(dbService.getDecks().find((deck) => deck.id === to.id)?.cardCount).toBe(2)
  })

  it('unsuspends cards into a safe active state', () => {
    const deck = dbService.getDecks()[0]
    const card = dbService.insertCard({
      deckId: deck.id,
      template: 'Basic',
      frontHtml: 'front',
      backHtml: 'back',
      tags: [],
    })

    dbService.suspendCard(card.id)
    expect(dbService.getCard(card.id)?.cardState).toBe('suspended')

    dbService.unsuspendCards([card.id])
    expect(dbService.getCard(card.id)?.cardState).toBe('new')
  })
})

describe('DatabaseService — patterns', () => {
  it('normalizes pattern text and rejects punctuation/whitespace duplicates', () => {
    const first = dbService.createPattern({
      language: 'en',
      patternText: '  Say my name.  ',
      tags: ['pattern', 'en'],
    })

    expect(first.patternText).toBe('Say my name')
    expect(() => dbService.createPattern({
      language: 'en',
      patternText: 'say   my name!!!',
      tags: ['pattern', 'en'],
    })).toThrow(/Duplicate pattern/)
  })

  it('allows the same normalized pattern in a different language', () => {
    dbService.createPattern({
      language: 'en',
      patternText: 'Say my name.',
      tags: ['pattern', 'en'],
    })

    const pattern = dbService.createPattern({
      language: 'fr',
      patternText: 'Say my name.',
      tags: ['pattern', 'fr'],
    })

    expect(pattern.language).toBe('fr')
  })
})
