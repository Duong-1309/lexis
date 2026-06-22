import { useEffect, useRef, useState } from 'react'
import { useLookupStore } from '../../store/lookupStore'
import { useCardStore, buildDraft } from '../../store/cardStore'
import { usePatternStore } from '../../store/patternStore'
import { useReaderStore } from '../../store/readerStore'
import { AudioButton } from './AudioButton'
import { buildPatternDraftFromSentence } from '../../utils/patternMining'
import { debugLog } from '../../utils/debugLog'
import type { Language, NativeLanguage } from '../../types'

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()
}

function markdownToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  const lines = escaped.split('\n').map((line) => {
    if (/^#{1,3}\s/.test(line))
      return `<strong class="text-gray-100">${line.replace(/^#{1,3}\s/, '')}</strong>`
    if (/^[-*]\s/.test(line)) return `&bull; ${line.replace(/^[-*]\s/, '')}`
    return line
  })

  return lines
    .join('\n')
    .replace(/\*\*\*(.*?)\*\*\*/gs, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.*?)\*\*/gs, '<strong>$1</strong>')
    .replace(/(?<!\*)\*(?!\*)([\s\S]*?)(?<!\*)\*(?!\*)/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code class="bg-gray-700 px-0.5 rounded text-xs">$1</code>')
}

function primaryTranslation(text: string): string | undefined {
  const firstLine = text
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line && !/^note[:：]/i.test(line))
  return firstLine
    ?.replace(/^translation[:：]\s*/i, '')
    .replace(/^["“”]+|["“”]+$/g, '')
    .trim() || undefined
}

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

interface SelectionAiOutputs {
  grammar?: string
  translate?: string
  examples?: string
}

function buildSelectionExplanation(outputs: SelectionAiOutputs): string | undefined {
  const sections: string[] = []
  if (outputs.translate) sections.push(`Translation:\n${outputs.translate.trim()}`)
  if (outputs.grammar) sections.push(`Explanation:\n${outputs.grammar.trim()}`)
  if (outputs.examples) sections.push(`Examples:\n${outputs.examples.trim()}`)
  return sections.length > 0 ? sections.join('\n\n') : undefined
}

function SelectionAIPanel({
  selection,
  language,
  nativeLanguage,
  onOutput,
}: {
  selection: string
  language: Language
  nativeLanguage: NativeLanguage
  onOutput: (mode: AIMode, text: string | null) => void
}) {
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [mode, setMode] = useState<AIMode | null>(null)
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [capturedModes, setCapturedModes] = useState<Set<AIMode>>(new Set())
  const streamIdRef = useRef<string | null>(null)
  const modeRef = useRef<AIMode | null>(null)
  const textRef = useRef('')

  useEffect(() => {
    window.lexis.ai.hasApiKey().then((r) => setHasKey(r.data ?? false))
    window.lexis.ai.onStreamChunk((streamId, chunk) => {
      if (streamId === streamIdRef.current) {
        textRef.current += chunk
        setText(textRef.current)
      }
    })
    window.lexis.ai.onStreamDone((streamId) => {
      if (streamId === streamIdRef.current) {
        if (modeRef.current) onOutput(modeRef.current, textRef.current)
        if (modeRef.current && textRef.current.trim()) {
          setCapturedModes((prev) => new Set(prev).add(modeRef.current!))
        }
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

  // Clear output when selection changes; AI only runs when the user clicks an action.
  useEffect(() => {
    handleCancel()
    setMode(null)
    setCapturedModes(new Set())
    textRef.current = ''
    setText('')
    setError(null)
    onOutput('grammar', null)
    onOutput('translate', null)
    onOutput('examples', null)
  }, [selection, language, nativeLanguage])

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
    debugLog('lookup', 'ai-action-start', {
      mode: m,
      selection,
      language,
      nativeLanguage,
      hasKey,
    })
    setMode(m)
    modeRef.current = m
    textRef.current = ''
    setText('')
    setError(null)
    setCapturedModes((prev) => {
      const next = new Set(prev)
      next.delete(m)
      return next
    })
    onOutput(m, null)
    setLoading(true)

    try {
      let result: Awaited<ReturnType<typeof window.lexis.ai.explainGrammar>>
      if (m === 'grammar') {
        result = await window.lexis.ai.explainGrammar(selection, selection, language, nativeLanguage)
      } else if (m === 'translate') {
        result = await window.lexis.ai.translateWithContext(selection, language, nativeLanguage)
      } else {
        result = await window.lexis.ai.generateExamples(selection, language, 3, nativeLanguage)
      }

      debugLog('lookup', 'ai-action-result', {
        mode: m,
        error: result.error,
        streamId: result.data?.streamId,
      })

      if (result.error) {
        setError(result.error)
        setLoading(false)
        return
      }

      if (!result.data?.streamId) {
        setError('AI action did not start. Check the app logs for details.')
        setLoading(false)
        return
      }

      streamIdRef.current = result.data.streamId
    } catch (err) {
      debugLog('lookup', 'ai-action-exception', {
        mode: m,
        message: err instanceof Error ? err.message : String(err),
      })
      setError(err instanceof Error ? err.message : 'AI action failed to start.')
      setLoading(false)
    }
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
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => runAI(m)}
            disabled={loading && mode !== m}
            className={`flex-1 px-2 py-1.5 text-[11px] font-medium rounded-md transition-colors ${
              mode === m && (loading || text)
                ? 'bg-blue-600 text-white'
                : capturedModes.has(m)
                  ? 'bg-green-600/20 text-green-300 hover:bg-green-600/30'
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
              <div
                className="whitespace-pre-wrap [&_strong]:font-semibold [&_strong]:text-gray-100 [&_em]:italic [&_code]:font-mono"
                dangerouslySetInnerHTML={{ __html: markdownToHtml(text) }}
              />
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
  const { word, language, results, loading, error, selectionOnly, setNativeDefinition } = useLookupStore()
  const { openBuilder } = useCardStore()
  const { openBuilder: openPatternBuilder } = usePatternStore()
  const { currentSource, selectedSentence, selectedWord } = useReaderStore()

  const [nativeLang, setNativeLang] = useState<NativeLanguage>('vi')
  const [hasAiKey, setHasAiKey] = useState(false)
  const [viDef, setViDef] = useState<string | null>(null)
  const [selectionAiOutputs, setSelectionAiOutputs] = useState<SelectionAiOutputs>({})
  const [translating, setTranslating] = useState(false)

  useEffect(() => {
    window.lexis.settings.get().then((r) => {
      if (r.data) setNativeLang(r.data.nativeLanguage)
    })
    window.lexis.ai.hasApiKey().then((r) => {
      setHasAiKey(r.data ?? false)
    })
  }, [])

  useEffect(() => {
    setSelectionAiOutputs({})
  }, [word, language, selectionOnly])

  const handleSelectionAiOutput = (mode: AIMode, text: string | null) => {
    setSelectionAiOutputs((prev) => {
      const next = { ...prev }
      if (text?.trim()) next[mode] = text
      else delete next[mode]
      return next
    })
  }

  useEffect(() => {
    setViDef(null)
    setNativeDefinition(null)
    setTranslating(false)
    if (selectionOnly || !word || !language || results.length === 0 || !hasAiKey || nativeLang === 'en') return

    // Collect ALL definitions from ALL senses (max 6 senses, 2 defs each)
    const allDefs: string[] = []
    for (const entry of results.slice(0, 2)) {
      for (const sense of entry.senses.slice(0, 4)) {
        const pos = sense.partOfSpeech[0] ? `(${posLabel(sense.partOfSpeech[0])}) ` : ''
        const defs = sense.definitions.slice(0, 2).map(stripHtml).join('; ')
        if (defs) allDefs.push(`${pos}${defs}`)
      }
    }
    if (allDefs.length === 0) return

    // Join with numbered list for clarity
    const rawDef = allDefs.map((d, i) => `${i + 1}. ${d}`).join('\n')
    setTranslating(true)
    let cancelled = false

    window.lexis.ai
      .translateDefinition(word, rawDef, language, nativeLang)
      .then((r) => {
        if (cancelled) return
        if (r.data) {
          setViDef(r.data)
          setNativeDefinition(r.data)
        }
        setTranslating(false)
      })
      .catch(() => { if (!cancelled) setTranslating(false) })

    return () => { cancelled = true }
  }, [word, language, results, nativeLang, hasAiKey, selectionOnly, setNativeDefinition])

  const handleAddToDeck = () => {
    if (!word || !language || results.length === 0) return
    const entry = results[0]
    const reading = entry?.readings[0]?.value
    const levelInfo = entry?.jlptLevel || entry?.hskLevel
      ? { jlpt: entry.jlptLevel, hsk: entry.hskLevel }
      : undefined

    // Collect ALL definitions from ALL senses for the card
    const allDefs: string[] = []
    const allPos: string[] = []
    for (const e of results.slice(0, 2)) {
      for (const sense of e.senses.slice(0, 4)) {
        const pos = sense.partOfSpeech[0] ? posLabel(sense.partOfSpeech[0]) : ''
        if (pos && !allPos.includes(pos)) allPos.push(pos)
        const defs = sense.definitions.slice(0, 2).map(stripHtml).join('; ')
        if (defs) allDefs.push(pos ? `(${pos}) ${defs}` : defs)
      }
    }
    const definition = allDefs.join('\n') || entry?.senses[0]?.definitions[0] || ''

    openBuilder(
      buildDraft({
        word,
        reading,
        definition,
        language,
        nativeDefinition: viDef ?? undefined,
        partOfSpeech: allPos.join(', ') || entry?.senses[0]?.partOfSpeech[0],
        levelInfo,
        audioWord: word,
        sourceSentence: selectedSentence?.content,
        sourceHighlight: selectedWord ?? word,
        sourceId: selectedSentence?.sourceId ?? currentSource?.id,
      }),
    )
  }

  const handleMinePattern = () => {
    if (!language || !currentSource) return
    const firstSense = results[0]?.senses[0]
    const definition = firstSense?.definitions.slice(0, 2).map(stripHtml).join('; ')
    const lookupTarget = (selectedWord ?? word ?? '').trim().toLowerCase()
    const sentenceText = selectedSentence?.content.toLowerCase() ?? ''
    const isSingleLookupToken = Boolean(
      lookupTarget &&
      /^[a-zA-ZÀ-ɏ'-]+$/.test(lookupTarget),
    )
    const lookupBelongsToSentence = Boolean(
      lookupTarget &&
      sentenceText &&
      sentenceText.includes(lookupTarget),
    )
    const canUseLookupDefinition = Boolean(
      !selectionOnly && (!selectedSentence || (lookupBelongsToSentence && isSingleLookupToken)),
    )
    const translatedSelection = selectionOnly && selectionAiOutputs.translate
      ? primaryTranslation(selectionAiOutputs.translate)
      : undefined
    const selectionExplanation = selectionOnly
      ? buildSelectionExplanation(selectionAiOutputs)
      : undefined
    const meaningNative = selectionOnly
      ? translatedSelection
      : canUseLookupDefinition
        ? viDef ?? definition
        : undefined
    const explanation = selectionOnly && selectionExplanation
      ? selectionExplanation
      : canUseLookupDefinition
        ? definition ? `Source meaning: ${definition}` : undefined
        : undefined

    debugLog('lookup', 'mine-pattern-context', {
      word,
      selectedWord,
      selectedSentence: selectedSentence?.content,
      selectionOnly,
      lookupTarget,
      isSingleLookupToken,
      lookupBelongsToSentence,
      canUseLookupDefinition,
      definition,
      viDef,
      selectionAiOutputs,
      meaningNative,
      sourceId: currentSource.id,
    })

    if (selectedSentence) {
      openPatternBuilder(
        {
          ...buildPatternDraftFromSentence({
          sentence: selectedSentence,
          language,
          target: selectedWord ?? word,
          sourceId: currentSource.id,
          }),
          meaningNative,
          explanation,
        },
      )
      return
    }

    openPatternBuilder({
      language,
      patternText: word ?? '',
      meaningNative,
      explanation,
      exampleSentence: word ?? undefined,
      sourceId: currentSource.id,
      tags: ['pattern', language],
    })
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
          Select a word, phrase, or sentence to look it up or mine a pattern
        </p>
      </div>
    )
  }

  return (
    <div className="w-80 shrink-0 bg-gray-900 border-l border-white/5 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5">
        <span className="text-lg font-medium text-gray-100 truncate flex-1">{word}</span>
        {word && language && !selectionOnly && (
          <AudioButton word={word} language={language} reading={results[0]?.readings[0]?.value} />
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* Native definition */}
        {(translating || viDef) && !loading && (
          <div className="px-4 py-3 border-b border-white/5 bg-blue-500/5">
            {translating ? (
              <div className="space-y-1.5">
                <div className="h-3 bg-gray-700 rounded animate-pulse w-full" />
                <div className="h-3 bg-gray-700 rounded animate-pulse w-3/4" />
              </div>
            ) : (
              <p className="text-sm text-blue-200 leading-relaxed">{viDef}</p>
            )}
          </div>
        )}

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
            {selectionOnly ? 'Selected text ready for AI actions and pattern mining.' : `No results for "${word}"`}
            {!language && <p className="text-xs mt-1">Build dictionaries: npm run build:dicts</p>}
          </div>
        )}

        {word && language && selectionOnly && (
          <SelectionAIPanel
            selection={word}
          language={language}
          nativeLanguage={nativeLang}
          onOutput={handleSelectionAiOutput}
        />
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
                    {sense.definitions.slice(0, 3).map(stripHtml).join('; ')}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>

      {(results.length > 0 || selectedSentence || selectionOnly) && (
        <div className="px-4 py-3 border-t border-white/5 space-y-2">
          {results.length > 0 && !selectionOnly && (
            <button
              onClick={handleAddToDeck}
              className="w-full py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
            >
              + Add to Deck <span className="ml-1 text-xs opacity-60">Shift+A</span>
            </button>
          )}
          <button
            onClick={handleMinePattern}
            disabled={!selectedSentence && !word}
            className="w-full py-2 text-sm font-medium bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg transition-colors disabled:opacity-50"
          >
            Mine Pattern
          </button>
        </div>
      )}
    </div>
  )
}
