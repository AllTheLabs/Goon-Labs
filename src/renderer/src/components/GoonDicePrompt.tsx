import { useEffect, useState } from 'react'
import { Dices, X } from 'lucide-react'
import type { GoonDiceSettings } from '../goonDice'

interface GoonDicePromptProps {
  settings: GoonDiceSettings
  /** Settings icon reopens this after the first time; Roll still starts a session. */
  fromSettings: boolean
  onClose: () => void
  onSave: (settings: GoonDiceSettings) => void
  onRoll: (settings: GoonDiceSettings) => void
}

export function GoonDicePrompt({ settings, fromSettings, onClose, onSave, onRoll }: GoonDicePromptProps) {
  const [experimental, setExperimental] = useState(settings.experimental)
  const [remember, setRemember] = useState(true)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const nextSettings = (): GoonDiceSettings => ({
    asked: remember,
    experimental
  })

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal goon-dice-prompt" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <div className="modal-icon">
            <Dices size={20} />
          </div>
          <div>
            <h2>I&apos;m feeling lucky</h2>
            <p>A random lab with random media that lab can actually play.</p>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <label className={`endless-toggle ${experimental ? 'on' : ''}`}>
          <input
            type="checkbox"
            checked={experimental}
            onChange={(e) => setExperimental(e.target.checked)}
          />
          <span>
            <strong>Include experimental labs</strong>
            <small>Pixel Perfection and Still Station can come up too.</small>
          </span>
        </label>

        <label className={`endless-toggle ${remember ? 'on' : ''}`}>
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <span>
            <strong>Remember my option</strong>
            <small>Don&apos;t ask again. The gear next to I&apos;m feeling lucky brings this back.</small>
          </span>
        </label>

        <footer className="modal-footer">
          {fromSettings && (
            <button className="btn btn-secondary" onClick={() => onSave(nextSettings())}>
              Save
            </button>
          )}
          <button className="btn btn-primary" onClick={() => onRoll(nextSettings())}>
            <Dices size={16} /> Roll
          </button>
        </footer>
      </div>
    </div>
  )
}
