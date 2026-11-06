/** Most videos that may play at once. Chromium's hardware decoder pool is small. */
export const MAX_SCROLLER_TILES = 35
/** Parked elements kept after a row leaves, so the next row reuses decoders instead of leaking them. */
const MAX_IDLE = MAX_SCROLLER_TILES
/** Caps how many clips may begin decoding at once so a new row does not stall the GPU. */
const MAX_STARTING = 3
const CACHE_MAX_BYTES = 48 * 1024 * 1024
const CACHE_MAX_ENTRY_BYTES = 8 * 1024 * 1024
const CACHE_MAX_ENTRIES = 8

let starting = 0
const waiting: Array<() => void> = []

function pump(): void {
  while (starting < MAX_STARTING && waiting.length > 0) {
    starting++
    waiting.shift()!()
  }
}

export function acquireDecoderStart(): Promise<void> {
  if (starting < MAX_STARTING) {
    starting++
    return Promise.resolve()
  }
  return new Promise((resolve) => waiting.push(resolve))
}

export function releaseDecoderStart(): void {
  starting = Math.max(0, starting - 1)
  pump()
}

/**
 * Drops the media pipeline on a tile that has left the scroller. Without this, Chromium
 * keeps the hardware decoder session until GC — after enough rows that slots run out
 * and the whole window freezes.
 */
export function releaseVideo(video: HTMLVideoElement): void {
  try {
    video.pause()
  } catch {
    /* already torn down */
  }
  video.removeAttribute('src')
  video.removeAttribute('poster')
  delete video.dataset.cacheSrc
  delete video.dataset.originSrc
  delete video.dataset.tileKey
  video.load()
}

interface CachedSrc {
  src: string
  url: string
  bytes: number
}

const srcCache: CachedSrc[] = []
const inflight = new Map<string, Promise<string | null>>()
let cacheBytes = 0

function evictIfNeeded(incoming: number): void {
  while (
    srcCache.length > 0 &&
    (cacheBytes + incoming > CACHE_MAX_BYTES || srcCache.length >= CACHE_MAX_ENTRIES)
  ) {
    const dropped = srcCache.shift()!
    cacheBytes -= dropped.bytes
    URL.revokeObjectURL(dropped.url)
  }
}

export function peekCachedSrc(src: string): string | null {
  const index = srcCache.findIndex((entry) => entry.src === src)
  if (index < 0) return null
  const hit = srcCache.splice(index, 1)[0]
  srcCache.push(hit)
  return hit.url
}

/** Fetches a preview into an LRU of object URLs so repeat tiles skip disk. */
export function warmSrc(src: string): void {
  if (!src || peekCachedSrc(src) || inflight.has(src)) return
  const request = fetch(src)
    .then(async (response) => {
      if (!response.ok) return null
      const length = Number(response.headers.get('content-length') ?? '0')
      if (length > CACHE_MAX_ENTRY_BYTES) return null
      const blob = await response.blob()
      if (blob.size > CACHE_MAX_ENTRY_BYTES) return null
      evictIfNeeded(blob.size)
      const url = URL.createObjectURL(blob)
      srcCache.push({ src, url, bytes: blob.size })
      cacheBytes += blob.size
      return url
    })
    .catch(() => null)
    .finally(() => inflight.delete(src))
  inflight.set(src, request)
}

export function clearSrcCache(): void {
  for (const entry of srcCache) URL.revokeObjectURL(entry.url)
  srcCache.length = 0
  cacheBytes = 0
  inflight.clear()
}

export async function playWhenReady(
  video: HTMLVideoElement,
  cancelled: () => boolean
): Promise<void> {
  await acquireDecoderStart()
  if (cancelled()) {
    releaseDecoderStart()
    return
  }
  try {
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      await new Promise<void>((resolve) => {
        const timer = window.setTimeout(finish, 8000)
        function finish() {
          window.clearTimeout(timer)
          video.removeEventListener('canplay', finish)
          video.removeEventListener('error', finish)
          resolve()
        }
        video.addEventListener('canplay', finish, { once: true })
        video.addEventListener('error', finish, { once: true })
      })
    }
    if (!cancelled()) {
      await video.play()
      video.classList.add('is-playing')
    }
  } catch {
    /* autoplay blocked until a click; the mixer resume path handles that */
  } finally {
    releaseDecoderStart()
  }
}

type MixerLike = {
  attach: (key: number, element: HTMLMediaElement) => void
  detach: (key: number) => void
}

/**
 * Reuses a fixed set of <video> elements so MediaElementSource nodes and hardware
 * decoders are not created for every row that scrolls by.
 */
export class ScrollerVideoPool {
  private idle: HTMLVideoElement[] = []
  private mixer: MixerLike | null = null

  setMixer(mixer: MixerLike | null): void {
    this.mixer = mixer
  }

  take(src: string, tileKey: number, poster: string): HTMLVideoElement {
    const playSrc = peekCachedSrc(src) ?? src
    const match = this.idle.findIndex((video) => video.dataset.originSrc === src)
    const video = match >= 0 ? this.idle.splice(match, 1)[0] : (this.idle.pop() ?? this.create())
    const prevKey = Number(video.dataset.tileKey)
    if (this.mixer && Number.isFinite(prevKey)) this.mixer.detach(prevKey)
    if (video.dataset.originSrc !== src) {
      video.classList.remove('is-playing')
      video.poster = poster
      video.src = playSrc
      video.dataset.originSrc = src
      video.dataset.cacheSrc = playSrc
    } else if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      video.classList.add('is-playing')
    }
    video.dataset.tileKey = String(tileKey)
    this.mixer?.attach(tileKey, video)
    return video
  }

  give(video: HTMLVideoElement): void {
    const key = Number(video.dataset.tileKey)
    if (this.mixer && Number.isFinite(key)) this.mixer.detach(key)
    delete video.dataset.tileKey
    try {
      video.pause()
    } catch {
      /* already gone */
    }
    video.onerror = null
    if (video.parentNode) video.parentNode.removeChild(video)
    if (this.idle.length < MAX_IDLE) {
      this.idle.push(video)
    } else {
      this.destroy(video)
    }
  }

  dispose(): void {
    for (const video of this.idle) this.destroy(video)
    this.idle = []
  }

  private create(): HTMLVideoElement {
    const video = document.createElement('video')
    video.className = 'scroller-tile-video'
    video.crossOrigin = 'anonymous'
    video.loop = true
    video.playsInline = true
    video.preload = 'auto'
    video.disablePictureInPicture = true
    video.disableRemotePlayback = true
    video.setAttribute('disablepictureinpicture', '')
    video.addEventListener('playing', () => video.classList.add('is-playing'))
    video.addEventListener('emptied', () => video.classList.remove('is-playing'))
    return video
  }

  private destroy(video: HTMLVideoElement): void {
    const key = Number(video.dataset.tileKey)
    if (this.mixer && Number.isFinite(key)) this.mixer.detach(key)
    releaseVideo(video)
  }
}
