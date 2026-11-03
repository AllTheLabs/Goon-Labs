import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import {
  Gauge,
  Hash,
  Headphones,
  LayoutGrid,
  Loader2,
  Pause,
  Play,
  VideoOff,
  Volume1,
  WandSparkles,
  Volume2,
  VolumeX,
  X
} from 'lucide-react'
import type { MediaItem } from '../../../shared/types'
import type { LabPrefs } from '../labPrefs'
import { AudioMixer } from '../audioMixer'
import { fitTiles, justify, probeAspects } from '../scrollerLayout'
import type { Tile } from '../scrollerLayout'
import { useTheme } from '../themes'
import { mediaUrl, plural, previewUrl } from '../utils'
import { useLabSession } from './LabSession'
import { anyEffectActive, EffectsOverlay, EffectsPanel, useEffectSettings } from './ScrollerEffects'

interface ScrollerProps {
  videos: MediaItem[]
  tags: string[]
  previewIds: Set<string>
  launch?: LabPrefs
  onClose: () => void
}

const CONTROLS_HIDE_MS = 2500
/** Tiles taller than this (in device pixels) use the original file instead of the 540p preview. */
const PREVIEW_MAX_TILE_HEIGHT = 600
/**
 * Most videos that may play at once. Past roughly this many, Chromium's per-video overhead in
 * the GPU process saturates a core and frames drop no matter how small the videos are.
 */
const MAX_TILES = 56

/** Smallest row height that keeps the estimated tile count (including the buffer row) within MAX_TILES. */
function minRowHeightFor(width: number, height: number, averageAspect: number): number {
  for (let row = MIN_ROW; row < MAX_ROW; row += 5) {
    const tilesPerRow = width / (row * averageAspect)
    const rows = Math.ceil(height / row) + 1
    if (tilesPerRow * rows <= MAX_TILES) return row
  }
  return MAX_ROW
}
/** Bounds for the target row height, in pixels. */
const MIN_ROW = 100
const MAX_ROW = 720

/** Deals videos from a reshuffled deck, avoiding back-to-back repeats and skipping unplayable files. */
function createPicker(videos: MediaItem[]) {
  const unplayable = new Set<string>()
  let deck: MediaItem[] = []
  let lastId: string | null = null

  const shuffle = (list: MediaItem[]) => {
    const copy = [...list]
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[copy[i], copy[j]] = [copy[j], copy[i]]
    }
    return copy
  }

  return {
    next(): MediaItem {
      if (deck.length === 0) {
        const playable = videos.filter((v) => !unplayable.has(v.id))
        deck = shuffle(playable.length > 0 ? playable : videos)
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
    }
  }
}

export function Scroller({ videos, tags, previewIds, launch, onClose }: ScrollerProps) {
  const { copy } = useTheme()
  const lab = useLabSession(copy.scroller, launch, onClose)
  const stageRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)

  const [aspects, setAspects] = useState<Map<string, number> | null>(null)
  const [probed, setProbed] = useState(0)
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const [requestedRowHeight, setRowHeight] = useState(260)
  const [speed, setSpeed] = useState(40)
  const [volume, setVolume] = useState(0.7)
  const [muted, setMuted] = useState(false)
  const [paused, setPaused] = useState(false)
  const [hoverFocus, setHoverFocus] = useState(true)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [mixer, setMixer] = useState<AudioMixer | null>(null)
  const [tiles, setTiles] = useState<Tile[]>([])
  const [effects, setEffects] = useEffectSettings()
  const [effectsPanelOpen, setEffectsPanelOpen] = useState(false)

  const averageAspect = useMemo(() => {
    if (!aspects || aspects.size === 0) return 16 / 9
    let sum = 0
    for (const aspect of aspects.values()) sum += aspect
    return sum / aspects.size
  }, [aspects])
  const minRowHeight =
    viewport.width > 0 ? minRowHeightFor(viewport.width, viewport.height, averageAspect) : MIN_ROW
  const rowHeight = Math.max(requestedRowHeight, minRowHeight)

  const nextKey = useRef(0)
  const picker = useMemo(
    () => (aspects ? createPicker(videos.filter((v) => aspects.has(v.id))) : null),
    [videos, aspects]
  )

  // Read through a ref so new previews and size changes apply to newly dealt tiles
  // without re-flowing the ones already playing.
  const sourcing = useRef({ previewIds, rowHeight })
  sourcing.current = { previewIds, rowHeight }
  const makeTile = useCallback((): Tile => {
    const item = picker!.next()
    const { previewIds, rowHeight } = sourcing.current
    const usePreview =
      previewIds.has(item.id) && rowHeight * window.devicePixelRatio <= PREVIEW_MAX_TILE_HEIGHT
    return {
      key: ++nextKey.current,
      item,
      src: usePreview ? previewUrl(item) : mediaUrl(item),
      aspect: aspects!.get(item.id)!
    }
  }, [picker, aspects])

  const layout = useMemo(
    () => justify(tiles, viewport.width, rowHeight),
    [tiles, viewport.width, rowHeight]
  )

  // The animation loop reads these through a ref so it never has to restart.
  const live = useRef({
    speed,
    paused,
    layout,
    viewport,
    rowHeight,
    minRowHeight,
    makeTile,
    offset: 0,
    topTileKey: -1,
    topRowHeight: 0
  })
  Object.assign(live.current, { speed, paused, layout, viewport, rowHeight, minRowHeight, makeTile })

  useEffect(() => {
    let cancelled = false
    probeAspects(
      videos,
      (item) => (sourcing.current.previewIds.has(item.id) ? previewUrl(item) : mediaUrl(item)),
      (done) => !cancelled && setProbed(done)
    ).then((result) => !cancelled && setAspects(result))
    return () => {
      cancelled = true
    }
  }, [videos])

  useEffect(() => {
    const created = new AudioMixer(0.7)
    setMixer(created)
    return () => created.close()
  }, [])

  useEffect(() => {
    mixer?.setVolume((muted ? 0 : volume) * lab.fade)
  }, [mixer, volume, muted, lab.fade])

  useEffect(() => {
    if (!hoverFocus) mixer?.setFocus(null)
  }, [mixer, hoverFocus])

  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const observer = new ResizeObserver(([entry]) =>
      setViewport({ width: entry.contentRect.width, height: entry.contentRect.height })
    )
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])

  // Re-flow the existing tiles when the size or window changes. Tiles keep their keys,
  // so videos that stay on screen keep playing instead of restarting.
  useEffect(() => {
    if (!picker || viewport.width === 0 || aspects?.size === 0) return
    setTiles((current) => fitTiles(current, viewport.width, viewport.height, rowHeight, makeTile))
  }, [picker, aspects, viewport, rowHeight, makeTile])

  // Endless scroll: drift the track upward, and each time the top row has fully left the
  // screen, drop its tiles and deal fresh ones onto the bottom.
  useEffect(() => {
    let frame = 0
    let last = performance.now()
    const tick = (now: number) => {
      const state = live.current
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const first = state.layout.rows[0]
      if (first) {
        // When a resize re-flows the same top row, keep the same fraction of it scrolled.
        // Otherwise a scroll offset from big rows would exceed a small row and discard the
        // playing tiles at the top.
        const topTileKey = state.layout.placed[0].tile.key
        if (topTileKey === state.topTileKey && first.height !== state.topRowHeight) {
          state.offset *= first.height / state.topRowHeight
        }
        state.topTileKey = topTileKey
        state.topRowHeight = first.height

        if (!state.paused) state.offset += state.speed * dt
        if (state.offset >= first.height) {
          state.offset -= first.height
          const { width, height } = state.viewport
          // Commit synchronously so the DOM and the reset offset change in the same frame.
          flushSync(() =>
            setTiles((current) =>
              fitTiles(current.slice(first.count), width, height, state.rowHeight, state.makeTile)
            )
          )
        }
        if (trackRef.current) {
          trackRef.current.style.transform = `translate3d(0, ${-state.offset}px, 0)`
        }
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])

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
      if (e.target instanceof HTMLInputElement && e.target.type !== 'range') return
      const key = e.key.toLowerCase()
      if (key === 'escape') onClose()
      else if (key === 'e') setEffectsPanelOpen((open) => !open)
      else if (key === ' ') setPaused((p) => !p)
      else if (key === 'm') setMuted((m) => !m)
      else if (key === 'arrowup') setVolume((v) => Math.min(1, v + 0.05))
      else if (key === 'arrowdown') setVolume((v) => Math.max(0, v - 0.05))
      else if (key === '+' || key === '=') setRowHeight((h) => Math.min(MAX_ROW, Math.max(h, live.current.minRowHeight) + 20))
      else if (key === '-') setRowHeight((h) => Math.max(live.current.minRowHeight, h - 20))
      else return
      e.preventDefault()
      e.stopPropagation()
      revealControls()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, revealControls])

  const onTileFailed = useCallback((id: string) => picker?.markUnplayable(id), [picker])
  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2

  return (
    <div
      className={`scroller ${controlsVisible || effectsPanelOpen ? '' : 'idle'}`}
      onMouseMove={revealControls}
      onClick={() => {
        mixer?.resume()
        setEffectsPanelOpen(false)
      }}
    >
      <div className="scroller-stage" ref={stageRef}>
        <div className="scroller-track" ref={trackRef}>
          {mixer &&
            layout.placed.map(({ tile, x, y, width, height }) => {
              // Snap edges to whole pixels and overlap by one so no seams show between tiles.
              const left = Math.round(x)
              const top = Math.round(y)
              return (
                <ScrollerTile
                  key={tile.key}
                  tileKey={tile.key}
                  item={tile.item}
                  src={tile.src}
                  left={left}
                  top={top}
                  width={Math.round(x + width) - left + 1}
                  height={Math.round(y + height) - top + 1}
                  mixer={mixer}
                  hoverFocus={hoverFocus}
                  onFailed={onTileFailed}
                />
              )
            })}
        </div>

        {!aspects && (
          <div className="scroller-status">
            <Loader2 className="spin" size={28} />
            <span>
              Preparing videos… {probed} / {videos.length}
            </span>
          </div>
        )}
        {aspects?.size === 0 && (
          <div className="scroller-status">
            <VideoOff size={32} />
            <span>None of these videos can be played.</span>
            <button className="btn btn-secondary" onClick={onClose}>
              Close
            </button>
          </div>
        )}
      </div>

      {anyEffectActive(effects) && <EffectsOverlay settings={effects} />}
      {lab.overlay}

      <div
        className="scroller-controls queue-controls"
        onClick={(e) => e.stopPropagation()}
        onMouseEnter={() => {
          overControls.current = true
          mixer?.setFocus(null)
        }}
        onMouseLeave={() => {
          overControls.current = false
          revealControls()
        }}
      >
        <div className="scroller-info">
          {tags.length > 0 ? (
            <span className="scroller-tags">
              {tags.slice(0, 3).map((tag) => (
                <span key={tag}>
                  <Hash size={12} />
                  {tag}
                </span>
              ))}
              {tags.length > 3 && <span>+{tags.length - 3}</span>}
            </span>
          ) : (
            <span className="scroller-tags">All videos</span>
          )}
          <span className="scroller-count">{plural(aspects?.size ?? videos.length, 'video')}</span>
        </div>

        <div className="scroller-divider" />

        <label className="scroller-slider" title="Tile size (+ / -)">
          <LayoutGrid size={16} />
          <input
            type="range"
            min={minRowHeight}
            max={MAX_ROW}
            step={5}
            value={rowHeight}
            onChange={(e) => setRowHeight(Number(e.target.value))}
          />
        </label>

        <label className="scroller-slider" title="Scroll speed">
          <Gauge size={16} />
          <input
            type="range"
            min={5}
            max={200}
            step={5}
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
          />
        </label>

        <button
          className="scroller-btn"
          onClick={() => setPaused((p) => !p)}
          title={paused ? 'Resume scrolling (Space)' : 'Pause scrolling (Space)'}
        >
          {paused ? <Play size={16} fill="currentColor" /> : <Pause size={16} fill="currentColor" />}
        </button>

        <div className="scroller-divider" />

        <button
          className={`scroller-btn ${anyEffectActive(effects) || effectsPanelOpen ? 'active' : ''}`}
          onClick={() => setEffectsPanelOpen((open) => !open)}
          title="Overlay effects (E)"
        >
          <WandSparkles size={16} />
        </button>
        {effectsPanelOpen && <EffectsPanel settings={effects} onChange={setEffects} />}

        <button
          className={`scroller-btn ${hoverFocus ? 'active' : ''}`}
          onClick={() => setHoverFocus((f) => !f)}
          title={hoverFocus ? 'Hover focus on: hovering a tile brings its audio forward' : 'Hover focus off'}
        >
          <Headphones size={16} />
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
          <span className="scroller-value">{Math.round((muted ? 0 : volume) * 100)}%</span>
        </div>

        <div className="scroller-divider" />
        {lab.controls}
        <div className="scroller-divider" />

        <button className="scroller-btn" onClick={onClose} title="Exit scroller (Esc)">
          <X size={18} />
        </button>
      </div>
    </div>
  )
}

interface ScrollerTileProps {
  tileKey: number
  item: MediaItem
  src: string
  left: number
  top: number
  width: number
  height: number
  mixer: AudioMixer
  hoverFocus: boolean
  onFailed: (id: string) => void
}

const ScrollerTile = memo(function ScrollerTile({
  tileKey,
  item,
  src,
  left,
  top,
  width,
  height,
  mixer,
  hoverFocus,
  onFailed
}: ScrollerTileProps) {
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    mixer.attach(tileKey, element)
    return () => mixer.detach(tileKey)
  }, [mixer, tileKey])

  return (
    <video
      ref={ref}
      className="scroller-tile"
      style={{ left, top, width, height }}
      crossOrigin="anonymous"
      src={src}
      autoPlay
      loop
      playsInline
      onLoadedMetadata={(e) => {
        // Start at a random point so duplicate tiles of the same video don't play in lockstep.
        const video = e.currentTarget
        if (Number.isFinite(video.duration) && video.duration > 4) {
          video.currentTime = Math.random() * video.duration * 0.8
        }
      }}
      onError={() => onFailed(item.id)}
      onMouseEnter={() => hoverFocus && mixer.setFocus(tileKey)}
      onMouseLeave={() => hoverFocus && mixer.setFocus(null)}
    />
  )
})
