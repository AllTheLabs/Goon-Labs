import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Play, Plus, Search, Shuffle, X } from 'lucide-react'
import type { MediaItem } from '../../../shared/types'
import type { LabPrefs } from '../labPrefs'
import { useTheme } from '../themes'
import { plural } from '../utils'
import { INTENSITIES } from './BeatBar'
import type { BeatIntensity } from './BeatBar'
import { defaultLabLaunch, LabStartToggles } from './LabStartToggles'
import { LabTagPicker } from './LabTagPicker'
import { matchVideos } from './ScrollerSetup'
import type { TagMatch } from './ScrollerSetup'

export interface QueueEntry {
  key: number
  item: MediaItem
}

export interface QueueSettings {
  endless: boolean
  /** `null` means no behaviour is selected, so the bar mixes all of them at random. */
  intensity: BeatIntensity | null
}

const SETTINGS_KEY = 'queue.settings'

export function loadQueueSettings(): QueueSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<QueueSettings>
    return {
      endless: saved.endless === true,
      intensity: saved.intensity && saved.intensity in INTENSITIES ? saved.intensity : null
    }
  } catch {
    return { endless: false, intensity: null }
  }
}

export function saveQueueSettings(settings: QueueSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

interface QueueSetupProps {
  videos: MediaItem[]
  initialTags: string[]
  onStart: (entries: QueueEntry[], settings: QueueSettings, launch: LabPrefs) => void
  onClose: () => void
}

export function QueueSetup({ videos, initialTags, onStart, onClose }: QueueSetupProps) {
  const { copy, icons } = useTheme()
  const QueueIcon = icons.queue
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
  const [settings, setSettings] = useState(loadQueueSettings)
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
  const updateSettings = (patch: Partial<QueueSettings>) =>
    setSettings((current) => {
      const next = { ...current, ...patch }
      saveQueueSettings(next)
      return next
    })

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal queue-setup" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <div className="modal-icon">
            <QueueIcon size={20} />
          </div>
          <div>
            <h2>{copy.queue}</h2>
            <p>Queue up videos to play one after another while the beat bar pulses along.</p>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        {videos.length === 0 ? (
          <p className="modal-empty">Import some videos first. The queue only plays videos.</p>
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
              <div className="queue-intensity">
                <span className="queue-intensity-label">
                  <span className="field-label">Beat</span>
                  <small>{settings.intensity ? INTENSITIES[settings.intensity].label : 'Random mix of all four'}</small>
                </span>
                <div className="segmented">
                  {(Object.keys(INTENSITIES) as BeatIntensity[]).map((key) => (
                    <button
                      key={key}
                      className={settings.intensity === key ? 'active' : ''}
                      onClick={() => updateSettings({ intensity: settings.intensity === key ? null : key })}
                      title={settings.intensity === key ? 'Click again for a random mix' : undefined}
                    >
                      {INTENSITIES[key].label}
                    </button>
                  ))}
                </div>
              </div>
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
