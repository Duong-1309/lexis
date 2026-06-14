import { useEffect, useRef, useState } from 'react'
import { useLookupStore } from '../../store/lookupStore'
import { useCardStore, buildDraft } from '../../store/cardStore'
import { useReaderStore } from '../../store/readerStore'
import { AudioButton } from './AudioButton'
import type { Language } from '../../types'

const POS_ABBREV: Record<string, string> = {
  '名詞': 'n', '動詞': 'v', '形容詞': 'adj', '副詞': 'adv', '助詞': 'part',
  '助動詞': 'aux', '接続詞': 'conj', '感動詞': 'int', '接頭詞': 'pref',
  noun: 'n', verb: 'v', adjective: 'adj', adverb: 'adv',
}

function posLabel(pos: string): string {
  return POS_ABBREV[pos] ?? pos.slice(0, 4)
}

type AIMode = 'grammar' | 'translate' | 'examples'

const AI_LABELS: Record<AIMode, string> = {
  grammar: 'Explain Grammar',
  translate: 'Translate',
  examples: 'Examples',
}

function AIPanel({ word, language }: { word: string; language: Language }) {
  const { selectedSentence } = useReaderStore()
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [mode, setMode] = useState<AIMode | null>(null)
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const streamIdRef = useRef<string | null>(null)

  useEffect(() => {
    window.lexis.ai.hasApiKey().then((r) => setHasKey(r.data ?? false))
    window.lexis.ai.onStreamChunk((streamId, chunk) => {
      if (streamId === streamIdRef.current) {
        setText((prev) => prev + chunk)
      }
    })
    window.lexis.ai.onStreamDone((streamId) => {
      if (streamId === streamIdRef.current) {
        setLoading(false)
        streamIdRef.current = null
      }
    })
    window.lexis.ai.onStreamError((streamId, msg) => {
      if (streamId === streamIdRef.current) {
        setError(msg)
        setLoading(false)
        streamIdRef.current = null
      }
    })
    return () => {
      window.lexis.ai.removeStreamListeners()
    }
  }, [])

  // Clear AI output when word changes
  useEffect(() => {
    handleCancel()
    setMode(null)
    setText('')
    setError(null)
  }, [word])

  const handleCancel = () => {
    if (streamIdRef.current) {
      void window.lexis.ai.cancelStream(streamIdRef.current)
      streamIdRef.current = null
    }
    setLoading(false)
  }

  const runAI = async (m: AIMode) => {
    if (loading) {
      handleCancel()
      return
    }
    setMode(m)
    setText('')
    setError(null)
    setLoading(true)

    let result: Awaited<ReturnType<typeof window.lexis.ai.explainGrammar>>
    const sentence = selectedSentence?.content ?? word

    if (m === 'grammar') {
      result = await window.lexis.ai.explainGrammar(sentence, word, language)
    } else if (m === 'translate') {
      result = await window.lexis.ai.translateWithContext(sentence, language)
    } else {
      result = await window.lexis.ai.generateExamples(word, language)
    }

    if (result.error) {
      setError(result.error)
      setLoading(false)
      return
    }

    streamIdRef.current = result.data!.streamId
  }

  if (hasKey === false) {
    return (
      <div className="px-4 py-3 border-t border-white/5">
        <p className="text-xs text-gray-500 text-center">
          Add an Anthropic API key in{' '}
          <span className="text-blue-400">Settings</span> to use AI features
        </p>
      </div>
    )
  }

  return (
    <div className="border-t border-white/5">
      {/* Action buttons */}
      <div className="flex gap-1.5 px-4 py-2">
        {(Object.keys(AI_LABELS) as AIMode[]).map((m) => (
          <button
            key={m}
            onClick={() => runAI(m)}
            disabled={loading && mode !== m}
            className={`flex-1 px-2 py-1.5 text-[11px] font-medium rounded-md transition-colors ${
              mode === m && (loading || text)
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-200 disabled:opacity-40'
            }`}
          >
            {loading && mode === m ? '...' : AI_LABELS[m]}
          </button>
        ))}
      </div>

      {/* Output */}
      {(text || error || loading) && (
        <div className="relative mx-4 mb-3 p-3 bg-gray-800/60 rounded-lg text-xs text-gray-300 leading-relaxed min-h-[50px] max-h-48 overflow-y-auto">
          {error ? (
            <p className="text-red-400">{error}</p>
          ) : (
            <>
              <p className="whitespace-pre-wrap">{text}</p>
              {loading && (
                <span className="inline-block w-1.5 h-3.5 bg-blue-400 animate-pulse ml-0.5 align-middle" />
              )}
            </>
          )}
          {loading && (
            <button
              onClick={handleCancel}
              className="absolute top-2 right-2 text-gray-500 hover:text-gray-300 transition-colors"
              title="Cancel"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function LookupPanel() {
  const { word, language, results, loading, error } = useLookupStore()
  const { openBuilder } = useCardStore()

  const handleAddToDeck = () => {
    if (!word || !language || results.length === 0) return
    const firstSense = results[0]?.senses[0]
    const definition = firstSense?.definitions.slice(0, 2).join('; ') ?? ''
    const reading = results[0]?.readings[0]?.value
    openBuilder(buildDraft({ word, reading, definition, language }))
  }

  // Empty state
  if (!word && !loading) {
    return (
      <div className="w-80 shrink-0 bg-gray-900 border-l border-white/5 flex flex-col items-center justify-center text-gray-600 gap-2 p-6">
        <svg className="w-10 h-10 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <p className="text-xs text-center leading-relaxed">
          Click a word in a selected sentence to look it up
        </p>
      </div>
    )
  }

  return (
    <div className="w-80 shrink-0 bg-gray-900 border-l border-white/5 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5">
        <span className="text-lg font-medium text-gray-100 truncate flex-1">{word}</span>
        {word && language && (
          <AudioButton word={word} language={language} reading={results[0]?.readings[0]?.value} />
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading && (
          <div className="flex items-center justify-center h-24 text-gray-500 text-sm">
            Looking up...
          </div>
        )}

        {error && (
          <div className="px-4 py-3 text-xs text-red-400">{error}</div>
        )}

        {!loading && !error && results.length === 0 && word && (
          <div className="px-4 py-6 text-center text-gray-500 text-sm">
            No results for "{word}"
            {!language && <p className="text-xs mt-1">Build dictionaries: npm run build:dicts</p>}
          </div>
        )}

        {results.map((entry, ei) => (
          <div key={ei} className="border-b border-white/5 last:border-0">
            {entry.readings.length > 0 && (
              <div className="flex flex-wrap gap-1.5 px-4 pt-3 pb-1">
                {entry.readings.slice(0, 4).map((r, i) => (
                  <span key={i} className="text-sm text-blue-300 font-medium">{r.value}</span>
                ))}
              </div>
            )}

            <ol className="px-4 pb-3 space-y-2 list-decimal list-inside">
              {entry.senses.slice(0, 6).map((sense, si) => (
                <li key={si} className="text-sm">
                  {sense.partOfSpeech.length > 0 && (
                    <span className="mr-1.5">
                      {sense.partOfSpeech.slice(0, 2).map((p, pi) => (
                        <span key={pi} className="text-[10px] bg-gray-700 text-gray-400 rounded px-1 py-0.5 mr-1">
                          {posLabel(p)}
                        </span>
                      ))}
                    </span>
                  )}
                  <span className="text-gray-200">
                    {sense.definitions.slice(0, 3).join('; ')}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>

      {/* AI Panel */}
      {word && language && <AIPanel word={word} language={language} />}

      {results.length > 0 && (
        <div className="px-4 py-3 border-t border-white/5">
          <button
            onClick={handleAddToDeck}
            className="w-full py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
          >
            + Add to Deck <span className="ml-1 text-xs opacity-60">(A)</span>
          </button>
        </div>
      )}
    </div>
  )
}
