import { useEffect, useState } from 'react'
import type { Sentence, Token, Language } from '../../types'
import type { MinedCardEntry } from './ReaderPanel'

interface SentenceRowProps {
  sentence: Sentence
  language: Language
  isSelected: boolean
  isMined: boolean
  selectedWord: string | null
  onClick: () => void
  onWordClick: (word: string, dictionaryForm: string) => void
  allCardsMap?: Map<string, MinedCardEntry>
  minedPattern?: RegExp | null
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

export function SentenceRow({
  sentence,
  language,
  isSelected,
  isMined,
  selectedWord,
  onClick,
  onWordClick,
  allCardsMap,
  minedPattern,
}: SentenceRowProps) {
  const [tokens, setTokens] = useState<Token[]>([])
  const timestamp = formatTime(sentence.startTimeMs)

  useEffect(() => {
    if (!isSelected) { setTokens([]); return }
    window.lexis.dictionary.tokenize(sentence.content, language).then((res) => {
      setTokens(res.data ?? [])
    })
  }, [isSelected, sentence.content, language])

  const handleWordClick = (e: React.MouseEvent, token: Token) => {
    e.stopPropagation()
    if (isSelected) onWordClick(token.surface, token.dictionaryForm)
  }

  return (
    <div
      onClick={onClick}
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

      <p className={`text-sm leading-relaxed text-gray-200 ${isSelected && tokens.length > 0 ? 'flex flex-wrap' : ''}`}>
        {isSelected && tokens.length > 0 ? (
          tokens.map((token, i) => {
            const surfaceKey = token.surface.toLowerCase()
            const dictKey = (token.dictionaryForm ?? '').toLowerCase()
            const minedKey = allCardsMap?.has(surfaceKey)
              ? surfaceKey
              : allCardsMap?.has(dictKey)
                ? dictKey
                : null
            return (
              <span
                key={i}
                onClick={(e) => handleWordClick(e, token)}
                data-word={minedKey ?? undefined}
                className={`rounded px-px cursor-pointer transition-colors ${
                  token.surface === selectedWord
                    ? 'bg-yellow-400/30 text-yellow-200'
                    : 'hover:bg-yellow-400/20 hover:text-yellow-300'
                } ${minedKey ? 'epub-mined-word' : ''}`}
              >
                {token.surface}
              </span>
            )
          })
        ) : minedPattern ? (
          splitWithMined(sentence.content, minedPattern).map((part, i) =>
            part.isMined ? (
              <span key={i} className="epub-mined-word" data-word={part.text.toLowerCase()}>
                {part.text}
              </span>
            ) : (
              <span key={i}>{part.text}</span>
            ),
          )
        ) : (
          sentence.content
        )}
      </p>
    </div>
  )
}
