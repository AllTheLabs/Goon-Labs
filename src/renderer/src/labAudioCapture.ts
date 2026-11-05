/** The active lab’s mixed output, when it routes through Web Audio. */

let getter: (() => MediaStream | null) | null = null

export function setLabAudioCapture(next: (() => MediaStream | null) | null): void {
  getter = next
}

export function getLabAudioCapture(): MediaStream | null {
  try {
    return getter?.() ?? null
  } catch {
    return null
  }
}
