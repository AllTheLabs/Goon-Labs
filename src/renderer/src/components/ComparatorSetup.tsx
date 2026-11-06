import { useEffect, useMemo, useState } from 'react'
import { Play, X } from 'lucide-react'
import type { ComponentType } from 'react'
import type { LucideProps } from 'lucide-react'
import type { MediaItem } from '../../../shared/types'
import type { LabPrefs } from '../labPrefs'
import { useTheme } from '../themes'
import { plural } from '../utils'
import { LabTagPicker } from './LabTagPicker'
import { LabSetupFrame } from './Mascot'
import { defaultLabLaunch, LabStartToggles } from './LabStartToggles'
import { matchVideos } from './ScrollerSetup'
import type { TagMatch } from './ScrollerSetup'

export interface ComparatorSettings {
  pink: boolean
  endless: boolean
}

const SETTINGS_KEY = 'comparator.settings'

export function loadComparatorSettings(): ComparatorSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<ComparatorSettings>
    return {
      pink: saved.pink === true,
      endless: saved.endless !== false
    }
  } catch {
    return { pink: false, endless: true }
  }
}

export function saveComparatorSettings(settings: ComparatorSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

interface SideState {
  tags: string[]
  match: TagMatch
  excluded: string[]
}

function emptySide(initial: string[], known: [string, number][]): SideState {
  return {
    tags: initial.filter((tag) => known.some(([entry]) => entry === tag)),
    match: 'any',
    excluded: []
  }
}

interface ComparatorSetupProps {
  videos: MediaItem[]
  initialTags: string[]
  onStart: (
    left: MediaItem[],
    right: MediaItem[],
    leftTags: string[],
    rightTags: string[],
    settings: ComparatorSettings,
    launch: LabPrefs
  ) => void
  onClose: () => void
}

export function ComparatorSetup({ videos, initialTags, onStart, onClose }: ComparatorSetupProps) {
  const { copy, icons } = useTheme()
  const ComparatorIcon = icons.comparator
  const TagIcon = icons.tag

  const videoTagCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const video of videos) for (const tag of video.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [videos])

  const [left, setLeft] = useState(() => emptySide(initialTags, videoTagCounts))
  const [right, setRight] = useState(() => emptySide([], videoTagCounts))
  const [settings, setSettings] = useState(loadComparatorSettings)
  const [launch, setLaunch] = useState(defaultLabLaunch)

  const leftVideos = useMemo(
    () => matchVideos(videos, left.tags, left.match, left.excluded),
    [videos, left]
  )
  const rightVideos = useMemo(
    () => matchVideos(videos, right.tags, right.match, right.excluded),
    [videos, right]
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const updateSettings = (patch: Partial<ComparatorSettings>) =>
    setSettings((current) => {
      const next = { ...current, ...patch }
      saveComparatorSettings(next)
      return next
    })

  const ready = leftVideos.length > 0 && rightVideos.length > 0

  return (
    <LabSetupFrame onClose={onClose}>
      <div className="modal comparator-setup">
        <header className="modal-header">
          <div className="modal-icon">
            <ComparatorIcon size={20} />
          </div>
          <div>
            <h2>{copy.comparator}</h2>
            <p>
              Two tag pools, side by side. Matching clips play together through a wet reverb —
              hover a pane to lean the mix that way.
            </p>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        {videos.length === 0 ? (
          <p className="modal-empty">Import some videos first. The Comparator only plays videos.</p>
        ) : (
          <>
            <div className="comparator-columns">
              <SideColumn
                label="Left"
                counts={videoTagCounts}
                side={left}
                onChange={setLeft}
                videos={leftVideos}
                icon={TagIcon}
              />
              <div className="comparator-vs" aria-hidden="true">
                <ComparatorIcon size={18} />
              </div>
              <SideColumn
                label="Right"
                counts={videoTagCounts}
                side={right}
                onChange={setRight}
                videos={rightVideos}
                icon={TagIcon}
              />
            </div>

            <div className="queue-options">
              <label className={`endless-toggle ${settings.pink ? 'on' : ''}`}>
                <input
                  type="checkbox"
                  checked={settings.pink}
                  onChange={(e) => updateSettings({ pink: e.target.checked })}
                />
                <span>
                  <strong>Pink filter</strong>
                  <small>Washes both panes in hot pink</small>
                </span>
              </label>
              <label className={`endless-toggle ${settings.endless ? 'on' : ''}`}>
                <input
                  type="checkbox"
                  checked={settings.endless}
                  onChange={(e) => updateSettings({ endless: e.target.checked })}
                />
                <span>
                  <strong>Endless desire</strong>
                  <small>Keep pairing clips until you exit</small>
                </span>
              </label>
            </div>

            <LabStartToggles value={launch} onChange={setLaunch} />

            <footer className="modal-footer">
              <span className="modal-summary">
                {!ready
                  ? 'Pick tags so each side has at least one video'
                  : `${plural(leftVideos.length, 'video')} on the left · ${plural(rightVideos.length, 'video')} on the right`}
              </span>
              <button
                className="btn btn-primary"
                disabled={!ready}
                onClick={() => onStart(leftVideos, rightVideos, left.tags, right.tags, settings, launch)}
              >
                <Play size={16} fill="currentColor" /> Start
              </button>
            </footer>
          </>
        )}
      </div>
    </LabSetupFrame>
  )
}

function SideColumn({
  label,
  counts,
  side,
  onChange,
  videos,
  icon
}: {
  label: string
  counts: [string, number][]
  side: SideState
  onChange: (next: SideState) => void
  videos: MediaItem[]
  icon: ComponentType<LucideProps>
}) {
  const toggle = (tag: string) =>
    onChange({
      ...side,
      tags: side.tags.includes(tag) ? side.tags.filter((entry) => entry !== tag) : [...side.tags, tag]
    })

  return (
    <section className="queue-column comparator-side">
      <div className="queue-column-head">
        <span className="field-label">{label}</span>
        <span className="comparator-side-count">{plural(videos.length, 'video')}</span>
      </div>
      {counts.length === 0 ? (
        <p className="queue-empty">None of your videos are tagged yet. This side will use all of them.</p>
      ) : (
        <LabTagPicker
          counts={counts}
          selected={side.tags}
          onToggle={toggle}
          match={side.match}
          onMatch={(match) => onChange({ ...side, match })}
          excluded={side.excluded}
          onExcluded={(excluded) => onChange({ ...side, excluded })}
          icon={icon}
        />
      )}
      <div className="queue-list">
        {videos.length === 0 ? (
          <p className="queue-empty">No videos match.</p>
        ) : (
          videos.map((video) => (
            <div key={video.id} className="queue-row queued">
              <span className="queue-row-text">
                <span className="queue-row-name">{video.fileName}</span>
                {video.tags.length > 0 && <span className="queue-row-tags">{video.tags.join(' · ')}</span>}
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  )
}
