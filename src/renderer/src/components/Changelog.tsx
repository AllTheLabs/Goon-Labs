import { useEffect, type ReactNode } from 'react'
import { Sparkles, X } from 'lucide-react'
import type { AppChangelog } from '../../../shared/types'

interface ChangelogProps {
  notes: AppChangelog
  onClose: () => void
}

function openUrl(url: string) {
  if (!/^https?:\/\//i.test(url)) return
  void window.api.openExternal(url)
}

function inline(text: string): ReactNode[] {
  const chunks = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|https?:\/\/[^\s)]+)/g)
  return chunks.map((chunk, index) => {
    if (chunk.startsWith('**') && chunk.endsWith('**')) {
      return <strong key={index}>{chunk.slice(2, -2)}</strong>
    }
    if (chunk.startsWith('`') && chunk.endsWith('`')) {
      return (
        <code key={index} className="changelog-code">
          {chunk.slice(1, -1)}
        </code>
      )
    }
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(chunk)
    if (link) {
      return (
        <button key={index} className="changelog-link" onClick={() => openUrl(link[2])}>
          {link[1]}
        </button>
      )
    }
    if (/^https?:\/\//i.test(chunk)) {
      return (
        <button key={index} className="changelog-link" onClick={() => openUrl(chunk)}>
          {chunk.replace(/^https?:\/\//i, '')}
        </button>
      )
    }
    return <span key={index}>{chunk}</span>
  })
}

function isListLine(line: string) {
  return /^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line)
}

function List({ lines }: { lines: string[] }) {
  const ordered = lines.every((line) => /^\d+\.\s+/.test(line))
  const Tag = ordered ? 'ol' : 'ul'
  return (
    <Tag>
      {lines.map((line, lineIndex) => (
        <li key={lineIndex}>{inline(line.replace(/^([-*]|\d+\.)\s+/, ''))}</li>
      ))}
    </Tag>
  )
}

function ReleaseBody({ text }: { text: string }) {
  if (!text) return <p className="changelog-empty">No notes for this release.</p>
  const blocks = text.replace(/\r\n/g, '\n').split(/\n{2,}/)
  return (
    <div className="changelog-body">
      {blocks.map((block, index) => {
        const lines = block.split('\n').filter((line) => line.trim() !== '')
        if (lines.length === 0) return null
        if (lines.every(isListLine)) {
          return <List key={index} lines={lines} />
        }
        const heading = /^(#{1,3})\s+(.*)$/.exec(lines[0])
        if (heading) {
          const Tag = heading[1].length === 1 ? 'h4' : 'h5'
          const rest = lines.slice(1)
          return (
            <div key={index}>
              <Tag>{inline(heading[2])}</Tag>
              {rest.length > 0 && rest.every(isListLine) ? (
                <List lines={rest} />
              ) : (
                rest.map((line, lineIndex) => <p key={lineIndex}>{inline(line)}</p>)
              )}
            </div>
          )
        }
        return (
          <p key={index}>
            {lines.map((line, lineIndex) => (
              <span key={lineIndex}>
                {inline(line)}
                {lineIndex < lines.length - 1 ? <br /> : null}
              </span>
            ))}
          </p>
        )
      })}
    </div>
  )
}

export function Changelog({ notes, onClose }: ChangelogProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal changelog-modal" onMouseDown={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <div className="modal-icon">
            <Sparkles size={20} />
          </div>
          <div>
            <h2>What&apos;s new</h2>
            <p>Updated to {notes.currentVersion}</p>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <div className="changelog-list">
          {notes.releases.map((release) => (
            <article key={release.version} className="changelog-release">
              <div className="changelog-release-head">
                <h3>{release.title}</h3>
                {release.url && (
                  <button className="changelog-link" onClick={() => openUrl(release.url)}>
                    GitHub
                  </button>
                )}
              </div>
              <ReleaseBody text={release.body} />
            </article>
          ))}
        </div>

        <footer className="modal-footer">
          <span className="modal-summary">
            {notes.fromVersion === notes.currentVersion
              ? 'This version'
              : `From ${notes.fromVersion}`}
          </span>
          <button className="btn btn-primary" onClick={onClose}>
            Got it
          </button>
        </footer>
      </div>
    </div>
  )
}
