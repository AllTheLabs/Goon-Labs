import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Play, Plus, Search, Shuffle, X } from 'lucide-react'
import type { MediaItem } from '../../../shared/types'
import type { LabPrefs } from '../labPrefs'
import { useTheme } from '../themes'
import { plural } from '../utils'
import { defaultLabLaunch, LabStartToggles } from './LabStartToggles'
import type { QueueEntry } from './QueueSetup'
import { matchVideos } from './ScrollerSetup'
import type { TagMatch } from './ScrollerSetup'

export const PIXEL_STRENGTH_MIN = 1
export const PIXEL_STRENGTH_MAX = 5
export const PIXEL_STRENGTH_LABELS = ['Fine', 'Soft', 'Medium', 'Heavy', 'Blocky'] as const

export type PixelStrength = 1 | 2 | 3 | 4 | 5

export interface PixelSettings {
  endless: boolean
  faces: boolean
  nsfw: boolean
  /** 1 = fine mosaic, 5 = heavy blocks. */
  strength: PixelStrength
  /** Leave dark-skinned male genitalia unpixelated. */
  skipDarkMale: boolean
}

export function clampPixelStrength(value: unknown): PixelStrength {
  const n = Math.round(Number(value))
  if (n >= PIXEL_STRENGTH_MIN && n <= PIXEL_STRENGTH_MAX) return n as PixelStrength
  return 3
}

/** Mosaic cell size in display pixels. Higher = more pixelated. */
export function pixelBlockSize(strength: PixelStrength): number {
  return [4, 7, 11, 18, 28][strength - 1]
}

const SETTINGS_KEY = 'pixel.settings'

export function loadPixelSettings(): PixelSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<PixelSettings>
    return {
      endless: saved.endless === true,
      faces: saved.faces !== false,
      nsfw: saved.nsfw !== false,
      strength: clampPixelStrength(saved.strength),
      skipDarkMale: saved.skipDarkMale !== false
    }
  } catch {
    return { endless: false, faces: true, nsfw: true, strength: 3, skipDarkMale: true }
  }
}

export function savePixelSettings(settings: PixelSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

interface PixelSetupProps {
  videos: MediaItem[]
  initialTags: string[]
  onStart: (entries: QueueEntry[], settings: PixelSettings, launch: LabPrefs) => void
  onClose: () => void
}

export function PixelSetup({ videos, initialTags, onStart, onClose }: PixelSetupProps) {
  const { copy, icons } = useTheme()
  const PixelIcon = icons.pixelPerfection
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
  const [queue, setQueue] = useState<QueueEntry[]>([])
  const [settings, setSettings] = useState(loadPixelSettings)
  const [launch, setLaunch] = useState(defaultLabLaunch)
  const nextKey = useRef(0)

  const matched = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    return matchVideos(videos, tags, match).filter((video) => {
      const name = video.fileName.toLowerCase()
      return terms.every((term) => name.includes(term) || video.tags.some((tag) => tag.includes(term)))
    })
  }, [videos, tags, match, query])

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
  const updateSettings = (patch: Partial<PixelSettings>) =>
    setSettings((current) => {
      const next = { ...current, ...patch }
      savePixelSettings(next)
      return next
    })

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal queue-setup" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <div className="modal-icon">
            <PixelIcon size={20} />
          </div>
          <div>
            <h2 className="lab-title">
              {copy.pixelPerfection}
              <span className="lab-experimental">Experimental</span>
            </h2>
            <p>Queue videos, then pixelate faces and NSFW regions live while they play.</p>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        {videos.length === 0 ? (
          <p className="modal-empty">Import some videos first. Pixel Perfection only plays videos.</p>
        ) : (
          <>
            <div className="queue-columns">
              <section className="queue-column">
                <div className="queue-column-head">
                  <span className="field-label">Find videos</span>
                  <div className="segmented small">
                    <button className={match === 'any' ? 'active' : ''} onClick={() => setMatch('any')}>
                      Any tag
                    </button>
                    <button className={match === 'all' ? 'active' : ''} onClick={() => setMatch('all')}>
                      All tags
                    </button>
                  </div>
                </div>
                <div className="search">
                  <Search size={16} className="search-icon" />
                  <input
                    className="input search-input"
                    placeholder="Search names & tags…"
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
                {videoTagCounts.length > 0 && (
                  <div className="tag-picker queue-tags">
                    {videoTagCounts.map(([tag, count]) => (
                      <button
                        key={tag}
                        className={`tag-pick ${tags.includes(tag) ? 'active' : ''}`}
                        onClick={() => toggleTag(tag)}
                      >
                        <TagIcon size={13} />
                        {tag}
                        <span className="tag-pick-count">{count}</span>
                      </button>
                    ))}
                  </div>
                )}
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
              <label className={`endless-toggle ${settings.endless ? 'on' : ''}`}>
                <input
                  type="checkbox"
                  checked={settings.endless}
                  onChange={(e) => updateSettings({ endless: e.target.checked })}
                />
                <span>
                  <strong>Endless desire</strong>
                  <small>Loop the whole queue until you exit</small>
                </span>
              </label>
              <label className={`endless-toggle ${settings.faces ? 'on' : ''}`}>
                <input
                  type="checkbox"
                  checked={settings.faces}
                  onChange={(e) => updateSettings({ faces: e.target.checked })}
                />
                <span>
                  <strong>Pixelate faces</strong>
                  <small>You can toggle this live in the lab</small>
                </span>
              </label>
              <label className={`endless-toggle ${settings.nsfw ? 'on' : ''}`}>
                <input
                  type="checkbox"
                  checked={settings.nsfw}
                  onChange={(e) => updateSettings({ nsfw: e.target.checked })}
                />
                <span>
                  <strong>Pixelate NSFW</strong>
                  <small>Genitals and similar exposed regions</small>
                </span>
              </label>
              <label className={`endless-toggle ${settings.skipDarkMale ? 'on' : ''}`}>
                <input
                  type="checkbox"
                  checked={settings.skipDarkMale}
                  onChange={(e) => updateSettings({ skipDarkMale: e.target.checked })}
                />
                <span>
                  <strong>Skip dark-skinned male</strong>
                  <small>Leave dark-skinned male genitalia unpixelated</small>
                </span>
              </label>
              <label className="pixel-strength-row">
                <span>
                  <strong>Pixelation</strong>
                  <small>How coarse the mosaic is — you can change this in the lab</small>
                </span>
                <input
                  type="range"
                  min={PIXEL_STRENGTH_MIN}
                  max={PIXEL_STRENGTH_MAX}
                  step={1}
                  value={settings.strength}
                  onChange={(e) => updateSettings({ strength: clampPixelStrength(e.target.value) })}
                />
                <span className="pixel-strength-value">{PIXEL_STRENGTH_LABELS[settings.strength - 1]}</span>
              </label>
            </div>

            <LabStartToggles value={launch} onChange={setLaunch} />

            <footer className="modal-footer">
              <span className="modal-summary">
                {queue.length === 0
                  ? 'Nothing queued yet'
                  : settings.endless
                    ? `${plural(queue.length, 'video')}, looping`
                    : `${plural(queue.length, 'video')}, played once`}
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
