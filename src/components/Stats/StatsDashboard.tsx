import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import type { MiningStats } from '../../types'

interface Props {
  onClose: () => void
  onReview: () => void
  onDrills: () => void
  onMine: () => void
}

const LANG_LABELS: Record<string, string> = {
  ja: 'Japanese', zh: 'Chinese', en: 'English',
  ko: 'Korean', fr: 'French', es: 'Spanish',
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-gray-800 rounded-lg p-4">
      <div className="text-2xl font-semibold text-white">{value}</div>
      <div className="text-xs text-gray-400 mt-1">{label}</div>
    </div>
  )
}

export function StatsDashboard({ onClose, onReview, onDrills, onMine }: Props) {
  const [stats, setStats] = useState<MiningStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.lexis.stats.getMiningStats().then((result) => {
      setLoading(false)
      if (result.error) { setError(result.error); return }
      setStats(result.data)
    })
  }, [])

  const handleNextAction = (): void => {
    if (!stats) return
    if (stats.nextAction.type === 'review') onReview()
    if (stats.nextAction.type === 'drill') onDrills()
    if (stats.nextAction.type === 'mine') onMine()
  }

  return (
    <div className="h-full bg-gray-950 flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 shrink-0">
        <h2 className="text-base font-semibold text-white">Stats</h2>
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-white transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {loading && (
        <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">Loading…</div>
      )}
      {error && (
        <div className="flex-1 flex items-center justify-center text-red-400 text-sm">{error}</div>
      )}

      {stats && (
        <div className="flex-1 overflow-y-auto p-6 space-y-5 max-w-5xl mx-auto w-full">
          <div className="bg-gray-800 rounded-lg p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-gray-100">{stats.nextAction.label}</h3>
                <span className={`text-[11px] rounded-full px-2 py-0.5 ${
                  stats.validLearningDay
                    ? 'bg-green-500/10 text-green-300'
                    : 'bg-yellow-500/10 text-yellow-300'
                }`}>
                  {stats.validLearningDay ? 'protected' : 'at risk'}
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-1">{stats.nextAction.detail}</p>
            </div>
            {stats.nextAction.type !== 'done' && (
              <button
                onClick={handleNextAction}
                className="shrink-0 px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
              >
                Start
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <StatCard label="Total Cards" value={stats.totalCards.toLocaleString()} />
            <StatCard label="Cards Today" value={stats.cardsCreatedToday} />
            <StatCard label="Reviews Today" value={stats.reviewsToday} />
            <StatCard label="Due Today" value={stats.dueToday} />
          </div>

          <div className="bg-gray-800 rounded-lg p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-gray-300">Cards Added — Last 30 Days</h3>
              <div className="flex items-center gap-4 text-xs text-gray-500">
                <span>Review streak: {stats.currentStreak}d</span>
                <span>Best: {stats.longestStreak}d</span>
                <span>Retention: {stats.retentionRate}%</span>
                <span>Patterns: {stats.patternsMinedToday}</span>
                <span>Drills: {stats.drillAttemptsToday}</span>
              </div>
            </div>
            {stats.dailyHistory.length === 0 ? (
              <p className="text-xs text-gray-500 py-8 text-center">No cards added yet</p>
            ) : (
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={stats.dailyHistory} margin={{ top: 0, right: 4, bottom: 0, left: -20 }}>
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: '#6b7280' }}
                    tickFormatter={(d: string) => d.slice(5)}
                    interval="preserveStartEnd"
                  />
                  <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: '#1f2937', border: 'none', borderRadius: 6, fontSize: 12 }}
                    labelStyle={{ color: '#d1d5db' }}
                    itemStyle={{ color: '#60a5fa' }}
                    cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                  />
                  <Bar dataKey="count" name="Cards" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="bg-gray-800 rounded-lg p-4">
              <h3 className="text-sm font-medium text-gray-300 mb-3">By Language</h3>
              {Object.keys(stats.byLanguage).length === 0 ? (
                <p className="text-xs text-gray-500">No data yet</p>
              ) : (
                <div className="space-y-2.5">
                  {Object.entries(stats.byLanguage)
                    .sort(([, a], [, b]) => b - a)
                    .map(([lang, count]) => (
                      <div key={lang} className="flex items-center gap-2">
                        <span className="text-xs text-gray-400 w-20 shrink-0">
                          {LANG_LABELS[lang] ?? lang}
                        </span>
                        <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-500 rounded-full"
                            style={{ width: `${stats.totalCards === 0 ? 0 : Math.round((count / stats.totalCards) * 100)}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-400 w-8 text-right shrink-0">{count}</span>
                      </div>
                    ))}
                </div>
              )}
            </div>

            <div className="bg-gray-800 rounded-lg p-4">
              <h3 className="text-sm font-medium text-gray-300 mb-3">Recent Cards</h3>
              {stats.recentCards.length === 0 ? (
                <p className="text-xs text-gray-500">No cards yet</p>
              ) : (
                <div className="space-y-1.5">
                  {stats.recentCards.map((card) => (
                    <div key={card.id} className="flex items-center gap-2 text-xs">
                      <span className="font-medium text-gray-200">{card.word ?? card.frontHtml}</span>
                      {card.reading && <span className="text-gray-500">{card.reading}</span>}
                      <span className="ml-auto text-gray-500 uppercase text-[10px]">{card.language ?? '—'}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
