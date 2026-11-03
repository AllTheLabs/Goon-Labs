import { constants, promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { shell } from 'electron'
import type {
  DeleteResult,
  DilationSpan,
  ExportResult,
  SpliceSpan,
  GifOptions,
  GifQuality,
  ImportResult,
  LibraryState,
  MediaItem,
  MediaType,
  TrimMode
} from '../shared/types'
import { DILATION_FACTORS, GIF_FPS, GIF_QUALITIES } from '../shared/types'
import { mediaTypeOf } from './mediaTypes'
import { FFMPEG, h264EncodeArgs, PreviewManager, probeVideo, runFfmpeg } from './previews'

const DILATION_TAG = 'time dilated'
const DILATION_FACTOR_SET = new Set<number>(DILATION_FACTORS)
const GIF_TAG = 'gif'
const GIF_QUALITY_SET = new Set<string>(GIF_QUALITIES)
const GIF_FPS_SET = new Set<number>(GIF_FPS)
const GIF_PRESETS: Record<GifQuality, { width: number; colors: number; dither: string }> = {
  low: { width: 320, colors: 64, dither: 'bayer:bayer_scale=5' },
  medium: { width: 480, colors: 128, dither: 'bayer:bayer_scale=5' },
  high: { width: 720, colors: 256, dither: 'sierra2_4a' },
  ultra: { width: 1080, colors: 256, dither: 'sierra2_4a' }
}

const MEDIA_FOLDERS: Record<MediaType, string> = {
  image: 'Pictures',
  video: 'Videos'
}
const DATA_FOLDER = '.mediamanager'
const DATABASE_FILE = 'library.json'
const DATABASE_VERSION = 1

interface Database {
  version: number
  items: MediaItem[]
}

export function normalizeTag(tag: string): string {
  return tag.trim().replace(/\s+/g, ' ').toLowerCase()
}

async function trashOrGone(abs: string): Promise<void> {
  try {
    await shell.trashItem(abs)
  } catch (err) {
    try {
      await fs.access(abs)
    } catch {
      return
    }
    throw err
  }
}

function toRelPath(root: string, absPath: string): string {
  return path.relative(root, absPath).split(path.sep).join('/')
}

function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

async function walkFiles(dir: string): Promise<string[]> {
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const files: string[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await walkFiles(full)))
    else if (entry.isFile()) files.push(full)
  }
  return files
}

async function uniqueDest(dir: string, fileName: string): Promise<string> {
  const { name, ext } = path.parse(fileName)
  for (let attempt = 0; ; attempt++) {
    const candidate = path.join(dir, attempt === 0 ? fileName : `${name} (${attempt})${ext}`)
    try {
      await fs.access(candidate)
    } catch {
      return candidate
    }
  }
}

interface DilateRegion {
  start: number
  end: number
  factor: number
}

function normalizeDilationSpans(spans: DilationSpan[]): DilateRegion[] {
  if (!Array.isArray(spans) || spans.length === 0) {
    throw new Error('Add at least one time dilation on the timeline')
  }
  const regions = spans.map((span) => {
    const start = Number(span.start)
    const end = Number(span.end)
    const factor = Number(span.factor)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 0.1) {
      throw new Error('Each time dilation needs to cover at least a tenth of a second')
    }
    if (!DILATION_FACTOR_SET.has(factor)) throw new Error('Time dilation can be 1.5×, 2× or 2.5×')
    return { start: Math.max(0, start), end, factor }
  })
  regions.sort((a, b) => a.start - b.start)
  for (let i = 1; i < regions.length; i++) {
    if (regions[i].start < regions[i - 1].end - 0.001) {
      throw new Error('Time dilations cannot overlap')
    }
  }
  return regions
}

function dilationFilter(
  regions: DilateRegion[],
  duration: number,
  hasAudio: boolean,
  fps: number,
  interpolate: boolean
): string {
  const segs: DilateRegion[] = []
  let cursor = 0
  for (const region of regions) {
    if (region.start > cursor + 0.01) segs.push({ start: cursor, end: region.start, factor: 1 })
    segs.push(region)
    cursor = region.end
  }
  if (duration > cursor + 0.01) segs.push({ start: cursor, end: duration, factor: 1 })
  if (segs.length === 0) throw new Error('Nothing to dilate')

  const ts = (value: number) => value.toFixed(3)
  const fpsStr = String(Number(fps.toFixed(3)))
  const even = 'scale=trunc(iw/2)*2:trunc(ih/2)*2'
  const aformat = 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo'
  const filters: string[] = []
  const concat: string[] = []

  segs.forEach((seg, i) => {
    const trimmed = `[0:v]trim=start=${ts(seg.start)}:end=${ts(seg.end)},setpts=PTS-STARTPTS`
    if (seg.factor !== 1 && interpolate) {
      const hi = Number((fps * seg.factor).toFixed(3))
      filters.push(
        `${trimmed},format=yuv420p,${even},minterpolate=fps=${hi}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,setpts=PTS*${seg.factor},fps=${fpsStr},format=yuv420p[v${i}]`
      )
    } else if (seg.factor !== 1) {
      filters.push(`${trimmed},setpts=PTS*${seg.factor},format=yuv420p,${even},fps=${fpsStr}[v${i}]`)
    } else {
      filters.push(`${trimmed},format=yuv420p,${even},fps=${fpsStr}[v${i}]`)
    }
    concat.push(`[v${i}]`)

    if (!hasAudio) return
    const outDur = (seg.end - seg.start) * seg.factor
    const fade = Math.min(0.05, Math.max(0.01, outDur / 4))
    const fades = `afade=t=in:d=${ts(fade)},afade=t=out:st=${ts(Math.max(0, outDur - fade))}:d=${ts(fade)}`
    const trimmedAudio = `[0:a]atrim=start=${ts(seg.start)}:end=${ts(seg.end)},asetpts=PTS-STARTPTS,${aformat}`
    if (seg.factor !== 1) {
      const tempo = Number((1 / seg.factor).toFixed(4))
      filters.push(
        `${trimmedAudio},rubberband=tempo=${tempo}:pitch=1:transients=smooth:smoothing=on:window=long:formant=preserved,adeclick,asplit=2[ad${i}][aw${i}]`
      )
      filters.push(
        `[aw${i}]aecho=0.8:0.9:52|105|160|220:0.48|0.38|0.3|0.22,lowpass=f=7500[arev${i}]`
      )
      filters.push(
        `[ad${i}][arev${i}]amix=inputs=2:duration=first:dropout_transition=0:normalize=0:weights=0.46\\ 0.72,alimiter=limit=0.96,${fades}[a${i}]`
      )
    } else {
      filters.push(`${trimmedAudio},${fades}[a${i}]`)
    }
    concat.push(`[a${i}]`)
  })

  const audio = hasAudio ? ':a=1[outv][outa]' : ':a=0[outv]'
  filters.push(`${concat.join('')}concat=n=${segs.length}:v=1${audio}`)
  return filters.join(';')
}

interface SpliceRegion {
  start: number
  end: number
}

function normalizeSpliceSpans(spans: SpliceSpan[]): SpliceRegion[] {
  if (!Array.isArray(spans) || spans.length < 2) {
    throw new Error('Add at least two spans on the timeline')
  }
  const regions = spans.map((span) => {
    const start = Number(span.start)
    const end = Number(span.end)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 0.1) {
      throw new Error('Each span needs to cover at least a tenth of a second')
    }
    return { start: Math.max(0, start), end }
  })
  regions.sort((a, b) => a.start - b.start)
  for (let i = 1; i < regions.length; i++) {
    if (regions[i].start < regions[i - 1].end - 0.001) {
      throw new Error('Spans cannot overlap')
    }
  }
  return regions
}

function spliceFilter(regions: SpliceRegion[], hasAudio: boolean, fps: number): string {
  const ts = (value: number) => value.toFixed(3)
  const fpsStr = String(Number(fps.toFixed(3)))
  const even = 'scale=trunc(iw/2)*2:trunc(ih/2)*2'
  const aformat = 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo'
  const filters: string[] = []
  const concat: string[] = []

  regions.forEach((seg, i) => {
    filters.push(
      `[0:v]trim=start=${ts(seg.start)}:end=${ts(seg.end)},setpts=PTS-STARTPTS,format=yuv420p,${even},fps=${fpsStr}[v${i}]`
    )
    concat.push(`[v${i}]`)
    if (!hasAudio) return
    const outDur = seg.end - seg.start
    const fade = Math.min(0.05, Math.max(0.01, outDur / 4))
    const fades = `afade=t=in:d=${ts(fade)},afade=t=out:st=${ts(Math.max(0, outDur - fade))}:d=${ts(fade)}`
    filters.push(
      `[0:a]atrim=start=${ts(seg.start)}:end=${ts(seg.end)},asetpts=PTS-STARTPTS,${aformat},${fades}[a${i}]`
    )
    concat.push(`[a${i}]`)
  })

  const audio = hasAudio ? ':a=1[outv][outa]' : ':a=0[outv]'
  filters.push(`${concat.join('')}concat=n=${regions.length}:v=1${audio}`)
  return filters.join(';')
}

/** Copies `source` into `dir`, appending " (n)" to the name if a file already exists there. */
async function copyWithUniqueName(source: string, dir: string, fileName: string): Promise<string> {
  const { name, ext } = path.parse(fileName)
  for (let attempt = 0; ; attempt++) {
    const candidate = path.join(dir, attempt === 0 ? fileName : `${name} (${attempt})${ext}`)
    try {
      await fs.copyFile(source, candidate, constants.COPYFILE_EXCL)
      return candidate
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    }
  }
}

export class Library {
  private items = new Map<string, MediaItem>()
  private saveQueue: Promise<void> = Promise.resolve()
  private readonly previews: PreviewManager

  private constructor(
    readonly root: string,
    onPreviewProgress: (id: string | null, remaining: number) => void
  ) {
    this.previews = new PreviewManager(root, onPreviewProgress)
  }

  static async open(
    root: string,
    onPreviewProgress: (id: string | null, remaining: number) => void
  ): Promise<Library> {
    const library = new Library(path.resolve(root), onPreviewProgress)
    await library.ensureFolders()
    await library.load()
    await library.sync()
    await library.previews.load(new Set(library.items.keys()))
    library.queuePreviews(library.list())
    return library
  }

  get state(): LibraryState {
    return {
      root: this.root,
      items: this.list(),
      previewIds: this.previews.readyIds,
      previewsPending: this.previews.remaining
    }
  }

  private queuePreviews(items: MediaItem[]): void {
    this.previews.enqueue(
      items
        .filter((item) => item.type === 'video')
        .map((item) => ({ id: item.id, source: path.join(this.root, item.relPath) }))
    )
  }

  list(): MediaItem[] {
    return [...this.items.values()]
  }

  item(id: string): MediaItem | undefined {
    return this.items.get(id)
  }

  /** Resolves a repository-relative path, refusing anything that escapes the repository. */
  resolve(relPath: string): string | null {
    const abs = path.resolve(this.root, relPath)
    return isInside(this.root, abs) ? abs : null
  }

  absolutePathOf(id: string): string | null {
    const item = this.items.get(id)
    return item ? this.resolve(item.relPath) : null
  }

  /** Re-reads the media folders, picking up files added outside the app and dropping missing ones. */
  async sync(): Promise<void> {
    const onDisk = new Set<string>()
    for (const folder of Object.values(MEDIA_FOLDERS)) {
      for (const file of await walkFiles(path.join(this.root, folder))) {
        if (mediaTypeOf(file)) onDisk.add(toRelPath(this.root, file))
      }
    }

    let changed = false
    const known = new Set<string>()
    for (const item of this.items.values()) {
      if (onDisk.has(item.relPath)) {
        known.add(item.relPath)
      } else {
        this.items.delete(item.id)
        changed = true
      }
    }

    const added: MediaItem[] = []
    for (const relPath of onDisk) {
      if (known.has(relPath)) continue
      const abs = path.join(this.root, relPath)
      const stat = await fs.stat(abs)
      const item: MediaItem = {
        id: randomUUID(),
        fileName: path.basename(abs),
        relPath,
        type: mediaTypeOf(abs)!,
        size: stat.size,
        importedAt: stat.birthtime.toISOString(),
        tags: []
      }
      this.items.set(item.id, item)
      added.push(item)
      changed = true
    }

    if (changed) await this.save()
    this.queuePreviews(added)
  }

  /** Copies files (and the media inside any folders) into the Pictures/Videos folders based on extension. */
  async importPaths(paths: string[]): Promise<ImportResult> {
    const result: ImportResult = { imported: [], skipped: [] }

    const files: string[] = []
    for (const p of paths) {
      try {
        const stat = await fs.stat(p)
        if (stat.isDirectory()) files.push(...(await walkFiles(p)))
        else files.push(p)
      } catch {
        result.skipped.push({ path: p, reason: 'File could not be read' })
      }
    }

    for (const file of files) {
      const type = mediaTypeOf(file)
      if (!type) {
        result.skipped.push({ path: file, reason: 'Unsupported file type' })
        continue
      }
      if (isInside(this.root, file)) {
        result.skipped.push({ path: file, reason: 'Already in the repository' })
        continue
      }
      try {
        const dest = await copyWithUniqueName(
          file,
          path.join(this.root, MEDIA_FOLDERS[type]),
          path.basename(file)
        )
        const stat = await fs.stat(dest)
        const item: MediaItem = {
          id: randomUUID(),
          fileName: path.basename(dest),
          relPath: toRelPath(this.root, dest),
          type,
          size: stat.size,
          importedAt: new Date().toISOString(),
          tags: []
        }
        this.items.set(item.id, item)
        result.imported.push(item)
      } catch (err) {
        result.skipped.push({ path: file, reason: (err as Error).message })
      }
    }

    if (result.imported.length > 0) await this.save()
    this.queuePreviews(result.imported)
    return result
  }

  /**
   * Cuts `start`–`end` (seconds) from a video. `new` writes a sibling file and copies tags;
   * `replace` overwrites the original and keeps the same library id and tags.
   */
  async trimVideo(
    id: string,
    start: number,
    end: number,
    mode: 'new' | 'replace'
  ): Promise<{ item: MediaItem; replaced: boolean }> {
    const item = this.items.get(id)
    if (!item || item.type !== 'video') throw new Error('Pick a video from the library')
    const source = this.absolutePathOf(id)
    if (!source) throw new Error('The video file is missing')
    if (!FFMPEG) throw new Error('ffmpeg is not available')
    if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 0.1) {
      throw new Error('The trimmed range is too short')
    }

    const encoder = await h264EncodeArgs()
    const dir = path.dirname(source)
    const stem = path.parse(item.fileName).name
    const duration = (end - start).toFixed(3)

    const encodeTo = async (dest: string) => {
      await runFfmpeg([
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        source,
        '-ss',
        Math.max(0, start).toFixed(3),
        '-t',
        duration,
        '-map',
        '0:v:0',
        '-map',
        '0:a:0?',
        ...encoder,
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-ac',
        '2',
        '-movflags',
        '+faststart',
        dest
      ])
    }

    if (mode === 'new') {
      const dest = await uniqueDest(dir, `${stem} (trimmed).mp4`)
      try {
        await encodeTo(dest)
      } catch (err) {
        await fs.rm(dest, { force: true })
        throw err
      }
      const stat = await fs.stat(dest)
      const next: MediaItem = {
        id: randomUUID(),
        fileName: path.basename(dest),
        relPath: toRelPath(this.root, dest),
        type: 'video',
        size: stat.size,
        importedAt: new Date().toISOString(),
        tags: [...item.tags]
      }
      this.items.set(next.id, next)
      await this.save()
      this.queuePreviews([next])
      return { item: next, replaced: false }
    }

    const temp = await uniqueDest(dir, `${stem}.trim.tmp.mp4`)
    try {
      await encodeTo(temp)
    } catch (err) {
      await fs.rm(temp, { force: true })
      throw err
    }
    const finalPath = source.toLowerCase().endsWith('.mp4') ? source : await uniqueDest(dir, `${stem}.mp4`)
    try {
      await fs.rm(source)
      await fs.rename(temp, finalPath)
    } catch (err) {
      await fs.rm(temp, { force: true })
      throw new Error(
        `Could not replace the original (${(err as Error).message}). Save as a new video instead.`
      )
    }

    const stat = await fs.stat(finalPath)
    item.fileName = path.basename(finalPath)
    item.relPath = toRelPath(this.root, finalPath)
    item.size = stat.size
    item.importedAt = new Date().toISOString()
    await this.save()
    await this.previews.forget([item.id])
    this.queuePreviews([item])
    return { item, replaced: true }
  }

  /**
   * Stretches chosen spans of a video (and its audio) by 1.5× / 2× / 2.5×.
   * `new` writes a sibling file; `replace` overwrites the original. Both keep
   * the original tags and add `time dilated`.
   */
  async dilateVideo(
    id: string,
    spans: DilationSpan[],
    mode: TrimMode,
    interpolate = false
  ): Promise<{ item: MediaItem; replaced: boolean }> {
    const item = this.items.get(id)
    if (!item || item.type !== 'video') throw new Error('Pick a video from the library')
    const source = this.absolutePathOf(id)
    if (!source) throw new Error('The video file is missing')
    if (!FFMPEG) throw new Error('ffmpeg is not available')

    const regions = normalizeDilationSpans(spans)
    const { duration, hasAudio, fps } = await probeVideo(source)
    if (!Number.isFinite(duration) || duration < 0.1) throw new Error('Could not read that video')
    for (const region of regions) {
      region.start = Math.min(region.start, duration)
      region.end = Math.min(region.end, duration)
      if (region.end - region.start < 0.1) {
        throw new Error('A time dilation sits past the end of the video')
      }
    }

    const encoder = await h264EncodeArgs()
    const dir = path.dirname(source)
    const stem = path.parse(item.fileName).name
    const tags = [...new Set([...item.tags, normalizeTag(DILATION_TAG)])].sort()

    const encodeTo = async (dest: string) => {
      await runFfmpeg([
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        source,
        '-filter_complex',
        dilationFilter(regions, duration, hasAudio, fps, Boolean(interpolate)),
        '-map',
        '[outv]',
        ...(hasAudio ? ['-map', '[outa]'] : ['-an']),
        ...encoder,
        '-pix_fmt',
        'yuv420p',
        ...(hasAudio ? ['-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-ar', '48000'] : []),
        '-movflags',
        '+faststart',
        dest
      ])
    }

    if (mode === 'new') {
      const dest = await uniqueDest(dir, `${stem} (time dilated).mp4`)
      try {
        await encodeTo(dest)
      } catch (err) {
        await fs.rm(dest, { force: true })
        throw err
      }
      const stat = await fs.stat(dest)
      const next: MediaItem = {
        id: randomUUID(),
        fileName: path.basename(dest),
        relPath: toRelPath(this.root, dest),
        type: 'video',
        size: stat.size,
        importedAt: new Date().toISOString(),
        tags
      }
      this.items.set(next.id, next)
      await this.save()
      this.queuePreviews([next])
      return { item: next, replaced: false }
    }

    const temp = await uniqueDest(dir, `${stem}.dilate.tmp.mp4`)
    try {
      await encodeTo(temp)
    } catch (err) {
      await fs.rm(temp, { force: true })
      throw err
    }
    const finalPath = source.toLowerCase().endsWith('.mp4') ? source : await uniqueDest(dir, `${stem}.mp4`)
    try {
      await fs.rm(source)
      await fs.rename(temp, finalPath)
    } catch (err) {
      await fs.rm(temp, { force: true })
      throw new Error(
        `Could not replace the original (${(err as Error).message}). Save as a new video instead.`
      )
    }

    const stat = await fs.stat(finalPath)
    item.fileName = path.basename(finalPath)
    item.relPath = toRelPath(this.root, finalPath)
    item.size = stat.size
    item.importedAt = new Date().toISOString()
    item.tags = tags
    await this.save()
    await this.previews.forget([item.id])
    this.queuePreviews([item])
    return { item, replaced: true }
  }

  /**
   * Keeps only the marked spans and stitches them in timeline order.
   * `new` writes a sibling file; `replace` overwrites the original. Both keep
   * the original tags.
   */
  async spliceVideo(
    id: string,
    spans: SpliceSpan[],
    mode: TrimMode
  ): Promise<{ item: MediaItem; replaced: boolean }> {
    const item = this.items.get(id)
    if (!item || item.type !== 'video') throw new Error('Pick a video from the library')
    const source = this.absolutePathOf(id)
    if (!source) throw new Error('The video file is missing')
    if (!FFMPEG) throw new Error('ffmpeg is not available')

    const regions = normalizeSpliceSpans(spans)
    const { duration, hasAudio, fps } = await probeVideo(source)
    if (!Number.isFinite(duration) || duration < 0.1) throw new Error('Could not read that video')
    for (const region of regions) {
      region.start = Math.min(region.start, duration)
      region.end = Math.min(region.end, duration)
      if (region.end - region.start < 0.1) {
        throw new Error('A span sits past the end of the video')
      }
    }

    const encoder = await h264EncodeArgs()
    const dir = path.dirname(source)
    const stem = path.parse(item.fileName).name

    const encodeTo = async (dest: string) => {
      await runFfmpeg([
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        source,
        '-filter_complex',
        spliceFilter(regions, hasAudio, fps),
        '-map',
        '[outv]',
        ...(hasAudio ? ['-map', '[outa]'] : ['-an']),
        ...encoder,
        '-pix_fmt',
        'yuv420p',
        ...(hasAudio ? ['-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-ar', '48000'] : []),
        '-movflags',
        '+faststart',
        dest
      ])
    }

    if (mode === 'new') {
      const dest = await uniqueDest(dir, `${stem} (spliced).mp4`)
      try {
        await encodeTo(dest)
      } catch (err) {
        await fs.rm(dest, { force: true })
        throw err
      }
      const stat = await fs.stat(dest)
      const next: MediaItem = {
        id: randomUUID(),
        fileName: path.basename(dest),
        relPath: toRelPath(this.root, dest),
        type: 'video',
        size: stat.size,
        importedAt: new Date().toISOString(),
        tags: [...item.tags]
      }
      this.items.set(next.id, next)
      await this.save()
      this.queuePreviews([next])
      return { item: next, replaced: false }
    }

    const temp = await uniqueDest(dir, `${stem}.splice.tmp.mp4`)
    try {
      await encodeTo(temp)
    } catch (err) {
      await fs.rm(temp, { force: true })
      throw err
    }
    const finalPath = source.toLowerCase().endsWith('.mp4') ? source : await uniqueDest(dir, `${stem}.mp4`)
    try {
      await fs.rm(source)
      await fs.rename(temp, finalPath)
    } catch (err) {
      await fs.rm(temp, { force: true })
      throw new Error(
        `Could not replace the original (${(err as Error).message}). Save as a new video instead.`
      )
    }

    const stat = await fs.stat(finalPath)
    item.fileName = path.basename(finalPath)
    item.relPath = toRelPath(this.root, finalPath)
    item.size = stat.size
    item.importedAt = new Date().toISOString()
    await this.save()
    await this.previews.forget([item.id])
    this.queuePreviews([item])
    return { item, replaced: true }
  }

  /**
   * Encodes `start`–`end` of a video as a GIF. `new` writes into Pictures/;
   * `replace` swaps the library item for that GIF. Tags are copied and `gif` is added.
   */
  async makeGif(
    id: string,
    start: number,
    end: number,
    options: GifOptions,
    mode: TrimMode
  ): Promise<{ item: MediaItem; replaced: boolean }> {
    const item = this.items.get(id)
    if (!item || item.type !== 'video') throw new Error('Pick a video from the library')
    const source = this.absolutePathOf(id)
    if (!source) throw new Error('The video file is missing')
    if (!FFMPEG) throw new Error('ffmpeg is not available')
    if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 0.1) {
      throw new Error('The GIF range is too short')
    }
    if (end - start > 60) throw new Error('Keep the GIF under 60 seconds or it will be huge')

    const quality = options?.quality
    const fps = Number(options?.fps)
    if (!quality || !GIF_QUALITY_SET.has(quality)) throw new Error('Pick a GIF quality')
    if (!GIF_FPS_SET.has(fps)) throw new Error('Pick a GIF frame rate')
    const preset = GIF_PRESETS[quality]
    const loop = Boolean(options?.loop)
    const duration = (end - start).toFixed(3)
    const filter =
      `fps=${fps},scale='min(${preset.width}\\,iw)':-2:flags=lanczos,split[s0][s1];` +
      `[s0]palettegen=max_colors=${preset.colors}:stats_mode=diff[p];` +
      `[s1][p]paletteuse=dither=${preset.dither}:diff_mode=rectangle`

    const pictures = path.join(this.root, MEDIA_FOLDERS.image)
    await fs.mkdir(pictures, { recursive: true })
    const stem = path.parse(item.fileName).name
    const tags = [...new Set([...item.tags, normalizeTag(GIF_TAG)])].sort()

    const encodeTo = async (dest: string) => {
      await runFfmpeg([
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-ss',
        Math.max(0, start).toFixed(3),
        '-t',
        duration,
        '-i',
        source,
        '-filter_complex',
        filter,
        '-loop',
        loop ? '0' : '-1',
        dest
      ])
    }

    if (mode === 'new') {
      const dest = await uniqueDest(pictures, `${stem}.gif`)
      try {
        await encodeTo(dest)
      } catch (err) {
        await fs.rm(dest, { force: true })
        throw err
      }
      const stat = await fs.stat(dest)
      const next: MediaItem = {
        id: randomUUID(),
        fileName: path.basename(dest),
        relPath: toRelPath(this.root, dest),
        type: 'image',
        size: stat.size,
        importedAt: new Date().toISOString(),
        tags
      }
      this.items.set(next.id, next)
      await this.save()
      return { item: next, replaced: false }
    }

    const dest = await uniqueDest(pictures, `${stem}.gif`)
    try {
      await encodeTo(dest)
    } catch (err) {
      await fs.rm(dest, { force: true })
      throw err
    }
    try {
      if (path.resolve(source) !== path.resolve(dest)) await fs.rm(source)
    } catch (err) {
      await fs.rm(dest, { force: true })
      throw new Error(
        `Could not replace the original (${(err as Error).message}). Save as a new GIF instead.`
      )
    }

    const stat = await fs.stat(dest)
    item.fileName = path.basename(dest)
    item.relPath = toRelPath(this.root, dest)
    item.type = 'image'
    item.size = stat.size
    item.importedAt = new Date().toISOString()
    item.tags = tags
    await this.save()
    await this.previews.forget([item.id])
    return { item, replaced: true }
  }

  async addTags(ids: string[], tags: string[]): Promise<MediaItem[]> {
    const normalized = tags.map(normalizeTag).filter(Boolean)
    return this.updateTags(ids, (current) => [...new Set([...current, ...normalized])].sort())
  }

  async removeTag(ids: string[], tag: string): Promise<MediaItem[]> {
    const normalized = normalizeTag(tag)
    return this.updateTags(ids, (current) => current.filter((t) => t !== normalized))
  }

  /**
   * Moves the files to the Recycle Bin, drops their preview copies, and removes them from the
   * library. Missing files are treated as already gone.
   */
  async deleteItems(ids: string[]): Promise<DeleteResult> {
    const result: DeleteResult = { deletedIds: [], failed: [] }
    for (const id of ids) {
      const item = this.items.get(id)
      if (!item) continue
      const source = this.absolutePathOf(id)
      try {
        if (source) await trashOrGone(source)
        this.items.delete(id)
        result.deletedIds.push(id)
      } catch (err) {
        result.failed.push({ fileName: item.fileName, reason: (err as Error).message })
      }
    }
    if (result.deletedIds.length > 0) {
      await this.previews.forget(result.deletedIds)
      await this.save()
    }
    return result
  }

  /** Copies the given items into `destination`; the originals stay in the repository. */
  async exportItems(ids: string[], destination: string): Promise<ExportResult> {
    const result: ExportResult = { destination, exported: 0, failed: [] }
    await fs.mkdir(destination, { recursive: true })
    for (const id of ids) {
      const item = this.items.get(id)
      const source = this.absolutePathOf(id)
      if (!item || !source) continue
      try {
        await copyWithUniqueName(source, destination, item.fileName)
        result.exported++
      } catch (err) {
        result.failed.push({ fileName: item.fileName, reason: (err as Error).message })
      }
    }
    return result
  }

  private async updateTags(
    ids: string[],
    update: (current: string[]) => string[]
  ): Promise<MediaItem[]> {
    const updated: MediaItem[] = []
    for (const id of ids) {
      const item = this.items.get(id)
      if (!item) continue
      item.tags = update(item.tags)
      updated.push(item)
    }
    if (updated.length > 0) await this.save()
    return updated
  }

  private get databasePath(): string {
    return path.join(this.root, DATA_FOLDER, DATABASE_FILE)
  }

  private async ensureFolders(): Promise<void> {
    for (const folder of [...Object.values(MEDIA_FOLDERS), DATA_FOLDER]) {
      await fs.mkdir(path.join(this.root, folder), { recursive: true })
    }
  }

  private async load(): Promise<void> {
    let raw: string
    try {
      raw = await fs.readFile(this.databasePath, 'utf8')
    } catch {
      return
    }
    const db = JSON.parse(raw) as Database
    for (const item of db.items ?? []) this.items.set(item.id, item)
  }

  private save(): Promise<void> {
    const write = async (): Promise<void> => {
      const db: Database = { version: DATABASE_VERSION, items: this.list() }
      const tmp = `${this.databasePath}.tmp`
      await fs.writeFile(tmp, JSON.stringify(db, null, 2), 'utf8')
      await fs.rename(tmp, this.databasePath)
    }
    this.saveQueue = this.saveQueue.then(write, write)
    return this.saveQueue
  }
}
