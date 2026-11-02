import { useEffect } from 'react'
import type { CSSProperties } from 'react'
import { Check, Palette, X } from 'lucide-react'
import { THEMES, themeVar, useTheme } from '../themes'
import type { Theme } from '../themes'

interface ThemePickerProps {
  onClose: () => void
}

function ThemeCard({ theme, active, onPick }: { theme: Theme; active: boolean; onPick: () => void }) {
  const v = (name: string) => themeVar(theme, name)
  const style = {
    '--p-bg': v('bg'),
    '--p-elev': v('bg-elev'),
    '--p-elev-2': v('bg-elev-2'),
    '--p-border': v('border'),
    '--p-text': v('text'),
    '--p-dim': v('text-dim'),
    '--p-accent': v('accent'),
    '--p-accent-2': v('accent-2')
  } as CSSProperties

  return (
    <button className={`theme-card ${active ? 'active' : ''}`} onClick={onPick} data-preview={theme.id}>
      <div className="theme-preview" style={style}>
        <div className="theme-preview-side">
          <i className="logo" />
          <i />
          <i className="on" />
          <i />
        </div>
        <div className="theme-preview-main">
          <i className="bar" />
          <div className="tiles">
            <i />
            <i />
            <i />
          </div>
        </div>
        {active && (
          <span className="theme-check">
            <Check size={12} strokeWidth={3} />
          </span>
        )}
      </div>
      <div className="theme-card-text">
        <span className="theme-name">{theme.name}</span>
        <span className="theme-desc">{theme.description}</span>
      </div>
    </button>
  )
}

export function ThemePicker({ onClose }: ThemePickerProps) {
  const { theme: current, setTheme } = useTheme()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const groups: [string, Theme[]][] = [
    ['Standard', THEMES.filter((t) => t.group === 'standard')],
    ['Extra', THEMES.filter((t) => t.group === 'extra')]
  ]

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal theme-modal">
        <div className="modal-header">
          <div className="modal-icon">
            <Palette size={20} />
          </div>
          <div>
            <h2>Theme</h2>
            <p>Changes apply instantly and are remembered next time.</p>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="theme-groups">
          {groups.map(([label, themes]) => (
            <section key={label}>
              <div className="field-label">{label}</div>
              <div className="theme-grid">
                {themes.map((theme) => (
                  <ThemeCard
                    key={theme.id}
                    theme={theme}
                    active={theme.id === current.id}
                    onPick={() => setTheme(theme.id)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
