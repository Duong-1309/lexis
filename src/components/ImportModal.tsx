import { useCallback, useEffect, useRef, useState } from 'react'
import type { Language, MediaSource } from '../types'

interface Props {
  onImported: (source: MediaSource) => void
  onClose: () => void
}

type ImportMode = 'file' | 'text' | 'web'
type FileImportType = 'subtitle' | 'epub'

const SUBTITLE_EXTS = ['.srt', '.ass', '.ssa']
const EPUB_EXTS = ['.epub']

const LANGUAGES: Array<{ value: Language; label: string }> = [
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'zh', label: '中文' },
  { value: 'ko', label: '한국어' },
  { value: 'fr', label: 'Français' },
  { value: 'es', label: 'Español' },
]

function isAccepted(name: string, type: FileImportType): boolean {
  const exts = type === 'subtitle' ? SUBTITLE_EXTS : EPUB_EXTS
  return exts.some((ext) => name.toLowerCase().endsWith(ext))
}

export function ImportModal({ onImported, onClose }: Props) {
  const [importMode, setImportMode] = useState<ImportMode>('file')
  const [importType, setImportType] = useState<FileImportType>('subtitle')
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [language, setLanguage] = useState<Language>('en')
  const [textTitle, setTextTitle] = useState('')
  const [textContent, setTextContent] = useState('')
  const [webUrl, setWebUrl] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const overlayRef = useRef<HTMLDivElement>(null)
  const dragCounter = useRef(0)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleFile = useCallback(
    async (file: File) => {
      setError(null)
      if (!isAccepted(file.name, importType)) {
        const exts = importType === 'subtitle' ? '.srt, .ass, .ssa' : '.epub'
        setError(`Unsupported file type. Accepted: ${exts}`)
        return
      }
      const filePath = (file as File & { path: string }).path
      if (!filePath) {
        setError('Could not read file path. Try using the Open File button.')
        return
      }
      const result = await window.lexis.media.importFromPath(filePath, language)
      if (result.error) {
        setError(result.error)
        return
      }
      onImported(result.data!)
    },
    [importType, language, onImported],
  )

  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    dragCounter.current++
    setDragging(true)
  }
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    dragCounter.current--
    if (dragCounter.current <= 0) setDragging(false)
  }
  const onDragOver = (e: React.DragEvent) => { e.preventDefault() }
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    dragCounter.current = 0
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) void handleFile(file)
  }

  const onOpenFile = async () => {
    setError(null)
    setSubmitting(true)
    const result = await window.lexis.media.importFile(importType, language)
    setSubmitting(false)
    if (result.error === 'cancelled') return
    if (result.error) { setError(result.error); return }
    onImported(result.data!)
  }

  const onImportText = async () => {
    setError(null)
    setSubmitting(true)
    const result = await window.lexis.media.importText({
      title: textTitle.trim() || 'Pasted Text',
      text: textContent,
      language,
    })
    setSubmitting(false)
    if (result.error) { setError(result.error); return }
    onImported(result.data!)
  }

  const onImportUrl = async () => {
    setError(null)
    setSubmitting(true)
    const result = await window.lexis.media.importUrl(webUrl.trim(), language)
    setSubmitting(false)
    if (result.error) { setError(result.error); return }
    onImported(result.data!)
  }

  const onClickOverlay = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose()
  }

  const extLabel = importType === 'subtitle' ? '.srt · .ass · .ssa' : '.epub'
  const dropLabel = importType === 'subtitle' ? 'Drop subtitle file here' : 'Drop EPUB file here'

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClickOverlay}
    >
      <div className="relative w-[520px] bg-gray-900 border border-white/10 rounded-xl shadow-2xl p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-semibold text-gray-100">Import</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 transition-colors p-1 rounded"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Source toggle */}
        <div className="flex bg-gray-800 rounded-lg p-1 mb-4">
          {(['file', 'text', 'web'] as ImportMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => { setImportMode(mode); setError(null) }}
              className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
                importMode === mode
                  ? 'bg-gray-700 text-gray-100'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {mode === 'file' ? 'File' : mode === 'text' ? 'Paste Text' : 'Web URL'}
            </button>
          ))}
        </div>

        {importMode === 'file' && (
          <div className="flex bg-gray-950 rounded-lg p-1 mb-4">
            {(['subtitle', 'epub'] as FileImportType[]).map((t) => (
              <button
                key={t}
                onClick={() => { setImportType(t); setError(null) }}
                className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  importType === t
                    ? 'bg-gray-800 text-gray-100'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                {t === 'subtitle' ? 'Subtitle' : 'EPUB'}
              </button>
            ))}
          </div>
        )}

        {/* Language selector */}
        <div className="mb-4">
          <label className="block text-xs text-gray-500 mb-1.5">Language</label>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as Language)}
            className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
          >
            {LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>{l.label}</option>
            ))}
          </select>
        </div>

        {importMode === 'file' && (
          <>
            {/* Drop zone */}
            <div
              onDragEnter={onDragEnter}
              onDragLeave={onDragLeave}
              onDragOver={onDragOver}
              onDrop={onDrop}
              className={`
                flex flex-col items-center justify-center gap-3
                border-2 border-dashed rounded-lg
                h-44 cursor-default select-none transition-colors
                ${dragging
                  ? 'border-blue-400 bg-blue-500/10 text-blue-300'
                  : 'border-white/15 hover:border-white/25 text-gray-400'
                }
              `}
            >
              <svg
                className={`w-10 h-10 transition-colors ${dragging ? 'text-blue-400' : 'text-gray-600'}`}
                fill="none" stroke="currentColor" viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-sm font-medium">
                {dragging ? 'Drop here' : dropLabel}
              </p>
              <p className="text-xs text-gray-600">{extLabel}</p>
            </div>

            {/* Divider */}
            <div className="flex items-center gap-3 my-4">
              <div className="flex-1 h-px bg-white/10" />
              <span className="text-xs text-gray-600">or</span>
              <div className="flex-1 h-px bg-white/10" />
            </div>

            {/* Open button */}
            <button
              onClick={onOpenFile}
              disabled={submitting}
              className="w-full py-2.5 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-50"
            >
              {submitting ? 'Importing...' : 'Choose file...'}
            </button>
          </>
        )}

        {importMode === 'text' && (
          <div className="space-y-3">
            <input
              value={textTitle}
              onChange={(e) => setTextTitle(e.target.value)}
              className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-blue-500"
              placeholder="Title"
            />
            <textarea
              value={textContent}
              onChange={(e) => setTextContent(e.target.value)}
              className="w-full h-44 bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder:text-gray-600 resize-none focus:outline-none focus:border-blue-500"
              placeholder="Paste text here"
            />
            <button
              onClick={onImportText}
              disabled={submitting || !textContent.trim()}
              className="w-full py-2.5 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-50"
            >
              {submitting ? 'Importing...' : 'Import text'}
            </button>
          </div>
        )}

        {importMode === 'web' && (
          <div className="space-y-3">
            <input
              value={webUrl}
              onChange={(e) => setWebUrl(e.target.value)}
              className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-blue-500"
              placeholder="https://example.com/article"
            />
            <button
              onClick={onImportUrl}
              disabled={submitting || !webUrl.trim()}
              className="w-full py-2.5 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-50"
            >
              {submitting ? 'Importing...' : 'Import URL'}
            </button>
          </div>
        )}

        {error && (
          <p className="mt-3 text-xs text-red-400 text-center">{error}</p>
        )}

        <p className="mt-3 text-xs text-gray-600 text-center">
          {importMode === 'text'
            ? 'Pasted text is split into readable sentences for mining.'
            : importMode === 'web'
              ? 'Readable article text is extracted and stored locally.'
              : importType === 'subtitle'
            ? 'Supports SubRip (.srt) and Advanced SubStation (.ass/.ssa)'
            : 'Supports EPUB 2 and EPUB 3. DRM-protected files cannot be opened.'}
        </p>
      </div>
    </div>
  )
}
