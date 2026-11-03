import { useState } from 'react'
import { loadLabPrefs } from '../labPrefs'
import type { LabPrefs } from '../labPrefs'

export function defaultLabLaunch(): LabPrefs {
  return loadLabPrefs()
}

interface LabStartTogglesProps {
  value: LabPrefs
  onChange: (prefs: LabPrefs) => void
}

function splitLimit(seconds: number | undefined): { minutes: string; seconds: string } {
  if (!seconds || seconds <= 0) return { minutes: '', seconds: '' }
  return {
    minutes: String(Math.floor(seconds / 60)),
    seconds: String(seconds % 60)
  }
}

function parseLimit(minutes: string, seconds: string): number | undefined {
  const emptyMin = minutes.trim() === ''
  const emptySec = seconds.trim() === ''
  if (emptyMin && emptySec) return undefined
  const min = emptyMin ? 0 : Number(minutes)
  const sec = emptySec ? 0 : Number(seconds)
  if (!Number.isFinite(min) || !Number.isFinite(sec) || min < 0 || sec < 0) return undefined
  const total = Math.round(min) * 60 + Math.min(59, Math.round(sec))
  if (total <= 0) return undefined
  return Math.min(total, 12 * 60 * 60)
}

function digits(raw: string, maxLen: number): string {
  return raw.replace(/[^\d]/g, '').slice(0, maxLen)
}

export function LabStartToggles({ value, onChange }: LabStartTogglesProps) {
  const initial = splitLimit(value.sessionLimitSeconds)
  const [minutes, setMinutes] = useState(initial.minutes)
  const [seconds, setSeconds] = useState(initial.seconds)

  const setLimit = (min: string, sec: string) => {
    setMinutes(min)
    setSeconds(sec)
    onChange({ ...value, sessionLimitSeconds: parseLimit(min, sec) })
  }

  return (
    <div className="lab-start-toggles">
      <label className={`endless-toggle ${value.recordOnEnter ? 'on' : ''}`}>
        <input
          type="checkbox"
          checked={value.recordOnEnter}
          onChange={(e) => onChange({ ...value, recordOnEnter: e.target.checked })}
        />
        <span>
          <strong>Record this session</strong>
          <small>Starts saving as soon as this lab opens</small>
        </span>
      </label>
      <label className={`endless-toggle ${value.webcamOnEnter ? 'on' : ''}`}>
        <input
          type="checkbox"
          checked={value.webcamOnEnter}
          onChange={(e) => onChange({ ...value, webcamOnEnter: e.target.checked })}
        />
        <span>
          <strong>Webcam on</strong>
          <small>Shows your camera over the media</small>
        </span>
      </label>
      <div className="session-limit">
        <span>
          <strong>Session time</strong>
          <small>Leave empty to run until you exit</small>
        </span>
        <div className="session-limit-inputs">
          <input
            className="input"
            inputMode="numeric"
            placeholder="—"
            aria-label="Minutes"
            value={minutes}
            onChange={(e) => setLimit(digits(e.target.value, 3), seconds)}
          />
          <span>min</span>
          <input
            className="input"
            inputMode="numeric"
            placeholder="—"
            aria-label="Seconds"
            value={seconds}
            onChange={(e) => {
              const next = digits(e.target.value, 2)
              setLimit(minutes, next === '' ? '' : String(Math.min(59, Number(next))))
            }}
          />
          <span>sec</span>
        </div>
      </div>
    </div>
  )
}
