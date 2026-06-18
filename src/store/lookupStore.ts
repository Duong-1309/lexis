import { create } from 'zustand'
import type { DictEntry, Token, Language } from '../types'

interface LookupState {
  word: string | null
  language: Language | null
  results: DictEntry[]
  tokens: Token[]
  nativeDefinition: string | null
  selectionOnly: boolean
  loading: boolean
  error: string | null

  lookup: (word: string, language: Language) => Promise<void>
  setSelection: (word: string, language: Language) => void
  tokenize: (text: string, language: Language) => Promise<Token[]>
  setNativeDefinition: (definition: string | null) => void
  clear: () => void
}

let lookupRequestSeq = 0

export const useLookupStore = create<LookupState>((set) => ({
  word: null,
  language: null,
  results: [],
  tokens: [],
  nativeDefinition: null,
  selectionOnly: false,
  loading: false,
  error: null,

  lookup: async (word, language) => {
    const requestId = ++lookupRequestSeq
    set({ loading: true, error: null, word, language, nativeDefinition: null, selectionOnly: false })
    const result = await window.lexis.dictionary.lookup(word, language)
    if (requestId !== lookupRequestSeq) return
    if (result.error) {
      set({ loading: false, error: result.error, results: [] })
    } else {
      set({ loading: false, results: result.data ?? [] })
    }
  },

  setSelection: (word, language) => {
    lookupRequestSeq += 1
    set({
      word,
      language,
      results: [],
      nativeDefinition: null,
      selectionOnly: true,
      loading: false,
      error: null,
    })
  },

  tokenize: async (text, language) => {
    const result = await window.lexis.dictionary.tokenize(text, language)
    const tokens = result.data ?? []
    set({ tokens })
    return tokens
  },

  setNativeDefinition: (definition) => set({ nativeDefinition: definition }),

  clear: () => {
    lookupRequestSeq += 1
    set({
      word: null,
      language: null,
      results: [],
      tokens: [],
      nativeDefinition: null,
      selectionOnly: false,
      loading: false,
      error: null,
    })
  },
}))
