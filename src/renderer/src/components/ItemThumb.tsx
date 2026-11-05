import { useEffect, useState } from 'react'
import { FileWarning, Play } from 'lucide-react'
import type { MediaItem } from '../../../shared/types'
import { extensionOf, formatDuration, thumbUrl } from '../utils'

export function ThumbFallback({ item }: { item: MediaItem }) {
  return (
    <div className="thumb-fallback">
      <FileWarning size={22} />
      <span>{extensionOf(item.fileName)}</span>
    </div>
  )
}

/** JPEG still from `.mediamanager/thumbs`. Never opens the original file. */
export function ItemThumb({
  item,
  ready,
  className = ''
}: {
  item: MediaItem
  ready: boolean
  className?: string
}) {
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [item.id, item.size, item.relPath, ready])

  if (failed) return <ThumbFallback item={item} />
  if (!ready) return <div className={`thumb-pending ${className}`} />

  return (
    <img
      className={className}
      src={thumbUrl(item)}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
    />
  )
}

export function DurationBadge({ item }: { item: MediaItem }) {
  if (item.type !== 'video') return null
  return (
    <div className="video-badge">
      <Play size={11} fill="currentColor" />
      {item.duration != null && item.duration > 0 && <span>{formatDuration(item.duration)}</span>}
    </div>
  )
}
