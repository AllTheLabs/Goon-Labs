import { useCallback, useEffect, useRef, useState } from 'react'
import { Pause, Play, Volume1, Volume2, VolumeX, X } from 'lucide-react'
import { HypnoReverb } from '../hypnoReverb'
import type { LabPrefs } from '../labPrefs'
import { useTheme } from '../themes'
import { mediaUrl } from '../utils'
import { useLabSession } from './LabSession'
import { HYPNO_SPEEDS, saveHypnoSettings } from './HypnoSetup'
import type { HypnoSettings, HypnoSpeed } from './HypnoSetup'
import type { QueueEntry } from './QueueSetup'

interface HypnoPlayerProps {
  entries: QueueEntry[]
  settings: HypnoSettings
  launch?: LabPrefs
  onExit: () => void
  onFailed: () => void
}

const CONTROLS_HIDE_MS = 2500
const MIN_CLIP = 0.35

interface Snippet {
  index: number
  start: number
  duration: number
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

function waitFor(video: HTMLVideoElement, event: 'loadedmetadata' | 'seeked', timeoutMs = 8000): Promise<void> {
  if (event === 'loadedmetadata' && video.readyState >= 1) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const onOk = () => {
      window.clearTimeout(timer)
      video.removeEventListener(event, onOk)
      video.removeEventListener('error', onErr)
      resolve()
    }
    const onErr = () => {
      window.clearTimeout(timer)
      video.removeEventListener(event, onOk)
      video.removeEventListener('error', onErr)
      reject(new Error('Could not load that clip'))
    }
    const timer = window.setTimeout(onErr, timeoutMs)
    video.addEventListener(event, onOk, { once: true })
    video.addEventListener('error', onErr, { once: true })
  })
}

export function HypnoPlayer({ entries, settings, launch, onExit, onFailed }: HypnoPlayerProps) {
  const { copy } = useTheme()
  const lab = useLabSession(copy.hypnoStation, launch)
  const stageRef = useRef<HTMLDivElement>(null)
  const flashRef = useRef<HTMLDivElement>(null)
  const aRef = useRef<HTMLVideoElement>(null)
  const bRef = useRef<HTMLVideoElement>(null)
  const skipRef = useRef<() => void>(() => {})
  const engineRef = useRef<{
    setVolume: (volume: number) => void
    pause: () => void
    resume: () => void
  } | null>(null)

  const [paused, setPaused] = useState(false)
  const [speed, setSpeed] = useState(settings.speed)
  const [volume, setVolume] = useState(0.8)
  const [muted, setMuted] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [nowPlaying, setNowPlaying] = useState('')
  const [cuts, setCuts] = useState(0)

  const pausedRef = useRef(paused)
  const speedRef = useRef(speed)
  pausedRef.current = paused
  speedRef.current = speed

  useEffect(() => saveHypnoSettings({ speed }), [speed])

  useEffect(() => {
    const a = aRef.current
    const b = bRef.current
    if (!a || !b) return

    const reverb = new HypnoReverb()
    reverb.attach(a)
    reverb.attach(b)
    reverb.resume()
    reverb.setVolume(muted ? 0 : volume)

    let gen = 0
    let active = 0
    let lastIndex = -1
    let failures = 0
    let cutTimer = 0
    let remaining = 0
    let cutAt = 0
    let closed = false

    const pulse = () => {
      stageRef.current?.animate(
        [
          { transform: 'scale(1.08)', filter: 'brightness(1.45) saturate(1.35)' },
          { transform: 'scale(1)', filter: 'brightness(1) saturate(1)' }
        ],
        { duration: 360, easing: 'cubic-bezier(0.15, 0.85, 0.3, 1)' }
      )
      flashRef.current?.animate([{ opacity: 0.7 }, { opacity: 0 }], { duration: 420, easing: 'ease-out' })
    }

    const pick = (): Snippet => {
      const range = HYPNO_SPEEDS[speedRef.current]
      let index = Math.floor(Math.random() * entries.length)
      if (entries.length > 1 && index === lastIndex) index = (index + 1) % entries.length
      lastIndex = index
      return { index, start: 0, duration: randomBetween(range.min, range.max) / 1000 }
    }

    const prepare = async (video: HTMLVideoElement, snippet: Snippet): Promise<Snippet> => {
      const item = entries[snippet.index].item
      const url = mediaUrl(item)
      if (video.getAttribute('src') !== url) {
        video.src = url
        await waitFor(video, 'loadedmetadata')
      }
      const duration = video.duration
      if (!Number.isFinite(duration) || duration < 0.2) throw new Error('clip too short')
      const span = Math.min(Math.max(MIN_CLIP, snippet.duration), Math.max(MIN_CLIP, duration - 0.05))
      const start = duration <= span + 0.05 ? 0 : Math.random() * (duration - span)
      if (Math.abs(video.currentTime - start) > 0.04) {
        video.currentTime = start
        await waitFor(video, 'seeked')
      }
      return { index: snippet.index, start, duration: span }
    }

    const schedule = (ms: number, token: number) => {
      window.clearTimeout(cutTimer)
      remaining = ms
      cutAt = performance.now() + ms
      cutTimer = window.setTimeout(() => {
        if (closed || token !== gen || pausedRef.current) return
        void cut(token)
      }, ms)
    }

    const show = (video: HTMLVideoElement, snippet: Snippet, token: number) => {
      if (closed || token !== gen) return
      video.muted = false
      video.volume = 1
      reverb.resume()
      void video.play().catch(() => {})
      setNowPlaying(entries[snippet.index].item.fileName)
      setCuts((n) => n + 1)
      schedule(snippet.duration * 1000, token)
    }

    const cut = async (token: number) => {
      if (closed || token !== gen) return
      const incoming = active === 0 ? b : a
      const outgoing = active === 0 ? a : b
      try {
        const snippet = await prepare(incoming, pick())
        if (closed || token !== gen) return
        failures = 0
        incoming.classList.add('active')
        outgoing.classList.remove('active')
        outgoing.muted = true
        outgoing.pause()
        active = active === 0 ? 1 : 0
        pulse()
        show(incoming, snippet, token)
        void prepare(outgoing, pick()).catch(() => {})
      } catch {
        failures++
        if (failures >= Math.max(3, entries.length * 2)) {
          onFailed()
          return
        }
        window.setTimeout(() => {
          if (!closed && token === gen) void cut(token)
        }, 80)
      }
    }

    skipRef.current = () => {
      window.clearTimeout(cutTimer)
      remaining = 0
      void cut(gen)
    }

    engineRef.current = {
      setVolume: (level) => reverb.setVolume(level),
      pause: () => {
        const current = active === 0 ? a : b
        current.pause()
        window.clearTimeout(cutTimer)
        remaining = Math.max(0, cutAt - performance.now())
      },
      resume: () => {
        const current = active === 0 ? a : b
        reverb.resume()
        void current.play().catch(() => {})
        schedule(remaining, gen)
      }
    }

    const onEndedA = () => {
      if (active === 0 && !pausedRef.current) skipRef.current()
    }
    const onEndedB = () => {
      if (active === 1 && !pausedRef.current) skipRef.current()
    }
    a.addEventListener('ended', onEndedA)
    b.addEventListener('ended', onEndedB)

    void (async () => {
      try {
        const first = await prepare(a, pick())
        if (closed) return
        a.classList.add('active')
        pulse()
        show(a, first, gen)
        void prepare(b, pick()).catch(() => {})
      } catch {
        void cut(gen)
      }
    })()

    return () => {
      closed = true
      gen++
      window.clearTimeout(cutTimer)
      a.removeEventListener('ended', onEndedA)
      b.removeEventListener('ended', onEndedB)
      engineRef.current = null
      reverb.close()
    }
  }, [entries, onFailed])

  useEffect(() => {
    engineRef.current?.setVolume(muted ? 0 : volume)
  }, [volume, muted])

  const pauseReady = useRef(false)
  useEffect(() => {
    if (!pauseReady.current) {
      pauseReady.current = true
      return
    }
    if (paused) engineRef.current?.pause()
    else engineRef.current?.resume()
  }, [paused])

  const hideTimer = useRef<number | undefined>(undefined)
  const overControls = useRef(false)
  const revealControls = useCallback(() => {
    setControlsVisible(true)
    window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => {
      if (!overControls.current) setControlsVisible(false)
    }, CONTROLS_HIDE_MS)
  }, [])

  useEffect(() => {
    revealControls()
    return () => window.clearTimeout(hideTimer.current)
  }, [revealControls])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement && e.target.type !== 'range' && e.target.type !== 'checkbox') return
      const key = e.key.toLowerCase()
      if (key === 'escape') onExit()
      else if (key === ' ') setPaused((p) => !p)
      else if (key === 'arrowright') skipRef.current()
      else if (key === 'm') setMuted((m) => !m)
      else if (key === '1') setSpeed('linger')
      else if (key === '2') setSpeed('flash')
      else if (key === '3') setSpeed('strobe')
      else if (key === 'arrowup') setVolume((v) => Math.min(1, v + 0.05))
      else if (key === 'arrowdown') setVolume((v) => Math.max(0, v - 0.05))
      else return
      e.preventDefault()
      e.stopPropagation()
      revealControls()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onExit, revealControls])

  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2

  return (
    <div
      className={`queue-player hypno-player ${controlsVisible ? '' : 'idle'}`}
      onMouseMove={revealControls}
      onClick={() => setPaused((p) => !p)}
    >
      <div className="queue-stage hypno-stage" ref={stageRef}>
        <video ref={aRef} className="queue-video hypno-video" crossOrigin="anonymous" playsInline preload="auto" />
        <video ref={bRef} className="queue-video hypno-video" crossOrigin="anonymous" playsInline preload="auto" />
        <div className="hypno-hue" />
        <div className="hypno-vignette" />
      </div>
      <div className="queue-flash hypno-flash" ref={flashRef} />
      {lab.overlay}

      <div
        className="scroller-controls queue-controls"
        onClick={(e) => e.stopPropagation()}
        onMouseEnter={() => (overControls.current = true)}
        onMouseLeave={() => {
          overControls.current = false
          revealControls()
        }}
      >
        <div className="scroller-info">
          <span className="scroller-tags queue-now" title={nowPlaying}>
            {nowPlaying || copy.hypnoStation}
          </span>
          <span className="scroller-count">
            {copy.hypnoStation} · {entries.length} clips · {cuts} cuts
          </span>
        </div>

        <div className="scroller-divider" />

        <button className="scroller-btn" onClick={() => setPaused((p) => !p)} title="Play / pause (Space)">
          {paused ? <Play size={16} fill="currentColor" /> : <Pause size={16} fill="currentColor" />}
        </button>
        <button className="scroller-btn pixel-toggle" onClick={() => skipRef.current()} title="Next snippet (→)">
          Cut
        </button>

        <div className="scroller-divider" />

        <div className="segmented queue-beat-picker" title="Cut speed (1 / 2 / 3)">
          {(Object.keys(HYPNO_SPEEDS) as HypnoSpeed[]).map((key) => (
            <button key={key} className={speed === key ? 'active' : ''} onClick={() => setSpeed(key)}>
              {HYPNO_SPEEDS[key].label}
            </button>
          ))}
        </div>

        <div className="scroller-slider volume" title="Volume (↑ / ↓, M to mute)">
          <button className="scroller-btn" onClick={() => setMuted((m) => !m)}>
            <VolumeIcon size={16} />
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={muted ? 0 : volume}
            onChange={(e) => {
              setMuted(false)
              setVolume(Number(e.target.value))
            }}
          />
        </div>

        <div className="scroller-divider" />
        {lab.controls}
        <div className="scroller-divider" />

        <button className="scroller-btn" onClick={onExit} title="Exit (Esc)">
          <X size={18} />
        </button>
      </div>
    </div>
  )
}
