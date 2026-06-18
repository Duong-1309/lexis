import { create } from 'zustand'
import type { DraftCard, Deck, Language } from '../types'

interface CardBuilderState {
  open: boolean
  draft: DraftCard | null
  decks: Deck[]
  isDuplicate: boolean

  openBuilder: (draft: DraftCard) => void
  closeBuilder: () => void
  updateDraft: (updates: Partial<DraftCard>) => void
  setDecks: (decks: Deck[]) => void
  setIsDuplicate: (value: boolean) => void
}

const DEFAULT_DECK_ID = 1

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()
}

function highlightInSentence(sentence: string, word: string): string {
  const index = sentence.toLocaleLowerCase().indexOf(word.toLocaleLowerCase())
  if (index === -1) return escapeHtml(sentence)

  const before = sentence.slice(0, index)
  const match = sentence.slice(index, index + word.length)
  const after = sentence.slice(index + word.length)

  return `${escapeHtml(before)}<strong>${escapeHtml(match)}</strong>${escapeHtml(after)}`
}

export const useCardStore = create<CardBuilderState>((set) => ({
  open: false,
  draft: null,
  decks: [],
  isDuplicate: false,

  openBuilder: (draft) => set({ open: true, draft, isDuplicate: false }),
  closeBuilder: () => set({ open: false, draft: null, isDuplicate: false }),

  updateDraft: (updates) =>
    set((state) => ({
      draft: state.draft ? { ...state.draft, ...updates } : null,
    })),

  setDecks: (decks) => set({ decks }),
  setIsDuplicate: (value) => set({ isDuplicate: value }),
}))

export function buildDraft(opts: {
  word: string
  reading?: string
  definition: string
  language: Language
  nativeDefinition?: string
  partOfSpeech?: string
  levelInfo?: { jlpt?: number; hsk?: number }
  audioWord?: string
  sourceSentence?: string
  sourceHighlight?: string
  sourceId?: number
  deckId?: number
}): DraftCard {
  // Front: word【reading】 [N3] [n]
  let front = opts.reading
    ? `${escapeHtml(opts.word)}【${escapeHtml(opts.reading)}】`
    : escapeHtml(opts.word)
  if (opts.levelInfo?.jlpt) {
    front += ` <span style="font-size:0.7em;background:#1d4ed8;color:#fff;padding:1px 5px;border-radius:3px">N${opts.levelInfo.jlpt}</span>`
  }
  if (opts.levelInfo?.hsk) {
    front += ` <span style="font-size:0.7em;background:#15803d;color:#fff;padding:1px 5px;border-radius:3px">HSK${opts.levelInfo.hsk}</span>`
  }
  if (opts.partOfSpeech) {
    front += ` <span style="font-size:0.7em;color:#9ca3af">[${escapeHtml(opts.partOfSpeech)}]</span>`
  }

  // Back: VI def (primary) + EN def (secondary) + source sentence
  const parts: string[] = []
  if (opts.nativeDefinition) {
    parts.push(`<strong style="color:#93c5fd">${escapeHtml(opts.nativeDefinition)}</strong>`)
  }
  const cleanDef = stripHtml(opts.definition)
  if (cleanDef) {
    const style = opts.nativeDefinition ? ' style="color:#9ca3af;font-size:0.875em"' : ''
    parts.push(`<span${style}>${escapeHtml(cleanDef)}</span>`)
  }
  if (opts.sourceSentence) {
    const highlighted = highlightInSentence(opts.sourceSentence, opts.sourceHighlight ?? opts.word)
    parts.push(`<em style="color:#6b7280">${highlighted}</em>`)
  }
  const back = parts.join('<br><br>')

  return {
    deckId: opts.deckId ?? DEFAULT_DECK_ID,
    frontHtml: front,
    backHtml: back,
    tags: [opts.language],
    template: 'Basic',
    word: opts.word,
    reading: opts.reading,
    language: opts.language,
    nativeDefinition: opts.nativeDefinition,
    partOfSpeech: opts.partOfSpeech,
    levelInfo: opts.levelInfo,
    audioWord: opts.audioWord,
    sourceSentence: opts.sourceSentence,
    sourceId: opts.sourceId,
  }
}
