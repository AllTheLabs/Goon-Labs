export interface LabPrefs {
  recordOnEnter: boolean
  webcamOnEnter: boolean
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
  localStorage.setItem(KEY, JSON.stringify(prefs))
}
