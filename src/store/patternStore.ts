import { create } from 'zustand'
import type { PatternDraft } from '../types'

interface PatternBuilderState {
  open: boolean
  draft: PatternDraft | null

  openBuilder: (draft: PatternDraft) => void
  closeBuilder: () => void
  updateDraft: (updates: Partial<PatternDraft>) => void
}

export const usePatternStore = create<PatternBuilderState>((set) => ({
  open: false,
  draft: null,

  openBuilder: (draft) => set({ open: true, draft }),
  closeBuilder: () => set({ open: false, draft: null }),
  updateDraft: (updates) =>
    set((state) => ({
      draft: state.draft ? { ...state.draft, ...updates } : null,
    })),
}))
