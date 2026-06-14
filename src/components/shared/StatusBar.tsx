import { useEffect, useState } from 'react'

export function StatusBar() {
  const [totalDue, setTotalDue] = useState(0)

  useEffect(() => {
    const load = async () => {
      const result = await window.lexis.decks.list()
      if (result.data) {
        const due = result.data.reduce((sum, d) => sum + (d.dueCount ?? 0), 0)
        setTotalDue(due)
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
      <span>Lexis v1.0</span>
    </div>
  )
}
