import type { Mission, DailyMissions, MissionType } from '../../src/types/index'
import { DatabaseService } from './db.class'
import { getSettings, setSettings } from './settings'

interface MissionDefinition {
  type: MissionType
  title: string
  description: string
  targetCount: number
  coinReward: number
}

const DAILY_MISSION_DEFINITIONS: MissionDefinition[] = [
  {
    type: 'review_cards',
    title: 'Review cards',
    description: 'Review 10 flashcards',
    targetCount: 10,
    coinReward: 10,
  },
  {
    type: 'mine_cards',
    title: 'Mine new cards',
    description: 'Create 3 new cards from your reading',
    targetCount: 3,
    coinReward: 15,
  },
  {
    type: 'complete_drills',
    title: 'Complete drills',
    description: 'Complete 5 pattern drills',
    targetCount: 5,
    coinReward: 20,
  },
  {
    type: 'convert_attempt',
    title: 'Save a drill to review',
    description: 'Convert a drill attempt into a review card',
    targetCount: 1,
    coinReward: 5,
  },
]

function getTodayDateString(): string {
  const settings = getSettings()
  const dailyDueTime = settings.scheduling.dailyDueTime ?? '04:00'
  const [dueHour, dueMinute] = dailyDueTime.split(':').map(Number)

  const now = new Date()
  const cutoff = new Date(now)
  cutoff.setHours(dueHour, dueMinute, 0, 0)

  // If before cutoff, use yesterday's date as the "learning day"
  if (now < cutoff) {
    cutoff.setDate(cutoff.getDate() - 1)
  }

  return cutoff.toISOString().slice(0, 10)
}

function countTodayProgress(db: DatabaseService, type: MissionType): number {
  const today = getTodayDateString()
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowStr = tomorrow.toISOString().slice(0, 10)

  switch (type) {
    case 'review_cards': {
      const result = db.db
        .prepare(`SELECT COUNT(*) as count FROM review_log WHERE reviewed_at >= ? AND reviewed_at < ?`)
        .get(today, tomorrowStr) as { count: number }
      return result.count
    }
    case 'mine_cards': {
      const result = db.db
        .prepare(`SELECT COUNT(*) as count FROM cards WHERE created_at >= ? AND created_at < ?`)
        .get(today, tomorrowStr) as { count: number }
      return result.count
    }
    case 'complete_drills': {
      const result = db.db
        .prepare(`SELECT COUNT(*) as count FROM drill_attempts WHERE created_at >= ? AND created_at < ?`)
        .get(today, tomorrowStr) as { count: number }
      return result.count
    }
    case 'convert_attempt': {
      // Count drill attempts that were converted to cards today (card_id is set)
      const result = db.db
        .prepare(
          `SELECT COUNT(*) as count FROM drill_attempts
           WHERE card_id IS NOT NULL AND created_at >= ? AND created_at < ?`
        )
        .get(today, tomorrowStr) as { count: number }
      return result.count
    }
    default:
      return 0
  }
}

export function getDailyMissions(db: DatabaseService): DailyMissions {
  const today = getTodayDateString()

  // Generate missions for today
  const missions: Mission[] = DAILY_MISSION_DEFINITIONS.map((def, index) => {
    const currentCount = countTodayProgress(db, def.type)
    const completed = currentCount >= def.targetCount

    return {
      id: `${today}-${def.type}`,
      type: def.type,
      title: def.title,
      description: def.description,
      targetCount: def.targetCount,
      currentCount: Math.min(currentCount, def.targetCount),
      coinReward: def.coinReward,
      completed,
      claimedAt: getClaimedAt(today, def.type),
    }
  })

  const totalCoins = missions.reduce((sum, m) => sum + m.coinReward, 0)
  const claimedCoins = missions
    .filter((m) => m.claimedAt)
    .reduce((sum, m) => sum + m.coinReward, 0)

  return {
    date: today,
    missions,
    totalCoins,
    claimedCoins,
  }
}

// Store claimed missions in settings (simple approach, no extra DB table)
function getClaimedMissions(): Record<string, string> {
  const settings = getSettings()
  // Use a simple approach: store in settings as a JSON-like structure
  // Key: missionId, Value: claimedAt timestamp
  return (settings as Record<string, unknown>).claimedMissions as Record<string, string> ?? {}
}

function setClaimedMission(missionId: string, timestamp: string): void {
  const claimed = getClaimedMissions()
  claimed[missionId] = timestamp

  // Clean up old missions (keep only last 7 days)
  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
  const cutoffDate = sevenDaysAgo.toISOString().slice(0, 10)

  const cleaned: Record<string, string> = {}
  for (const [id, time] of Object.entries(claimed)) {
    const dateStr = id.split('-').slice(0, 3).join('-')
    if (dateStr >= cutoffDate) {
      cleaned[id] = time
    }
  }

  setSettings({ claimedMissions: cleaned } as Partial<typeof getSettings extends () => infer R ? R : never>)
}

function getClaimedAt(date: string, type: MissionType): string | undefined {
  const claimed = getClaimedMissions()
  const missionId = `${date}-${type}`
  return claimed[missionId]
}

export function claimMissionReward(
  db: DatabaseService,
  missionId: string
): { coinsEarned: number; newBalance: number } {
  const today = getTodayDateString()
  const missions = getDailyMissions(db)

  const mission = missions.missions.find((m) => m.id === missionId)
  if (!mission) {
    throw new Error('Mission not found')
  }

  if (!mission.completed) {
    throw new Error('Mission not completed yet')
  }

  if (mission.claimedAt) {
    throw new Error('Mission reward already claimed')
  }

  // Mark as claimed
  setClaimedMission(missionId, new Date().toISOString())

  // Add coins to balance
  const settings = getSettings()
  const newBalance = (settings.coinBalance ?? 0) + mission.coinReward
  setSettings({ coinBalance: newBalance })

  return {
    coinsEarned: mission.coinReward,
    newBalance,
  }
}
