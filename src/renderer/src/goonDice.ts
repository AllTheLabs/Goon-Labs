import type { MediaItem } from '../../shared/types'
import { defaultLabLaunch } from './components/LabStartToggles'
import { loadHypnoSettings } from './components/HypnoSetup'
import type { HypnoSettings } from './components/HypnoSetup'
import { loadPixelSettings } from './components/PixelSetup'
import type { PixelSettings } from './components/PixelSetup'
import { loadQueueSettings } from './components/QueueSetup'
import type { QueueEntry, QueueSettings } from './components/QueueSetup'
import { loadStillSettings } from './components/StillSetup'
import type { StillSettings } from './components/StillSetup'
import type { LabPrefs } from './labPrefs'

const SETTINGS_KEY = 'goonDice.settings'

export interface GoonDiceSettings {
  /** After the first confirm, the prompt stays hidden until the settings icon is used. */
  asked: boolean
  experimental: boolean
}

export type FeelingLuckyLab = 'scroller' | 'queue' | 'pixel' | 'hypno' | 'still'

export type FeelingLuckyRoll =
  | { lab: 'scroller'; videos: MediaItem[]; tags: string[]; launch: LabPrefs }
  | { lab: 'queue'; entries: QueueEntry[]; settings: QueueSettings; launch: LabPrefs }
  | { lab: 'pixel'; entries: QueueEntry[]; settings: PixelSettings; launch: LabPrefs }
  | { lab: 'hypno'; entries: QueueEntry[]; settings: HypnoSettings; launch: LabPrefs }
  | { lab: 'still'; photos: MediaItem[]; tags: string[]; settings: StillSettings; launch: LabPrefs }

export function loadGoonDiceSettings(): GoonDiceSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<GoonDiceSettings>
    return {
      asked: saved.asked === true,
      experimental: saved.experimental === true
    }
  } catch {
    return { asked: false, experimental: false }
  }
}

export function saveGoonDiceSettings(settings: GoonDiceSettings): void {
  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({ asked: settings.asked === true, experimental: settings.experimental === true })
  )
}

function shuffle<T>(list: T[]): T[] {
  const next = [...list]
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[next[i], next[j]] = [next[j], next[i]]
  }
  return next
}

function pickPool(items: MediaItem[], cap: number): { items: MediaItem[]; tags: string[] } {
  if (items.length === 0) return { items: [], tags: [] }
  const tags = [...new Set(items.flatMap((item) => item.tags))]
  let pool = items
  let used: string[] = []
  if (tags.length > 0 && Math.random() < 0.65) {
    const tag = tags[Math.floor(Math.random() * tags.length)]
    const tagged = items.filter((item) => item.tags.includes(tag))
    if (tagged.length > 0) {
      pool = tagged
      used = [tag]
    }
  }
  const shuffled = shuffle(pool)
  return { items: shuffled.slice(0, Math.min(shuffled.length, cap)), tags: used }
}

function asQueue(items: MediaItem[]): QueueEntry[] {
  return items.map((item, index) => ({ key: index + 1, item }))
}

export function rollFeelingLucky(
  items: MediaItem[],
  experimental: boolean
): FeelingLuckyRoll | { error: string } {
  const videos = items.filter((item) => item.type === 'video')
  const photos = items.filter((item) => item.type === 'image')
  const labs: FeelingLuckyLab[] = []
  if (videos.length > 0) {
    labs.push('scroller', 'queue', 'hypno')
    if (experimental) labs.push('pixel')
  }
  if (experimental && photos.length > 0) labs.push('still')
  if (labs.length === 0) {
    return {
      error: experimental
        ? 'Import some photos or videos first.'
        : 'Import some videos first, or include experimental labs to use photos in Still Station.'
    }
  }

  const lab = labs[Math.floor(Math.random() * labs.length)]
  const launch = defaultLabLaunch()

  if (lab === 'still') {
    const pool = pickPool(photos, 48)
    return {
      lab,
      photos: pool.items,
      tags: pool.tags,
      settings: { ...loadStillSettings(), endless: true },
      launch
    }
  }

  if (lab === 'scroller') {
    const pool = pickPool(videos, 64)
    return { lab, videos: pool.items, tags: pool.tags, launch }
  }

  const pool = pickPool(videos, 36)
  const entries = asQueue(pool.items)
  if (lab === 'queue') {
    return { lab, entries, settings: { ...loadQueueSettings(), endless: true }, launch }
  }
  if (lab === 'pixel') {
    return { lab, entries, settings: { ...loadPixelSettings(), endless: true }, launch }
  }
  return { lab, entries, settings: loadHypnoSettings(), launch }
}
