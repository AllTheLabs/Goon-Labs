import { useId, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Plus, X } from 'lucide-react'
import { parseTagInput } from '../utils'

export interface TagChip {
  tag: string
  /** Shown for bulk edits where only some of the selected items have the tag. */
  note?: string
}

interface TagEditorProps {
  tags: TagChip[]
  suggestions: string[]
  /** Offered as one-click chips under the input. */
  quickTags?: string[]
  placeholder?: string
  autoFocus?: boolean
  onAdd: (tags: string[]) => void
  onRemove: (tag: string) => void
  /** Called when Enter is pressed with nothing typed. */
  onSubmitEmpty?: () => void
}

export function TagEditor({
  tags,
  suggestions,
  quickTags = [],
  placeholder,
  autoFocus,
  onAdd,
  onRemove,
  onSubmitEmpty
}: TagEditorProps) {
  const [value, setValue] = useState('')
  const listId = useId()
  const present = new Set(tags.filter((t) => !t.note).map((t) => t.tag))
  const quick = quickTags.filter((tag) => !present.has(tag))

  const commit = () => {
    const parsed = parseTagInput(value)
    if (parsed.length > 0) onAdd(parsed)
    setValue('')
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && value.trim() === '' && onSubmitEmpty) {
      e.preventDefault()
      onSubmitEmpty()
    } else if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Escape') {
      setValue('')
      e.currentTarget.blur()
    }
  }

  return (
    <div className="tag-editor">
      {tags.length > 0 && (
        <div className="tag-chips">
          {tags.map(({ tag, note }) => (
            <span key={tag} className={`tag-chip ${note ? 'partial' : ''}`}>
              {tag}
              {note && <span className="tag-note">{note}</span>}
              <button aria-label={`Remove tag ${tag}`} onClick={() => onRemove(tag)}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="tag-input-row">
        <input
          className="input"
          value={value}
          list={listId}
          autoFocus={autoFocus}
          placeholder={placeholder ?? 'Add tags, separated by commas'}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button className="btn btn-secondary btn-icon" onClick={commit} aria-label="Add tag">
          <Plus size={16} />
        </button>
        <datalist id={listId}>
          {suggestions
            .filter((s) => !present.has(s))
            .map((s) => (
              <option key={s} value={s} />
            ))}
        </datalist>
      </div>
      {quick.length > 0 && (
        <div className="quick-tags">
          {quick.map((tag) => (
            <button
              key={tag}
              className="quick-tag"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onAdd([tag])}
              title={`Add “${tag}”`}
            >
              <Plus size={11} />
              {tag}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
