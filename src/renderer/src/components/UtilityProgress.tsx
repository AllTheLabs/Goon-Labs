import { Check, Loader2 } from 'lucide-react'
import type { JobProgress } from '../../../shared/types'

interface UtilityProgressProps {
  open: boolean
  progress: JobProgress | null
  title: string
}

/** Blocking encode/scan popup — the user cannot leave until the job finishes. */
export function UtilityProgress({ open, progress, title }: UtilityProgressProps) {
  if (!open) return null
  const percent = Math.round((progress?.percent ?? 0) * 100)
  return (
    <div className="modal-backdrop dilation-progress-backdrop">
      <div className="modal dilation-progress" role="alertdialog" aria-busy="true" aria-live="polite">
        <header className="modal-header">
          <div className="modal-icon">
            <Loader2 className="spin" size={20} />
          </div>
          <div>
            <h2>{progress?.title ?? title}</h2>
            <p>{progress?.detail || 'Please wait — this window will close when the file is ready.'}</p>
          </div>
        </header>
        <div className="dilation-progress-bar" aria-hidden="true">
          <span style={{ width: `${percent}%` }} />
        </div>
        <div className="dilation-progress-meta">
          <span>{percent}%</span>
          {progress && progress.total > 0 && (
            <span>
              {progress.current} / {progress.total} pieces
            </span>
          )}
        </div>
        {progress && progress.steps.length > 0 && (
          <ol className="dilation-progress-steps">
            {progress.steps.map((entry) => (
              <li key={entry.id} className={entry.state}>
                <span className="dilation-progress-mark">
                  {entry.state === 'done' ? (
                    <Check size={14} />
                  ) : entry.state === 'active' ? (
                    <Loader2 className="spin" size={14} />
                  ) : (
                    <span className="dilation-progress-dot" />
                  )}
                </span>
                {entry.label}
              </li>
            ))}
          </ol>
        )}
        <p className="dilation-progress-lock">This has to finish before you can leave.</p>
      </div>
    </div>
  )
}
