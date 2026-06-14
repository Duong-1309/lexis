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
  sourceSentence?: string
  sourceId?: number
  deckId?: number
}): DraftCard {
  const front = opts.reading ? `${opts.word}【${opts.reading}】` : opts.word

  let back = opts.definition
  if (opts.sourceSentence) {
    const highlighted = opts.sourceSentence.replace(
      opts.word,
      `<strong>${opts.word}</strong>`,
    )
    back = `${opts.definition}<br><br><em>${highlighted}</em>`
  }

  return {
    deckId: opts.deckId ?? DEFAULT_DECK_ID,
    frontHtml: front,
    backHtml: back,
    tags: [opts.language],
    template: 'Basic',
    word: opts.word,
    reading: opts.reading,
    language: opts.language,
    sourceSentence: opts.sourceSentence,
    sourceId: opts.sourceId,
  }
}
