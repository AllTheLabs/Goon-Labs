import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Hash,
  Infinity as InfinityIcon,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  X
} from 'lucide-react'
import type { MediaItem } from '../../../shared/types'
import type { LabPrefs } from '../labPrefs'
import type { LabRecap } from '../labRecap'
import { recapCount } from '../labRecap'
import { useTheme } from '../themes'
import { mediaUrl, plural } from '../utils'
import { useLabSession } from './LabSession'
import { saveStillSettings, STILL_SPEEDS } from './StillSetup'
import type { StillSettings, StillSpeed } from './StillSetup'

interface StillPlayerProps {
  photos: MediaItem[]
  tags: string[]
  settings: StillSettings
  launch?: LabPrefs
  onExit: (recap: LabRecap) => void
}

const CONTROLS_HIDE_MS = 2500

interface Pose {
  scale: number
  x: number
  y: number
}

function pose(): Pose {
  const scale = 1.08 + Math.random() * 0.14
  const room = (scale - 1) * 50 * 0.85
  return {
    scale,
    x: (Math.random() - 0.5) * 2 * room,
    y: (Math.random() - 0.5) * 2 * room * 0.75
  }
}

function burn(): { from: Pose; to: Pose } {
  const from = pose()
  const to = pose()
  if (Math.abs(from.scale - to.scale) < 0.05) {
    to.scale = from.scale + (Math.random() < 0.5 ? 0.08 : -0.08)
  }
  return { from, to }
}

function lerp(a: Pose, b: Pose, t: number): Pose {
  const e = t * t * (3 - 2 * t)
  return {
    scale: a.scale + (b.scale - a.scale) * e,
    x: a.x + (b.x - a.x) * e,
    y: a.y + (b.y - a.y) * e
  }
}

function cssPose(p: Pose): string {
  return `translate(${p.x}%, ${p.y}%) scale(${p.scale})`
}

function shuffle<T>(list: T[]): T[] {
  const copy = [...list]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

function createPicker(photos: MediaItem[], endless: () => boolean) {
  const unplayable = new Set<string>()
  let deck: MediaItem[] = []
  let lastId: string | null = null
  let passedOnce = false

  const refill = () => {
    const playable = photos.filter((photo) => !unplayable.has(photo.id))
    deck = shuffle(playable.length > 0 ? playable : photos)
  }

  return {
    next(): MediaItem | null {
      if (deck.length === 0) {
        if (passedOnce && !endless()) return null
        refill()
        passedOnce = true
      }
      let item = deck.pop()!
      if (item.id === lastId && deck.length > 0) {
        deck.unshift(item)
        item = deck.pop()!
      }
      lastId = item.id
      return item
    },
    markUnplayable(id: string) {
      unplayable.add(id)
    },
    failedCount() {
      return unplayable.size
    }
  }
}

export function StillPlayer({ photos, tags, settings, launch, onExit }: StillPlayerProps) {
  const { copy } = useTheme()
  const endRef = useRef<() => void>(() => {})
  const lab = useLabSession(copy.stillStation, launch, () => endRef.current())
  const ended = useRef(false)
  const aRef = useRef<HTMLImageElement>(null)
  const bRef = useRef<HTMLImageElement>(null)
  const skipRef = useRef<(delta: number) => void>(() => {})
  const picker = useRef(createPicker(photos, () => endlessRef.current))
  const history = useRef<MediaItem[]>([])
  const cursor = useRef(-1)
  const shown = useRef(0)
  const unique = useRef(new Set<string>())

  const [paused, setPaused] = useState(false)
  const [speed, setSpeed] = useState(settings.speed)
  const [endless, setEndless] = useState(settings.endless)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [nowPlaying, setNowPlaying] = useState('')
  const [slides, setSlides] = useState(0)

  const pausedRef = useRef(paused)
  const speedRef = useRef(speed)
  const endlessRef = useRef(endless)
  pausedRef.current = paused
  speedRef.current = speed
  endlessRef.current = endless

  useEffect(() => saveStillSettings({ speed, endless }), [speed, endless])

  const end = useCallback(() => {
    if (ended.current) return
    ended.current = true
    const stats = [
      recapCount('Photos shown', shown.current),
      recapCount('Unique photos', unique.current.size),
      recapCount('Photos in pool', photos.length)
    ]
    const failed = picker.current.failedCount()
    if (failed > 0) stats.push(recapCount("Couldn't load", failed))
    onExit({ lab: copy.stillStation, durationSeconds: lab.elapsedSeconds(), stats })
  }, [onExit, copy.stillStation, lab.elapsedSeconds, photos.length])
  endRef.current = end

  useEffect(() => {
    const a = aRef.current
    const b = bRef.current
    if (!a || !b) return

    let active = 0
    let closed = false
    let holdT = 0
    let currentBurn = burn()
    let frame = 0
    let last = performance.now()
    let loading = false

    const layers = [a, b]
    const apply = (img: HTMLImageElement, pose: Pose) => {
      img.style.transform = cssPose(pose)
    }

    const reveal = (img: HTMLImageElement, item: MediaItem) => {
      shown.current++
      unique.current.add(item.id)
      setNowPlaying(item.fileName)
      setSlides(shown.current)
      currentBurn = burn()
      holdT = 0
      apply(img, currentBurn.from)
      img.classList.add('active')
      layers[1 - active].classList.remove('active')
    }

    const load = (img: HTMLImageElement, item: MediaItem): Promise<void> =>
      new Promise((resolve, reject) => {
        const onOk = () => {
          img.removeEventListener('load', onOk)
          img.removeEventListener('error', onErr)
          resolve()
        }
        const onErr = () => {
          img.removeEventListener('load', onOk)
          img.removeEventListener('error', onErr)
          reject(new Error('load failed'))
        }
        img.addEventListener('load', onOk)
        img.addEventListener('error', onErr)
        const url = mediaUrl(item)
        if (img.getAttribute('src') === url && img.complete && img.naturalWidth > 0) {
          img.removeEventListener('load', onOk)
          img.removeEventListener('error', onErr)
          resolve()
          return
        }
        img.src = url
      })

    const pickFromHistory = (delta: number): MediaItem | null => {
      if (delta < 0) {
        if (cursor.current <= 0) return history.current[0] ?? null
        cursor.current--
        return history.current[cursor.current]
      }
      if (cursor.current < history.current.length - 1) {
        cursor.current++
        return history.current[cursor.current]
      }
      const item = picker.current.next()
      if (!item) return null
      history.current.push(item)
      cursor.current = history.current.length - 1
      return item
    }

    const show = async (delta: number) => {
      if (closed || loading) return
      loading = true
      const incoming = layers[1 - active]
      try {
        let item = pickFromHistory(delta)
        let tries = 0
        while (item) {
          try {
            await load(incoming, item)
            if (closed) return
            active = 1 - active
            reveal(incoming, item)
            return
          } catch {
            picker.current.markUnplayable(item.id)
            if (history.current[cursor.current] === item) {
              history.current.splice(cursor.current, 1)
              cursor.current = Math.min(cursor.current, history.current.length - 1)
            }
            tries++
            if (tries >= photos.length) {
              endRef.current()
              return
            }
            item = pickFromHistory(1)
          }
        }
        endRef.current()
      } finally {
        loading = false
      }
    }

    skipRef.current = (delta: number) => {
      if (closed) return
      void show(delta)
    }

    void show(1)

    const tick = (now: number) => {
      const dt = Math.min(0.08, (now - last) / 1000)
      last = now
      const spec = STILL_SPEEDS[speedRef.current]
      if (!pausedRef.current && !loading) {
        holdT += dt
        const t = Math.min(1, holdT / spec.hold)
        apply(layers[active], lerp(currentBurn.from, currentBurn.to, t))
        if (holdT >= spec.hold) void show(1)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)

    return () => {
      closed = true
      cancelAnimationFrame(frame)
    }
  }, [photos])

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
      else if (key === 'arrowright') skipRef.current(1)
      else if (key === 'arrowleft') skipRef.current(-1)
      else if (key === 'l') setEndless((v) => !v)
      else if (key === '1') setSpeed('linger')
      else if (key === '2') setSpeed('drift')
      else if (key === '3') setSpeed('sweep')
      else return
      e.preventDefault()
      e.stopPropagation()
      revealControls()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [end, revealControls])

  return (
    <div
      className={`queue-player still-player ${controlsVisible ? '' : 'idle'}`}
      onMouseMove={revealControls}
      onClick={() => setPaused((p) => !p)}
    >
      <div className="queue-stage still-stage">
        <img ref={aRef} className="still-layer" alt="" draggable={false} />
        <img ref={bRef} className="still-layer" alt="" draggable={false} />
      </div>
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
          {tags.length > 0 ? (
            <span className="scroller-tags queue-now" title={nowPlaying}>
              {tags.slice(0, 3).map((tag) => (
                <span key={tag}>
                  <Hash size={12} />
                  {tag}
                </span>
              ))}
              {tags.length > 3 && <span>+{tags.length - 3}</span>}
            </span>
          ) : (
            <span className="scroller-tags queue-now" title={nowPlaying}>
              {nowPlaying || copy.stillStation}
            </span>
          )}
          <span className="scroller-count">
            {copy.stillStation} · {plural(photos.length, 'photo')}
            {slides > 0 ? ` · ${slides} shown` : ''}
          </span>
        </div>

        <div className="scroller-divider" />

        <button className="scroller-btn" onClick={() => skipRef.current(-1)} title="Previous (←)">
          <SkipBack size={16} fill="currentColor" />
        </button>
        <button className="scroller-btn" onClick={() => setPaused((p) => !p)} title="Play / pause (Space)">
          {paused ? <Play size={16} fill="currentColor" /> : <Pause size={16} fill="currentColor" />}
        </button>
        <button className="scroller-btn" onClick={() => skipRef.current(1)} title="Next (→)">
          <SkipForward size={16} fill="currentColor" />
        </button>

        <div className="scroller-divider" />

        <div className="segmented queue-beat-picker" title="Drift speed (1 / 2 / 3)">
          {(Object.keys(STILL_SPEEDS) as StillSpeed[]).map((key) => (
            <button key={key} className={speed === key ? 'active' : ''} onClick={() => setSpeed(key)}>
              {STILL_SPEEDS[key].label}
            </button>
          ))}
        </div>

        <button
          className={`scroller-btn ${endless ? 'active' : ''}`}
          onClick={() => setEndless((v) => !v)}
          title={endless ? 'Endless desire is on: photos loop (L)' : 'Endless desire is off: stop after one pass (L)'}
        >
          <InfinityIcon size={18} />
        </button>

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
