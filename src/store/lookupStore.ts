import { create } from 'zustand'
import type { DictEntry, Token, Language } from '../types'

interface LookupState {
  word: string | null
  language: Language | null
  results: DictEntry[]
  tokens: Token[]
  loading: boolean
  error: string | null

  lookup: (word: string, language: Language) => Promise<void>
  tokenize: (text: string, language: Language) => Promise<Token[]>
  clear: () => void
}

export const useLookupStore = create<LookupState>((set) => ({
  word: null,
  language: null,
  results: [],
  tokens: [],
  loading: false,
  error: null,

  lookup: async (word, language) => {
    set({ loading: true, error: null, word, language })
    const result = await window.lexis.dictionary.lookup(word, language)
    if (result.error) {
      set({ loading: false, error: result.error, results: [] })
    } else {
      set({ loading: false, results: result.data ?? [] })
    }
  },

  tokenize: async (text, language) => {
    const result = await window.lexis.dictionary.tokenize(text, language)
    const tokens = result.data ?? []
    set({ tokens })
    return tokens
  },

  clear: () => set({ word: null, language: null, results: [], tokens: [], error: null }),
}))
