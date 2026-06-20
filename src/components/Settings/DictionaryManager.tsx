import { useEffect, useState } from 'react'
import type { DictionaryInfo, DictionaryDownloadProgress } from '../../types'

export function DictionaryManager() {
  const [dictionaries, setDictionaries] = useState<DictionaryInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [progress, setProgress] = useState<Record<string, number>>({})
  const [stage, setStage] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  const loadDictionaries = async () => {
    const result = await window.lexis.dictionary.listDictionaries()
    setLoading(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setDictionaries(result.data ?? [])
  }

  useEffect(() => {
    loadDictionaries()

    window.lexis.dictionary.onDownloadProgress((prog: DictionaryDownloadProgress) => {
      setProgress((prev) => ({ ...prev, [prog.id]: prog.progress }))
      if (prog.stage) {
        setStage((prev) => ({ ...prev, [prog.id]: prog.stage! }))
      }
    })

    return () => {
      window.lexis.dictionary.removeDownloadListeners()
    }
  }, [])

  const handleDownload = async (id: string) => {
    setDownloading(id)
    setProgress((prev) => ({ ...prev, [id]: 0 }))
    setError(null)

    const result = await window.lexis.dictionary.downloadDictionary(id as any)
    setDownloading(null)

    if (result.error) {
      setError(result.error)
      return
    }

    await loadDictionaries()
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this dictionary? You can download it again later.')) return

    const result = await window.lexis.dictionary.deleteDictionary(id as any)
    if (result.error) {
      setError(result.error)
      return
    }

    await loadDictionaries()
  }

  if (loading) {
    return <div className="text-gray-500 text-sm">Loading dictionaries...</div>
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-200">Dictionary Downloads</h3>
        <span className="text-xs text-gray-500">
          {dictionaries.filter((d) => d.downloaded).length}/{dictionaries.length} installed
        </span>
      </div>

      {error && (
        <div className="text-red-400 text-xs bg-red-900/20 rounded p-2">{error}</div>
      )}

      <div className="space-y-2">
        {dictionaries.map((dict) => (
          <div
            key={dict.id}
            className="bg-gray-800 rounded-lg p-3 flex items-center gap-3"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-200">{dict.name}</span>
                {dict.downloaded && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                    dict.source === 'bundled'
                      ? 'bg-purple-500/20 text-purple-400'
                      : 'bg-green-500/20 text-green-400'
                  }`}>
                    {dict.source === 'bundled' ? 'Bundled' : 'Installed'}
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500 mt-0.5">{dict.description}</p>
              <p className="text-xs text-gray-600 mt-0.5">{dict.sizeFormatted}</p>
            </div>

            <div className="shrink-0">
              {downloading === dict.id ? (
                <div className="w-32">
                  <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all"
                      style={{ width: `${progress[dict.id] ?? 0}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-gray-500 text-center mt-1 truncate">
                    {stage[dict.id] || `${progress[dict.id] ?? 0}%`}
                  </p>
                </div>
              ) : dict.downloaded ? (
                dict.source === 'bundled' ? (
                  <span className="px-3 py-1.5 text-xs text-gray-500">Ready</span>
                ) : (
                  <button
                    onClick={() => handleDelete(dict.id)}
                    className="px-3 py-1.5 text-xs text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded transition-colors"
                  >
                    Delete
                  </button>
                )
              ) : (
                <button
                  onClick={() => handleDownload(dict.id)}
                  disabled={downloading !== null}
                  className="px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors disabled:opacity-50"
                >
                  Download
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-gray-600">
        Dictionaries are stored locally and enable word lookup for each language.
      </p>
    </div>
  )
}
