import { useEffect, useMemo, useState } from 'react'
import { Combine, Search, X } from 'lucide-react'
import type { MediaItem } from '../../../shared/types'
import { useTheme } from '../themes'
import { plural } from '../utils'
import { LabTagPicker } from './LabTagPicker'
import { matchVideos } from './ScrollerSetup'
import type { TagMatch } from './ScrollerSetup'
import { VideoPickList, VideoPickThumb } from './VideoPickThumb'

interface SplicerSetupProps {
  videos: MediaItem[]
  initialId: string | null
  thumbIds: Set<string>
  onPick: (video: MediaItem) => void
  onClose: () => void
}

export function SplicerSetup({ videos, initialId, thumbIds, onPick, onClose }: SplicerSetupProps) {
  const { copy, icons } = useTheme()
  const SplicerIcon = icons.splicer
  const TagIcon = icons.tag

  const videoTagCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const video of videos) for (const tag of video.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [videos])

  const [query, setQuery] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [match, setMatch] = useState<TagMatch>('any')
  const [excluded, setExcluded] = useState<string[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(
    initialId && videos.some((video) => video.id === initialId) ? initialId : null
  )

  const matched = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    return matchVideos(videos, tags, match, excluded).filter((video) => {
      const name = video.fileName.toLowerCase()
      return terms.every((term) => name.includes(term))
    })
  }, [videos, tags, match, excluded, query])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'Enter' && selectedId) {
        const video = matched.find((item) => item.id === selectedId)
        if (video) onPick(video)
      } else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onPick, selectedId, matched])

  const selected = matched.find((video) => video.id === selectedId) ?? videos.find((video) => video.id === selectedId)

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal trimmer-setup" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <div className="modal-icon">
            <SplicerIcon size={20} />
          </div>
          <div>
            <h2>{copy.splicer}</h2>
            <p>Pick a video, then mark two or more spans to keep. Everything else is cut and the spans are stitched together.</p>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        {videos.length === 0 ? (
          <p className="modal-empty">Import some videos first — the Splicer only works with videos.</p>
        ) : (
          <>
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
              onToggle={(tag) =>
                setTags((current) =>
                  current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag]
                )
              }
              match={match}
              onMatch={setMatch}
              excluded={excluded}
              onExcluded={setExcluded}
              icon={TagIcon}
            />
            {selected && (
              <div className="trimmer-pick-preview">
                <VideoPickThumb item={selected} size="preview" ready={thumbIds.has(selected.id)} />
                <div className="trimmer-pick-preview-meta">
                  <strong>{selected.fileName}</strong>
                  {selected.tags.length > 0 && <span>{selected.tags.join(' · ')}</span>}
                </div>
              </div>
            )}
            <VideoPickList
              videos={matched}
              selectedId={selectedId}
              thumbIds={thumbIds}
              onSelect={setSelectedId}
              onPick={onPick}
            />
            <footer className="modal-footer">
              <span className="modal-summary">{plural(matched.length, 'video')}</span>
              <button className="btn btn-primary" disabled={!selected} onClick={() => selected && onPick(selected)}>
                <Combine size={16} /> Open splicer
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  )
}
