import { useEffect, useState, useCallback, useRef } from 'react'
import type { Card, ReviewRating } from '../../types'
import { isTypingTarget } from '../../hooks/useHotkeys'

type Phase = 'front' | 'back' | 'done'

interface SessionStats {
  total: number
  correct: number
  startTime: number
}

interface ReviewSessionProps {
  deckId: number
  deckName: string
  onEnd: () => void
}

const RATING_LABELS: Record<ReviewRating, string> = {
  1: 'Again',
  2: 'Hard',
  3: 'Good',
  4: 'Easy',
}

const RATING_COLORS: Record<ReviewRating, string> = {
  1: 'bg-red-600 hover:bg-red-500',
  2: 'bg-orange-600 hover:bg-orange-500',
  3: 'bg-green-600 hover:bg-green-500',
  4: 'bg-blue-600 hover:bg-blue-500',
}

function estimateInterval(card: Card, rating: ReviewRating): string {
  if (rating === 1) return '1d'
  if (rating === 2) return `${Math.max(1, Math.round(card.interval * 1.2))}d`
  if (card.reps === 0) return '1d'
  if (card.reps === 1) return '6d'
  const base = Math.round(card.interval * card.easeFactor)
  return rating === 4 ? `${Math.round(base * 1.3)}d` : `${base}d`
}

export function ReviewSession({ deckId, deckName, onEnd }: ReviewSessionProps) {
  const [cards, setCards] = useState<Card[]>([])
  const [index, setIndex] = useState(0)
  const [phase, setPhase] = useState<Phase>('front')
  const [flipped, setFlipped] = useState(false)
  const [stats, setStats] = useState<SessionStats>({ total: 0, correct: 0, startTime: Date.now() })
  const [loading, setLoading] = useState(true)
  const cardShownAt = useRef<number>(Date.now())

  useEffect(() => {
    window.lexis.cards.due(deckId).then((r) => {
      if (r.data) {
        // shuffle
        const shuffled = [...r.data].sort(() => Math.random() - 0.5)
        setCards(shuffled)
      }
      setLoading(false)
    })
  }, [deckId])

  const currentCard = cards[index] ?? null
  const remaining = cards.length - index

  const handleShow = useCallback(() => {
    setFlipped(true)
    setTimeout(() => setPhase('back'), 150)
  }, [])

  const handleRate = useCallback(
    async (rating: ReviewRating) => {
      if (!currentCard) return
      const timeTakenMs = Date.now() - cardShownAt.current

      await window.lexis.cards.review(currentCard.id, rating, timeTakenMs)

      setStats((prev) => ({
        ...prev,
        total: prev.total + 1,
        correct: rating >= 3 ? prev.correct + 1 : prev.correct,
      }))

      const next = index + 1
      if (next >= cards.length) {
        setPhase('done')
      } else {
        setFlipped(false)
        setPhase('front')
        setIndex(next)
        cardShownAt.current = Date.now()
      }
    },
    [currentCard, index, cards.length],
  )

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return

      if (phase === 'front' && e.key === ' ') {
        e.preventDefault()
        handleShow()
      }
      if (phase === 'back') {
        if (e.key === '1') handleRate(1)
        if (e.key === '2') handleRate(2)
        if (e.key === '3') handleRate(3)
        if (e.key === '4') handleRate(4)
      }
      if (e.key === 'Escape') onEnd()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [phase, handleShow, handleRate, onEnd])

  // Reset card shown time on index change
  useEffect(() => {
    cardShownAt.current = Date.now()
  }, [index])

  if (loading) {
    return (
      <SessionShell deckName={deckName} remaining={0} onEnd={onEnd}>
        <div className="flex items-center justify-center h-full text-gray-500 text-sm">
          Loading cards...
        </div>
      </SessionShell>
    )
  }

  if (cards.length === 0) {
    return (
      <SessionShell deckName={deckName} remaining={0} onEnd={onEnd}>
        <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-500">
          <p className="text-sm">No cards due in this deck.</p>
          <button onClick={onEnd} className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
            Back to library
          </button>
        </div>
      </SessionShell>
    )
  }

  if (phase === 'done') {
    return <SessionSummary stats={stats} onEnd={onEnd} />
  }

  return (
    <SessionShell deckName={deckName} remaining={remaining} onEnd={onEnd}>
      <div className="flex flex-col items-center justify-center h-full gap-8 px-8">
        {/* Card */}
        <div
          className="w-full max-w-lg"
          style={{ perspective: '1000px' }}
        >
          <div
            className="relative w-full transition-transform duration-300"
            style={{
              transformStyle: 'preserve-3d',
              transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
              minHeight: '200px',
            }}
          >
            {/* Front */}
            <div
              className="absolute inset-0 bg-gray-800 border border-white/10 rounded-xl p-8 flex items-center justify-center"
              style={{ backfaceVisibility: 'hidden' }}
            >
              <div
                className="text-2xl font-medium text-gray-100 text-center"
                dangerouslySetInnerHTML={{ __html: currentCard?.frontHtml ?? '' }}
              />
            </div>
            {/* Back */}
            <div
              className="absolute inset-0 bg-gray-800 border border-white/10 rounded-xl p-8 flex items-center justify-center"
              style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
            >
              <div
                className="text-base text-gray-200 text-center leading-relaxed"
                dangerouslySetInnerHTML={{ __html: currentCard?.backHtml ?? '' }}
              />
            </div>
          </div>
        </div>

        {/* Tags */}
        {currentCard?.tags.length ? (
          <div className="flex gap-1.5">
            {currentCard.tags.map((t) => (
              <span key={t} className="text-xs px-2 py-0.5 bg-gray-700 text-gray-400 rounded-full">
                {t}
              </span>
            ))}
          </div>
        ) : null}

        {/* Actions */}
        {phase === 'front' && (
          <button
            onClick={handleShow}
            className="px-8 py-3 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm font-medium rounded-xl transition-colors"
          >
            Show <span className="ml-1 text-xs opacity-50">Space</span>
          </button>
        )}

        {phase === 'back' && (
          <div className="flex gap-3">
            {([1, 2, 3, 4] as ReviewRating[]).map((r) => (
              <button
                key={r}
                onClick={() => handleRate(r)}
                className={`flex flex-col items-center px-5 py-3 text-white text-sm font-medium rounded-xl transition-colors ${RATING_COLORS[r]}`}
              >
                <span>{RATING_LABELS[r]}</span>
                <span className="text-[10px] opacity-70 mt-0.5">
                  {estimateInterval(currentCard!, r)} · {r}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </SessionShell>
  )
}

function SessionShell({
  deckName,
  remaining,
  onEnd,
  children,
}: {
  deckName: string
  remaining: number
  onEnd: () => void
  children: React.ReactNode
}) {
  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-gray-950">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-white/5 bg-gray-900">
        <span className="text-sm font-medium text-gray-300">{deckName}</span>
        <div className="flex items-center gap-4">
          {remaining > 0 && (
            <span className="text-xs text-gray-500">
              {remaining} remaining
            </span>
          )}
          <button
            onClick={onEnd}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors flex items-center gap-1"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            End
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-hidden">{children}</div>
    </div>
  )
}

function SessionSummary({ stats, onEnd }: { stats: SessionStats; onEnd: () => void }) {
  const elapsed = Math.round((Date.now() - stats.startTime) / 1000)
  const minutes = Math.floor(elapsed / 60)
  const seconds = elapsed % 60
  const accuracy = stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0
  const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`

  return (
    <div className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-gray-950 gap-8">
      <div className="text-center">
        <div className="text-4xl mb-2">{accuracy >= 80 ? '🎉' : accuracy >= 50 ? '👍' : '📚'}</div>
        <h2 className="text-xl font-semibold text-gray-100 mb-1">Session complete</h2>
        <p className="text-sm text-gray-500">Keep it up!</p>
      </div>

      <div className="flex gap-6">
        <Stat label="Reviewed" value={String(stats.total)} />
        <Stat label="Correct" value={`${accuracy}%`} highlight={accuracy >= 80} />
        <Stat label="Time" value={timeStr} />
      </div>

      <button
        onClick={onEnd}
        className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-xl transition-colors"
      >
        Back to library
      </button>
    </div>
  )
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="text-center bg-gray-800 border border-white/10 rounded-xl px-6 py-4 min-w-[90px]">
      <p className={`text-2xl font-semibold ${highlight ? 'text-green-400' : 'text-gray-100'}`}>
        {value}
      </p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
    </div>
  )
}
