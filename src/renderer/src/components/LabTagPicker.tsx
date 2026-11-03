import { useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import type { ComponentType } from 'react'
import type { LucideProps } from 'lucide-react'
import type { TagMatch } from './ScrollerSetup'

interface LabTagPickerProps {
  counts: [string, number][]
  selected: string[]
  onToggle: (tag: string) => void
  match?: TagMatch
  onMatch?: (match: TagMatch) => void
  icon: ComponentType<LucideProps>
  autoFocus?: boolean
}

export function LabTagPicker({
  counts,
  selected,
  onToggle,
  match,
  onMatch,
  icon: TagIcon,
  autoFocus
}: LabTagPickerProps) {
  const [query, setQuery] = useState('')
  const visible = useMemo(() => {
    const term = query.toLowerCase().trim()
    if (!term) return counts
    return counts.filter(([tag]) => tag.includes(term))
  }, [counts, query])

  if (counts.length === 0) return null

  return (
    <div className="lab-tag-picker">
      <div className="queue-column-head">
        <span className="field-label">Tags{selected.length > 0 ? ` · ${selected.length} on` : ''}</span>
        {match && onMatch && (
          <div className="segmented small">
            <button className={match === 'any' ? 'active' : ''} onClick={() => onMatch('any')}>
              Any tag
            </button>
            <button className={match === 'all' ? 'active' : ''} onClick={() => onMatch('all')}>
              All tags
            </button>
          </div>
        )}
      </div>
      <div className="search">
        <Search size={16} className="search-icon" />
        <input
          className="input search-input"
          placeholder="Search tags…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus={autoFocus}
        />
        {query && (
          <button className="search-clear" onClick={() => setQuery('')} aria-label="Clear tag search">
            <X size={14} />
          </button>
        )}
      </div>
      <div className="tag-picker lab-tags">
        {visible.length === 0 ? (
          <p className="queue-empty">No tags match.</p>
        ) : (
          visible.map(([tag, count]) => (
            <button
              key={tag}
              className={`tag-pick ${selected.includes(tag) ? 'active' : ''}`}
              onClick={() => onToggle(tag)}
            >
              <TagIcon size={13} />
              {tag}
              <span className="tag-pick-count">{count}</span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
