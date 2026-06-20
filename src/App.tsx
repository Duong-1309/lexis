import { useEffect, useState } from 'react'
import { ReaderPanel } from './components/Reader/ReaderPanel'
import { LookupPanel } from './components/Lookup/LookupPanel'
import { CardBuilder } from './components/CardBuilder/CardBuilder'
import { PatternBuilder } from './components/PatternBuilder/PatternBuilder'
import { DeckPicker } from './components/Review/DeckPicker'
import { ReviewSession } from './components/Review/ReviewSession'
import { ImportModal } from './components/ImportModal'
import { SettingsPage } from './components/Settings/SettingsPage'
import { StatsDashboard } from './components/Stats/StatsDashboard'
import { DeckBrowser } from './components/Decks/DeckBrowser'
import { PatternDrillPanel } from './components/Drills/PatternDrillPanel'
import { StatusBar } from './components/shared/StatusBar'
import { WelcomeModal } from './components/Onboarding/WelcomeModal'
import { useReaderStore } from './store/readerStore'
import { useLookupStore } from './store/lookupStore'
import { usePatternStore } from './store/patternStore'
import { useHotkeys } from './hooks/useHotkeys'
import { buildPatternDraftFromSentence } from './utils/patternMining'
import { debugLog } from './utils/debugLog'
import type { MediaSource, Language, Deck, Card, Sentence, Pattern, ReadingProgress } from './types'

export interface MinedCardEntry { card: Card; deckName: string }
type ActiveView = 'reader' | 'stats' | 'decks' | 'drills'

// EPUB progress encoding: position = chapterIdx * 10000 + pageIdx
const EPUB_PAGE_MULTIPLIER = 10000

function encodeEpubPosition(chapterIdx: number, pageIdx: number): number {
  return chapterIdx * EPUB_PAGE_MULTIPLIER + pageIdx
}

function decodeEpubPosition(position: number): { chapterIdx: number; pageIdx: number } {
  return {
    chapterIdx: Math.floor(position / EPUB_PAGE_MULTIPLIER),
    pageIdx: position % EPUB_PAGE_MULTIPLIER,
  }
}

// Calculate reading progress percentage
function getReadingPercent(source: MediaSource, progress?: ReadingProgress): number {
  if (!progress) return 0
  const total = source.sentenceCount ?? 0
  if (total === 0) return 0

  // For EPUB: position encodes both chapter index and page
  if (source.type === 'epub') {
    const { chapterIdx } = decodeEpubPosition(progress.position)
    // +1 because chapter index is 0-based, and we want "chapter 1 of 10" to show some progress
    return Math.min(100, Math.round(((chapterIdx + 1) / total) * 100))
  }

  return Math.min(100, Math.round((progress.position / total) * 100))
}

function normalizeSelectionText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isSentenceOrPhraseSelection(text: string, sentence?: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false

  const normalized = normalizeSelectionText(trimmed)
  if (sentence && normalized === normalizeSelectionText(sentence)) return true
  if (/\s/.test(trimmed)) return true
  if (/[.!?。！？｡؟…、,;:，；：]/u.test(trimmed)) return true

  const chars = Array.from(trimmed)
  const hasCjkOrHangul = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(trimmed)
  if (hasCjkOrHangul && chars.length >= 6) return true

  return false
}

function isReaderWordHighlightCard(card: Card): boolean {
  const word = card.word?.trim()
  if (!word) return false
  if (card.tags.includes('drill') || card.tags.includes('pattern')) return false
  if (/\s/.test(word)) return false
  if (/[.!?。！？｡؟…、,;:，；：]/u.test(word)) return false
  return true
}

function mediaTypeLabel(source: MediaSource): string | null {
  if (source.type === 'epub') return 'EPUB'
  if (source.type === 'text') return 'TEXT'
  if (source.type === 'web') return 'WEB'
  return null
}

function mediaCountLabel(source: MediaSource): string {
  if (source.type === 'epub') return 'chapters'
  if (source.type === 'text' || source.type === 'web') return 'sentences'
  return 'lines'
}

function Sidebar({
  sources,
  currentSourceId,
  totalDue,
  progressMap,
  onImport,
  onSelect,
  onDelete,
  onReview,
  onStats,
  onDecks,
  onDrills,
  onSettings,
}: {
  sources: MediaSource[]
  currentSourceId: number | null
  totalDue: number
  progressMap: Map<number, ReadingProgress>
  onImport: () => void
  onSelect: (source: MediaSource) => void
  onDelete: (source: MediaSource) => void
  onReview: () => void
  onStats: () => void
  onDecks: () => void
  onDrills: () => void
  onSettings: () => void
}) {
  return (
    <div className="flex flex-col w-52 shrink-0 bg-gray-900 border-r border-white/5">
      <div className="p-3 space-y-2 border-b border-white/5">
        <button
          onClick={onImport}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-colors"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Import
        </button>

        <button
          onClick={onReview}
          className="w-full flex items-center justify-between px-3 py-2 text-sm bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-md transition-colors"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            Review
          </div>
          {totalDue > 0 && (
            <span className="text-xs font-semibold bg-blue-500 text-white px-1.5 py-0.5 rounded-full">
              {totalDue}
            </span>
          )}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {sources.length === 0 ? (
          <p className="text-xs text-gray-500 px-4 py-3">No files imported yet</p>
        ) : (
          sources.map((source) => {
            const label = mediaTypeLabel(source)
            const progress = progressMap.get(source.id)
            const percent = getReadingPercent(source, progress)
            const isSelected = currentSourceId === source.id
            return (
              <div
                key={source.id}
                className={`group relative px-4 py-2 transition-colors hover:bg-white/5 ${
                  isSelected ? 'bg-blue-600/10' : ''
                }`}
              >
                <button
                  onClick={() => onSelect(source)}
                  className={`w-full text-left text-sm ${
                    isSelected ? 'text-blue-400' : 'text-gray-300'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-medium">{source.title}</span>
                    {label && (
                      <span className="shrink-0 text-[9px] bg-purple-600/30 text-purple-300 px-1 rounded">{label}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-gray-500">
                      {source.language.toUpperCase()} · {source.sentenceCount ?? 0} {mediaCountLabel(source)}
                    </span>
                    {percent > 0 && (
                      <span className={`text-[10px] ${percent >= 100 ? 'text-green-400' : 'text-blue-400'}`}>
                        {percent}%
                      </span>
                    )}
                  </div>
                  {/* Progress bar */}
                  {percent > 0 && (
                    <div className="mt-1.5 h-0.5 bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all ${percent >= 100 ? 'bg-green-500' : 'bg-blue-500'}`}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  )}
                </button>
                {/* Delete button - visible on hover */}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete(source)
                  }}
                  className="absolute right-2 top-2 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-600/20 text-gray-500 hover:text-red-400 transition-all"
                  title="Delete"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            )
          })
        )}
      </div>

      {/* Bottom nav buttons */}
      <div className="p-3 border-t border-white/5 space-y-2">
        <button
          onClick={onStats}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-500 hover:text-gray-300 hover:bg-white/5 rounded-md transition-colors"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          Stats
        </button>
        <button
          onClick={onDecks}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-500 hover:text-gray-300 hover:bg-white/5 rounded-md transition-colors"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          Browse Decks
        </button>
        <button
          onClick={onDrills}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-500 hover:text-gray-300 hover:bg-white/5 rounded-md transition-colors"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h8M8 12h5m-8 8h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          Drills
        </button>
        <button
          onClick={onSettings}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-500 hover:text-gray-300 hover:bg-white/5 rounded-md transition-colors"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Settings
        </button>
      </div>
    </div>
  )
}

export default function App() {
  const {
    currentSource,
    sentences,
    selectedSentence,
    selectedWord,
    minedWords,
    chapters,
    selectedChapterId,
    chapterHtml,
    chapterLoading,
    setSource,
    setSentences,
    setMinedWords,
    selectSentence,
    selectWord,
    setChapters,
    selectChapter,
    setChapterHtml,
    setChapterLoading,
    clearEPUB,
  } = useReaderStore()

  const { lookup, setSelection, clear: clearLookup } = useLookupStore()
  const patternBuilderOpen = usePatternStore((state) => state.open)
  const openPatternBuilder = usePatternStore((state) => state.openBuilder)

  const [sources, setSources] = useState<MediaSource[]>([])
  const [progressMap, setProgressMap] = useState<Map<number, ReadingProgress>>(new Map())
  const [initialPosition, setInitialPosition] = useState<number | undefined>(undefined)
  const [initialChapterId, setInitialChapterId] = useState<string | undefined>(undefined)
  const [showImport, setShowImport] = useState(false)
  const [showDeckPicker, setShowDeckPicker] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showWelcome, setShowWelcome] = useState(false)
  const [activeView, setActiveView] = useState<ActiveView>('reader')
  const [activeReview, setActiveReview] = useState<{ deckId: number; deckName: string } | null>(null)
  const [decks, setDecks] = useState<Deck[]>([])
  const [allCardsMap, setAllCardsMap] = useState<Map<string, MinedCardEntry>>(new Map())
  const [minedPatterns, setMinedPatterns] = useState<Pattern[]>([])
  const [patternRefreshKey, setPatternRefreshKey] = useState(0)

  useHotkeys({
    enabled:
      activeView === 'reader' &&
      !activeReview &&
      !showImport &&
      !showDeckPicker &&
      !showSettings &&
      !patternBuilderOpen,
  })

  useEffect(() => {
    loadSources()
    loadDecks()
    // Check if first launch
    window.lexis.settings.get().then((r) => {
      if (r.data && !r.data.firstLaunchDone) {
        setShowWelcome(true)
      }
    })
  }, [])

  useEffect(() => {
    loadMinedPatterns()
  }, [currentSource?.language, patternRefreshKey])

  const loadSources = async () => {
    const result = await window.lexis.media.list()
    if (result.data) {
      setSources(result.data)
      // Load progress for all sources
      const map = new Map<number, ReadingProgress>()
      for (const source of result.data) {
        const progressResult = await window.lexis.reader.getProgress(source.id)
        if (progressResult.data) {
          map.set(source.id, progressResult.data)
        }
      }
      setProgressMap(map)
    }
  }

  const loadDecks = async () => {
    const result = await window.lexis.decks.list()
    if (!result.data) return
    setDecks(result.data)

    const map = new Map<string, MinedCardEntry>()
    for (const deck of result.data) {
      const cardsRes = await window.lexis.cards.all(deck.id)
      if (!cardsRes.data) continue
      for (const card of cardsRes.data) {
        if (isReaderWordHighlightCard(card)) {
          map.set(card.word!.toLowerCase(), { card, deckName: deck.name })
        }
      }
    }
    setAllCardsMap(map)
    console.log('[Lexis] allCardsMap ready:', map.size, 'words', [...map.keys()].slice(0, 5))
  }

  const loadMinedPatterns = async () => {
    const result = await window.lexis.patterns.list(
      currentSource?.language ? { language: currentSource.language } : undefined,
    )
    if (!result.data) return
    setMinedPatterns(result.data)
  }

  const handleImported = async (source: MediaSource) => {
    setShowImport(false)
    await loadSources()
    await handleSelectSource(source)
  }

  const handleSelectSource = async (source: MediaSource) => {
    setActiveView('reader')
    setSource(source)
    clearLookup()
    clearEPUB()
    setSentences([])

    // Load saved progress for this source
    const progressResult = await window.lexis.reader.getProgress(source.id)
    const progress = progressResult.data

    // For EPUB: decode position to get page index
    if (source.type === 'epub' && progress) {
      const { pageIdx } = decodeEpubPosition(progress.position)
      setInitialPosition(pageIdx)
    } else {
      setInitialPosition(progress?.position)
    }
    setInitialChapterId(progress?.chapterId)

    await window.lexis.media.markOpened(source.id)

    if (source.type === 'epub') {
      const chapResult = await window.lexis.reader.loadEPUBChapters(source.id)
      if (chapResult.data) setChapters(chapResult.data)
    } else {
      const sentResult = await window.lexis.reader.loadSubtitleSentences(source.id)
      if (sentResult.data) setSentences(sentResult.data)

      const minedResult = await window.lexis.reader.getMinedWordsForSource(source.id)
      if (minedResult.data) setMinedWords(minedResult.data)
    }
  }

  const handleSelectChapter = async (chapterId: string) => {
    if (!currentSource) return
    selectChapter(chapterId)
    setChapterLoading(true)
    const result = await window.lexis.reader.loadEPUBChapter(currentSource.id, chapterId)
    setChapterLoading(false)
    if (result.data) setChapterHtml(result.data)
  }

  const handleWordClick = (surface: string, dictionaryForm: string) => {
    const lang: Language = currentSource?.language ?? 'ja'
    const isPhraseSelection = isSentenceOrPhraseSelection(surface, selectedSentence?.content)
    debugLog('app', 'lookup-request', {
      surface,
      dictionaryForm,
      lang,
      isPhraseSelection,
      sourceId: currentSource?.id,
      sourceType: currentSource?.type,
      selectedSentence: selectedSentence?.content,
    })
    selectWord(surface)
    if (isPhraseSelection) {
      setSelection(surface, lang)
      return
    }
    lookup(dictionaryForm, lang)
  }

  const handleEpubWordSelect = (word: string) => {
    const lang: Language = currentSource?.language ?? 'ja'
    debugLog('app', 'epub-lookup-request', {
      word,
      lang,
      sourceId: currentSource?.id,
      selectedChapterId,
    })
    handleWordClick(word, word)
  }

  const handleMinePattern = (sentence: Sentence) => {
    const lang: Language = currentSource?.language ?? 'ja'
    debugLog('app', 'reader-mine-pattern', {
      sentence: sentence.content,
      selectedWord,
      lang,
      sourceId: currentSource?.id,
    })
    openPatternBuilder(
      buildPatternDraftFromSentence({
        sentence,
        language: lang,
        target: selectedWord,
        sourceId: currentSource?.id,
      }),
    )
  }

  const handleStartReview = (deckId: number) => {
    const deck = decks.find((d) => d.id === deckId)
    setShowDeckPicker(false)
    setActiveReview({ deckId, deckName: deck?.name ?? 'Deck' })
  }

  const handleEndReview = () => {
    setActiveReview(null)
    loadDecks()
  }

  const handlePatternSaved = () => {
    setPatternRefreshKey((value) => value + 1)
  }

  const handleDeleteSource = async (source: MediaSource) => {
    if (!confirm(`Delete "${source.title}"?\n\nThis will remove the source and its reading progress. Mined cards will not be affected.`)) {
      return
    }
    const result = await window.lexis.media.delete(source.id)
    if (result.error) {
      console.error('Failed to delete source:', result.error)
      return
    }
    // Clear current source if it was the deleted one
    if (currentSource?.id === source.id) {
      setSource(null as unknown as MediaSource)
      setSentences([])
      clearEPUB()
    }
    await loadSources()
  }

  const handleProgressChange = async (position: number, chapterId?: string) => {
    if (!currentSource) return

    let encodedPosition = position

    // For EPUB: encode chapter index + page into position
    if (currentSource.type === 'epub' && chapterId) {
      const chapterIdx = chapters.findIndex((ch) => ch.id === chapterId)
      if (chapterIdx >= 0) {
        encodedPosition = encodeEpubPosition(chapterIdx, position)
      }
    }

    await window.lexis.reader.saveProgress(currentSource.id, encodedPosition, chapterId)
    // Update progress map for sidebar display
    setProgressMap((prev) => {
      const next = new Map(prev)
      next.set(currentSource.id, {
        sourceId: currentSource.id,
        position: encodedPosition,
        chapterId,
        updatedAt: new Date().toISOString(),
      })
      return next
    })
  }

  const handleWelcomeComplete = async () => {
    await window.lexis.settings.set({ firstLaunchDone: true })
    setShowWelcome(false)
  }

  const totalDue = decks.reduce((sum, d) => sum + (d.dueCount ?? 0), 0)
  const isEpub = currentSource?.type === 'epub'

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-gray-100 select-none overflow-hidden">
      <div
        className="h-7 w-full shrink-0 bg-gray-900 border-b border-white/5"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      />

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <Sidebar
          sources={sources}
          currentSourceId={currentSource?.id ?? null}
          totalDue={totalDue}
          progressMap={progressMap}
          onImport={() => setShowImport(true)}
          onSelect={handleSelectSource}
          onDelete={handleDeleteSource}
          onReview={() => setShowDeckPicker(true)}
          onStats={() => setActiveView('stats')}
          onDecks={() => setActiveView('decks')}
          onDrills={() => setActiveView('drills')}
          onSettings={() => setShowSettings(true)}
        />

        <main className="flex-1 min-w-0 overflow-hidden bg-gray-950">
          {activeView === 'reader' && (
            <ReaderPanel
              sentences={sentences}
              language={currentSource?.language ?? 'ja'}
              selectedSentence={selectedSentence}
              selectedWord={selectedWord}
              minedWords={minedWords}
              onSelectSentence={selectSentence}
              onWordClick={handleWordClick}
              onMinePattern={handleMinePattern}
              onProgressChange={handleProgressChange}
              initialPosition={initialPosition}
              initialChapterId={initialChapterId}
              isEpub={isEpub}
              chapters={chapters}
              selectedChapterId={selectedChapterId}
              chapterHtml={chapterHtml}
              chapterLoading={chapterLoading}
              onSelectChapter={handleSelectChapter}
              onEpubWordSelect={handleEpubWordSelect}
              allCardsMap={allCardsMap}
              minedPatterns={minedPatterns}
            />
          )}
          {activeView === 'stats' && (
            <StatsDashboard
              onClose={() => setActiveView('reader')}
              onReview={() => setShowDeckPicker(true)}
              onDrills={() => setActiveView('drills')}
              onMine={() => setActiveView('reader')}
            />
          )}
          {activeView === 'decks' && (
            <DeckBrowser onClose={() => { setActiveView('reader'); loadDecks() }} />
          )}
          {activeView === 'drills' && (
            <PatternDrillPanel
              decks={decks}
              refreshKey={patternRefreshKey}
              onReviewDeck={(deckId) => {
                loadDecks()
                handleStartReview(deckId)
              }}
            />
          )}
        </main>

        {activeView === 'reader' && <LookupPanel />}
      </div>

      <StatusBar />

      {showImport && (
        <ImportModal onImported={handleImported} onClose={() => setShowImport(false)} />
      )}

      {showDeckPicker && (
        <DeckPicker onStart={handleStartReview} onClose={() => setShowDeckPicker(false)} />
      )}

      {activeReview && (
        <ReviewSession
          deckId={activeReview.deckId}
          deckName={activeReview.deckName}
          onEnd={handleEndReview}
        />
      )}

      {showSettings && <SettingsPage onClose={() => setShowSettings(false)} />}

      <CardBuilder onSaved={loadDecks} />
      <PatternBuilder decks={decks} onSaved={handlePatternSaved} />

      {showWelcome && <WelcomeModal onComplete={handleWelcomeComplete} />}
    </div>
  )
}
