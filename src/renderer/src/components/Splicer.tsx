import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Combine, Pause, Play, Plus, X } from 'lucide-react'
import type { JobProgress, MediaItem, SpliceSpan, TrimMode } from '../../../shared/types'
import { useTheme } from '../themes'
import { formatTimecode, mediaUrl, plural } from '../utils'
import { clampSlide, EditorTimeline } from './EditorTimeline'
import { UtilityProgress } from './UtilityProgress'

const MIN_GAP = 0.1
const MIN_SPANS = 2

interface Region extends SpliceSpan {
  id: string
}

interface SplicerProps {
  item: MediaItem
  onClose: () => void
  onPickAnother: () => void
  onSaved: (item: MediaItem, replaced: boolean) => void
}

function nextId(): string {
  return crypto.randomUUID()
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function sorted(regions: Region[]): Region[] {
  return [...regions].sort((a, b) => a.start - b.start)
}

/** First gap that can hold a new span, preferring the playhead. */
function placeSpan(regions: Region[], duration: number, preferred: number): { start: number; end: number } | null {
  const ordered = sorted(regions)
  const gaps: { start: number; end: number }[] = []
  let cursor = 0
  for (const region of ordered) {
    if (region.start - cursor >= MIN_GAP) gaps.push({ start: cursor, end: region.start })
    cursor = Math.max(cursor, region.end)
  }
  if (duration - cursor >= MIN_GAP) gaps.push({ start: cursor, end: duration })
  if (gaps.length === 0) return null

  const containing = gaps.find((gap) => preferred >= gap.start && preferred < gap.end)
  const gap = containing ?? gaps.find((entry) => entry.start >= preferred) ?? gaps[0]
  const want = Math.min(2, Math.max(MIN_GAP, duration * 0.12), gap.end - gap.start)
  const start = containing ? clamp(preferred, gap.start, gap.end - want) : gap.start
  return { start, end: start + want }
}

function seedSpans(duration: number): Region[] {
  const width = clamp(duration * 0.2, MIN_GAP, duration * 0.28)
  const firstStart = duration * 0.1
  const firstEnd = firstStart + width
  const secondEnd = duration * 0.9
  const secondStart = secondEnd - width
  if (secondStart - firstEnd >= MIN_GAP) {
    return [
      { id: nextId(), start: firstStart, end: firstEnd },
      { id: nextId(), start: secondStart, end: secondEnd }
    ]
  }
  const split = duration / 2
  const half = Math.max((duration - MIN_GAP) / 2, MIN_GAP)
  return [
    { id: nextId(), start: 0, end: Math.min(split - MIN_GAP / 2, half) },
    { id: nextId(), start: Math.max(split + MIN_GAP / 2, duration - half), end: duration }
  ]
}

export function Splicer({ item, onClose, onPickAnother, onSaved }: SplicerProps) {
  const { copy } = useTheme()
  const videoRef = useRef<HTMLVideoElement>(null)
  const seededFor = useRef<string | null>(null)

  const [duration, setDuration] = useState(0)
  const [current, setCurrent] = useState(0)
  const [regions, setRegions] = useState<Region[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [paused, setPaused] = useState(true)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<JobProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const src = mediaUrl(item)

  const selected = regions.find((region) => region.id === selectedId) ?? null
  const ordered = useMemo(() => sorted(regions), [regions])
  const outputDuration = useMemo(
    () => regions.reduce((sum, region) => sum + Math.max(0, region.end - region.start), 0),
    [regions]
  )

  const onMeta = () => {
    const video = videoRef.current
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return
    setDuration(video.duration)
    setCurrent(0)
    if (seededFor.current === item.id) return
    seededFor.current = item.id
    const seeded = seedSpans(video.duration)
    setRegions(seeded)
    setSelectedId(seeded[0]?.id ?? null)
    if (video.currentTime < 0.02) video.currentTime = 0.05
  }

  const seek = (time: number) => {
    const video = videoRef.current
    if (!video) return
    const clamped = clamp(time, 0, duration || time)
    video.currentTime = clamped
    setCurrent(clamped)
  }

  const jumpPlaying = useCallback(
    (time: number) => {
      const video = videoRef.current
      if (!video || ordered.length === 0) return time
      const inside = ordered.find((region) => time >= region.start && time < region.end - 0.03)
      if (inside) {
        if (time >= inside.end - 0.04) {
          const index = ordered.indexOf(inside)
          const next = ordered[index + 1] ?? ordered[0]
          video.currentTime = next.start
          return next.start
        }
        return time
      }
      const next = ordered.find((region) => region.start > time) ?? ordered[0]
      video.currentTime = next.start
      return next.start
    },
    [ordered]
  )

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    let raf = 0
    const tick = () => {
      const time = jumpPlaying(video.currentTime)
      setCurrent(time)
      if (!video.paused) raf = requestAnimationFrame(tick)
    }
    const onPlay = () => {
      setPaused(false)
      jumpPlaying(video.currentTime)
      tick()
    }
    const onPause = () => {
      setPaused(true)
      cancelAnimationFrame(raf)
    }
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    return () => {
      cancelAnimationFrame(raf)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
    }
  }, [jumpPlaying])

  const togglePlay = () => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      const inside = ordered.find((region) => video.currentTime >= region.start && video.currentTime < region.end - 0.03)
      if (!inside && ordered[0]) video.currentTime = ordered[0].start
      void video.play()
    } else {
      video.pause()
    }
  }

  const resizeRegion = (id: string, edge: 'start' | 'end', time: number) => {
    videoRef.current?.pause()
    setSelectedId(id)
    setRegions((current) =>
      current.map((region) => {
        if (region.id !== id) return region
        const others = current.filter((entry) => entry.id !== region.id)
        const prev = others.filter((entry) => entry.end <= region.start + 0.001).sort((a, b) => b.end - a.end)[0]
        const next = others.filter((entry) => entry.start >= region.end - 0.001).sort((a, b) => a.start - b.start)[0]
        const minStart = prev ? prev.end : 0
        const maxEnd = next ? next.start : duration
        if (edge === 'start') {
          const start = clamp(time, minStart, region.end - MIN_GAP)
          seek(start)
          return { ...region, start }
        }
        const end = clamp(time, region.start + MIN_GAP, maxEnd)
        seek(end)
        return { ...region, end }
      })
    )
  }

  const moveRegion = (id: string, start: number, _end: number, previewTime: number) => {
    videoRef.current?.pause()
    setSelectedId(id)
    setRegions((current) =>
      current.map((region) => {
        if (region.id !== id) return region
        const others = current.filter((entry) => entry.id !== region.id)
        const next = clampSlide(
          start,
          region.end - region.start,
          duration,
          others,
          region.start,
          region.end
        )
        seek(previewTime)
        return { ...region, ...next }
      })
    )
  }

  const addRegion = () => {
    if (duration <= 0) return
    const placed = placeSpan(regions, duration, current)
    if (!placed) {
      setError('No room for another span — move or shrink the ones already on the timeline')
      return
    }
    const region: Region = { id: nextId(), start: placed.start, end: placed.end }
    setRegions((current) => [...current, region])
    setSelectedId(region.id)
    setError(null)
    seek(placed.start)
  }

  const removeSelected = () => {
    if (!selectedId || regions.length <= MIN_SPANS) return
    setRegions((current) => current.filter((region) => region.id !== selectedId))
    setSelectedId(null)
  }

  const save = useCallback(
    async (mode: TrimMode) => {
      const video = videoRef.current
      video?.pause()
      if (video) {
        video.removeAttribute('src')
        video.load()
      }
      setBusy(true)
      setProgress({
        title: 'Saving splice',
        detail: 'Starting…',
        percent: 0,
        current: 0,
        total: 0,
        steps: []
      })
      setError(null)
      setConfirm(false)
      try {
        await new Promise((resolve) => setTimeout(resolve, 80))
        const spans: SpliceSpan[] = ordered.map(({ start, end }) => ({ start, end }))
        const result = await window.api.spliceVideo(item.id, spans, mode)
        onSaved(result.item, result.replaced)
      } catch (err) {
        setError((err as Error).message)
        if (video) video.src = src
      } finally {
        setBusy(false)
        setProgress(null)
      }
    },
    [item, onSaved, ordered, src]
  )

  useEffect(() => window.api.onJobProgress(setProgress), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      if (e.key === 'Escape') {
        e.preventDefault()
        if (busy) return
        if (confirm) setConfirm(false)
        else onClose()
      } else if (e.key === ' ' && !confirm && !busy) {
        e.preventDefault()
        togglePlay()
      } else if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        selectedId &&
        regions.length > MIN_SPANS &&
        !confirm &&
        !busy
      ) {
        e.preventDefault()
        removeSelected()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [busy, confirm, onClose, regions.length, selectedId])

  return (
    <div className="trimmer">
      <header className="trimmer-top">
        <div className="viewer-title">
          <span className="viewer-name">{item.fileName}</span>
          <span className="viewer-sub">
            {copy.splicer}
            {item.tags.length > 0 ? ` · ${item.tags.join(' · ')}` : ''}
          </span>
        </div>
        <div className="viewer-actions">
          <button className="btn btn-ghost btn-sm" onClick={onPickAnother} disabled={busy}>
            Change video
          </button>
          <button className="viewer-btn" onClick={onClose} aria-label="Close" disabled={busy}>
            <X size={20} />
          </button>
        </div>
      </header>

      <div className="trimmer-stage">
        <video
          key={item.id}
          ref={videoRef}
          className="trimmer-video"
          src={src}
          playsInline
          preload="auto"
          onLoadedMetadata={onMeta}
        />
      </div>

      <div className="trimmer-dock">
        <div className="trimmer-times">
          <span>{plural(regions.length, 'span')} to keep</span>
          <span>Output {formatTimecode(outputDuration)}</span>
        </div>
        <div className="dilation-timeline-row">
          <EditorTimeline
            itemId={item.id}
            duration={duration}
            current={current}
            disabled={busy}
            spans={ordered.map((region, index) => ({
              id: region.id,
              start: region.start,
              end: region.end,
              label: String(index + 1),
              selected: region.id === selectedId
            }))}
            onSeek={seek}
            onSelect={setSelectedId}
            onResize={resizeRegion}
            onMove={moveRegion}
          />
          <button
            className="dilation-add"
            onClick={addRegion}
            disabled={busy || duration === 0}
            title="Add a span"
          >
            <Combine size={18} />
            <Plus size={12} strokeWidth={2.5} />
          </button>
        </div>
        <div className="trimmer-actions">
          <button className="scroller-btn" onClick={togglePlay} title="Play / pause (Space)" disabled={busy || duration === 0}>
            {paused ? <Play size={16} fill="currentColor" /> : <Pause size={16} />}
          </button>
          <span className="trimmer-now">
            {formatTimecode(current)} / {formatTimecode(duration)}
          </span>
          {selected && (
            <div className="dilation-edit">
              <span>
                {formatTimecode(selected.start)} – {formatTimecode(selected.end)}
              </span>
              <button
                className="btn btn-ghost btn-sm"
                onClick={removeSelected}
                disabled={regions.length <= MIN_SPANS}
              >
                Remove
              </button>
            </div>
          )}
          <div className="toolbar-spacer" />
          <button
            className="btn btn-primary"
            disabled={busy || duration === 0 || regions.length < MIN_SPANS}
            onClick={() => setConfirm(true)}
          >
            <Combine size={16} /> Save splice
          </button>
        </div>
        {error && <p className="trimmer-error">{error}</p>}
      </div>

      {confirm && (
        <div className="modal-backdrop" onClick={() => !busy && setConfirm(false)}>
          <div className="modal trim-save" onClick={(e) => e.stopPropagation()}>
            <header className="modal-header">
              <div className="modal-icon">
                <Combine size={20} />
              </div>
              <div>
                <h2>Save splice</h2>
                <p>
                  Keep {plural(regions.length, 'span')} and drop everything between them, for a clip
                  lasting {formatTimecode(outputDuration)}. The saved file inherits the original tags
                  {item.tags.length > 0 ? ` (${item.tags.join(', ')})` : ''}.
                </p>
              </div>
            </header>
            <div className="trim-save-actions">
              <button className="btn btn-primary" onClick={() => void save('new')}>
                Save as a new video
              </button>
              <button className="btn btn-secondary" onClick={() => void save('replace')}>
                Replace the original
              </button>
              <button className="btn btn-ghost" onClick={() => setConfirm(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <UtilityProgress open={busy} progress={progress} title="Saving splice" />
    </div>
  )
}
