import type { Card, CardState, SRSResult, ReviewRating } from '../../src/types/index'

function todayPlusDays(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function nowPlusMinutes(minutes: number): string {
  const d = new Date()
  d.setMinutes(d.getMinutes() + minutes)
  return d.toISOString().slice(0, 19).replace('T', ' ')
}

// Learning steps: [1 minute, 10 minutes]
// stepIndex 0 → 1min wait → stepIndex 1 → 10min wait → graduate (stepIndex 2)
function learningDelayMinutes(stepIndex: number): number {
  return stepIndex === 0 ? 1 : 10
}

// ±5% fuzz to prevent cards from piling up on the same day
function fuzz(interval: number): number {
  if (interval <= 1) return interval
  const maxDelta = Math.max(1, Math.round(interval * 0.05))
  const jitter = Math.floor(Math.random() * (maxDelta * 2 + 1)) - maxDelta
  return Math.max(1, interval + jitter)
}

export function calculateNextReview(card: Card, rating: ReviewRating): SRSResult {
  let { interval, easeFactor, reps, lapses } = card
  let stepIndex = card.stepIndex ?? 0
  let dueDate: string | null = null

  // Graduated: stepIndex >= 2 (2 learning steps: 1min, 10min)
  // Backward-compat: treat as graduated if cardState=review regardless of stepIndex
  const isGraduated = card.cardState === 'review' || stepIndex >= 2

  if (isGraduated) {
    // SM-2 ease update for graduated cards
    easeFactor = easeFactor + (0.1 - (5 - rating) * (0.08 + (5 - rating) * 0.02))
    if (easeFactor < 1.3) easeFactor = 1.3

    if (rating === 1) {
      // Lapse: re-enter relearning at step 1 (not step 0 — avoids full new-card flow)
      lapses += 1
      stepIndex = 1
      interval = 1
      dueDate = nowPlusMinutes(learningDelayMinutes(stepIndex))
      // reps intentionally unchanged on lapse
    } else if (rating === 2) {
      // Hard: slow growth, reps unchanged (fix: was incorrectly decrementing reps)
      interval = fuzz(Math.max(1, Math.round(interval * 1.2)))
    } else {
      // Good (3) or Easy (4)
      interval = Math.round(interval * easeFactor)
      if (rating === 4) interval = Math.round(interval * 1.3)
      interval = fuzz(interval)
      reps += 1
    }
  } else {
    // Learning steps: stepIndex 0 (1min) → stepIndex 1 (10min) → graduate (stepIndex 2)
    if (rating === 1) {
      // Again: restart learning
      stepIndex = 0
      interval = 1
      dueDate = nowPlusMinutes(learningDelayMinutes(stepIndex))
    } else if (rating === 4) {
      // Easy: graduate immediately
      stepIndex = 2
      interval = 4
      reps += 1
    } else if (rating === 2) {
      // Hard: stay at current step
      interval = 1
      dueDate = nowPlusMinutes(learningDelayMinutes(stepIndex))
    } else {
      // Good: advance one step
      stepIndex += 1
      if (stepIndex >= 2) {
        // Graduated
        interval = 1
        reps += 1
      } else {
        interval = 1
        dueDate = nowPlusMinutes(learningDelayMinutes(stepIndex))
      }
    }
  }

  const cardState: CardState = stepIndex >= 2
    ? (interval >= 21 ? 'review' : 'learning')
    : 'learning'

  return {
    interval,
    easeFactor: Math.round(easeFactor * 1000) / 1000,
    reps,
    lapses,
    cardState,
    stepIndex,
    dueDate: dueDate ?? todayPlusDays(interval),
  }
}
