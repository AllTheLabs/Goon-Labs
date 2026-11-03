import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { Loader2, Pause, Play, Repeat, X } from 'lucide-react'
import type { MediaItem, TrimMode } from '../../../shared/types'
import { findSeamlessLoop } from '../goonLoop'
import { useTheme } from '../themes'
import { formatTimecode, mediaUrl } from '../utils'

const MIN_GAP = 0.1
const GIF_MAX = 60

interface GoonLoopProps {
  item: MediaItem
  onClose: () => void
  onPickAnother: () => void
  onSaved: (item: MediaItem, replaced: boolean) => void
}

function defaultSpan(duration: number): { start: number; end: number } {
  if (duration <= 8) return { start: 0, end: duration }
  const length = Math.min(4.5, Math.max(2.4, duration * 0.12))
  const start = Math.min(duration * 0.18, duration - length)
  return { start, end: start + length }
}

function qualityLabel(quality: number): string {
  if (quality >= 72) return 'Tight wrap'
  if (quality >= 48) return 'Decent wrap'
  return 'Loose wrap — try a shorter span around the repeating action'
}

export function GoonLoop({ item, onClose, onPickAnother, onSaved }: GoonLoopProps) {
  const { copy } = useTheme()
  const videoRef = useRef<HTMLVideoElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const drag = useRef<'start' | 'end' | null>(null)
  const findAbort = useRef<AbortController | null>(null)

  const [duration, setDuration] = useState(0)
  const [current, setCurrent] = useState(0)
  const [start, setStart] = useState(0)
  const [end, setEnd] = useState(0)
  const [paused, setPaused] = useState(true)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [finding, setFinding] = useState(false)
  const [findProgress, setFindProgress] = useState(0)
  const [quality, setQuality] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const range = Math.max(0, end - start)

  const onMeta = () => {
    const video = videoRef.current
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return
    setDuration(video.duration)
    const span = defaultSpan(video.duration)
    setStart(span.start)
    setEnd(span.end)
    setCurrent(span.start)
    video.currentTime = span.start
    setQuality(null)
  }

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const onTime = () => {
      const t = video.currentTime
      setCurrent(t)
      if (!video.paused && t >= end - 0.04) {
        video.currentTime = start
      }
    }
    const onPlay = () => setPaused(false)
    const onPause = () => setPaused(true)
    video.addEventListener('timeupdate', onTime)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    return () => {
      video.removeEventListener('timeupdate', onTime)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
    }
  }, [start, end])

  useEffect(() => () => findAbort.current?.abort(), [])

  const seek = (time: number) => {
    const video = videoRef.current
    if (!video) return
    const clamped = Math.min(duration || time, Math.max(0, time))
    video.currentTime = clamped
    setCurrent(clamped)
  }

  const togglePlay = () => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      if (video.currentTime < start || video.currentTime >= end) video.currentTime = start
      void video.play()
    } else {
      video.pause()
    }
  }

  const pct = (time: number) => (duration > 0 ? `${(time / duration) * 100}%` : '0%')

  const timeFromEvent = (clientX: number) => {
    const track = trackRef.current
    if (!track || duration <= 0) return 0
    const rect = track.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    return ratio * duration
  }

  const onPointerDown = (which: 'start' | 'end') => (e: ReactPointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    videoRef.current?.pause()
    drag.current = which
    setQuality(null)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: ReactPointerEvent) => {
    if (!drag.current) return
    const time = timeFromEvent(e.clientX)
    if (drag.current === 'start') {
      const next = Math.min(time, end - MIN_GAP)
      setStart(Math.max(0, next))
      seek(Math.max(0, next))
    } else {
      const next = Math.max(time, start + MIN_GAP)
      setEnd(Math.min(duration, next))
      seek(Math.min(duration, next))
    }
  }

  const onPointerUp = () => {
    drag.current = null
  }

  const findLoop = async () => {
    const video = videoRef.current
    if (!video || duration <= 0 || finding || busy) return
    video.pause()
    findAbort.current?.abort()
    const controller = new AbortController()
    findAbort.current = controller
    const restore = video.currentTime
    setFinding(true)
    setFindProgress(0)
    setError(null)
    try {
      const match = await findSeamlessLoop(video, start, end, setFindProgress, controller.signal)
      setStart(match.start)
      setEnd(match.end)
      setQuality(match.quality)
      video.currentTime = match.start
      setCurrent(match.start)
      void video.play()
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setError((err as Error).message)
      video.currentTime = restore
    } finally {
      if (findAbort.current === controller) findAbort.current = null
      setFinding(false)
    }
  }

  const save = useCallback(
    async (mode: TrimMode | 'gif') => {
      const video = videoRef.current
      video?.pause()
      if (video) {
        video.removeAttribute('src')
        video.load()
      }
      setBusy(true)
      setError(null)
      setConfirm(false)
      try {
        await new Promise((resolve) => setTimeout(resolve, 80))
        const result =
          mode === 'gif'
            ? await window.api.makeGif(item.id, start, end, { quality: 'high', fps: 15, loop: true }, 'new')
            : await window.api.loopVideo(item.id, start, end, mode)
        onSaved(result.item, result.replaced)
      } catch (err) {
        setError((err as Error).message)
        if (video) video.src = mediaUrl(item)
      } finally {
        setBusy(false)
      }
    },
    [end, item, onSaved, start]
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      if (e.key === 'Escape') {
        e.preventDefault()
        if (finding) findAbort.current?.abort()
        else if (confirm) setConfirm(false)
        else onClose()
      } else if (e.key === ' ' && !confirm && !busy && !finding) {
        e.preventDefault()
        togglePlay()
      } else if ((e.key === 'l' || e.key === 'L') && !confirm && !busy && !finding) {
        e.preventDefault()
        void findLoop()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [busy, confirm, finding, onClose, start, end, duration])

  return (
    <div className="trimmer">
      <header className="trimmer-top">
        <div className="viewer-title">
          <span className="viewer-name">{item.fileName}</span>
          <span className="viewer-sub">
            {copy.goonLoop}
            {item.tags.length > 0 ? ` · ${item.tags.join(' · ')}` : ''}
          </span>
        </div>
        <div className="viewer-actions">
          <button className="btn btn-ghost btn-sm" onClick={onPickAnother} disabled={busy || finding}>
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
          src={mediaUrl(item)}
          crossOrigin="anonymous"
          playsInline
          onLoadedMetadata={onMeta}
        />
      </div>

      <div className="trimmer-dock">
        <div className="trimmer-times">
          <span>In {formatTimecode(start)}</span>
          <span>Loop {formatTimecode(range)}</span>
          <span>Out {formatTimecode(end)}</span>
        </div>
        <div
          ref={trackRef}
          className="trimmer-timeline"
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest('.trimmer-handle')) return
            const time = timeFromEvent(e.clientX)
            seek(Math.min(end, Math.max(start, time)))
          }}
        >
          <div className="trimmer-range" style={{ left: pct(start), width: pct(end - start) }} />
          <div className="trimmer-playhead" style={{ left: pct(current) }} />
          <button
            className="trimmer-handle start"
            style={{ left: pct(start) }}
            onPointerDown={onPointerDown('start')}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            aria-label="Start of loop"
          />
          <button
            className="trimmer-handle end"
            style={{ left: pct(end) }}
            onPointerDown={onPointerDown('end')}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            aria-label="End of loop"
          />
        </div>
        <div className="trimmer-actions">
          <button className="scroller-btn" onClick={togglePlay} title="Play / pause (Space)" disabled={busy || finding || duration === 0}>
            {paused ? <Play size={16} fill="currentColor" /> : <Pause size={16} />}
          </button>
          <span className="trimmer-now">
            {formatTimecode(current)} / {formatTimecode(duration)}
          </span>
          {quality !== null && <span className="loop-quality">{qualityLabel(quality)}</span>}
          <div className="toolbar-spacer" />
          <button
            className="btn btn-secondary"
            disabled={busy || finding || duration === 0 || range < MIN_GAP + 0.3}
            onClick={() => void findLoop()}
            title="Find loop (L)"
          >
            <Repeat size={16} /> Find loop
          </button>
          <button
            className="btn btn-primary"
            disabled={busy || finding || duration === 0 || range < MIN_GAP}
            onClick={() => setConfirm(true)}
          >
            <Repeat size={16} /> Save loop
          </button>
        </div>
        {error && <p className="trimmer-error">{error}</p>}
      </div>

      {confirm && (
        <div className="modal-backdrop" onClick={() => !busy && setConfirm(false)}>
          <div className="modal trim-save" onClick={(e) => e.stopPropagation()}>
            <header className="modal-header">
              <div className="modal-icon">
                <Repeat size={20} />
              </div>
              <div>
                <h2>Save Goon Loop</h2>
                <p>
                  Keep a {formatTimecode(range)} loop. The saved file inherits the original tags
                  {item.tags.length > 0 ? ` (${item.tags.join(', ')})` : ''} and adds{' '}
                  <strong>goon loop</strong>.
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
              <button
                className="btn btn-secondary"
                disabled={range > GIF_MAX}
                title={range > GIF_MAX ? 'GIFs have to stay under 60 seconds' : undefined}
                onClick={() => void save('gif')}
              >
                Save as a looping GIF
              </button>
              <button className="btn btn-ghost" onClick={() => setConfirm(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {(busy || finding) && (
        <div className="busy">
          <Loader2 className="spin" size={16} />{' '}
          {finding ? `Finding a loop… ${Math.round(findProgress * 100)}%` : 'Saving loop…'}
        </div>
      )}
    </div>
  )
}
