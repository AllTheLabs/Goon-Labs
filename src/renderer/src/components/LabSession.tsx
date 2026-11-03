import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, CameraOff, Circle, Square } from 'lucide-react'
import type { LabPrefs } from '../labPrefs'
import { useTheme } from '../themes'

export type CamCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

const CORNERS: { id: CamCorner; label: string }[] = [
  { id: 'top-left', label: 'Top left' },
  { id: 'top-right', label: 'Top right' },
  { id: 'bottom-left', label: 'Bottom left' },
  { id: 'bottom-right', label: 'Bottom right' }
]

const STORAGE_KEY = 'lab.cam'
const MIN_SIZE = 140
const MAX_SIZE = 420

interface CamSettings {
  corner: CamCorner
  size: number
}

function loadCam(): CamSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<CamSettings>
    const corner = CORNERS.some((c) => c.id === saved.corner) ? saved.corner! : 'bottom-right'
    const size = typeof saved.size === 'number' ? Math.min(MAX_SIZE, Math.max(MIN_SIZE, saved.size)) : 220
    return { corner, size }
  } catch {
    return { corner: 'bottom-right', size: 220 }
  }
}

function pickMime(): string {
  const types = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
  return types.find((type) => MediaRecorder.isTypeSupported(type)) ?? 'video/webm'
}

async function captureWindow(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30 },
      audio: true
    })
  } catch {
    const id = await window.api.getWindowSourceId()
    if (!id) throw new Error('Could not capture this window')
    return navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        // Chromium desktop-capture constraints, not in the standard typings.
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: id
        }
      } as unknown as MediaTrackConstraints
    })
  }
}

function formatClock(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds))
  const m = Math.floor(total / 60)
  const s = String(total % 60).padStart(2, '0')
  return `${m}:${s}`
}

export function useLabSession(
  labName: string,
  launch: Partial<LabPrefs> = {},
  onTimeUp?: () => void
) {
  const { copy, icons } = useTheme()
  const LiveIcon = icons.live
  const [cam, setCam] = useState(loadCam)
  const [cameraOn, setCameraOn] = useState(false)
  const [recording, setRecording] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const camRef = useRef<HTMLVideoElement>(null)
  const camStream = useRef<MediaStream | null>(null)
  const onTimeUpRef = useRef(onTimeUp)
  onTimeUpRef.current = onTimeUp
  const timeUpFired = useRef(false)
  const [remaining, setRemaining] = useState<number | null>(null)
  const captureStream = useRef<MediaStream | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const pendingWrites = useRef<Promise<void>[]>([])

  const updateCam = (patch: Partial<CamSettings>) =>
    setCam((current) => {
      const next = { ...current, ...patch }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      return next
    })

  const stopCamera = useCallback(() => {
    camStream.current?.getTracks().forEach((track) => track.stop())
    camStream.current = null
    if (camRef.current) camRef.current.srcObject = null
    setCameraOn(false)
  }, [])

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: false
      })
      camStream.current?.getTracks().forEach((track) => track.stop())
      camStream.current = stream
      setCameraOn(true)
      setMessage(null)
    } catch (err) {
      setMessage((err as Error).message.replace(/^Failed to execute[^:]+: /, '') || 'Could not open the webcam')
    }
  }, [])

  useEffect(() => {
    const el = camRef.current
    if (!el) return
    el.srcObject = cameraOn ? camStream.current : null
    if (cameraOn) el.play().catch(() => {})
  }, [cameraOn])

  const stopRecording = useCallback(async () => {
    const rec = recorder.current
    recorder.current = null
    if (rec && rec.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        rec.addEventListener('stop', () => resolve(), { once: true })
        rec.stop()
      })
    }
    await Promise.all(pendingWrites.current)
    pendingWrites.current = []
    captureStream.current?.getTracks().forEach((track) => track.stop())
    captureStream.current = null
    setRecording(false)
    try {
      setMessage('Saving recording…')
      const saved = await window.api.finishSessionRecording()
      if (saved) {
        setMessage(`Saved ${saved}`)
        window.api.revealPath(saved)
      } else {
        setMessage(null)
      }
    } catch (err) {
      setMessage((err as Error).message)
    }
  }, [])

  const startRecording = useCallback(
    async (prompt: boolean) => {
      try {
        const filePath = await window.api.beginSessionRecording(labName, { prompt })
        if (!filePath) return
        const stream = await captureWindow()
        captureStream.current = stream
        pendingWrites.current = []
        const rec = new MediaRecorder(stream, { mimeType: pickMime(), videoBitsPerSecond: 8_000_000 })
        rec.ondataavailable = (event) => {
          if (event.data.size === 0) return
          const write = event.data.arrayBuffer().then((buffer) => window.api.appendSessionChunk(buffer))
          pendingWrites.current.push(write)
        }
        rec.onerror = () => {
          setMessage('Recording failed')
          void stopRecording()
        }
        stream.getVideoTracks()[0]?.addEventListener('ended', () => void stopRecording())
        recorder.current = rec
        rec.start(1000)
        setRecording(true)
        setMessage(null)
      } catch (err) {
        captureStream.current?.getTracks().forEach((track) => track.stop())
        captureStream.current = null
        await window.api.finishSessionRecording().catch(() => {})
        setMessage((err as Error).message.replace(/^NotAllowedError: /, '') || 'Could not start recording')
      }
    },
    [labName, stopRecording]
  )

  const stopRecordingRef = useRef(stopRecording)
  stopRecordingRef.current = stopRecording

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement && e.target.type !== 'range') return
      const key = e.key.toLowerCase()
      if (key === 'c') {
        e.preventDefault()
        e.stopPropagation()
        if (cameraOn) stopCamera()
        else void startCamera()
      } else if (key === 'r') {
        e.preventDefault()
        e.stopPropagation()
        if (recording) void stopRecording()
        else void startRecording(true)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [cameraOn, recording, startCamera, stopCamera, startRecording, stopRecording])

  useEffect(() => {
    const limit = launch.sessionLimitSeconds
    if (!limit || limit <= 0) {
      setRemaining(null)
      return
    }
    timeUpFired.current = false
    const endsAt = Date.now() + limit * 1000
    setRemaining(limit)
    const id = window.setInterval(() => {
      const left = (endsAt - Date.now()) / 1000
      if (left <= 0) {
        setRemaining(0)
        window.clearInterval(id)
        if (!timeUpFired.current) {
          timeUpFired.current = true
          onTimeUpRef.current?.()
        }
        return
      }
      setRemaining(left)
    }, 200)
    return () => window.clearInterval(id)
  }, [launch.sessionLimitSeconds])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (launch.webcamOnEnter) {
        await startCamera()
        if (cancelled) return
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      }
      if (cancelled) return
      if (launch.recordOnEnter) await startRecording(false)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(
    () => () => {
      camStream.current?.getTracks().forEach((track) => track.stop())
      void stopRecordingRef.current()
    },
    []
  )

  const overlay = (
    <>
      {cameraOn && (
        <div
          className={`lab-cam ${cam.corner}`}
          style={{ width: cam.size }}
          onClick={(e) => e.stopPropagation()}
        >
          <video ref={camRef} autoPlay muted playsInline />
          {recording && (
            <div className="lab-cam-live">
              <span>{copy.liveCaption}</span>
              {LiveIcon && <LiveIcon size={12} />}
            </div>
          )}
        </div>
      )}
      {message && (
        <div className="lab-session-msg" onClick={() => setMessage(null)}>
          {message}
        </div>
      )}
      {remaining !== null && remaining <= 60 && (
        <div className="wind-down-island" aria-live="polite">
          {formatClock(remaining)}
        </div>
      )}
    </>
  )

  const controls = (
    <div className="lab-tools">
      <button
        className={`scroller-btn ${cameraOn ? 'active' : ''}`}
        onClick={() => (cameraOn ? stopCamera() : void startCamera())}
        title={cameraOn ? 'Hide webcam (C)' : 'Show webcam (C)'}
      >
        {cameraOn ? <Camera size={16} /> : <CameraOff size={16} />}
      </button>
      {cameraOn && (
        <div className="lab-cam-panel">
          <div className="lab-cam-corners" title="Move webcam">
            {CORNERS.map((corner) => (
              <button
                key={corner.id}
                className={`lab-cam-corner ${cam.corner === corner.id ? 'active' : ''} ${corner.id}`}
                onClick={() => updateCam({ corner: corner.id })}
                title={corner.label}
                aria-label={corner.label}
              />
            ))}
          </div>
          <label className="lab-cam-size" title="Webcam size">
            Size
            <input
              type="range"
              min={MIN_SIZE}
              max={MAX_SIZE}
              step={10}
              value={cam.size}
              onChange={(e) => updateCam({ size: Number(e.target.value) })}
            />
          </label>
        </div>
      )}
      <button
        className={`scroller-btn ${recording ? 'recording' : ''}`}
        onClick={() => (recording ? void stopRecording() : void startRecording(true))}
        title={recording ? 'Stop recording (R)' : 'Record this session (R)'}
      >
        {recording ? <Square size={14} fill="currentColor" /> : <Circle size={16} />}
      </button>
    </div>
  )

  const fade = remaining !== null && remaining <= 60 ? Math.max(0, remaining / 60) : 1

  return { overlay, controls, recording, fade }
}
