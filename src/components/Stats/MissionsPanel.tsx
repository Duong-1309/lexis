import { useEffect, useState } from 'react'
import type { DailyMissions, Mission } from '../../types'

interface Props {
  onMissionsChange?: () => void
}

function MissionCard({
  mission,
  onClaim,
  claiming,
}: {
  mission: Mission
  onClaim: (id: string) => void
  claiming: boolean
}) {
  const progress = Math.min(100, Math.round((mission.currentCount / mission.targetCount) * 100))
  const canClaim = mission.completed && !mission.claimedAt

  return (
    <div className={`rounded-lg p-3 ${mission.claimedAt ? 'bg-gray-800/50' : 'bg-gray-800'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className={`text-sm font-medium ${mission.claimedAt ? 'text-gray-500' : 'text-gray-200'}`}>
              {mission.title}
            </h4>
            {mission.claimedAt && (
              <svg className="w-4 h-4 text-green-400 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
            )}
          </div>
          <p className={`text-xs mt-0.5 ${mission.claimedAt ? 'text-gray-600' : 'text-gray-500'}`}>
            {mission.description}
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-1">
          <span className={`text-sm font-semibold ${mission.claimedAt ? 'text-gray-600' : 'text-yellow-400'}`}>
            +{mission.coinReward}
          </span>
          <svg className={`w-4 h-4 ${mission.claimedAt ? 'text-gray-600' : 'text-yellow-400'}`} fill="currentColor" viewBox="0 0 20 20">
            <circle cx="10" cy="10" r="8" />
          </svg>
        </div>
      </div>

      <div className="mt-2">
        <div className="flex items-center justify-between text-xs mb-1">
          <span className={mission.claimedAt ? 'text-gray-600' : 'text-gray-400'}>
            {mission.currentCount}/{mission.targetCount}
          </span>
          {canClaim && (
            <button
              onClick={() => onClaim(mission.id)}
              disabled={claiming}
              className="px-2 py-0.5 text-xs font-medium bg-yellow-500 hover:bg-yellow-400 text-gray-900 rounded transition-colors disabled:opacity-50"
            >
              {claiming ? 'Claiming...' : 'Claim'}
            </button>
          )}
        </div>
        <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              mission.claimedAt ? 'bg-gray-600' : mission.completed ? 'bg-green-500' : 'bg-blue-500'
            }`}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  )
}

export function MissionsPanel({ onMissionsChange }: Props) {
  const [missions, setMissions] = useState<DailyMissions | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [claiming, setClaiming] = useState<string | null>(null)

  const loadMissions = async () => {
    const result = await window.lexis.missions.getDailyMissions()
    setLoading(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setMissions(result.data)
  }

  useEffect(() => {
    loadMissions()
  }, [])

  const handleClaim = async (missionId: string) => {
    setClaiming(missionId)
    const result = await window.lexis.missions.claimMissionReward(missionId)
    setClaiming(null)

    if (result.error) {
      setError(result.error)
      return
    }

    // Refresh missions
    await loadMissions()
    onMissionsChange?.()
  }

  if (loading) {
    return (
      <div className="bg-gray-800 rounded-lg p-4">
        <div className="text-gray-500 text-sm text-center py-4">Loading missions...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-gray-800 rounded-lg p-4">
        <div className="text-red-400 text-sm text-center py-4">{error}</div>
      </div>
    )
  }

  if (!missions) return null

  const completedCount = missions.missions.filter((m) => m.claimedAt).length
  const allClaimed = completedCount === missions.missions.length

  return (
    <div className="bg-gray-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-gray-300">Daily Missions</h3>
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-gray-400">
            {completedCount}/{missions.missions.length} claimed
          </span>
          <span className="text-gray-600">·</span>
          <span className="text-yellow-400 font-medium">
            {missions.claimedCoins}/{missions.totalCoins}
          </span>
          <svg className="w-3.5 h-3.5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
            <circle cx="10" cy="10" r="8" />
          </svg>
        </div>
      </div>

      {allClaimed ? (
        <div className="text-center py-6">
          <div className="text-3xl mb-2">🎉</div>
          <p className="text-sm text-gray-400">All missions completed!</p>
          <p className="text-xs text-gray-500 mt-1">Come back tomorrow for new missions</p>
        </div>
      ) : (
        <div className="space-y-2">
          {missions.missions.map((mission) => (
            <MissionCard
              key={mission.id}
              mission={mission}
              onClaim={handleClaim}
              claiming={claiming === mission.id}
            />
          ))}
        </div>
      )}
    </div>
  )
}
