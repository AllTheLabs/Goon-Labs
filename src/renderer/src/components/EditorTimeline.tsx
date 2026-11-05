import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

export interface TimelineSpan {
  id: string
  start: number
  end: number
  label?: string
  selected?: boolean
}

interface EditorTimelineProps {
  itemId: string
  duration: number
  current: number
  spans: TimelineSpan[]
  onSeek: (time: number) => void
  onResize: (id: string, edge: 'start' | 'end', time: number) => void
  onMove: (id: string, start: number, end: number, previewTime: number) => void
  onSelect?: (id: string | null) => void
  disabled?: boolean
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function clampSlide(
  start: number,
  width: number,
  duration: number,
  others: { start: number; end: number }[],
  originStart: number,
  originEnd: number
): { start: number; end: number } {
  const prev = others
    .filter((entry) => entry.end <= originStart + 0.001)
    .sort((a, b) => b.end - a.end)[0]
  const next = others
    .filter((entry) => entry.start >= originEnd - 0.001)
    .sort((a, b) => a.start - b.start)[0]
  const minStart = prev ? prev.end : 0
  const maxEnd = next ? next.start : duration
  const nextStart = clamp(start, minStart, Math.max(minStart, maxEnd - width))
  return { start: nextStart, end: nextStart + width }
}

type Drag =
  | { kind: 'start' | 'end'; id: string }
  | { kind: 'move'; id: string; originStart: number; originEnd: number; originTime: number }

function slotCount(width: number): number {
  if (width < 48) return 0
  const stepped = Math.round(width / 80) * 80
  return Math.min(24, Math.max(8, Math.round(stepped / 56)))
}

function useFilmstrip(itemId: string, duration: number, count: number): string[] {
  const [frames, setFrames] = useState<string[]>([])

  useEffect(() => {
    if (!itemId || duration <= 0 || count < 8) {
      setFrames([])
      return
    }
    let cancelled = false
    void window.api
      .getFilmstrip(itemId, count, duration)
      .then((urls) => {
        if (!cancelled) setFrames(urls)
      })
      .catch(() => {
        if (!cancelled) setFrames([])
      })
    return () => {
      cancelled = true
    }
  }, [itemId, duration, count])

  return frames
}

export function EditorTimeline({
  itemId,
  duration,
  current,
  spans,
  onSeek,
  onResize,
  onMove,
  onSelect,
  disabled
}: EditorTimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const [width, setWidth] = useState(0)
  const count = slotCount(width)
  const frames = useFilmstrip(itemId, duration, count)
  const slots = frames.length > 0 ? frames : Array.from({ length: Math.max(count, 8) }, () => '')

  useEffect(() => {
    const track = trackRef.current
    if (!track) return
    const update = () => setWidth(track.getBoundingClientRect().width)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(track)
    return () => observer.disconnect()
  }, [])

  const pct = (time: number) => (duration > 0 ? `${(time / duration) * 100}%` : '0%')

  const timeFromEvent = (clientX: number) => {
    const track = trackRef.current
    if (!track || duration <= 0) return 0
    const rect = track.getBoundingClientRect()
    return clamp((clientX - rect.left) / rect.width, 0, 1) * duration
  }

  const onPointerMove = (e: ReactPointerEvent) => {
    if (!drag.current || disabled) return
    const time = timeFromEvent(e.clientX)
    const dragging = drag.current
    if (dragging.kind === 'move') {
      const width = dragging.originEnd - dragging.originStart
      const start = dragging.originStart + (time - dragging.originTime)
      onMove(dragging.id, start, start + width, time)
      return
    }
    onResize(dragging.id, dragging.kind, time)
  }

  const onPointerUp = () => {
    drag.current = null
  }

  const beginDrag = (next: Drag) => (e: ReactPointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (disabled) return
    onSelect?.(next.id)
    drag.current = next
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const dimmed: { start: number; end: number }[] = []
  const ordered = [...spans].sort((a, b) => a.start - b.start)
  let cursor = 0
  for (const span of ordered) {
    if (span.start > cursor + 0.001) dimmed.push({ start: cursor, end: span.start })
    cursor = Math.max(cursor, span.end)
  }
  if (duration > cursor + 0.001) dimmed.push({ start: cursor, end: duration })

  return (
    <div
      ref={trackRef}
      className="editor-timeline"
      onPointerDown={(e) => {
        if (disabled) return
        if ((e.target as HTMLElement).closest('.editor-handle, .editor-span, .editor-span-move')) return
        onSelect?.(null)
        onSeek(timeFromEvent(e.clientX))
      }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="editor-filmstrip" aria-hidden="true">
        {slots.map((frame, index) =>
          frame ? (
            <img key={index} src={frame} alt="" draggable={false} />
          ) : (
            <span key={index} className="editor-filmstrip-slot" />
          )
        )}
      </div>
      <div className="editor-timeline-shade" />
      {dimmed.map((gap, index) => (
        <div
          key={`dim-${index}`}
          className="editor-dim"
          style={{ left: pct(gap.start), width: pct(gap.end - gap.start) }}
        />
      ))}
      {spans.map((span) => (
        <div
          key={span.id}
          className={`editor-span ${span.selected ? 'selected' : ''}`}
          style={{ left: pct(span.start), width: pct(span.end - span.start) }}
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest('.editor-span-move')) return
            e.stopPropagation()
            onSelect?.(span.id)
            onSeek(timeFromEvent(e.clientX))
          }}
        >
          {span.label && <span className="editor-span-label">{span.label}</span>}
          <button
            className="editor-span-move"
            aria-label="Move span"
            onPointerDown={(e) =>
              beginDrag({
                kind: 'move',
                id: span.id,
                originStart: span.start,
                originEnd: span.end,
                originTime: timeFromEvent(e.clientX)
              })(e)
            }
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
        </div>
      ))}
      <div className="editor-playhead" style={{ left: pct(current) }} />
      {spans.map((span) => (
        <div key={`${span.id}-handles`}>
          <button
            className="editor-handle start"
            style={{ left: pct(span.start) }}
            onPointerDown={beginDrag({ kind: 'start', id: span.id })}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            aria-label="Start"
          />
          <button
            className="editor-handle end"
            style={{ left: pct(span.end) }}
            onPointerDown={beginDrag({ kind: 'end', id: span.id })}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            aria-label="End"
          />
        </div>
      ))}
    </div>
  )
}
