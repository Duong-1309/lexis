import { useEffect, useMemo, useRef, useState } from 'react'
import type { Card, CardState, Deck, DraftCard, Language, CardUpdate } from '../../types'
import { isTypingTarget } from '../../hooks/useHotkeys'
import { CardEditModal } from './CardEditModal'

interface Props {
  onClose: () => void
}

const STATE_LABEL: Record<CardState, string> = {
  new: 'New',
  learning: 'Learn',
  review: 'Review',
  suspended: 'Suspended',
}

const STATE_COLOR: Record<CardState, string> = {
  new: 'text-blue-400',
  learning: 'text-yellow-400',
  review: 'text-green-400',
  suspended: 'text-gray-500',
}

const LANG_LABELS: Record<Language, string> = {
  en: 'English',
  ja: 'Japanese',
  zh: 'Chinese',
  ko: 'Korean',
  fr: 'French',
  es: 'Spanish',
}

type StateFilter = CardState | 'all'
type LangFilter = Language | 'all'
type DeckNameDialog =
  | { mode: 'create'; initialName: string }
  | { mode: 'rename'; deck: Deck; initialName: string }
type ConfirmDialog =
  | { kind: 'delete-deck'; deck: Deck }
  | { kind: 'delete-cards'; count: number }

function selectedIds(selected: Set<number>): number[] {
  return [...selected]
}

function DeckNameModal({
  dialog,
  onCancel,
  onSubmit,
}: {
  dialog: DeckNameDialog
  onCancel: () => void
  onSubmit: (name: string) => Promise<void>
}) {
  const [name, setName] = useState(dialog.initialName)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const title = dialog.mode === 'create' ? 'Create Deck' : 'Rename Deck'

  async function handleSubmit(): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Deck name is required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSubmit(trimmed)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save deck')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60">
      <div className="w-[380px] bg-gray-900 border border-white/10 rounded-xl shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-white/5">
          <h3 className="text-sm font-semibold text-white">{title}</h3>
        </div>
        <div className="p-5 space-y-3">
          <label className="block text-xs font-medium text-gray-400">Deck name</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit()
              if (e.key === 'Escape') onCancel()
            }}
            className="w-full bg-gray-800 border border-white/10 rounded-md px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-white/5">
          <button onClick={onCancel} className="px-4 py-1.5 text-sm text-gray-400 hover:text-white transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-md transition-colors"
          >
            {saving ? 'Saving...' : dialog.mode === 'create' ? 'Create' : 'Rename'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ConfirmModal({
  dialog,
  onCancel,
  onConfirm,
}: {
  dialog: ConfirmDialog
  onCancel: () => void
  onConfirm: () => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const title = dialog.kind === 'delete-deck' ? 'Delete Deck' : 'Delete Cards'
  const message =
    dialog.kind === 'delete-deck'
      ? `Delete empty deck "${dialog.deck.name}"?`
      : `Delete ${dialog.count} card(s)? This cannot be undone.`

  async function handleConfirm(): Promise<void> {
    setSaving(true)
    setError(null)
    try {
      await onConfirm()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60">
      <div className="w-[420px] bg-gray-900 border border-white/10 rounded-xl shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-white/5">
          <h3 className="text-sm font-semibold text-white">{title}</h3>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-sm text-gray-300">{message}</p>
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-white/5">
          <button onClick={onCancel} className="px-4 py-1.5 text-sm text-gray-400 hover:text-white transition-colors">
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={saving}
            className="px-4 py-1.5 text-sm bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded-md transition-colors"
          >
            {saving ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function DeckBrowser({ onClose }: Props) {
  const [decks, setDecks] = useState<Deck[]>([])
  const [selectedDeckId, setSelectedDeckId] = useState<number | null>(null)
  const [cards, setCards] = useState<Card[]>([])
  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState<StateFilter>('all')
  const [languageFilter, setLanguageFilter] = useState<LangFilter>('all')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [editCard, setEditCard] = useState<Card | null>(null)
  const [showCreateCard, setShowCreateCard] = useState(false)
  const [deckNameDialog, setDeckNameDialog] = useState<DeckNameDialog | null>(null)
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  const selectedDeck = useMemo(
    () => decks.find((deck) => deck.id === selectedDeckId) ?? null,
    [decks, selectedDeckId],
  )

  const languages = useMemo(() => {
    const values = new Set(cards.map((card) => card.language).filter(Boolean) as Language[])
    return [...values].sort()
  }, [cards])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return cards.filter((card) => {
      const matchesSearch =
        !q ||
        (card.word ?? '').toLowerCase().includes(q) ||
        (card.reading ?? '').toLowerCase().includes(q) ||
        card.frontHtml.toLowerCase().includes(q) ||
        card.backHtml.toLowerCase().includes(q)
      const matchesState = stateFilter === 'all' || card.cardState === stateFilter
      const matchesLang = languageFilter === 'all' || card.language === languageFilter
      return matchesSearch && matchesState && matchesLang
    })
  }, [cards, languageFilter, search, stateFilter])

  useEffect(() => {
    loadDecks()
  }, [])

  useEffect(() => {
    if (selectedDeckId == null) {
      setCards([])
      return
    }
    loadCards(selectedDeckId)
  }, [selectedDeckId])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (editCard || showCreateCard || deckNameDialog || confirmDialog) return

      if (e.key === 'Escape' && e.target === searchInputRef.current) {
        e.preventDefault()
        setSearch('')
        searchInputRef.current?.blur()
        return
      }

      if (e.key === '/' && !isTypingTarget(e.target)) {
        e.preventDefault()
        searchInputRef.current?.focus()
        return
      }

      if (e.key.toLowerCase() === 'n' && !e.metaKey && !e.ctrlKey && !e.altKey && !isTypingTarget(e.target)) {
        e.preventDefault()
        if (decks.length > 0) setShowCreateCard(true)
        return
      }

      if (e.key === 'Escape' && !isTypingTarget(e.target)) {
        if (selected.size > 0) {
          setSelected(new Set())
          return
        }
        if (search || stateFilter !== 'all' || languageFilter !== 'all') {
          setSearch('')
          setStateFilter('all')
          setLanguageFilter('all')
          return
        }
        onClose()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [confirmDialog, deckNameDialog, decks.length, editCard, languageFilter, onClose, search, selected.size, showCreateCard, stateFilter])

  async function loadDecks(preferredDeckId?: number): Promise<void> {
    const result = await window.lexis.decks.list()
    if (result.error) {
      setError(result.error)
      return
    }
    const nextDecks = result.data ?? []
    setDecks(nextDecks)
    if (nextDecks.length === 0) {
      setSelectedDeckId(null)
      return
    }
    const nextId =
      preferredDeckId && nextDecks.some((deck) => deck.id === preferredDeckId)
        ? preferredDeckId
        : selectedDeckId && nextDecks.some((deck) => deck.id === selectedDeckId)
          ? selectedDeckId
          : nextDecks[0].id
    setSelectedDeckId(nextId)
  }

  async function loadCards(deckId: number): Promise<void> {
    setLoading(true)
    setError(null)
    setSelected(new Set())
    const result = await window.lexis.cards.all(deckId)
    setLoading(false)
    if (result.error) {
      setError(result.error)
      setCards([])
      return
    }
    setCards(result.data ?? [])
  }

  function toggleSelect(id: number): void {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAll(): void {
    setSelected(selected.size === filtered.length ? new Set() : new Set(filtered.map((card) => card.id)))
  }

  function handleCreateDeck(): void {
    setError(null)
    setDeckNameDialog({ mode: 'create', initialName: '' })
  }

  async function handleCreateDeckSubmit(name: string): Promise<void> {
    const result = await window.lexis.decks.create(name)
    if (result.error) throw new Error(result.error)
    setDeckNameDialog(null)
    await loadDecks(result.data?.id)
  }

  function handleRenameDeck(): void {
    if (!selectedDeck) return
    setError(null)
    setDeckNameDialog({ mode: 'rename', deck: selectedDeck, initialName: selectedDeck.name })
  }

  async function handleRenameDeckSubmit(name: string): Promise<void> {
    const dialog = deckNameDialog?.mode === 'rename' ? deckNameDialog : null
    if (!dialog) return
    if (name === dialog.deck.name) {
      setDeckNameDialog(null)
      return
    }
    const result = await window.lexis.decks.rename(dialog.deck.id, name)
    if (result.error) throw new Error(result.error)
    setDeckNameDialog(null)
    await loadDecks(dialog.deck.id)
  }

  function handleDeleteDeck(): void {
    if (!selectedDeck) return
    if ((selectedDeck.cardCount ?? 0) > 0) {
      setError('Move or delete all cards before deleting this deck')
      return
    }
    if (selectedDeck.name === 'Default' && decks.length <= 1) {
      setError('Default deck cannot be deleted while it is the only deck')
      return
    }
    setError(null)
    setConfirmDialog({ kind: 'delete-deck', deck: selectedDeck })
  }

  async function handleDeleteDeckConfirm(deck: Deck): Promise<void> {
    const result = await window.lexis.decks.delete(deck.id)
    if (result.error) throw new Error(result.error)
    setConfirmDialog(null)
    await loadDecks()
  }

  async function handleSuspend(): Promise<void> {
    const ids = selectedIds(selected)
    await Promise.all(ids.map((id) => window.lexis.cards.suspend(id)))
    if (selectedDeckId != null) await loadCards(selectedDeckId)
    await loadDecks(selectedDeckId ?? undefined)
  }

  async function handleUnsuspend(): Promise<void> {
    const ids = selectedIds(selected)
    const result = await window.lexis.cards.unsuspend(ids)
    if (result.error) {
      setError(result.error)
      return
    }
    if (selectedDeckId != null) await loadCards(selectedDeckId)
    await loadDecks(selectedDeckId ?? undefined)
  }

  async function handleMove(targetDeckId: number): Promise<void> {
    const ids = selectedIds(selected)
    if (ids.length === 0 || targetDeckId === selectedDeckId) return
    const result = await window.lexis.cards.move(ids, targetDeckId)
    if (result.error) {
      setError(result.error)
      return
    }
    if (selectedDeckId != null) await loadCards(selectedDeckId)
    await loadDecks(selectedDeckId ?? undefined)
  }

  function handleDeleteCards(): void {
    const ids = selectedIds(selected)
    if (ids.length === 0) return
    setError(null)
    setConfirmDialog({ kind: 'delete-cards', count: ids.length })
  }

  async function handleDeleteCardsConfirm(): Promise<void> {
    const ids = selectedIds(selected)
    await Promise.all(ids.map((id) => window.lexis.cards.delete(id)))
    setConfirmDialog(null)
    if (selectedDeckId != null) await loadCards(selectedDeckId)
    await loadDecks(selectedDeckId ?? undefined)
  }

  async function handleCreateCard(draft: DraftCard): Promise<void> {
    const result = await window.lexis.cards.create(draft)
    if (result.error) throw new Error(result.error)
    await loadDecks(draft.deckId)
    await loadCards(draft.deckId)
  }

  async function handleSaveEdit(id: number, updates: CardUpdate): Promise<void> {
    const result = await window.lexis.cards.update(id, updates)
    if (result.error) throw new Error(result.error)
    const nextDeckId = updates.deckId ?? selectedDeckId
    await loadDecks(nextDeckId ?? undefined)
    if (nextDeckId != null) await loadCards(nextDeckId)
  }

  function handleExport(): void {
    if (!selectedDeck) return
    const blob = new Blob([
      JSON.stringify({
        version: 1,
        exportedAt: new Date().toISOString(),
        deck: selectedDeck,
        cards: filtered,
      }, null, 2),
    ], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${selectedDeck.name}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const hasSelection = selected.size > 0

  return (
    <div className="h-full bg-gray-950 flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 shrink-0">
        <div>
          <h2 className="text-base font-semibold text-white">Deck Browser</h2>
          {selectedDeck && (
            <p className="text-xs text-gray-500 mt-0.5">
              {selectedDeck.cardCount ?? 0} cards · {selectedDeck.dueCount ?? 0} due
            </p>
          )}
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {error && (
        <div className="px-6 py-2 text-xs text-red-300 bg-red-500/10 border-b border-red-500/20">
          {error}
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        <div className="w-52 shrink-0 border-r border-white/5 flex flex-col min-h-0">
          <div className="p-3 border-b border-white/5 space-y-2">
            <button
              onClick={handleCreateDeck}
              className="w-full px-3 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-colors"
            >
              Create Deck
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={handleRenameDeck}
                disabled={!selectedDeck}
                className="px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-300 rounded-md transition-colors"
              >
                Rename
              </button>
              <button
                onClick={handleDeleteDeck}
                disabled={!selectedDeck}
                className="px-3 py-1.5 text-xs bg-red-600/20 hover:bg-red-600/30 disabled:opacity-40 text-red-300 rounded-md transition-colors"
              >
                Delete
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto py-2">
            {decks.map((deck) => (
              <button
                key={deck.id}
                onClick={() => setSelectedDeckId(deck.id)}
                className={`w-full text-left px-4 py-2.5 text-sm transition-colors hover:bg-white/5 ${
                  deck.id === selectedDeckId ? 'text-blue-400 bg-blue-600/10' : 'text-gray-300'
                }`}
              >
                <div className="truncate font-medium">{deck.name}</div>
                <div className="text-xs text-gray-500">
                  {deck.cardCount ?? 0} cards · {deck.dueCount ?? 0} due
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-white/5 shrink-0">
            <input
              ref={searchInputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search cards..."
              className="min-w-52 flex-1 bg-gray-800 border border-white/10 rounded-md px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
            />
            <select
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value as StateFilter)}
              className="bg-gray-800 border border-white/10 rounded-md px-2 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-blue-500"
            >
              <option value="all">All states</option>
              {Object.entries(STATE_LABEL).map(([state, label]) => (
                <option key={state} value={state}>{label}</option>
              ))}
            </select>
            <select
              value={languageFilter}
              onChange={(e) => setLanguageFilter(e.target.value as LangFilter)}
              className="bg-gray-800 border border-white/10 rounded-md px-2 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-blue-500"
            >
              <option value="all">All languages</option>
              {languages.map((lang) => (
                <option key={lang} value={lang}>{LANG_LABELS[lang]}</option>
              ))}
            </select>
            <button
              onClick={() => setShowCreateCard(true)}
              disabled={decks.length === 0}
              className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-md transition-colors"
            >
              New Card <span className="ml-1 opacity-60">N</span>
            </button>
            <button onClick={handleExport} className="px-3 py-1.5 text-xs bg-gray-700 text-gray-300 hover:bg-gray-600 rounded-md transition-colors">
              Export JSON
            </button>
          </div>

          {hasSelection && (
            <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-white/5 bg-gray-900/70 shrink-0">
              <span className="text-xs text-gray-400">{selected.size} selected</span>
              <select
                defaultValue=""
                onChange={(e) => {
                  const value = Number(e.target.value)
                  e.currentTarget.value = ''
                  if (value) handleMove(value)
                }}
                className="bg-gray-800 border border-white/10 rounded-md px-2 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-blue-500"
              >
                <option value="" disabled>Move to...</option>
                {decks
                  .filter((deck) => deck.id !== selectedDeckId)
                  .map((deck) => <option key={deck.id} value={deck.id}>{deck.name}</option>)}
              </select>
              <button onClick={handleSuspend} className="px-3 py-1.5 text-xs bg-yellow-600/20 text-yellow-400 hover:bg-yellow-600/30 rounded-md transition-colors">
                Suspend
              </button>
              <button onClick={handleUnsuspend} className="px-3 py-1.5 text-xs bg-green-600/20 text-green-400 hover:bg-green-600/30 rounded-md transition-colors">
                Unsuspend
              </button>
              <button onClick={handleDeleteCards} className="px-3 py-1.5 text-xs bg-red-600/20 text-red-400 hover:bg-red-600/30 rounded-md transition-colors">
                Delete
              </button>
            </div>
          )}

          {loading ? (
            <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">Loading...</div>
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
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Language</th>
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
                      <td className="px-3 py-2 text-xs text-gray-400">
                        {card.language ? LANG_LABELS[card.language] : '—'}
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
                      <td colSpan={8} className="px-4 py-8 text-center text-gray-500 text-sm">
                        {search || stateFilter !== 'all' || languageFilter !== 'all' ? 'No matching cards' : 'No cards in this deck'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {(editCard || showCreateCard) && (
        <CardEditModal
          card={editCard ?? undefined}
          decks={decks}
          initialDeckId={selectedDeckId}
          onCreate={handleCreateCard}
          onSave={handleSaveEdit}
          onClose={() => { setEditCard(null); setShowCreateCard(false) }}
        />
      )}

      {deckNameDialog && (
        <DeckNameModal
          dialog={deckNameDialog}
          onCancel={() => setDeckNameDialog(null)}
          onSubmit={deckNameDialog.mode === 'create' ? handleCreateDeckSubmit : handleRenameDeckSubmit}
        />
      )}

      {confirmDialog && (
        <ConfirmModal
          dialog={confirmDialog}
          onCancel={() => setConfirmDialog(null)}
          onConfirm={() =>
            confirmDialog.kind === 'delete-deck'
              ? handleDeleteDeckConfirm(confirmDialog.deck)
              : handleDeleteCardsConfirm()
          }
        />
      )}
    </div>
  )
}
