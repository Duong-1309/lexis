import type { Card, SRSResult, ReviewRating } from '../../src/types/index'

function todayPlusDays(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export function calculateNextReview(card: Card, rating: ReviewRating): SRSResult {
  let { interval, easeFactor, reps, lapses } = card

  // Update ease factor (SM-2 formula)
  easeFactor = easeFactor + (0.1 - (5 - rating) * (0.08 + (5 - rating) * 0.02))
  if (easeFactor < 1.3) easeFactor = 1.3

  if (rating === 1) {
    // Again — reset
    interval = 1
    reps = 0
    lapses += 1
  } else if (rating === 2) {
    // Hard — slow progression
    interval = Math.max(1, Math.round(interval * 1.2))
    reps = Math.max(0, reps - 1)
  } else {
    // Good (3) or Easy (4)
    if (reps === 0) {
      interval = 1
    } else if (reps === 1) {
      interval = 6
    } else {
      interval = Math.round(interval * easeFactor)
    }
    if (rating === 4) {
      interval = Math.round(interval * 1.3)
    }
    reps += 1
  }

  const cardState = rating === 1 ? 'learning' : interval >= 21 ? 'review' : 'learning'

  return {
    interval,
    easeFactor: Math.round(easeFactor * 1000) / 1000,
    reps,
    lapses,
    cardState,
    dueDate: todayPlusDays(interval),
  }
}
