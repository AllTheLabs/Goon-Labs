import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Play, Plus, Search, Shuffle, X } from 'lucide-react'
import type { MediaItem } from '../../../shared/types'
import type { LabPrefs } from '../labPrefs'
import { useTheme } from '../themes'
import { plural } from '../utils'
import { defaultLabLaunch, LabStartToggles } from './LabStartToggles'
import type { QueueEntry } from './QueueSetup'
import { LabTagPicker } from './LabTagPicker'
import { matchVideos } from './ScrollerSetup'
import type { TagMatch } from './ScrollerSetup'

export const HYPNO_SPEEDS = {
  linger: { label: 'Linger', duration: 1.6, arp: 4 },
  flash: { label: 'Flash', duration: 0.64, arp: 3 },
  strobe: { label: 'Strobe', duration: 0.3, arp: 2 }
} as const

export type HypnoSpeed = keyof typeof HYPNO_SPEEDS

export interface HypnoSettings {
  speed: HypnoSpeed
  rumble: boolean
}

const SETTINGS_KEY = 'hypno.settings'

export function loadHypnoSettings(): HypnoSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<HypnoSettings>
    return {
      speed: saved.speed && saved.speed in HYPNO_SPEEDS ? saved.speed : 'flash',
      rumble: saved.rumble !== false
    }
  } catch {
    return { speed: 'flash', rumble: true }
  }
}

export function saveHypnoSettings(settings: HypnoSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

interface HypnoSetupProps {
  videos: MediaItem[]
  initialTags: string[]
  onStart: (entries: QueueEntry[], settings: HypnoSettings, launch: LabPrefs) => void
  onClose: () => void
}

export function HypnoSetup({ videos, initialTags, onStart, onClose }: HypnoSetupProps) {
  const { copy, icons } = useTheme()
  const HypnoIcon = icons.hypnoStation
  const TagIcon = icons.tag

  const videoTagCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const video of videos) for (const tag of video.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [videos])

  const [query, setQuery] = useState('')
  const [tags, setTags] = useState(() =>
    initialTags.filter((tag) => videoTagCounts.some(([t]) => t === tag))
  )
  const [match, setMatch] = useState<TagMatch>('any')
  const [excluded, setExcluded] = useState<string[]>([])
  const [queue, setQueue] = useState<QueueEntry[]>([])
  const [settings, setSettings] = useState(loadHypnoSettings)
  const [launch, setLaunch] = useState(defaultLabLaunch)
  const nextKey = useRef(0)

  const matched = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    return matchVideos(videos, tags, match, excluded).filter((video) => {
      const name = video.fileName.toLowerCase()
      return terms.every((term) => name.includes(term))
    })
  }, [videos, tags, match, excluded, query])

  const queuedCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const entry of queue) counts.set(entry.item.id, (counts.get(entry.item.id) ?? 0) + 1)
    return counts
  }, [queue])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const add = (items: MediaItem[]) =>
    setQueue((current) => [...current, ...items.map((item) => ({ key: ++nextKey.current, item }))])
  const remove = (key: number) => setQueue((current) => current.filter((e) => e.key !== key))
  const move = (index: number, delta: number) =>
    setQueue((current) => {
      const target = index + delta
      if (target < 0 || target >= current.length) return current
      const next = [...current]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  const shuffle = () =>
    setQueue((current) => {
      const next = [...current]
      for (let i = next.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[next[i], next[j]] = [next[j], next[i]]
      }
      return next
    })
  const toggleTag = (tag: string) =>
    setTags((current) => (current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag]))
  const updateSettings = (patch: Partial<HypnoSettings>) =>
    setSettings((current) => {
      const next = { ...current, ...patch }
      saveHypnoSettings(next)
      return next
    })

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal queue-setup" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <div className="modal-icon">
            <HypnoIcon size={20} />
          </div>
          <div>
            <h2>{copy.hypnoStation}</h2>
            <p>Queue videos, then flash random snippets on a loop with wet reverb and a drifting colour wash.</p>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        {videos.length === 0 ? (
          <p className="modal-empty">Import some videos first. Hypno Station only plays videos.</p>
        ) : (
          <>
            <div className="queue-columns">
              <section className="queue-column">
                <div className="queue-column-head">
                  <span className="field-label">Find videos</span>
                </div>
                <div className="search">
                  <Search size={16} className="search-icon" />
                  <input
                    className="input search-input"
                    placeholder="Search names…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    autoFocus
                  />
                  {query && (
                    <button className="search-clear" onClick={() => setQuery('')} aria-label="Clear search">
                      <X size={14} />
                    </button>
                  )}
                </div>
                <LabTagPicker
                  counts={videoTagCounts}
                  selected={tags}
                  onToggle={toggleTag}
                  match={match}
                  onMatch={setMatch}
                  excluded={excluded}
                  onExcluded={setExcluded}
                  icon={TagIcon}
                />
                <div className="queue-list">
                  {matched.length === 0 ? (
                    <p className="queue-empty">No videos match.</p>
                  ) : (
                    matched.map((video) => (
                      <button key={video.id} className="queue-row" onClick={() => add([video])} title="Add to queue">
                        <span className="queue-row-text">
                          <span className="queue-row-name">{video.fileName}</span>
                          {video.tags.length > 0 && (
                            <span className="queue-row-tags">{video.tags.join(' · ')}</span>
                          )}
                        </span>
                        {queuedCounts.has(video.id) && (
                          <span className="queue-badge">×{queuedCounts.get(video.id)}</span>
                        )}
                        <Plus size={16} className="queue-row-add" />
                      </button>
                    ))
                  )}
                </div>
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={matched.length === 0}
                  onClick={() => add(matched)}
                >
                  <Plus size={14} /> Add all {matched.length}
                </button>
              </section>

              <section className="queue-column">
                <div className="queue-column-head">
                  <span className="field-label">Queue · {plural(queue.length, 'video')}</span>
                  <div className="queue-head-actions">
                    <button className="btn btn-ghost btn-sm" disabled={queue.length < 2} onClick={shuffle}>
                      <Shuffle size={14} /> Shuffle
                    </button>
                    <button className="btn btn-ghost btn-sm" disabled={queue.length === 0} onClick={() => setQueue([])}>
                      Clear
                    </button>
                  </div>
                </div>
                <div className="queue-list queued">
                  {queue.length === 0 ? (
                    <p className="queue-empty">Click videos on the left to queue them up.</p>
                  ) : (
                    queue.map((entry, index) => (
                      <div key={entry.key} className="queue-row queued">
                        <span className="queue-index">{index + 1}</span>
                        <span className="queue-row-text">
                          <span className="queue-row-name">{entry.item.fileName}</span>
                        </span>
                        <button className="queue-icon-btn" onClick={() => move(index, -1)} disabled={index === 0} title="Move up">
                          <ArrowUp size={14} />
                        </button>
                        <button
                          className="queue-icon-btn"
                          onClick={() => move(index, 1)}
                          disabled={index === queue.length - 1}
                          title="Move down"
                        >
                          <ArrowDown size={14} />
                        </button>
                        <button className="queue-icon-btn" onClick={() => remove(entry.key)} title="Remove">
                          <X size={14} />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </section>
            </div>

            <div className="queue-options">
              <div className="pixel-strength-row">
                <span>
                  <strong>Cut speed</strong>
                  <small>How fast clips cut. The rumble arpeggio follows this, and the kick lands on each cut.</small>
                </span>
                <div className="segmented">
                  {(Object.keys(HYPNO_SPEEDS) as HypnoSpeed[]).map((key) => (
                    <button
                      key={key}
                      className={settings.speed === key ? 'active' : ''}
                      onClick={() => updateSettings({ speed: key })}
                    >
                      {HYPNO_SPEEDS[key].label}
                    </button>
                  ))}
                </div>
              </div>
              <label className={`endless-toggle ${settings.rumble ? 'on' : ''}`}>
                <input
                  type="checkbox"
                  checked={settings.rumble}
                  onChange={(e) => updateSettings({ rumble: e.target.checked })}
                />
                <span>
                  <strong>Melodic rumble</strong>
                  <small>Dark synth arpeggio in time with the cuts, kick last — stays out of the reverb</small>
                </span>
              </label>
            </div>

            <LabStartToggles value={launch} onChange={setLaunch} />

            <footer className="modal-footer">
              <span className="modal-summary">
                {queue.length === 0
                  ? 'Nothing queued yet'
                  : `${plural(queue.length, 'video')}, looping until you exit`}
              </span>
              <button
                className="btn btn-primary"
                disabled={queue.length === 0}
                onClick={() => onStart(queue, settings, launch)}
              >
                <Play size={16} fill="currentColor" /> Start
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  )
}
