import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { MediaType, ThumbReadyEvent } from '../shared/types'
import { FFMPEG, parseMediaInfo, runFfmpegRaw } from './previews'

export const THUMB_FOLDER = '.mediamanager/thumbs'
const THUMB_SIZE = 512
const CONCURRENCY = 3

export interface ThumbJob {
  id: string
  source: string
  type: MediaType
}

const SCALE = `scale='min(${THUMB_SIZE},iw)':-2`

/**
 * Small JPEG stills for the library grid and pickers, so cards never decode original files.
 */
export class ThumbManager {
  private readonly ready = new Set<string>()
  private queue: ThumbJob[] = []
  private readonly queued = new Set<string>()
  private readonly forgotten = new Set<string>()
  private active = 0

  constructor(
    private readonly root: string,
    private readonly onProgress: (event: ThumbReadyEvent) => void
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
    return path.join(this.root, ...THUMB_FOLDER.split('/'))
  }

  pathFor(id: string): string {
    return path.join(this.dir, `${id}.jpg`)
  }

  async load(knownIds: Set<string>): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true })
    for (const file of await fs.readdir(this.dir)) {
      const id = path.basename(file, '.jpg')
      if (file.endsWith('.jpg') && knownIds.has(id)) this.ready.add(id)
      else await fs.rm(path.join(this.dir, file), { force: true })
    }
  }

  async forget(ids: Iterable<string>): Promise<void> {
    const drop = new Set(ids)
    this.queue = this.queue.filter((job) => !drop.has(job.id))
    for (const id of drop) {
      this.forgotten.add(id)
      this.ready.delete(id)
      this.queued.delete(id)
      await fs.rm(this.pathFor(id), { force: true })
      await fs.rm(path.join(this.dir, `${id}.tmp.jpg`), { force: true })
    }
  }

  enqueue(jobs: ThumbJob[]): void {
    if (!this.available) return
    const before = this.remaining
    for (const job of jobs) {
      if (this.ready.has(job.id) || this.queued.has(job.id)) continue
      this.queued.add(job.id)
      this.queue.push(job)
    }
    if (this.remaining !== before) this.onProgress({ id: null, remaining: this.remaining })
    this.pump()
  }

  /** Move still-queued ids to the front so on-screen cards finish first. */
  prioritize(ids: string[]): void {
    if (ids.length === 0) return
    const want = new Set(ids)
    const bump: ThumbJob[] = []
    this.queue = this.queue.filter((job) => {
      if (!want.has(job.id)) return true
      bump.push(job)
      return false
    })
    if (bump.length === 0) return
    this.queue.unshift(...bump)
    this.pump()
  }

  private pump(): void {
    while (this.active < CONCURRENCY && this.queue.length > 0) {
      const job = this.queue.shift()!
      this.active++
      this.generate(job).finally(() => {
        this.active--
        this.queued.delete(job.id)
        this.pump()
      })
    }
  }

  private async generate(job: ThumbJob): Promise<void> {
    if (this.forgotten.has(job.id)) {
      this.forgotten.delete(job.id)
      this.onProgress({ id: null, remaining: this.remaining - 1 })
      return
    }
    await fs.mkdir(this.dir, { recursive: true })
    const temp = path.join(this.dir, `${job.id}.tmp.jpg`)
    const result = await extractThumb(job.source, temp, job.type)
    if (!result.ok) {
      await fs.rm(temp, { force: true })
      this.onProgress({ id: null, remaining: this.remaining - 1 })
      return
    }
    if (this.forgotten.has(job.id)) {
      await fs.rm(temp, { force: true })
      this.forgotten.delete(job.id)
      this.onProgress({ id: null, remaining: this.remaining - 1 })
      return
    }
    await fs.rename(temp, this.pathFor(job.id))
    this.ready.add(job.id)
    const info = parseMediaInfo(result.stderr)
    this.onProgress({
      id: job.id,
      remaining: this.remaining - 1,
      duration: info.duration > 0 ? info.duration : undefined,
      width: info.width > 0 ? info.width : undefined,
      height: info.height > 0 ? info.height : undefined
    })
  }
}

async function extractThumb(
  source: string,
  dest: string,
  type: MediaType
): Promise<{ ok: boolean; stderr: string }> {
  const probe = ['-y', '-hide_banner', '-analyzeduration', '100M', '-probesize', '100M']
  const out = ['-frames:v', '1', '-an', '-q:v', '5', dest]
  const attempts =
    type === 'image'
      ? [[...probe, '-i', source, '-vf', SCALE, ...out]]
      : [
          [...probe, '-i', source, '-vf', `thumbnail,${SCALE}`, ...out],
          [...probe, '-ss', '1', '-i', source, '-vf', SCALE, ...out],
          [...probe, '-i', source, '-ss', '0.5', '-vf', SCALE, ...out],
          [...probe, '-fflags', '+genpts+igndts', '-i', source, '-vf', SCALE, ...out]
        ]
  let stderr = ''
  for (const args of attempts) {
    const result = await runFfmpegRaw(args)
    stderr = result.stderr
    if (!result.ok) continue
    try {
      if ((await fs.stat(dest)).size > 64) return result
    } catch {
      /* try the next probe */
    }
  }
  return { ok: false, stderr }
}
