import { useEffect, useState, useRef } from 'react'
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
import type { MediaSource, Language, Deck, Card, Sentence, Pattern, ReadingProgress, Collection } from './types'

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

function formatSourceTooltip(source: MediaSource): string {
  const lines: string[] = [source.title]

  if (source.wordCount) {
    lines.push(`${source.wordCount.toLocaleString()} words`)
  }

  if (source.sourceUrl) {
    lines.push(source.sourceUrl)
  }

  if (source.addedAt) {
    const date = new Date(source.addedAt)
    lines.push(`Added: ${date.toLocaleDateString()}`)
  }

  if (source.lastOpened) {
    const date = new Date(source.lastOpened)
    lines.push(`Last opened: ${date.toLocaleDateString()}`)
  }

  return lines.join('\n')
}

function ConfirmDeleteDialog({
  source,
  onConfirm,
  onCancel,
}: {
  source: MediaSource
  onConfirm: () => void
  onCancel: () => void
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
      if (e.key === 'Enter') onConfirm()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onConfirm, onCancel])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-800 border border-white/10 rounded-xl shadow-2xl w-full max-w-sm mx-4 p-5">
        <h3 className="text-base font-semibold text-gray-100 mb-2">Delete source?</h3>
        <p className="text-sm text-gray-400 mb-1">
          <span className="text-gray-200 font-medium">{source.title}</span>
        </p>
        <p className="text-xs text-gray-500 mb-5">
          This will remove the source and reading progress. Mined cards will not be affected.
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-gray-300 hover:text-gray-100 hover:bg-white/10 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

function SourceDetailsModal({
  source,
  progress,
  folderName,
  onClose,
  onDelete,
  onRename,
}: {
  source: MediaSource
  progress?: ReadingProgress
  folderName?: string
  onClose: () => void
  onDelete: () => void
  onRename: (newTitle: string) => void
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(source.title)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isEditing) {
          setIsEditing(false)
          setEditTitle(source.title)
        } else {
          onClose()
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, isEditing, source.title])

  const handleSaveTitle = async () => {
    const trimmed = editTitle.trim()
    if (trimmed && trimmed !== source.title) {
      const result = await window.lexis.media.rename(source.id, trimmed)
      if (!result.error) {
        onRename(trimmed)
      }
    }
    setIsEditing(false)
  }

  const percent = progress ? getReadingPercent(source, progress) : 0
  const typeLabels: Record<string, string> = {
    subtitle: 'Subtitle',
    epub: 'EPUB Book',
    web: 'Web Article',
    text: 'Plain Text',
    youtube: 'YouTube',
  }
  const langLabels: Record<string, string> = {
    en: 'English',
    ja: 'Japanese',
    zh: 'Chinese',
    ko: 'Korean',
    fr: 'French',
    es: 'Spanish',
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-gray-800 border border-white/10 rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-white/5">
          {isEditing ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveTitle()
                }}
                autoFocus
                className="flex-1 px-2 py-1 text-base font-semibold bg-gray-700 border border-white/10 rounded text-gray-100 outline-none focus:border-blue-500"
              />
              <button
                onClick={handleSaveTitle}
                className="p-1.5 text-green-400 hover:bg-green-500/10 rounded transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </button>
              <button
                onClick={() => { setIsEditing(false); setEditTitle(source.title) }}
                className="p-1.5 text-gray-400 hover:bg-white/5 rounded transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 group">
              <h3 className="text-base font-semibold text-gray-100 truncate flex-1">{source.title}</h3>
              <button
                onClick={() => setIsEditing(true)}
                className="p-1 text-gray-500 hover:text-gray-300 hover:bg-white/5 rounded opacity-0 group-hover:opacity-100 transition-all"
                title="Rename"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </button>
            </div>
          )}
          <p className="text-xs text-gray-500 mt-0.5">
            {typeLabels[source.type] || source.type} · {langLabels[source.language] || source.language.toUpperCase()}
          </p>
        </div>

        <div className="px-5 py-4 space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500">Folder</span>
            <span className="text-gray-300">{folderName || 'Uncategorized'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Content</span>
            <span className="text-gray-300">
              {source.sentenceCount ?? 0} {source.type === 'epub' ? 'chapters' : 'sentences'}
              {source.wordCount ? ` · ${source.wordCount.toLocaleString()} words` : ''}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Progress</span>
            <span className={percent >= 100 ? 'text-green-400' : 'text-gray-300'}>{percent}%</span>
          </div>
          {source.addedAt && (
            <div className="flex justify-between">
              <span className="text-gray-500">Added</span>
              <span className="text-gray-300">{new Date(source.addedAt).toLocaleDateString()}</span>
            </div>
          )}
          {source.lastOpened && (
            <div className="flex justify-between">
              <span className="text-gray-500">Last opened</span>
              <span className="text-gray-300">{new Date(source.lastOpened).toLocaleDateString()}</span>
            </div>
          )}
          {source.sourceUrl && (
            <div className="flex flex-col gap-1">
              <span className="text-gray-500">Source URL</span>
              <a
                href={source.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300 text-xs truncate"
              >
                {source.sourceUrl}
              </a>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/5 flex justify-between">
          <button
            onClick={onDelete}
            className="px-3 py-1.5 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded transition-colors"
          >
            Delete
          </button>
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

function ContentHeader({
  source,
  isEditing,
  editingTitle,
  onStartRename,
  onFinishRename,
  onCancelRename,
  onEditingTitleChange,
  onDelete,
}: {
  source: MediaSource
  isEditing: boolean
  editingTitle: string
  onStartRename: () => void
  onFinishRename: () => void
  onCancelRename: () => void
  onEditingTitleChange: (title: string) => void
  onDelete: () => void
}) {
  const label = mediaTypeLabel(source)

  return (
    <div className="shrink-0 flex items-center gap-3 px-4 py-2 border-b border-white/5 bg-gray-900/50">
      {isEditing ? (
        <input
          type="text"
          value={editingTitle}
          onChange={(e) => onEditingTitleChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onFinishRename()
            if (e.key === 'Escape') onCancelRename()
          }}
          onBlur={onFinishRename}
          autoFocus
          className="flex-1 px-2 py-1 text-sm bg-gray-800 border border-blue-500 rounded text-gray-100 outline-none"
        />
      ) : (
        <>
          <h1 className="flex-1 min-w-0 text-sm font-medium text-gray-200 truncate">
            {source.title}
          </h1>
          {label && (
            <span className="shrink-0 text-[10px] bg-purple-600/30 text-purple-300 px-1.5 py-0.5 rounded">
              {label}
            </span>
          )}
          <span className="text-xs text-gray-500">
            {source.language.toUpperCase()}
          </span>
          <div className="flex items-center gap-1 ml-2">
            <button
              onClick={onStartRename}
              className="p-1.5 rounded hover:bg-white/10 text-gray-500 hover:text-gray-300 transition-colors"
              title="Rename"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            <button
              onClick={onDelete}
              className="p-1.5 rounded hover:bg-red-600/20 text-gray-500 hover:text-red-400 transition-colors"
              title="Delete"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function Sidebar({
  sources,
  currentSourceId,
  totalDue,
  progressMap,
  collapsed,
  onToggleCollapse,
  onImport,
  onSelect,
  onReview,
  onStats,
  onDecks,
  onDrills,
  onSettings,
  onSourcesChange,
}: {
  sources: MediaSource[]
  currentSourceId: number | null
  totalDue: number
  progressMap: Map<number, ReadingProgress>
  collapsed: boolean
  onToggleCollapse: () => void
  onImport: () => void
  onSelect: (source: MediaSource) => void
  onReview: () => void
  onStats: () => void
  onDecks: () => void
  onDrills: () => void
  onSettings: () => void
  onSourcesChange: () => void
}) {
  const [collections, setCollections] = useState<Collection[]>([])
  const [selectedFolder, setSelectedFolder] = useState<{ id: number | 'all' | 'uncategorized'; name: string } | null>(null)
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [menuSourceId, setMenuSourceId] = useState<number | null>(null)
  const [hoveredSource, setHoveredSource] = useState<{ source: MediaSource; y: number } | null>(null)
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState<string>('all')
  const [filterLang, setFilterLang] = useState<string>('all')
  const [showFilters, setShowFilters] = useState(false)
  // Source details modal
  const [detailsSource, setDetailsSource] = useState<MediaSource | null>(null)
  // Bulk selection
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<number>>(new Set())
  const [bulkMode, setBulkMode] = useState(false)

  useEffect(() => {
    window.lexis.collections.list().then((res) => {
      if (res.data) setCollections(res.data)
    })
  }, [])

  useEffect(() => {
    if (!menuSourceId) return
    const handler = () => setMenuSourceId(null)
    window.addEventListener('click', handler)
    return () => window.removeEventListener('click', handler)
  }, [menuSourceId])

  const handleMouseEnter = (source: MediaSource, e: React.MouseEvent) => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const y = rect.top
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredSource({ source, y })
    }, 300)
  }

  const handleMouseLeave = () => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
    setHoveredSource(null)
  }

  const handleCreateFolder = async () => {
    const name = newFolderName.trim()
    if (!name) return
    if (collections.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      alert('A folder with this name already exists')
      return
    }
    const result = await window.lexis.collections.create(name)
    if (result.data) {
      setCollections([...collections, result.data])
    }
    setNewFolderName('')
    setCreatingFolder(false)
  }

  const handleDeleteFolder = async (id: number) => {
    if (!confirm('Delete this folder? Sources will be moved to Uncategorized.')) return
    await window.lexis.collections.delete(id)
    setCollections(collections.filter((c) => c.id !== id))
    onSourcesChange()
  }

  const handleMoveSource = async (sourceId: number, collectionId: number | null) => {
    await window.lexis.media.moveToCollection(sourceId, collectionId)
    onSourcesChange()
    setMenuSourceId(null)
  }

  // Bulk operations
  const toggleSourceSelection = (id: number) => {
    setSelectedSourceIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAllVisible = () => {
    setSelectedSourceIds(new Set(filteredSources.map(s => s.id)))
  }

  const clearSelection = () => {
    setSelectedSourceIds(new Set())
    setBulkMode(false)
  }

  const handleBulkDelete = async () => {
    if (selectedSourceIds.size === 0) return
    if (!confirm(`Delete ${selectedSourceIds.size} source(s)?`)) return
    for (const id of selectedSourceIds) {
      await window.lexis.media.delete(id)
    }
    clearSelection()
    onSourcesChange()
  }

  const handleBulkMove = async (collectionId: number | null) => {
    if (selectedSourceIds.size === 0) return
    for (const id of selectedSourceIds) {
      await window.lexis.media.moveToCollection(id, collectionId)
    }
    clearSelection()
    onSourcesChange()
  }

  const getSourceCount = (folderId: number | 'all' | 'uncategorized') => {
    if (folderId === 'all') return sources.length
    if (folderId === 'uncategorized') return sources.filter((s) => !s.collectionId).length
    return sources.filter((s) => s.collectionId === folderId).length
  }

  const filteredSources = selectedFolder
    ? sources.filter((s) => {
        // Folder filter
        if (selectedFolder.id === 'all') { /* pass */ }
        else if (selectedFolder.id === 'uncategorized') { if (s.collectionId) return false }
        else if (s.collectionId !== selectedFolder.id) return false
        // Search filter
        if (searchQuery && !s.title.toLowerCase().includes(searchQuery.toLowerCase())) return false
        // Type filter
        if (filterType !== 'all' && s.type !== filterType) return false
        // Language filter
        if (filterLang !== 'all' && s.language !== filterLang) return false
        return true
      })
    : []

  // Collapsed sidebar - icons only (macOS HIG: 64-72px)
  if (collapsed) {
    return (
      <div className="flex flex-col w-16 shrink-0 bg-gray-900 border-r border-white/5 transition-all duration-200">
        {/* Expand button - HIG: 28px */}
        <button
          onClick={onToggleCollapse}
          className="h-7 mx-2 mt-1 flex items-center justify-center text-gray-500 hover:text-gray-300 hover:bg-white/5 rounded-md transition-colors"
          title="Expand sidebar (⌘B)"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
          </svg>
        </button>

        {/* Main actions - HIG: 28px */}
        <div className="flex-1 px-2 py-1">
          <button onClick={onImport} className="w-full h-7 flex items-center justify-center text-blue-400 hover:bg-white/5 rounded-md transition-colors" title="Import">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
          <button onClick={onReview} className="w-full h-7 flex items-center justify-center text-gray-400 hover:text-gray-200 hover:bg-white/5 rounded-md transition-colors relative" title="Review">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            {totalDue > 0 && (
              <span className="absolute -top-0.5 -right-0.5 text-[9px] font-bold bg-blue-500 text-white min-w-[16px] h-4 px-1 rounded-full flex items-center justify-center">
                {totalDue > 99 ? '99' : totalDue}
              </span>
            )}
          </button>

          <div className="my-1 border-t border-white/5" />

          <button onClick={() => { setSelectedFolder({ id: 'all', name: 'All Sources' }); onToggleCollapse() }} className="w-full h-7 flex items-center justify-center text-gray-400 hover:text-gray-200 hover:bg-white/5 rounded-md transition-colors" title="Library">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
          </button>
        </div>

        {/* Bottom icons - HIG: 28px */}
        <div className="px-2 py-1 border-t border-white/5">
          <button onClick={onStats} className="w-full h-7 flex items-center justify-center text-gray-500 hover:text-gray-300 hover:bg-white/5 rounded-md transition-colors" title="Stats">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </button>
          <button onClick={onDecks} className="w-full h-7 flex items-center justify-center text-gray-500 hover:text-gray-300 hover:bg-white/5 rounded-md transition-colors" title="Browse Decks">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </button>
          <button onClick={onDrills} className="w-full h-7 flex items-center justify-center text-gray-500 hover:text-gray-300 hover:bg-white/5 rounded-md transition-colors" title="Pattern Drills">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </button>
          <button onClick={onSettings} className="w-full h-7 flex items-center justify-center text-gray-500 hover:text-gray-300 hover:bg-white/5 rounded-md transition-colors" title="Settings">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
      </div>
    )
  }

  // Expanded sidebar - simplified layout
  return (
    <div className="flex flex-col w-56 shrink-0 bg-gray-900 border-r border-white/5 transition-all duration-200">
      {/* Header: Navigation + Actions */}
      <div className="shrink-0 px-2 pt-2 pb-1 border-b border-white/5">
        <div className="flex items-center gap-1">
          {selectedFolder ? (
            /* Back button when in folder */
            <button
              onClick={() => {
                setSelectedFolder(null)
                setSearchQuery('')
                setFilterType('all')
                setFilterLang('all')
                setShowFilters(false)
                clearSelection()
              }}
              className="flex-1 h-7 flex items-center gap-1.5 px-2 text-[13px] text-gray-300 hover:bg-white/5 rounded-md transition-colors"
            >
              <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              <span className="truncate font-medium">{selectedFolder.name}</span>
              <span className="text-[11px] text-gray-500 ml-auto">{filteredSources.length}</span>
            </button>
          ) : (
            /* Library title at root */
            <span className="flex-1 px-2 text-[13px] font-medium text-gray-400">Library</span>
          )}
          {/* Action buttons */}
          <button
            onClick={onImport}
            className="h-7 w-7 flex items-center justify-center text-blue-400 hover:bg-blue-600/20 rounded-md transition-colors"
            title="Import"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
          <button
            onClick={onToggleCollapse}
            className="h-7 w-7 flex items-center justify-center text-gray-500 hover:text-gray-300 hover:bg-white/5 rounded-md transition-colors"
            title="Collapse (⌘B)"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7M18 19l-7-7 7-7" />
            </svg>
          </button>
        </div>

        {/* Search - only when in folder */}
        {selectedFolder && (
          <div className="mt-1.5 flex items-center gap-1">
            <div className="flex-1 relative">
              <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search..."
                className="w-full h-6 pl-7 pr-2 text-[12px] bg-gray-800 border border-white/10 rounded text-gray-100 placeholder-gray-500 outline-none focus:border-blue-500"
              />
            </div>
            <button
              onClick={() => setBulkMode(!bulkMode)}
              className={`h-6 w-6 flex items-center justify-center rounded transition-colors ${bulkMode ? 'bg-blue-600/20 text-blue-400' : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'}`}
              title="Select multiple"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </button>
          </div>
        )}

        {/* Bulk actions bar */}
        {bulkMode && selectedSourceIds.size > 0 && (
          <div className="mt-1.5 flex items-center justify-between text-[11px]">
            <span className="text-gray-400">{selectedSourceIds.size} selected</span>
            <div className="flex items-center gap-2">
              <button onClick={selectAllVisible} className="text-blue-400 hover:text-blue-300">All</button>
              <button onClick={handleBulkDelete} className="text-red-400 hover:text-red-300">Delete</button>
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {!selectedFolder ? (
          /* Folders view */
          <div className="py-1">
            {/* All Sources */}
            <button
              onClick={() => setSelectedFolder({ id: 'all', name: 'All Sources' })}
              className="w-full h-7 flex items-center justify-between px-3 text-[13px] text-gray-300 hover:bg-white/5 transition-colors"
            >
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                <span>All Sources</span>
              </div>
              <span className="text-[11px] text-gray-500">{getSourceCount('all')}</span>
            </button>

            {/* User folders */}
            {collections.map((collection) => (
              <button
                key={collection.id}
                onClick={() => setSelectedFolder({ id: collection.id, name: collection.name })}
                className="group w-full h-7 flex items-center justify-between px-3 text-[13px] text-gray-300 hover:bg-white/5 transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <svg className="w-4 h-4 text-yellow-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                  <span className="truncate">{collection.name}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDeleteFolder(collection.id)
                    }}
                    className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-white/10 text-gray-500 hover:text-red-400 transition-all cursor-pointer"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </span>
                  <span className="text-[11px] text-gray-500">{getSourceCount(collection.id)}</span>
                </div>
              </button>
            ))}

            {/* Uncategorized */}
            <button
              onClick={() => setSelectedFolder({ id: 'uncategorized', name: 'Uncategorized' })}
              className="w-full h-7 flex items-center justify-between px-3 text-[13px] text-gray-400 hover:bg-white/5 transition-colors"
            >
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                </svg>
                <span>Uncategorized</span>
              </div>
              <span className="text-[11px] text-gray-500">{getSourceCount('uncategorized')}</span>
            </button>

            {/* New Folder */}
            {creatingFolder ? (
              <div className="px-3 h-7 flex items-center">
                <input
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateFolder()
                    if (e.key === 'Escape') {
                      setCreatingFolder(false)
                      setNewFolderName('')
                    }
                  }}
                  onBlur={() => {
                    if (!newFolderName.trim()) setCreatingFolder(false)
                  }}
                  placeholder="Folder name..."
                  autoFocus
                  className="w-full h-[22px] px-2 text-[13px] bg-gray-800 border border-blue-500 rounded text-gray-100 placeholder-gray-500 outline-none"
                />
              </div>
            ) : (
              <button
                onClick={() => setCreatingFolder(true)}
                className="w-full h-7 flex items-center gap-2 px-3 text-[13px] text-gray-500 hover:text-gray-300 hover:bg-white/5 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <span>New Folder</span>
              </button>
            )}
          </div>
        ) : (
          /* Sources view - list only (search/filter moved to header) */
          <div className="py-1">
            {filteredSources.length === 0 ? (
              <p className="text-xs text-gray-500 px-4 py-3">
                {searchQuery || filterType !== 'all' || filterLang !== 'all'
                  ? 'No sources match filters'
                  : 'No sources in this folder'}
              </p>
            ) : (
              filteredSources.map((source) => {
                const label = mediaTypeLabel(source)
                const progress = progressMap.get(source.id)
                const percent = getReadingPercent(source, progress)
                const isSelected = currentSourceId === source.id
                const isBulkSelected = selectedSourceIds.has(source.id)
                return (
                  <div
                    key={source.id}
                    className={`group relative flex items-center px-3 py-2 transition-colors hover:bg-white/5 ${
                      isSelected ? 'bg-blue-600/10' : ''
                    } ${isBulkSelected ? 'bg-blue-500/10' : ''}`}
                  >
                    {/* Bulk select checkbox */}
                    {bulkMode && (
                      <button
                        onClick={() => toggleSourceSelection(source.id)}
                        className="shrink-0 mr-2 w-4 h-4 rounded border border-white/20 flex items-center justify-center hover:border-blue-400 transition-colors"
                      >
                        {isBulkSelected && (
                          <svg className="w-3 h-3 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        )}
                      </button>
                    )}
                    <button
                      onClick={() => bulkMode ? toggleSourceSelection(source.id) : onSelect(source)}
                      onMouseEnter={(e) => handleMouseEnter(source, e)}
                      onMouseLeave={handleMouseLeave}
                      className="flex-1 text-left min-w-0"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className={`truncate font-medium text-sm ${isSelected ? 'text-blue-400' : 'text-gray-300'}`}>
                          {source.title}
                        </span>
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
                      {percent > 0 && (
                        <div className="mt-1.5 h-0.5 bg-gray-700 rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all ${percent >= 100 ? 'bg-green-500' : 'bg-blue-500'}`}
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                      )}
                    </button>

                    {/* Move menu button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setMenuSourceId(menuSourceId === source.id ? null : source.id)
                      }}
                      className="shrink-0 p-1 ml-1 rounded opacity-0 group-hover:opacity-100 hover:bg-white/10 text-gray-500 hover:text-gray-300 transition-all"
                    >
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                      </svg>
                    </button>

                    {/* Context menu */}
                    {menuSourceId === source.id && (
                      <div className="absolute right-2 top-full mt-1 w-40 bg-gray-800 border border-white/10 rounded-lg shadow-xl z-30 py-1">
                        <button
                          onClick={() => { setDetailsSource(source); setMenuSourceId(null) }}
                          className="w-full px-3 py-1.5 text-left text-xs text-gray-300 hover:bg-white/10 flex items-center gap-2"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          Details
                        </button>
                        <div className="border-t border-white/5 my-1" />
                        <div className="px-2 py-1 text-[10px] text-gray-500 uppercase tracking-wider">Move to</div>
                        <button
                          onClick={() => handleMoveSource(source.id, null)}
                          className={`w-full px-3 py-1.5 text-left text-xs hover:bg-white/10 ${
                            !source.collectionId ? 'text-blue-400' : 'text-gray-300'
                          }`}
                        >
                          Uncategorized
                        </button>
                        {collections.map((c) => (
                          <button
                            key={c.id}
                            onClick={() => handleMoveSource(source.id, c.id)}
                            className={`w-full px-3 py-1.5 text-left text-xs hover:bg-white/10 truncate ${
                              source.collectionId === c.id ? 'text-blue-400' : 'text-gray-300'
                            }`}
                          >
                            📁 {c.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        )}
      </div>

      {/* Bottom nav buttons - HIG: 28px height */}
      <div className="p-2 border-t border-white/5 space-y-0.5">
        <button
          onClick={onReview}
          className="w-full h-7 flex items-center justify-between px-3 text-[13px] text-gray-300 hover:bg-white/5 rounded-md transition-colors"
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
            <span className="text-[11px] font-semibold bg-blue-500 text-white px-1.5 rounded-full leading-5">
              {totalDue}
            </span>
          )}
        </button>
        <button
          onClick={onStats}
          className="w-full h-7 flex items-center gap-2 px-3 text-[13px] text-gray-500 hover:text-gray-300 hover:bg-white/5 rounded-md transition-colors"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          Stats
        </button>
        <button
          onClick={onDecks}
          className="w-full h-7 flex items-center gap-2 px-3 text-[13px] text-gray-500 hover:text-gray-300 hover:bg-white/5 rounded-md transition-colors"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          Browse Decks
        </button>
        <button
          onClick={onDrills}
          className="w-full h-7 flex items-center gap-2 px-3 text-[13px] text-gray-500 hover:text-gray-300 hover:bg-white/5 rounded-md transition-colors"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          Drills
        </button>
        <button
          onClick={onSettings}
          className="w-full h-7 flex items-center gap-2 px-3 text-[13px] text-gray-500 hover:text-gray-300 hover:bg-white/5 rounded-md transition-colors"
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

      {/* Source tooltip */}
      {hoveredSource && (
        <div
          className="fixed z-50 w-56 bg-gray-800 border border-white/10 rounded-lg shadow-xl p-2.5 pointer-events-none"
          style={{ left: 216, top: Math.min(hoveredSource.y, window.innerHeight - 120) }}
        >
          <p className="text-xs font-medium text-gray-200 truncate mb-1">{hoveredSource.source.title}</p>
          {hoveredSource.source.wordCount && (
            <p className="text-[11px] text-gray-400">{hoveredSource.source.wordCount.toLocaleString()} words</p>
          )}
          {hoveredSource.source.sourceUrl && (
            <p className="text-[11px] text-gray-500 truncate">{hoveredSource.source.sourceUrl}</p>
          )}
          <div className="flex gap-3 mt-1.5 text-[10px] text-gray-500">
            {hoveredSource.source.addedAt && (
              <span>Added: {new Date(hoveredSource.source.addedAt).toLocaleDateString()}</span>
            )}
            {hoveredSource.source.lastOpened && (
              <span>Opened: {new Date(hoveredSource.source.lastOpened).toLocaleDateString()}</span>
            )}
          </div>
        </div>
      )}

      {/* Source details modal */}
      {detailsSource && (
        <SourceDetailsModal
          source={detailsSource}
          progress={progressMap.get(detailsSource.id)}
          folderName={collections.find(c => c.id === detailsSource.collectionId)?.name}
          onClose={() => setDetailsSource(null)}
          onDelete={() => {
            if (confirm(`Delete "${detailsSource.title}"?`)) {
              window.lexis.media.delete(detailsSource.id).then(() => {
                setDetailsSource(null)
                onSourcesChange()
              })
            }
          }}
          onRename={(newTitle) => {
            setDetailsSource({ ...detailsSource, title: newTitle })
            onSourcesChange()
          }}
        />
      )}
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
  const [editingSourceId, setEditingSourceId] = useState<number | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [pendingDelete, setPendingDelete] = useState<MediaSource | null>(null)
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
  const [readerSettings, setReaderSettings] = useState({ fontSize: 16, lineHeight: 1.9, fontFamily: 'sans-serif' })
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  useHotkeys({
    enabled:
      activeView === 'reader' &&
      !activeReview &&
      !showImport &&
      !showDeckPicker &&
      !showSettings &&
      !patternBuilderOpen,
  })

  // Cmd+B to toggle sidebar
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault()
        setSidebarCollapsed(prev => !prev)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    loadSources()
    loadDecks()
    // Check if first launch and load reader settings
    window.lexis.settings.get().then((r) => {
      if (r.data) {
        if (!r.data.firstLaunchDone) {
          setShowWelcome(true)
        }
        setReaderSettings({
          fontSize: r.data.readerFontSize,
          lineHeight: r.data.readerLineHeight,
          fontFamily: r.data.readerFont,
        })
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

  const handleDeleteSource = (source: MediaSource) => {
    setPendingDelete(source)
  }

  const confirmDelete = async () => {
    if (!pendingDelete) return
    const result = await window.lexis.media.delete(pendingDelete.id)
    if (result.error) {
      console.error('Failed to delete source:', result.error)
      setPendingDelete(null)
      return
    }
    if (currentSource?.id === pendingDelete.id) {
      setSource(null as unknown as MediaSource)
      setSentences([])
      clearEPUB()
    }
    setPendingDelete(null)
    await loadSources()
  }

  const handleStartRename = (source: MediaSource) => {
    setEditingSourceId(source.id)
    setEditingTitle(source.title)
  }

  const handleFinishRename = async () => {
    if (!editingSourceId) return
    const trimmed = editingTitle.trim()
    const source = sources.find(s => s.id === editingSourceId)
    if (!trimmed || trimmed === source?.title) {
      setEditingSourceId(null)
      setEditingTitle('')
      return
    }
    const result = await window.lexis.media.rename(editingSourceId, trimmed)
    if (result.error) {
      console.error('Failed to rename source:', result.error)
    } else {
      await loadSources()
    }
    setEditingSourceId(null)
    setEditingTitle('')
  }

  const handleCancelRename = () => {
    setEditingSourceId(null)
    setEditingTitle('')
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
      {/* macOS-style title bar: 38px standard with toolbar */}
      <div
        className="h-[38px] w-full shrink-0 bg-gray-900 border-b border-white/5"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      />

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <Sidebar
          sources={sources}
          currentSourceId={currentSource?.id ?? null}
          totalDue={totalDue}
          progressMap={progressMap}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
          onImport={() => setShowImport(true)}
          onSelect={handleSelectSource}
          onReview={() => setShowDeckPicker(true)}
          onStats={() => setActiveView('stats')}
          onDecks={() => setActiveView('decks')}
          onDrills={() => setActiveView('drills')}
          onSettings={() => setShowSettings(true)}
          onSourcesChange={loadSources}
        />

        <main className="flex-1 min-w-0 overflow-hidden bg-gray-950 flex flex-col">
          {activeView === 'reader' && currentSource && (
            <ContentHeader
              source={currentSource}
              isEditing={editingSourceId === currentSource.id}
              editingTitle={editingTitle}
              onStartRename={() => handleStartRename(currentSource)}
              onFinishRename={handleFinishRename}
              onCancelRename={handleCancelRename}
              onEditingTitleChange={setEditingTitle}
              onDelete={() => handleDeleteSource(currentSource)}
            />
          )}
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
              readerSettings={readerSettings}
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

      {showSettings && <SettingsPage onClose={() => {
        setShowSettings(false)
        // Reload reader settings
        window.lexis.settings.get().then((r) => {
          if (r.data) {
            setReaderSettings({
              fontSize: r.data.readerFontSize,
              lineHeight: r.data.readerLineHeight,
              fontFamily: r.data.readerFont,
            })
          }
        })
      }} />}

      <CardBuilder onSaved={loadDecks} />
      <PatternBuilder decks={decks} onSaved={handlePatternSaved} />

      {showWelcome && <WelcomeModal onComplete={handleWelcomeComplete} />}

      {pendingDelete && (
        <ConfirmDeleteDialog
          source={pendingDelete}
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  )
}
