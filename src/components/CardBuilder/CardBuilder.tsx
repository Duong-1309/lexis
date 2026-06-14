import { useEffect, useState } from 'react'
import { useCardStore } from '../../store/cardStore'
import type { Deck } from '../../types'

interface CardBuilderProps {
  onSaved?: () => void
}

export function CardBuilder({ onSaved }: CardBuilderProps) {
  const { open, draft, decks, isDuplicate, closeBuilder, updateDraft, setDecks, setIsDuplicate } =
    useCardStore()

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [tagInput, setTagInput] = useState('')

  useEffect(() => {
    if (!open) return
    loadDecks()
    setSaved(false)
  }, [open])

  useEffect(() => {
    if (!draft?.word || !draft?.language) return
    window.lexis.cards.isDuplicate(draft.word, draft.language).then((r) => {
      if (r.data !== null) setIsDuplicate(r.data)
    })
  }, [draft?.word, draft?.language])

  const loadDecks = async () => {
    const result = await window.lexis.decks.list()
    if (result.data) setDecks(result.data)
  }

  const handleAddTag = () => {
    const tag = tagInput.trim().toLowerCase()
    if (!tag || !draft) return
    if (!draft.tags.includes(tag)) {
      updateDraft({ tags: [...draft.tags, tag] })
    }
    setTagInput('')
  }

  const handleRemoveTag = (tag: string) => {
    if (!draft) return
    updateDraft({ tags: draft.tags.filter((t) => t !== tag) })
  }

  const handleSave = async () => {
    if (!draft || saving || saved) return
    setSaving(true)
    const result = await window.lexis.cards.create(draft)
    setSaving(false)
    if (result.error) {
      alert(`Failed to save card: ${result.error}`)
      return
    }
    setSaved(true)
    onSaved?.()
    setTimeout(() => closeBuilder(), 800)
  }

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        handleSave()
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        closeBuilder()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, draft, saving, saved])

  if (!open || !draft) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => e.target === e.currentTarget && closeBuilder()}
    >
      <div className="w-[700px] max-h-[85vh] bg-gray-900 border border-white/10 rounded-xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/5">
          <h2 className="text-sm font-semibold text-gray-200">Add Card</h2>
          <button onClick={closeBuilder} className="text-gray-500 hover:text-gray-300 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Duplicate warning */}
        {isDuplicate && (
          <div className="mx-5 mt-3 px-3 py-2 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-xs text-yellow-400">
            A card for <strong>{draft.word}</strong> already exists in your decks.
          </div>
        )}

        {/* Body */}
        <div className="flex flex-1 min-h-0 gap-4 p-5">
          {/* Editor */}
          <div className="flex-1 flex flex-col gap-3 min-w-0">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Front</label>
              <textarea
                className="w-full h-20 px-3 py-2 bg-gray-800 border border-white/10 rounded-lg text-sm text-gray-100 resize-none focus:outline-none focus:border-blue-500/50"
                value={draft.frontHtml}
                onChange={(e) => updateDraft({ frontHtml: e.target.value })}
              />
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">Back</label>
              <textarea
                className="w-full h-28 px-3 py-2 bg-gray-800 border border-white/10 rounded-lg text-sm text-gray-100 resize-none focus:outline-none focus:border-blue-500/50"
                value={draft.backHtml}
                onChange={(e) => updateDraft({ backHtml: e.target.value })}
              />
            </div>

            {/* Deck selector */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">Deck</label>
              <select
                className="w-full px-3 py-2 bg-gray-800 border border-white/10 rounded-lg text-sm text-gray-100 focus:outline-none focus:border-blue-500/50"
                value={draft.deckId}
                onChange={(e) => updateDraft({ deckId: Number(e.target.value) })}
              >
                {decks.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.cardCount ?? 0} cards)
                  </option>
                ))}
              </select>
            </div>

            {/* Tags */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">Tags</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {draft.tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-600/20 text-blue-300 text-xs rounded-full"
                  >
                    {tag}
                    <button
                      onClick={() => handleRemoveTag(tag)}
                      className="hover:text-white transition-colors"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  className="flex-1 px-3 py-1.5 bg-gray-800 border border-white/10 rounded-lg text-xs text-gray-100 focus:outline-none focus:border-blue-500/50"
                  placeholder="Add tag..."
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddTag()}
                />
                <button
                  onClick={handleAddTag}
                  className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors"
                >
                  Add
                </button>
              </div>
            </div>
          </div>

          {/* Preview */}
          <div className="w-52 shrink-0 flex flex-col gap-2">
            <span className="text-xs text-gray-400">Preview</span>
            <div className="bg-gray-800 border border-white/10 rounded-lg p-3 min-h-[80px]">
              <div className="text-sm text-gray-100 font-medium"
                dangerouslySetInnerHTML={{ __html: draft.frontHtml }} />
            </div>
            <div className="bg-gray-800 border border-white/10 rounded-lg p-3 min-h-[100px]">
              <div className="text-sm text-gray-300"
                dangerouslySetInnerHTML={{ __html: draft.backHtml }} />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-white/5">
          <button
            onClick={closeBuilder}
            className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || saved}
            className={`px-5 py-2 text-sm font-medium rounded-lg transition-colors ${
              saved
                ? 'bg-green-600/80 text-white'
                : 'bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50'
            }`}
          >
            {saved ? 'Saved!' : saving ? 'Saving...' : 'Add to Deck'}
            {!saving && !saved && <span className="ml-2 text-xs opacity-60">Ctrl/⌘ Enter</span>}
          </button>
        </div>
      </div>
    </div>
  )
}
