import type { Language } from '../../../src/types/index'

export interface TextImportResult {
  sentences: string[]
  wordCount: number
}

function normalizeParagraph(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function countWords(value: string, language: Language): number {
  if (/^(ja|zh|ko)$/.test(language)) {
    return Array.from(value.replace(/\s+/g, '')).length
  }
  const words = value.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)
  return words?.length ?? 0
}

export function splitTextIntoSentences(text: string): string[] {
  const paragraphs = text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map(normalizeParagraph)
    .filter(Boolean)

  const sentences: string[] = []
  const sentencePattern = /[^.!?。！？…]+(?:[.!?。！？…]+["'”’)\]]*)?|[^.!?。！？…]+$/gu

  for (const paragraph of paragraphs) {
    const matches = [...paragraph.matchAll(sentencePattern)]
      .map((match) => match[0].trim())
      .filter(Boolean)

    if (matches.length > 0) {
      sentences.push(...matches)
    } else {
      sentences.push(paragraph)
    }
  }

  return sentences
}

export function parsePlainText(text: string, language: Language): TextImportResult {
  const sentences = splitTextIntoSentences(text)
  return {
    sentences,
    wordCount: countWords(sentences.join(' '), language),
  }
}
