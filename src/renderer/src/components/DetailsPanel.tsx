import { Clock, Combine, Download, Expand, FolderSearch, Image, MousePointerClick, Scissors, Trash2 } from 'lucide-react'
import type { MediaItem } from '../../../shared/types'
import { extensionOf, formatBytes, formatDate, mediaUrl, plural } from '../utils'
import { MediaPreview } from './MediaPreview'
import { TagEditor } from './TagEditor'
import type { TagChip } from './TagEditor'

interface DetailsPanelProps {
  items: MediaItem[]
  allTags: string[]
  autoFocusTags?: boolean
  tagHint?: string
  quickTags?: string[]
  onAddTags: (ids: string[], tags: string[]) => void
  onRemoveTag: (ids: string[], tag: string) => void
  onOpenViewer: (id: string) => void
  onOpenTrimmer: (item: MediaItem) => void
  onOpenSplicer: (item: MediaItem) => void
  onOpenTimeDilation: (item: MediaItem) => void
  onOpenGif: (item: MediaItem) => void
  onReveal: (id: string) => void
  onExport: () => void
  onDelete: () => void
}

export function DetailsPanel(props: DetailsPanelProps) {
  const { items } = props
  return (
    <aside className="details">
      {items.length === 0 && (
        <div className="details-empty">
          <MousePointerClick size={32} />
          <p>
            {props.tagHint
              ? 'Select a photo or video, then add tags. It stays in this list until you click another one.'
              : 'Select a photo or video to preview it and manage its tags.'}
          </p>
          <span>Ctrl/Shift-click to select several at once.</span>
        </div>
      )}
      {items.length === 1 && <SingleDetails item={items[0]} {...props} />}
      {items.length > 1 && <MultiDetails {...props} />}
    </aside>
  )
}

function SingleDetails({
  item,
  allTags,
  autoFocusTags,
  tagHint,
  quickTags,
  onAddTags,
  onRemoveTag,
  onOpenViewer,
  onOpenTrimmer,
  onOpenSplicer,
  onOpenTimeDilation,
  onOpenGif,
  onReveal,
  onExport,
  onDelete
}: DetailsPanelProps & { item: MediaItem }) {
  return (
    <div className="details-body">
      <div className="details-preview">
        <MediaPreview item={item} className="details-media" />
        <button
          className="preview-expand"
          onClick={() => onOpenViewer(item.id)}
          title="Open in viewer"
        >
          <Expand size={16} />
        </button>
      </div>

      <h2 className="details-title" title={item.fileName}>
        {item.fileName}
      </h2>

      <dl className="details-meta">
        <dt>Type</dt>
        <dd>
          {item.type === 'image' ? 'Photo' : 'Video'} · {extensionOf(item.fileName)}
        </dd>
        <dt>Size</dt>
        <dd>{formatBytes(item.size)}</dd>
        <dt>Imported</dt>
        <dd>{formatDate(item.importedAt)}</dd>
        <dt>Location</dt>
        <dd className="mono" title={item.relPath}>
          {item.relPath}
        </dd>
      </dl>

      <section className="details-section">
        <h3>Tags</h3>
        {tagHint && <p className="hint">{tagHint}</p>}
        <TagEditor
          key={item.id}
          tags={item.tags.map((tag) => ({ tag }))}
          suggestions={allTags}
          quickTags={quickTags}
          autoFocus={autoFocusTags}
          onAdd={(tags) => onAddTags([item.id], tags)}
          onRemove={(tag) => onRemoveTag([item.id], tag)}
        />
      </section>

      <div className="details-actions">
        <button className="btn btn-secondary" onClick={() => onOpenViewer(item.id)}>
          <Expand size={16} /> View
        </button>
        <button className="btn btn-secondary" onClick={() => onReveal(item.id)}>
          <FolderSearch size={16} /> Show in folder
        </button>
        {item.type === 'video' && (
          <>
            <button className="btn btn-secondary full" onClick={() => onOpenTrimmer(item)}>
              <Scissors size={16} /> Trim video
            </button>
            <button className="btn btn-secondary full" onClick={() => onOpenSplicer(item)}>
              <Combine size={16} /> Splice video
            </button>
            <button className="btn btn-secondary full" onClick={() => onOpenTimeDilation(item)}>
              <Clock size={16} /> Time dilation
            </button>
            <button className="btn btn-secondary full" onClick={() => onOpenGif(item)}>
              <Image size={16} /> Make GIF
            </button>
          </>
        )}
        <button className="btn btn-primary full" onClick={onExport}>
          <Download size={16} /> Export copy…
        </button>
        <button className="btn btn-danger full" onClick={onDelete}>
          <Trash2 size={16} /> Delete
        </button>
      </div>
    </div>
  )
}

function MultiDetails({
  items,
  allTags,
  autoFocusTags,
  tagHint,
  quickTags,
  onAddTags,
  onRemoveTag,
  onExport,
  onDelete
}: DetailsPanelProps) {
  const ids = items.map((item) => item.id)
  const tagCounts = new Map<string, number>()
  for (const item of items) {
    for (const tag of item.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
  }
  const chips: TagChip[] = [...tagCounts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tag, count]) => ({
      tag,
      note: count < items.length ? `${count}/${items.length}` : undefined
    }))
  const totalSize = items.reduce((sum, item) => sum + item.size, 0)
  const photos = items.filter((item) => item.type === 'image').length

  return (
    <div className="details-body">
      <div className="stack-preview">
        {items.slice(0, 4).map((item) =>
          item.type === 'image' ? (
            <img key={item.id} src={mediaUrl(item)} alt="" draggable={false} />
          ) : (
            <video key={item.id} src={`${mediaUrl(item)}#t=0.5`} preload="metadata" muted />
          )
        )}
      </div>

      <h2 className="details-title">{plural(items.length, 'item')} selected</h2>
      <p className="details-subtitle">
        {plural(photos, 'photo')} · {plural(items.length - photos, 'video')} ·{' '}
        {formatBytes(totalSize)}
      </p>

      <section className="details-section">
        <h3>Tags on selection</h3>
        <p className="hint">
          Tags added here are applied to every selected item. Removing a tag removes it from all of
          them.
        </p>
        {tagHint && <p className="hint">{tagHint}</p>}
        <TagEditor
          tags={chips}
          suggestions={allTags}
          quickTags={quickTags}
          autoFocus={autoFocusTags}
          placeholder="Tag all selected items"
          onAdd={(tags) => onAddTags(ids, tags)}
          onRemove={(tag) => onRemoveTag(ids, tag)}
        />
      </section>

      <div className="details-actions">
        <button className="btn btn-primary full" onClick={onExport}>
          <Download size={16} /> Export {items.length} copies…
        </button>
        <button className="btn btn-danger full" onClick={onDelete}>
          <Trash2 size={16} /> Delete {items.length} items
        </button>
      </div>
    </div>
  )
}
