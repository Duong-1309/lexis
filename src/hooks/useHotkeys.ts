import { useEffect } from 'react'
import { useLookupStore } from '../store/lookupStore'
import { useCardStore, buildDraft } from '../store/cardStore'

export function useHotkeys() {
  const lookupStore = useLookupStore()
  const { open: cardBuilderOpen, openBuilder, closeBuilder } = useCardStore()

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'

      if (e.key === 'Escape') {
        if (cardBuilderOpen) {
          closeBuilder()
        }
        return
      }

      if (isInput) return

      if (e.key === 'a' || e.key === 'A') {
        const { word, language, results } = lookupStore
        if (!word || !language || results.length === 0) return

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
        const reading = results[0]?.readings[0]?.value
        window.lexis.audio.getAudioPath(word, language, reading)
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [lookupStore, cardBuilderOpen, openBuilder, closeBuilder])
}
