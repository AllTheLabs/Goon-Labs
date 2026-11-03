import { useEffect, useState } from 'react'
import type { MediaItem } from '../../../shared/types'
import { formatDuration, mediaUrl } from '../utils'

interface VideoPickThumbProps {
  item: MediaItem
  size: 'row' | 'preview'
}

export function VideoPickThumb({ item, size }: VideoPickThumbProps) {
  const [duration, setDuration] = useState<number | null>(null)

  useEffect(() => {
    setDuration(null)
  }, [item.id, item.size, item.relPath])

  return (
    <span className={`video-pick-thumb video-pick-thumb-${size}`}>
      <video
        src={`${mediaUrl(item)}#t=0.5`}
        muted
        preload="metadata"
        playsInline
        onLoadedMetadata={(e) => {
          const value = e.currentTarget.duration
          setDuration(Number.isFinite(value) && value > 0 ? value : null)
        }}
      />
      {duration !== null && <span className="video-pick-duration">{formatDuration(duration)}</span>}
    </span>
  )
}
