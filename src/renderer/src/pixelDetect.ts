import * as ort from 'onnxruntime-web'

const INPUT_SIZE = 320
/** Long side of the frame fed to letterbox. The model is 320×320; 4K is wasted work. */
const DETECT_MAX_SIDE = 640
const SCORE_MIN = 0.25
const IOU_MAX = 0.5

const LABELS = [
  'FEMALE_GENITALIA_COVERED',
  'FACE_FEMALE',
  'BUTTOCKS_EXPOSED',
  'FEMALE_BREAST_EXPOSED',
  'FEMALE_GENITALIA_EXPOSED',
  'MALE_BREAST_EXPOSED',
  'ANUS_EXPOSED',
  'FEET_EXPOSED',
  'BELLY_COVERED',
  'FEET_COVERED',
  'ARMPITS_COVERED',
  'ARMPITS_EXPOSED',
  'FACE_MALE',
  'BELLY_EXPOSED',
  'MALE_GENITALIA_EXPOSED',
  'ANUS_COVERED',
  'FEMALE_BREAST_COVERED',
  'BUTTOCKS_COVERED'
] as const

const FACE = new Set(['FACE_FEMALE', 'FACE_MALE'])
const NSFW = new Set([
  'FEMALE_GENITALIA_EXPOSED',
  'FEMALE_GENITALIA_COVERED',
  'MALE_GENITALIA_EXPOSED',
  'ANUS_EXPOSED',
  'FEMALE_BREAST_EXPOSED',
  'BUTTOCKS_EXPOSED'
])

const TIGHTEN: Record<string, number> = {
  FEMALE_GENITALIA_EXPOSED: 0.86,
  FEMALE_GENITALIA_COVERED: 0.84,
  MALE_GENITALIA_EXPOSED: 0.86,
  ANUS_EXPOSED: 0.84,
  FEMALE_BREAST_EXPOSED: 0.88,
  BUTTOCKS_EXPOSED: 0.78
}

/** Face mosaic covers eyes and forehead, not the mouth. */
const FACE_WIDTH = 1.06
const FACE_UP = 0.36
/** Share of the original face box, from the top, that stays pixelated (stops above the mouth). */
const FACE_MOUTH_CUT = 0.62

export type PixelKind = 'face' | 'nsfw'

export interface PixelBox {
  x: number
  y: number
  w: number
  h: number
  kind: PixelKind
  score: number
  label?: string
}

export interface PixelDetectOptions {
  /** Drop MALE_GENITALIA_EXPOSED boxes whose sampled skin tone is dark. */
  skipDarkMale?: boolean
}

interface RawBox extends PixelBox {
  classId: number
}

export interface PixelDetector {
  detect(source: CanvasImageSource, width: number, height: number, options?: PixelDetectOptions): Promise<PixelBox[]>
}

export function iou(a: PixelBox, b: PixelBox): number {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.w, b.x + b.w)
  const y2 = Math.min(a.y + a.h, b.y + b.h)
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const union = a.w * a.h + b.w * b.h - inter
  return union <= 0 ? 0 : inter / union
}

function nms(boxes: RawBox[]): RawBox[] {
  const sorted = [...boxes].sort((a, b) => b.score - a.score)
  const kept: RawBox[] = []
  for (const box of sorted) {
    if (kept.some((other) => other.classId === box.classId && iou(box, other) > IOU_MAX)) continue
    kept.push(box)
  }
  return kept
}

/** Prefer a smaller overlapping box when scores are close, so a torso-sized hit doesn't win. */
function dropLooseOverlaps(boxes: RawBox[]): RawBox[] {
  const kept = [...boxes]
  for (let i = kept.length - 1; i >= 0; i--) {
    const box = kept[i]
    const area = box.w * box.h
    const looser = kept.some((other, j) => {
      if (j === i || other.kind !== box.kind) return false
      const otherArea = other.w * other.h
      return otherArea < area * 0.65 && other.score >= box.score * 0.75 && iou(box, other) > 0.25
    })
    if (looser) kept.splice(i, 1)
  }
  return kept
}

const inputCanvas = document.createElement('canvas')
const inputCtx = inputCanvas.getContext('2d', { willReadFrequently: true })!
const detectCanvas = document.createElement('canvas')
const detectCtx = detectCanvas.getContext('2d', { willReadFrequently: true })!
const sampleCanvas = document.createElement('canvas')
const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true })!

function captureFrame(
  source: CanvasImageSource,
  srcW: number,
  srcH: number
): { source: CanvasImageSource; w: number; h: number } {
  const long = Math.max(srcW, srcH)
  if (long <= DETECT_MAX_SIDE) return { source, w: srcW, h: srcH }
  const scale = DETECT_MAX_SIDE / long
  const w = Math.max(8, Math.round(srcW * scale))
  const h = Math.max(8, Math.round(srcH * scale))
  if (detectCanvas.width !== w) detectCanvas.width = w
  if (detectCanvas.height !== h) detectCanvas.height = h
  detectCtx.imageSmoothingEnabled = true
  detectCtx.imageSmoothingQuality = 'low'
  detectCtx.drawImage(source, 0, 0, w, h)
  return { source: detectCanvas, w, h }
}

const SKIP_DARK_LABELS = new Set([
  'MALE_GENITALIA_EXPOSED',
  // NudeNet often tags male genitalia as the female class.
  'FEMALE_GENITALIA_EXPOSED',
  'FEMALE_GENITALIA_COVERED'
])

function srgbToLinear(channel: number): number {
  const s = channel / 255
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}

function rgbToLab(r: number, g: number, b: number): { L: number; a: number; b: number } {
  const R = srgbToLinear(r)
  const G = srgbToLinear(g)
  const B = srgbToLinear(b)
  const x = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047
  const y = R * 0.2126729 + G * 0.7151522 + B * 0.072175
  const z = (R * 0.0193339 + G * 0.119192 + B * 0.9503041) / 1.08883
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const fy = f(y)
  return { L: 116 * fy - 16, a: 500 * (f(x) - fy), b: 200 * (fy - f(z)) }
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))
  return sorted[index]
}

/**
 * True when a genital box looks brown/dark rather than pink/fair.
 * Uses ITA (dermatology skin-tone angle) plus darkness, so bright lighting
 * on dark skin still counts — the old luma cutoff missed those.
 */
export function isDarkSkinRegion(source: CanvasImageSource, box: PixelBox, srcW: number, srcH: number): boolean {
  const x = Math.max(0, box.x + box.w * 0.08)
  const y = Math.max(0, box.y + box.h * 0.08)
  const w = Math.min(srcW - x, Math.max(4, box.w * 0.84))
  const h = Math.min(srcH - y, Math.max(4, box.h * 0.84))
  if (w < 4 || h < 4) return false
  sampleCanvas.width = 48
  sampleCanvas.height = 48
  sampleCtx.drawImage(source, x, y, w, h, 0, 0, 48, 48)
  let pixels: ImageData
  try {
    pixels = sampleCtx.getImageData(0, 0, 48, 48)
  } catch {
    return false
  }
  const data = pixels.data
  const L: number[] = []
  const ita: number[] = []
  const rg: number[] = []
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const lab = rgbToLab(r, g, b)
    if (lab.L < 12 || lab.L > 88) continue
    if (lab.a < 1) continue
    if (Math.hypot(lab.a, lab.b) < 5) continue
    L.push(lab.L)
    ita.push(Math.atan2(lab.L - 50, lab.b) * (180 / Math.PI))
    rg.push(r - g)
  }
  if (L.length < 16) return false
  const medianIta = percentile(ita, 0.5)
  const darkL = percentile(L, 0.35)
  const medianL = percentile(L, 0.5)
  const medianRg = percentile(rg, 0.5)
  // Fair/pink skin: ITA ~45–70, L* ~65–85, R−G high. Brown/dark sits well below that
  // even when a key light lifts the raw brightness.
  return medianIta < 40 || darkL < 62 || (medianL < 70 && medianRg < 34)
}

export function isSkipDarkMaleBox(box: PixelBox): boolean {
  return box.kind === 'nsfw' && !!box.label && SKIP_DARK_LABELS.has(box.label)
}

/** Ultralytics letterbox: scale to fit, center, pad with gray 114. */
function letterbox(source: CanvasImageSource, srcW: number, srcH: number): {
  tensor: Float32Array
  scale: number
  padX: number
  padY: number
} {
  inputCanvas.width = INPUT_SIZE
  inputCanvas.height = INPUT_SIZE
  inputCtx.fillStyle = 'rgb(114, 114, 114)'
  inputCtx.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE)
  const scale = Math.min(INPUT_SIZE / srcW, INPUT_SIZE / srcH)
  const drawW = Math.round(srcW * scale)
  const drawH = Math.round(srcH * scale)
  const padX = Math.round((INPUT_SIZE - drawW) / 2 - 0.1)
  const padY = Math.round((INPUT_SIZE - drawH) / 2 - 0.1)
  inputCtx.drawImage(source, padX, padY, drawW, drawH)
  let pixels: ImageData
  try {
    pixels = inputCtx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE)
  } catch {
    throw new Error('Could not read the video frame for detection')
  }
  const { data } = pixels
  const tensor = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE)
  const plane = INPUT_SIZE * INPUT_SIZE
  for (let i = 0; i < plane; i++) {
    tensor[i] = data[i * 4] / 255
    tensor[plane + i] = data[i * 4 + 1] / 255
    tensor[plane * 2 + i] = data[i * 4 + 2] / 255
  }
  return { tensor, scale, padX, padY }
}

function asFloat32(data: ort.Tensor['data']): Float32Array {
  if (data instanceof Float32Array) return data
  if (ArrayBuffer.isView(data) && data.BYTES_PER_ELEMENT) {
    return Float32Array.from(data as unknown as ArrayLike<number>)
  }
  throw new Error('Unexpected detector output type')
}

function decode(
  output: ort.Tensor,
  srcW: number,
  srcH: number,
  scale: number,
  padX: number,
  padY: number
): PixelBox[] {
  const dims = output.dims
  const raw = asFloat32(output.data)
  let channels: number
  let count: number
  let at: (channel: number, index: number) => number
  if (dims.length === 3 && dims[1] < dims[2]) {
    channels = dims[1]
    count = dims[2]
    at = (channel, index) => raw[channel * count + index]
  } else if (dims.length === 3) {
    count = dims[1]
    channels = dims[2]
    at = (channel, index) => raw[index * channels + channel]
  } else if (dims.length === 2) {
    count = dims[0]
    channels = dims[1]
    at = (channel, index) => raw[index * channels + channel]
  } else {
    return []
  }

  const classCount = channels - 4
  const frameArea = srcW * srcH
  const found: RawBox[] = []
  for (let i = 0; i < count; i++) {
    let best = 0
    let classId = 0
    for (let c = 0; c < classCount; c++) {
      const score = at(4 + c, i)
      if (score > best) {
        best = score
        classId = c
      }
    }
    if (best < SCORE_MIN || classId >= LABELS.length) continue
    const label = LABELS[classId]
    const kind: PixelKind | null = FACE.has(label) ? 'face' : NSFW.has(label) ? 'nsfw' : null
    if (!kind) continue
    const centerX = (at(0, i) - padX) / scale
    const centerY = (at(1, i) - padY) / scale
    let w: number
    let h: number
    let x: number
    let y: number
    if (kind === 'face') {
      const faceH = at(3, i) / scale
      w = (at(2, i) / scale) * FACE_WIDTH
      const faceTop = centerY - faceH / 2
      const up = faceH * FACE_UP
      x = centerX - w / 2
      y = faceTop - up
      h = up + faceH * FACE_MOUTH_CUT
    } else {
      const factor = TIGHTEN[label] ?? 0.88
      w = (at(2, i) / scale) * factor
      h = (at(3, i) / scale) * factor
      x = centerX - w / 2
      y = centerY - h / 2
    }
    const area = w * h
    if (area < frameArea * 0.0004) continue
    if (area > frameArea * 0.5 && best < 0.5) continue
    found.push({ x, y, w, h, kind, score: best, classId })
  }

  return dropLooseOverlaps(nms(found)).map((box) => ({
    x: Math.max(0, box.x),
    y: Math.max(0, box.y),
    w: Math.min(srcW - Math.max(0, box.x), box.w),
    h: Math.min(srcH - Math.max(0, box.y), box.h),
    kind: box.kind,
    score: box.score,
    label: LABELS[box.classId]
  }))
}

/** Blend new detections toward the previous frame so boxes don't jump to a huge hit. */
export function smoothBoxes(prev: PixelBox[], next: PixelBox[]): PixelBox[] {
  if (prev.length === 0) return next
  const used = new Set<number>()
  const out: PixelBox[] = []
  for (const box of next) {
    let bestIndex = -1
    let bestIou = 0.12
    for (let i = 0; i < prev.length; i++) {
      if (used.has(i) || prev[i].kind !== box.kind) continue
      const overlap = iou(prev[i], box)
      if (overlap > bestIou) {
        bestIou = overlap
        bestIndex = i
      }
    }
    if (bestIndex < 0) {
      out.push(box)
      continue
    }
    used.add(bestIndex)
    const last = prev[bestIndex]
    if (box.kind === 'face') {
      const coverTop = Math.min(last.y, box.y)
      const coverLeft = Math.min(last.x, box.x)
      const coverRight = Math.max(last.x + last.w, box.x + box.w)
      const t = 0.18
      const x = coverLeft + (box.x - coverLeft) * t
      const y = coverTop + (box.y - coverTop) * t
      const right = coverRight + (box.x + box.w - coverRight) * t
      const bottom = box.y + box.h
      out.push({
        x,
        y,
        w: right - x,
        h: Math.max(4, bottom - y),
        kind: box.kind,
        score: box.score,
        label: box.label
      })
      continue
    }
    const grew = box.w * box.h > last.w * last.h * 1.25
    const t = grew ? 0.28 : 0.55
    out.push({
      x: last.x + (box.x - last.x) * t,
      y: last.y + (box.y - last.y) * t,
      w: last.w + (box.w - last.w) * t,
      h: last.h + (box.h - last.h) * t,
      kind: box.kind,
      score: box.score,
      label: box.label
    })
  }
  return out
}

async function createSession(model: Uint8Array): Promise<ort.InferenceSession> {
  const threads =
    typeof SharedArrayBuffer !== 'undefined' &&
    (typeof crossOriginIsolated === 'undefined' || crossOriginIsolated)
      ? Math.min(4, Math.max(1, navigator.hardwareConcurrency || 1))
      : 1
  ort.env.wasm.numThreads = threads
  ort.env.wasm.simd = true
  const tryProviders: string[][] = []
  if (typeof navigator !== 'undefined' && 'gpu' in navigator) tryProviders.push(['webgpu', 'wasm'])
  tryProviders.push(['wasm'])
  let lastError: unknown
  for (const executionProviders of tryProviders) {
    try {
      return await ort.InferenceSession.create(model, { executionProviders })
    } catch (err) {
      lastError = err
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Could not start the detector')
}

export async function createPixelDetector(model: Uint8Array): Promise<PixelDetector> {
  const session = await createSession(model)
  const inputName = session.inputNames[0]
  await session.run({
    [inputName]: new ort.Tensor('float32', new Float32Array(3 * INPUT_SIZE * INPUT_SIZE), [
      1,
      3,
      INPUT_SIZE,
      INPUT_SIZE
    ])
  })

  return {
    async detect(source, width, height, options) {
      if (width < 8 || height < 8) return []
      const frame = captureFrame(source, width, height)
      const { tensor, scale, padX, padY } = letterbox(frame.source, frame.w, frame.h)
      const results = await session.run({
        [inputName]: new ort.Tensor('float32', tensor, [1, 3, INPUT_SIZE, INPUT_SIZE])
      })
      let boxes = decode(results[session.outputNames[0]], frame.w, frame.h, scale, padX, padY)
      if (options?.skipDarkMale) {
        boxes = boxes.filter(
          (box) => !isSkipDarkMaleBox(box) || !isDarkSkinRegion(frame.source, box, frame.w, frame.h)
        )
      }
      if (frame.w === width && frame.h === height) return boxes
      const sx = width / frame.w
      const sy = height / frame.h
      return boxes.map((box) => ({
        ...box,
        x: box.x * sx,
        y: box.y * sy,
        w: box.w * sx,
        h: box.h * sy
      }))
    }
  }
}
