import { useEffect, useMemo, useState } from 'react'
import { usePatternStore } from '../../store/patternStore'
import type { Deck } from '../../types'
import { buildPatternText } from '../../utils/patternMining'
import { debugLog } from '../../utils/debugLog'

interface PatternBuilderProps {
  decks: Deck[]
  onSaved?: () => void
}

function splitTags(value: string): string[] {
  return value.split(',').map((tag) => tag.trim()).filter(Boolean)
}

function exampleSeeds(patternText: string, exampleSentence?: string): string[] {
  const seeds = new Set<string>()
  const cleanExample = exampleSentence?.trim()
  const cleanPattern = patternText.trim()
  if (cleanExample) seeds.add(cleanExample)
  if (cleanPattern && !cleanPattern.includes('[')) seeds.add(cleanPattern)

  const slotMatch = cleanPattern.match(/\[([^\]]+)\]/)
  if (slotMatch) {
    const slot = slotMatch[1]
    seeds.add(cleanPattern.replace(slotMatch[0], slot))
    seeds.add(cleanPattern.replace(slotMatch[0], '...'))
  }

  return [...seeds].slice(0, 4)
}

export function PatternBuilder({ decks, onSaved }: PatternBuilderProps) {
  const { open, draft, closeBuilder, updateDraft } = usePatternStore()
  const [tagInput, setTagInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [focusPhrase, setFocusPhrase] = useState('')
  const [duplicateChecking, setDuplicateChecking] = useState(false)
  const [duplicatePattern, setDuplicatePattern] = useState(false)

  useEffect(() => {
    if (!open || !draft) return
    setTagInput(draft.tags.join(', '))
    const bracketMatch = draft.patternText.match(/\[([^\]]+)\]/)
    setFocusPhrase(draft.slotPhrase ?? bracketMatch?.[1] ?? '')
    setError(null)
    setSaved(false)
    setDuplicatePattern(false)
  }, [draft, open])

  useEffect(() => {
    if (!open || !draft) return
    const patternText = draft.patternText.trim()
    if (!patternText) {
      setDuplicatePattern(false)
      return
    }

    let cancelled = false
    setDuplicateChecking(true)
    const timer = window.setTimeout(() => {
      window.lexis.patterns.isDuplicate(patternText, draft.language).then((result) => {
        if (cancelled) return
        setDuplicatePattern(Boolean(result.data))
        setDuplicateChecking(false)
      }).catch(() => {
        if (!cancelled) setDuplicateChecking(false)
      })
    }, 180)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [draft?.patternText, draft?.language, open])

  const selectedDeckExists = useMemo(
    () => draft?.deckId == null || decks.some((deck) => deck.id === draft.deckId),
    [decks, draft?.deckId],
  )

  useEffect(() => {
    if (!open || !draft) return
    const fallbackDeck = decks[0]
    if (fallbackDeck && (draft.deckId == null || !selectedDeckExists)) {
      updateDraft({ deckId: fallbackDeck.id })
    }
  }, [decks, draft, open, selectedDeckExists, updateDraft])

  async function handleSave(): Promise<void> {
    if (!draft || saving) return
    if (!draft.patternText.trim()) {
      setError('Pattern is required')
      return
    }
    if (duplicatePattern) {
      setError('This pattern already exists')
      return
    }

    setSaving(true)
    setError(null)
    const duplicateResult = await window.lexis.patterns.isDuplicate(draft.patternText.trim(), draft.language)
    if (duplicateResult.error) {
      setSaving(false)
      setError(duplicateResult.error)
      return
    }
    if (duplicateResult.data) {
      setSaving(false)
      setDuplicatePattern(true)
      setError('This pattern already exists')
      return
    }
    const { slotPhrase: _slotPhrase, ...persistedDraft } = draft
    debugLog('pattern-builder', 'save-pattern', {
      patternText: draft.patternText,
      meaningNative: draft.meaningNative,
      explanation: draft.explanation,
      exampleSentence: draft.exampleSentence,
      slotPhrase: draft.slotPhrase,
      sourceSentenceId: draft.sourceSentenceId,
      sourceId: draft.sourceId,
      tags: splitTags(tagInput),
    })
    const result = await window.lexis.patterns.create({
      ...persistedDraft,
      patternText: draft.patternText.trim(),
      meaningNative: draft.meaningNative?.trim() || undefined,
      explanation: draft.explanation?.trim() || undefined,
      exampleSentence: draft.exampleSentence?.trim() || undefined,
      tags: splitTags(tagInput),
    })
    setSaving(false)

    if (result.error) {
      setError(result.error)
      return
    }

    if (result.data) {
      await window.lexis.drills.createPrompt({
        patternId: result.data.id,
        type: 'free_production',
        promptNative: result.data.meaningNative
          ? `Create a new sentence using this pattern: ${result.data.meaningNative}`
          : 'Create a new sentence using this pattern.',
        promptTarget: result.data.patternText,
        expectedAnswer: result.data.exampleSentence,
        variables: {},
      })
    }

    setSaved(true)
    onSaved?.()
    setTimeout(() => closeBuilder(), 700)
  }

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        void handleSave()
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        closeBuilder()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closeBuilder, draft, open, saving, tagInput])

  if (!open || !draft) return null
  const seeds = exampleSeeds(draft.patternText, draft.exampleSentence)
  const slotPreview = draft.exampleSentence && focusPhrase.trim()
    ? buildPatternText(draft.exampleSentence, focusPhrase)
    : ''

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => e.target === e.currentTarget && closeBuilder()}
    >
      <div className="w-[680px] max-h-[86vh] bg-gray-900 border border-white/10 rounded-xl shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/5">
          <h2 className="text-sm font-semibold text-gray-200">Mine Pattern</h2>
          <button onClick={closeBuilder} className="text-gray-500 hover:text-gray-300 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Deck</label>
              <select
                className="w-full px-3 py-2 bg-gray-800 border border-white/10 rounded-lg text-sm text-gray-100 focus:outline-none focus:border-blue-500/50"
                value={draft.deckId ?? decks[0]?.id ?? ''}
                onChange={(e) => updateDraft({ deckId: Number(e.target.value) })}
              >
                {decks.map((deck) => (
                  <option key={deck.id} value={deck.id}>
                    {deck.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Language</label>
              <div className="px-3 py-2 bg-gray-800 border border-white/10 rounded-lg text-sm text-gray-400">
                {draft.language.toUpperCase()}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Pattern</label>
            <input
              className="w-full px-3 py-2 bg-gray-800 border border-white/10 rounded-lg text-sm text-gray-100 focus:outline-none focus:border-blue-500/50"
              value={draft.patternText}
              onChange={(e) => updateDraft({ patternText: e.target.value })}
              placeholder="end up + V-ing"
              autoFocus
            />
            {(duplicateChecking || duplicatePattern) && (
              <p className={`mt-1 text-xs ${duplicatePattern ? 'text-yellow-300' : 'text-gray-500'}`}>
                {duplicatePattern ? 'This pattern already exists.' : 'Checking duplicate...'}
              </p>
            )}
          </div>

          {draft.exampleSentence && (
            <div className="rounded-lg border border-white/10 bg-gray-950/60 p-3">
              <div className="flex items-center justify-between gap-3 mb-2">
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Source Sentence</span>
                <button
                  onClick={() => updateDraft({ patternText: draft.exampleSentence ?? '' })}
                  className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                >
                  Use full sentence
                </button>
              </div>
              <p className="text-sm text-gray-300 leading-relaxed">{draft.exampleSentence}</p>
            </div>
          )}

          {draft.exampleSentence && (
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Slot Phrase</label>
              <div className="flex gap-2">
                <input
                  className="flex-1 px-3 py-2 bg-gray-800 border border-white/10 rounded-lg text-sm text-gray-100 focus:outline-none focus:border-blue-500/50"
                  value={focusPhrase}
                  onChange={(e) => setFocusPhrase(e.target.value)}
                  placeholder="phrase that can be replaced in drills"
                />
                <button
                  onClick={() => updateDraft({
                    patternText: buildPatternText(draft.exampleSentence ?? '', focusPhrase),
                    slotPhrase: focusPhrase.trim() || undefined,
                  })}
                  disabled={!focusPhrase.trim()}
                  className="px-3 py-2 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors disabled:opacity-40"
                >
                  Turn Into Slot
                </button>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Select the replaceable part of the sentence. It becomes <span className="text-gray-300">[slot]</span> in the pattern.
              </p>
              {slotPreview && slotPreview !== draft.patternText && (
                <button
                  onClick={() => updateDraft({
                    patternText: slotPreview,
                    slotPhrase: focusPhrase.trim() || undefined,
                  })}
                  className="mt-2 block w-full text-left px-3 py-2 rounded-lg border border-blue-500/20 bg-blue-500/5 text-sm text-blue-200 hover:bg-blue-500/10 transition-colors"
                >
                  Preview: {slotPreview}
                </button>
              )}
            </div>
          )}

          {seeds.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Example Seeds</label>
              <div className="space-y-1.5">
                {seeds.map((seed) => (
                  <button
                    key={seed}
                    onClick={() => updateDraft({ exampleSentence: seed })}
                    className="block w-full text-left px-3 py-2 rounded-lg bg-gray-950/60 hover:bg-gray-800 text-sm text-gray-300 transition-colors"
                  >
                    {seed}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Native Meaning</label>
            <input
              className="w-full px-3 py-2 bg-gray-800 border border-white/10 rounded-lg text-sm text-gray-100 focus:outline-none focus:border-blue-500/50"
              value={draft.meaningNative ?? ''}
              onChange={(e) => updateDraft({ meaningNative: e.target.value })}
              placeholder="rốt cuộc/cuối cùng lại làm gì"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Explanation</label>
            <textarea
              className="w-full h-24 px-3 py-2 bg-gray-800 border border-white/10 rounded-lg text-sm text-gray-100 resize-none focus:outline-none focus:border-blue-500/50"
              value={draft.explanation ?? ''}
              onChange={(e) => updateDraft({ explanation: e.target.value })}
              placeholder="Short note about when/how to use this pattern"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Example Sentence</label>
            <textarea
              className="w-full h-20 px-3 py-2 bg-gray-800 border border-white/10 rounded-lg text-sm text-gray-100 resize-none focus:outline-none focus:border-blue-500/50"
              value={draft.exampleSentence ?? ''}
              onChange={(e) => updateDraft({ exampleSentence: e.target.value })}
              placeholder="Source sentence"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Tags</label>
            <input
              className="w-full px-3 py-2 bg-gray-800 border border-white/10 rounded-lg text-sm text-gray-100 focus:outline-none focus:border-blue-500/50"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              placeholder="pattern, grammar, source-name"
            />
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-white/5">
          <button
            onClick={closeBuilder}
            className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={saving || saved || duplicatePattern}
            className={`px-5 py-2 text-sm font-medium rounded-lg transition-colors ${
              saved
                ? 'bg-green-600/80 text-white'
                : 'bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50'
            }`}
          >
            {saved ? 'Saved!' : saving ? 'Saving...' : 'Save Pattern'}
            {!saving && !saved && <span className="ml-2 text-xs opacity-60">Ctrl/⌘ Enter</span>}
          </button>
        </div>
      </div>
    </div>
  )
}
