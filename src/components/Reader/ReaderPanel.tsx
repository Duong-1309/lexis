import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Sentence, Language, EPUBChapter, Card } from '../../types'
import { isTypingTarget } from '../../hooks/useHotkeys'
import { SentenceRow } from './SentenceRow'

export interface MinedCardEntry { card: Card; deckName: string }

interface ReaderPanelProps {
  sentences: Sentence[]
  language: Language
  selectedSentence: Sentence | null
  selectedWord: string | null
  minedWords: Set<string>
  onSelectSentence: (sentence: Sentence) => void
  onWordClick: (word: string, dictionaryForm: string) => void
  isEpub?: boolean
  chapters?: EPUBChapter[]
  selectedChapterId?: string | null
  chapterHtml?: string | null
  chapterLoading?: boolean
  onSelectChapter?: (chapterId: string) => void
  onEpubWordSelect?: (word: string) => void
  allCardsMap?: Map<string, MinedCardEntry>
}

interface WordResult { word: string; start: number; end: number }

function extractWordAt(text: string, offset: number): WordResult | null {
  if (!text || offset > text.length) return null
  const safeOffset = Math.min(offset, text.length - 1)
  const ch = text[safeOffset]
  if (!ch || /\s/.test(ch)) return null

  // CJK unified ideographs, hiragana, katakana, hangul, fullwidth chars
  const isCJK = (c: string) => {
    const code = c.charCodeAt(0)
    return (code >= 0x3000 && code <= 0x9fff) || (code >= 0xac00 && code <= 0xd7af)
  }

  if (isCJK(ch)) {
    // Expand to adjacent CJK run; cap at 10 chars for practical lookup
    let s = safeOffset
    while (s > 0 && isCJK(text[s - 1])) s--
    let e = safeOffset + 1
    while (e < text.length && isCJK(text[e])) e++
    const word = text.slice(s, Math.min(e, s + 10))
    return { word, start: s, end: s + word.length }
  }

  // Latin / other: alphanumeric + apostrophe/hyphen run
  const isW = (c: string) => /[a-zA-Z0-9À-ɏ'-]/.test(c)
  let s = safeOffset
  while (s > 0 && isW(text[s - 1])) s--
  let e = safeOffset
  while (e < text.length && isW(text[e])) e++
  if (s === e) return null
  return { word: text.slice(s, e), start: s, end: e }
}

const CJK_RE = /[　-鿿가-힯]/

function wordPattern(words: Set<string>): RegExp {
  const sorted = [...words].sort((a, b) => b.length - a.length)
  const parts = sorted.map((w) => {
    const e = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // CJK words: no word boundaries needed; Latin words: require \b
    return CJK_RE.test(w) ? e : `\\b${e}\\b`
  })
  return new RegExp(`(${parts.join('|')})`, 'gi')
}

function injectMinedHighlights(html: string, words: Set<string>): string {
  if (words.size === 0) return html
  const container = document.createElement('div')
  container.innerHTML = html

  const pattern = wordPattern(words)

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  const textNodes: Text[] = []
  let n: Node | null
  while ((n = walker.nextNode())) textNodes.push(n as Text)

  for (const textNode of textNodes) {
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
  const due = new Date(card.dueDate)
  const nowMs = Date.now()
  const diffDays = Math.ceil((due.getTime() - nowMs) / 86400000)
  const dueLabel = diffDays <= 0 ? 'Due now' : diffDays === 1 ? 'Due tomorrow' : `Due in ${diffDays}d`

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

function EPUBReader({
  chapters,
  selectedChapterId,
  chapterHtml,
  chapterLoading,
  language,
  onSelectChapter,
  onEpubWordSelect,
  allCardsMap,
}: {
  chapters: EPUBChapter[]
  selectedChapterId: string | null
  chapterHtml: string | null
  chapterLoading: boolean
  language: Language
  onSelectChapter?: (id: string) => void
  onEpubWordSelect?: (word: string) => void
  allCardsMap?: Map<string, MinedCardEntry>
}) {
  const contentRef = useRef<HTMLDivElement>(null)
  const highlightSpanRef = useRef<HTMLSpanElement | null>(null)
  const [currentPage, setCurrentPage] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [tooltip, setTooltip] = useState<{ entry: MinedCardEntry; x: number; y: number } | null>(null)

  // Inject <span class="epub-mined-word"> around every word that's in a deck
  const processedHtml = useMemo(() => {
    if (!chapterHtml) return null
    if (!allCardsMap || allCardsMap.size === 0) {
      console.log('[Lexis] processedHtml: allCardsMap empty, skipping highlight injection')
      return chapterHtml
    }
    try {
      const words = new Set(allCardsMap.keys())
      console.log('[Lexis] processedHtml: injecting highlights for', words.size, 'words:', [...words])
      const result = injectMinedHighlights(chapterHtml, words)
      return result
    } catch (e) {
      console.error('[Lexis] injectMinedHighlights error:', e)
      return chapterHtml
    }
  }, [chapterHtml, allCardsMap])

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
    const t = setTimeout(() => {
      contentRef.current?.scrollTo({ top: 0 })
      calcPages()
    }, 80)
    return () => clearTimeout(t)
  }, [chapterHtml, calcPages, clearHighlight])

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
      if (existing.length >= 1 && existing.length < 60) {
        onEpubWordSelect?.(existing)
      }
      return
    }

    // Single click — find the text node at the cursor.
    // Primary: browser already placed the cursor on mousedown, use that.
    // Fallback: use geometric caretRangeFromPoint.
    let textNode: Text | null = null
    let offset = 0

    if (sel && sel.rangeCount > 0) {
      const r = sel.getRangeAt(0)
      if (r.startContainer.nodeType === Node.TEXT_NODE) {
        textNode = r.startContainer as Text
        offset = r.startOffset
      }
    }

    if (!textNode) {
      const r = document.caretRangeFromPoint?.(e.clientX, e.clientY)
      if (r && r.startContainer.nodeType === Node.TEXT_NODE) {
        textNode = r.startContainer as Text
        offset = r.startOffset
      }
    }

    if (!textNode) return

    const result = extractWordAt(textNode.textContent ?? '', offset)
    if (!result) return

    // Inject a <span> into the live DOM for persistent yellow highlight.
    // dangerouslySetInnerHTML only reconciles when chapterHtml changes, so
    // this span survives React re-renders triggered by the lookup state update.
    const wordRange = document.createRange()
    wordRange.setStart(textNode, result.start)
    wordRange.setEnd(textNode, result.end)
    const span = document.createElement('span')
    span.className = 'epub-word-highlight'
    try {
      wordRange.surroundContents(span)
      highlightSpanRef.current = span
    } catch {
      // range spans an element boundary (rare in prose) — skip highlight but still look up
    }

    onEpubWordSelect?.(result.word)
  }, [clearHighlight, onEpubWordSelect])

  const handleMouseOver = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest('.epub-mined-word') as HTMLElement | null
    if (target && allCardsMap) {
      const word = target.dataset.word ?? ''
      const entry = allCardsMap.get(word)
      if (entry) {
        const rect = target.getBoundingClientRect()
        setTooltip({ entry, x: rect.left + rect.width / 2, y: rect.top })
        return
      }
    }
    setTooltip(null)
  }, [allCardsMap])

  const hasContent = processedHtml != null && !chapterLoading

  return (
    <div className="flex h-full">
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
          onMouseLeave={() => setTooltip(null)}
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

      {tooltip && (
        <MinedTooltip entry={tooltip.entry} x={tooltip.x} y={tooltip.y} />
      )}
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
  isEpub = false,
  chapters = [],
  selectedChapterId = null,
  chapterHtml = null,
  chapterLoading = false,
  onSelectChapter,
  onEpubWordSelect,
  allCardsMap,
}: ReaderPanelProps) {
  const selectedRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [selectedSentence])

  const minedPattern = useMemo(() => {
    if (!allCardsMap || allCardsMap.size === 0) return null
    return wordPattern(new Set(allCardsMap.keys()))
  }, [allCardsMap])

  const [subtitleTooltip, setSubtitleTooltip] = useState<{ entry: MinedCardEntry; x: number; y: number } | null>(null)

  const handleSubtitleMouseOver = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest('.epub-mined-word') as HTMLElement | null
    if (target && allCardsMap) {
      const word = target.dataset.word ?? ''
      const entry = allCardsMap.get(word)
      if (entry) {
        const rect = target.getBoundingClientRect()
        setSubtitleTooltip({ entry, x: rect.left + rect.width / 2, y: rect.top })
        return
      }
    }
    setSubtitleTooltip(null)
  }, [allCardsMap])

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
        allCardsMap={allCardsMap}
      />
    )
  }

  if (sentences.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-3">
        <svg className="w-12 h-12 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <p className="text-sm">Import a subtitle file or EPUB to start reading</p>
      </div>
    )
  }

  return (
    <div
      className="flex flex-col gap-0.5 py-2 overflow-y-auto h-full"
      onMouseOver={handleSubtitleMouseOver}
      onMouseLeave={() => setSubtitleTooltip(null)}
    >
      {sentences.map((sentence) => {
        const isSelected = selectedSentence?.id === sentence.id
        return (
          <div key={sentence.id} ref={isSelected ? selectedRef : undefined}>
            <SentenceRow
              sentence={sentence}
              language={language}
              isSelected={isSelected}
              isMined={minedWords.has(sentence.content)}
              selectedWord={selectedWord}
              onClick={() => onSelectSentence(sentence)}
              onWordClick={onWordClick}
              allCardsMap={allCardsMap}
              minedPattern={minedPattern}
            />
          </div>
        )
      })}
      {subtitleTooltip && (
        <MinedTooltip entry={subtitleTooltip.entry} x={subtitleTooltip.x} y={subtitleTooltip.y} />
      )}
    </div>
  )
}
