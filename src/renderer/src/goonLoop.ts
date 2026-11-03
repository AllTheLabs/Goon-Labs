export interface LoopMatch {
  start: number
  end: number
  /** 0–100. Higher means the wrap frames look more alike. */
  quality: number
}

const FRAME_W = 48
const FRAME_H = 27
const MAX_SAMPLES = 16
const MIN_LOOP = 0.4

function sampleTimes(from: number, to: number, cap: number): number[] {
  if (to <= from) return [from]
  const count = Math.min(cap, Math.max(4, Math.round((to - from) * 12) + 1))
  if (count <= 1) return [from]
  const times: number[] = []
  for (let i = 0; i < count; i++) times.push(from + ((to - from) * i) / (count - 1))
  return times
}

function waitSeek(video: HTMLVideoElement, time: number): Promise<void> {
  const clamped = Math.min(Math.max(0, time), video.duration || time)
  if (Math.abs(video.currentTime - clamped) < 0.0005) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new Error('Could not read a frame'))
    }
    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('error', onError)
    }
    video.addEventListener('seeked', onSeeked)
    video.addEventListener('error', onError)
    video.currentTime = clamped
  })
}

function toGray(data: Uint8ClampedArray): Uint8Array {
  const pixels = data.length / 4
  const out = new Uint8Array(pixels)
  for (let i = 0; i < pixels; i++) {
    const o = i * 4
    out[i] = (data[o] * 54 + data[o + 1] * 183 + data[o + 2] * 19) >> 8
  }
  return out
}

function mse(a: Uint8Array, b: Uint8Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i]
    sum += d * d
  }
  return sum / a.length
}

function variance(frame: Uint8Array): number {
  let mean = 0
  for (const value of frame) mean += value
  mean /= frame.length
  let sum = 0
  for (const value of frame) {
    const d = value - mean
    sum += d * d
  }
  return sum / frame.length
}

async function grabFrame(
  video: HTMLVideoElement,
  ctx: CanvasRenderingContext2D,
  time: number
): Promise<Uint8Array> {
  await waitSeek(video, time)
  ctx.drawImage(video, 0, 0, FRAME_W, FRAME_H)
  return toGray(ctx.getImageData(0, 0, FRAME_W, FRAME_H).data)
}

function yieldFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

/**
 * Searches the start and end of a span for the pair of frames that wrap most
 * cleanly, then returns those times as a tighter loop.
 */
export async function findSeamlessLoop(
  video: HTMLVideoElement,
  spanStart: number,
  spanEnd: number,
  onProgress?: (ratio: number) => void,
  signal?: AbortSignal
): Promise<LoopMatch> {
  const span = spanEnd - spanStart
  if (span < MIN_LOOP + 0.15) {
    throw new Error('Give the loop a bit more room — at least half a second')
  }

  const canvas = document.createElement('canvas')
  canvas.width = FRAME_W
  canvas.height = FRAME_H
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Could not read frames from this video')

  const window = Math.min(1.6, Math.max(0.28, span * 0.3), (span - MIN_LOOP) / 2)
  const startTimes = sampleTimes(spanStart, spanStart + window, MAX_SAMPLES)
  const endTimes = sampleTimes(spanEnd - window, spanEnd, MAX_SAMPLES)
  const total = startTimes.length + endTimes.length
  let done = 0

  const grab = async (time: number) => {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const frame = await grabFrame(video, ctx, time)
    done += 1
    onProgress?.(done / (total + 1))
    await yieldFrame()
    return frame
  }

  let startFrames: Uint8Array[]
  let endFrames: Uint8Array[]
  try {
    startFrames = []
    for (const time of startTimes) startFrames.push(await grab(time))
    endFrames = []
    for (const time of endTimes) endFrames.push(await grab(time))
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    throw new Error('Could not read frames from this video')
  }

  let best = { start: spanStart, end: spanEnd, score: Number.POSITIVE_INFINITY }
  for (let i = 0; i < startFrames.length; i++) {
    const startVar = variance(startFrames[i])
    for (let j = 0; j < endFrames.length; j++) {
      const loopLen = endTimes[j] - startTimes[i]
      if (loopLen < MIN_LOOP) continue
      let score = mse(startFrames[i], endFrames[j])
      if (startVar < 48 || variance(endFrames[j]) < 48) score += 900
      // Prefer a slightly longer loop when the wrap looks similar.
      score -= (loopLen / span) * 18
      if (score < best.score) {
        best = { start: startTimes[i], end: endTimes[j], score }
      }
    }
  }

  onProgress?.(1)
  if (!Number.isFinite(best.score)) {
    throw new Error('Could not find a loop in that span')
  }

  const rawMse = Math.max(0, best.score + (best.end - best.start) / span * 18)
  const quality = Math.max(0, Math.min(100, Math.round(100 - Math.sqrt(rawMse) * 1.35)))
  return { start: best.start, end: best.end, quality }
}
