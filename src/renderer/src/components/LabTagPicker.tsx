import { useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import type { ComponentType } from 'react'
import type { LucideProps } from 'lucide-react'
import type { TagMatch } from './ScrollerSetup'

interface LabTagPickerProps {
  counts: [string, number][]
  selected: string[]
  onToggle: (tag: string) => void
  excluded?: string[]
  onExcluded?: (tags: string[]) => void
  match?: TagMatch
  onMatch?: (match: TagMatch) => void
  icon: ComponentType<LucideProps>
  autoFocus?: boolean
}

function toggleIn(list: string[], tag: string): string[] {
  return list.includes(tag) ? list.filter((entry) => entry !== tag) : [...list, tag]
}

export function LabTagPicker({
  counts,
  selected,
  onToggle,
  excluded = [],
  onExcluded,
  match,
  onMatch,
  icon: TagIcon,
  autoFocus
}: LabTagPickerProps) {
  const [query, setQuery] = useState('')
  const [pickingExclude, setPickingExclude] = useState(false)
  const visible = useMemo(() => {
    const term = query.toLowerCase().trim()
    if (!term) return counts
    return counts.filter(([tag]) => tag.includes(term))
  }, [counts, query])

  if (counts.length === 0) return null

  const clickTag = (tag: string) => {
    if (pickingExclude && onExcluded) {
      if (selected.includes(tag)) onToggle(tag)
      onExcluded(toggleIn(excluded, tag))
      return
    }
    if (excluded.includes(tag)) onExcluded?.(excluded.filter((entry) => entry !== tag))
    onToggle(tag)
  }

  const selectAny = () => {
    setPickingExclude(false)
    onMatch?.('any')
  }
  const selectExclude = () => {
    setPickingExclude(true)
    if (match === 'all') onMatch?.('any')
  }
  const selectAll = () => {
    setPickingExclude(false)
    onExcluded?.([])
    onMatch?.('all')
  }

  return (
    <div className="lab-tag-picker">
      <div className="queue-column-head">
        <span className="field-label">
          Tags{selected.length > 0 ? ` · ${selected.length} on` : ''}
          {excluded.length > 0 ? ` · ${excluded.length} excluded` : ''}
        </span>
        {match && onMatch && (
          <div className="segmented small">
            <button className={!pickingExclude && match === 'any' ? 'active' : ''} onClick={selectAny}>
              Any tag
            </button>
            {onExcluded && (
              <button
                className={`tag-exclude ${pickingExclude ? 'active' : ''}`}
                onClick={selectExclude}
              >
                Exclude tags
              </button>
            )}
            <button className={!pickingExclude && match === 'all' ? 'active' : ''} onClick={selectAll}>
              All tags
            </button>
          </div>
        )}
      </div>
      <div className="search">
        <Search size={16} className="search-icon" />
        <input
          className="input search-input"
          placeholder={pickingExclude ? 'Search tags to exclude…' : 'Search tags…'}
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
              className={`tag-pick ${
                excluded.includes(tag) ? 'excluded' : selected.includes(tag) ? 'active' : ''
              }`}
              onClick={() => clickTag(tag)}
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
