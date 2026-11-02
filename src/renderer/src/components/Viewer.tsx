import { useEffect } from 'react'
import { ChevronLeft, ChevronRight, Trash2, X } from 'lucide-react'
import type { MediaItem } from '../../../shared/types'
import { formatBytes } from '../utils'
import { MediaPreview } from './MediaPreview'

interface ViewerProps {
  items: MediaItem[]
  index: number
  onNavigate: (id: string) => void
  onClose: () => void
  onDelete: (id: string) => void
}

export function Viewer({ items, index, onNavigate, onClose, onDelete }: ViewerProps) {
  const item = items[index]
  const prev = index > 0 ? items[index - 1] : null
  const next = index < items.length - 1 ? items[index + 1] : null

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft' && prev) onNavigate(prev.id)
      else if (e.key === 'ArrowRight' && next) onNavigate(next.id)
      else if (e.key === 'Delete' && item) onDelete(item.id)
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [item, prev, next, onNavigate, onClose, onDelete])

  if (!item) return null

  return (
    <div className="viewer" onClick={onClose}>
      <div className="viewer-top" onClick={(e) => e.stopPropagation()}>
        <div className="viewer-title">
          <span className="viewer-name">{item.fileName}</span>
          <span className="viewer-sub">
            {index + 1} of {items.length} · {formatBytes(item.size)}
          </span>
        </div>
        <div className="viewer-actions">
          <button
            className="viewer-btn danger"
            onClick={() => onDelete(item.id)}
            aria-label="Delete"
            title="Delete (Del)"
          >
            <Trash2 size={18} />
          </button>
          <button className="viewer-btn" onClick={onClose} aria-label="Close viewer">
            <X size={20} />
          </button>
        </div>
      </div>

      <div className="viewer-stage">
        {prev && (
          <button
            className="viewer-nav left"
            aria-label="Previous"
            onClick={(e) => {
              e.stopPropagation()
              onNavigate(prev.id)
            }}
          >
            <ChevronLeft size={28} />
          </button>
        )}
        <div className="viewer-media" onClick={(e) => e.stopPropagation()}>
          <MediaPreview item={item} autoPlay className="viewer-content" />
        </div>
        {next && (
          <button
            className="viewer-nav right"
            aria-label="Next"
            onClick={(e) => {
              e.stopPropagation()
              onNavigate(next.id)
            }}
          >
            <ChevronRight size={28} />
          </button>
        )}
      </div>

      {item.tags.length > 0 && (
        <div className="viewer-tags" onClick={(e) => e.stopPropagation()}>
          {item.tags.map((tag) => (
            <span key={tag} className="tag-chip">
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
