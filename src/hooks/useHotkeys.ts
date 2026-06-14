import { useEffect } from 'react'
import { useLookupStore } from '../store/lookupStore'
import { useCardStore, buildDraft } from '../store/cardStore'

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

interface HotkeyOptions {
  enabled?: boolean
}

export function useHotkeys({ enabled = true }: HotkeyOptions = {}) {
  const lookupStore = useLookupStore()
  const { open: cardBuilderOpen, openBuilder, closeBuilder } = useCardStore()

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (cardBuilderOpen) {
          e.preventDefault()
          closeBuilder()
        }
        return
      }

      if (!enabled || isTypingTarget(e.target)) return

      if (e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        const { word, language, results } = lookupStore
        if (cardBuilderOpen || !word || !language || results.length === 0) return

        const firstSense = results[0]?.senses[0]
        const definition = firstSense?.definitions.slice(0, 2).join('; ') ?? ''
        const reading = results[0]?.readings[0]?.value

        openBuilder(
          buildDraft({
            word,
            reading,
            definition,
            language,
          }),
        )
        return
      }

      if (e.key === ' ') {
        const { word, language, results } = lookupStore
        if (!word || !language) return
        e.preventDefault()
        const reading = results[0]?.readings[0]?.value
        window.lexis.audio.getAudioPath(word, language, reading)
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [lookupStore, cardBuilderOpen, openBuilder, closeBuilder, enabled])
}
