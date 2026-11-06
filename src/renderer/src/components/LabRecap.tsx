import { useEffect, useMemo } from 'react'
import { Clock, X } from 'lucide-react'
import type { LabRecap as LabRecapData } from '../labRecap'
import { formatDuration } from '../utils'
import { Mascot } from './Mascot'

const RECAP_LINES = [
  "That was great wasn't it?",
  'Hehehe',
  'Going so soon?',
  'That was fun!',
  'Come back soon!',
  'My little gooner <3'
]

interface LabRecapProps {
  recap: LabRecapData
  onClose: () => void
}

export function LabRecap({ recap, onClose }: LabRecapProps) {
  const line = useMemo(() => RECAP_LINES[Math.floor(Math.random() * RECAP_LINES.length)], [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal recap-modal" onMouseDown={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <div className="modal-icon">
            <Clock size={20} />
          </div>
          <div>
            <h2>Session recap</h2>
            <p>{recap.lab}</p>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <div className="recap-hero">
          <div className="recap-mascot-wrap">
            <p className="recap-bubble">{line}</p>
            <Mascot pose="recap" />
          </div>
          <div className="recap-hero-copy">
            <strong>{formatDuration(recap.durationSeconds)}</strong>
            <span>Time in session</span>
          </div>
        </div>

        {recap.stats.length > 0 && (
          <div className="recap-grid">
            {recap.stats.map((stat) => (
              <div key={stat.label} className="recap-stat">
                <span>{stat.label}</span>
                <strong>{stat.value}</strong>
              </div>
            ))}
          </div>
        )}

        <footer className="modal-footer">
          <span className="modal-summary">Until next time</span>
          <button className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </div>
  )
}
