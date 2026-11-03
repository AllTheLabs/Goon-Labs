import { useEffect, useState } from 'react'
import { FolderOpen, FolderSearch, RefreshCw, Settings as SettingsIcon, X } from 'lucide-react'
import { loadLabPrefs, saveLabPrefs } from '../labPrefs'
import type { LabPrefs } from '../labPrefs'

interface SettingsProps {
  onClose: () => void
}

const LIBRARY_KEYS: [string, string][] = [
  ['Ctrl + V', 'Import from URL'],
  ['Ctrl + A', 'Select all'],
  ['Enter', 'Open the selected item'],
  ['Delete', 'Delete selected media'],
  ['Esc', 'Clear selection / close'],
  ['Ctrl / Shift + click', 'Select several items']
]

const SCROLLER_KEYS: [string, string][] = [
  ['Space', 'Pause / resume'],
  ['E', 'Overlay effects'],
  ['M', 'Mute'],
  ['↑ / ↓', 'Volume'],
  ['+ / −', 'Tile size'],
  ['C', 'Webcam on / off'],
  ['R', 'Start / stop recording'],
  ['Esc', 'Exit']
]

const TRIMMER_KEYS: [string, string][] = [
  ['Space', 'Play / pause'],
  ['Enter', 'Open the selected video'],
  ['Esc', 'Close']
]

const DILATION_KEYS: [string, string][] = [
  ['Space', 'Play / pause'],
  ['Delete', 'Remove the selected span'],
  ['Enter', 'Open the selected video'],
  ['Esc', 'Close']
]

const GIF_KEYS: [string, string][] = [
  ['Space', 'Play / pause'],
  ['Enter', 'Open the selected video'],
  ['Esc', 'Close']
]

const BEAT_KEYS: [string, string][] = [
  ['Space', 'Pause / resume'],
  ['← / →', 'Previous / next video'],
  ['L', 'Endless desire'],
  ['1 / 2 / 3 / 4', 'Light / Medium / Heavy / Ludicrous'],
  ['0', 'Random mix'],
  ['M', 'Mute'],
  ['↑ / ↓', 'Volume'],
  ['C', 'Webcam on / off'],
  ['R', 'Start / stop recording'],
  ['Esc', 'Exit']
]

const HYPNO_KEYS: [string, string][] = [
  ['Space', 'Pause / resume'],
  ['→', 'Next snippet'],
  ['1 / 2 / 3', 'Linger / Flash / Strobe'],
  ['B', 'Melodic rumble on / off'],
  ['E', 'Overlay effects'],
  ['M', 'Mute'],
  ['↑ / ↓', 'Volume'],
  ['C', 'Webcam on / off'],
  ['R', 'Start / stop recording'],
  ['Esc', 'Exit']
]

const PIXEL_KEYS: [string, string][] = [
  ['Space', 'Pause / resume'],
  ['← / →', 'Previous / next video'],
  ['L', 'Endless desire'],
  ['F', 'Pixelate faces'],
  ['N', 'Pixelate NSFW'],
  ['D', 'Skip dark-skinned male genitalia'],
  ['[ / ]', 'Finer / heavier pixelation'],
  ['M', 'Mute'],
  ['↑ / ↓', 'Volume'],
  ['C', 'Webcam on / off'],
  ['R', 'Start / stop recording'],
  ['Esc', 'Exit']
]

function KeyTable({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <section className="settings-keys">
      <h3>{title}</h3>
      <dl>
        {rows.map(([key, action]) => (
          <div key={key} className="settings-key-row">
            <dt>
              <kbd>{key}</kbd>
            </dt>
            <dd>{action}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

export function Settings({ onClose }: SettingsProps) {
  const [sessionDir, setSessionDir] = useState<string | null>(null)
  const [softwareWindow, setSoftwareWindow] = useState(false)
  const [softwareWindowActive, setSoftwareWindowActive] = useState(false)
  const [prefs, setPrefs] = useState(loadLabPrefs)

  useEffect(() => {
    window.api.getAppSettings().then((settings) => {
      setSessionDir(settings.sessionDir)
      setSoftwareWindow(settings.softwareWindow)
      setSoftwareWindowActive(settings.softwareWindowActive)
    })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const updatePrefs = (next: LabPrefs) => {
    setPrefs(next)
    saveLabPrefs(next)
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal settings-modal">
        <header className="modal-header">
          <div className="modal-icon">
            <SettingsIcon size={20} />
          </div>
          <div>
            <h2>Settings</h2>
            <p>Recordings, lab defaults, and every shortcut.</p>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <section className="settings-block">
          <h3>Session recordings</h3>
          <p className="hint">
            Labs save here when you hit Record, or when a lab is set to start recording on its own.
          </p>
          <div className="settings-path">
            <code className="mono" title={sessionDir ?? undefined}>
              {sessionDir ?? 'Not set — you will be asked where to save, or Videos is used'}
            </code>
            <button
              className="btn btn-secondary btn-sm"
              onClick={async () => {
                const dir = await window.api.chooseSessionDir()
                if (dir) setSessionDir(dir)
              }}
            >
              <FolderOpen size={14} /> Choose folder
            </button>
            {sessionDir && (
              <button className="btn btn-ghost btn-sm" onClick={() => window.api.revealPath(sessionDir)}>
                <FolderSearch size={14} /> Show
              </button>
            )}
          </div>
        </section>

        <section className="settings-block">
          <h3>When a lab opens</h3>
          <LabPrefToggles value={prefs} onChange={updatePrefs} />
        </section>

        <section className="settings-block">
          <h3>Display</h3>
          <label className={`endless-toggle ${softwareWindow ? 'on' : ''}`}>
            <input
              type="checkbox"
              checked={softwareWindow}
              onChange={async (e) => {
                const on = e.target.checked
                setSoftwareWindow(on)
                await window.api.setSoftwareWindow(on)
              }}
            />
            <span>
              <strong>Software window rendering</strong>
              <small>
                Draw the app window on the CPU. Fixes flicker and leftover images on some graphics
                drivers. Time Dilation and other ffmpeg jobs still use the GPU if they can.
              </small>
            </span>
          </label>
          {softwareWindow !== softwareWindowActive && (
            <button className="btn btn-secondary btn-sm" onClick={() => window.api.relaunchApp()}>
              <RefreshCw size={14} /> Restart Goon Labs to apply
            </button>
          )}
        </section>

        <div className="settings-key-grid">
          <KeyTable title="Library" rows={LIBRARY_KEYS} />
          <KeyTable title="Scroller" rows={SCROLLER_KEYS} />
          <KeyTable title="Beat Bar" rows={BEAT_KEYS} />
          <KeyTable title="Pixel Perfection" rows={PIXEL_KEYS} />
          <KeyTable title="Hypno Station" rows={HYPNO_KEYS} />
          <KeyTable title="Trimmer" rows={TRIMMER_KEYS} />
          <KeyTable title="Time Dilation" rows={DILATION_KEYS} />
          <KeyTable title="Goon Image Format" rows={GIF_KEYS} />
        </div>
      </div>
    </div>
  )
}

function LabPrefToggles({ value, onChange }: { value: LabPrefs; onChange: (prefs: LabPrefs) => void }) {
  return (
    <div className="lab-start-toggles">
      <label className={`endless-toggle ${value.recordOnEnter ? 'on' : ''}`}>
        <input
          type="checkbox"
          checked={value.recordOnEnter}
          onChange={(e) => onChange({ ...value, recordOnEnter: e.target.checked })}
        />
        <span>
          <strong>Start recording</strong>
          <small>Begin a recording as soon as a lab opens</small>
        </span>
      </label>
      <label className={`endless-toggle ${value.webcamOnEnter ? 'on' : ''}`}>
        <input
          type="checkbox"
          checked={value.webcamOnEnter}
          onChange={(e) => onChange({ ...value, webcamOnEnter: e.target.checked })}
        />
        <span>
          <strong>Turn the webcam on</strong>
          <small>Show the camera overlay when a lab starts</small>
        </span>
      </label>
    </div>
  )
}
