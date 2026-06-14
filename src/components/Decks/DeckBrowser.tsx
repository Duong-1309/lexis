import { useEffect, useState, useMemo } from 'react'
import type { Deck, Card, CardState } from '../../types'
import { CardEditModal } from './CardEditModal'

interface Props {
  onClose: () => void
}

const STATE_LABEL: Record<CardState, string> = {
  new: 'New', learning: 'Learn', review: 'Review', suspended: 'Suspended',
}
const STATE_COLOR: Record<CardState, string> = {
  new: 'text-blue-400', learning: 'text-yellow-400', review: 'text-green-400', suspended: 'text-gray-500',
}

export function DeckBrowser({ onClose }: Props) {
  const [decks, setDecks] = useState<Deck[]>([])
  const [selectedDeckId, setSelectedDeckId] = useState<number | null>(null)
  const [cards, setCards] = useState<Card[]>([])
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [editCard, setEditCard] = useState<Card | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    window.lexis.decks.list().then((r) => {
      if (r.data) {
        setDecks(r.data)
        if (r.data.length > 0) setSelectedDeckId(r.data[0].id)
      }
    })
  }, [])

  useEffect(() => {
    if (selectedDeckId == null) return
    setLoading(true)
    setSelected(new Set())
    window.lexis.cards.all(selectedDeckId).then((r) => {
      setLoading(false)
      if (r.data) setCards(r.data)
    })
  }, [selectedDeckId])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return q ? cards.filter((c) => (c.word ?? '').toLowerCase().includes(q) || c.frontHtml.toLowerCase().includes(q)) : cards
  }, [cards, search])

  function toggleSelect(id: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelected(selected.size === filtered.length ? new Set() : new Set(filtered.map((c) => c.id)))
  }

  async function handleSuspend() {
    await Promise.all([...selected].map((id) => window.lexis.cards.suspend(id)))
    setCards((prev) => prev.map((c) => selected.has(c.id) ? { ...c, cardState: 'suspended' as CardState } : c))
    setSelected(new Set())
  }

  async function handleDelete() {
    if (!confirm(`Delete ${selected.size} card(s)? This cannot be undone.`)) return
    await Promise.all([...selected].map((id) => window.lexis.cards.delete(id)))
    setCards((prev) => prev.filter((c) => !selected.has(c.id)))
    setSelected(new Set())
  }

  async function handleSaveEdit(id: number, frontHtml: string, backHtml: string, tags: string[]) {
    const result = await window.lexis.cards.update(id, frontHtml, backHtml, tags)
    if (result.error) throw new Error(result.error)
    setCards((prev) => prev.map((c) => c.id === id ? { ...c, frontHtml, backHtml, tags } : c))
  }

  function handleExport() {
    const deck = decks.find((d) => d.id === selectedDeckId)
    const blob = new Blob([JSON.stringify({ deck: deck?.name, cards: filtered }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${deck?.name ?? 'deck'}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="h-full bg-gray-950 flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 shrink-0">
        <h2 className="text-base font-semibold text-white">Deck Browser</h2>
        <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* deck sidebar */}
        <div className="w-44 shrink-0 border-r border-white/5 overflow-y-auto py-2">
          {decks.map((d) => (
            <button
              key={d.id}
              onClick={() => setSelectedDeckId(d.id)}
              className={`w-full text-left px-4 py-2.5 text-sm transition-colors hover:bg-white/5 ${
                d.id === selectedDeckId ? 'text-blue-400 bg-blue-600/10' : 'text-gray-300'
              }`}
            >
              <div className="truncate font-medium">{d.name}</div>
              <div className="text-xs text-gray-500">{d.cardCount ?? 0} cards</div>
            </button>
          ))}
        </div>

        {/* card table */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* toolbar */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5 shrink-0">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search cards…"
              className="flex-1 bg-gray-800 border border-white/10 rounded-md px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
            />
            {selected.size > 0 && (
              <>
                <button onClick={handleSuspend} className="px-3 py-1.5 text-xs bg-yellow-600/20 text-yellow-400 hover:bg-yellow-600/30 rounded-md transition-colors">
                  Suspend ({selected.size})
                </button>
                <button onClick={handleDelete} className="px-3 py-1.5 text-xs bg-red-600/20 text-red-400 hover:bg-red-600/30 rounded-md transition-colors">
                  Delete ({selected.size})
                </button>
              </>
            )}
            <button onClick={handleExport} className="px-3 py-1.5 text-xs bg-gray-700 text-gray-300 hover:bg-gray-600 rounded-md transition-colors">
              Export JSON
            </button>
          </div>

          {loading ? (
            <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">Loading…</div>
          ) : (
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-900 border-b border-white/5">
                  <tr>
                    <th className="w-8 px-4 py-2 text-left">
                      <input type="checkbox" checked={selected.size === filtered.length && filtered.length > 0} onChange={toggleAll} className="accent-blue-500" />
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Word</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">State</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Due</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Ease</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Lapses</th>
                    <th className="w-12" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((card) => (
                    <tr key={card.id} className="border-b border-white/5 hover:bg-white/3 group">
                      <td className="px-4 py-2">
                        <input type="checkbox" checked={selected.has(card.id)} onChange={() => toggleSelect(card.id)} className="accent-blue-500" />
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-gray-200">{card.word ?? '—'}</div>
                        {card.reading && <div className="text-xs text-gray-500">{card.reading}</div>}
                      </td>
                      <td className={`px-3 py-2 text-xs font-medium ${STATE_COLOR[card.cardState]}`}>
                        {STATE_LABEL[card.cardState]}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-400">{card.dueDate}</td>
                      <td className="px-3 py-2 text-xs text-gray-400">{Math.round(card.easeFactor * 100)}%</td>
                      <td className="px-3 py-2 text-xs text-gray-400">{card.lapses}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => setEditCard(card)}
                          className="opacity-0 group-hover:opacity-100 text-xs text-gray-500 hover:text-gray-200 transition-all px-2 py-0.5"
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-gray-500 text-sm">
                        {search ? 'No matching cards' : 'No cards in this deck'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {editCard && (
        <CardEditModal card={editCard} onSave={handleSaveEdit} onClose={() => setEditCard(null)} />
      )}
    </div>
  )
}
