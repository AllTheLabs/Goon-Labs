import { Download, Loader2 } from 'lucide-react'
import type { DownloadJob } from '../../../shared/types'
import { formatBytes } from '../utils'

const ACTIVE: DownloadJob['status'][] = ['queued', 'downloading', 'importing']

function labelOf(job: DownloadJob): string {
  if (job.status === 'queued') return 'Queued…'
  if (job.status === 'importing') return 'Adding to library…'
  if (job.note) return job.note
  if (job.fileName) return job.fileName
  if (job.total) return `${formatBytes(job.received)} of ${formatBytes(job.total)}`
  if (job.received > 0) return formatBytes(job.received)
  return 'Saving…'
}

export function DownloadHud({ jobs }: { jobs: DownloadJob[] }) {
  const active = jobs.filter((job) => ACTIVE.includes(job.status))
  if (active.length === 0) return null

  const job = active[0]
  const measured = active.filter((item) => item.total && item.total > 0)
  const fraction =
    measured.length > 0
      ? measured.reduce((sum, item) => sum + item.received / (item.total ?? 1), 0) / measured.length
      : null

  return (
    <div
      className="download-hud"
      title={active.map((item) => labelOf(item)).join('\n')}
    >
      {job.status === 'queued' ? <Download size={14} /> : <Loader2 className="spin" size={14} />}
      <div className="download-hud-copy">
        <span className="download-hud-label">
          {active.length > 1 ? `${active.length} saving` : labelOf(job)}
        </span>
        <div className={`download-progress ${fraction === null ? 'indeterminate' : ''}`}>
          <div style={fraction === null ? undefined : { width: `${Math.round(fraction * 100)}%` }} />
        </div>
      </div>
      {fraction !== null && (
        <span className="download-hud-pct">{Math.round(fraction * 100)}%</span>
      )}
    </div>
  )
}
