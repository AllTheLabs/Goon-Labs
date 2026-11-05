import { useEffect, useState } from 'react'
import { Film, Folder, FolderOpen, Image } from 'lucide-react'
import { useTheme } from '../themes'
import { GoonStreak } from './GoonStreak'

interface WelcomeProps {
  onChoose: () => void
}

export function Welcome({ onChoose }: WelcomeProps) {
  const { copy, icons } = useTheme()
  const BrandIcon = icons.brand
  const [discordOn, setDiscordOn] = useState(false)

  useEffect(() => {
    window.api.getAppSettings().then((settings) => setDiscordOn(settings.discordRichPresence))
  }, [])

  return (
    <div className="welcome">
      <div className="welcome-card">
        <div className="welcome-logo">
          <BrandIcon size={34} />
        </div>
        <h1>{copy.welcomeTitle}</h1>
        <GoonStreak />
        <p>
          Choose a folder to use as your media repository. A <strong>Pictures</strong>,{' '}
          <strong>Videos</strong>, and <strong>sessions</strong> folder will be created inside it.
          Imports go into Pictures or Videos; lab recordings save to sessions.
        </p>

        <div className="folder-tree">
          <div className="folder-tree-row">
            <Folder size={16} /> Your repository folder
          </div>
          <div className="folder-tree-row nested">
            <Image size={16} /> Pictures
          </div>
          <div className="folder-tree-row nested">
            <Film size={16} /> Videos
          </div>
          <div className="folder-tree-row nested">
            <Film size={16} /> sessions
          </div>
        </div>

        <label className={`endless-toggle welcome-discord ${discordOn ? 'on' : ''}`}>
          <input
            type="checkbox"
            checked={discordOn}
            onChange={async (e) => {
              const on = e.target.checked
              setDiscordOn(on)
              await window.api.setDiscordRichPresence(on)
            }}
          />
          <span>
            <strong>Show Goon Labs on Discord</strong>
            <small>
              Optional. Friends see Goon Labs, your goon streak, and which lab you are in — not
              your library. You can change this later in Settings.
            </small>
          </span>
        </label>

        <button className="btn btn-primary btn-lg" onClick={onChoose}>
          <FolderOpen size={18} /> Choose repository folder
        </button>
      </div>
    </div>
  )
}
