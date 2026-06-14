import { describe, it, expect } from 'vitest'
import { parseASS, stripASSTags } from '../parsers/ass'

const VALID_ASS = `[Script Info]
Title: Test
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize
Style: Default,Arial,20

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,Hello world
Dialogue: 0,0:00:04.00,0:00:06.00,Default,,0,0,0,,{\\an8}This is top-aligned text
Dialogue: 0,0:00:07.00,0:00:09.00,Default,,0,0,0,,{\\i1}Italic{\\i0} text
Dialogue: 0,0:01:00.50,0:01:02.00,Default,,0,0,0,,One minute mark
Dialogue: 0,0:00:10.00,0:00:12.00,Default,,0,0,0,,Text with, comma inside`

describe('parseASS', () => {
  it('parses valid ASS with 5 entries', () => {
    const entries = parseASS(VALID_ASS)
    expect(entries).toHaveLength(5)
  })

  it('parses timestamps correctly', () => {
    const entries = parseASS(VALID_ASS)
    expect(entries[0].startTimeMs).toBe(1000)
    expect(entries[0].endTimeMs).toBe(3000)
  })

  it('strips ASS override tags from text', () => {
    const entries = parseASS(VALID_ASS)
    const tagEntry = entries.find((e) => e.rawText.includes('{'))!
    expect(tagEntry.text).not.toContain('{')
  })

  it('strips italic tags correctly', () => {
    const entries = parseASS(VALID_ASS)
    const italicEntry = entries.find((e) => e.rawText.includes('{\\i1}'))!
    expect(italicEntry.text).toBe('Italic text')
  })

  it('parses timestamp at 1 minute correctly', () => {
    const entries = parseASS(VALID_ASS)
    const oneMin = entries.find((e) => e.startTimeMs === 60500)!
    expect(oneMin).toBeDefined()
    expect(oneMin.endTimeMs).toBe(62000)
  })

  it('handles text with commas inside', () => {
    const entries = parseASS(VALID_ASS)
    const commaEntry = entries.find((e) => e.text.includes('comma'))!
    expect(commaEntry.text).toBe('Text with, comma inside')
  })

  it('returns empty array for empty input', () => {
    expect(parseASS('')).toHaveLength(0)
  })

  it('returns empty array when no [Events] section', () => {
    const noEvents = `[Script Info]
Title: Test`
    expect(parseASS(noEvents)).toHaveLength(0)
  })
})

describe('stripASSTags', () => {
  it('removes override tag blocks', () => {
    expect(stripASSTags('{\\an8}Hello')).toBe('Hello')
    expect(stripASSTags('{\\pos(100,200)}World')).toBe('World')
  })

  it('replaces hard line breaks', () => {
    expect(stripASSTags('Line one\\NLine two')).toBe('Line one\nLine two')
  })

  it('passes through plain text unchanged', () => {
    expect(stripASSTags('Just plain text')).toBe('Just plain text')
  })
})
