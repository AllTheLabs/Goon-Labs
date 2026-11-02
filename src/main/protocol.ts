import { createReadStream, promises as fs } from 'node:fs'
import { Readable } from 'node:stream'
import { protocol } from 'electron'
import type { Library } from './library'
import { mimeTypeOf } from './mediaTypes'

export const MEDIA_SCHEME = 'media'

/** Must be called before the app is ready. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true
      }
    }
  ])
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
      'Access-Control-Allow-Origin': '*'
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
