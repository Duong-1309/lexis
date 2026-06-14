export interface SubtitleEntry {
  index: number
  startTimeMs: number
  endTimeMs: number
  text: string
  rawText: string
}

export function parseSRT(content: string): SubtitleEntry[] {
  const entries: SubtitleEntry[] = []
  // Normalize line endings and split on double newlines
  const blocks = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split(/\n\n+/)

  for (const block of blocks) {
    const lines = block.trim().split('\n')
    if (lines.length < 3) continue

    const index = parseInt(lines[0].trim(), 10)
    if (isNaN(index)) continue

    const timeLine = lines[1].trim()
    const timeMatch = timeLine.match(
      /^(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/,
    )
    if (!timeMatch) continue

    const startTimeMs = parseTimestamp(timeMatch[1])
    const endTimeMs = parseTimestamp(timeMatch[2])
    const rawText = lines.slice(2).join('\n')
    const text = stripHTMLTags(rawText)

    if (!text.trim()) continue

    entries.push({ index, startTimeMs, endTimeMs, text: text.trim(), rawText })
  }

  return entries
}

function parseTimestamp(ts: string): number {
  // Format: HH:MM:SS,mmm
  const [timePart, msPart] = ts.split(',')
  const [hours, minutes, seconds] = timePart.split(':').map(Number)
  const ms = parseInt(msPart, 10)
  return hours * 3600000 + minutes * 60000 + seconds * 1000 + ms
}

function stripHTMLTags(text: string): string {
  return text.replace(/<[^>]*>/g, '')
}
