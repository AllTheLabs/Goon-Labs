import { useEffect, useState } from 'react'
import { FileWarning } from 'lucide-react'
import type { MediaItem } from '../../../shared/types'
import { extensionOf, mediaUrl } from '../utils'

interface MediaPreviewProps {
  item: MediaItem
  autoPlay?: boolean
  className?: string
}

/** Full-quality image or playable video, with a fallback for formats Chromium can't decode. */
export function MediaPreview({ item, autoPlay = false, className = '' }: MediaPreviewProps) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [item.id, item.size, item.relPath])

  if (failed) {
    return (
      <div className={`preview-fallback ${className}`}>
        <FileWarning size={36} />
        <span>Preview isn't available for .{extensionOf(item.fileName).toLowerCase()} files</span>
      </div>
    )
  }

  return item.type === 'image' ? (
    <img
      key={`${item.id}:${item.size}`}
      className={className}
      src={mediaUrl(item)}
      alt={item.fileName}
      draggable={false}
      onError={() => setFailed(true)}
    />
  ) : (
    <video
      key={`${item.id}:${item.size}:${item.relPath}`}
      className={className}
      src={mediaUrl(item)}
      controls
      autoPlay={autoPlay}
      onError={() => setFailed(true)}
    />
  )
}
