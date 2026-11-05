import type { MediaItem } from '../../shared/types'

export interface ClipPair {
  left: MediaItem
  right: MediaItem
}

function tokens(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .replace(/\.[^.]+$/, '')
      .split(/[^a-z0-9]+/)
      .filter((part) => part.length > 2)
  )
}

/** Higher is a closer match: shared tags, similar length, similar file name. */
export function clipSimilarity(a: MediaItem, b: MediaItem): number {
  if (a.id === b.id) return 0.04
  const tagUnion = new Set([...a.tags, ...b.tags])
  const tagScore =
    tagUnion.size === 0
      ? 0.15
      : [...a.tags].filter((tag) => b.tags.includes(tag)).length / tagUnion.size

  const da = a.duration ?? 0
  const db = b.duration ?? 0
  const durScore = da > 0.1 && db > 0.1 ? 1 - Math.min(1, Math.abs(da - db) / Math.max(da, db)) : 0.45

  const left = tokens(a.fileName)
  const right = tokens(b.fileName)
  const nameUnion = new Set([...left, ...right])
  const nameScore =
    nameUnion.size === 0 ? 0 : [...left].filter((token) => right.has(token)).length / nameUnion.size

  return tagScore * 0.55 + durScore * 0.3 + nameScore * 0.15
}

function shuffle<T>(list: T[]): T[] {
  const next = [...list]
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[next[i], next[j]] = [next[j], next[i]]
  }
  return next
}

function bestMatch(item: MediaItem, pool: MediaItem[]): number {
  let best = 0
  let score = -1
  for (let i = 0; i < pool.length; i++) {
    const next = clipSimilarity(item, pool[i])
    if (next > score) {
      score = next
      best = i
    }
  }
  return best
}

/** Pair every left clip with the closest unused right clip, reusing the right pool if it runs out. */
export function pairClips(left: MediaItem[], right: MediaItem[]): ClipPair[] {
  if (left.length === 0 || right.length === 0) return []
  const lead = shuffle(left)
  let remaining = shuffle(right)
  const pairs: ClipPair[] = []
  for (const item of lead) {
    if (remaining.length === 0) remaining = shuffle(right)
    const others = remaining.filter((entry) => entry.id !== item.id)
    const pool = others.length > 0 ? others : remaining
    const index = bestMatch(item, pool)
    const match = pool[index]
    remaining = remaining.filter((entry) => entry !== match)
    pairs.push({ left: item, right: match })
  }
  return pairs
}
