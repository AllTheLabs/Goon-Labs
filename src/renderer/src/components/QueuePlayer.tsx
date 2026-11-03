import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Dices,
  Infinity as InfinityIcon,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
  X
} from 'lucide-react'
import type { LabPrefs } from '../labPrefs'
import { useTheme } from '../themes'
import { mediaUrl } from '../utils'
import { BeatBar, INTENSITIES } from './BeatBar'
import type { BeatIntensity } from './BeatBar'
import { useLabSession } from './LabSession'
import { saveQueueSettings } from './QueueSetup'
import type { QueueEntry, QueueSettings } from './QueueSetup'

interface QueuePlayerProps {
  entries: QueueEntry[]
  settings: QueueSettings
  launch?: LabPrefs
  /** The user left before the queue ran out. */
  onExit: () => void
  /** A play-once queue reached its end, or nothing in it could be played. */
  onFinished: (played: number, failed: number) => void
}

const CONTROLS_HIDE_MS = 2500
const PULSE_SCALE: Record<BeatIntensity, number> = {
  light: 1.03,
  medium: 1.045,
  heavy: 1.06,
  ludicrous: 1.08
}

export function QueuePlayer({ entries, settings, launch, onExit, onFinished }: QueuePlayerProps) {
  const { copy, theme } = useTheme()
  const lab = useLabSession(copy.queue, launch, onExit)
  const videoRef = useRef<HTMLVideoElement>(null)
  const pulseRef = useRef<HTMLDivElement>(null)
  const flashRef = useRef<HTMLDivElement>(null)

  const [index, setIndex] = useState(0)
  const [pass, setPass] = useState(0)
  const [paused, setPaused] = useState(false)
  const [endless, setEndless] = useState(settings.endless)
  const [intensity, setIntensity] = useState(settings.intensity)
  const [volume, setVolume] = useState(0.8)
  const [muted, setMuted] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)

  const played = useRef(0)
  const failures = useRef({ total: 0, inARow: 0 })
  const entry = entries[index]

  useEffect(() => saveQueueSettings({ endless, intensity }), [endless, intensity])

  const advance = useCallback(() => {
    if (index + 1 < entries.length) {
      setIndex(index + 1)
    } else if (endless) {
      setIndex(0)
      setPass((p) => p + 1)
    } else {
      onFinished(played.current, failures.current.total)
    }
  }, [index, entries.length, endless, onFinished])

  const back = useCallback(() => {
    const video = videoRef.current
    if (video && video.currentTime > 3) {
      video.currentTime = 0
    } else if (index > 0) {
      setIndex(index - 1)
    } else if (endless && pass > 0) {
      setIndex(entries.length - 1)
      setPass((p) => p - 1)
    } else if (video) {
      video.currentTime = 0
    }
  }, [index, pass, endless, entries.length])

  const onFailed = () => {
    failures.current.total++
    failures.current.inARow++
    if (failures.current.inARow >= entries.length) {
      onFinished(played.current, failures.current.total)
    } else {
      advance()
    }
  }

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.volume = muted ? 0 : volume * volume * lab.fade
  }, [volume, muted, index, pass, lab.fade])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (paused) video.pause()
    else video.play().catch(() => {})
  }, [paused, index, pass])

  const pulse = useCallback((behaviour: BeatIntensity) => {
    const scale = PULSE_SCALE[behaviour]
    pulseRef.current?.animate(
      [
        { transform: `scale(${scale})`, filter: 'brightness(1.3) saturate(1.25)' },
        { transform: 'scale(1)', filter: 'brightness(1) saturate(1)' }
      ],
      { duration: 320, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)' }
    )
    flashRef.current?.animate([{ opacity: 0.55 }, { opacity: 0 }], { duration: 380, easing: 'ease-out' })
  }, [])

  const toggleIntensity = useCallback(
    (key: BeatIntensity) => setIntensity((current) => (current === key ? null : key)),
    []
  )

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
      else if (key === 'arrowright') advance()
      else if (key === 'arrowleft') back()
      else if (key === 'm') setMuted((m) => !m)
      else if (key === 'l') setEndless((v) => !v)
      else if (key === 'arrowup') setVolume((v) => Math.min(1, v + 0.05))
      else if (key === 'arrowdown') setVolume((v) => Math.max(0, v - 0.05))
      else if (key === '1') toggleIntensity('light')
      else if (key === '2') toggleIntensity('medium')
      else if (key === '3') toggleIntensity('heavy')
      else if (key === '4') toggleIntensity('ludicrous')
      else if (key === '0') setIntensity(null)
      else return
      e.preventDefault()
      e.stopPropagation()
      revealControls()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onExit, advance, back, toggleIntensity, revealControls])

  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2

  return (
    <div
      className={`queue-player ${controlsVisible ? '' : 'idle'}`}
      onMouseMove={revealControls}
      onClick={() => {
        setPaused((p) => !p)
      }}
    >
      <div className="queue-stage" ref={pulseRef}>
        <video
          key={`${pass}:${index}`}
          ref={videoRef}
          className="queue-video"
          src={mediaUrl(entry.item)}
          autoPlay
          playsInline
          onPlaying={() => {
            failures.current.inARow = 0
          }}
          onEnded={() => {
            played.current++
            advance()
          }}
          onError={onFailed}
        />
      </div>
      <div className="queue-flash" ref={flashRef} />
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
          <span className="scroller-tags queue-now" title={entry.item.fileName}>
            {entry.item.fileName}
          </span>
          <span className="scroller-count">
            {copy.queue} · {index + 1} / {entries.length}
            {endless && pass > 0 ? ` · loop ${pass + 1}` : ''}
          </span>
        </div>

        <div className="scroller-divider" />

        <button className="scroller-btn" onClick={back} title="Previous (←)">
          <SkipBack size={16} fill="currentColor" />
        </button>
        <button className="scroller-btn" onClick={() => setPaused((p) => !p)} title="Play / pause (Space)">
          {paused ? <Play size={16} fill="currentColor" /> : <Pause size={16} fill="currentColor" />}
        </button>
        <button className="scroller-btn" onClick={advance} title="Next (→)">
          <SkipForward size={16} fill="currentColor" />
        </button>

        <div className="scroller-divider" />

        <div
          className="segmented queue-beat-picker"
          title="Beat (1 / 2 / 3 / 4). Click the selected one again, or press 0, for a random mix"
        >
          {(Object.keys(INTENSITIES) as BeatIntensity[]).map((key) => (
            <button key={key} className={intensity === key ? 'active' : ''} onClick={() => toggleIntensity(key)}>
              {INTENSITIES[key].label}
            </button>
          ))}
        </div>
        {!intensity && (
          <span className="queue-random" title="No behaviour selected: a random mix of all four">
            <Dices size={14} /> Random
          </span>
        )}

        <button
          className={`scroller-btn ${endless ? 'active' : ''}`}
          onClick={() => setEndless((v) => !v)}
          title={endless ? 'Endless desire is on: the queue loops (L)' : 'Endless desire is off: stop after the last video (L)'}
        >
          <InfinityIcon size={18} />
        </button>

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

      <div className="beat-dock" onClick={(e) => e.stopPropagation()}>
        <BeatBar intensity={intensity} shape={theme.beatShape ?? 'circle'} paused={paused} onBeat={pulse} />
      </div>
    </div>
  )
}
