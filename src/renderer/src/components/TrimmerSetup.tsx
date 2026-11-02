import { useEffect, useMemo, useState } from 'react'
import { Scissors, Search, X } from 'lucide-react'
import type { MediaItem } from '../../../shared/types'
import { useTheme } from '../themes'
import { mediaUrl, plural } from '../utils'
import { matchVideos } from './ScrollerSetup'
import type { TagMatch } from './ScrollerSetup'

interface TrimmerSetupProps {
  videos: MediaItem[]
  initialId: string | null
  onPick: (video: MediaItem) => void
  onClose: () => void
}

export function TrimmerSetup({ videos, initialId, onPick, onClose }: TrimmerSetupProps) {
  const { copy, icons } = useTheme()
  const TrimmerIcon = icons.trimmer
  const TagIcon = icons.tag

  const videoTagCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const video of videos) for (const tag of video.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [videos])

  const [query, setQuery] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [match, setMatch] = useState<TagMatch>('any')
  const [selectedId, setSelectedId] = useState<string | null>(
    initialId && videos.some((video) => video.id === initialId) ? initialId : null
  )

  const matched = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    return matchVideos(videos, tags, match).filter((video) => {
      const name = video.fileName.toLowerCase()
      return terms.every((term) => name.includes(term) || video.tags.some((tag) => tag.includes(term)))
    })
  }, [videos, tags, match, query])

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
            <TrimmerIcon size={20} />
          </div>
          <div>
            <h2>{copy.trimmer}</h2>
            <p>Pick a video, then drag the handles on the timeline to keep only the part you want.</p>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        {videos.length === 0 ? (
          <p className="modal-empty">Import some videos first — the Trimmer only works with videos.</p>
        ) : (
          <>
            <div className="scroller-setup-row">
              <span className="field-label">Find a video</span>
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
              <div className="tag-picker">
                {videoTagCounts.map(([tag, count]) => (
                  <button
                    key={tag}
                    className={`tag-pick ${tags.includes(tag) ? 'active' : ''}`}
                    onClick={() =>
                      setTags((current) =>
                        current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag]
                      )
                    }
                  >
                    <TagIcon size={13} />
                    {tag}
                    <span className="tag-pick-count">{count}</span>
                  </button>
                ))}
              </div>
            )}
            {selected && (
              <div className="trimmer-pick-preview">
                <video src={`${mediaUrl(selected)}#t=0.5`} muted preload="metadata" playsInline />
                <div className="trimmer-pick-preview-meta">
                  <strong>{selected.fileName}</strong>
                  {selected.tags.length > 0 && <span>{selected.tags.join(' · ')}</span>}
                </div>
              </div>
            )}
            <div className="queue-list">
              {matched.length === 0 ? (
                <p className="queue-empty">No videos match.</p>
              ) : (
                matched.map((video) => (
                  <button
                    key={video.id}
                    className={`queue-row ${video.id === selectedId ? 'selected' : ''}`}
                    onClick={() => setSelectedId(video.id)}
                    onDoubleClick={() => onPick(video)}
                  >
                    <video
                      className="trimmer-row-thumb"
                      src={`${mediaUrl(video)}#t=0.5`}
                      muted
                      preload="metadata"
                      playsInline
                    />
                    <span className="queue-row-text">
                      <span className="queue-row-name">{video.fileName}</span>
                      {video.tags.length > 0 && (
                        <span className="queue-row-tags">{video.tags.join(' · ')}</span>
                      )}
                    </span>
                  </button>
                ))
              )}
            </div>
            <footer className="modal-footer">
              <span className="modal-summary">{plural(matched.length, 'video')}</span>
              <button className="btn btn-primary" disabled={!selected} onClick={() => selected && onPick(selected)}>
                <Scissors size={16} /> Open trimmer
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  )
}
