import { useEffect, useState } from 'react'
import type { Deck } from '../../types'

interface DeckPickerProps {
  onStart: (deckId: number) => void
  onClose: () => void
}

export function DeckPicker({ onStart, onClose }: DeckPickerProps) {
  const [decks, setDecks] = useState<Deck[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    window.lexis.decks.list().then((r) => {
      if (r.data) setDecks(r.data)
      setLoading(false)
    })
  }, [])

  const totalDue = decks.reduce((sum, d) => sum + (d.dueCount ?? 0), 0)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-96 bg-gray-900 border border-white/10 rounded-xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <div>
            <h2 className="text-sm font-semibold text-gray-200">Review</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {totalDue} card{totalDue !== 1 ? 's' : ''} due across all decks
            </p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="py-2 max-h-80 overflow-y-auto">
          {loading && (
            <p className="text-sm text-gray-500 px-5 py-4">Loading decks...</p>
          )}
          {!loading && decks.length === 0 && (
            <p className="text-sm text-gray-500 px-5 py-4">No decks yet. Add cards first.</p>
          )}
          {decks.map((deck) => (
            <button
              key={deck.id}
              onClick={() => onStart(deck.id)}
              disabled={(deck.dueCount ?? 0) === 0}
              className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <div>
                <p className="text-sm font-medium text-gray-200">{deck.name}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {deck.cardCount ?? 0} total · {deck.newCount ?? 0} new
                </p>
              </div>
              <span
                className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                  (deck.dueCount ?? 0) > 0
                    ? 'bg-blue-500/20 text-blue-300'
                    : 'bg-gray-700 text-gray-500'
                }`}
              >
                {deck.dueCount ?? 0} due
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
