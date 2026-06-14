import { describe, it, expect } from 'vitest'
import { calculateNextReview } from '../services/srs'
import type { Card } from '../../src/types/index'

function newCard(overrides: Partial<Card> = {}): Card {
  return {
    id: 1,
    deckId: 1,
    frontHtml: 'front',
    backHtml: 'back',
    tags: [],
    dueDate: '2024-01-01',
    interval: 0,
    easeFactor: 2.5,
    reps: 0,
    lapses: 0,
    cardState: 'new',
    createdAt: '2024-01-01',
    ...overrides,
  }
}

describe('calculateNextReview', () => {
  it('rating=1 (Again) resets reps, increments lapses, sets interval=1', () => {
    const card = newCard({ reps: 3, lapses: 0, interval: 10 })
    const result = calculateNextReview(card, 1)
    expect(result.interval).toBe(1)
    expect(result.reps).toBe(0)
    expect(result.lapses).toBe(1)
    expect(result.cardState).toBe('learning')
  })

  it('rating=3 (Good) first review → interval=1', () => {
    const card = newCard({ reps: 0, interval: 0 })
    const result = calculateNextReview(card, 3)
    expect(result.interval).toBe(1)
    expect(result.reps).toBe(1)
  })

  it('rating=3 (Good) second review → interval=6', () => {
    const card = newCard({ reps: 1, interval: 1 })
    const result = calculateNextReview(card, 3)
    expect(result.interval).toBe(6)
    expect(result.reps).toBe(2)
  })

  it('rating=3 (Good) third review → interval = round(prev * ease_factor)', () => {
    const card = newCard({ reps: 2, interval: 6, easeFactor: 2.5 })
    const result = calculateNextReview(card, 3)
    expect(result.interval).toBe(Math.round(6 * result.easeFactor))
    expect(result.reps).toBe(3)
  })

  it('rating=4 (Easy) gives longer interval than Good', () => {
    const card = newCard({ reps: 2, interval: 6, easeFactor: 2.5 })
    const good = calculateNextReview(card, 3)
    const easy = calculateNextReview(card, 4)
    expect(easy.interval).toBeGreaterThan(good.interval)
  })

  it('ease_factor never drops below 1.3', () => {
    const card = newCard({ easeFactor: 1.3 })
    const result = calculateNextReview(card, 1)
    expect(result.easeFactor).toBeGreaterThanOrEqual(1.3)
  })

  it('cardState is "review" when interval >= 21', () => {
    const card = newCard({ reps: 4, interval: 21, easeFactor: 2.5 })
    const result = calculateNextReview(card, 3)
    expect(result.cardState).toBe('review')
  })

  it('cardState is "learning" when interval < 21', () => {
    const card = newCard({ reps: 1, interval: 1, easeFactor: 2.5 })
    const result = calculateNextReview(card, 3)
    expect(result.cardState).toBe('learning')
  })

  it('rating=2 (Hard) slows progression without resetting', () => {
    const card = newCard({ reps: 3, interval: 10 })
    const result = calculateNextReview(card, 2)
    expect(result.interval).toBe(Math.max(1, Math.round(10 * 1.2)))
    expect(result.reps).toBe(2)
    expect(result.lapses).toBe(0)
  })

  it('dueDate is a valid YYYY-MM-DD string', () => {
    const result = calculateNextReview(newCard(), 3)
    expect(result.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
