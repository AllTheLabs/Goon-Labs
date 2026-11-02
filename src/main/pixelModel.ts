import { app, net, session } from 'electron'
import { inflateRawSync } from 'node:zlib'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

const MODEL_NAME = '320n.onnx'
const MIN_BYTES = 1_000_000

type Source =
  | { name: string; kind: 'onnx'; url: string }
  | { name: string; kind: 'pypi'; url: string }

const SOURCES: Source[] = [
  {
    name: 'GitHub',
    kind: 'onnx',
    url: 'https://github.com/notAI-tech/NudeNet/releases/download/v3.4-weights/320n.onnx'
  },
  {
    name: 'Hugging Face',
    kind: 'onnx',
    url: 'https://huggingface.co/zhangsongbo365/nudenet_onnx/resolve/main/320n.onnx?download=true'
  },
  {
    name: 'PyPI',
    kind: 'pypi',
    url: 'https://pypi.org/pypi/nudenet/3.4.2/json'
  }
]

function modelPath(): string {
  return path.join(app.getPath('userData'), 'tools', MODEL_NAME)
}

function userAgent(): string {
  return session.defaultSession
    .getUserAgent()
    .replace(/\s(Electron|goon-labs|media-manager)\/\S+/gi, '')
}

async function fetchBuffer(url: string): Promise<Buffer> {
  const response = await net.fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': userAgent(),
      Accept: 'application/octet-stream,application/json;q=0.9,*/*;q=0.8'
    }
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

function extractZipFile(archive: Buffer, suffix: string): Buffer {
  const wanted = suffix.replace(/\\/g, '/').toLowerCase()
  let offset = 0
  while (offset + 30 <= archive.length) {
    const signature = archive.readUInt32LE(offset)
    if (signature === 0x02014b50 || signature === 0x06054b50) break
    if (signature !== 0x04034b50) throw new Error('the package was not a valid zip')
    const method = archive.readUInt16LE(offset + 8)
    const compressedSize = archive.readUInt32LE(offset + 18)
    const nameLength = archive.readUInt16LE(offset + 26)
    const extraLength = archive.readUInt16LE(offset + 28)
    const nameStart = offset + 30
    const name = archive.toString('utf8', nameStart, nameStart + nameLength).replace(/\\/g, '/')
    const dataStart = nameStart + nameLength + extraLength
    const dataEnd = dataStart + compressedSize
    if (dataEnd > archive.length) throw new Error('the package was truncated')
    if (name.toLowerCase().endsWith(wanted)) {
      const payload = archive.subarray(dataStart, dataEnd)
      if (method === 0) return Buffer.from(payload)
      if (method === 8) return inflateRawSync(payload)
      throw new Error(`unsupported zip compression (${method})`)
    }
    offset = dataEnd
  }
  throw new Error(`the package did not contain ${suffix}`)
}

async function fromPypi(indexUrl: string): Promise<Buffer> {
  const index = JSON.parse((await fetchBuffer(indexUrl)).toString('utf8')) as {
    urls?: { packagetype?: string; url?: string; filename?: string }[]
  }
  const wheel = index.urls?.find(
    (entry) => entry.packagetype === 'bdist_wheel' && typeof entry.url === 'string'
  )
  if (!wheel?.url) throw new Error('no wheel listed')
  return extractZipFile(await fetchBuffer(wheel.url), '320n.onnx')
}

async function fromSource(source: Source): Promise<Buffer> {
  const data = source.kind === 'pypi' ? await fromPypi(source.url) : await fetchBuffer(source.url)
  if (data.byteLength < MIN_BYTES) throw new Error('the download was too small')
  return data
}

/** Downloads the on-device detector once, then returns its bytes. */
export async function loadPixelModel(): Promise<Uint8Array> {
  const dest = modelPath()
  if (!existsSync(dest)) {
    await fs.mkdir(path.dirname(dest), { recursive: true })
    const errors: string[] = []
    let saved = false
    for (const source of SOURCES) {
      try {
        const data = await fromSource(source)
        const temp = `${dest}.download`
        await fs.writeFile(temp, data)
        await fs.rename(temp, dest)
        saved = true
        break
      } catch (err) {
        errors.push(`${source.name}: ${(err as Error).message}`)
      }
    }
    if (!saved) {
      throw new Error(`Couldn't download the pixel detector (${errors.join('; ')})`)
    }
  }
  return new Uint8Array(await fs.readFile(dest))
}
