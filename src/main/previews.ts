import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ffmpegStatic from 'ffmpeg-static'

// In a packaged app the binary is unpacked next to the asar archive.
export const FFMPEG = ffmpegStatic?.replace('app.asar', 'app.asar.unpacked') ?? null

export const PREVIEW_FOLDER = '.mediamanager/previews'
/** Short side of preview videos, in pixels. */
const PREVIEW_SIZE = 540
const CONCURRENCY = 2

/** Encoder arguments, fastest first. Hardware encoders are tried and dropped if unavailable. */
const ENCODERS: { name: string; args: string[] }[] = [
  { name: 'h264_nvenc', args: ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq', '28', '-b:v', '0'] },
  { name: 'h264_qsv', args: ['-c:v', 'h264_qsv', '-preset', 'faster', '-global_quality', '28'] },
  { name: 'h264_amf', args: ['-c:v', 'h264_amf', '-quality', 'speed', '-rc', 'cqp', '-qp_i', '26', '-qp_p', '28'] },
  { name: 'libx264', args: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26'] }
]

export async function runFfmpeg(args: string[]): Promise<void> {
  const result = await run(args)
  if (!result.ok) throw new Error(result.stderr.trim() || 'ffmpeg failed')
}

/** Reads duration, fps, and whether an audio stream exists from ffmpeg's file probe. */
export async function probeVideo(
  source: string
): Promise<{ duration: number; hasAudio: boolean; fps: number }> {
  const result = await run(['-hide_banner', '-i', source])
  const match = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(result.stderr)
  const duration = match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : 0
  const fpsMatch = /(\d+(?:\.\d+)?)\s*fps/.exec(result.stderr)
  const tbrMatch = /(\d+(?:\.\d+)?)\s*tbr/.exec(result.stderr)
  let fps = Number(fpsMatch?.[1] ?? tbrMatch?.[1] ?? 30)
  if (!Number.isFinite(fps) || fps < 1 || fps > 120) fps = 30
  return { duration, hasAudio: /Audio:/.test(result.stderr), fps }
}

function run(args: string[]): Promise<{ ok: boolean; stderr: string }> {
  return new Promise((resolve) => {
    if (!FFMPEG) return resolve({ ok: false, stderr: 'ffmpeg is not available' })
    const child = spawn(FFMPEG, args, { windowsHide: true })
    try {
      if (child.pid) os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL)
    } catch {
      // Priority is best-effort.
    }
    let stderr = ''
    child.stderr.on('data', (chunk) => (stderr = (stderr + chunk).slice(-12000)))
    child.on('error', (err) => resolve({ ok: false, stderr: err.message }))
    child.on('close', (code) => resolve({ ok: code === 0, stderr }))
  })
}

let encoderPromise: Promise<string[]> | null = null

/** Picks the first encoder that can actually encode on this machine (e.g. NVENC needs an NVIDIA GPU). */
export function h264EncodeArgs(): Promise<string[]> {
  return detectEncoder()
}

function detectEncoder(): Promise<string[]> {
  encoderPromise ??= (async () => {
    for (const encoder of ENCODERS.slice(0, -1)) {
      const probe = await run([
        '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', 'color=black:s=320x240:d=0.2',
        ...encoder.args, '-f', 'null', '-'
      ])
      if (probe.ok) {
        console.log(`[previews] using ${encoder.name}`)
        return encoder.args
      }
    }
    console.log('[previews] using libx264 (no hardware encoder available)')
    return ENCODERS[ENCODERS.length - 1].args
  })()
  return encoderPromise
}

/**
 * Generates small, seek-friendly copies of videos for the Scroller, which may play dozens
 * of videos at once: decoding many full-resolution streams overwhelms even fast GPUs.
 */
export class PreviewManager {
  private readonly ready = new Set<string>()
  private readonly queue: { id: string; source: string }[] = []
  private readonly queued = new Set<string>()
  /** Videos dropped from the library while an encode may still be running. */
  private readonly forgotten = new Set<string>()
  private active = 0

  constructor(
    private readonly root: string,
    /** Called with the finished video's id, or `null` when only the queue length changed. */
    private readonly onProgress: (id: string | null, remaining: number) => void
  ) {}

  get available(): boolean {
    return FFMPEG !== null
  }

  get readyIds(): string[] {
    return [...this.ready]
  }

  get remaining(): number {
    return this.queue.length + this.active
  }

  private get dir(): string {
    return path.join(this.root, ...PREVIEW_FOLDER.split('/'))
  }

  /** Records existing previews and deletes those whose video is no longer in the library. */
  async load(knownIds: Set<string>): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true })
    for (const file of await fs.readdir(this.dir)) {
      const id = path.basename(file, '.mp4')
      if (file.endsWith('.mp4') && knownIds.has(id)) this.ready.add(id)
      else await fs.rm(path.join(this.dir, file), { force: true })
    }
  }

  /** Drops preview files and forgets the ids so an in-flight encode will not put them back. */
  async forget(ids: Iterable<string>): Promise<void> {
    const drop = new Set(ids)
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (drop.has(this.queue[i].id)) this.queue.splice(i, 1)
    }
    for (const id of drop) {
      this.forgotten.add(id)
      this.ready.delete(id)
      this.queued.delete(id)
      await fs.rm(path.join(this.dir, `${id}.mp4`), { force: true })
      await fs.rm(path.join(this.dir, `${id}.tmp.mp4`), { force: true })
    }
  }

  enqueue(videos: { id: string; source: string }[]): void {
    if (!this.available) return
    const before = this.remaining
    for (const video of videos) {
      if (this.ready.has(video.id) || this.queued.has(video.id)) continue
      this.queued.add(video.id)
      this.queue.push(video)
    }
    if (this.remaining !== before) this.onProgress(null, this.remaining)
    this.pump()
  }

  private pump(): void {
    while (this.active < CONCURRENCY && this.queue.length > 0) {
      const job = this.queue.shift()!
      this.active++
      this.generate(job.id, job.source).finally(() => {
        this.active--
        this.queued.delete(job.id)
        this.pump()
      })
    }
  }

  private async generate(id: string, source: string): Promise<void> {
    if (this.forgotten.has(id)) {
      this.forgotten.delete(id)
      this.onProgress(null, this.remaining - 1)
      return
    }
    const encoder = await detectEncoder()
    await fs.mkdir(this.dir, { recursive: true })
    const output = path.join(this.dir, `${id}.mp4`)
    const temp = path.join(this.dir, `${id}.tmp.mp4`)
    const short = PREVIEW_SIZE
    const result = await run([
      '-y', '-hide_banner', '-loglevel', 'error',
      '-hwaccel', 'auto',
      '-i', source,
      '-map', '0:v:0', '-map', '0:a:0?',
      // Shrink so the short side is at most PREVIEW_SIZE, keeping the aspect ratio (and rotation).
      '-vf', `scale='if(gt(iw,ih),-2,min(${short},iw))':'if(gt(iw,ih),min(${short},ih),-2)',format=yuv420p`,
      '-fpsmax', '30',
      ...encoder,
      // A keyframe every second keeps random seeks cheap.
      '-g', '30', '-keyint_min', '30',
      '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
      '-movflags', '+faststart',
      temp
    ])
    if (!result.ok) {
      console.warn(`[previews] failed for ${source}: ${result.stderr.trim()}`)
      await fs.rm(temp, { force: true })
      this.onProgress(null, this.remaining - 1)
      return
    }
    if (this.forgotten.has(id)) {
      await fs.rm(temp, { force: true })
      this.forgotten.delete(id)
      this.onProgress(null, this.remaining - 1)
      return
    }
    await fs.rename(temp, output)
    this.ready.add(id)
    this.onProgress(id, this.remaining - 1)
  }
}
