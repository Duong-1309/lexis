import { describe, it, expect } from 'vitest'
import { parseSRT } from '../parsers/srt'

const VALID_SRT = `1
00:00:01,000 --> 00:00:03,000
Hello world

2
00:00:04,000 --> 00:00:06,000
This is line two

3
00:00:07,000 --> 00:00:09,000
<i>Italic text</i> and <b>bold</b>

4
00:01:00,500 --> 00:01:02,000
One minute mark

5
00:00:10,000 --> 00:00:12,000
Line five here`

describe('parseSRT', () => {
  it('parses a valid SRT with 5 entries', () => {
    const entries = parseSRT(VALID_SRT)
    expect(entries).toHaveLength(5)
  })

  it('parses index and timestamps correctly', () => {
    const entries = parseSRT(VALID_SRT)
    expect(entries[0].index).toBe(1)
    expect(entries[0].startTimeMs).toBe(1000)
    expect(entries[0].endTimeMs).toBe(3000)
  })

  it('strips HTML tags from text', () => {
    const entries = parseSRT(VALID_SRT)
    const italicEntry = entries.find((e) => e.rawText.includes('<i>'))!
    expect(italicEntry.text).toBe('Italic text and bold')
    expect(italicEntry.rawText).toContain('<i>')
  })

  it('parses timestamp at 1 minute correctly', () => {
    const entries = parseSRT(VALID_SRT)
    const oneMin = entries.find((e) => e.index === 4)!
    expect(oneMin.startTimeMs).toBe(60500)
    expect(oneMin.endTimeMs).toBe(62000)
  })

  it('parses plain text entry correctly', () => {
    const entries = parseSRT(VALID_SRT)
    expect(entries[0].text).toBe('Hello world')
  })

  it('returns empty array for empty input', () => {
    expect(parseSRT('')).toHaveLength(0)
    expect(parseSRT('   ')).toHaveLength(0)
  })

  it('skips malformed blocks gracefully', () => {
    const malformed = `1
NOT A TIMESTAMP
Some text

2
00:00:01,000 --> 00:00:02,000
Valid entry`
    const entries = parseSRT(malformed)
    expect(entries).toHaveLength(1)
    expect(entries[0].text).toBe('Valid entry')
  })

  it('handles Windows line endings (CRLF)', () => {
    const crlf = '1\r\n00:00:01,000 --> 00:00:02,000\r\nHello CRLF\r\n\r\n'
    const entries = parseSRT(crlf)
    expect(entries).toHaveLength(1)
    expect(entries[0].text).toBe('Hello CRLF')
  })

  it('handles multi-line subtitle text', () => {
    const multiline = `1
00:00:01,000 --> 00:00:03,000
Line one
Line two`
    const entries = parseSRT(multiline)
    expect(entries[0].text).toBe('Line one\nLine two')
  })
})
