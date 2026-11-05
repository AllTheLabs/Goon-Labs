import { useCallback, useEffect, useRef, useState } from 'react'
import { Heart, Loader2, Pause, Play, Volume1, Volume2, VolumeX, WandSparkles, Waves, X } from 'lucide-react'
import { findSeamlessLoop, liveLoopSearchSpan } from '../goonLoop'
import { HypnoReverb } from '../hypnoReverb'
import type { LabPrefs } from '../labPrefs'
import type { LabRecap } from '../labRecap'
import { recapCount } from '../labRecap'
import { useTheme } from '../themes'
import { mediaUrl } from '../utils'
import { useLabSession } from './LabSession'
import { HYPNO_SPEEDS, saveHypnoSettings } from './HypnoSetup'
import type { HypnoSettings, HypnoSpeed } from './HypnoSetup'
import type { QueueEntry } from './QueueSetup'
import {
  anyEffectActive,
  DEFAULT_EFFECTS,
  EffectsOverlay,
  EffectsPanel,
  useEffectSettings
} from './ScrollerEffects'

interface HypnoPlayerProps {
  entries: QueueEntry[]
  settings: HypnoSettings
  launch?: LabPrefs
  onExit: (recap: LabRecap) => void
}

const CONTROLS_HIDE_MS = 2500

interface Snippet {
  index: number
  start: number
  duration: number
}

interface LiveLock {
  index: number
  start: number
  end: number
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

export function HypnoPlayer({ entries, settings, launch, onExit }: HypnoPlayerProps) {
  const { copy } = useTheme()
  const endRef = useRef<() => void>(() => {})
  const lab = useLabSession(copy.hypnoStation, launch, () => endRef.current())
  const ended = useRef(false)
  const clipStats = useRef({ shown: 0, unique: new Set<string>() })
  const stageRef = useRef<HTMLDivElement>(null)
  const flashRef = useRef<HTMLDivElement>(null)
  const aRef = useRef<HTMLVideoElement>(null)
  const bRef = useRef<HTMLVideoElement>(null)
  const skipRef = useRef<() => void>(() => {})
  const probeRef = useRef<HTMLVideoElement>(null)
  const lockRef = useRef<LiveLock | null>(null)
  const playingRef = useRef<Snippet | null>(null)
  const findAbort = useRef<AbortController | null>(null)
  const engineRef = useRef<{
    setVolume: (volume: number) => void
    setRumble: (on: boolean) => void
    pause: () => void
    resume: () => void
    getPlayback: () => { index: number; currentTime: number } | null
    rearmStandby: () => void
  } | null>(null)

  const [paused, setPaused] = useState(false)
  const [speed, setSpeed] = useState(settings.speed)
  const [rumble, setRumble] = useState(settings.rumble)
  const [liveLoop, setLiveLoop] = useState(false)
  const [liveLoopBusy, setLiveLoopBusy] = useState(false)
  const [liveLoopHint, setLiveLoopHint] = useState<string | null>(null)
  const liveLocks = useRef(0)
  const [effects, setEffects] = useEffectSettings('hypno.effects.v3', {
    ...DEFAULT_EFFECTS,
    spiral: true,
    tint: false,
    opacity: 0.15,
    spiralThickness: 0.04
  })
  const [effectsPanelOpen, setEffectsPanelOpen] = useState(false)
  const [volume, setVolume] = useState(0.8)
  const [muted, setMuted] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [nowPlaying, setNowPlaying] = useState('')
  const [cuts, setCuts] = useState(0)

  const pausedRef = useRef(paused)
  const speedRef = useRef(speed)
  const rumbleRef = useRef(rumble)
  pausedRef.current = paused
  speedRef.current = speed
  rumbleRef.current = rumble

  useEffect(() => saveHypnoSettings({ speed, rumble }), [speed, rumble])

  useEffect(() => {
    const a = aRef.current
    const b = bRef.current
    if (!a || !b) return

    const reverb = new HypnoReverb()
    reverb.attach(a)
    reverb.attach(b)
    reverb.resume()
    reverb.setVolume((muted ? 0 : volume) * lab.fade)
    reverb.setRumble(rumbleRef.current)

    let active = 0
    let lastIndex = -1
    let failures = 0
    let armGen = 0
    let closed = false
    let next: { video: HTMLVideoElement; snippet: Snippet } | null = null

    const specNow = () => HYPNO_SPEEDS[speedRef.current]

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
      const spec = specNow()
      const lock = lockRef.current
      if (lock) {
        lastIndex = lock.index
        return { index: lock.index, start: lock.start, duration: spec.duration }
      }
      let index = Math.floor(Math.random() * entries.length)
      if (entries.length > 1 && index === lastIndex) index = (index + 1) % entries.length
      lastIndex = index
      return { index, start: 0, duration: spec.duration }
    }

    const prepare = async (video: HTMLVideoElement, snippet: Snippet): Promise<Snippet> => {
      const item = entries[snippet.index].item
      const url = mediaUrl(item)
      const lock = lockRef.current
      const locked = lock !== null && lock.index === snippet.index
      video.loop = !locked
      if (video.getAttribute('src') !== url) {
        video.src = url
        await waitFor(video, 'loadedmetadata')
      }
      const clipDur = video.duration
      if (!Number.isFinite(clipDur) || clipDur < 0.15) throw new Error('clip too short')
      let start: number
      if (locked && lock) {
        const span = Math.max(0, lock.end - lock.start)
        start = span <= 0.08 ? lock.start : lock.start + Math.random() * Math.max(0, span - 0.08)
      } else {
        start = Math.random() * Math.max(0, clipDur - 0.08)
      }
      if (Math.abs(video.currentTime - start) > 0.04) {
        video.currentTime = start
        await waitFor(video, 'seeked')
      }
      return { index: snippet.index, start, duration: snippet.duration }
    }

    const arm = (video: HTMLVideoElement) => {
      const token = ++armGen
      const snippet = pick()
      void (async () => {
        try {
          const ready = await prepare(video, snippet)
          if (closed || token !== armGen) return
          next = { video, snippet: ready }
          failures = 0
        } catch {
          if (closed || token !== armGen) return
          failures++
          if (failures >= Math.max(3, entries.length * 2)) {
            endRef.current()
            return
          }
          window.setTimeout(() => {
            if (!closed && token === armGen) arm(video)
          }, 80)
        }
      })()
    }

    const reveal = (video: HTMLVideoElement, snippet: Snippet) => {
      video.muted = false
      video.volume = 1
      video.classList.add('active')
      void video.play().catch(() => {})
      const item = entries[snippet.index].item
      clipStats.current.shown++
      clipStats.current.unique.add(item.id)
      playingRef.current = snippet
      setNowPlaying(item.fileName)
      setCuts(clipStats.current.shown)
    }

    const swapLayers = () => {
      const incoming = active === 0 ? b : a
      const outgoing = active === 0 ? a : b
      outgoing.muted = true
      outgoing.pause()
      if (next?.video === incoming) {
        incoming.classList.add('active')
        outgoing.classList.remove('active')
        reveal(incoming, next.snippet)
        active = active === 0 ? 1 : 0
        next = null
        arm(outgoing)
        return
      }
      const token = ++armGen
      const snippet = pick()
      void (async () => {
        try {
          const ready = await prepare(incoming, snippet)
          if (closed || token !== armGen) return
          incoming.classList.add('active')
          outgoing.classList.remove('active')
          reveal(incoming, ready)
          active = active === 0 ? 1 : 0
          next = null
          arm(outgoing)
        } catch {
          if (!closed && token === armGen) arm(incoming)
        }
      })()
    }

    const beginBar = () => {
      const spec = specNow()
      reverb.resume()
      reverb.startPhrase(spec.duration, spec.arp, () => {
        if (closed || pausedRef.current) return
        pulse()
        swapLayers()
        beginBar()
      })
    }

    skipRef.current = () => {
      if (closed) return
      const spec = specNow()
      reverb.cancelPhrase()
      pulse()
      swapLayers()
      beginBar()
      reverb.hit(spec.duration)
    }

    let wrapping = false
    let wrapRaf = 0
    const wrapTick = () => {
      wrapRaf = window.requestAnimationFrame(wrapTick)
      const lock = lockRef.current
      if (!lock || pausedRef.current || wrapping) return
      const current = active === 0 ? a : b
      if (current.currentTime >= lock.end - 0.03 && current.currentTime > lock.start + 0.05) {
        wrapping = true
        current.currentTime = lock.start
        const done = () => {
          wrapping = false
        }
        current.addEventListener('seeked', done, { once: true })
        window.setTimeout(done, 400)
      }
    }
    wrapRaf = window.requestAnimationFrame(wrapTick)

    engineRef.current = {
      setVolume: (level) => reverb.setVolume(level),
      setRumble: (on) => reverb.setRumble(on),
      pause: () => {
        const current = active === 0 ? a : b
        current.pause()
        reverb.setPaused(true)
      },
      resume: () => {
        const current = active === 0 ? a : b
        reverb.setPaused(false)
        reverb.resume()
        void current.play().catch(() => {})
        beginBar()
      },
      getPlayback: () => {
        const snippet = playingRef.current
        if (!snippet) return null
        const current = active === 0 ? a : b
        return { index: snippet.index, currentTime: current.currentTime }
      },
      rearmStandby: () => {
        const current = active === 0 ? a : b
        current.loop = lockRef.current == null
        const standby = active === 0 ? b : a
        next = null
        arm(standby)
      }
    }

    void (async () => {
      try {
        const first = await prepare(a, pick())
        if (closed) return
        a.classList.add('active')
        reveal(a, first)
        beginBar()
        arm(b)
      } catch {
        if (!closed) skipRef.current()
      }
    })()

    return () => {
      closed = true
      armGen++
      window.cancelAnimationFrame(wrapRaf)
      engineRef.current = null
      reverb.close()
    }
  }, [entries])

  useEffect(() => {
    engineRef.current?.setVolume((muted ? 0 : volume) * lab.fade)
  }, [volume, muted, lab.fade])

  useEffect(() => {
    engineRef.current?.setRumble(rumble)
  }, [rumble])

  useEffect(() => () => findAbort.current?.abort(), [])

  const toggleLiveLoop = useCallback(() => {
    if (liveLoopBusy) {
      findAbort.current?.abort()
      return
    }
    if (lockRef.current) {
      lockRef.current = null
      setLiveLoop(false)
      setLiveLoopHint(null)
      engineRef.current?.rearmStandby()
      return
    }
    const playback = engineRef.current?.getPlayback()
    const probe = probeRef.current
    if (!playback || !probe) return
    const item = entries[playback.index]?.item
    if (!item) return

    const controller = new AbortController()
    findAbort.current = controller
    setLiveLoopBusy(true)
    setLiveLoopHint(null)

    void (async () => {
      try {
        const url = mediaUrl(item)
        if (probe.getAttribute('src') !== url) {
          probe.src = url
          await waitFor(probe, 'loadedmetadata')
        }
        if (controller.signal.aborted) return
        const span = liveLoopSearchSpan(probe.duration, playback.currentTime)
        const match = await findSeamlessLoop(probe, span.start, span.end, undefined, controller.signal)
        if (controller.signal.aborted) return
        lockRef.current = { index: playback.index, start: match.start, end: match.end }
        liveLocks.current++
        setLiveLoop(true)
        engineRef.current?.rearmStandby()
      } catch (err) {
        if (controller.signal.aborted || (err as Error).name === 'AbortError') return
        lockRef.current = null
        setLiveLoop(false)
        setLiveLoopHint("Couldn't find a loop")
      } finally {
        if (findAbort.current === controller) findAbort.current = null
        setLiveLoopBusy(false)
      }
    })()
  }, [entries, liveLoopBusy])

  const pauseReady = useRef(false)
  useEffect(() => {
    if (!pauseReady.current) {
      pauseReady.current = true
      return
    }
    if (paused) engineRef.current?.pause()
    else engineRef.current?.resume()
  }, [paused])

  const end = useCallback(() => {
    if (ended.current) return
    ended.current = true
    onExit({
      lab: copy.hypnoStation,
      durationSeconds: lab.elapsedSeconds(),
      stats: [
        recapCount('Clips shown', clipStats.current.shown),
        recapCount('Unique videos', clipStats.current.unique.size),
        recapCount('Videos in queue', entries.length),
        ...(liveLocks.current > 0 ? [recapCount('Live loops', liveLocks.current)] : [])
      ]
    })
  }, [onExit, copy.hypnoStation, lab.elapsedSeconds, entries.length])
  endRef.current = end

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
      if (key === 'escape') end()
      else if (key === ' ') setPaused((p) => !p)
      else if (key === 'arrowright') skipRef.current()
      else if (key === 'm') setMuted((m) => !m)
      else if (key === '1') setSpeed('linger')
      else if (key === '2') setSpeed('flash')
      else if (key === '3') setSpeed('strobe')
      else if (key === 'b') setRumble((on) => !on)
      else if (key === 'h') void toggleLiveLoop()
      else if (key === 'e') setEffectsPanelOpen((open) => !open)
      else if (key === 'arrowup') setVolume((v) => Math.min(1, v + 0.05))
      else if (key === 'arrowdown') setVolume((v) => Math.max(0, v - 0.05))
      else return
      e.preventDefault()
      e.stopPropagation()
      revealControls()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [end, revealControls, toggleLiveLoop])

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
        <video
          ref={probeRef}
          className="hypno-probe"
          crossOrigin="anonymous"
          muted
          playsInline
          preload="auto"
        />
        <div className="hypno-hue" />
        {anyEffectActive(effects) && <EffectsOverlay settings={effects} hideTint />}
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
            {liveLoop ? ' · live loop' : liveLoopBusy ? ' · finding loop' : liveLoopHint ? ` · ${liveLoopHint}` : ''}
          </span>
        </div>

        <div className="scroller-divider" />

        <button className="scroller-btn" onClick={() => setPaused((p) => !p)} title="Play / pause (Space)">
          {paused ? <Play size={16} fill="currentColor" /> : <Pause size={16} fill="currentColor" />}
        </button>
        <button className="scroller-btn pixel-toggle" onClick={() => skipRef.current()} title="Next snippet (→)">
          Cut
        </button>
        <button
          className={`scroller-btn ${liveLoop || liveLoopBusy ? 'active' : ''}`}
          onClick={() => void toggleLiveLoop()}
          title={
            liveLoopBusy
              ? 'Finding a seamless loop… (H to cancel)'
              : liveLoop
                ? 'Live loop on — cuts stay on this clip (H)'
                : liveLoopHint
                  ? `${liveLoopHint} — try again (H)`
                  : 'Lock this clip to a seamless loop (H)'
          }
        >
          {liveLoopBusy ? (
            <Loader2 size={16} className="spin" />
          ) : (
            <Heart size={16} fill={liveLoop ? 'currentColor' : 'none'} />
          )}
        </button>
        <button
          className={`scroller-btn pixel-toggle ${rumble ? 'active' : ''}`}
          onClick={() => setRumble((on) => !on)}
          title="Melodic rumble (B)"
        >
          <Waves size={16} /> Rumble
        </button>
        <button
          className={`scroller-btn ${anyEffectActive(effects) || effectsPanelOpen ? 'active' : ''}`}
          onClick={() => setEffectsPanelOpen((open) => !open)}
          title="Overlay effects (E)"
        >
          <WandSparkles size={16} />
        </button>
        {effectsPanelOpen && <EffectsPanel settings={effects} onChange={setEffects} hideTint />}

        <div className="scroller-divider" />

        <div className="segmented queue-beat-picker" title="Cut speed — melody follows (1 / 2 / 3)">
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

        <button className="scroller-btn" onClick={end} title="Exit (Esc)">
          <X size={18} />
        </button>
      </div>
    </div>
  )
}
