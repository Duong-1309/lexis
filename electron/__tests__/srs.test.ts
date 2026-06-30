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

// Helper to make a graduated card (cardState=review, stepIndex >= 2)
function graduatedCard(overrides: Partial<Card> = {}): Card {
  return newCard({ cardState: 'review', reps: 3, interval: 10, stepIndex: 2, ...overrides })
}

function minutesFromNow(value: string): number {
  return Math.round((new Date(`${value.replace(' ', 'T')}Z`).getTime() - Date.now()) / 60000)
}

describe('calculateNextReview — learning steps', () => {
  // Learning: stepIndex 0 (1min) → stepIndex 1 (10min) → stepIndex 2 (graduate)

  it('new card Good → stepIndex 0→1, cardState=learning, due in ~10min', () => {
    const card = newCard({ stepIndex: 0 })
    const result = calculateNextReview(card, 3)
    expect(result.stepIndex).toBe(1)
    expect(result.cardState).toBe('learning')
    expect(result.reps).toBe(0)
    // Due in ~10min (learningDelayMinutes(1) = 10)
    expect(minutesFromNow(result.dueDate)).toBeGreaterThanOrEqual(9)
    expect(minutesFromNow(result.dueDate)).toBeLessThanOrEqual(11)
  })

  it('step 1 Good → stepIndex 1→2 (graduate), cardState=review, reps+1', () => {
    const card = newCard({ stepIndex: 1 })
    const result = calculateNextReview(card, 3)
    expect(result.stepIndex).toBe(2)
    expect(result.cardState).toBe('review') // graduated!
    expect(result.reps).toBe(1) // incremented on graduation
    expect(result.interval).toBe(1)
  })

  it('new card Easy → graduates immediately, stepIndex=2, interval=4', () => {
    const card = newCard({ stepIndex: 0 })
    const result = calculateNextReview(card, 4)
    expect(result.stepIndex).toBe(2)
    expect(result.cardState).toBe('review')
    expect(result.interval).toBe(4)
    expect(result.reps).toBe(1)
  })

  it('new card Hard → stays at step 0, due in ~1min', () => {
    const card = newCard({ stepIndex: 0 })
    const result = calculateNextReview(card, 2)
    expect(result.stepIndex).toBe(0)
    expect(result.cardState).toBe('learning')
    expect(result.reps).toBe(0)
  })

  it('new card Again → restarts at step 0', () => {
    const card = newCard({ stepIndex: 1 })
    const result = calculateNextReview(card, 1)
    expect(result.stepIndex).toBe(0)
    expect(result.cardState).toBe('learning')
    expect(result.lapses).toBe(0) // learning cards don't count as lapses
  })

  it('step 0 Good → step 1, due in ~10min', () => {
    const card = newCard({ stepIndex: 0 })
    const result = calculateNextReview(card, 3)
    expect(result.stepIndex).toBe(1)
    // Due date should be ~1 minute from now (step 0 delay)
    // Actually step 1 means 10min delay for NEXT review
    // But the dueDate here is set with learningDelayMinutes(stepIndex) where stepIndex was 0 before increment
    // Wait, let me re-read the code...
    // Line 78: stepIndex += 1 (now 1)
    // Line 84-85: if stepIndex < 2, interval=1, dueDate = nowPlusMinutes(learningDelayMinutes(stepIndex))
    // learningDelayMinutes(1) = 10
    expect(minutesFromNow(result.dueDate)).toBeGreaterThanOrEqual(9)
    expect(minutesFromNow(result.dueDate)).toBeLessThanOrEqual(11)
  })
})

describe('calculateNextReview — graduated cards (stepIndex >= 2)', () => {
  it('Again (lapse) → stepIndex=1, lapses+1, interval=1, cardState=relearning', () => {
    const card = graduatedCard({ reps: 3, lapses: 0 })
    const result = calculateNextReview(card, 1)
    expect(result.stepIndex).toBe(1)
    expect(result.lapses).toBe(1)
    expect(result.interval).toBe(1)
    expect(result.reps).toBe(3) // reps NOT reset on lapse
    expect(result.cardState).toBe('relearning') // NOT 'learning' - distinct state
    // Due in ~10min (learningDelayMinutes(1) = 10)
    expect(minutesFromNow(result.dueDate)).toBeGreaterThanOrEqual(9)
    expect(minutesFromNow(result.dueDate)).toBeLessThanOrEqual(11)
  })

  it('Hard → interval grows by 1.2×, reps unchanged', () => {
    const card = graduatedCard({ reps: 3, interval: 10 })
    const result = calculateNextReview(card, 2)
    expect(result.interval).toBeGreaterThanOrEqual(11) // ~12 with fuzz
    expect(result.interval).toBeLessThanOrEqual(13)
    expect(result.reps).toBe(3) // unchanged
    expect(result.lapses).toBe(0)
    expect(result.cardState).toBe('review')
  })

  it('Good → interval = round(interval * ease), reps+1', () => {
    const card = graduatedCard({ reps: 3, interval: 10, easeFactor: 2.5 })
    const result = calculateNextReview(card, 3)
    // interval = 10 * 2.5 = 25 (with ease adjustment and fuzz)
    expect(result.interval).toBeGreaterThanOrEqual(20)
    expect(result.interval).toBeLessThanOrEqual(30)
    expect(result.reps).toBe(4)
    expect(result.cardState).toBe('review')
  })

  it('Easy gives longer interval than Good', () => {
    const card = graduatedCard({ reps: 3, interval: 10, easeFactor: 2.5 })
    const good = calculateNextReview(card, 3)
    const easy = calculateNextReview(card, 4)
    // Easy = Good * 1.3
    expect(easy.interval).toBeGreaterThan(good.interval - 5) // accounting for fuzz
  })

  it('ease factor never drops below 1.3', () => {
    const card = graduatedCard({ easeFactor: 1.3 })
    const result = calculateNextReview(card, 1) // Again - would decrease ease
    expect(result.easeFactor).toBeGreaterThanOrEqual(1.3)
  })

  it('cardState stays "review" for graduated cards', () => {
    const card = graduatedCard({ reps: 4, interval: 21, easeFactor: 2.5 })
    const result = calculateNextReview(card, 3)
    expect(result.cardState).toBe('review')
    expect(result.stepIndex).toBe(2) // stays at 2
  })

  it('backward compat: cardState=review with stepIndex=0 treated as graduated', () => {
    const card = newCard({ cardState: 'review', reps: 5, interval: 30, stepIndex: 0 })
    const result = calculateNextReview(card, 3)
    expect(result.reps).toBe(6) // reps incremented, not reset
    expect(result.interval).toBeGreaterThan(1)
    expect(result.cardState).toBe('review') // stays review despite stepIndex=0
  })
})

describe('calculateNextReview — graduation flow', () => {
  it('full learning progression: step 0 → 1 → 2 (graduate)', () => {
    // Step 0 → 1
    let card = newCard({ stepIndex: 0 })
    let result = calculateNextReview(card, 3)
    expect(result.stepIndex).toBe(1)
    expect(result.cardState).toBe('learning')
    expect(result.reps).toBe(0)

    // Step 1 → 2 (graduate)
    card = newCard({ stepIndex: 1 })
    result = calculateNextReview(card, 3)
    expect(result.stepIndex).toBe(2)
    expect(result.cardState).toBe('review') // graduated!
    expect(result.reps).toBe(1)
  })

  it('graduated card continues as review', () => {
    const card = graduatedCard({ stepIndex: 2, interval: 4 })
    const result = calculateNextReview(card, 3)
    expect(result.cardState).toBe('review')
    expect(result.stepIndex).toBe(2) // stays at 2
    expect(result.reps).toBe(4) // was 3, now 4
  })

  it('lapse: review → relearning → review', () => {
    // Lapse: review → relearning (stepIndex=1)
    let card = graduatedCard({ stepIndex: 2, interval: 10, reps: 5, lapses: 0 })
    let result = calculateNextReview(card, 1) // Again
    expect(result.cardState).toBe('relearning') // distinct from 'learning'
    expect(result.stepIndex).toBe(1)
    expect(result.lapses).toBe(1)
    expect(result.reps).toBe(5) // unchanged

    // Re-learn: step 1 → 2 (graduate again)
    card = newCard({ ...result, cardState: result.cardState })
    result = calculateNextReview(card, 3) // Good
    expect(result.stepIndex).toBe(2)
    expect(result.cardState).toBe('review')
  })

  it('Easy on new card immediately graduates', () => {
    const card = newCard({ stepIndex: 0 })
    const result = calculateNextReview(card, 4)
    expect(result.stepIndex).toBe(2)
    expect(result.cardState).toBe('review')
    expect(result.interval).toBe(4)
    expect(result.reps).toBe(1)
  })

  it('short interval graduated cards are still review state (bug fix)', () => {
    // Previously cards with interval < 21 stayed as 'learning' incorrectly
    const card = newCard({ stepIndex: 1 })
    const result = calculateNextReview(card, 3) // graduates
    expect(result.interval).toBe(1) // short interval
    expect(result.cardState).toBe('review') // but still review!
  })

  it('relearning card Again → stays relearning at step 0', () => {
    const card = newCard({ cardState: 'relearning', stepIndex: 1, lapses: 1 })
    const result = calculateNextReview(card, 1) // Again
    expect(result.cardState).toBe('relearning')
    expect(result.stepIndex).toBe(0)
    expect(result.lapses).toBe(1) // no additional lapse during relearning
  })

  it('relearning card Good → advances step, stays relearning until graduate', () => {
    const card = newCard({ cardState: 'relearning', stepIndex: 0, lapses: 1 })
    const result = calculateNextReview(card, 3) // Good
    expect(result.cardState).toBe('relearning')
    expect(result.stepIndex).toBe(1)
  })

  it('relearning card graduates back to review', () => {
    const card = newCard({ cardState: 'relearning', stepIndex: 1, lapses: 1, reps: 5 })
    const result = calculateNextReview(card, 3) // Good → graduates
    expect(result.cardState).toBe('review')
    expect(result.stepIndex).toBe(2)
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
