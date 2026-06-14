import { useMemo, useState } from 'react'
import type { Card, CardTemplate, CardUpdate, Deck, DraftCard, Language } from '../../types'

interface Props {
  card?: Card
  decks: Deck[]
  initialDeckId: number | null
  onCreate: (draft: DraftCard) => Promise<void>
  onSave: (id: number, updates: CardUpdate) => Promise<void>
  onClose: () => void
}

const LANGUAGES: Array<{ value: Language; label: string }> = [
  { value: 'en', label: 'English' },
  { value: 'ja', label: 'Japanese' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ko', label: 'Korean' },
  { value: 'fr', label: 'French' },
  { value: 'es', label: 'Spanish' },
]

function splitTags(value: string): string[] {
  return value.split(',').map((tag) => tag.trim()).filter(Boolean)
}

function defaultBack(word: string, reading: string): string {
  return [reading, word].filter(Boolean).join(' — ')
}

export function CardEditModal({ card, decks, initialDeckId, onCreate, onSave, onClose }: Props) {
  const isEditing = Boolean(card)
  const firstDeckId = decks[0]?.id ?? 1
  const [deckId, setDeckId] = useState(card?.deckId ?? initialDeckId ?? firstDeckId)
  const [template, setTemplate] = useState<CardTemplate>('Basic')
  const [front, setFront] = useState(card?.frontHtml ?? '')
  const [back, setBack] = useState(card?.backHtml ?? '')
  const [word, setWord] = useState(card?.word ?? '')
  const [reading, setReading] = useState(card?.reading ?? '')
  const [language, setLanguage] = useState<Language>(card?.language ?? 'en')
  const [tagInput, setTagInput] = useState(card?.tags.join(', ') ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const title = isEditing ? 'Edit Card' : 'New Card'
  const canSave = useMemo(() => front.trim().length > 0 && back.trim().length > 0, [front, back])

  function applyClozeHelper(): void {
    const target = word.trim()
    if (!target) return
    const cloze = `{{c1::${target}}}`
    setTemplate('Cloze')
    setFront((current) => {
      if (!current.trim()) return cloze
      if (current.includes(target)) return current.replace(target, cloze)
      return `${current.trim()} ${cloze}`
    })
    if (!back.trim()) setBack(defaultBack(target, reading.trim()))
  }

  async function handleSave(): Promise<void> {
    if (!canSave) {
      setError('Front and back are required')
      return
    }
    setSaving(true)
    setError(null)
    const tags = splitTags(tagInput)
    try {
      if (card) {
        await onSave(card.id, {
          deckId,
          frontHtml: front.trim(),
          backHtml: back.trim(),
          tags,
          word: word.trim() || undefined,
          reading: reading.trim() || undefined,
          language,
          sourceSentence: card.sourceSentence,
          sourceId: card.sourceId,
        })
      } else {
        await onCreate({
          deckId,
          template,
          frontHtml: front.trim(),
          backHtml: back.trim(),
          tags,
          word: word.trim() || undefined,
          reading: reading.trim() || undefined,
          language,
        })
      }
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60">
      <div className="bg-gray-900 border border-white/10 rounded-xl w-[680px] max-h-[86vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Deck</label>
              <select
                value={deckId}
                onChange={(e) => setDeckId(Number(e.target.value))}
                className="w-full bg-gray-800 border border-white/10 rounded-md px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
              >
                {decks.map((deck) => (
                  <option key={deck.id} value={deck.id}>{deck.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Template</label>
              <select
                value={template}
                onChange={(e) => setTemplate(e.target.value as CardTemplate)}
                className="w-full bg-gray-800 border border-white/10 rounded-md px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
              >
                <option value="Basic">Basic</option>
                <option value="Cloze">Cloze</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Language</label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value as Language)}
                className="w-full bg-gray-800 border border-white/10 rounded-md px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
              >
                {LANGUAGES.map((lang) => (
                  <option key={lang.value} value={lang.value}>{lang.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Word</label>
              <input
                value={word}
                onChange={(e) => setWord(e.target.value)}
                className="w-full bg-gray-800 border border-white/10 rounded-md px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
                placeholder="Target word"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Reading</label>
              <input
                value={reading}
                onChange={(e) => setReading(e.target.value)}
                className="w-full bg-gray-800 border border-white/10 rounded-md px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
                placeholder="Pronunciation"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-medium text-gray-400">Front</label>
              <button
                onClick={applyClozeHelper}
                disabled={!word.trim()}
                className="text-xs text-blue-400 hover:text-blue-300 disabled:text-gray-600 transition-colors"
              >
                Insert Cloze
              </button>
            </div>
            <textarea
              value={front}
              onChange={(e) => setFront(e.target.value)}
              rows={5}
              className="w-full bg-gray-800 border border-white/10 rounded-md px-3 py-2 text-sm text-gray-200 font-mono resize-none focus:outline-none focus:border-blue-500"
              placeholder={template === 'Cloze' ? '{{c1::word}} in context' : 'Front of card'}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Back</label>
            <textarea
              value={back}
              onChange={(e) => setBack(e.target.value)}
              rows={5}
              className="w-full bg-gray-800 border border-white/10 rounded-md px-3 py-2 text-sm text-gray-200 font-mono resize-none focus:outline-none focus:border-blue-500"
              placeholder="Back of card"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Tags</label>
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              className="w-full bg-gray-800 border border-white/10 rounded-md px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
              placeholder="english, verbs, source-name"
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
            disabled={saving || !canSave}
            className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-md transition-colors"
          >
            {saving ? 'Saving...' : isEditing ? 'Save' : 'Create Card'}
          </button>
        </div>
      </div>
    </div>
  )
}
