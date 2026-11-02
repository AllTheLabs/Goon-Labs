import { loadLabPrefs } from '../labPrefs'
import type { LabPrefs } from '../labPrefs'

export function defaultLabLaunch(): LabPrefs {
  return loadLabPrefs()
}

interface LabStartTogglesProps {
  value: LabPrefs
  onChange: (prefs: LabPrefs) => void
}

export function LabStartToggles({ value, onChange }: LabStartTogglesProps) {
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
    </div>
  )
}
