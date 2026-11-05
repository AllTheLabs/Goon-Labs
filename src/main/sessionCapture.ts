import { spawn } from 'node:child_process'
import { BrowserWindow, desktopCapturer, session as electronSession, shell } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { FFMPEG, h264EncodeArgs } from './previews'

type DisplayCallback = (streams: { video?: Electron.WebFrameMain; audio?: 'loopback' }) => void

export interface BeginRecordingOptions {
  sessionDir: string
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function dateStamp(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function safeName(name: string): string {
  return name.replace(/[<>:"/\\|?*]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Lab'
}

export function installCapturePermissions(): void {
  electronSession.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(permission === 'media' || permission === 'display-capture')
  })
  const ses = electronSession.defaultSession as typeof electronSession.defaultSession & {
    setDisplayMediaRequestHandler?: (
      handler: (_request: unknown, callback: DisplayCallback) => void,
      opts?: { useSystemPicker: boolean }
    ) => void
  }
  ses.setDisplayMediaRequestHandler?.(
    (_request, callback) => {
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      if (!win) {
        callback({})
        return
      }
      callback({ video: win.webContents.mainFrame, audio: 'loopback' })
    },
    { useSystemPicker: false }
  )
}

export class SessionRecording {
  private filePath: string | null = null
  private destPath: string | null = null
  private writes: Promise<void> = Promise.resolve()

  async begin(labName: string, options: BeginRecordingOptions): Promise<string | null> {
    const dest = await uniqueMp4(
      options.sessionDir,
      `Goon Labs - ${safeName(labName)} - ${dateStamp()}`
    )
    this.destPath = dest
    this.filePath = `${dest}.partial`
    await fs.mkdir(path.dirname(dest), { recursive: true })
    await fs.writeFile(this.filePath, Buffer.alloc(0))
    return dest
  }

  append(data: ArrayBuffer | Uint8Array): Promise<void> {
    const target = this.filePath
    if (!target) return Promise.resolve()
    const chunk = Buffer.from(new Uint8Array(data))
    this.writes = this.writes.then(() => fs.appendFile(target, chunk))
    return this.writes
  }

  async finish(): Promise<string | null> {
    await this.writes
    const partial = this.filePath
    const dest = this.destPath
    this.filePath = null
    this.destPath = null
    this.writes = Promise.resolve()
    if (!partial || !dest) return null
    try {
      await remuxSeekable(partial, dest)
      await fs.rm(partial, { force: true })
      return dest
    } catch {
      const fallback = dest.replace(/\.mp4$/i, '.webm')
      await fs.rename(partial, fallback).catch(() => {})
      return fallback
    }
  }

  reveal(filePath: string): void {
    shell.showItemInFolder(filePath)
  }
}

export async function windowSourceId(): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (!win) return null
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: 0, height: 0 }
  })
  const title = win.getTitle()
  const match =
    sources.find((source) => source.name.includes(title)) ??
    sources.find((source) => source.name.includes('Goon Labs')) ??
    sources[0]
  return match?.id ?? null
}

async function uniqueMp4(dir: string, base: string): Promise<string> {
  for (let n = 0; ; n++) {
    const candidate = path.join(dir, n === 0 ? `${base}.mp4` : `${base} (${n}).mp4`)
    try {
      await fs.access(candidate)
    } catch {
      return candidate
    }
  }
}

/**
 * MediaRecorder WebM has no cues and often duplicate timestamps, so a copy-remux
 * freezes on the first frame. Re-encode to H.264 + AAC, keeping audio in time with
 * the picture instead of rewriting video timestamps from the frame count.
 */
async function remuxSeekable(src: string, dest: string): Promise<void> {
  const encoder = await h264EncodeArgs()
  try {
    await remuxOnce(src, dest, encoder, true)
  } catch {
    await remuxOnce(src, dest, encoder, false)
  }
}

function remuxOnce(src: string, dest: string, encoder: string[], withAudio: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!FFMPEG) return reject(new Error('ffmpeg is not available'))
    const audio = withAudio
      ? [
          '-map',
          '0:a:0?',
          '-c:a',
          'aac',
          '-ar',
          '48000',
          '-ac',
          '2',
          '-b:a',
          '192k',
          '-af',
          'aresample=async=1000:first_pts=0'
        ]
      : ['-an']
    const child = spawn(
      FFMPEG,
      [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-fflags',
        '+genpts',
        '-analyzeduration',
        '100M',
        '-probesize',
        '100M',
        '-i',
        src,
        '-map',
        '0:v:0',
        '-r',
        '30',
        '-pix_fmt',
        'yuv420p',
        ...encoder,
        ...audio,
        '-movflags',
        '+faststart',
        dest
      ],
      { windowsHide: true }
    )
    let stderr = ''
    child.stderr?.on('data', (chunk) => (stderr = (stderr + chunk).slice(-2000)))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(stderr.trim() || `ffmpeg exited ${code}`))
    })
  })
}

