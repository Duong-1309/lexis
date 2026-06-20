import { describe, expect, it } from 'vitest'
import { parsePlainText, splitTextIntoSentences } from '../parsers/text'

describe('plain text parser', () => {
  it('splits English sentences on punctuation boundaries', () => {
    expect(splitTextIntoSentences('Hello world. How are you? Fine!')).toEqual([
      'Hello world.',
      'How are you?',
      'Fine!',
    ])
  })

  it('keeps paragraph text when punctuation is missing', () => {
    expect(splitTextIntoSentences('First paragraph\n\nSecond paragraph')).toEqual([
      'First paragraph',
      'Second paragraph',
    ])
  })

  it('preserves CJK punctuation boundaries', () => {
    expect(splitTextIntoSentences('今日は晴れです。明日も勉強します！')).toEqual([
      '今日は晴れです。',
      '明日も勉強します！',
    ])
  })

  it('counts words for latin languages', () => {
    const result = parsePlainText('Alpha beta. Gamma delta.', 'en')
    expect(result.sentences).toHaveLength(2)
    expect(result.wordCount).toBe(4)
  })
})
