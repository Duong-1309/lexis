import type { Language, PatternDraft, Sentence } from '../types'

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function buildPatternText(sentence: string, target?: string | null): string {
  const cleanSentence = sentence.trim()
  const cleanTarget = target?.trim()
  if (!cleanTarget) return cleanSentence

  const pattern = new RegExp(escapeRegExp(cleanTarget), 'i')
  if (!pattern.test(cleanSentence)) return `${cleanSentence}\n\nTarget: ${cleanTarget}`

  return cleanSentence.replace(pattern, `[${cleanTarget}]`)
}

export function buildPatternDraftFromSentence(args: {
  sentence: Sentence
  language: Language
  target?: string | null
  sourceId?: number
}): PatternDraft {
  return {
    language: args.language,
    patternText: buildPatternText(args.sentence.content, args.target),
    exampleSentence: args.sentence.content,
    slotPhrase: args.target?.trim() || undefined,
    sourceSentenceId: args.sentence.id,
    sourceId: args.sentence.sourceId ?? args.sourceId,
    tags: ['pattern', args.language],
  }
}
