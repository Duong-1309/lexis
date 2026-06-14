import { useState } from 'react'
import type { Card } from '../../types'

interface Props {
  card: Card
  onSave: (id: number, frontHtml: string, backHtml: string, tags: string[]) => Promise<void>
  onClose: () => void
}

export function CardEditModal({ card, onSave, onClose }: Props) {
  const [front, setFront] = useState(card.frontHtml)
  const [back, setBack] = useState(card.backHtml)
  const [tagInput, setTagInput] = useState(card.tags.join(', '))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setSaving(true)
    setError(null)
    const tags = tagInput.split(',').map((t) => t.trim()).filter(Boolean)
    try {
      await onSave(card.id, front, back, tags)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60">
      <div className="bg-gray-900 border border-white/10 rounded-xl w-[600px] max-h-[80vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <h3 className="text-sm font-semibold text-white">Edit Card</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Front</label>
            <textarea
              value={front}
              onChange={(e) => setFront(e.target.value)}
              rows={4}
              className="w-full bg-gray-800 border border-white/10 rounded-md px-3 py-2 text-sm text-gray-200 font-mono resize-none focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Back</label>
            <textarea
              value={back}
              onChange={(e) => setBack(e.target.value)}
              rows={4}
              className="w-full bg-gray-800 border border-white/10 rounded-md px-3 py-2 text-sm text-gray-200 font-mono resize-none focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Tags (comma-separated)</label>
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              className="w-full bg-gray-800 border border-white/10 rounded-md px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
              placeholder="japanese, n4, verbs"
            />
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-white/5">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm text-gray-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-md transition-colors"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
