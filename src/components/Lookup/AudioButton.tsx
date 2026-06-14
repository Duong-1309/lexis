import { useState } from 'react'
import type { Language } from '../../types'

interface Props {
  word: string
  language: Language
  reading?: string
}

export function AudioButton({ word, language, reading }: Props) {
  const [state, setState] = useState<'idle' | 'loading' | 'playing' | 'error'>('idle')

  const play = async () => {
    if (state === 'loading' || state === 'playing') return
    setState('loading')

    const result = await window.lexis.audio.getAudioPath(word, language, reading)
    if (result.error || !result.data) { setState('error'); return }

    const { filename, source } = result.data

    if (source === 'tts' || !filename) {
      // Web Speech TTS fallback
      const utterance = new SpeechSynthesisUtterance(reading ?? word)
      utterance.lang = language === 'ja' ? 'ja-JP' : language === 'zh' ? 'zh-CN' : language
      utterance.onend = () => setState('idle')
      utterance.onerror = () => setState('error')
      setState('playing')
      speechSynthesis.speak(utterance)
      return
    }

    const audio = new Audio(`lexis-audio://${encodeURIComponent(filename)}`)
    audio.onended = () => setState('idle')
    audio.onerror = () => setState('error')
    setState('playing')
    audio.play().catch(() => setState('error'))
  }

  const icon = {
    idle: (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M15.536 8.464a5 5 0 010 7.072M12 6a7 7 0 010 12M9 9a3 3 0 000 6" />
    ),
    loading: null,
    playing: (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M10 9v6m4-6v6" />
    ),
    error: (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    ),
  }[state]

  return (
    <button
      onClick={play}
      title="Play pronunciation"
      className={`p-1.5 rounded transition-colors ${
        state === 'error'
          ? 'text-red-400 hover:bg-red-400/10'
          : 'text-gray-400 hover:text-gray-200 hover:bg-white/10'
      }`}
    >
      {state === 'loading' ? (
        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          {icon}
        </svg>
      )}
    </button>
  )
}
