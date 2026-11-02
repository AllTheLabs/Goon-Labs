import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { Image, Loader2, Pause, Play, X } from 'lucide-react'
import type { GifFps, GifQuality, MediaItem, TrimMode } from '../../../shared/types'
import { GIF_FPS, GIF_QUALITIES } from '../../../shared/types'
import { useTheme } from '../themes'
import { formatTimecode, mediaUrl } from '../utils'

const MIN_GAP = 0.1
const LONG_HINT = 10

const QUALITY_FPS: Record<GifQuality, GifFps> = {
  low: 8,
  medium: 12,
  high: 15,
  ultra: 20
}

const QUALITY_META: Record<GifQuality, { label: string; hint: string }> = {
  low: { label: 'Low', hint: '320px · smaller file' },
  medium: { label: 'Medium', hint: '480px' },
  high: { label: 'High', hint: '720px' },
  ultra: { label: 'Ultra', hint: '1080px · largest file' }
}

interface GifMakerProps {
  item: MediaItem
  onClose: () => void
  onPickAnother: () => void
  onSaved: (item: MediaItem, replaced: boolean) => void
}

export function GifMaker({ item, onClose, onPickAnother, onSaved }: GifMakerProps) {
  const { copy } = useTheme()
  const videoRef = useRef<HTMLVideoElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const drag = useRef<'start' | 'end' | null>(null)

  const [duration, setDuration] = useState(0)
  const [current, setCurrent] = useState(0)
  const [start, setStart] = useState(0)
  const [end, setEnd] = useState(0)
  const [paused, setPaused] = useState(true)
  const [quality, setQuality] = useState<GifQuality>('medium')
  const [fps, setFps] = useState<GifFps>(12)
  const [loop, setLoop] = useState(true)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const range = Math.max(0, end - start)

  const onMeta = () => {
    const video = videoRef.current
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return
    setDuration(video.duration)
    setStart(0)
    setEnd(Math.min(video.duration, 6))
    setCurrent(0)
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

  const pickQuality = (next: GifQuality) => {
    setQuality(next)
    setFps(QUALITY_FPS[next])
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
      setError(null)
      setConfirm(false)
      try {
        await new Promise((resolve) => setTimeout(resolve, 80))
        const result = await window.api.makeGif(item.id, start, end, { quality, fps, loop }, mode)
        onSaved(result.item, result.replaced)
      } catch (err) {
        setError((err as Error).message)
        if (video) video.src = mediaUrl(item)
      } finally {
        setBusy(false)
      }
    },
    [end, fps, item, loop, onSaved, quality, start]
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      if (e.key === 'Escape') {
        e.preventDefault()
        if (confirm) setConfirm(false)
        else onClose()
      } else if (e.key === ' ' && !confirm && !busy) {
        e.preventDefault()
        togglePlay()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [busy, confirm, onClose])

  return (
    <div className="trimmer">
      <header className="trimmer-top">
        <div className="viewer-title">
          <span className="viewer-name">{item.fileName}</span>
          <span className="viewer-sub">
            {copy.goonImageFormat}
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
          src={mediaUrl(item)}
          playsInline
          onLoadedMetadata={onMeta}
        />
      </div>

      <div className="trimmer-dock">
        <div className="trimmer-times">
          <span>Start {formatTimecode(start)}</span>
          <span>
            GIF {formatTimecode(range)}
            {range > LONG_HINT ? ' · long GIFs make large files' : ''}
          </span>
          <span>End {formatTimecode(end)}</span>
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
            aria-label="Start of GIF"
          />
          <button
            className="trimmer-handle end"
            style={{ left: pct(end) }}
            onPointerDown={onPointerDown('end')}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            aria-label="End of GIF"
          />
        </div>
        <div className="gif-controls">
          <div className="gif-control">
            <span className="field-label">Quality</span>
            <div className="segmented small">
              {GIF_QUALITIES.map((value) => (
                <button
                  key={value}
                  className={quality === value ? 'active' : ''}
                  onClick={() => pickQuality(value)}
                  title={QUALITY_META[value].hint}
                >
                  {QUALITY_META[value].label}
                </button>
              ))}
            </div>
            <span className="gif-hint">{QUALITY_META[quality].hint}</span>
          </div>
          <div className="gif-control">
            <span className="field-label">Frame rate</span>
            <div className="segmented small">
              {GIF_FPS.map((value) => (
                <button key={value} className={fps === value ? 'active' : ''} onClick={() => setFps(value)}>
                  {value}
                </button>
              ))}
            </div>
            <span className="gif-hint">{fps} fps</span>
          </div>
          <label className={`endless-toggle gif-loop ${loop ? 'on' : ''}`}>
            <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
            <span>
              <strong>Loop</strong>
              <small>Repeat the GIF forever</small>
            </span>
          </label>
        </div>
        <div className="trimmer-actions">
          <button className="scroller-btn" onClick={togglePlay} title="Play / pause (Space)" disabled={busy || duration === 0}>
            {paused ? <Play size={16} fill="currentColor" /> : <Pause size={16} />}
          </button>
          <span className="trimmer-now">
            {formatTimecode(current)} / {formatTimecode(duration)}
          </span>
          <div className="toolbar-spacer" />
          <button
            className="btn btn-primary"
            disabled={busy || duration === 0 || range < MIN_GAP}
            onClick={() => setConfirm(true)}
          >
            <Image size={16} /> Save GIF
          </button>
        </div>
        {error && <p className="trimmer-error">{error}</p>}
      </div>

      {confirm && (
        <div className="modal-backdrop" onClick={() => !busy && setConfirm(false)}>
          <div className="modal trim-save" onClick={(e) => e.stopPropagation()}>
            <header className="modal-header">
              <div className="modal-icon">
                <Image size={20} />
              </div>
              <div>
                <h2>Save GIF</h2>
                <p>
                  {formatTimecode(range)} at {QUALITY_META[quality].label.toLowerCase()} quality, {fps} fps
                  {loop ? ', looping' : ''}. The GIF inherits the original tags
                  {item.tags.length > 0 ? ` (${item.tags.join(', ')})` : ''} and adds <strong>gif</strong>.
                </p>
              </div>
            </header>
            <div className="trim-save-actions">
              <button className="btn btn-primary" onClick={() => void save('new')}>
                Save as a new GIF
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

      {busy && (
        <div className="busy">
          <Loader2 className="spin" size={16} /> Encoding GIF…
        </div>
      )}
    </div>
  )
}
