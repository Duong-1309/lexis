import { useState } from 'react'

interface WelcomeModalProps {
  onComplete: () => void
}

export function WelcomeModal({ onComplete }: WelcomeModalProps) {
  const [step, setStep] = useState(0)

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
      title: 'Sentence Mining',
      content: (
        <div className="space-y-3">
          <p>
            Import subtitles, ebooks, or web articles. Click any word to look it up, then press{' '}
            <kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-xs">Shift+A</kbd> to create a
            flashcard.
          </p>
          <ul className="text-sm text-gray-400 space-y-1.5 list-disc ml-5">
            <li>Japanese & Chinese dictionaries built-in</li>
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

  const handleNext = () => {
    if (isLast) {
      onComplete()
    } else {
      setStep(step + 1)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70">
      <div className="w-[440px] bg-gray-900 border border-white/10 rounded-xl shadow-2xl overflow-hidden">
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
          <button
            onClick={handleNext}
            className="px-5 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
          >
            {isLast ? 'Get Started' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}
