import { useEffect, useMemo, useState } from 'react'
import { Play, X } from 'lucide-react'
import type { MediaItem } from '../../../shared/types'
import type { LabPrefs } from '../labPrefs'
import { useTheme } from '../themes'
import { plural } from '../utils'
import { LabTagPicker } from './LabTagPicker'
import { defaultLabLaunch, LabStartToggles } from './LabStartToggles'
import { matchVideos } from './ScrollerSetup'
import type { TagMatch } from './ScrollerSetup'

export const STILL_SPEEDS = {
  linger: { label: 'Linger', hold: 14, fade: 1.6 },
  drift: { label: 'Drift', hold: 8, fade: 1.2 },
  sweep: { label: 'Sweep', hold: 4.2, fade: 0.85 }
} as const

export type StillSpeed = keyof typeof STILL_SPEEDS

export interface StillSettings {
  speed: StillSpeed
  endless: boolean
}

const SETTINGS_KEY = 'still.settings'

export function loadStillSettings(): StillSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<StillSettings>
    return {
      speed: saved.speed && saved.speed in STILL_SPEEDS ? saved.speed : 'drift',
      endless: saved.endless !== false
    }
  } catch {
    return { speed: 'drift', endless: true }
  }
}

export function saveStillSettings(settings: StillSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

interface StillSetupProps {
  photos: MediaItem[]
  initialTags: string[]
  onStart: (photos: MediaItem[], tags: string[], settings: StillSettings, launch: LabPrefs) => void
  onClose: () => void
}

export function StillSetup({ photos, initialTags, onStart, onClose }: StillSetupProps) {
  const { copy, icons } = useTheme()
  const StillIcon = icons.stillStation
  const TagIcon = icons.tag

  const photoTagCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const photo of photos) for (const tag of photo.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [photos])

  const [tags, setTags] = useState(() =>
    initialTags.filter((tag) => photoTagCounts.some(([t]) => t === tag))
  )
  const [match, setMatch] = useState<TagMatch>('any')
  const [settings, setSettings] = useState(loadStillSettings)
  const [launch, setLaunch] = useState(defaultLabLaunch)
  const matched = useMemo(() => matchVideos(photos, tags, match), [photos, tags, match])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const toggle = (tag: string) =>
    setTags((current) =>
      current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag]
    )
  const updateSettings = (patch: Partial<StillSettings>) =>
    setSettings((current) => {
      const next = { ...current, ...patch }
      saveStillSettings(next)
      return next
    })

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal scroller-setup" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <div className="modal-icon">
            <StillIcon size={20} />
          </div>
          <div>
            <h2 className="lab-title">
              {copy.stillStation}
              <span className="lab-experimental">Experimental</span>
            </h2>
            <p>Slow zoom and pan across tagged photos. Ken Burns, full screen.</p>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        {photos.length === 0 ? (
          <p className="modal-empty">Import some photos first. Still Station only shows pictures.</p>
        ) : (
          <>
            {photoTagCounts.length === 0 ? (
              <p className="modal-empty">
                None of your photos are tagged yet. You can still start with all of them.
              </p>
            ) : (
              <LabTagPicker
                counts={photoTagCounts}
                selected={tags}
                onToggle={toggle}
                match={match}
                onMatch={setMatch}
                icon={TagIcon}
                autoFocus
              />
            )}

            <div className="queue-options">
              <div className="pixel-strength-row">
                <span>
                  <strong>Drift speed</strong>
                  <small>How long each photo lingers before the next crossfade</small>
                </span>
                <div className="segmented">
                  {(Object.keys(STILL_SPEEDS) as StillSpeed[]).map((key) => (
                    <button
                      key={key}
                      className={settings.speed === key ? 'active' : ''}
                      onClick={() => updateSettings({ speed: key })}
                    >
                      {STILL_SPEEDS[key].label}
                    </button>
                  ))}
                </div>
              </div>
              <label className={`endless-toggle ${settings.endless ? 'on' : ''}`}>
                <input
                  type="checkbox"
                  checked={settings.endless}
                  onChange={(e) => updateSettings({ endless: e.target.checked })}
                />
                <span>
                  <strong>Endless desire</strong>
                  <small>Loop the photos until you exit</small>
                </span>
              </label>
            </div>

            <LabStartToggles value={launch} onChange={setLaunch} />

            <footer className="modal-footer">
              <span className="modal-summary">
                {tags.length === 0
                  ? `No tags selected — all ${plural(photos.length, 'photo')}`
                  : `${plural(matched.length, 'photo')} match`}
                {matched.length > 0
                  ? settings.endless
                    ? ', looping'
                    : ', once through'
                  : ''}
              </span>
              <button
                className="btn btn-primary"
                disabled={matched.length === 0}
                onClick={() => onStart(matched, tags, settings, launch)}
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
