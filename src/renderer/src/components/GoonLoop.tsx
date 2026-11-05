import { useCallback, useEffect, useRef, useState } from 'react'
import { Pause, Play, Repeat, X } from 'lucide-react'
import type { JobProgress, MediaItem, TrimMode } from '../../../shared/types'
import { findSeamlessLoop } from '../goonLoop'
import { useTheme } from '../themes'
import { formatTimecode, mediaUrl } from '../utils'
import { clampSlide, EditorTimeline } from './EditorTimeline'
import { UtilityProgress } from './UtilityProgress'

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
  const findAbort = useRef<AbortController | null>(null)

  const [duration, setDuration] = useState(0)
  const [current, setCurrent] = useState(0)
  const [start, setStart] = useState(0)
  const [end, setEnd] = useState(0)
  const [paused, setPaused] = useState(true)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [finding, setFinding] = useState(false)
  const [progress, setProgress] = useState<JobProgress | null>(null)
  const [quality, setQuality] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const src = mediaUrl(item)

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

  const resizeKeep = (_id: string, edge: 'start' | 'end', time: number) => {
    videoRef.current?.pause()
    setQuality(null)
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
    setQuality(null)
    const slid = clampSlide(nextStart, end - start, duration, [], start, end)
    setStart(slid.start)
    setEnd(slid.end)
    seek(previewTime)
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
    setProgress({
      title: 'Finding a loop',
      detail: 'Sampling frames…',
      percent: 0,
      current: 0,
      total: 0,
      steps: [
        { id: 'sample', label: 'Sampling frames', state: 'active' },
        { id: 'match', label: 'Picking the wrap', state: 'pending' }
      ]
    })
    setError(null)
    try {
      const match = await findSeamlessLoop(
        video,
        start,
        end,
        (ratio) => {
          const sampling = ratio < 0.92
          setProgress({
            title: 'Finding a loop',
            detail: sampling ? 'Sampling frames…' : 'Picking the wrap…',
            percent: ratio,
            current: 0,
            total: 0,
            steps: [
              { id: 'sample', label: 'Sampling frames', state: sampling ? 'active' : 'done' },
              { id: 'match', label: 'Picking the wrap', state: sampling ? 'pending' : 'active' }
            ]
          })
        },
        controller.signal
      )
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
      setProgress(null)
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
      setProgress({
        title: 'Saving Goon Loop',
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
        const result =
          mode === 'gif'
            ? await window.api.makeGif(item.id, start, end, { quality: 'high', fps: 15, loop: true }, 'new')
            : await window.api.loopVideo(item.id, start, end, mode)
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
          <button className="viewer-btn" onClick={onClose} aria-label="Close" disabled={busy || finding}>
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
          crossOrigin="anonymous"
          playsInline
          preload="auto"
          onLoadedMetadata={onMeta}
        />
      </div>

      <div className="trimmer-dock">
        <div className="trimmer-times">
          <span>In {formatTimecode(start)}</span>
          <span>Loop {formatTimecode(range)}</span>
          <span>Out {formatTimecode(end)}</span>
        </div>
        <EditorTimeline
          itemId={item.id}
          duration={duration}
          current={current}
          disabled={busy || finding}
          spans={[{ id: 'keep', start, end, selected: true, label: 'Loop' }]}
          onSeek={(time) => seek(Math.min(end, Math.max(start, time)))}
          onResize={resizeKeep}
          onMove={moveKeep}
        />
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

      <UtilityProgress
        open={busy || finding}
        progress={progress}
        title={finding ? 'Finding a loop' : 'Saving Goon Loop'}
      />
    </div>
  )
}
