import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Clock, Pause, Play, Plus, X } from 'lucide-react'
import type { DilationFactor, DilationSpan, JobProgress, MediaItem, TrimMode } from '../../../shared/types'
import { DILATION_FACTORS } from '../../../shared/types'
import { useTheme } from '../themes'
import { formatTimecode, mediaUrl, plural } from '../utils'
import { clampSlide, EditorTimeline } from './EditorTimeline'
import { UtilityProgress } from './UtilityProgress'

const MIN_GAP = 0.1
const DEFAULT_FACTOR: DilationFactor = 2

interface Region extends DilationSpan {
  id: string
}

interface TimeDilationProps {
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

/** First gap that can hold a new span, preferring the playhead. */
function placeSpan(regions: Region[], duration: number, preferred: number): { start: number; end: number } | null {
  const sorted = [...regions].sort((a, b) => a.start - b.start)
  const gaps: { start: number; end: number }[] = []
  let cursor = 0
  for (const region of sorted) {
    if (region.start - cursor >= MIN_GAP) gaps.push({ start: cursor, end: region.start })
    cursor = Math.max(cursor, region.end)
  }
  if (duration - cursor >= MIN_GAP) gaps.push({ start: cursor, end: duration })
  if (gaps.length === 0) return null

  const containing = gaps.find((gap) => preferred >= gap.start && preferred < gap.end)
  const gap = containing ?? gaps.find((entry) => entry.start >= preferred) ?? gaps[0]
  const want = Math.min(2, Math.max(MIN_GAP, duration * 0.12), gap.end - gap.start)
  const start = containing
    ? clamp(preferred, gap.start, gap.end - want)
    : gap.start
  return { start, end: start + want }
}

export function TimeDilation({ item, onClose, onPickAnother, onSaved }: TimeDilationProps) {
  const { copy } = useTheme()
  const videoRef = useRef<HTMLVideoElement>(null)

  const [duration, setDuration] = useState(0)
  const [current, setCurrent] = useState(0)
  const [regions, setRegions] = useState<Region[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [paused, setPaused] = useState(true)
  const [confirm, setConfirm] = useState(false)
  const [interpolate, setInterpolate] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<JobProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const src = mediaUrl(item)

  const selected = regions.find((region) => region.id === selectedId) ?? null
  const outputDuration = useMemo(
    () => duration + regions.reduce((sum, region) => sum + (region.end - region.start) * (region.factor - 1), 0),
    [duration, regions]
  )

  const onMeta = () => {
    const video = videoRef.current
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return
    setDuration(video.duration)
    setCurrent(0)
    const media = video as HTMLVideoElement & { preservesPitch?: boolean }
    if (media.preservesPitch !== undefined) media.preservesPitch = true
    if (video.currentTime < 0.02) video.currentTime = 0.05
  }

  const applyRate = useCallback(
    (time: number) => {
      const video = videoRef.current
      if (!video) return
      const region = regions.find((entry) => time >= entry.start && time < entry.end)
      const rate = region ? 1 / region.factor : 1
      if (Math.abs(video.playbackRate - rate) > 0.001) video.playbackRate = rate
    },
    [regions]
  )

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    let raf = 0
    const tick = () => {
      const time = video.currentTime
      setCurrent(time)
      applyRate(time)
      if (!video.paused) raf = requestAnimationFrame(tick)
    }
    const onPlay = () => {
      setPaused(false)
      tick()
    }
    const onPause = () => {
      setPaused(true)
      cancelAnimationFrame(raf)
    }
    const onSeeked = () => applyRate(video.currentTime)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('seeked', onSeeked)
    applyRate(video.currentTime)
    return () => {
      cancelAnimationFrame(raf)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('seeked', onSeeked)
    }
  }, [applyRate])

  const seek = (time: number) => {
    const video = videoRef.current
    if (!video) return
    const clamped = clamp(time, 0, duration || time)
    video.currentTime = clamped
    setCurrent(clamped)
    applyRate(clamped)
  }

  const togglePlay = () => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) void video.play()
    else video.pause()
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
      setError('No room for another time dilation — move or shrink the ones already on the timeline')
      return
    }
    const region: Region = { id: nextId(), start: placed.start, end: placed.end, factor: DEFAULT_FACTOR }
    setRegions((current) => [...current, region])
    setSelectedId(region.id)
    setError(null)
    seek(placed.start)
  }

  const removeSelected = () => {
    if (!selectedId) return
    setRegions((current) => current.filter((region) => region.id !== selectedId))
    setSelectedId(null)
  }

  const setFactor = (factor: DilationFactor) => {
    if (!selectedId) return
    setRegions((current) =>
      current.map((region) => (region.id === selectedId ? { ...region, factor } : region))
    )
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
        title: interpolate ? 'Interpolating frames' : 'Saving time dilation',
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
        const spans: DilationSpan[] = regions.map(({ start, end, factor }) => ({ start, end, factor }))
        const result = await window.api.dilateVideo(item.id, spans, mode, interpolate)
        onSaved(result.item, result.replaced)
      } catch (err) {
        setError((err as Error).message)
        if (video) video.src = src
      } finally {
        setBusy(false)
        setProgress(null)
      }
    },
    [interpolate, item, onSaved, regions, src]
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
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && !confirm && !busy) {
        e.preventDefault()
        removeSelected()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [busy, confirm, onClose, selectedId])

  return (
    <div className="trimmer">
      <header className="trimmer-top">
        <div className="viewer-title">
          <span className="viewer-name">{item.fileName}</span>
          <span className="viewer-sub">
            {copy.timeDilation}
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
          <span>
            {regions.length === 0
              ? 'No time dilations yet'
              : plural(regions.length, 'time dilation')}
          </span>
          <span>Output {formatTimecode(outputDuration)}</span>
        </div>
        <div className="dilation-timeline-row">
          <EditorTimeline
            itemId={item.id}
            duration={duration}
            current={current}
            disabled={busy}
            spans={regions.map((region) => ({
              id: region.id,
              start: region.start,
              end: region.end,
              label: `${region.factor}x`,
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
            title="Add a time dilation"
          >
            <Clock size={18} />
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
              <div className="segmented small">
                {DILATION_FACTORS.map((factor) => (
                  <button
                    key={factor}
                    className={selected.factor === factor ? 'active' : ''}
                    onClick={() => setFactor(factor)}
                  >
                    {factor}x
                  </button>
                ))}
              </div>
              <button className="btn btn-ghost btn-sm" onClick={removeSelected}>
                Remove
              </button>
            </div>
          )}
          <div className="toolbar-spacer" />
          <button
            className="btn btn-primary"
            disabled={busy || duration === 0 || regions.length === 0}
            onClick={() => setConfirm(true)}
          >
            <Clock size={16} /> Save dilation
          </button>
        </div>
        {error && <p className="trimmer-error">{error}</p>}
      </div>

      {confirm && (
        <div className="modal-backdrop" onClick={() => !busy && setConfirm(false)}>
          <div className="modal trim-save" onClick={(e) => e.stopPropagation()}>
            <header className="modal-header">
              <div className="modal-icon">
                <Clock size={20} />
              </div>
              <div>
                <h2>Save time dilation</h2>
                <p>
                  Slow {plural(regions.length, 'span')} so the clip lasts {formatTimecode(outputDuration)}.
                  The saved file inherits the original tags
                  {item.tags.length > 0 ? ` (${item.tags.join(', ')})` : ''} and adds{' '}
                  <strong>time dilated</strong>.
                </p>
              </div>
            </header>
            <label className={`endless-toggle ${interpolate ? 'on' : ''}`}>
              <input
                type="checkbox"
                checked={interpolate}
                onChange={(e) => setInterpolate(e.target.checked)}
              />
              <span>
                <strong>Interpolate extra frames</strong>
                <small>
                  Fills in in-between frames so the slowed video looks smoother. This will increase
                  render time a lot — often several minutes for a short clip.
                </small>
              </span>
            </label>
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

      <UtilityProgress
        open={busy}
        progress={progress}
        title={interpolate ? 'Interpolating frames' : 'Saving time dilation'}
      />
    </div>
  )
}
