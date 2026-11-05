import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Grid3x3,
  Infinity as InfinityIcon,
  Pause,
  Play,
  ScanFace,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
  X
} from 'lucide-react'
import type { LabPrefs } from '../labPrefs'
import type { LabRecap } from '../labRecap'
import { recapCount } from '../labRecap'
import { createPixelDetector, isDarkSkinRegion, isSkipDarkMaleBox, smoothBoxes } from '../pixelDetect'
import type { PixelBox, PixelDetector } from '../pixelDetect'
import { useTheme } from '../themes'
import { mediaUrl } from '../utils'
import { ElementAudioTap } from '../elementAudioTap'
import { useLabSession } from './LabSession'
import {
  clampPixelStrength,
  PIXEL_STRENGTH_LABELS,
  PIXEL_STRENGTH_MAX,
  PIXEL_STRENGTH_MIN,
  pixelBlockSize,
  savePixelSettings
} from './PixelSetup'
import type { PixelSettings, PixelStrength } from './PixelSetup'
import type { QueueEntry } from './QueueSetup'

interface PixelPlayerProps {
  entries: QueueEntry[]
  settings: PixelSettings
  launch?: LabPrefs
  onExit: (recap: LabRecap) => void
}

const CONTROLS_HIDE_MS = 2500
const DETECT_MS = 110
const HOLD_MS = 480

function contained(srcW: number, srcH: number, dstW: number, dstH: number): {
  x: number
  y: number
  w: number
  h: number
} {
  const scale = Math.min(dstW / srcW, dstH / srcH)
  const w = srcW * scale
  const h = srcH * scale
  return { x: (dstW - w) / 2, y: (dstH - h) / 2, w, h }
}

function pixelate(
  ctx: CanvasRenderingContext2D,
  scratch: HTMLCanvasElement,
  x: number,
  y: number,
  w: number,
  h: number,
  block: number
): void {
  const left = Math.max(0, Math.floor(x))
  const top = Math.max(0, Math.floor(y))
  const width = Math.min(ctx.canvas.width - left, Math.ceil(w))
  const height = Math.min(ctx.canvas.height - top, Math.ceil(h))
  if (width < 4 || height < 4) return
  const smallW = Math.max(1, Math.round(width / block))
  const smallH = Math.max(1, Math.round(height / block))
  scratch.width = smallW
  scratch.height = smallH
  const off = scratch.getContext('2d')
  if (!off) return
  off.imageSmoothingEnabled = false
  off.drawImage(ctx.canvas, left, top, width, height, 0, 0, smallW, smallH)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(scratch, 0, 0, smallW, smallH, left, top, width, height)
  ctx.imageSmoothingEnabled = true
}

export function PixelPlayer({ entries, settings, launch, onExit }: PixelPlayerProps) {
  const { copy } = useTheme()
  const endRef = useRef<() => void>(() => {})
  const lab = useLabSession(copy.pixelPerfection, launch, () => endRef.current())
  const ended = useRef(false)
  const uniqueShown = useRef(new Set<string>())
  const videosShown = useRef(0)
  const facesHit = useRef(0)
  const nsfwHit = useRef(0)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const scratchRef = useRef(document.createElement('canvas'))
  const detectorRef = useRef<PixelDetector | null>(null)
  const boxesRef = useRef<PixelBox[]>([])
  const boxesAt = useRef(0)
  const detecting = useRef(false)
  const lastDetect = useRef(0)
  const detectErrorShown = useRef(false)
  const raf = useRef(0)
  const facesRef = useRef(settings.faces)
  const nsfwRef = useRef(settings.nsfw)
  const skipDarkMaleRef = useRef(settings.skipDarkMale)
  const strengthRef = useRef(settings.strength)
  const pauseDetectDone = useRef(false)

  const [index, setIndex] = useState(0)
  const [pass, setPass] = useState(0)
  const [paused, setPaused] = useState(false)
  const [endless, setEndless] = useState(settings.endless)
  const [faces, setFaces] = useState(settings.faces)
  const [nsfw, setNsfw] = useState(settings.nsfw)
  const [skipDarkMale, setSkipDarkMale] = useState(settings.skipDarkMale)
  const [strength, setStrength] = useState<PixelStrength>(settings.strength)
  const [volume, setVolume] = useState(0.8)
  const [muted, setMuted] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [detectorState, setDetectorState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [detectorNote, setDetectorNote] = useState('Preparing the on-device detector…')

  const played = useRef(0)
  const failures = useRef({ total: 0, inARow: 0 })
  const entry = entries[index]
  facesRef.current = faces
  nsfwRef.current = nsfw
  skipDarkMaleRef.current = skipDarkMale
  strengthRef.current = strength

  useEffect(
    () => savePixelSettings({ endless, faces, nsfw, strength, skipDarkMale }),
    [endless, faces, nsfw, strength, skipDarkMale]
  )

  useEffect(() => {
    let cancelled = false
    window.api
      .getPixelModel()
      .then((bytes) => createPixelDetector(new Uint8Array(bytes)))
      .then((detector) => {
        if (cancelled) return
        detectorRef.current = detector
        setDetectorState('ready')
      })
      .catch((err: Error) => {
        if (cancelled) return
        setDetectorState('failed')
        setDetectorNote(err.message || 'Detector unavailable — playing without pixelation')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const advance = useCallback(() => {
    if (index + 1 < entries.length) {
      setIndex(index + 1)
    } else if (endless) {
      setIndex(0)
      setPass((p) => p + 1)
    } else {
      endRef.current()
    }
  }, [index, entries.length, endless])

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
      endRef.current()
    } else {
      advance()
    }
  }

  const tapRef = useRef<ElementAudioTap | null>(null)
  useEffect(() => {
    const tap = new ElementAudioTap()
    tapRef.current = tap
    return () => {
      tapRef.current = null
      tap.close()
    }
  }, [])

  useEffect(() => {
    if (videoRef.current) tapRef.current?.attach(videoRef.current)
  }, [index, pass])

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

  useEffect(() => {
    boxesRef.current = []
    boxesAt.current = 0
  }, [index, pass])

  useEffect(() => {
    const canvas = canvasRef.current
    const video = videoRef.current
    if (!canvas || !video) return
    const scratch = scratchRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const draw = (now: number) => {
      const stage = canvas.parentElement
      const cssW = stage?.clientWidth ?? window.innerWidth
      const cssH = stage?.clientHeight ?? window.innerHeight
      const dpr = window.devicePixelRatio || 1
      const pixelW = Math.max(1, Math.round(cssW * dpr))
      const pixelH = Math.max(1, Math.round(cssH * dpr))
      if (canvas.width !== pixelW || canvas.height !== pixelH) {
        canvas.width = pixelW
        canvas.height = pixelH
      }

      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, pixelW, pixelH)
      const srcW = video.videoWidth
      const srcH = video.videoHeight
      if (srcW > 0 && srcH > 0) {
        const dest = contained(srcW, srcH, pixelW, pixelH)
        ctx.imageSmoothingEnabled = true
        ctx.drawImage(video, dest.x, dest.y, dest.w, dest.h)

        const wantFaces = facesRef.current
        const wantNsfw = nsfwRef.current
        const frozen = video.paused || video.ended
        const fresh = frozen || now - boxesAt.current < HOLD_MS
        const boxes = fresh ? boxesRef.current : []
        const block = pixelBlockSize(strengthRef.current)
        for (const box of boxes) {
          if (box.kind === 'face' && !wantFaces) continue
          if (box.kind === 'nsfw' && !wantNsfw) continue
          if (
            skipDarkMaleRef.current &&
            isSkipDarkMaleBox(box) &&
            isDarkSkinRegion(video, box, srcW, srcH)
          ) {
            continue
          }
          pixelate(
            ctx,
            scratch,
            dest.x + (box.x / srcW) * dest.w,
            dest.y + (box.y / srcH) * dest.h,
            (box.w / srcW) * dest.w,
            (box.h / srcH) * dest.h,
            block
          )
        }

        if (!frozen) pauseDetectDone.current = false
        const detector = detectorRef.current
        const due = frozen ? !pauseDetectDone.current : now - lastDetect.current >= DETECT_MS
        if (detector && !detecting.current && (wantFaces || wantNsfw) && due && !video.ended) {
          detecting.current = true
          lastDetect.current = now
          if (frozen) pauseDetectDone.current = true
          detector
            .detect(video, srcW, srcH, { skipDarkMale: skipDarkMaleRef.current })
            .then((found) => {
              boxesRef.current = frozen ? found : smoothBoxes(boxesRef.current, found)
              boxesAt.current = performance.now()
              if (facesRef.current && found.some((box) => box.kind === 'face')) facesHit.current++
              if (nsfwRef.current && found.some((box) => box.kind === 'nsfw')) nsfwHit.current++
            })
            .catch((err: Error) => {
              if (detectErrorShown.current) return
              detectErrorShown.current = true
              setDetectorNote(err.message || 'Detection failed')
              setDetectorState('failed')
            })
            .finally(() => {
              detecting.current = false
            })
        }
      }
      raf.current = requestAnimationFrame(draw)
    }
    raf.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf.current)
  }, [index, pass])

  useEffect(() => {
    videosShown.current++
    uniqueShown.current.add(entry.item.id)
  }, [index, pass, entry.item.id])

  const end = useCallback(() => {
    if (ended.current) return
    ended.current = true
    const stats = [
      recapCount('Videos shown', videosShown.current),
      recapCount('Unique videos', uniqueShown.current.size),
      recapCount('Videos finished', played.current),
      recapCount('Face detections', facesHit.current),
      recapCount('NSFW detections', nsfwHit.current)
    ]
    if (failures.current.total > 0) stats.push(recapCount("Couldn't play", failures.current.total))
    onExit({ lab: copy.pixelPerfection, durationSeconds: lab.elapsedSeconds(), stats })
  }, [onExit, copy.pixelPerfection, lab.elapsedSeconds])
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
      const key = e.key.toLowerCase()
      if (e.target instanceof HTMLInputElement) {
        if (e.target.type !== 'range' && e.target.type !== 'checkbox') return
        if (e.target.type === 'range' && key.startsWith('arrow')) return
      }
      if (key === 'escape') end()
      else if (key === ' ') setPaused((p) => !p)
      else if (key === 'arrowright') advance()
      else if (key === 'arrowleft') back()
      else if (key === 'm') setMuted((m) => !m)
      else if (key === 'l') setEndless((v) => !v)
      else if (key === 'f') setFaces((v) => !v)
      else if (key === 'n') setNsfw((v) => !v)
      else if (key === 'd') setSkipDarkMale((v) => !v)
      else if (key === '[' || key === '-') setStrength((v) => clampPixelStrength(v - 1))
      else if (key === ']' || key === '=' || key === '+') setStrength((v) => clampPixelStrength(v + 1))
      else if (key === 'arrowup') setVolume((v) => Math.min(1, v + 0.05))
      else if (key === 'arrowdown') setVolume((v) => Math.max(0, v - 0.05))
      else return
      e.preventDefault()
      e.stopPropagation()
      revealControls()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [end, advance, back, revealControls])

  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2

  return (
    <div
      className={`queue-player ${controlsVisible ? '' : 'idle'}`}
      onMouseMove={revealControls}
      onClick={() => {
        setPaused((p) => !p)
      }}
    >
      <div className="queue-stage">
        <video
          key={`${pass}:${index}`}
          ref={videoRef}
          className="queue-video pixel-hidden"
          crossOrigin="anonymous"
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
        <canvas ref={canvasRef} className="pixel-canvas" />
      </div>
      {lab.overlay}

      {detectorState !== 'ready' && (
        <div className="pixel-status" onClick={(e) => e.stopPropagation()}>
          {detectorState === 'loading' ? detectorNote : `Playing without pixelation · ${detectorNote}`}
        </div>
      )}

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
            {copy.pixelPerfection} · {index + 1} / {entries.length}
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

        <button
          className={`scroller-btn pixel-toggle ${faces ? 'active' : ''}`}
          onClick={() => setFaces((v) => !v)}
          title="Pixelate faces (F)"
        >
          <ScanFace size={16} /> Faces
        </button>
        <button
          className={`scroller-btn pixel-toggle ${nsfw ? 'active' : ''}`}
          onClick={() => setNsfw((v) => !v)}
          title="Pixelate NSFW regions (N)"
        >
          NSFW
        </button>
        <button
          className={`scroller-btn pixel-toggle ${skipDarkMale ? 'active' : ''}`}
          onClick={() => setSkipDarkMale((v) => !v)}
          title="Don't pixelate dark-skinned male genitalia (D)"
        >
          Skip dark
        </button>

        <div className="scroller-slider pixel-strength" title={`Pixelation: ${PIXEL_STRENGTH_LABELS[strength - 1]} ([ / ])`}>
          <Grid3x3 size={16} />
          <input
            type="range"
            min={PIXEL_STRENGTH_MIN}
            max={PIXEL_STRENGTH_MAX}
            step={1}
            value={strength}
            onChange={(e) => setStrength(clampPixelStrength(e.target.value))}
          />
        </div>

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

        <button className="scroller-btn" onClick={end} title="Exit (Esc)">
          <X size={18} />
        </button>
      </div>
    </div>
  )
}
