const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/

export const DEFAULT_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

export const COMMON_TIME_ZONES = [
  'Asia/Ho_Chi_Minh',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Seoul',
  'Europe/London',
  'Europe/Paris',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'UTC',
]

export function parseStoredDueDate(value: string): Date {
  if (DATE_ONLY_RE.test(value)) {
    return new Date(`${value}T00:00:00Z`)
  }
  return new Date(`${value.replace(' ', 'T')}Z`)
}

export function formatDueDate(value: string, timeZone: string = DEFAULT_TIME_ZONE): string {
  const date = parseStoredDueDate(value)
  if (Number.isNaN(date.getTime())) return value

  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    month: 'short',
    day: '2-digit',
    hour: DATE_ONLY_RE.test(value) ? undefined : '2-digit',
    minute: DATE_ONLY_RE.test(value) ? undefined : '2-digit',
    hour12: false,
  })

  return formatter.format(date)
}

export function formatDueDistance(value: string): string {
  const due = parseStoredDueDate(value)
  const diffMs = due.getTime() - Date.now()
  const diffMinutes = Math.ceil(diffMs / 60000)
  if (diffMinutes <= 0) return 'Due now'
  if (diffMinutes < 60) return `Due in ${diffMinutes}m`

  const diffHours = Math.ceil(diffMinutes / 60)
  if (diffHours < 24) return `Due in ${diffHours}h`

  const diffDays = Math.ceil(diffHours / 24)
  if (diffDays === 1) return 'Due tomorrow'
  return `Due in ${diffDays}d`
}
