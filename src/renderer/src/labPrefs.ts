export interface LabPrefs {
  recordOnEnter: boolean
  webcamOnEnter: boolean
  /** Session length in seconds. Omit or 0 to run until the queue ends or you exit. Not saved as a default. */
  sessionLimitSeconds?: number
}

const KEY = 'lab.prefs'

export function loadLabPrefs(): LabPrefs {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<LabPrefs>
    return {
      recordOnEnter: saved.recordOnEnter === true,
      webcamOnEnter: saved.webcamOnEnter === true
    }
  } catch {
    return { recordOnEnter: false, webcamOnEnter: false }
  }
}

export function saveLabPrefs(prefs: LabPrefs): void {
  localStorage.setItem(
    KEY,
    JSON.stringify({
      recordOnEnter: prefs.recordOnEnter === true,
      webcamOnEnter: prefs.webcamOnEnter === true
    })
  )
}
