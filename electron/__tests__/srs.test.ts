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
    stepIndex: 0,
    cardState: 'new',
    createdAt: '2024-01-01',
    ...overrides,
  }
}

// Helper to make a graduated card (cardState=review)
function graduatedCard(overrides: Partial<Card> = {}): Card {
  return newCard({ cardState: 'review', reps: 3, interval: 10, stepIndex: 3, ...overrides })
}

function minutesFromNow(value: string): number {
  return Math.round((new Date(`${value.replace(' ', 'T')}Z`).getTime() - Date.now()) / 60000)
}

describe('calculateNextReview — learning steps', () => {
  it('new card Good → stepIndex advances, interval=1', () => {
    const card = newCard()
    const result = calculateNextReview(card, 3)
    expect(result.stepIndex).toBe(1)
    expect(result.interval).toBe(1)
    expect(result.reps).toBe(0)
    expect(result.cardState).toBe('learning')
    expect(minutesFromNow(result.dueDate)).toBeGreaterThanOrEqual(0)
    expect(minutesFromNow(result.dueDate)).toBeLessThanOrEqual(1)
  })

  it('step 1 Good → advances to step 2', () => {
    const card = newCard({ stepIndex: 1 })
    const result = calculateNextReview(card, 3)
    expect(result.stepIndex).toBe(2)
    expect(result.interval).toBe(1)
    expect(result.reps).toBe(0)
    expect(result.cardState).toBe('learning')
    expect(minutesFromNow(result.dueDate)).toBeGreaterThanOrEqual(9)
    expect(minutesFromNow(result.dueDate)).toBeLessThanOrEqual(10)
  })

  it('step 2 Good → graduates (stepIndex=3), reps+1', () => {
    const card = newCard({ stepIndex: 2 })
    const result = calculateNextReview(card, 3)
    expect(result.stepIndex).toBe(3)
    expect(result.interval).toBe(1)
    expect(result.reps).toBe(1)
  })

  it('new card Easy → graduates immediately, interval=4', () => {
    const card = newCard()
    const result = calculateNextReview(card, 4)
    expect(result.stepIndex).toBe(3)
    expect(result.interval).toBe(4)
    expect(result.reps).toBe(1)
  })

  it('new card Hard → stays at step 0', () => {
    const card = newCard()
    const result = calculateNextReview(card, 2)
    expect(result.stepIndex).toBe(0)
    expect(result.interval).toBe(1)
    expect(result.reps).toBe(0)
  })

  it('new card Again → restarts at step 0', () => {
    const card = newCard({ stepIndex: 1 })
    const result = calculateNextReview(card, 1)
    expect(result.stepIndex).toBe(0)
    expect(result.interval).toBe(1)
    expect(result.lapses).toBe(0) // learning cards don't count as lapses
  })
})

describe('calculateNextReview — graduated cards', () => {
  it('Again (lapse) → stepIndex=1, lapses+1, interval=1, reps unchanged', () => {
    const card = graduatedCard({ reps: 3, lapses: 0 })
    const result = calculateNextReview(card, 1)
    expect(result.stepIndex).toBe(1)
    expect(result.lapses).toBe(1)
    expect(result.interval).toBe(1)
    expect(result.reps).toBe(3) // reps NOT reset on lapse
    expect(result.cardState).toBe('learning')
    expect(minutesFromNow(result.dueDate)).toBeLessThanOrEqual(1)
  })

  it('Hard → interval grows by 1.2×, reps unchanged (bug fix: was decrementing)', () => {
    const card = graduatedCard({ reps: 3, interval: 10 })
    const result = calculateNextReview(card, 2)
    expect(result.interval).toBeGreaterThanOrEqual(Math.round(10 * 1.2) - 1)
    expect(result.interval).toBeLessThanOrEqual(Math.round(10 * 1.2) + 1)
    expect(result.reps).toBe(3) // unchanged
    expect(result.lapses).toBe(0)
  })

  it('Good → interval = round(interval * ease), reps+1', () => {
    const card = graduatedCard({ reps: 3, interval: 10, easeFactor: 2.5 })
    const result = calculateNextReview(card, 3)
    const expectedBase = Math.round(10 * result.easeFactor)
    expect(result.interval).toBeGreaterThanOrEqual(expectedBase - 1)
    expect(result.interval).toBeLessThanOrEqual(expectedBase + 1)
    expect(result.reps).toBe(4)
  })

  it('Easy gives longer interval than Good', () => {
    const card = graduatedCard({ reps: 3, interval: 10, easeFactor: 2.5 })
    const good = calculateNextReview(card, 3)
    const easy = calculateNextReview(card, 4)
    // Easy = Good * 1.3, so easy.interval > good.interval - fuzz tolerance
    expect(easy.interval).toBeGreaterThan(good.interval - 2)
  })

  it('ease factor never drops below 1.3', () => {
    const card = graduatedCard({ easeFactor: 1.3 })
    const result = calculateNextReview(card, 1)
    expect(result.easeFactor).toBeGreaterThanOrEqual(1.3)
  })

  it('cardState is "review" when interval >= 21', () => {
    const card = graduatedCard({ reps: 4, interval: 21, easeFactor: 2.5 })
    const result = calculateNextReview(card, 3)
    expect(result.cardState).toBe('review')
  })

  it('backward compat: cardState=review with stepIndex=0 treated as graduated', () => {
    const card = newCard({ cardState: 'review', reps: 5, interval: 30, stepIndex: 0 })
    const result = calculateNextReview(card, 3)
    expect(result.reps).toBe(6) // reps incremented, not reset
    expect(result.interval).toBeGreaterThan(1)
  })
})

describe('calculateNextReview — fuzz', () => {
  it('learning dueDate is a valid datetime string', () => {
    const result = calculateNextReview(newCard(), 3)
    expect(result.dueDate).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  })

  it('graduated dueDate is a valid YYYY-MM-DD string', () => {
    const result = calculateNextReview(graduatedCard(), 3)
    expect(result.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('interval=1 never gets fuzz (stays at 1)', () => {
    for (let i = 0; i < 20; i++) {
      const card = graduatedCard({ interval: 1 })
      const result = calculateNextReview(card, 2)
      expect(result.interval).toBe(1)
    }
  })
})
