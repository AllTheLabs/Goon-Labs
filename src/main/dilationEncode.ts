import { spawn, type ChildProcess } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { FFMPEG, h264EncodeArgs } from './previews'
import type { DilationProgress, DilationProgressStep } from '../shared/types'

export interface DilateRegion {
  start: number
  end: number
  factor: number
}

/** Only split a slow span if it is long enough that one minterpolate would dominate. */
const CHUNK_SECONDS = 12
/** Source seconds decoded on each side so minterpolate has motion context. */
const READ_PAD = 0.8
const EVEN = 'scale=trunc(iw/2)*2:trunc(ih/2)*2'
const AFORMAT = 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo'
const AAC = ['-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-ar', '48000']

function ts(value: number): string {
  return Math.max(0, value).toFixed(4)
}

function fpsStr(fps: number): string {
  return String(Number(fps.toFixed(3)))
}

function timeline(regions: DilateRegion[], duration: number): DilateRegion[] {
  const segs: DilateRegion[] = []
  let cursor = 0
  for (const region of regions) {
    if (region.start > cursor + 0.01) segs.push({ start: cursor, end: region.start, factor: 1 })
    segs.push(region)
    cursor = region.end
  }
  if (duration > cursor + 0.01) segs.push({ start: cursor, end: duration, factor: 1 })
  if (segs.length === 0) throw new Error('Nothing to dilate')
  return segs
}

function dilationFilter(
  regions: DilateRegion[],
  duration: number,
  hasAudio: boolean,
  fps: number,
  interpolate: boolean
): string {
  const segs = timeline(regions, duration)
  const rate = fpsStr(fps)
  const filters: string[] = []
  const concat: string[] = []

  segs.forEach((seg, i) => {
    const trimmed = `[0:v]trim=start=${ts(seg.start)}:end=${ts(seg.end)},setpts=PTS-STARTPTS`
    if (seg.factor !== 1 && interpolate) {
      filters.push(
        `${trimmed},setpts=PTS*${seg.factor},minterpolate=fps=${rate}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,format=yuv420p,${EVEN}[v${i}]`
      )
    } else if (seg.factor !== 1) {
      filters.push(`${trimmed},setpts=PTS*${seg.factor},format=yuv420p,${EVEN},fps=${rate}[v${i}]`)
    } else {
      filters.push(`${trimmed},format=yuv420p,${EVEN},fps=${rate}[v${i}]`)
    }
    concat.push(`[v${i}]`)
    if (!hasAudio) return
    pushAudio(filters, concat, seg, i)
  })

  const audio = hasAudio ? ':a=1[outv][outa]' : ':a=0[outv]'
  filters.push(`${concat.join('')}concat=n=${segs.length}:v=1${audio}`)
  return filters.join(';')
}

function pushAudio(filters: string[], concat: string[], seg: DilateRegion, i: number): void {
  const outDur = (seg.end - seg.start) * seg.factor
  const fade = Math.min(0.012, Math.max(0.006, outDur / 24))
  const fades = `afade=t=in:d=${ts(fade)},afade=t=out:st=${ts(Math.max(0, outDur - fade))}:d=${ts(fade)}`
  const trimmed = `[0:a]atrim=start=${ts(seg.start)}:end=${ts(seg.end)},asetpts=PTS-STARTPTS,${AFORMAT}`
  if (seg.factor !== 1) {
    const tempo = Number((1 / seg.factor).toFixed(4))
    filters.push(
      `${trimmed},rubberband=tempo=${tempo}:pitch=1:transients=smooth:smoothing=on:window=long:formant=preserved,adeclick,asplit=2[ad${i}][aw${i}]`
    )
    filters.push(`[aw${i}]aecho=0.8:0.9:52|105|160|220:0.48|0.38|0.3|0.22,lowpass=f=7500[arev${i}]`)
    filters.push(
      `[ad${i}][arev${i}]amix=inputs=2:duration=first:dropout_transition=0:normalize=0:weights=0.46\\ 0.72,alimiter=limit=0.96,${fades},apad,atrim=end=${ts(outDur)},asetpts=PTS-STARTPTS[a${i}]`
    )
  } else {
    filters.push(`${trimmed},${fades},apad,atrim=end=${ts(outDur)},asetpts=PTS-STARTPTS[a${i}]`)
  }
  concat.push(`[a${i}]`)
}

function spanAudioFilter(seg: DilateRegion, outDur: number): string {
  const fade = Math.min(0.012, Math.max(0.006, outDur / 24))
  const fades = `afade=t=in:d=${ts(fade)},afade=t=out:st=${ts(Math.max(0, outDur - fade))}:d=${ts(fade)}`
  const trimmed = `[0:a]asetpts=PTS-STARTPTS,atrim=start=${ts(seg.start)}:end=${ts(seg.end)},asetpts=PTS-STARTPTS,${AFORMAT}`
  if (seg.factor === 1) {
    return `${trimmed},${fades},apad,atrim=end=${ts(outDur)},asetpts=PTS-STARTPTS[a]`
  }
  const tempo = Number((1 / seg.factor).toFixed(4))
  return [
    `${trimmed},rubberband=tempo=${tempo}:pitch=1:transients=smooth:smoothing=on:window=long:formant=preserved,adeclick,asplit=2[ad][aw]`,
    `[aw]aecho=0.8:0.9:52|105|160|220:0.48|0.38|0.3|0.22,lowpass=f=7500[arev]`,
    `[ad][arev]amix=inputs=2:duration=first:dropout_transition=0:normalize=0:weights=0.46\\ 0.72,alimiter=limit=0.96,${fades},apad,atrim=end=${ts(outDur)},asetpts=PTS-STARTPTS[a]`
  ].join(';')
}

interface InterpChunk {
  readStart: number
  readEnd: number
  keepStart: number
  keepEnd: number
}

function splitSpan(start: number, end: number, fileDuration: number, pad: number): InterpChunk[] {
  const span = end - start
  if (span <= CHUNK_SECONDS + 1) {
    return [
      {
        readStart: Math.max(0, start - pad),
        readEnd: Math.min(fileDuration, end + pad),
        keepStart: start,
        keepEnd: end
      }
    ]
  }
  const chunks: InterpChunk[] = []
  let t = start
  while (t < end - 0.001) {
    const keepStart = t
    let keepEnd = Math.min(end, t + CHUNK_SECONDS)
    if (end - keepEnd < CHUNK_SECONDS * 0.4) keepEnd = end
    chunks.push({
      keepStart,
      keepEnd,
      readStart: Math.max(0, keepStart - pad),
      readEnd: Math.min(fileDuration, keepEnd + pad)
    })
    if (keepEnd >= end) break
    t = keepEnd
  }
  return chunks
}

/**
 * Input -ss/-t so this job only decodes the window it needs. Timestamps start
 * near 0; filters use relative trim. Never -copyts (absolute trim then misses
 * the frames) and never -ss after -i (that seeks the stretched output).
 */
function clipInput(source: string, start: number, duration: number): string[] {
  const args = ['-accurate_seek']
  if (start > 0.02) args.push('-ss', ts(start))
  args.push('-t', ts(Math.max(0.04, duration)))
  args.push('-i', source)
  return args
}

function slowVideoFilter(chunk: InterpChunk, factor: number, fps: number): string {
  const rate = fpsStr(fps)
  const leftOut = Math.max(0, chunk.keepStart - chunk.readStart) * factor
  const outDur = (chunk.keepEnd - chunk.keepStart) * factor
  return [
    `[0:v]setpts=PTS-STARTPTS`,
    `setpts=PTS*${factor}`,
    `minterpolate=fps=${rate}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1`,
    `trim=start=${ts(leftOut)}:duration=${ts(outDur)},setpts=PTS-STARTPTS`,
    `format=yuv420p,${EVEN}[v]`
  ].join(',')
}

function copyVideoFilter(fps: number): string {
  return `[0:v]setpts=PTS-STARTPTS,format=yuv420p,${EVEN},fps=${fpsStr(fps)}[v]`
}

function timelineConcatFilter(count: number, hasAudio: boolean, fps: number): string {
  const rate = fpsStr(fps)
  const parts: string[] = []
  for (let i = 0; i < count; i++) {
    parts.push(`[${i}:v]fps=${rate},setpts=PTS-STARTPTS,format=yuv420p[v${i}]`)
    if (hasAudio) {
      parts.push(`[${i}:a]${AFORMAT},asetpts=PTS-STARTPTS[a${i}]`)
    }
  }
  const vcat = Array.from({ length: count }, (_, i) => `[v${i}]`).join('')
  parts.push(`${vcat}concat=n=${count}:v=1:a=0,fps=${rate},setpts=PTS-STARTPTS,format=yuv420p[v]`)
  if (hasAudio) {
    const acat = Array.from({ length: count }, (_, i) => `[a${i}]`).join('')
    parts.push(`${acat}concat=n=${count}:v=0:a=1,${AFORMAT},aresample=async=1:first_pts=0[a]`)
  }
  return parts.join(';')
}

function parallelLimit(encoder: string[]): number {
  const cores = Math.max(1, (os.availableParallelism?.() ?? os.cpus().length) - 1)
  const cap = encoder.includes('h264_nvenc') ? 3 : 4
  return Math.max(1, Math.min(cap, cores))
}

function parallelEncoder(encoder: string[]): string[] {
  if (encoder.includes('libx264') && !encoder.includes('-threads')) {
    return [...encoder, '-threads', '2']
  }
  return encoder
}

class JobPool {
  readonly children = new Set<ChildProcess>()

  kill(): void {
    for (const child of this.children) {
      try {
        child.kill()
      } catch {
        /* already gone */
      }
    }
    this.children.clear()
  }

  run(args: string[], onTime?: (seconds: number) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!FFMPEG) return reject(new Error('ffmpeg is not available'))
      const child = spawn(FFMPEG, args, { windowsHide: true })
      this.children.add(child)
      try {
        if (child.pid) os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL)
      } catch {
        /* best-effort */
      }
      let stderr = ''
      child.stderr.on('data', (chunk) => (stderr = (stderr + chunk).slice(-8000)))
      child.stdout?.on('data', (chunk) => {
        if (!onTime) return
        const text = String(chunk)
        const us = /out_time_us=(\d+)/.exec(text)
        const ms = /out_time_ms=(\d+)/.exec(text)
        if (us) onTime(Number(us[1]) / 1_000_000)
        else if (ms) onTime(Number(ms[1]) / 1_000)
      })
      child.on('error', (err) => {
        this.children.delete(child)
        reject(err)
      })
      child.on('close', (code) => {
        this.children.delete(child)
        if (code === 0) resolve()
        else reject(new Error(stderr.trim() || `ffmpeg exited ${code}`))
      })
    })
  }
}

async function mapPool<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  if (items.length === 0) return
  let next = 0
  let firstError: Error | null = null
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (!firstError) {
      const index = next++
      if (index >= items.length) return
      try {
        await worker(items[index], index)
      } catch (err) {
        firstError = err as Error
        return
      }
    }
  })
  await Promise.all(runners)
  if (firstError) throw firstError
}

function step(
  id: string,
  label: string,
  state: DilationProgressStep['state'] = 'pending'
): DilationProgressStep {
  return { id, label, state }
}

export async function encodeDilatedFile(options: {
  source: string
  dest: string
  regions: DilateRegion[]
  duration: number
  hasAudio: boolean
  fps: number
  interpolate: boolean
  onProgress: (progress: DilationProgress) => void
}): Promise<void> {
  const encoder = await h264EncodeArgs()
  if (!options.interpolate) {
    await encodeLegacy({ ...options, encoder })
    return
  }
  await encodeParallel({ ...options, encoder })
}

async function encodeLegacy(options: {
  source: string
  dest: string
  regions: DilateRegion[]
  duration: number
  hasAudio: boolean
  fps: number
  encoder: string[]
  onProgress: (progress: DilationProgress) => void
}): Promise<void> {
  const steps = [
    step('encode', 'Encoding the slowed clip', 'active'),
    step('save', 'Saving', 'pending')
  ]
  const emit = (percent: number, detail: string) =>
    options.onProgress({
      title: 'Saving time dilation',
      detail,
      percent,
      current: 0,
      total: 0,
      steps: steps.map((entry) => ({ ...entry }))
    })
  emit(0.04, 'Starting ffmpeg…')
  const outDur =
    options.duration +
    options.regions.reduce((sum, region) => sum + (region.end - region.start) * (region.factor - 1), 0)
  const pool = new JobPool()
  try {
    await pool.run(
      [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-progress',
        'pipe:1',
        '-i',
        options.source,
        '-filter_complex',
        dilationFilter(options.regions, options.duration, options.hasAudio, options.fps, false),
        '-map',
        '[outv]',
        ...(options.hasAudio ? ['-map', '[outa]'] : ['-an']),
        ...options.encoder,
        '-pix_fmt',
        'yuv420p',
        ...(options.hasAudio ? AAC : []),
        '-movflags',
        '+faststart',
        options.dest
      ],
      (seconds) => {
        const ratio = outDur > 0 ? Math.min(0.96, seconds / outDur) : 0
        emit(0.04 + ratio * 0.9, 'Encoding the slowed clip…')
      }
    )
  } catch (err) {
    pool.kill()
    throw err
  }
  steps[0].state = 'done'
  steps[1].state = 'done'
  emit(1, 'Saved')
}

async function encodeParallel(options: {
  source: string
  dest: string
  regions: DilateRegion[]
  duration: number
  hasAudio: boolean
  fps: number
  encoder: string[]
  interpolate?: boolean
  onProgress: (progress: DilationProgress) => void
}): Promise<void> {
  const segs = timeline(options.regions, options.duration)
  const pad = Math.min(1, Math.max(READ_PAD, 20 / options.fps))
  const work = path.join(os.tmpdir(), `goon-dilate-${randomUUID()}`)
  await fs.mkdir(work, { recursive: true })

  const steps = [
    step('read', 'Reading the video', 'active'),
    step('prep', 'Splitting into parallel jobs', 'pending'),
    step('interp', 'Interpolating frames', 'pending'),
    step('copy', 'Encoding the rest of the clip', 'pending'),
    step('stitch', 'Stitching the pieces together', 'pending'),
    step('save', 'Saving', 'pending')
  ]
  const find = (id: string) => steps.find((entry) => entry.id === id)!
  let interpDone = 0
  const interpJobs: { chunk: InterpChunk; dest: string; factor: number; span: number }[] = []
  const copySegs: { seg: DilateRegion; dest: string }[] = []
  const spanChunks = new Map<number, { files: string[]; outDur: number; dest: string; seg: DilateRegion }>()
  const timelineFiles: string[] = []

  const emit = (percent: number, detail: string) => {
    options.onProgress({
      title: 'Interpolating frames',
      detail,
      percent: Math.min(1, Math.max(0, percent)),
      current: interpDone,
      total: interpJobs.length,
      steps: steps.map((entry) => ({ ...entry }))
    })
  }

  const pool = new JobPool()
  const encoder = parallelEncoder(options.encoder)
  const limit = parallelLimit(options.encoder)

  try {
    emit(0.02, 'Reading the video…')
    find('read').state = 'done'
    find('prep').state = 'active'
    emit(0.04, 'Planning interpolation jobs…')

    segs.forEach((seg, index) => {
      const dest = path.join(work, `seg-${String(index).padStart(3, '0')}.mp4`)
      timelineFiles.push(dest)
      if (seg.factor === 1) {
        copySegs.push({ seg, dest })
        return
      }
      const pieces = splitSpan(seg.start, seg.end, options.duration, pad)
      const files = pieces.map((_, piece) =>
        path.join(work, `span-${index}-c${String(piece).padStart(3, '0')}.mp4`)
      )
      pieces.forEach((chunk, piece) =>
        interpJobs.push({ chunk, dest: files[piece], factor: seg.factor, span: index })
      )
      spanChunks.set(index, {
        files,
        outDur: (seg.end - seg.start) * seg.factor,
        dest,
        seg
      })
    })

    if (copySegs.length === 0) {
      const idx = steps.findIndex((entry) => entry.id === 'copy')
      if (idx >= 0) steps.splice(idx, 1)
    }

    find('prep').state = 'done'
    find('interp').state = 'active'
    emit(
      0.06,
      interpJobs.length <= 1
        ? 'Interpolating the slowed span…'
        : `Interpolating 0 of ${interpJobs.length} pieces…`
    )

    await mapPool(interpJobs, limit, async (job) => {
      const outDur = (job.chunk.keepEnd - job.chunk.keepStart) * job.factor
      const audio =
        options.hasAudio
          ? spanAudioFilter(
              {
                start: job.chunk.keepStart - job.chunk.readStart,
                end: job.chunk.keepEnd - job.chunk.readStart,
                factor: job.factor
              },
              outDur
            )
          : ''
      const graph = audio
        ? `${slowVideoFilter(job.chunk, job.factor, options.fps)};${audio}`
        : slowVideoFilter(job.chunk, job.factor, options.fps)
      await pool.run([
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-progress',
        'pipe:1',
        ...clipInput(options.source, job.chunk.readStart, job.chunk.readEnd - job.chunk.readStart),
        '-filter_complex',
        graph,
        '-map',
        '[v]',
        ...(options.hasAudio ? ['-map', '[a]', ...AAC] : ['-an']),
        ...encoder,
        '-pix_fmt',
        'yuv420p',
        '-r',
        fpsStr(options.fps),
        '-t',
        ts(outDur),
        job.dest
      ])
      interpDone++
      emit(
        0.06 + (interpJobs.length ? (interpDone / interpJobs.length) * 0.7 : 0.7),
        `Interpolating ${interpDone} of ${interpJobs.length} pieces…`
      )
    })
    find('interp').state = 'done'

    const copyStep = steps.find((entry) => entry.id === 'copy')
    if (copyStep) copyStep.state = 'active'
    emit(0.78, copySegs.length > 0 ? 'Encoding the unstretched parts…' : 'Interpolation finished')

    await mapPool(copySegs, limit, async (job) => {
      const outDur = job.seg.end - job.seg.start
      const graph = options.hasAudio
        ? `${copyVideoFilter(options.fps)};${spanAudioFilter({ start: 0, end: outDur, factor: 1 }, outDur)}`
        : copyVideoFilter(options.fps)
      await pool.run([
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        ...clipInput(options.source, job.seg.start, outDur),
        '-filter_complex',
        graph,
        '-map',
        '[v]',
        ...(options.hasAudio ? ['-map', '[a]', ...AAC] : ['-an']),
        ...encoder,
        '-pix_fmt',
        'yuv420p',
        '-r',
        fpsStr(options.fps),
        '-t',
        ts(outDur),
        job.dest
      ])
    })
    if (copyStep) copyStep.state = 'done'

    find('stitch').state = 'active'
    emit(0.88, 'Stitching the pieces together…')

    for (const span of spanChunks.values()) {
      if (span.files.length === 1) {
        await fs.rename(span.files[0], span.dest)
        continue
      }
      const n = span.files.length
      await pool.run([
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        ...span.files.flatMap((file) => ['-i', file]),
        '-filter_complex',
        timelineConcatFilter(n, options.hasAudio, options.fps),
        '-map',
        '[v]',
        ...(options.hasAudio ? ['-map', '[a]', ...AAC] : ['-an']),
        ...encoder,
        '-pix_fmt',
        'yuv420p',
        '-r',
        fpsStr(options.fps),
        '-t',
        ts(span.outDur),
        span.dest
      ])
    }

    await pool.run([
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      ...timelineFiles.flatMap((file) => ['-i', file]),
      '-filter_complex',
      timelineConcatFilter(timelineFiles.length, options.hasAudio, options.fps),
      '-map',
      '[v]',
      ...(options.hasAudio ? ['-map', '[a]', ...AAC] : ['-an']),
      ...options.encoder,
      '-pix_fmt',
      'yuv420p',
      '-r',
      fpsStr(options.fps),
      ...(options.hasAudio ? AAC : []),
      '-movflags',
      '+faststart',
      options.dest
    ])
    find('stitch').state = 'done'
    find('save').state = 'done'
    emit(1, 'Saved')
  } catch (err) {
    pool.kill()
    throw err
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => {})
  }
}
