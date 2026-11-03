import { useTheme } from '../themes'

interface UpdateOverlayProps {
  progress: number
  version: string
  installing: boolean
}

export function UpdateOverlay({ progress, version, installing }: UpdateOverlayProps) {
  const { copy, icons } = useTheme()
  const BrandIcon = icons.brand
  const fill = Math.max(0, Math.min(1, progress))
  const clip = `inset(0 0 ${(1 - fill) * 100}% 0)`

  return (
    <div className="update-overlay" role="alertdialog" aria-live="polite" aria-busy="true">
      <div className="update-card">
        <div className="update-logo">
          <div className="update-logo-layer update-logo-empty">
            <BrandIcon size={40} />
          </div>
          <div className="update-logo-layer update-logo-full" style={{ clipPath: clip }}>
            <BrandIcon size={40} />
          </div>
        </div>
        <h2>{installing ? 'Installing' : 'Updating'}</h2>
        <p>
          {copy.appName} {version}
        </p>
      </div>
    </div>
  )
}
