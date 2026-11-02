import { app, net, session } from 'electron'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { DownloaderInfo, DownloadJob } from '../shared/types'
import type { Library } from './library'
import { extensionForMime, mediaTypeOf } from './mediaTypes'
import { YtDlp, YtDlpError } from './ytdlp'

const CONCURRENCY = 3
const PROGRESS_INTERVAL_MS = 200
/** Pages are only scanned for media links, so there's no need to read huge ones. */
const MAX_PAGE_BYTES = 4 * 1024 * 1024

interface Job extends DownloadJob {
  controller?: AbortController
}

class DownloadError extends Error {}

function snapshot({ controller: _controller, ...job }: Job): DownloadJob {
  return { ...job }
}

function sanitizeFileName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .slice(0, 150)
}

function fileNameFromDisposition(header: string | null): string | null {
  if (!header) return null
  const extended = /filename\*\s*=\s*(?:UTF-8|utf-8)?''([^;]+)/.exec(header)
  if (extended) {
    try {
      return decodeURIComponent(extended[1].trim().replace(/^"|"$/g, ''))
    } catch {
      // Fall through to the plain filename.
    }
  }
  const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/.exec(header)
  return plain ? (plain[2] ?? plain[1]).trim() : null
}

function fileNameFromUrl(url: string): string {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop() ?? ''
    return decodeURIComponent(last)
  } catch {
    return ''
  }
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x2F;/gi, '/')
}

function twitterStatusId(url: string): string | null {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase()
    if (!/(^|\.)(x\.com|twitter\.com|vxtwitter\.com|fxtwitter\.com|fixupx\.com)$/.test(host)) return null
    return /\/status\/(\d+)/.exec(parsed.pathname)?.[1] ?? null
  } catch {
    return null
  }
}

function isTwitterAvatar(url: string): boolean {
  return /pbs\.twimg\.com\/profile_images\/|abs\.twimg\.com\/|\/profile_banners\/|_(?:normal|bigger|mini|400x400)\.(jpe?g|png|webp)(\?|$)|(?:ext_tw_video_thumb|tweet_video_thumb|amplify_video_thumb)/i.test(
    url
  )
}

function pushHttps(urls: string[], value: unknown): void {
  if (typeof value !== 'string') return
  try {
    const resolved = new URL(value)
    if (/^https?:$/.test(resolved.protocol) && !urls.includes(resolved.href)) urls.push(resolved.href)
  } catch {
    // Ignore malformed links.
  }
}

function isProgressiveVideo(url: string): boolean {
  return /\.(mp4|m4v|webm|mov)(\?|$)/i.test(url)
}

/** Same tweet clip across 256p/720p/1080p variants shares this id in the CDN path. */
function twitterClipKey(url: string): string {
  return /\/(?:ext_tw_video|amplify_video|tweet_video)\/(\d+)/.exec(url)?.[1] ?? url
}

function variantScore(url: string, variant?: Record<string, unknown>): number {
  const bitrate = Number(variant?.bitrate ?? variant?.bit_rate)
  if (Number.isFinite(bitrate) && bitrate > 0) return bitrate
  const dim = /\/(\d+)x(\d+)\//.exec(url)
  return dim ? Number(dim[1]) * Number(dim[2]) : 0
}

/** One URL per clip, highest bitrate / resolution. */
function pickBestByClip(urls: string[]): string[] {
  const best = new Map<string, { url: string; score: number }>()
  for (const url of urls) {
    if (isTwitterAvatar(url)) continue
    const score = variantScore(url)
    const key = twitterClipKey(url)
    const prev = best.get(key)
    if (!prev || score > prev.score) best.set(key, { url, score })
  }
  const picked = [...best.values()]
  if (picked.length <= 1) return picked.map((entry) => entry.url)
  const grouped = picked.some((entry) => twitterClipKey(entry.url) !== entry.url)
  if (grouped) return picked.map((entry) => entry.url)
  // Flat variant lists sometimes omit the clip id; keep the highest-scoring file.
  if (picked.every((entry) => /video\.twimg\.com/i.test(entry.url))) {
    return [picked.reduce((a, b) => (a.score >= b.score ? a : b)).url]
  }
  return picked.map((entry) => entry.url)
}

/** Video URLs first, then photos, from fxtwitter / vxtwitter JSON. */
function mediaUrlsFromTwitterApi(data: unknown): string[] {
  if (!data || typeof data !== 'object') return []
  const root = data as Record<string, unknown>
  const tweet = (root.tweet && typeof root.tweet === 'object' ? root.tweet : root) as Record<string, unknown>
  const videos: string[] = []
  const photos: string[] = []

  const takeMedia = (entry: unknown, into: string[]) => {
    if (!entry || typeof entry !== 'object') return
    const item = entry as Record<string, unknown>
    const variants = Array.isArray(item.variants) ? item.variants : []
    let bestUrl: string | null = null
    let bestScore = -1
    for (const variant of variants) {
      if (!variant || typeof variant !== 'object') continue
      const record = variant as Record<string, unknown>
      if (typeof record.url !== 'string' || !isProgressiveVideo(record.url)) continue
      const score = variantScore(record.url, record)
      if (score > bestScore) {
        bestScore = score
        bestUrl = record.url
      }
    }
    pushHttps(into, bestUrl ?? item.url)
  }

  const media = tweet.media && typeof tweet.media === 'object' ? (tweet.media as Record<string, unknown>) : null
  if (media) {
    for (const entry of Array.isArray(media.videos) ? media.videos : []) takeMedia(entry, videos)
    for (const entry of Array.isArray(media.photos) ? media.photos : []) takeMedia(entry, photos)
  }

  const extended = Array.isArray(tweet.media_extended)
    ? tweet.media_extended
    : Array.isArray(root.media_extended)
      ? root.media_extended
      : []
  for (const entry of extended) {
    if (!entry || typeof entry !== 'object') continue
    const type = String((entry as Record<string, unknown>).type ?? '').toLowerCase()
    takeMedia(entry, type === 'image' || type === 'photo' ? photos : videos)
  }

  const listed = Array.isArray(tweet.mediaURLs)
    ? tweet.mediaURLs
    : Array.isArray(root.mediaURLs)
      ? root.mediaURLs
      : []
  for (const url of listed) {
    if (typeof url !== 'string') continue
    if (isProgressiveVideo(url) || /video\.twimg\.com/i.test(url)) pushHttps(videos, url)
    else pushHttps(photos, url)
  }

  const videoUrls = pickBestByClip(videos)
  return videoUrls.length > 0 ? videoUrls : photos.filter((url) => !isTwitterAvatar(url))
}

/** Media a web page points at (Open Graph / Twitter cards, then <video> tags), videos first. */
function findMediaInPage(html: string, pageUrl: string, includeImages: boolean): string[] {
  const found: string[] = []
  const meta = (name: string) => {
    const tags = html.match(/<meta\b[^>]*>/gi) ?? []
    for (const tag of tags) {
      const key = /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase()
      const content = /content\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]
      if (key === name && content) found.push(content)
    }
  }
  const tagSources = (tag: string) => {
    const pattern = new RegExp(`<${tag}\\b[^>]*\\ssrc\\s*=\\s*["']([^"']+)["']`, 'gi')
    for (const match of html.matchAll(pattern)) found.push(match[1])
  }

  for (const name of ['og:video:secure_url', 'og:video:url', 'og:video', 'twitter:player:stream']) meta(name)
  tagSources('video')
  tagSources('source')
  if (includeImages) {
    for (const name of ['og:image:secure_url', 'og:image:url', 'og:image', 'twitter:image', 'twitter:image:src']) {
      meta(name)
    }
  }

  const urls: string[] = []
  for (const raw of found) {
    try {
      const resolved = new URL(decodeEntities(raw), pageUrl)
      if (!/^https?:$/.test(resolved.protocol) || isTwitterAvatar(resolved.href) || urls.includes(resolved.href)) {
        continue
      }
      urls.push(resolved.href)
    } catch {
      // Ignore malformed links.
    }
  }
  return urls
}

function browserUserAgent(): string {
  return session.defaultSession
    .getUserAgent()
    .replace(/\s(Electron|goon-labs|media-manager)\/\S+/gi, '')
}

/**
 * Downloads photos and videos from URLs in the background, a few at a time, then imports each
 * finished file into the library through the normal import path.
 */
export class DownloadManager {
  private readonly jobs = new Map<string, Job>()
  private readonly ytDlp = new YtDlp()
  private active = 0

  constructor(
    private readonly getLibrary: () => Library | null,
    private readonly emit: (job: DownloadJob) => void
  ) {}

  async info(): Promise<DownloaderInfo> {
    return { ytDlpVersion: await this.ytDlp.version() }
  }

  list(): DownloadJob[] {
    return [...this.jobs.values()].map(snapshot)
  }

  enqueue(urls: string[]): DownloadJob[] {
    const added: Job[] = []
    for (const raw of urls) {
      const url = raw.trim()
      if (!url) continue
      const job: Job = { id: randomUUID(), url, status: 'queued', received: 0, total: null, fileName: null }
      try {
        if (!/^https?:$/.test(new URL(url).protocol)) throw new Error()
      } catch {
        job.status = 'failed'
        job.error = 'Not a web address (it should start with http:// or https://)'
      }
      this.jobs.set(job.id, job)
      added.push(job)
      this.emit(snapshot(job))
    }
    this.pump()
    return added.map(snapshot)
  }

  cancel(id: string): void {
    const job = this.jobs.get(id)
    if (!job || !['queued', 'downloading'].includes(job.status)) return
    job.controller?.abort()
    this.update(job, { status: 'cancelled' })
  }

  retry(id: string): void {
    const job = this.jobs.get(id)
    if (!job || !['failed', 'cancelled'].includes(job.status)) return
    this.update(job, { status: 'queued', received: 0, total: null, error: undefined, note: undefined })
    this.pump()
  }

  clearFinished(): DownloadJob[] {
    for (const [id, job] of this.jobs) {
      if (['done', 'failed', 'cancelled'].includes(job.status)) this.jobs.delete(id)
    }
    return this.list()
  }

  private update(job: Job, patch: Partial<Job>): void {
    Object.assign(job, patch)
    this.emit(snapshot(job))
  }

  private pump(): void {
    while (this.active < CONCURRENCY) {
      const next = [...this.jobs.values()].find((job) => job.status === 'queued')
      if (!next) return
      this.active++
      this.run(next).finally(() => {
        this.active--
        this.pump()
      })
    }
  }

  private async run(job: Job): Promise<void> {
    const controller = new AbortController()
    job.controller = controller
    const tempDir = path.join(app.getPath('temp'), 'goon-labs-downloads', job.id)
    this.update(job, { status: 'downloading' })
    try {
      const library = this.getLibrary()
      if (!library) throw new DownloadError('Choose a media repository first')
      const files = await this.fetchAny(job, tempDir, controller.signal)
      if (controller.signal.aborted) return
      this.update(job, { status: 'importing', note: undefined })
      const result = await library.importPaths(files)
      const item = result.imported[0]
      if (!item) throw new DownloadError(result.skipped[0]?.reason ?? 'The file could not be imported')
      this.update(job, { status: 'done', item, fileName: item.fileName, importedCount: result.imported.length })
    } catch (err) {
      if (controller.signal.aborted) return
      const message =
        err instanceof DownloadError || err instanceof YtDlpError
          ? err.message
          : `Download failed: ${(err as Error).message}`
      this.update(job, { status: 'failed', error: message, note: undefined })
    } finally {
      job.controller = undefined
      this.lastProgressEmit.delete(job.id)
      fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
  }

  /**
   * Links that name a media file are fetched directly. Otherwise one request shows what the
   * link is: photos and videos are saved straight from it, and pages, streams and anything
   * else go to yt-dlp. If yt-dlp can't handle it, the page scan below gets a turn, since it
   * also finds images, which yt-dlp doesn't.
   */
  private async fetchAny(job: Job, tempDir: string, signal: AbortSignal): Promise<string[]> {
    const directDir = path.join(tempDir, 'direct')
    const direct = () => this.fetchMedia(job, job.url, directDir, signal, true)
    if (mediaTypeOf(fileNameFromUrl(job.url))) return [await direct()]

    this.update(job, { note: 'Looking up media…' })
    let probe: Response | null = null
    try {
      probe = await this.request(job.url, signal)
    } catch (err) {
      if (signal.aborted) throw err
    }
    if (probe?.ok && this.mediaFileName(probe, job.url) !== null) {
      this.update(job, { note: undefined })
      return [await this.saveResponse(job, probe, job.url, directDir)]
    }
    probe?.body?.cancel().catch(() => {})

    const tweetId = twitterStatusId(job.url)
    let twitterFiles: string[] = []
    if (tweetId) {
      try {
        twitterFiles = await this.downloadTwitter(job, tweetId, tempDir, signal)
        const videos = twitterFiles.filter((file) => mediaTypeOf(file) === 'video')
        if (videos.length > 0) return videos
      } catch (err) {
        if (signal.aborted) throw err
      }
    }

    let ytDlpError: YtDlpError
    try {
      const extra = tweetId ? ['--extractor-args', 'twitter:api=syndication'] : []
      const files = await this.ytDlp.download(
        job.url,
        path.join(tempDir, 'yt-dlp'),
        signal,
        (progress) => {
          const patch: Partial<Job> = {}
          if (progress.received !== undefined) patch.received = progress.received
          if (progress.total !== undefined) patch.total = progress.total
          if ('note' in progress) patch.note = progress.note
          this.throttledUpdate(job, patch, progress.note !== undefined)
        },
        extra
      )
      const media = files.filter((file) => mediaTypeOf(file))
      const videos = media.filter((file) => mediaTypeOf(file) === 'video')
      if (videos.length > 0) return videos
      if (media.length > 0 && !tweetId) return media
      throw new YtDlpError('No photo or video was found at that link', true)
    } catch (err) {
      if (signal.aborted) throw err
      ytDlpError = err instanceof YtDlpError ? err : new YtDlpError((err as Error).message)
    }

    if (twitterFiles.length > 0) return twitterFiles

    this.update(job, { received: 0, total: null, note: undefined })
    try {
      return [await this.fetchMedia(job, job.url, directDir, signal, true, !tweetId)]
    } catch (err) {
      if (signal.aborted) throw err
      // yt-dlp's message is the useful one when it recognised the site but couldn't get the
      // video (private, region-locked, needs a login...). Otherwise explain the direct attempt.
      const installFailed = ytDlpError.message.startsWith("Couldn't install") || ytDlpError.message.startsWith("Couldn't start")
      throw ytDlpError.unsupported || installFailed ? err : ytDlpError
    }
  }

  /** Resolves an X/Twitter status through public tweet APIs, preferring video over stills. */
  private async downloadTwitter(
    job: Job,
    statusId: string,
    tempDir: string,
    signal: AbortSignal
  ): Promise<string[]> {
    this.update(job, { note: 'Looking up tweet media…' })
    const endpoints = [
      `https://api.fxtwitter.com/status/${statusId}`,
      `https://api.vxtwitter.com/i/status/${statusId}`
    ]
    let urls: string[] = []
    for (const endpoint of endpoints) {
      try {
        const response = await net.fetch(endpoint, {
          signal,
          headers: { 'User-Agent': browserUserAgent(), Accept: 'application/json' }
        })
        if (!response.ok) continue
        urls = mediaUrlsFromTwitterApi(await response.json())
        if (urls.length > 0) break
      } catch (err) {
        if (signal.aborted) throw err
      }
    }
    if (urls.length === 0) return []

    const dir = path.join(tempDir, 'twitter')
    const files: string[] = []
    for (const url of urls) {
      if (/\.(m3u8|mpd)(\?|$)/i.test(url)) continue
      try {
        files.push(await this.fetchMedia(job, url, dir, signal, false))
      } catch (err) {
        if (signal.aborted) throw err
      }
    }
    return files
  }

  private lastProgressEmit = new Map<string, number>()
  private throttledUpdate(job: Job, patch: Partial<Job>, force: boolean): void {
    Object.assign(job, patch)
    const now = Date.now()
    if (force || now - (this.lastProgressEmit.get(job.id) ?? 0) >= PROGRESS_INTERVAL_MS) {
      this.lastProgressEmit.set(job.id, now)
      this.emit(snapshot(job))
    }
  }

  private request(url: string, signal: AbortSignal): Promise<Response> {
    let referer = ''
    try {
      const parsed = new URL(url)
      const host = parsed.hostname.replace(/^www\./i, '').toLowerCase()
      referer = /(^|\.)(twimg\.com|twitter\.com|x\.com)$/.test(host) ? 'https://x.com/' : parsed.origin + '/'
    } catch {
      // Leave Referer off for malformed URLs.
    }
    return net.fetch(url, {
      signal,
      headers: {
        'User-Agent': browserUserAgent(),
        Accept: 'image/*,video/*,text/html;q=0.8,*/*;q=0.5',
        ...(referer ? { Referer: referer } : {})
      }
    })
  }

  /** The name to save a response under, or null when it isn't a photo or video. */
  private mediaFileName(response: Response, url: string): string | null {
    const mime = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    try {
      return this.pickFileName(response, response.url || url, mime)
    } catch {
      return null
    }
  }

  /** Downloads `url` into `tempDir` and returns the file path. Web pages are searched for media once. */
  private async fetchMedia(
    job: Job,
    url: string,
    tempDir: string,
    signal: AbortSignal,
    allowPage: boolean,
    includePageImages = true
  ): Promise<string> {
    const response = await this.request(url, signal)
    if (!response.ok) throw new DownloadError(`The server answered ${response.status} ${response.statusText}`.trim())

    const finalUrl = response.url || url
    const mime = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()

    if (mime === 'text/html' || mime === 'application/xhtml+xml') {
      if (!allowPage) throw new DownloadError('That link opens a web page, not a photo or video')
      const html = (await response.text()).slice(0, MAX_PAGE_BYTES)
      const candidates = findMediaInPage(html, finalUrl, includePageImages)
      if (candidates.length === 0) {
        throw new DownloadError('That link opens a web page with no photo or video Goon Labs can find. Try a direct link to the file.')
      }
      let lastError: unknown
      for (const candidate of candidates.slice(0, 6)) {
        try {
          return await this.fetchMedia(job, candidate, tempDir, signal, false)
        } catch (err) {
          if (signal.aborted) throw err
          lastError = err
          this.update(job, { received: 0, total: null })
        }
      }
      throw lastError instanceof DownloadError
        ? new DownloadError(`Found media on that page, but couldn't download it: ${lastError.message}`)
        : lastError
    }

    if (/mpegurl|dash\+xml/.test(mime) || /\.(m3u8|mpd)(\?|$)/i.test(finalUrl)) {
      throw new DownloadError("That's a streaming playlist, which can't be saved as a single file")
    }

    return this.saveResponse(job, response, url, tempDir)
  }

  /** Streams a photo or video response into `tempDir`, reporting progress. */
  private async saveResponse(job: Job, response: Response, url: string, tempDir: string): Promise<string> {
    const finalUrl = response.url || url
    const mime = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    const fileName = this.pickFileName(response, finalUrl, mime)
    const total = Number(response.headers.get('content-length')) || null
    this.update(job, { fileName, total, received: 0 })

    await fs.mkdir(tempDir, { recursive: true })
    const filePath = path.join(tempDir, fileName)
    const file = await fs.open(filePath, 'w')
    try {
      if (!response.body) throw new DownloadError('The server sent an empty response')
      const reader = response.body.getReader()
      let received = 0
      let lastEmit = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        await file.write(value)
        received += value.byteLength
        const now = Date.now()
        if (now - lastEmit >= PROGRESS_INTERVAL_MS) {
          lastEmit = now
          this.update(job, { received })
        }
      }
      if (received === 0) throw new DownloadError('The server sent an empty file')
      this.update(job, { received, total: total ?? received })
    } finally {
      await file.close()
    }
    return filePath
  }

  private pickFileName(response: Response, url: string, mime: string): string {
    const raw = fileNameFromDisposition(response.headers.get('content-disposition')) ?? fileNameFromUrl(url)
    let name = sanitizeFileName(raw)
    const mimeExt = extensionForMime(mime)
    const mimeType = mimeExt ? mediaTypeOf(`file${mimeExt}`) : null
    const nameType = mediaTypeOf(name)

    // Trust the server's content type over a misleading or missing extension (e.g. "image.php").
    if (mimeExt && nameType !== mimeType) {
      const stem = path.parse(name).name
      name = (stem || 'download') + mimeExt
    }
    if (!mediaTypeOf(name)) {
      throw new DownloadError(
        mime ? `That link isn't a supported photo or video (it's ${mime})` : "That link isn't a supported photo or video"
      )
    }
    if (!path.parse(name).name) {
      name = `download-${new Date().toISOString().replace(/[:.]/g, '-')}${path.extname(name)}`
    }
    return name
  }
}
