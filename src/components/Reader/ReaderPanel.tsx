import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Sentence, Language, EPUBChapter, Card, Pattern } from '../../types'
import { isTypingTarget } from '../../hooks/useHotkeys'
import { SentenceRow } from './SentenceRow'
import { formatDueDistance } from '../../utils/time'
import { debugLog } from '../../utils/debugLog'

export interface MinedCardEntry { card: Card; deckName: string }
export interface MinedPatternEntry { pattern: Pattern }

interface ReaderPanelProps {
  sentences: Sentence[]
  language: Language
  selectedSentence: Sentence | null
  selectedWord: string | null
  minedWords: Set<string>
  onSelectSentence: (sentence: Sentence) => void
  onWordClick: (word: string, dictionaryForm: string) => void
  onMinePattern?: (sentence: Sentence) => void
  onProgressChange?: (position: number, chapterId?: string) => void
  initialPosition?: number
  initialChapterId?: string
  isEpub?: boolean
  chapters?: EPUBChapter[]
  selectedChapterId?: string | null
  chapterHtml?: string | null
  chapterLoading?: boolean
  onSelectChapter?: (chapterId: string) => void
  onEpubWordSelect?: (word: string) => void
  allCardsMap?: Map<string, MinedCardEntry>
  minedPatterns?: Pattern[]
}

const CJK_RE = /[　-鿿가-힯]/
const MAX_SELECTION_LENGTH = 500

function normalizeHighlightText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildNormalizedIndex(value: string): { text: string; map: number[] } {
  const chars: string[] = []
  const map: number[] = []
  let pendingSpaceIndex: number | null = null

  const flushSpace = () => {
    if (pendingSpaceIndex === null) return
    if (chars.length > 0 && chars[chars.length - 1] !== ' ') {
      chars.push(' ')
      map.push(pendingSpaceIndex)
    }
    pendingSpaceIndex = null
  }

  for (let i = 0; i < value.length; i += 1) {
    const normalized = value[i].normalize('NFKC').toLocaleLowerCase()
    if (/[\p{P}\p{S}\s]/u.test(normalized)) {
      pendingSpaceIndex = pendingSpaceIndex ?? i
      continue
    }

    flushSpace()
    for (const ch of normalized) {
      chars.push(ch)
      map.push(i)
    }
  }

  let start = 0
  while (chars[start] === ' ') start += 1
  let end = chars.length
  while (end > start && chars[end - 1] === ' ') end -= 1

  return {
    text: chars.slice(start, end).join(''),
    map: map.slice(start, end),
  }
}

function findNormalizedMatch(text: string, target: string): { index: number; end: number } | null {
  const normalizedText = buildNormalizedIndex(text)
  const normalizedTarget = normalizeHighlightText(target)
  if (!normalizedTarget) return null

  const index = normalizedText.text.indexOf(normalizedTarget)
  if (index < 0) return null

  const start = normalizedText.map[index]
  const last = normalizedText.map[index + normalizedTarget.length - 1]
  if (start === undefined || last === undefined) return null
  return { index: start, end: last + 1 }
}

function patternHighlightText(pattern: Pattern): string | null {
  const example = pattern.exampleSentence?.trim()
  if (example) return example
  const text = pattern.patternText.trim()
  if (!text || text.includes('[') || text.includes(']')) return null
  return text
}

function wordPattern(words: Set<string>): RegExp {
  const sorted = [...words].sort((a, b) => b.length - a.length)
  const parts = sorted.map((w) => {
    const e = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // CJK words: no word boundaries needed; Latin words: require \b
    return CJK_RE.test(w) ? e : `\\b${e}\\b`
  })
  return new RegExp(`(${parts.join('|')})`, 'gi')
}

function injectMinedHighlights(html: string, words: Set<string>, patterns: Pattern[]): string {
  if (words.size === 0 && patterns.length === 0) return html
  const container = document.createElement('div')
  container.innerHTML = html

  const sentenceTexts = [...new Set(patterns.map(patternHighlightText).filter((s): s is string => Boolean(s)))]
    .sort((a, b) => b.length - a.length)

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  const textNodes: Text[] = []
  let n: Node | null
  while ((n = walker.nextNode())) textNodes.push(n as Text)

  if (sentenceTexts.length > 0) {
    for (const textNode of textNodes) {
      const text = textNode.textContent ?? ''
      const matches = sentenceTexts
        .map((sentence) => {
          const match = findNormalizedMatch(text, sentence)
          return match ? { sentence, index: match.index, end: match.end } : null
        })
        .filter((match): match is { sentence: string; index: number; end: number } => match !== null)
        .sort((a, b) => a.index - b.index || (b.end - b.index) - (a.end - a.index))
      if (matches.length === 0) continue

      const frag = document.createDocumentFragment()
      let cursor = 0
      for (const match of matches) {
        if (match.index < cursor) continue
        if (match.index > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, match.index)))
        const sentenceText = text.slice(match.index, match.end)
        const span = document.createElement('span')
        span.className = 'epub-mined-sentence'
        span.dataset.sentence = normalizeHighlightText(sentenceText)
        span.textContent = sentenceText
        frag.appendChild(span)
        cursor = match.end
      }
      if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)))
      textNode.parentNode?.replaceChild(frag, textNode)
    }
  }

  if (words.size === 0) return container.innerHTML
  const pattern = wordPattern(words)
  const wordWalker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  const wordTextNodes: Text[] = []
  while ((n = wordWalker.nextNode())) wordTextNodes.push(n as Text)

  for (const textNode of wordTextNodes) {
    if (textNode.parentElement?.closest('.epub-mined-sentence')) continue
    const text = textNode.textContent ?? ''
    pattern.lastIndex = 0
    if (!pattern.test(text)) continue
    pattern.lastIndex = 0

    const frag = document.createDocumentFragment()
    let last = 0
    let m: RegExpExecArray | null
    while ((m = pattern.exec(text)) !== null) {
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)))
      const span = document.createElement('span')
      span.className = 'epub-mined-word'
      span.dataset.word = m[0].toLowerCase()
      span.textContent = m[0]
      frag.appendChild(span)
      last = m.index + m[0].length
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)))
    textNode.parentNode?.replaceChild(frag, textNode)
  }

  const count = container.querySelectorAll('.epub-mined-word').length
  console.log('[Lexis] injectMinedHighlights: injected', count, 'highlights')
  return container.innerHTML
}

function MinedTooltip({ entry, x, y }: { entry: MinedCardEntry; x: number; y: number }) {
  const { card, deckName } = entry
  const dueLabel = formatDueDistance(card.dueDate)

  // Keep tooltip on screen horizontally
  const left = Math.max(8, Math.min(x - 128, window.innerWidth - 272))

  return (
    <div
      className="fixed z-50 w-64 bg-gray-800 border border-white/10 rounded-xl shadow-2xl p-3 pointer-events-none"
      style={{ left, top: y, transform: 'translateY(calc(-100% - 8px))' }}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-semibold text-green-400 uppercase tracking-wide">{deckName}</span>
        <span className="text-[11px] text-gray-500">{dueLabel}</span>
      </div>
      {card.word && <p className="text-sm font-semibold text-gray-100">{card.word}</p>}
      {card.reading && <p className="text-xs text-gray-400 mt-0.5">{card.reading}</p>}
      <div
        className="text-xs text-gray-300 mt-1.5 line-clamp-3 [&_b]:font-semibold [&_i]:italic"
        dangerouslySetInnerHTML={{ __html: card.backHtml }}
      />
      <div className="flex items-center gap-3 mt-2 pt-2 border-t border-white/5 text-[10px] text-gray-500">
        <span>{card.interval}d interval</span>
        <span>·</span>
        <span>{card.reps} review{card.reps !== 1 ? 's' : ''}</span>
        <span>·</span>
        <span className={card.cardState === 'new' ? 'text-blue-400' : card.cardState === 'learning' ? 'text-yellow-400' : 'text-green-400'}>
          {card.cardState}
        </span>
      </div>
    </div>
  )
}

function PatternTooltip({ entry, x, y }: { entry: MinedPatternEntry; x: number; y: number }) {
  const { pattern } = entry
  const left = Math.max(8, Math.min(x - 144, window.innerWidth - 304))

  return (
    <div
      className="fixed z-50 w-72 bg-gray-800 border border-white/10 rounded-xl shadow-2xl p-3 pointer-events-none"
      style={{ left, top: y, transform: 'translateY(calc(-100% - 8px))' }}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-semibold text-blue-300 uppercase tracking-wide">Pattern</span>
        <span className="text-[11px] text-gray-500">{pattern.language.toUpperCase()}</span>
      </div>
      <p className="text-sm font-semibold text-gray-100 line-clamp-2">{pattern.patternText}</p>
      {pattern.meaningNative && (
        <p className="text-xs text-blue-200 mt-1.5 line-clamp-2">{pattern.meaningNative}</p>
      )}
      {pattern.explanation && (
        <p className="text-xs text-gray-300 mt-1.5 line-clamp-3 whitespace-pre-line">{pattern.explanation}</p>
      )}
      {pattern.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2 pt-2 border-t border-white/5">
          {pattern.tags.slice(0, 4).map((tag) => (
            <span key={tag} className="text-[10px] bg-gray-700 text-gray-400 rounded px-1.5 py-0.5">
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function EPUBReader({
  chapters,
  selectedChapterId,
  chapterHtml,
  chapterLoading,
  language,
  onSelectChapter,
  onEpubWordSelect,
  onProgressChange,
  initialChapterId,
  initialPage,
  allCardsMap,
  minedPatterns,
  searchOpen,
  searchQuery,
  onSearchOpenChange,
  onSearchQueryChange,
}: {
  chapters: EPUBChapter[]
  selectedChapterId: string | null
  chapterHtml: string | null
  chapterLoading: boolean
  language: Language
  onSelectChapter?: (id: string) => void
  onEpubWordSelect?: (word: string) => void
  onProgressChange?: (position: number, chapterId: string) => void
  initialChapterId?: string
  initialPage?: number
  allCardsMap?: Map<string, MinedCardEntry>
  minedPatterns?: Pattern[]
  searchOpen?: boolean
  searchQuery?: string
  onSearchOpenChange?: (open: boolean) => void
  onSearchQueryChange?: (query: string) => void
}) {
  const [initialChapterLoaded, setInitialChapterLoaded] = useState(false)

  // Auto-load initial chapter
  useEffect(() => {
    if (initialChapterLoaded || chapters.length === 0) return
    if (initialChapterId && !selectedChapterId) {
      const chapterExists = chapters.some(ch => ch.id === initialChapterId)
      if (chapterExists) {
        onSelectChapter?.(initialChapterId)
      }
    }
    setInitialChapterLoaded(true)
  }, [chapters, initialChapterId, selectedChapterId, onSelectChapter, initialChapterLoaded])

  // Reset when chapters list changes (new book)
  useEffect(() => {
    setInitialChapterLoaded(false)
  }, [chapters])

  const contentRef = useRef<HTMLDivElement>(null)
  const highlightSpanRef = useRef<HTMLSpanElement | null>(null)
  const [currentPage, setCurrentPage] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [initialPageRestored, setInitialPageRestored] = useState(false)
  const [tooltip, setTooltip] = useState<{ entry: MinedCardEntry; x: number; y: number } | null>(null)
  const [patternTooltip, setPatternTooltip] = useState<{ entry: MinedPatternEntry; x: number; y: number } | null>(null)
  const [searchMatchIdx, setSearchMatchIdx] = useState(0)
  const [searchMatchCount, setSearchMatchCount] = useState(0)

  // Reset match index when query changes
  useEffect(() => {
    setSearchMatchIdx(0)
  }, [searchQuery])

  // Scroll to current match
  useEffect(() => {
    if (!searchQuery || searchMatchCount === 0 || !contentRef.current) return
    const marks = contentRef.current.querySelectorAll('.epub-search-match')
    marks.forEach((m, i) => {
      if (i === searchMatchIdx) {
        m.classList.add('epub-search-current')
        m.scrollIntoView({ behavior: 'smooth', block: 'center' })
      } else {
        m.classList.remove('epub-search-current')
      }
    })
  }, [searchMatchIdx, searchMatchCount, searchQuery])

  const goToNextMatch = () => {
    if (searchMatchCount === 0) return
    setSearchMatchIdx((prev) => (prev + 1) % searchMatchCount)
  }

  const goToPrevMatch = () => {
    if (searchMatchCount === 0) return
    setSearchMatchIdx((prev) => (prev - 1 + searchMatchCount) % searchMatchCount)
  }
  const minedPatternMap = useMemo(() => {
    const map = new Map<string, MinedPatternEntry>()
    for (const pattern of minedPatterns ?? []) {
      const text = patternHighlightText(pattern)
      if (text) map.set(normalizeHighlightText(text), { pattern })
    }
    return map
  }, [minedPatterns])

  // Inject <span class="epub-mined-word"> around every word that's in a deck
  const processedHtml = useMemo(() => {
    if (!chapterHtml) return null
    let html = chapterHtml

    // Inject mined highlights
    if ((allCardsMap && allCardsMap.size > 0) || (minedPatterns && minedPatterns.length > 0)) {
      try {
        const words = new Set(allCardsMap?.keys() ?? [])
        html = injectMinedHighlights(html, words, minedPatterns ?? [])
      } catch (e) {
        console.error('[Lexis] injectMinedHighlights error:', e)
      }
    }

    // Inject search highlights
    if (searchQuery && searchQuery.trim()) {
      try {
        const container = document.createElement('div')
        container.innerHTML = html
        const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
        const textNodes: Text[] = []
        let n: Node | null
        while ((n = walker.nextNode())) textNodes.push(n as Text)

        const q = searchQuery.toLowerCase()
        for (const textNode of textNodes) {
          const text = textNode.textContent ?? ''
          const lower = text.toLowerCase()
          const idx = lower.indexOf(q)
          if (idx === -1) continue

          const frag = document.createDocumentFragment()
          let cursor = 0
          let matchIdx = idx
          while (matchIdx !== -1) {
            if (matchIdx > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, matchIdx)))
            const mark = document.createElement('mark')
            mark.className = 'epub-search-match'
            mark.textContent = text.slice(matchIdx, matchIdx + searchQuery.length)
            frag.appendChild(mark)
            cursor = matchIdx + searchQuery.length
            matchIdx = lower.indexOf(q, cursor)
          }
          if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)))
          textNode.parentNode?.replaceChild(frag, textNode)
        }
        html = container.innerHTML
      } catch (e) {
        console.error('[Lexis] search highlight error:', e)
      }
    }

    return html
  }, [chapterHtml, allCardsMap, minedPatterns, searchQuery])

  // Count search matches after HTML is processed
  useEffect(() => {
    if (!processedHtml || !searchQuery) {
      setSearchMatchCount(0)
      return
    }
    const tempDiv = document.createElement('div')
    tempDiv.innerHTML = processedHtml
    const count = tempDiv.querySelectorAll('.epub-search-match').length
    setSearchMatchCount(count)
  }, [processedHtml, searchQuery])

  const calcPages = useCallback(() => {
    const el = contentRef.current
    if (!el || el.clientHeight === 0) return
    setTotalPages(Math.max(1, Math.ceil(el.scrollHeight / el.clientHeight)))
  }, [])

  const clearHighlight = useCallback(() => {
    const span = highlightSpanRef.current
    if (!span) return
    const parent = span.parentNode
    if (parent) {
      while (span.firstChild) parent.insertBefore(span.firstChild, span)
      parent.removeChild(span)
      parent.normalize()
    }
    highlightSpanRef.current = null
  }, [])

  // Reset + recalculate when chapter content changes
  useEffect(() => {
    if (!chapterHtml) return
    clearHighlight()
    setCurrentPage(0)
    setInitialPageRestored(false)
    const t = setTimeout(() => {
      calcPages()
    }, 80)
    return () => clearTimeout(t)
  }, [chapterHtml, calcPages, clearHighlight])

  // Restore initial page position after chapter loads
  useEffect(() => {
    if (!chapterHtml || initialPageRestored || totalPages <= 1) return
    // Only restore if this is the initial chapter being loaded
    if (initialPage !== undefined && initialPage > 0 && selectedChapterId === initialChapterId) {
      const t = setTimeout(() => {
        const el = contentRef.current
        if (el && initialPage < totalPages) {
          el.scrollTo({ top: initialPage * el.clientHeight, behavior: 'auto' })
          setCurrentPage(initialPage)
        }
        setInitialPageRestored(true)
      }, 100)
      return () => clearTimeout(t)
    } else {
      setInitialPageRestored(true)
    }
  }, [chapterHtml, totalPages, initialPage, initialChapterId, selectedChapterId, initialPageRestored])

  // Save progress when page changes (debounced)
  useEffect(() => {
    if (!selectedChapterId || !initialPageRestored) return
    const t = setTimeout(() => {
      onProgressChange?.(currentPage, selectedChapterId)
    }, 500)
    return () => clearTimeout(t)
  }, [currentPage, selectedChapterId, onProgressChange, initialPageRestored])

  // Recalculate on resize
  useEffect(() => {
    const observer = new ResizeObserver(calcPages)
    if (contentRef.current) observer.observe(contentRef.current)
    return () => observer.disconnect()
  }, [calcPages])

  // Sync page counter while scrolling
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const onScroll = () => {
      if (el.clientHeight === 0) return
      setCurrentPage(Math.round(el.scrollTop / el.clientHeight))
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  const goToPage = useCallback(
    (n: number) => {
      const el = contentRef.current
      if (!el) return
      const clamped = Math.max(0, Math.min(n, totalPages - 1))
      el.scrollTo({ top: clamped * el.clientHeight, behavior: 'smooth' })
      setCurrentPage(clamped)
    },
    [totalPages],
  )

  const currentChapterIdx = chapters.findIndex((ch) => ch.id === selectedChapterId)

  const handleNext = useCallback(() => {
    if (currentPage < totalPages - 1) {
      goToPage(currentPage + 1)
    } else if (currentChapterIdx >= 0 && currentChapterIdx < chapters.length - 1) {
      onSelectChapter?.(chapters[currentChapterIdx + 1].id)
    }
  }, [currentPage, totalPages, currentChapterIdx, chapters, goToPage, onSelectChapter])

  const handlePrev = useCallback(() => {
    if (currentPage > 0) {
      goToPage(currentPage - 1)
    } else if (currentChapterIdx > 0) {
      onSelectChapter?.(chapters[currentChapterIdx - 1].id)
    }
  }, [currentPage, currentChapterIdx, chapters, goToPage, onSelectChapter])

  // Arrow / Page keys navigate
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault()
        handleNext()
      }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault()
        handlePrev()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleNext, handlePrev])

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // Only handle left-button clicks, not text drag releases that scrolled
    if (e.button !== 0) return

    clearHighlight()

    const sel = window.getSelection()

    // Non-collapsed selection = user dragged to select a phrase
    if (sel && !sel.isCollapsed) {
      const existing = sel.toString().trim()
      if (existing.length >= 1 && existing.length < MAX_SELECTION_LENGTH) {
        onEpubWordSelect?.(existing)
      }
      return
    }

    // Click alone only places the caret/keeps reading. Lookup and mining are selection-based.
  }, [clearHighlight, onEpubWordSelect])

  const handleMouseOver = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const sentenceTarget = (e.target as HTMLElement).closest('.epub-mined-sentence') as HTMLElement | null
    if (sentenceTarget) {
      const key = sentenceTarget.dataset.sentence ?? ''
      const entry = minedPatternMap.get(key)
      if (entry) {
        const rect = sentenceTarget.getBoundingClientRect()
        setPatternTooltip({ entry, x: rect.left + rect.width / 2, y: rect.top })
        setTooltip(null)
        return
      }
    }

    const target = (e.target as HTMLElement).closest('.epub-mined-word') as HTMLElement | null
    if (target && allCardsMap) {
      const word = target.dataset.word ?? ''
      const entry = allCardsMap.get(word)
      if (entry) {
        const rect = target.getBoundingClientRect()
        setTooltip({ entry, x: rect.left + rect.width / 2, y: rect.top })
        setPatternTooltip(null)
        return
      }
    }
    setTooltip(null)
    setPatternTooltip(null)
  }, [allCardsMap, minedPatternMap])

  const hasContent = processedHtml != null && !chapterLoading

  const searchInputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="flex flex-col h-full">
      {/* Search bar */}
      {searchOpen && (
        <div className="shrink-0 flex items-center gap-2 px-3 py-2 bg-gray-900 border-b border-white/5">
          <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery ?? ''}
            onChange={(e) => onSearchQueryChange?.(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.shiftKey ? goToPrevMatch() : goToNextMatch()
              }
              if (e.key === 'Escape') {
                onSearchOpenChange?.(false)
                onSearchQueryChange?.('')
              }
            }}
            placeholder="Search in chapter..."
            autoFocus
            className="flex-1 bg-transparent text-sm text-gray-200 placeholder-gray-500 outline-none"
          />
          {searchQuery && (
            <span className="text-xs text-gray-500">
              {searchMatchCount > 0 ? `${searchMatchIdx + 1}/${searchMatchCount}` : 'No matches'}
            </span>
          )}
          <button onClick={goToPrevMatch} disabled={searchMatchCount === 0} className="p-1 hover:bg-white/10 rounded disabled:opacity-30" title="Previous (Shift+Enter)">
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
            </svg>
          </button>
          <button onClick={goToNextMatch} disabled={searchMatchCount === 0} className="p-1 hover:bg-white/10 rounded disabled:opacity-30" title="Next (Enter)">
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          <button
            onClick={() => { onSearchOpenChange?.(false); onSearchQueryChange?.('') }}
            className="p-1 hover:bg-white/10 rounded"
            title="Close (Escape)"
          >
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      <div className="flex flex-1 min-h-0">
      {/* Chapter sidebar */}
      <div className="w-44 shrink-0 border-r border-white/5 flex flex-col overflow-hidden">
        <div className="px-3 py-2 border-b border-white/5 flex items-center justify-between">
          <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
            Chapters
          </span>
          {allCardsMap && allCardsMap.size > 0 && (
            <span className="text-[10px] text-green-400 font-medium" title="Words in your decks">
              {allCardsMap.size}✓
            </span>
          )}
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {chapters.map((ch) => (
            <button
              key={ch.id}
              onClick={() => onSelectChapter?.(ch.id)}
              className={`w-full text-left px-3 py-2 text-xs transition-colors hover:bg-white/5 ${
                selectedChapterId === ch.id
                  ? 'text-blue-400 bg-blue-600/10'
                  : 'text-gray-400'
              }`}
            >
              <span className="line-clamp-2">{ch.title}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Content + nav */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* Scrollable content area */}
        <div
          ref={contentRef}
          onMouseUp={handleMouseUp}
          onMouseOver={handleMouseOver}
          onMouseLeave={() => { setTooltip(null); setPatternTooltip(null) }}
          lang={language}
          className="flex-1 overflow-y-scroll cursor-text"
          style={{ scrollbarWidth: 'none', userSelect: 'text' }}
        >
          {!selectedChapterId && (
            <div className="flex items-center justify-center h-full text-gray-500 text-sm">
              Select a chapter to start reading
            </div>
          )}

          {chapterLoading && (
            <div className="flex items-center justify-center h-full text-gray-500 text-sm">
              Loading chapter...
            </div>
          )}

          {hasContent && (
            <div
              className="epub-content px-10 py-8 max-w-2xl mx-auto text-gray-200 leading-relaxed
                [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:mb-4 [&_h1]:mt-6
                [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mb-3 [&_h2]:mt-5
                [&_h3]:text-base [&_h3]:font-medium [&_h3]:mb-2 [&_h3]:mt-4
                [&_p]:mb-4 [&_p]:text-gray-300
                [&_em]:italic [&_strong]:font-semibold [&_strong]:text-gray-100
                [&_img]:max-w-full [&_img]:rounded
                [&_a]:text-blue-400"
              style={{ fontSize: 16, lineHeight: 1.9, userSelect: 'text' }}
              dangerouslySetInnerHTML={{ __html: processedHtml! }}
            />
          )}
        </div>

        {/* Page navigation */}
        {hasContent && (
          <div className="flex items-center justify-between px-6 py-2.5 border-t border-white/5 bg-gray-950/80 shrink-0">
            <button
              onClick={handlePrev}
              disabled={currentPage === 0 && currentChapterIdx <= 0}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 disabled:opacity-30 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              {currentPage === 0 && currentChapterIdx > 0 ? 'Prev chap' : 'Prev'}
            </button>

            <span className="text-xs text-gray-500 select-none">
              {currentPage + 1} / {totalPages}
              <span className="ml-1.5 text-gray-600">· ← → keys</span>
            </span>

            <button
              onClick={handleNext}
              disabled={currentPage >= totalPages - 1 && currentChapterIdx >= chapters.length - 1}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 disabled:opacity-30 transition-colors"
            >
              {currentPage >= totalPages - 1 && currentChapterIdx < chapters.length - 1 ? 'Next chap' : 'Next'}
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        )}
      </div>
      </div>

      {tooltip && (
        <MinedTooltip entry={tooltip.entry} x={tooltip.x} y={tooltip.y} />
      )}
      {patternTooltip && (
        <PatternTooltip entry={patternTooltip.entry} x={patternTooltip.x} y={patternTooltip.y} />
      )}

      <style>{`
        .epub-search-match {
          background-color: rgb(250 204 21 / 0.3);
          color: rgb(254 249 195);
          border-radius: 2px;
          padding: 0 2px;
        }
        .epub-search-match.epub-search-current {
          background-color: rgb(250 204 21);
          color: rgb(23 23 23);
          font-weight: 500;
        }
      `}</style>
    </div>
  )
}

export function ReaderPanel({
  sentences,
  language,
  selectedSentence,
  selectedWord,
  minedWords,
  onSelectSentence,
  onWordClick,
  onProgressChange,
  initialPosition,
  initialChapterId,
  isEpub = false,
  chapters = [],
  selectedChapterId = null,
  chapterHtml = null,
  chapterLoading = false,
  onSelectChapter,
  onEpubWordSelect,
  allCardsMap,
  minedPatterns = [],
}: ReaderPanelProps) {
  const selectedRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [initialScrollDone, setInitialScrollDone] = useState(false)

  // Track scroll position for subtitle view
  useEffect(() => {
    if (isEpub || !containerRef.current || sentences.length === 0) return

    const container = containerRef.current
    let scrollTimeout: ReturnType<typeof setTimeout> | null = null

    const handleScroll = () => {
      if (scrollTimeout) clearTimeout(scrollTimeout)
      scrollTimeout = setTimeout(() => {
        // Calculate which sentence is at the center of the viewport
        const containerRect = container.getBoundingClientRect()
        const centerY = containerRect.top + containerRect.height / 2

        const sentenceEls = container.querySelectorAll('[data-sentence-id]')
        let closestIdx = 0
        let closestDistance = Infinity

        sentenceEls.forEach((el, idx) => {
          const rect = el.getBoundingClientRect()
          const distance = Math.abs(rect.top + rect.height / 2 - centerY)
          if (distance < closestDistance) {
            closestDistance = distance
            closestIdx = idx
          }
        })

        onProgressChange?.(closestIdx)
      }, 500) // Debounce 500ms
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      container.removeEventListener('scroll', handleScroll)
      if (scrollTimeout) clearTimeout(scrollTimeout)
    }
  }, [isEpub, sentences.length, onProgressChange])

  // Initial scroll to saved position for subtitle view
  useEffect(() => {
    if (isEpub || !containerRef.current || sentences.length === 0 || initialScrollDone) return
    if (initialPosition === undefined || initialPosition <= 0) {
      setInitialScrollDone(true)
      return
    }

    // Wait for content to render, then scroll to the position
    const timer = setTimeout(() => {
      const sentenceEls = containerRef.current?.querySelectorAll('[data-sentence-id]')
      if (!sentenceEls || initialPosition >= sentenceEls.length) {
        setInitialScrollDone(true)
        return
      }

      const targetEl = sentenceEls[initialPosition]
      targetEl?.scrollIntoView({ behavior: 'auto', block: 'center' })
      setInitialScrollDone(true)
    }, 100)

    return () => clearTimeout(timer)
  }, [isEpub, sentences.length, initialPosition, initialScrollDone])

  // Reset initial scroll done when source changes
  useEffect(() => {
    setInitialScrollDone(false)
  }, [sentences])

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [selectedSentence])

  const minedPattern = useMemo(() => {
    if (!allCardsMap || allCardsMap.size === 0) return null
    return wordPattern(new Set(allCardsMap.keys()))
  }, [allCardsMap])

  const minedSentenceSet = useMemo(
    () => new Set((minedPatterns ?? []).map(patternHighlightText).filter((s): s is string => Boolean(s)).map(normalizeHighlightText)),
    [minedPatterns],
  )
  const minedPatternMap = useMemo(() => {
    const map = new Map<string, MinedPatternEntry>()
    for (const pattern of minedPatterns ?? []) {
      const text = patternHighlightText(pattern)
      if (text) map.set(normalizeHighlightText(text), { pattern })
    }
    return map
  }, [minedPatterns])

  const [subtitleTooltip, setSubtitleTooltip] = useState<{ entry: MinedCardEntry; x: number; y: number } | null>(null)
  const [subtitlePatternTooltip, setSubtitlePatternTooltip] = useState<{ entry: MinedPatternEntry; x: number; y: number } | null>(null)

  // Search state
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  const searchMatches = useMemo(() => {
    if (!searchQuery.trim()) return []
    const q = searchQuery.toLowerCase()
    return sentences
      .map((s, idx) => ({ sentence: s, idx }))
      .filter(({ sentence }) => sentence.content.toLowerCase().includes(q))
  }, [sentences, searchQuery])

  const [currentMatchIdx, setCurrentMatchIdx] = useState(0)

  // Reset match index when search changes
  useEffect(() => {
    setCurrentMatchIdx(0)
  }, [searchQuery])

  // Scroll to current match
  useEffect(() => {
    if (searchMatches.length === 0 || !containerRef.current) return
    const match = searchMatches[currentMatchIdx]
    if (!match) return
    const el = containerRef.current.querySelector(`[data-sentence-idx="${match.idx}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [currentMatchIdx, searchMatches])

  // Ctrl+F to open search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault()
        setSearchOpen(true)
        setTimeout(() => searchInputRef.current?.focus(), 0)
      }
      if (e.key === 'Escape' && searchOpen) {
        setSearchOpen(false)
        setSearchQuery('')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [searchOpen])

  const goToNextMatch = () => {
    if (searchMatches.length === 0) return
    setCurrentMatchIdx((prev) => (prev + 1) % searchMatches.length)
  }

  const goToPrevMatch = () => {
    if (searchMatches.length === 0) return
    setCurrentMatchIdx((prev) => (prev - 1 + searchMatches.length) % searchMatches.length)
  }

  const handleSubtitleMouseOver = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const sentenceTarget = (e.target as HTMLElement).closest('.epub-mined-sentence') as HTMLElement | null
    if (sentenceTarget) {
      const rowEl = sentenceTarget.closest('[data-sentence-id]') as HTMLElement | null
      const sentenceId = rowEl?.dataset.sentenceId
      const sentence = sentences.find((item) => item.id === sentenceId)
      const key = sentenceTarget.getAttribute('data-sentence') ?? normalizeHighlightText(sentence?.content ?? sentenceTarget.textContent ?? '')
      const entry = minedPatternMap.get(key)
      if (entry) {
        const rect = sentenceTarget.getBoundingClientRect()
        setSubtitlePatternTooltip({ entry, x: rect.left + rect.width / 2, y: rect.top })
        setSubtitleTooltip(null)
        return
      }
    }

    const target = (e.target as HTMLElement).closest('.epub-mined-word') as HTMLElement | null
    if (target && allCardsMap) {
      const word = target.dataset.word ?? ''
      const entry = allCardsMap.get(word)
      if (entry) {
        const rect = target.getBoundingClientRect()
        setSubtitleTooltip({ entry, x: rect.left + rect.width / 2, y: rect.top })
        setSubtitlePatternTooltip(null)
        return
      }
    }
    setSubtitleTooltip(null)
    setSubtitlePatternTooltip(null)
  }, [allCardsMap, minedPatternMap, sentences])

  const handleSubtitleMouseUp = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return

    const selection = window.getSelection()
    const selectedText = selection?.toString().trim() ?? ''
    if (!selection || selection.isCollapsed || selectedText.length < 1 || selectedText.length >= MAX_SELECTION_LENGTH) return

    // Helper to find sentence element from a node (text node or element)
    const findSentenceEl = (node: Node | null): HTMLElement | null => {
      if (!node) return null
      // If text node, get parent element
      const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node as HTMLElement
      return el?.closest('[data-sentence-id]') as HTMLElement | null
    }

    // Try to find sentence from selection range (handles multi-line selection)
    let sentence: Sentence | undefined
    const range = selection.getRangeAt(0)

    // Try multiple sources: start of selection, end of selection, common ancestor, mouseup target
    const startEl = findSentenceEl(range.startContainer)
    const endEl = findSentenceEl(range.endContainer)
    const ancestorEl = findSentenceEl(range.commonAncestorContainer)
    const targetEl = (e.target as HTMLElement).closest('[data-sentence-id]') as HTMLElement | null

    const rowEl = startEl ?? endEl ?? ancestorEl ?? targetEl
    const sentenceId = rowEl?.dataset.sentenceId

    if (sentenceId) {
      sentence = sentences.find((item) => String(item.id) === sentenceId)
    }

    if (sentence) onSelectSentence(sentence)

    debugLog('reader', 'subtitle-selection', {
      selectedText,
      sentenceId,
      foundFrom: startEl ? 'start' : endEl ? 'end' : ancestorEl ? 'ancestor' : targetEl ? 'target' : 'none',
      sentence: sentence?.content,
      sourceId: sentence?.sourceId,
    })
    onWordClick(selectedText, selectedText)
  }, [onSelectSentence, onWordClick, sentences])

  if (isEpub) {
    return (
      <EPUBReader
        chapters={chapters}
        selectedChapterId={selectedChapterId}
        chapterHtml={chapterHtml}
        chapterLoading={chapterLoading}
        language={language}
        onSelectChapter={onSelectChapter}
        onEpubWordSelect={onEpubWordSelect}
        onProgressChange={(page, chapterId) => onProgressChange?.(page, chapterId)}
        initialChapterId={initialChapterId}
        initialPage={initialPosition}
        allCardsMap={allCardsMap}
        minedPatterns={minedPatterns}
        searchOpen={searchOpen}
        searchQuery={searchQuery}
        onSearchOpenChange={setSearchOpen}
        onSearchQueryChange={setSearchQuery}
      />
    )
  }

  if (sentences.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 min-h-0 text-gray-500 gap-3">
        <svg className="w-12 h-12 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <p className="text-sm">Import subtitles, EPUB, pasted text, or a web article to start reading</p>
      </div>
    )
  }

  const currentMatchSentenceId = searchMatches[currentMatchIdx]?.sentence.id

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Search bar */}
      {searchOpen && (
        <div className="shrink-0 flex items-center gap-2 px-3 py-2 bg-gray-900 border-b border-white/5">
          <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.shiftKey ? goToPrevMatch() : goToNextMatch()
              }
            }}
            placeholder="Search in content..."
            className="flex-1 bg-transparent text-sm text-gray-200 placeholder-gray-500 outline-none"
          />
          {searchQuery && (
            <span className="text-xs text-gray-500">
              {searchMatches.length > 0 ? `${currentMatchIdx + 1}/${searchMatches.length}` : 'No matches'}
            </span>
          )}
          <button onClick={goToPrevMatch} disabled={searchMatches.length === 0} className="p-1 hover:bg-white/10 rounded disabled:opacity-30" title="Previous (Shift+Enter)">
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
            </svg>
          </button>
          <button onClick={goToNextMatch} disabled={searchMatches.length === 0} className="p-1 hover:bg-white/10 rounded disabled:opacity-30" title="Next (Enter)">
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          <button onClick={() => { setSearchOpen(false); setSearchQuery('') }} className="p-1 hover:bg-white/10 rounded" title="Close (Escape)">
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Sentence list */}
      <div
        ref={containerRef}
        className="flex flex-col gap-0.5 py-2 overflow-y-auto flex-1 select-text"
        onMouseOver={handleSubtitleMouseOver}
        onMouseUp={handleSubtitleMouseUp}
        onMouseLeave={() => { setSubtitleTooltip(null); setSubtitlePatternTooltip(null) }}
        style={{ userSelect: 'text' }}
      >
        {sentences.map((sentence, idx) => {
          const isSelected = selectedSentence?.id === sentence.id
          const isMinedSentence = minedSentenceSet.has(normalizeHighlightText(sentence.content))
          const isSearchMatch = currentMatchSentenceId === sentence.id
          return (
            <div
              key={sentence.id}
              ref={isSelected ? selectedRef : undefined}
              data-sentence-id={sentence.id}
              data-sentence-idx={idx}
            >
              <SentenceRow
                sentence={sentence}
                language={language}
                isSelected={isSelected}
                isMined={minedWords.has(sentence.content) && !isMinedSentence}
                selectedWord={selectedWord}
                onClick={() => onSelectSentence(sentence)}
                allCardsMap={allCardsMap}
                minedPattern={minedPattern}
                isMinedSentence={isMinedSentence}
                searchQuery={searchQuery}
                isCurrentMatch={isSearchMatch}
              />
            </div>
          )
        })}
        {subtitleTooltip && (
          <MinedTooltip entry={subtitleTooltip.entry} x={subtitleTooltip.x} y={subtitleTooltip.y} />
        )}
        {subtitlePatternTooltip && (
          <PatternTooltip entry={subtitlePatternTooltip.entry} x={subtitlePatternTooltip.x} y={subtitlePatternTooltip.y} />
        )}
      </div>
    </div>
  )
}
