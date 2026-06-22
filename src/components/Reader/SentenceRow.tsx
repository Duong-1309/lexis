import { Fragment, useEffect, useState } from 'react'
import type { Sentence, Token, Language } from '../../types'
import type { MinedCardEntry } from './ReaderPanel'

interface SentenceRowProps {
  sentence: Sentence
  language: Language
  isSelected: boolean
  isMined: boolean
  selectedWord: string | null
  onClick: () => void
  allCardsMap?: Map<string, MinedCardEntry>
  minedPattern?: RegExp | null
  isMinedSentence?: boolean
  searchQuery?: string
  isCurrentMatch?: boolean
}

function formatTime(ms?: number): string {
  if (ms === undefined) return ''
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function splitWithMined(
  text: string,
  pattern: RegExp,
): Array<{ text: string; isMined: boolean }> {
  const parts: Array<{ text: string; isMined: boolean }> = []
  pattern.lastIndex = 0
  let last = 0
  let m: RegExpExecArray | null
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index), isMined: false })
    parts.push({ text: m[0], isMined: true })
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last), isMined: false })
  return parts
}

function highlightSearch(text: string, query: string, isCurrent: boolean): React.ReactNode {
  if (!query) return text
  const lower = text.toLowerCase()
  const q = query.toLowerCase()
  const idx = lower.indexOf(q)
  if (idx === -1) return text
  const markClass = isCurrent
    ? 'bg-yellow-400 text-gray-900 font-medium rounded-sm px-0.5'
    : 'bg-yellow-400/30 text-yellow-100 rounded-sm px-0.5'
  return (
    <>
      {text.slice(0, idx)}
      <mark className={markClass}>{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  )
}

export function SentenceRow({
  sentence,
  language,
  isSelected,
  isMined,
  selectedWord,
  onClick,
  allCardsMap,
  minedPattern,
  isMinedSentence = false,
  searchQuery = '',
  isCurrentMatch = false,
}: SentenceRowProps) {
  const [tokens, setTokens] = useState<Token[]>([])
  const timestamp = formatTime(sentence.startTimeMs)

  useEffect(() => {
    if (!isSelected) { setTokens([]); return }
    window.lexis.dictionary.tokenize(sentence.content, language).then((res) => {
      setTokens(res.data ?? [])
    })
  }, [isSelected, sentence.content, language])

  const handleRowClick = () => {
    const selection = window.getSelection()
    if (selection && !selection.isCollapsed && selection.toString().trim()) return
    onClick()
  }

  const renderTokenizedContent = () => {
    const nodes: React.ReactNode[] = []
    let cursor = 0

    tokens.forEach((token, i) => {
      if (token.offset > cursor) {
        nodes.push(
          <Fragment key={`gap-${i}`}>
            {sentence.content.slice(cursor, token.offset)}
          </Fragment>,
        )
      }

      const surfaceKey = token.surface.toLowerCase()
      const dictKey = (token.dictionaryForm ?? '').toLowerCase()
      const minedKey = allCardsMap?.has(surfaceKey)
        ? surfaceKey
        : allCardsMap?.has(dictKey)
          ? dictKey
          : null

      nodes.push(
        <span
          key={`token-${i}`}
          data-word={minedKey ?? undefined}
          className={`transition-colors ${
            token.surface === selectedWord
              ? 'bg-yellow-400/30 text-yellow-200 rounded-sm'
              : ''
          } ${minedKey ? 'epub-mined-word' : ''}`}
          style={{
            boxDecorationBreak: 'clone',
            WebkitBoxDecorationBreak: 'clone',
          }}
        >
          {token.surface}
        </span>,
      )
      cursor = token.offset + token.surface.length
    })

    if (cursor < sentence.content.length) {
      nodes.push(
        <Fragment key="tail">
          {sentence.content.slice(cursor)}
        </Fragment>,
      )
    }

    return nodes
  }

  return (
    <div
      data-sentence-id={sentence.id}
      onClick={handleRowClick}
      className={`flex gap-3 px-4 py-2 cursor-pointer rounded-md transition-colors ${
        isSelected
          ? 'bg-blue-600/30 border-l-2 border-blue-400'
          : 'hover:bg-white/5 border-l-2 border-transparent'
      } ${isMined ? 'opacity-60' : ''}`}
    >
      {timestamp && (
        <span className="text-xs text-gray-500 font-mono mt-0.5 min-w-[48px] shrink-0">
          {timestamp}
        </span>
      )}

      <p className="text-sm leading-relaxed text-gray-200 select-text">
        {isMinedSentence ? (
          <span className="epub-mined-sentence" data-sentence={sentence.content.toLowerCase().replace(/[\p{P}\p{S}]+/gu, ' ').replace(/\s+/g, ' ').trim()}>
            {sentence.content}
          </span>
        ) : isSelected && tokens.length > 0 ? (
          renderTokenizedContent()
        ) : minedPattern ? (
          splitWithMined(sentence.content, minedPattern).map((part, i) =>
            part.isMined ? (
              <span key={i} className="epub-mined-word" data-word={part.text.toLowerCase()}>
                {searchQuery ? highlightSearch(part.text, searchQuery, isCurrentMatch) : part.text}
              </span>
            ) : (
              <span key={i}>{searchQuery ? highlightSearch(part.text, searchQuery, isCurrentMatch) : part.text}</span>
            ),
          )
        ) : (
          highlightSearch(sentence.content, searchQuery, isCurrentMatch)
        )}
      </p>
    </div>
  )
}
