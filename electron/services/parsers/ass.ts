import type { SubtitleEntry } from './srt'

export function parseASS(content: string): SubtitleEntry[] {
  const entries: SubtitleEntry[] = []
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')

  let inEventsSection = false
  let formatLine: string[] = []
  let index = 0

  for (const line of lines) {
    const trimmed = line.trim()

    if (trimmed.toLowerCase() === '[events]') {
      inEventsSection = true
      continue
    }

    if (trimmed.startsWith('[') && inEventsSection) {
      inEventsSection = false
      continue
    }

    if (!inEventsSection) continue

    if (trimmed.startsWith('Format:')) {
      formatLine = trimmed
        .slice('Format:'.length)
        .split(',')
        .map((s) => s.trim().toLowerCase())
      continue
    }

    if (!trimmed.startsWith('Dialogue:')) continue
    if (formatLine.length === 0) continue

    const rawValues = trimmed.slice('Dialogue:'.length)
    // Split only up to formatLine.length fields; last field (Text) may contain commas
    const values = splitDialogueLine(rawValues, formatLine.length)
    if (values.length < formatLine.length) continue

    const startIdx = formatLine.indexOf('start')
    const endIdx = formatLine.indexOf('end')
    const textIdx = formatLine.indexOf('text')

    if (startIdx === -1 || endIdx === -1 || textIdx === -1) continue

    const startTimeMs = parseASSTimestamp(values[startIdx].trim())
    const endTimeMs = parseASSTimestamp(values[endIdx].trim())
    const rawText = values[textIdx]
    const text = stripASSTags(rawText).trim()

    if (!text) continue

    entries.push({ index: ++index, startTimeMs, endTimeMs, text, rawText })
  }

  return entries
}

function splitDialogueLine(raw: string, fieldCount: number): string[] {
  const parts = raw.split(',')
  if (parts.length <= fieldCount) return parts
  // Last field (Text) may contain commas — rejoin everything after fieldCount-1
  const head = parts.slice(0, fieldCount - 1)
  const tail = parts.slice(fieldCount - 1).join(',')
  return [...head, tail]
}

function parseASSTimestamp(ts: string): number {
  // Format: H:MM:SS.cc (centiseconds)
  const match = ts.match(/^(\d+):(\d{2}):(\d{2})\.(\d{2})$/)
  if (!match) return 0
  const [, h, m, s, cs] = match.map(Number)
  return h * 3600000 + m * 60000 + s * 1000 + cs * 10
}

export function stripASSTags(text: string): string {
  // Remove ASS override tags: {\an8}, {\pos(...)}, {\c&H...&}, {\1c&H...&}, etc.
  // Also remove drawing commands (m, l, etc.) that follow {\p1}
  return text
    .replace(/\{[^}]*\}/g, '')  // remove all {tag} blocks
    .replace(/\\N/g, '\n')       // \N = hard line break in ASS
    .replace(/\\n/g, '\n')       // \n = soft wrap in ASS
    .replace(/\\h/g, ' ')        // \h = hard space
    .trim()
}
