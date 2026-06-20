import { useEffect, useState } from 'react'
import type { DictionaryInfo, DictionaryDownloadProgress } from '../../types'

interface WelcomeModalProps {
  onComplete: () => void
}

function DictionaryDownloadStep({ onReady }: { onReady: () => void }) {
  const [dictionaries, setDictionaries] = useState<DictionaryInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [progress, setProgress] = useState<Record<string, number>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set(['wordnet'])) // Default: English

  useEffect(() => {
    window.lexis.dictionary.listDictionaries().then((result) => {
      setLoading(false)
      if (result.data) {
        setDictionaries(result.data)
        // Pre-select already downloaded/bundled ones
        const downloaded = result.data.filter((d) => d.downloaded).map((d) => d.id)
        setSelected(new Set([...downloaded, 'wordnet']))
        // If all selected are already ready, auto-proceed
        const allReady = result.data
          .filter((d) => downloaded.includes(d.id) || d.id === 'wordnet')
          .every((d) => d.downloaded)
        if (allReady && downloaded.length > 0) {
          onReady()
        }
      }
    })

    window.lexis.dictionary.onDownloadProgress((prog: DictionaryDownloadProgress) => {
      setProgress((prev) => ({ ...prev, [prog.id]: prog.progress }))
    })

    return () => {
      window.lexis.dictionary.removeDownloadListeners()
    }
  }, [])

  const toggleSelect = (id: string) => {
    const newSelected = new Set(selected)
    if (newSelected.has(id)) {
      newSelected.delete(id)
    } else {
      newSelected.add(id)
    }
    setSelected(newSelected)
  }

  const handleDownloadSelected = async () => {
    const toDownload = dictionaries.filter((d) => selected.has(d.id) && !d.downloaded)

    for (const dict of toDownload) {
      setDownloading(dict.id)
      setProgress((prev) => ({ ...prev, [dict.id]: 0 }))
      await window.lexis.dictionary.downloadDictionary(dict.id as any)
    }

    setDownloading(null)
    onReady()
  }

  const allSelectedDownloaded = dictionaries
    .filter((d) => selected.has(d.id))
    .every((d) => d.downloaded)

  const hasSelection = selected.size > 0

  if (loading) {
    return <div className="text-gray-400 text-sm text-center py-8">Loading...</div>
  }

  return (
    <div className="space-y-4">
      <p className="text-gray-400 text-sm">
        Select the languages you want to learn. Dictionaries will be downloaded for word lookup.
      </p>

      <div className="space-y-2">
        {dictionaries.map((dict) => {
          const isSelected = selected.has(dict.id)
          const isDownloading = downloading === dict.id

          return (
            <label
              key={dict.id}
              className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                isSelected
                  ? 'bg-blue-500/10 border-blue-500/30'
                  : 'bg-gray-800 border-white/10 hover:border-white/20'
              }`}
            >
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => toggleSelect(dict.id)}
                disabled={isDownloading}
                className="accent-blue-500"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-200">{dict.name}</span>
                  {dict.downloaded && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                      dict.source === 'bundled'
                        ? 'bg-purple-500/20 text-purple-400'
                        : 'bg-green-500/20 text-green-400'
                    }`}>
                      {dict.source === 'bundled' ? 'Bundled' : 'Ready'}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500">{dict.sizeFormatted}</p>
              </div>

              {isDownloading && (
                <div className="w-16">
                  <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all"
                      style={{ width: `${progress[dict.id] ?? 0}%` }}
                    />
                  </div>
                </div>
              )}
            </label>
          )
        })}
      </div>

      {!allSelectedDownloaded && hasSelection && (
        <button
          onClick={handleDownloadSelected}
          disabled={downloading !== null}
          className="w-full py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-50"
        >
          {downloading ? `Downloading... ${progress[downloading] ?? 0}%` : 'Download Selected'}
        </button>
      )}

      {allSelectedDownloaded && hasSelection && (
        <p className="text-center text-sm text-green-400">All selected dictionaries are ready!</p>
      )}

      {!hasSelection && (
        <p className="text-center text-xs text-gray-500">
          You can download dictionaries later from Settings.
        </p>
      )}
    </div>
  )
}

export function WelcomeModal({ onComplete }: WelcomeModalProps) {
  const [step, setStep] = useState(0)
  const [dictsReady, setDictsReady] = useState(false)

  const steps = [
    {
      title: 'Welcome to Lexis',
      content: (
        <div className="space-y-3">
          <p>
            Lexis helps you learn languages through <strong>sentence mining</strong> and{' '}
            <strong>pattern drilling</strong>.
          </p>
          <p className="text-gray-400 text-sm">
            Import content you enjoy, mine useful sentences, create flashcards, and practice
            producing your own sentences.
          </p>
        </div>
      ),
    },
    {
      title: 'Choose Your Languages',
      content: <DictionaryDownloadStep onReady={() => setDictsReady(true)} />,
    },
    {
      title: 'Sentence Mining',
      content: (
        <div className="space-y-3">
          <p>
            Import subtitles, ebooks, or web articles. Click any word to look it up, then press{' '}
            <kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-xs">Shift+A</kbd> to create a
            flashcard.
          </p>
          <ul className="text-sm text-gray-400 space-y-1.5 list-disc ml-5">
            <li>Japanese, Chinese & English dictionaries</li>
            <li>Native language translations (AI-powered)</li>
            <li>Audio pronunciation from Forvo</li>
          </ul>
        </div>
      ),
    },
    {
      title: 'Pattern Drill',
      content: (
        <div className="space-y-3">
          <p>
            Learn grammar patterns by writing your own sentences. AI provides instant feedback and
            corrections.
          </p>
          <ul className="text-sm text-gray-400 space-y-1.5 list-disc ml-5">
            <li>Mine patterns from your reading material</li>
            <li>Practice active production, not just recognition</li>
            <li>Turn corrected attempts into review cards</li>
          </ul>
        </div>
      ),
    },
    {
      title: 'Get Started',
      content: (
        <div className="space-y-3">
          <p>You're all set! Here's how to begin:</p>
          <ol className="text-sm text-gray-400 space-y-1.5 list-decimal ml-5">
            <li>Click <strong>Import</strong> in the sidebar to add content</li>
            <li>Select a sentence and click a word to look it up</li>
            <li>Press <kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-xs">Shift+A</kbd> to save cards</li>
            <li>Review cards daily to build your vocabulary</li>
          </ol>
        </div>
      ),
    },
  ]

  const currentStep = steps[step]
  const isLast = step === steps.length - 1
  const isDictStep = step === 1

  const handleNext = () => {
    if (isLast) {
      onComplete()
    } else {
      setStep(step + 1)
    }
  }

  const canProceed = !isDictStep || dictsReady || step !== 1

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70">
      <div className="w-[480px] bg-gray-900 border border-white/10 rounded-xl shadow-2xl overflow-hidden">
        {/* Progress dots */}
        <div className="flex justify-center gap-2 pt-5 pb-2">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`w-2 h-2 rounded-full transition-colors ${
                i === step ? 'bg-blue-500' : i < step ? 'bg-blue-500/40' : 'bg-gray-700'
              }`}
            />
          ))}
        </div>

        {/* Content */}
        <div className="px-8 py-6">
          <h2 className="text-xl font-semibold text-gray-100 mb-4">{currentStep.title}</h2>
          <div className="text-gray-300">{currentStep.content}</div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-8 py-4 bg-gray-800/50 border-t border-white/5">
          <button
            onClick={() => setStep(Math.max(0, step - 1))}
            disabled={step === 0}
            className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            Back
          </button>
          <div className="flex gap-2">
            {isDictStep && !dictsReady && (
              <button
                onClick={handleNext}
                className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
              >
                Skip
              </button>
            )}
            <button
              onClick={handleNext}
              className="px-5 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
            >
              {isLast ? 'Get Started' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
