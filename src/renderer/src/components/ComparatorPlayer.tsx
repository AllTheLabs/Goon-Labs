import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  Droplet,
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
import { ComparatorMix } from '../comparatorAudio'
import { pairClips } from '../comparatorMatch'
import type { ClipPair } from '../comparatorMatch'
import type { LabPrefs } from '../labPrefs'
import type { LabRecap } from '../labRecap'
import { recapCount } from '../labRecap'
import { useTheme } from '../themes'
import { mediaUrl } from '../utils'
import { useLabSession } from './LabSession'
import { saveComparatorSettings } from './ComparatorSetup'
import type { ComparatorSettings } from './ComparatorSetup'
import type { MediaItem } from '../../../shared/types'

interface ComparatorPlayerProps {
  left: MediaItem[]
  right: MediaItem[]
  leftTags: string[]
  rightTags: string[]
  settings: ComparatorSettings
  launch?: LabPrefs
  onExit: (recap: LabRecap) => void
}

const CONTROLS_HIDE_MS = 2500

function tagLine(tags: string[]): string {
  return tags.length === 0 ? 'All videos' : tags.join(' · ')
}

export function ComparatorPlayer({
  left,
  right,
  leftTags,
  rightTags,
  settings,
  launch,
  onExit
}: ComparatorPlayerProps) {
  const { copy } = useTheme()
  const endRef = useRef<() => void>(() => {})
  const lab = useLabSession(copy.comparator, launch, () => endRef.current())
  const ended = useRef(false)
  const leftRef = useRef<HTMLVideoElement>(null)
  const rightRef = useRef<HTMLVideoElement>(null)
  const mixRef = useRef<ComparatorMix | null>(null)
  const unique = useRef(new Set<string>())
  const pairsShown = useRef(0)
  const failures = useRef(0)
  const cutting = useRef(false)

  const [pairs, setPairs] = useState(() => pairClips(left, right))
  const [index, setIndex] = useState(0)
  const [pass, setPass] = useState(0)
  const [paused, setPaused] = useState(false)
  const [endless, setEndless] = useState(settings.endless)
  const [pink, setPink] = useState(settings.pink)
  const [volume, setVolume] = useState(0.8)
  const [muted, setMuted] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [focus, setFocus] = useState<'left' | 'right' | 'center'>('center')

  const pair: ClipPair | undefined = pairs[index]

  useEffect(() => saveComparatorSettings({ pink, endless }), [pink, endless])

  useLayoutEffect(() => {
    const mix = new ComparatorMix()
    mixRef.current = mix
    return () => {
      mixRef.current = null
      mix.close()
    }
  }, [])

  useLayoutEffect(() => {
    if (leftRef.current) mixRef.current?.attach('left', leftRef.current)
    if (rightRef.current) mixRef.current?.attach('right', rightRef.current)
    mixRef.current?.resume()
  }, [pair?.left.id, pair?.right.id])

  useEffect(() => {
    mixRef.current?.setFocus(focus)
  }, [focus])

  useEffect(() => {
    mixRef.current?.setVolume(muted ? 0 : volume * lab.fade)
  }, [volume, muted, lab.fade])

  const reshuffle = useCallback(() => pairClips(left, right), [left, right])

  const advance = useCallback(() => {
    if (cutting.current) return
    cutting.current = true
    if (index + 1 < pairs.length) {
      setIndex(index + 1)
      return
    }
    if (endless) {
      setPairs(reshuffle())
      setIndex(0)
      setPass((value) => value + 1)
      return
    }
    endRef.current()
  }, [index, pairs.length, endless, reshuffle])

  const back = useCallback(() => {
    const videos = [leftRef.current, rightRef.current]
    const elapsed = Math.max(leftRef.current?.currentTime ?? 0, rightRef.current?.currentTime ?? 0)
    if (elapsed > 3) {
      for (const video of videos) if (video) video.currentTime = 0
      return
    }
    if (index > 0) setIndex(index - 1)
    else if (endless && pass > 0) {
      setPairs(reshuffle())
      setIndex(Math.max(0, pairs.length - 1))
      setPass((value) => value - 1)
    } else {
      for (const video of videos) if (video) video.currentTime = 0
    }
  }, [index, pass, endless, pairs.length, reshuffle])

  useEffect(() => {
    if (!pair) {
      if (endless) {
        setPairs(reshuffle())
        setIndex(0)
      } else {
        endRef.current()
      }
    }
  }, [pair, endless, reshuffle])

  useEffect(() => {
    cutting.current = false
    if (!pair) return
    unique.current.add(pair.left.id)
    unique.current.add(pair.right.id)
    pairsShown.current++
  }, [index, pass, pair?.left.id, pair?.right.id])

  useEffect(() => {
    const leftVideo = leftRef.current
    const rightVideo = rightRef.current
    if (!leftVideo || !rightVideo) return
    for (const video of [leftVideo, rightVideo]) {
      video.muted = false
      video.volume = 1
    }
    mixRef.current?.resume()
    if (paused) {
      leftVideo.pause()
      rightVideo.pause()
      return
    }
    void leftVideo.play().catch(() => {})
    void rightVideo.play().catch(() => {})
  }, [paused, pair?.left.id, pair?.right.id, pass])

  const onFailed = () => {
    failures.current++
    if (failures.current >= Math.max(pairs.length, 4)) endRef.current()
    else advance()
  }

  const end = useCallback(() => {
    if (ended.current) return
    ended.current = true
    const stats = [
      recapCount('Pairs shown', pairsShown.current),
      recapCount('Unique videos', unique.current.size)
    ]
    if (failures.current > 0) stats.push(recapCount("Couldn't play", failures.current))
    onExit({ lab: copy.comparator, durationSeconds: lab.elapsedSeconds(), stats })
  }, [onExit, copy.comparator, lab.elapsedSeconds])
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
      else if (key === ' ') setPaused((value) => !value)
      else if (key === 'arrowright') advance()
      else if (key === 'arrowleft') back()
      else if (key === 'm') setMuted((value) => !value)
      else if (key === 'p') setPink((value) => !value)
      else if (key === 'l') setEndless((value) => !value)
      else if (key === 'arrowup') setVolume((value) => Math.min(1, value + 0.05))
      else if (key === 'arrowdown') setVolume((value) => Math.max(0, value - 0.05))
      else return
      e.preventDefault()
      e.stopPropagation()
      revealControls()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [end, advance, back, revealControls])

  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2
  if (!pair) return null

  return (
    <div
      className={`queue-player comparator-player ${controlsVisible ? '' : 'idle'} ${pink ? 'pink' : ''}`}
      onMouseMove={revealControls}
    >
      <div className="comparator-stage">
        <div
          className={`comparator-pane ${focus === 'left' ? 'focused' : ''}`}
          onMouseEnter={() => setFocus('left')}
          onMouseLeave={() => setFocus('center')}
          onClick={() => {
            mixRef.current?.resume()
            setPaused((value) => !value)
          }}
        >
          <video
            ref={leftRef}
            className="comparator-video"
            src={mediaUrl(pair.left)}
            crossOrigin="anonymous"
            playsInline
            preload="auto"
            onEnded={advance}
            onError={onFailed}
          />
          <span className="comparator-pane-label">{pair.left.fileName}</span>
        </div>
        <div className="comparator-split" />
        <div
          className={`comparator-pane ${focus === 'right' ? 'focused' : ''}`}
          onMouseEnter={() => setFocus('right')}
          onMouseLeave={() => setFocus('center')}
          onClick={() => {
            mixRef.current?.resume()
            setPaused((value) => !value)
          }}
        >
          <video
            ref={rightRef}
            className="comparator-video"
            src={mediaUrl(pair.right)}
            crossOrigin="anonymous"
            playsInline
            preload="auto"
            onEnded={advance}
            onError={onFailed}
          />
          <span className="comparator-pane-label">{pair.right.fileName}</span>
        </div>
      </div>
      {pink && <div className="comparator-pink" />}
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
          <span className="scroller-tags queue-now" title={`${tagLine(leftTags)} vs ${tagLine(rightTags)}`}>
            {tagLine(leftTags)} · {tagLine(rightTags)}
          </span>
          <span className="scroller-count">
            {copy.comparator} · {index + 1} / {pairs.length}
            {endless && pass > 0 ? ` · loop ${pass + 1}` : ''}
          </span>
        </div>

        <div className="scroller-divider" />

        <button className="scroller-btn" onClick={back} title="Previous pair (←)">
          <SkipBack size={16} fill="currentColor" />
        </button>
        <button className="scroller-btn" onClick={() => setPaused((value) => !value)} title="Play / pause (Space)">
          {paused ? <Play size={16} fill="currentColor" /> : <Pause size={16} fill="currentColor" />}
        </button>
        <button className="scroller-btn" onClick={advance} title="Next pair (→)">
          <SkipForward size={16} fill="currentColor" />
        </button>

        <div className="scroller-divider" />

        <button
          className={`scroller-btn ${pink ? 'active' : ''}`}
          onClick={() => setPink((value) => !value)}
          title={pink ? 'Pink filter on (P)' : 'Pink filter off (P)'}
        >
          <Droplet size={16} fill={pink ? 'currentColor' : 'none'} />
        </button>
        <button
          className={`scroller-btn ${endless ? 'active' : ''}`}
          onClick={() => setEndless((value) => !value)}
          title={endless ? 'Endless desire is on (L)' : 'Endless desire is off (L)'}
        >
          <InfinityIcon size={18} />
        </button>

        <div className="scroller-slider volume" title="Volume (↑ / ↓, M to mute)">
          <button className="scroller-btn" onClick={() => setMuted((value) => !value)}>
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
