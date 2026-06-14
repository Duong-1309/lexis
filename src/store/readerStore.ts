import { create } from 'zustand'
import type { MediaSource, Sentence, EPUBChapter } from '../types'

interface ReaderStore {
  currentSource: MediaSource | null
  sentences: Sentence[]
  selectedSentence: Sentence | null
  selectedWord: string | null
  minedWords: Set<string>

  // EPUB chapter state
  chapters: EPUBChapter[]
  selectedChapterId: string | null
  chapterHtml: string | null
  chapterLoading: boolean

  setSource: (source: MediaSource) => void
  setSentences: (sentences: Sentence[]) => void
  setMinedWords: (words: string[]) => void
  selectSentence: (sentence: Sentence) => void
  selectWord: (word: string) => void
  clearSelection: () => void

  setChapters: (chapters: EPUBChapter[]) => void
  selectChapter: (chapterId: string) => void
  setChapterHtml: (html: string) => void
  setChapterLoading: (loading: boolean) => void
  clearEPUB: () => void
}

export const useReaderStore = create<ReaderStore>((set) => ({
  currentSource: null,
  sentences: [],
  selectedSentence: null,
  selectedWord: null,
  minedWords: new Set(),
  chapters: [],
  selectedChapterId: null,
  chapterHtml: null,
  chapterLoading: false,

  setSource: (source) => set({ currentSource: source }),
  setSentences: (sentences) => set({ sentences }),
  setMinedWords: (words) => set({ minedWords: new Set(words) }),
  selectSentence: (sentence) => set({ selectedSentence: sentence, selectedWord: null }),
  selectWord: (word) => set({ selectedWord: word }),
  clearSelection: () => set({ selectedSentence: null, selectedWord: null }),

  setChapters: (chapters) => set({ chapters }),
  selectChapter: (chapterId) => set({ selectedChapterId: chapterId, chapterHtml: null }),
  setChapterHtml: (html) => set({ chapterHtml: html }),
  setChapterLoading: (loading) => set({ chapterLoading: loading }),
  clearEPUB: () => set({ chapters: [], selectedChapterId: null, chapterHtml: null, chapterLoading: false }),
}))
