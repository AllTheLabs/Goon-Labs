import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { MouseEvent, RefObject } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Check, Pin } from 'lucide-react'
import type { MediaItem } from '../../../shared/types'
import { DurationBadge, ItemThumb } from './ItemThumb'

const GRID_GAP = 14
const CARD_META = 46
const OVERSCAN = 3

interface MediaGridProps {
  items: MediaItem[]
  selected: Set<string>
  activeId: string | null
  pinned: Set<string>
  thumbIds: Set<string>
  thumbSize: number
  scrollRef?: RefObject<HTMLDivElement | null>
  virtualize?: boolean
  showPin?: boolean
  onItemClick: (id: string, event: MouseEvent) => void
  onToggleCheck: (id: string) => void
  onTogglePin: (id: string) => void
  onOpen: (id: string) => void
}

export const MediaGrid = memo(function MediaGrid({
  items,
  selected,
  activeId,
  pinned,
  thumbIds,
  thumbSize,
  scrollRef,
  virtualize = false,
  ...handlers
}: MediaGridProps) {
  if (virtualize && scrollRef) {
    return (
      <VirtualMediaGrid
        items={items}
        selected={selected}
        activeId={activeId}
        pinned={pinned}
        thumbIds={thumbIds}
        thumbSize={thumbSize}
        scrollRef={scrollRef}
        {...handlers}
      />
    )
  }

  return (
    <div className="media-grid">
      {items.map((item) => (
        <MediaCard
          key={item.id}
          item={item}
          selected={selected.has(item.id)}
          active={item.id === activeId}
          pinned={pinned.has(item.id)}
          thumbReady={thumbIds.has(item.id)}
          showPin={handlers.showPin}
          {...handlers}
        />
      ))}
    </div>
  )
})

export function LibraryShelf({
  title,
  items,
  ...rest
}: { title: string } & Omit<MediaGridProps, 'virtualize' | 'scrollRef'>) {
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

function VirtualMediaGrid({
  items,
  selected,
  activeId,
  pinned,
  thumbIds,
  thumbSize,
  scrollRef,
  ...handlers
}: MediaGridProps & { scrollRef: RefObject<HTMLDivElement | null> }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [scrollMargin, setScrollMargin] = useState(0)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const columns = Math.max(1, Math.floor((width + GRID_GAP) / (thumbSize + GRID_GAP)))
  const cardWidth = width > 0 ? (width - GRID_GAP * (columns - 1)) / columns : thumbSize
  const rowHeight = cardWidth * 0.75 + CARD_META + GRID_GAP
  const rowCount = Math.ceil(items.length / columns)

  useLayoutEffect(() => {
    const grid = wrapRef.current
    const scroll = scrollRef.current
    if (!grid || !scroll) return
    setScrollMargin(grid.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop)
  }, [scrollRef, items.length, width, thumbSize])

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: OVERSCAN,
    scrollMargin
  })

  const virtualRows = virtualizer.getVirtualItems()

  useEffect(() => {
    virtualizer.measure()
  }, [virtualizer, rowHeight])

  useEffect(() => {
    if (virtualRows.length === 0) return
    const ids: string[] = []
    for (const row of virtualRows) {
      const start = row.index * columns
      for (let i = 0; i < columns; i++) {
        const item = items[start + i]
        if (item && !thumbIds.has(item.id)) ids.push(item.id)
      }
    }
    if (ids.length > 0) void window.api.prioritizeThumbs(ids)
  }, [virtualRows, columns, items, thumbIds])

  return (
    <div ref={wrapRef} className="media-grid-virtual" style={{ height: virtualizer.getTotalSize() }}>
      {virtualRows.map((row) => {
        const start = row.index * columns
        return (
          <div
            key={row.key}
            className="media-grid media-grid-row"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${row.start - scrollMargin}px)`,
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`
            }}
          >
            {Array.from({ length: columns }, (_, col) => {
              const item = items[start + col]
              if (!item) return <div key={col} />
              return (
                <MediaCard
                  key={item.id}
                  item={item}
                  selected={selected.has(item.id)}
                  active={item.id === activeId}
                  pinned={pinned.has(item.id)}
                  thumbReady={thumbIds.has(item.id)}
                  showPin={handlers.showPin}
                  {...handlers}
                />
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

interface MediaCardProps {
  item: MediaItem
  selected: boolean
  active: boolean
  pinned: boolean
  thumbReady: boolean
  showPin?: boolean
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
  thumbReady,
  showPin = true,
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
        <ItemThumb item={item} ready={thumbReady} />
        <DurationBadge item={item} />
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
        {showPin && (
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
        )}
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
