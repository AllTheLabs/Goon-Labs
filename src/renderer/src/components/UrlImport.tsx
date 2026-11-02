import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Ban,
  CheckCircle2,
  ClipboardPaste,
  Clock,
  Download,
  FolderOpen,
  Link,
  Loader2,
  RotateCcw,
  X,
  XCircle
} from 'lucide-react'
import type { DownloadJob } from '../../../shared/types'
import { extractUrls, formatBytes, plural } from '../utils'

interface UrlImportProps {
  jobs: DownloadJob[]
  onClose: () => void
  onClear: () => void
}

const ACTIVE: DownloadJob['status'][] = ['queued', 'downloading', 'importing']

function displayName(job: DownloadJob): string {
  if (job.fileName) return job.fileName
  try {
    const url = new URL(job.url)
    return url.hostname + (url.pathname.length > 1 ? url.pathname : '')
  } catch {
    return job.url
  }
}

function statusText(job: DownloadJob): string {
  switch (job.status) {
    case 'queued':
      return 'Waiting…'
    case 'downloading':
      if (job.note) return job.note
      return job.total
        ? `${formatBytes(job.received)} of ${formatBytes(job.total)}`
        : job.received > 0
          ? formatBytes(job.received)
          : 'Connecting…'
    case 'importing':
      return 'Adding to library…'
    case 'done':
      if (job.importedCount && job.importedCount > 1) return `Saved ${job.importedCount} items to your library`
      return `Saved to ${job.item?.type === 'video' ? 'Videos' : 'Pictures'}`
    case 'cancelled':
      return 'Cancelled'
    case 'failed':
      return job.error ?? 'Failed'
  }
}

function StatusIcon({ job }: { job: DownloadJob }) {
  switch (job.status) {
    case 'queued':
      return <Clock size={16} />
    case 'downloading':
    case 'importing':
      return <Loader2 size={16} className="spin" />
    case 'done':
      return <CheckCircle2 size={16} />
    case 'cancelled':
      return <Ban size={16} />
    case 'failed':
      return <XCircle size={16} />
  }
}

export function UrlImport({ jobs, onClose, onClear }: UrlImportProps) {
  const [text, setText] = useState('')
  const [pasted, setPasted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const [ytDlpVersion, setYtDlpVersion] = useState<string | null>(null)

  // Refresh whenever a download finishes, since that's when yt-dlp may have been installed or updated.
  const doneCount = jobs.filter((job) => job.status === 'done' || job.status === 'failed').length
  useEffect(() => {
    window.api.getDownloaderInfo().then((info) => setYtDlpVersion(info.ytDlpVersion))
  }, [doneCount])

  // Read through a ref so the focus listener always sees the latest values.
  const latest = useRef({ text, jobs })
  latest.current = { text, jobs }

  /** Fills the box from the clipboard when it's empty and holds links that aren't queued yet. */
  const autoPaste = useCallback(async () => {
    if (latest.current.text.trim()) return
    const clip = await window.api.readClipboardText().catch(() => '')
    const known = new Set(latest.current.jobs.map((job) => job.url))
    const urls = extractUrls(clip).filter((url) => !known.has(url))
    if (urls.length === 0 || latest.current.text.trim()) return
    setText(urls.join('\n'))
    setPasted(true)
    requestAnimationFrame(() => textRef.current?.select())
  }, [])

  useEffect(() => {
    autoPaste()
    window.addEventListener('focus', autoPaste)
    return () => window.removeEventListener('focus', autoPaste)
  }, [autoPaste])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const urls = extractUrls(text)

  const start = async () => {
    if (urls.length === 0) {
      setError(text.trim() ? 'No links found. Links start with http:// or https://' : null)
      return
    }
    try {
      await window.api.downloadUrls(urls)
      setText('')
      setPasted(false)
      setError(null)
      textRef.current?.focus()
    } catch (err) {
      setError((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }

  const finished = jobs.filter((job) => !ACTIVE.includes(job.status)).length
  const active = jobs.length - finished

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal url-import">
        <header className="modal-header">
          <div className="modal-icon">
            <Link size={20} />
          </div>
          <div>
            <h2>Import from URL</h2>
            <p>
              Paste links to photos, videos, or posts on video sites. They download in the background and go
              straight into Pictures or Videos.
            </p>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <div className="url-input-wrap">
          <textarea
            ref={textRef}
            className="input url-input"
            placeholder={'https://example.com/photo.jpg\nhttps://example.com/clip.mp4'}
            value={text}
            rows={3}
            autoFocus
            spellCheck={false}
            onChange={(e) => {
              setText(e.target.value)
              setPasted(false)
              setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                start()
              }
            }}
          />
          <div className="url-input-foot">
            <span className={`url-hint ${error ? 'error' : ''}`}>
              {error ? (
                error
              ) : pasted ? (
                <>
                  <ClipboardPaste size={13} /> Pasted from your clipboard
                </>
              ) : (
                'One link per line. Enter to download, Shift+Enter for a new line.'
              )}
            </span>
            <button className="btn btn-primary btn-sm" disabled={urls.length === 0} onClick={start}>
              <Download size={14} /> {urls.length > 1 ? `Download ${urls.length} links` : 'Download'}
            </button>
          </div>
        </div>

        {jobs.length > 0 && (
          <section className="download-section">
            <div className="queue-column-head">
              <span className="field-label">
                Downloads{active > 0 ? ` · ${active} in progress` : ''}
              </span>
              <button className="btn btn-ghost btn-sm" disabled={finished === 0} onClick={onClear}>
                Clear finished
              </button>
            </div>
            <div className="download-list">
              {[...jobs].reverse().map((job) => {
                const percent =
                  job.status === 'downloading' && job.total ? Math.min(100, (job.received / job.total) * 100) : null
                return (
                  <div key={job.id} className={`download-row ${job.status}`}>
                    <span className="download-icon">
                      <StatusIcon job={job} />
                    </span>
                    <div className="download-text">
                      <span className="download-name" title={job.url}>
                        {displayName(job)}
                      </span>
                      <span className="download-status">{statusText(job)}</span>
                      {(job.status === 'downloading' || job.status === 'importing') && (
                        <div className={`download-progress ${percent === null ? 'indeterminate' : ''}`}>
                          <div style={percent === null ? undefined : { width: `${percent}%` }} />
                        </div>
                      )}
                    </div>
                    {(job.status === 'queued' || job.status === 'downloading') && (
                      <button className="queue-icon-btn" onClick={() => window.api.cancelDownload(job.id)} title="Cancel">
                        <X size={14} />
                      </button>
                    )}
                    {(job.status === 'failed' || job.status === 'cancelled') && (
                      <button className="queue-icon-btn" onClick={() => window.api.retryDownload(job.id)} title="Try again">
                        <RotateCcw size={14} />
                      </button>
                    )}
                    {job.status === 'done' && job.item && (
                      <button
                        className="queue-icon-btn"
                        onClick={() => window.api.revealItem(job.item!.id)}
                        title="Show in folder"
                      >
                        <FolderOpen size={14} />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )}

        <footer className="modal-footer">
          <span className="modal-summary url-summary">
            <span>
              {active > 0
                ? `${plural(active, 'download')} running. You can close this and keep browsing.`
                : 'Downloads keep going in the background if you close this.'}
            </span>
            <small>
              {ytDlpVersion
                ? `Video sites are handled by yt-dlp ${ytDlpVersion}, which updates itself daily.`
                : 'Video site support (yt-dlp) installs automatically the first time you need it.'}
            </small>
          </span>
          <button className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </div>
  )
}
