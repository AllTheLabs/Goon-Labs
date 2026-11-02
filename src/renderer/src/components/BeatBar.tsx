import { useEffect, useRef } from 'react'
import type { BeatShape } from '../themes'

export type BeatIntensity = 'light' | 'medium' | 'heavy' | 'ludicrous'

/** Seconds between beats, picked at random within the range. Behaviours only change spacing. */
export const INTENSITIES: Record<BeatIntensity, { label: string; interval: [number, number] }> = {
  light: { label: 'Light', interval: [1.5, 2.4] },
  medium: { label: 'Medium', interval: [0.75, 1.15] },
  heavy: { label: 'Heavy', interval: [0.32, 0.55] },
  ludicrous: { label: 'Ludicrous', interval: [0.16, 0.275] }
}

/** Seconds for every marker to glide from the right edge to the indicator, at a constant speed. */
const TRAVEL_SECONDS = 2.4

const BEHAVIOURS = Object.keys(INTENSITIES) as BeatIntensity[]

/** Uniform in [0, 1) from the OS entropy source, so random sessions never repeat a pattern. */
function random(): number {
  const buffer = new Uint32Array(1)
  crypto.getRandomValues(buffer)
  return buffer[0] / 2 ** 32
}

function pick<T>(list: readonly T[]): T {
  return list[Math.floor(random() * list.length)]
}

function between([min, max]: [number, number]): number {
  return min + random() * (max - min)
}

interface BeatBarProps {
  /** `null` mixes all behaviours at random. */
  intensity: BeatIntensity | null
  shape: BeatShape
  paused: boolean
  onBeat: (behaviour: BeatIntensity) => void
}

interface Marker {
  /** Distance from the centre indicator: 1 at the right edge, 0 on the indicator. */
  progress: number
  behaviour: BeatIntensity
  spin: number
}

/** The behaviour for the next beat and the gap before the one after it; random mode picks a fresh behaviour each time. */
function nextSpawn(intensity: BeatIntensity | null): { behaviour: BeatIntensity; gap: number } {
  const behaviour = intensity ?? pick(BEHAVIOURS)
  return { behaviour, gap: between(INTENSITIES[behaviour].interval) }
}

const SPADE = new Path2D(
  'M12 2C9.2 5.6 4 8.6 4 13.2a4 4 0 0 0 6.9 2.8L9.8 21h4.4l-1.1-5a4 4 0 0 0 6.9-2.8C20 8.6 14.8 5.6 12 2z'
)
const HEART = new Path2D(
  'M12 21s-7.6-4.7-9.7-9.3C.8 8.2 3 4.4 6.6 4.4c2.1 0 3.7 1.2 5.4 3.3 1.7-2.1 3.3-3.3 5.4-3.3 3.6 0 5.8 3.8 4.3 7.3C19.6 16.3 12 21 12 21z'
)

function drawMarker(
  g: CanvasRenderingContext2D,
  shape: BeatShape,
  x: number,
  y: number,
  size: number,
  spin: number,
  accent: string
) {
  g.save()
  g.translate(x, y)
  if (shape === 'disk') {
    const r = size / 2
    g.rotate(spin)
    g.beginPath()
    g.arc(0, 0, r, 0, Math.PI * 2)
    g.fillStyle = '#16051f'
    g.fill()
    // Archimedean spiral, two arms.
    g.lineCap = 'round'
    g.lineWidth = r * 0.2
    for (let arm = 0; arm < 2; arm++) {
      g.beginPath()
      for (let i = 0; i <= 60; i++) {
        const t = i / 60
        const angle = t * Math.PI * 5 + arm * Math.PI
        const rr = t * r * 0.86
        const px = Math.cos(angle) * rr
        const py = Math.sin(angle) * rr
        if (i === 0) g.moveTo(px, py)
        else g.lineTo(px, py)
      }
      g.strokeStyle = arm === 0 ? '#ff5ce1' : '#9b6bff'
      g.stroke()
    }
    g.beginPath()
    g.arc(0, 0, r, 0, Math.PI * 2)
    g.lineWidth = r * 0.12
    g.strokeStyle = '#f6c8ff'
    g.stroke()
  } else if (shape === 'spade') {
    const s = (size * 1.05) / 24
    g.scale(s, s)
    g.translate(-12, -11.5)
    g.shadowColor = 'rgba(255, 255, 255, 0.45)'
    g.shadowBlur = 8
    g.fillStyle = '#000000'
    g.fill(SPADE)
    g.shadowBlur = 0
    g.lineWidth = 1.6
    g.lineJoin = 'round'
    g.strokeStyle = '#ffffff'
    g.stroke(SPADE)
  } else if (shape === 'heart') {
    const s = size / 24
    g.scale(s, s)
    g.translate(-12, -12.5)
    g.shadowColor = 'rgba(255, 105, 180, 0.8)'
    g.shadowBlur = 10
    g.fillStyle = '#ff6fae'
    g.fill(HEART)
    g.shadowBlur = 0
    g.lineWidth = 1.6
    g.strokeStyle = '#ffffff'
    g.stroke(HEART)
  } else {
    const r = size / 2
    g.beginPath()
    g.arc(0, 0, r * 0.82, 0, Math.PI * 2)
    g.fillStyle = accent
    g.shadowColor = accent
    g.shadowBlur = 12
    g.fill()
    g.shadowBlur = 0
    g.lineWidth = 2
    g.strokeStyle = 'rgba(255, 255, 255, 0.9)'
    g.stroke()
  }
  g.restore()
}

/**
 * Markers spawn at the right edge and glide to the indicator in the middle; each arrival
 * calls `onBeat`. The loop runs outside React and reads props through a ref.
 */
export function BeatBar({ intensity, shape, paused, onBeat }: BeatBarProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const live = useRef({ intensity, shape, paused, onBeat })
  live.current = { intensity, shape, paused, onBeat }

  useEffect(() => {
    const canvas = canvasRef.current!
    const g = canvas.getContext('2d')!
    const accent =
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#7c6cff'
    let width = 0
    let height = 0
    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      width = canvas.clientWidth
      height = canvas.clientHeight
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    resize()

    const markers: Marker[] = []
    const bursts: number[] = []
    let flash = 0
    let spawnIn = 0.2 + random() * 0.4
    let last = performance.now()
    let frame = 0

    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const { intensity, shape, paused, onBeat } = live.current

      if (!paused) {
        spawnIn -= dt
        if (spawnIn <= 0) {
          const { behaviour, gap } = nextSpawn(intensity)
          markers.push({ progress: 1, behaviour, spin: random() * Math.PI * 2 })
          spawnIn = gap
        }
        for (let i = markers.length - 1; i >= 0; i--) {
          const marker = markers[i]
          marker.progress -= dt / TRAVEL_SECONDS
          marker.spin += dt * 4
          if (marker.progress <= 0) {
            markers.splice(i, 1)
            bursts.push(0)
            flash = 1
            onBeat(marker.behaviour)
          }
        }
        for (let i = bursts.length - 1; i >= 0; i--) {
          bursts[i] += dt / 0.45
          if (bursts[i] >= 1) bursts.splice(i, 1)
        }
        flash = Math.max(0, flash - dt * 4)
      }

      const cx = width / 2
      const cy = height / 2
      const size = height * 0.62
      const reach = width / 2 - size * 0.7
      g.clearRect(0, 0, width, height)

      // Track.
      const track = g.createLinearGradient(0, 0, width, 0)
      track.addColorStop(0, 'rgba(255, 255, 255, 0)')
      track.addColorStop(0.5, 'rgba(255, 255, 255, 0.35)')
      track.addColorStop(1, 'rgba(255, 255, 255, 0.12)')
      g.fillStyle = track
      g.fillRect(0, cy - 1, width, 2)

      // Indicator.
      g.save()
      g.shadowColor = accent
      g.shadowBlur = 14 + flash * 24
      g.lineWidth = 3 + flash * 2
      g.strokeStyle = accent
      g.beginPath()
      g.arc(cx, cy, size * (0.55 + flash * 0.12), 0, Math.PI * 2)
      g.stroke()
      g.restore()
      g.fillStyle = `rgba(255, 255, 255, ${0.5 + flash * 0.5})`
      g.fillRect(cx - 1, cy - size * 0.75, 2, size * 1.5)

      for (const age of bursts) {
        g.beginPath()
        g.arc(cx, cy, size * (0.55 + age * 0.9), 0, Math.PI * 2)
        g.lineWidth = 3 * (1 - age)
        g.strokeStyle = `rgba(255, 255, 255, ${0.8 * (1 - age)})`
        g.stroke()
      }

      for (const marker of markers) {
        const x = cx + marker.progress * reach
        g.globalAlpha = Math.min(1, (1 - marker.progress) * 6)
        drawMarker(g, shape, x, cy, size, marker.spin, accent)
      }
      g.globalAlpha = 1

      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [])

  return <canvas ref={canvasRef} className="beat-bar" />
}
