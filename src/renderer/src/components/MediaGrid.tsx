import { memo, useEffect, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import { Check, FileWarning, Pin, Play } from 'lucide-react'
import type { MediaItem } from '../../../shared/types'
import { extensionOf, formatDuration, mediaUrl } from '../utils'

interface MediaGridProps {
  items: MediaItem[]
  selected: Set<string>
  activeId: string | null
  pinned: Set<string>
  onItemClick: (id: string, event: MouseEvent) => void
  onToggleCheck: (id: string) => void
  onTogglePin: (id: string) => void
  onOpen: (id: string) => void
}

export function MediaGrid({ items, selected, activeId, pinned, ...handlers }: MediaGridProps) {
  return (
    <div className="media-grid">
      {items.map((item) => (
        <MediaCard
          key={item.id}
          item={item}
          selected={selected.has(item.id)}
          active={item.id === activeId}
          pinned={pinned.has(item.id)}
          {...handlers}
        />
      ))}
    </div>
  )
}

export function LibraryShelf({
  title,
  items,
  ...rest
}: { title: string } & MediaGridProps) {
  if (items.length === 0) return null
  return (
    <section className="library-shelf">
      <h2 className="library-shelf-head">
        {title}
        <span>{items.length}</span>
      </h2>
      <MediaGrid items={items} {...rest} />
    </section>
  )
}

interface MediaCardProps {
  item: MediaItem
  selected: boolean
  active: boolean
  pinned: boolean
  onItemClick: (id: string, event: MouseEvent) => void
  onToggleCheck: (id: string) => void
  onTogglePin: (id: string) => void
  onOpen: (id: string) => void
}

const MediaCard = memo(function MediaCard({
  item,
  selected,
  active,
  pinned,
  onItemClick,
  onToggleCheck,
  onTogglePin,
  onOpen
}: MediaCardProps) {
  return (
    <div
      className={`media-card ${selected ? 'selected' : ''} ${active ? 'active' : ''} ${pinned ? 'pinned' : ''}`}
      onClick={(e) => onItemClick(item.id, e)}
      onDoubleClick={() => onOpen(item.id)}
      title={item.fileName}
    >
      <div className="media-thumb">
        {item.type === 'image' ? <ImageThumb item={item} /> : <VideoThumb item={item} />}
        <button
          className="card-check"
          aria-label={selected ? 'Deselect' : 'Select'}
          onClick={(e) => {
            e.stopPropagation()
            onToggleCheck(item.id)
          }}
        >
          <Check size={14} strokeWidth={3} />
        </button>
        <button
          className={`card-pin ${pinned ? 'on' : ''}`}
          aria-label={pinned ? 'Unpin' : 'Pin'}
          title={pinned ? 'Unpin' : 'Pin to the top'}
          onClick={(e) => {
            e.stopPropagation()
            onTogglePin(item.id)
          }}
        >
          <Pin size={13} fill={pinned ? 'currentColor' : 'none'} />
        </button>
      </div>
      <div className="media-meta">
        <span className="media-name">{item.fileName}</span>
        {item.tags.length > 0 && (
          <div className="media-tags">
            {item.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="mini-tag">
                {tag}
              </span>
            ))}
            {item.tags.length > 3 && <span className="mini-tag more">+{item.tags.length - 3}</span>}
          </div>
        )}
      </div>
    </div>
  )
})

function ThumbFallback({ item }: { item: MediaItem }) {
  return (
    <div className="thumb-fallback">
      <FileWarning size={22} />
      <span>{extensionOf(item.fileName)}</span>
    </div>
  )
}

function ImageThumb({ item }: { item: MediaItem }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <ThumbFallback item={item} />
  return (
    <img
      src={mediaUrl(item)}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
    />
  )
}

/** Only attaches the video source once the card scrolls into view, to keep large libraries fast. */
function VideoThumb({ item }: { item: MediaItem }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [visible, setVisible] = useState(false)
  const [failed, setFailed] = useState(false)
  const [duration, setDuration] = useState<number | null>(null)

  useEffect(() => {
    setDuration(null)
    setFailed(false)
  }, [item.id, item.size, item.relPath])

  useEffect(() => {
    const el = ref.current
    if (!el || visible) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '300px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [visible])

  return (
    <>
      {failed ? (
        <ThumbFallback item={item} />
      ) : (
        <video
          ref={ref}
          src={visible ? `${mediaUrl(item)}#t=0.5` : undefined}
          preload="metadata"
          muted
          playsInline
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          onError={() => setFailed(true)}
        />
      )}
      <div className="video-badge">
        <Play size={11} fill="currentColor" />
        {duration !== null && <span>{formatDuration(duration)}</span>}
      </div>
    </>
  )
}
