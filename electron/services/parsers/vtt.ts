import type { SubtitleEntry } from './srt'

export function parseVTT(content: string): SubtitleEntry[] {
  const entries: SubtitleEntry[] = []

  // Normalize line endings
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  // Remove WEBVTT header and metadata
  const lines = normalized.split('\n')
  let startIndex = 0

  // Skip header lines until we find first timestamp or empty line after header
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line.startsWith('WEBVTT')) continue
    if (line.startsWith('NOTE')) continue
    if (line.startsWith('STYLE')) {
      // Skip STYLE block
      while (i < lines.length && lines[i].trim() !== '') i++
      continue
    }
    if (line === '') continue
    // Check if this line is a timestamp
    if (line.includes('-->')) {
      startIndex = i
      break
    }
    // Could be a cue identifier, check next line for timestamp
    if (i + 1 < lines.length && lines[i + 1].includes('-->')) {
      startIndex = i
      break
    }
  }

  // Parse cues
  let index = 1
  let i = startIndex

  while (i < lines.length) {
    const line = lines[i].trim()

    // Skip empty lines
    if (line === '') {
      i++
      continue
    }

    // Check if this is a cue identifier (line without --> followed by line with -->)
    let timeLine = line
    if (!line.includes('-->') && i + 1 < lines.length && lines[i + 1].includes('-->')) {
      // This is a cue identifier, skip it
      i++
      timeLine = lines[i].trim()
    }

    // Parse timestamp line
    const timeMatch = timeLine.match(
      /^(\d{1,2}:)?(\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{1,2}:)?(\d{2}:\d{2}\.\d{3})/
    )

    if (!timeMatch) {
      i++
      continue
    }

    const startTime = (timeMatch[1] || '') + timeMatch[2]
    const endTime = (timeMatch[3] || '') + timeMatch[4]
    const startTimeMs = parseVTTTimestamp(startTime)
    const endTimeMs = parseVTTTimestamp(endTime)

    // Collect text lines until empty line or next timestamp
    i++
    const textLines: string[] = []
    while (i < lines.length) {
      const textLine = lines[i]
      // Check if this is an empty line or next cue
      if (textLine.trim() === '') break
      if (textLine.includes('-->')) {
        i-- // Go back so outer loop can process this
        break
      }
      // Check if next line is timestamp (this line might be cue identifier)
      if (i + 1 < lines.length && lines[i + 1].includes('-->')) {
        i-- // Go back
        break
      }
      textLines.push(textLine)
      i++
    }

    const rawText = textLines.join('\n')
    const text = stripVTTTags(rawText)

    if (text.trim()) {
      entries.push({
        index: index++,
        startTimeMs,
        endTimeMs,
        text: text.trim(),
        rawText,
      })
    }

    i++
  }

  return entries
}

function parseVTTTimestamp(ts: string): number {
  // Format: HH:MM:SS.mmm or MM:SS.mmm
  const parts = ts.split(':')
  let hours = 0
  let minutes = 0
  let seconds = 0
  let ms = 0

  if (parts.length === 3) {
    // HH:MM:SS.mmm
    hours = parseInt(parts[0], 10)
    minutes = parseInt(parts[1], 10)
    const secParts = parts[2].split('.')
    seconds = parseInt(secParts[0], 10)
    ms = parseInt(secParts[1] || '0', 10)
  } else if (parts.length === 2) {
    // MM:SS.mmm
    minutes = parseInt(parts[0], 10)
    const secParts = parts[1].split('.')
    seconds = parseInt(secParts[0], 10)
    ms = parseInt(secParts[1] || '0', 10)
  }

  return hours * 3600000 + minutes * 60000 + seconds * 1000 + ms
}

function stripVTTTags(text: string): string {
  // Remove VTT tags like <c>, <i>, <b>, <u>, <ruby>, <rt>, <v>, <lang>
  // Also remove positioning tags like <00:00:00.000>
  return text
    .replace(/<\/?[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
}
