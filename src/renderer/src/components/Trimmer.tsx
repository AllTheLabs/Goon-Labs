import { useCallback, useEffect, useRef, useState } from 'react'
import { Pause, Play, Scissors, X } from 'lucide-react'
import type { JobProgress, MediaItem, TrimMode } from '../../../shared/types'
import { useTheme } from '../themes'
import { formatTimecode, mediaUrl } from '../utils'
import { clampSlide, EditorTimeline } from './EditorTimeline'
import { UtilityProgress } from './UtilityProgress'

const MIN_GAP = 0.1

interface TrimmerProps {
  item: MediaItem
  onClose: () => void
  onPickAnother: () => void
  onSaved: (item: MediaItem, replaced: boolean) => void
}

export function Trimmer({ item, onClose, onPickAnother, onSaved }: TrimmerProps) {
  const { copy } = useTheme()
  const videoRef = useRef<HTMLVideoElement>(null)

  const [duration, setDuration] = useState(0)
  const [current, setCurrent] = useState(0)
  const [start, setStart] = useState(0)
  const [end, setEnd] = useState(0)
  const [paused, setPaused] = useState(true)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<JobProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const src = mediaUrl(item)

  const range = Math.max(0, end - start)

  const onMeta = () => {
    const video = videoRef.current
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return
    setDuration(video.duration)
    setStart(0)
    setEnd(video.duration)
    setCurrent(0)
    if (video.currentTime < 0.02) video.currentTime = 0.05
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

  const resizeKeep = (_id: string, edge: 'start' | 'end', time: number) => {
    videoRef.current?.pause()
    if (edge === 'start') {
      const next = Math.max(0, Math.min(time, end - MIN_GAP))
      setStart(next)
      seek(next)
    } else {
      const next = Math.min(duration, Math.max(time, start + MIN_GAP))
      setEnd(next)
      seek(next)
    }
  }

  const moveKeep = (_id: string, nextStart: number, _nextEnd: number, previewTime: number) => {
    videoRef.current?.pause()
    const slid = clampSlide(nextStart, end - start, duration, [], start, end)
    setStart(slid.start)
    setEnd(slid.end)
    seek(previewTime)
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
        title: 'Saving trim',
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
        const result = await window.api.trimVideo(item.id, start, end, mode)
        onSaved(result.item, result.replaced)
      } catch (err) {
        setError((err as Error).message)
        if (video) video.src = src
      } finally {
        setBusy(false)
        setProgress(null)
      }
    },
    [end, item, onSaved, src, start]
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
            {copy.trimmer}
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
          <span>Start {formatTimecode(start)}</span>
          <span>Keep {formatTimecode(range)}</span>
          <span>End {formatTimecode(end)}</span>
        </div>
        <EditorTimeline
          itemId={item.id}
          duration={duration}
          current={current}
          disabled={busy}
          spans={[{ id: 'keep', start, end, selected: true, label: 'Keep' }]}
          onSeek={(time) => seek(Math.min(end, Math.max(start, time)))}
          onResize={resizeKeep}
          onMove={moveKeep}
        />
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
            <Scissors size={16} /> Save trim
          </button>
        </div>
        {error && <p className="trimmer-error">{error}</p>}
      </div>

      {confirm && (
        <div className="modal-backdrop" onClick={() => !busy && setConfirm(false)}>
          <div className="modal trim-save" onClick={(e) => e.stopPropagation()}>
            <header className="modal-header">
              <div className="modal-icon">
                <Scissors size={20} />
              </div>
              <div>
                <h2>Save trim</h2>
                <p>
                  Keep {formatTimecode(range)} from this clip. The saved file inherits the original
                  tags{item.tags.length > 0 ? ` (${item.tags.join(', ')})` : ''}.
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

      <UtilityProgress open={busy} progress={progress} title="Saving trim" />
    </div>
  )
}
