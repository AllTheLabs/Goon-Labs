import { app, net } from 'electron'
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { FFMPEG } from './previews'

const RELEASE_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/'
const ASSET =
  process.platform === 'win32' ? 'yt-dlp.exe' : process.platform === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp_linux'
/** Sites change often and old yt-dlp builds stop working, so check for updates daily. */
const UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000
const MAX_PLAYLIST_ITEMS = 100

export class YtDlpError extends Error {
  /** True when yt-dlp doesn't recognise the link at all, as opposed to failing on a known site. */
  constructor(
    message: string,
    readonly unsupported = false
  ) {
    super(message)
  }
}

export interface YtDlpProgress {
  received?: number
  total?: number | null
  note?: string
}

function run(file: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout) =>
      err ? reject(err) : resolve(stdout.trim())
    )
  })
}

function killTree(pid: number | undefined): void {
  if (!pid) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
  } else {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // Already gone.
    }
  }
}

function numberOrNull(value: string | undefined): number | null {
  const n = Number(value)
  return value && value !== 'NA' && Number.isFinite(n) ? n : null
}

/** Installs, updates and runs a private copy of yt-dlp for downloading from video sites. */
export class YtDlp {
  // Resolved lazily: the data folder can be redirected during startup.
  private get dir(): string {
    return path.join(app.getPath('userData'), 'tools')
  }
  private get binary(): string {
    return path.join(this.dir, ASSET)
  }
  private get stateFile(): string {
    return path.join(this.dir, 'yt-dlp.json')
  }
  private preparing: Promise<string> | null = null
  private running = 0
  private cachedVersion: string | null = null

  async version(): Promise<string | null> {
    if (!existsSync(this.binary)) return null
    this.cachedVersion ??= await run(this.binary, ['--version'], 30_000).catch(() => null)
    return this.cachedVersion
  }

  /** Downloads `url` into `outDir` and returns the files it produced. */
  async download(
    url: string,
    outDir: string,
    signal: AbortSignal,
    onProgress: (progress: YtDlpProgress) => void,
    extraArgs: string[] = []
  ): Promise<string[]> {
    const binary = await this.prepare(onProgress)
    if (signal.aborted) throw new YtDlpError('Cancelled')
    await fs.mkdir(outDir, { recursive: true })

    const args = [
      '--ignore-config',
      '--no-playlist',
      '--playlist-items',
      `1:${MAX_PLAYLIST_ITEMS}`,
      '--newline',
      '--color',
      'never',
      '--no-mtime',
      '--no-write-thumbnail',
      // Prefer MP4/M4A so videos play everywhere and merge without re-encoding.
      '-S',
      'ext:mp4:m4a',
      '-f',
      'bv*+ba/b',
      '--merge-output-format',
      'mp4',
      '-o',
      path.join(outDir, '%(title).150B [%(id)s].%(ext)s'),
      '--progress-template',
      'download:[gl] %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s',
      ...(FFMPEG && existsSync(FFMPEG) ? ['--ffmpeg-location', FFMPEG] : []),
      ...extraArgs,
      url
    ]

    this.running++
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(binary, args, {
          windowsHide: true,
          env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
        })
        const onAbort = () => killTree(child.pid)
        signal.addEventListener('abort', onAbort, { once: true })

        const errors: string[] = []
        let stdoutBuffer = ''
        child.stdout.setEncoding('utf8')
        child.stdout.on('data', (chunk: string) => {
          stdoutBuffer += chunk
          const lines = stdoutBuffer.split(/\r?\n/)
          stdoutBuffer = lines.pop() ?? ''
          for (const line of lines) {
            if (line.startsWith('[gl] ')) {
              const [received, total, estimate] = line.slice(5).split(' ')
              onProgress({
                received: numberOrNull(received) ?? 0,
                total: numberOrNull(total) ?? numberOrNull(estimate),
                note: undefined
              })
            } else if (line.startsWith('[Merger]')) {
              onProgress({ note: 'Merging video and audio…' })
            } else {
              const item = /Downloading item (\d+) of (\d+)/.exec(line)
              if (item) onProgress({ note: `Playlist: item ${item[1]} of ${item[2]}` })
            }
          }
        })
        child.stderr.setEncoding('utf8')
        child.stderr.on('data', (chunk: string) => {
          for (const line of chunk.split(/\r?\n/)) if (line.startsWith('ERROR:')) errors.push(line)
        })
        child.on('error', (err) => reject(new YtDlpError(`Couldn't start yt-dlp: ${err.message}`)))
        child.on('close', (code) => {
          signal.removeEventListener('abort', onAbort)
          if (signal.aborted) return reject(new YtDlpError('Cancelled'))
          if (code === 0) return resolve()
          const last = (errors.pop() ?? `yt-dlp exited with code ${code}`)
            .replace(/^ERROR:\s*/, '')
            .replace(/^\[[^\]]+\]\s*/, '')
            .replace(/^[\w-]+:\s(?=[A-Z])/, '')
          const unsupported = /Unsupported URL|No video formats found|is not a valid URL|no suitable/i.test(last)
          reject(new YtDlpError(last, unsupported))
        })
      })
    } finally {
      this.running--
    }

    const files = (await fs.readdir(outDir))
      .filter((name) => !/\.(part|ytdl|temp|f\d+\.\w+)$/i.test(name) && !name.includes('.part-Frag'))
      .map((name) => path.join(outDir, name))
    if (files.length === 0) throw new YtDlpError('yt-dlp finished but no file was saved')
    return files
  }

  /** Installs yt-dlp on first use and keeps it up to date. Concurrent callers share one run. */
  private prepare(onProgress: (progress: YtDlpProgress) => void): Promise<string> {
    this.preparing ??= this.doPrepare(onProgress).finally(() => {
      this.preparing = null
    })
    return this.preparing
  }

  private async doPrepare(onProgress: (progress: YtDlpProgress) => void): Promise<string> {
    if (!existsSync(this.binary)) {
      onProgress({ note: 'Installing yt-dlp (first time only)…' })
      await this.install()
      await this.saveState()
      return this.binary
    }
    const checkedAt = await this.lastUpdateCheck()
    // Windows locks a running .exe, so only self-update while no download is using it.
    if (Date.now() - checkedAt > UPDATE_INTERVAL_MS && this.running === 0) {
      onProgress({ note: 'Updating yt-dlp…' })
      await run(this.binary, ['-U'], 120_000).catch(() => {})
      this.cachedVersion = null
      await this.saveState()
    }
    return this.binary
  }

  private async install(): Promise<void> {
    try {
      const sums = await net.fetch(RELEASE_URL + 'SHA2-256SUMS')
      if (!sums.ok) throw new Error(`checksums: HTTP ${sums.status}`)
      const expected = (await sums.text())
        .split('\n')
        .map((line) => line.trim().split(/\s+/))
        .find(([, name]) => name === ASSET)?.[0]
        ?.toLowerCase()
      if (!expected) throw new Error(`no checksum listed for ${ASSET}`)

      const response = await net.fetch(RELEASE_URL + ASSET)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = Buffer.from(await response.arrayBuffer())
      const actual = createHash('sha256').update(data).digest('hex')
      if (actual !== expected) throw new Error('the download failed its integrity check')

      await fs.mkdir(this.dir, { recursive: true })
      const temp = `${this.binary}.download`
      await fs.writeFile(temp, data, { mode: 0o755 })
      await fs.rename(temp, this.binary)
      this.cachedVersion = null
    } catch (err) {
      throw new YtDlpError(`Couldn't install yt-dlp: ${(err as Error).message}`)
    }
  }

  private async lastUpdateCheck(): Promise<number> {
    try {
      return (JSON.parse(await fs.readFile(this.stateFile, 'utf8')) as { checkedAt: number }).checkedAt ?? 0
    } catch {
      return 0
    }
  }

  private async saveState(): Promise<void> {
    await fs.writeFile(this.stateFile, JSON.stringify({ checkedAt: Date.now() }))
  }
}
