import { useEffect, useState } from 'react'
import { Flame } from 'lucide-react'

export function GoonStreak() {
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    void window.api.getGoonStreak().then(setCount)
    return window.api.onGoonStreak(setCount)
  }, [])

  if (count == null) return null

  return (
    <div className="goon-streak" title="Consecutive days you've opened Goon Labs">
      <Flame size={15} fill="currentColor" />
      <span>
        Goon Streak: <strong>{count}</strong>
      </span>
    </div>
  )
}
