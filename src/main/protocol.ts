import { createReadStream, promises as fs } from 'node:fs'
import { Readable } from 'node:stream'
import { protocol } from 'electron'
import type { Library } from './library'
import { mimeTypeOf } from './mediaTypes'

export const MEDIA_SCHEME = 'media'
export const IMPORT_SCHEME = 'goonlabs'

const FETCH_PRIVILEGES = {
  standard: true,
  secure: true,
  supportFetchAPI: true,
  corsEnabled: true
}

/** Must be called before the app is ready. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: MEDIA_SCHEME, privileges: { ...FETCH_PRIVILEGES, stream: true } },
    { scheme: IMPORT_SCHEME, privileges: FETCH_PRIVILEGES }
  ])
}

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*'
}

/** Lets the bundled Web extension ask Goon Labs to download the current page. */
export function handleImportProtocol(importUrls: (urls: string[]) => { ok: boolean; error?: string; count?: number }): void {
  protocol.handle(IMPORT_SCHEME, async (request) => {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          ...JSON_HEADERS,
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': '*'
        }
      })
    }
    try {
      const parsed = new URL(request.url)
      const urls = parsed.searchParams.getAll('url').map((url) => url.trim()).filter(Boolean)
      if (urls.length === 0) {
        return new Response(JSON.stringify({ ok: false, error: 'Nothing to save on this page' }), {
          status: 400,
          headers: JSON_HEADERS
        })
      }
      const result = importUrls(urls)
      return new Response(JSON.stringify(result), {
        status: result.ok ? 200 : 409,
        headers: JSON_HEADERS
      })
    } catch (err) {
      return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), {
        status: 400,
        headers: JSON_HEADERS
      })
    }
  })
}

function streamResponse(
  filePath: string,
  status: number,
  headers: Record<string, string>,
  range?: { start: number; end: number }
): Response {
  const body = Readable.toWeb(createReadStream(filePath, range)) as unknown as ReadableStream
  return new Response(body, { status, headers })
}

/**
 * Serves repository files as `media://item/<relPath>`. Range requests are handled
 * explicitly so the video player can seek.
 */
export function handleMediaProtocol(getLibrary: () => Library | null): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const library = getLibrary()
    if (!library) return new Response('No repository selected', { status: 404 })

    const relPath = decodeURIComponent(new URL(request.url).pathname.replace(/^\/+/, ''))
    const filePath = library.resolve(relPath)
    if (!filePath) return new Response('Forbidden', { status: 403 })

    let size: number
    try {
      size = (await fs.stat(filePath)).size
    } catch {
      return new Response('Not found', { status: 404 })
    }

    // CORS lets the Scroller route video audio through Web Audio, which silences opaque media.
    const headers = {
      'Content-Type': mimeTypeOf(filePath),
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=31536000, immutable'
    }
    const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '')
    if (!match || (match[1] === '' && match[2] === '')) {
      return streamResponse(filePath, 200, { ...headers, 'Content-Length': String(size) })
    }

    let start: number
    let end: number
    if (match[1] === '') {
      start = Math.max(0, size - Number(match[2]))
      end = size - 1
    } else {
      start = Number(match[1])
      end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1)
    }
    if (start >= size || start > end) {
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${size}`, 'Access-Control-Allow-Origin': '*' }
      })
    }

    return streamResponse(
      filePath,
      206,
      {
        ...headers,
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${size}`
      },
      { start, end }
    )
  })
}
