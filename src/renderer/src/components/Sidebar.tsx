import { Film, FolderCog, Image, Images, Loader2, Palette, Settings, TagX, X } from 'lucide-react'
import type { MediaType } from '../../../shared/types'
import { useTheme } from '../themes'
import type { ThemeCopy } from '../themes'

export type TypeFilter = 'all' | MediaType

interface SidebarProps {
  counts: Record<TypeFilter, number>
  typeFilter: TypeFilter
  onTypeFilter: (filter: TypeFilter) => void
  untaggedCount: number
  untaggedView: boolean
  onUntaggedView: () => void
  tagCounts: [string, number][]
  activeTags: string[]
  onToggleTag: (tag: string) => void
  onClearTags: () => void
  root: string
  onChangeRepository: () => void
  onOpenScroller: () => void
  onOpenQueue: () => void
  onOpenPixel: () => void
  onOpenTrimmer: () => void
  onOpenTimeDilation: () => void
  onOpenGif: () => void
  onOpenThemes: () => void
  onOpenSettings: () => void
  previewsPending: number
}

const TYPE_ENTRIES: { key: TypeFilter; label: keyof ThemeCopy; icon: typeof Images }[] = [
  { key: 'all', label: 'allMedia', icon: Images },
  { key: 'image', label: 'photos', icon: Image },
  { key: 'video', label: 'videos', icon: Film }
]

export function Sidebar(props: SidebarProps) {
  const { copy, icons } = useTheme()
  const {
    brand: BrandIcon,
    tag: TagIcon,
    scroller: ScrollerIcon,
    queue: QueueIcon,
    pixelPerfection: PixelIcon,
    trimmer: TrimmerIcon,
    timeDilation: DilationIcon,
    goonImageFormat: GifIcon
  } = icons

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-logo">
          <BrandIcon size={18} />
        </div>
        <span className="brand-name">{copy.appName}</span>
        <div className="brand-actions">
          <button className="btn btn-ghost btn-icon" onClick={props.onOpenSettings} title="Settings">
            <Settings size={16} />
          </button>
          <button className="btn btn-ghost btn-icon" onClick={props.onOpenThemes} title="Theme">
            <Palette size={16} />
          </button>
        </div>
      </div>

      <nav className="sidebar-section">
        <div className="sidebar-heading">{copy.libraryHeading}</div>
        {TYPE_ENTRIES.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            className={`nav-item ${props.typeFilter === key && !props.untaggedView ? 'active' : ''}`}
            onClick={() => props.onTypeFilter(key)}
          >
            <Icon size={16} />
            <span className="nav-label">{copy[label]}</span>
            <span className="nav-count">{props.counts[key]}</span>
          </button>
        ))}
        <button
          className={`nav-item ${props.untaggedView ? 'active' : ''}`}
          onClick={props.onUntaggedView}
          title="Quickly tag media that doesn't have any tags yet"
        >
          <TagX size={16} />
          <span className="nav-label">{copy.untagged}</span>
          <span className={`nav-count ${props.untaggedCount > 0 ? 'nav-count-alert' : ''}`}>
            {props.untaggedCount}
          </span>
        </button>
      </nav>

      <nav className="sidebar-section">
        <div className="sidebar-heading">{copy.labsHeading}</div>
        <button className="nav-item" onClick={props.onOpenScroller}>
          <ScrollerIcon size={16} />
          <span className="nav-label">{copy.scroller}</span>
        </button>
        <button className="nav-item" onClick={props.onOpenQueue}>
          <QueueIcon size={16} />
          <span className="nav-label">{copy.queue}</span>
        </button>
        <button className="nav-item" onClick={props.onOpenPixel}>
          <PixelIcon size={16} />
          <span className="nav-label">{copy.pixelPerfection}</span>
          <span className="lab-experimental">Experimental</span>
        </button>
        {props.previewsPending > 0 && (
          <div
            className="sidebar-note"
            title="Small preview copies let the Scroller play many videos at once smoothly"
          >
            <Loader2 size={12} className="spin" />
            Optimizing {props.previewsPending} video{props.previewsPending === 1 ? '' : 's'}…
          </div>
        )}
      </nav>

      <nav className="sidebar-section">
        <div className="sidebar-heading">{copy.utilitiesHeading}</div>
        <button className="nav-item" onClick={props.onOpenTrimmer}>
          <TrimmerIcon size={16} />
          <span className="nav-label">{copy.trimmer}</span>
        </button>
        <button className="nav-item" onClick={props.onOpenTimeDilation}>
          <DilationIcon size={16} />
          <span className="nav-label">{copy.timeDilation}</span>
        </button>
        <button className="nav-item" onClick={props.onOpenGif} title="Goon Image Format (GIF)">
          <GifIcon size={16} />
          <span className="nav-label">{copy.goonImageFormat}</span>
        </button>
      </nav>

      <div className="sidebar-section sidebar-tags">
        <div className="sidebar-heading">
          {copy.tagsHeading}
          {props.activeTags.length > 0 && (
            <button className="link-btn" onClick={props.onClearTags}>
              Clear
            </button>
          )}
        </div>
        {props.tagCounts.length === 0 ? (
          <p className="sidebar-empty">{copy.tagsEmpty}</p>
        ) : (
          <div className="tag-list">
            {props.tagCounts.map(([tag, count]) => {
              const active = props.activeTags.includes(tag)
              return (
                <button
                  key={tag}
                  className={`nav-item tag-item ${active ? 'active' : ''}`}
                  onClick={() => props.onToggleTag(tag)}
                  title={active ? 'Remove filter' : 'Filter by this tag'}
                >
                  <TagIcon size={14} />
                  <span className="nav-label">{tag}</span>
                  {active ? <X size={14} /> : <span className="nav-count">{count}</span>}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div className="repo-card">
        <div className="repo-label">Repository</div>
        <div className="repo-path" title={props.root}>
          {props.root}
        </div>
        <button className="btn btn-ghost btn-sm" onClick={props.onChangeRepository}>
          <FolderCog size={14} /> Change folder
        </button>
      </div>
    </aside>
  )
}
