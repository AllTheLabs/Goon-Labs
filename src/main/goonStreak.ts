/** Local calendar day as YYYY-MM-DD. */
export function localDayKey(date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function yesterdayKey(date = new Date()): string {
  const previous = new Date(date)
  previous.setDate(previous.getDate() - 1)
  return localDayKey(previous)
}

export function nextGoonStreak(
  count: number | undefined,
  lastDay: string | undefined,
  today = localDayKey(),
  yesterday = yesterdayKey()
): { count: number; date: string } {
  const current = Math.max(0, Math.round(Number(count) || 0))
  if (lastDay === today && current > 0) return { count: current, date: today }
  if (lastDay === yesterday && current > 0) return { count: current + 1, date: today }
  return { count: 1, date: today }
}

/** Milliseconds until a few seconds after the next local midnight. */
export function msUntilNextLocalMidnight(now = new Date()): number {
  const next = new Date(now)
  next.setDate(now.getDate() + 1)
  next.setHours(0, 0, 5, 0)
  return Math.max(1000, next.getTime() - now.getTime())
}
