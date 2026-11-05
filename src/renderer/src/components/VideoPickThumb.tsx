import { useEffect, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { MediaItem } from '../../../shared/types'
import { formatDuration, thumbUrl } from '../utils'

interface VideoPickThumbProps {
  item: MediaItem
  size: 'row' | 'preview'
  ready?: boolean
}

export function VideoPickThumb({ item, size, ready = true }: VideoPickThumbProps) {
  const src = ready ? thumbUrl(item) : undefined
  const duration = item.duration != null && item.duration > 0 ? formatDuration(item.duration) : null

  return (
    <span className={`video-pick-thumb video-pick-thumb-${size}`}>
      {src ? <img src={src} alt="" draggable={false} decoding="async" /> : <span className="thumb-pending" />}
      {duration && <span className="video-pick-duration">{duration}</span>}
    </span>
  )
}

const ROW_SIZE = 48

interface VideoPickListProps {
  videos: MediaItem[]
  selectedId: string | null
  thumbIds: Set<string>
  onSelect: (id: string) => void
  onPick: (item: MediaItem) => void
}

export function VideoPickList({ videos, selectedId, thumbIds, onSelect, onPick }: VideoPickListProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: videos.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_SIZE,
    overscan: 10
  })

  const virtualItems = virtualizer.getVirtualItems()

  useEffect(() => {
    const ids = virtualItems.map((row) => videos[row.index]?.id).filter((id): id is string => Boolean(id) && !thumbIds.has(id))
    if (ids.length > 0) void window.api.prioritizeThumbs(ids)
  }, [virtualItems, videos, thumbIds])

  if (videos.length === 0) {
    return (
      <div className="queue-list">
        <p className="queue-empty">No videos match.</p>
      </div>
    )
  }

  return (
    <div ref={parentRef} className="queue-list">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
        {virtualItems.map((row) => {
          const video = videos[row.index]
          if (!video) return null
          return (
            <button
              key={video.id}
              className={`queue-row ${video.id === selectedId ? 'selected' : ''}`}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${row.start}px)`
              }}
              onClick={() => onSelect(video.id)}
              onDoubleClick={() => onPick(video)}
            >
              <VideoPickThumb item={video} size="row" ready={thumbIds.has(video.id)} />
              <span className="queue-row-text">
                <span className="queue-row-name">{video.fileName}</span>
                {video.tags.length > 0 && (
                  <span className="queue-row-tags">{video.tags.join(' · ')}</span>
                )}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
