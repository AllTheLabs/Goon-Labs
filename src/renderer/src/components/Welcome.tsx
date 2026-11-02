import { Film, Folder, FolderOpen, Image } from 'lucide-react'
import { useTheme } from '../themes'

interface WelcomeProps {
  onChoose: () => void
}

export function Welcome({ onChoose }: WelcomeProps) {
  const { copy, icons } = useTheme()
  const BrandIcon = icons.brand
  return (
    <div className="welcome">
      <div className="welcome-card">
        <div className="welcome-logo">
          <BrandIcon size={34} />
        </div>
        <h1>{copy.welcomeTitle}</h1>
        <p>
          Choose a folder to use as your media repository. A <strong>Pictures</strong> and a{' '}
          <strong>Videos</strong> folder will be created inside it, and everything you import is
          sorted into the right one automatically.
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
        </div>

        <button className="btn btn-primary btn-lg" onClick={onChoose}>
          <FolderOpen size={18} /> Choose repository folder
        </button>
      </div>
    </div>
  )
}
