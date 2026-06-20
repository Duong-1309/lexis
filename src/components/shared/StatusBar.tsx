import { useEffect, useState } from 'react'

export function StatusBar() {
  const [totalDue, setTotalDue] = useState(0)
  const [coinBalance, setCoinBalance] = useState(0)

  useEffect(() => {
    const load = async () => {
      const decksResult = await window.lexis.decks.list()
      if (decksResult.data) {
        const due = decksResult.data.reduce((sum, d) => sum + (d.dueCount ?? 0), 0)
        setTotalDue(due)
      }

      const settingsResult = await window.lexis.settings.get()
      if (settingsResult.data) {
        setCoinBalance(settingsResult.data.coinBalance ?? 0)
      }
    }

    load()
    const interval = setInterval(load, 30000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="flex items-center gap-4 px-4 py-1.5 bg-gray-900 border-t border-white/5 text-xs text-gray-400">
      <div className="flex items-center gap-1.5">
        <span className={`w-2 h-2 rounded-full ${totalDue > 0 ? 'bg-blue-400' : 'bg-gray-600'}`} />
        <span>
          {totalDue > 0 ? `${totalDue} card${totalDue !== 1 ? 's' : ''} due` : 'All caught up'}
        </span>
      </div>
      <div className="h-3 w-px bg-white/10" />
      <div className="flex items-center gap-1">
        <svg className="w-3.5 h-3.5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
          <circle cx="10" cy="10" r="8" />
        </svg>
        <span className="text-yellow-400 font-medium">{coinBalance.toLocaleString()}</span>
      </div>
      <div className="ml-auto" />
      <span>Lexis v1.0</span>
    </div>
  )
}
