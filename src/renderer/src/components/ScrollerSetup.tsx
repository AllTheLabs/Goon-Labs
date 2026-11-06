import { useEffect, useMemo, useState } from 'react'
import { Clapperboard, Hash, Play, X } from 'lucide-react'
import type { MediaItem } from '../../../shared/types'
import type { LabPrefs } from '../labPrefs'
import { plural } from '../utils'
import { LabTagPicker } from './LabTagPicker'
import { LabSetupFrame } from './Mascot'
import { defaultLabLaunch, LabStartToggles } from './LabStartToggles'

export type TagMatch = 'any' | 'all'

interface ScrollerSetupProps {
  videos: MediaItem[]
  initialTags: string[]
  onStart: (videos: MediaItem[], tags: string[], launch: LabPrefs) => void
  onClose: () => void
}

export function matchVideos(
  videos: MediaItem[],
  tags: string[],
  match: TagMatch,
  excluded: string[] = []
): MediaItem[] {
  return videos.filter((video) => {
    if (excluded.length > 0 && excluded.some((tag) => video.tags.includes(tag))) return false
    if (tags.length === 0) return true
    return match === 'any'
      ? tags.some((tag) => video.tags.includes(tag))
      : tags.every((tag) => video.tags.includes(tag))
  })
}

export function ScrollerSetup({ videos, initialTags, onStart, onClose }: ScrollerSetupProps) {
  const videoTagCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const video of videos) {
      for (const tag of video.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [videos])

  const [tags, setTags] = useState(() =>
    initialTags.filter((tag) => videoTagCounts.some(([t]) => t === tag))
  )
  const [match, setMatch] = useState<TagMatch>('any')
  const [excluded, setExcluded] = useState<string[]>([])
  const [launch, setLaunch] = useState(defaultLabLaunch)
  const matched = useMemo(
    () => matchVideos(videos, tags, match, excluded),
    [videos, tags, match, excluded]
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const toggle = (tag: string) =>
    setTags((current) =>
      current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag]
    )

  return (
    <LabSetupFrame onClose={onClose}>
      <div className="modal scroller-setup">
        <header className="modal-header">
          <div className="modal-icon">
            <Clapperboard size={20} />
          </div>
          <div>
            <h2>Scroller</h2>
            <p>Pick tags to play every matching video at once, tiled and endlessly scrolling.</p>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        {videos.length === 0 ? (
          <p className="modal-empty">Import some videos first — the Scroller only plays videos.</p>
        ) : (
          <>
            {videoTagCounts.length === 0 ? (
              <p className="modal-empty">
                None of your videos are tagged yet. You can still start with all of them.
              </p>
            ) : (
              <LabTagPicker
                counts={videoTagCounts}
                selected={tags}
                onToggle={toggle}
                match={match}
                onMatch={setMatch}
                excluded={excluded}
                onExcluded={setExcluded}
                icon={Hash}
                autoFocus
              />
            )}

            <LabStartToggles value={launch} onChange={setLaunch} />

            <footer className="modal-footer">
              <span className="modal-summary">
                {tags.length === 0
                  ? `No tags selected — all ${plural(videos.length, 'video')}`
                  : `${plural(matched.length, 'video')} match`}
              </span>
              <button
                className="btn btn-primary"
                disabled={matched.length === 0}
                onClick={() => onStart(matched, tags, launch)}
              >
                <Play size={16} fill="currentColor" /> Start scroller
              </button>
            </footer>
          </>
        )}
      </div>
    </LabSetupFrame>
  )
}
