import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { Deck, DrillAttempt, DrillEvaluation, DrillPrompt, Pattern } from '../../types'
import { isTypingTarget } from '../../hooks/useHotkeys'

interface PatternDrillPanelProps {
  decks: Deck[]
  refreshKey?: number
  onReviewDeck?: (deckId: number) => void
}

function verdictLabel(verdict?: DrillAttempt['verdict']): string {
  if (verdict === 'correct') return 'Correct'
  if (verdict === 'incorrect') return 'Incorrect'
  return 'Needs fix'
}

function verdictClass(verdict?: DrillAttempt['verdict']): string {
  if (verdict === 'correct') return 'text-green-300 bg-green-500/10 border-green-500/20'
  if (verdict === 'incorrect') return 'text-red-300 bg-red-500/10 border-red-500/20'
  return 'text-yellow-300 bg-yellow-500/10 border-yellow-500/20'
}

function buildSavedFeedback(evaluation: DrillEvaluation): string {
  return [
    evaluation.feedback,
    evaluation.suggestions.length > 0
      ? `Suggestions:\n${evaluation.suggestions.map((item) => `- ${item}`).join('\n')}`
      : '',
    evaluation.examples.length > 0
      ? `Examples:\n${evaluation.examples.map((item) => `- ${item}`).join('\n')}`
      : '',
  ].filter(Boolean).join('\n\n')
}

function PatternList({
  patterns,
  selectedId,
  query,
  language,
  latestAttempts,
  languages,
  searchInputRef,
  onQueryChange,
  onLanguageChange,
  onSelect,
}: {
  patterns: Pattern[]
  selectedId: number | null
  query: string
  language: string
  latestAttempts: Map<number, DrillAttempt>
  languages: string[]
  searchInputRef: RefObject<HTMLInputElement>
  onQueryChange: (value: string) => void
  onLanguageChange: (value: string) => void
  onSelect: (pattern: Pattern) => void
}) {
  return (
    <div className="w-72 shrink-0 border-r border-white/5 flex flex-col min-h-0">
      <div className="px-4 py-3 border-b border-white/5 space-y-3">
        <h2 className="text-sm font-semibold text-gray-200">Patterns</h2>
        <p className="text-xs text-gray-500 mt-0.5">{patterns.length} mined</p>
        <input
          ref={searchInputRef}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          className="w-full px-3 py-2 bg-gray-800 border border-white/10 rounded-lg text-xs text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-blue-500/50"
          placeholder="Search patterns"
          title="Search patterns (/)"
          aria-keyshortcuts="/"
        />
        <select
          value={language}
          onChange={(e) => onLanguageChange(e.target.value)}
          className="w-full px-3 py-2 bg-gray-800 border border-white/10 rounded-lg text-xs text-gray-200 focus:outline-none focus:border-blue-500/50"
        >
          <option value="all">All languages</option>
          {languages.map((lang) => (
            <option key={lang} value={lang}>{lang.toUpperCase()}</option>
          ))}
        </select>
      </div>
      <div className="flex-1 overflow-y-auto py-2">
        {patterns.length === 0 ? (
          <p className="px-4 py-3 text-sm text-gray-500">Mine a pattern from Reader first.</p>
        ) : (
          patterns.map((pattern) => {
            const latest = latestAttempts.get(pattern.id)
            return (
              <button
                key={pattern.id}
                onClick={() => onSelect(pattern)}
                className={`w-full text-left px-4 py-3 transition-colors border-l-2 ${
                  selectedId === pattern.id
                    ? 'bg-blue-600/10 border-blue-400'
                    : 'border-transparent hover:bg-white/5'
                }`}
              >
                <div className="text-sm text-gray-200 line-clamp-2">{pattern.patternText}</div>
                {pattern.meaningNative && (
                  <div className="text-xs text-gray-500 mt-1 line-clamp-1">{pattern.meaningNative}</div>
                )}
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-[11px] text-gray-600">{pattern.language.toUpperCase()}</span>
                  {latest ? (
                    <span className={`text-[10px] border rounded-full px-1.5 py-0.5 ${verdictClass(latest.verdict)}`}>
                      {latest.score ?? '—'}
                    </span>
                  ) : (
                    <span className="text-[10px] text-gray-600">new</span>
                  )}
                </div>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}

function AttemptList({ attempts }: { attempts: DrillAttempt[] }) {
  return (
    <div className="border-t border-white/5 pt-4">
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Recent Attempts</h3>
      {attempts.length === 0 ? (
        <p className="text-sm text-gray-500">No attempts yet.</p>
      ) : (
        <div className="space-y-2">
          {attempts.slice(0, 5).map((attempt) => (
            <div key={attempt.id} className="border border-white/10 rounded-lg p-3 bg-gray-950/50">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-gray-200 line-clamp-2">{attempt.userAnswer}</p>
                <span className={`shrink-0 text-[11px] border rounded-full px-2 py-0.5 ${verdictClass(attempt.verdict)}`}>
                  {attempt.score ?? '—'}
                </span>
              </div>
              {attempt.correctedAnswer && attempt.correctedAnswer !== attempt.userAnswer && (
                <p className="text-xs text-green-300 mt-2">{attempt.correctedAnswer}</p>
              )}
              {attempt.feedback && <p className="text-xs text-gray-500 mt-1">{attempt.feedback}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function PatternDrillPanel({ decks, refreshKey = 0, onReviewDeck }: PatternDrillPanelProps) {
  const answerRef = useRef<HTMLTextAreaElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const [patterns, setPatterns] = useState<Pattern[]>([])
  const [selectedPattern, setSelectedPattern] = useState<Pattern | null>(null)
  const [query, setQuery] = useState('')
  const [languageFilter, setLanguageFilter] = useState('all')
  const [latestAttempts, setLatestAttempts] = useState<Map<number, DrillAttempt>>(new Map())
  const [prompts, setPrompts] = useState<DrillPrompt[]>([])
  const [selectedPromptId, setSelectedPromptId] = useState<number | null>(null)
  const [attempts, setAttempts] = useState<DrillAttempt[]>([])
  const [answer, setAnswer] = useState('')
  const [evaluation, setEvaluation] = useState<DrillEvaluation | null>(null)
  const [savedAttempt, setSavedAttempt] = useState<DrillAttempt | null>(null)
  const [deckId, setDeckId] = useState<number | null>(decks[0]?.id ?? null)
  const [loading, setLoading] = useState(false)
  const [creatingCard, setCreatingCard] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDeckId((current) => current ?? decks[0]?.id ?? null)
  }, [decks])

  useEffect(() => {
    let alive = true
    window.lexis.patterns.list().then((result) => {
      if (!alive) return
      if (result.error) {
        setError(result.error)
        return
      }
      const nextPatterns = result.data ?? []
      setPatterns(nextPatterns)
      setSelectedPattern((current) => current ?? nextPatterns[0] ?? null)
      void loadLatestAttempts(nextPatterns, () => alive)
    })
    return () => { alive = false }
  }, [refreshKey])

  async function loadLatestAttempts(nextPatterns: Pattern[], isAlive: () => boolean): Promise<void> {
    const entries = await Promise.all(nextPatterns.map(async (pattern) => {
      const result = await window.lexis.drills.listAttempts(pattern.id)
      if (result.error) return null
      const latest = result.data?.[0]
      return latest ? [pattern.id, latest] as const : null
    }))
    if (!isAlive()) return
    setLatestAttempts(new Map(entries.filter((entry): entry is readonly [number, DrillAttempt] => entry !== null)))
  }

  useEffect(() => {
    if (!selectedPattern) {
      setAttempts([])
      setPrompts([])
      setSelectedPromptId(null)
      return
    }
    let alive = true
    window.lexis.drills.listPrompts(selectedPattern.id).then((result) => {
      if (!alive) return
      if (result.error) {
        setError(result.error)
        return
      }
      const nextPrompts = result.data ?? []
      setPrompts(nextPrompts)
      setSelectedPromptId((current) =>
        current && nextPrompts.some((prompt) => prompt.id === current)
          ? current
          : nextPrompts[0]?.id ?? null,
      )
    })
    window.lexis.drills.listAttempts(selectedPattern.id).then((result) => {
      if (!alive) return
      if (result.error) {
        setError(result.error)
        return
      }
      setAttempts(result.data ?? [])
      if (result.data?.[0]) {
        setLatestAttempts((current) => new Map(current).set(selectedPattern.id, result.data![0]))
      }
    })
    return () => { alive = false }
  }, [selectedPattern])

  const selectedPrompt = useMemo(
    () => prompts.find((prompt) => prompt.id === selectedPromptId) ?? null,
    [prompts, selectedPromptId],
  )

  const promptText = useMemo(() => {
    if (!selectedPattern) return ''
    if (selectedPrompt?.promptNative) return selectedPrompt.promptNative
    if (selectedPrompt?.promptTarget) return `Create a new sentence using: ${selectedPrompt.promptTarget}`
    const meaning = selectedPattern.meaningNative ? ` (${selectedPattern.meaningNative})` : ''
    return `Create a new sentence using: ${selectedPattern.patternText}${meaning}`
  }, [selectedPattern, selectedPrompt])
  const answerChangedAfterCheck = savedAttempt !== null && answer.trim() !== savedAttempt.userAnswer
  const savedDeckId = deckId ?? selectedPattern?.deckId ?? decks[0]?.id ?? null
  const canMakeCard = Boolean(selectedPattern && answer.trim() && savedDeckId && !creatingCard)
  const currentAnswerAlreadyCarded = Boolean(
    savedAttempt?.cardId &&
    answer.trim() === savedAttempt.userAnswer,
  )

  const languages = useMemo(
    () => [...new Set(patterns.map((pattern) => pattern.language))].sort(),
    [patterns],
  )

  const filteredPatterns = useMemo(() => {
    const q = query.trim().toLowerCase()
    return patterns.filter((pattern) => {
      const matchesLanguage = languageFilter === 'all' || pattern.language === languageFilter
      const matchesQuery =
        !q ||
        pattern.patternText.toLowerCase().includes(q) ||
        (pattern.meaningNative ?? '').toLowerCase().includes(q) ||
        (pattern.explanation ?? '').toLowerCase().includes(q)
      return matchesLanguage && matchesQuery
    })
  }, [languageFilter, patterns, query])

  useEffect(() => {
    if (filteredPatterns.length === 0) return
    if (selectedPattern && filteredPatterns.some((pattern) => pattern.id === selectedPattern.id)) return
    setSelectedPattern(filteredPatterns[0])
    resetPracticeState()
  }, [filteredPatterns, selectedPattern])

  function resetPracticeState(): void {
    setAnswer('')
    setEvaluation(null)
    setSavedAttempt(null)
    setError(null)
  }

  function focusAnswerSoon(): void {
    window.requestAnimationFrame(() => answerRef.current?.focus())
  }

  function selectPattern(pattern: Pattern): void {
    setSelectedPattern(pattern)
    resetPracticeState()
    focusAnswerSoon()
  }

  function handleNextPattern(): void {
    if (filteredPatterns.length === 0) return
    const currentIndex = filteredPatterns.findIndex((pattern) => pattern.id === selectedPattern?.id)
    const next = filteredPatterns[(currentIndex + 1 + filteredPatterns.length) % filteredPatterns.length]
    if (next) selectPattern(next)
  }

  function handlePreviousPattern(): void {
    if (filteredPatterns.length === 0) return
    const currentIndex = filteredPatterns.findIndex((pattern) => pattern.id === selectedPattern?.id)
    const safeIndex = currentIndex < 0 ? 0 : currentIndex
    const previous = filteredPatterns[(safeIndex - 1 + filteredPatterns.length) % filteredPatterns.length]
    if (previous) selectPattern(previous)
  }

  function handleReviewNow(): void {
    if (!savedAttempt?.cardId || !savedDeckId || !onReviewDeck) return
    onReviewDeck(savedDeckId)
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isTyping = isTypingTarget(e.target)
      const hasCommand = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()

      if (hasCommand && e.key === 'Enter') {
        e.preventDefault()
        if (e.shiftKey) {
          void handleCreateCard()
        } else {
          void handleEvaluate()
        }
        return
      }

      if (hasCommand && e.key === 'ArrowRight') {
        e.preventDefault()
        handleNextPattern()
        return
      }

      if (hasCommand && e.key === 'ArrowLeft') {
        e.preventDefault()
        handlePreviousPattern()
        return
      }

      if (isTyping) {
        if (e.key === 'Escape' && e.target === searchInputRef.current) {
          e.preventDefault()
          setQuery('')
          searchInputRef.current?.blur()
        }
        return
      }

      if (e.key === '/') {
        e.preventDefault()
        searchInputRef.current?.focus()
        return
      }

      if (key === 'f') {
        e.preventDefault()
        answerRef.current?.focus()
        return
      }

      if (key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault()
        handleNextPattern()
        return
      }

      if (key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault()
        handlePreviousPattern()
        return
      }

      if (key === 'r' && savedAttempt?.cardId) {
        e.preventDefault()
        handleReviewNow()
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [
    answer,
    creatingCard,
    currentAnswerAlreadyCarded,
    filteredPatterns,
    loading,
    savedAttempt,
    savedDeckId,
    selectedPattern,
    selectedPrompt,
    promptText,
    answerChangedAfterCheck,
    onReviewDeck,
  ])

  async function handleEvaluate(): Promise<void> {
    if (!selectedPattern || loading) return
    if (!answer.trim()) {
      setError('Write your sentence first')
      return
    }

    setLoading(true)
    setError(null)
    setEvaluation(null)
    setSavedAttempt(null)

    const settingsResult = await window.lexis.settings.get()
    if (settingsResult.error || !settingsResult.data) {
      setLoading(false)
      setError(settingsResult.error ?? 'Could not load settings')
      return
    }

    const evalResult = await window.lexis.ai.evaluateDrillAnswer({
      language: selectedPattern.language,
      patternText: selectedPattern.patternText,
      prompt: promptText,
      userAnswer: answer.trim(),
      nativeLanguage: settingsResult.data.nativeLanguage,
    })

    if (evalResult.error || !evalResult.data) {
      setLoading(false)
      setError(evalResult.error ?? 'Could not evaluate answer')
      return
    }

    const saveResult = await window.lexis.drills.saveAttempt({
      patternId: selectedPattern.id,
      promptId: selectedPrompt?.id,
      userAnswer: answer.trim(),
      correctedAnswer: evalResult.data.correctedAnswer,
      feedback: buildSavedFeedback(evalResult.data),
      score: evalResult.data.score,
      verdict: evalResult.data.verdict,
      mistakeTypes: evalResult.data.mistakeTypes,
    })
    setLoading(false)

    if (saveResult.error || !saveResult.data) {
      setError(saveResult.error ?? 'Could not save attempt')
      return
    }

    setEvaluation(evalResult.data)
    setSavedAttempt(saveResult.data)
    setAttempts((items) => [saveResult.data!, ...items])
  }

  async function handleCreateCard(): Promise<void> {
    if (!selectedPattern || !savedDeckId || !answer.trim() || creatingCard) return
    if (currentAnswerAlreadyCarded) return

    setCreatingCard(true)
    setError(null)

    let attempt = savedAttempt
    if (!attempt || answerChangedAfterCheck) {
      const saveResult = await window.lexis.drills.saveAttempt({
        patternId: selectedPattern.id,
        promptId: selectedPrompt?.id,
        userAnswer: answer.trim(),
        correctedAnswer: answer.trim(),
        feedback: 'Saved without AI check.',
        mistakeTypes: [],
      })
      if (saveResult.error || !saveResult.data) {
        setCreatingCard(false)
        setError(saveResult.error ?? 'Could not save attempt')
        return
      }
      attempt = saveResult.data
      setAttempts((items) => [saveResult.data!, ...items])
    }

    const result = await window.lexis.drills.createReviewCard(attempt.id, savedDeckId)
    setCreatingCard(false)

    if (result.error) {
      setError(result.error)
      return
    }
    setSavedAttempt({ ...attempt, cardId: result.data?.id })
  }

  return (
    <div className="flex h-full min-h-0 bg-gray-950">
      <PatternList
        patterns={filteredPatterns}
        selectedId={selectedPattern?.id ?? null}
        query={query}
        language={languageFilter}
        latestAttempts={latestAttempts}
        languages={languages}
        searchInputRef={searchInputRef}
        onQueryChange={setQuery}
        onLanguageChange={setLanguageFilter}
        onSelect={selectPattern}
      />

      <div className="flex-1 min-w-0 overflow-y-auto">
        {!selectedPattern ? (
          <div className="h-full flex items-center justify-center text-sm text-gray-500">
            No pattern selected
          </div>
        ) : (
          <div className="max-w-3xl mx-auto p-6 space-y-5">
            <div>
              <div className="flex items-center justify-between gap-3">
                <h1 className="text-lg font-semibold text-gray-100">Pattern Drill</h1>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleNextPattern}
                    disabled={filteredPatterns.length <= 1}
                    className="px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-md transition-colors disabled:opacity-40"
                    title="Next pattern (J)"
                    aria-keyshortcuts="J"
                  >
                    Next Pattern
                  </button>
                  <span className="text-xs text-gray-500">{selectedPattern.language.toUpperCase()}</span>
                </div>
              </div>
              <div className="mt-3 border border-white/10 rounded-lg bg-gray-900/70 p-4">
                <p className="text-base text-gray-100">{selectedPattern.patternText}</p>
                {selectedPattern.meaningNative && (
                  <p className="text-sm text-gray-400 mt-2">{selectedPattern.meaningNative}</p>
                )}
                {selectedPattern.exampleSentence && (
                  <p className="text-xs text-gray-500 mt-3">{selectedPattern.exampleSentence}</p>
                )}
              </div>
              {prompts.length > 1 && (
                <div className="mt-3">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Prompt</label>
                  <select
                    value={selectedPromptId ?? ''}
                    onChange={(e) => setSelectedPromptId(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-gray-900 border border-white/10 rounded-lg text-sm text-gray-200"
                  >
                    {prompts.map((prompt) => (
                      <option key={prompt.id} value={prompt.id}>
                        {prompt.promptNative || prompt.promptTarget || prompt.type}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Your Sentence</label>
              <textarea
                ref={answerRef}
                value={answer}
                onChange={(e) => {
                  setAnswer(e.target.value)
                  setError(null)
                }}
                className="w-full h-28 px-3 py-2 bg-gray-900 border border-white/10 rounded-lg text-sm text-gray-100 resize-none focus:outline-none focus:border-blue-500/50"
                placeholder="Write a new sentence using this pattern"
                title="Your sentence (F)"
                aria-keyshortcuts="F"
              />
              <div className="mt-3 rounded-lg border border-white/5 bg-gray-950/50 p-3 space-y-3">
                <p className="text-xs text-gray-500 line-clamp-2">{promptText}</p>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-h-7 flex items-center gap-2">
                    {savedAttempt?.cardId ? (
                      <span className="text-xs text-green-400">Card saved</span>
                    ) : savedAttempt && answerChangedAfterCheck ? (
                      <span className="text-xs text-yellow-400">Edited after check</span>
                    ) : null}
                  </div>
                  <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
                    {decks.length > 0 && (
                      <select
                        value={deckId ?? ''}
                        onChange={(e) => setDeckId(Number(e.target.value))}
                        className="min-w-0 max-w-full sm:max-w-48 px-2 py-2 bg-gray-800 border border-white/10 rounded-lg text-xs text-gray-200"
                      >
                        {decks.map((deck) => (
                          <option key={deck.id} value={deck.id}>{deck.name}</option>
                        ))}
                      </select>
                    )}
                    <button
                      onClick={() => void handleCreateCard()}
                      disabled={!canMakeCard || currentAnswerAlreadyCarded}
                      className="shrink-0 px-4 py-2 text-sm font-medium bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg transition-colors disabled:opacity-50"
                      title="Make card (Cmd/Ctrl+Shift+Enter)"
                      aria-keyshortcuts="Meta+Shift+Enter Control+Shift+Enter"
                    >
                      {currentAnswerAlreadyCarded ? 'Card Saved' : creatingCard ? 'Making...' : 'Make Card'}
                    </button>
                    {savedAttempt?.cardId && savedDeckId && onReviewDeck && (
                      <button
                        onClick={() => onReviewDeck(savedDeckId)}
                        className="shrink-0 px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
                        title="Review now (R)"
                        aria-keyshortcuts="R"
                      >
                        Review Now
                      </button>
                    )}
                    <button
                      onClick={() => void handleEvaluate()}
                      disabled={loading || !answer.trim()}
                      className="shrink-0 px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-50"
                      title="Check answer (Cmd/Ctrl+Enter)"
                      aria-keyshortcuts="Meta+Enter Control+Enter"
                    >
                      {loading ? 'Checking...' : 'Check Answer'}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}

            {evaluation && (
              <div className="border border-white/10 rounded-lg bg-gray-900/70 p-4 space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <span className={`w-fit text-xs border rounded-full px-2.5 py-1 ${verdictClass(evaluation.verdict)}`}>
                    {verdictLabel(evaluation.verdict)} · {evaluation.score}/100
                  </span>
                  <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
                    {savedAttempt && !savedAttempt.cardId && answerChangedAfterCheck && (
                      <span className="text-xs text-yellow-400">Edited after check · Make Card will skip recheck</span>
                    )}
                    {savedAttempt?.cardId && (
                      <>
                        <span className="text-xs text-green-400">Card saved</span>
                        {savedDeckId && onReviewDeck && (
                          <button
                            onClick={() => onReviewDeck(savedDeckId)}
                            className="shrink-0 px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
                          >
                            Review Now
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Correction</p>
                  <p className="text-sm text-gray-100 mt-1">{evaluation.correctedAnswer}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Feedback</p>
                  <p className="text-sm text-gray-300 mt-1">{evaluation.feedback}</p>
                </div>
                {evaluation.suggestions.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Suggestions</p>
                    <ul className="mt-1 space-y-1">
                      {evaluation.suggestions.map((suggestion) => (
                        <li key={suggestion} className="text-sm text-gray-300">
                          {suggestion}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {evaluation.examples.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Examples</p>
                    <div className="mt-1 space-y-1.5">
                      {evaluation.examples.map((example) => (
                        <button
                          key={example}
                          onClick={() => {
                            setAnswer(example)
                            setError(null)
                          }}
                          className="block w-full text-left px-3 py-2 rounded-md bg-gray-950/60 hover:bg-gray-800 text-sm text-gray-200 transition-colors"
                        >
                          {example}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {evaluation.mistakeTypes.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {evaluation.mistakeTypes.map((type) => (
                      <span key={type} className="text-[11px] px-2 py-0.5 rounded-full bg-gray-800 text-gray-400">
                        {type}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            <AttemptList attempts={attempts} />
          </div>
        )}
      </div>
    </div>
  )
}
