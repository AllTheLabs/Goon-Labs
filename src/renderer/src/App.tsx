import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent } from 'react'
import {
  CheckSquare,
  Clock,
  Download,
  FolderInput,
  Image,
  ImagePlus,
  Link,
  Loader2,
  RefreshCw,
  Search,
  Scissors,
  SearchX,
  TagX,
  Trash2,
  Upload,
  X
} from 'lucide-react'
import type { DownloadJob, ImportResult, LibraryState, MediaItem } from '../../shared/types'
import { DetailsPanel } from './components/DetailsPanel'
import { MediaGrid } from './components/MediaGrid'
import { Scroller } from './components/Scroller'
import { ScrollerSetup } from './components/ScrollerSetup'
import { HypnoPlayer } from './components/HypnoPlayer'
import { HypnoSetup } from './components/HypnoSetup'
import type { HypnoSettings } from './components/HypnoSetup'
import { PixelPlayer } from './components/PixelPlayer'
import { PixelSetup } from './components/PixelSetup'
import type { PixelSettings } from './components/PixelSetup'
import { QueuePlayer } from './components/QueuePlayer'
import { QueueSetup } from './components/QueueSetup'
import type { QueueEntry, QueueSettings } from './components/QueueSetup'
import { Settings } from './components/Settings'
import { Sidebar } from './components/Sidebar'
import type { TypeFilter } from './components/Sidebar'
import { GifMaker } from './components/GifMaker'
import { GifSetup } from './components/GifSetup'
import { TimeDilation } from './components/TimeDilation'
import { TimeDilationSetup } from './components/TimeDilationSetup'
import { Trimmer } from './components/Trimmer'
import { TrimmerSetup } from './components/TrimmerSetup'
import { ThemePicker } from './components/ThemePicker'
import { UrlImport } from './components/UrlImport'
import type { LabPrefs } from './labPrefs'
import { useTheme } from './themes'
import { Toasts } from './components/Toasts'
import type { Toast, ToastKind } from './components/Toasts'
import { Viewer } from './components/Viewer'
import { Welcome } from './components/Welcome'
import { useAppUpdate } from './appUpdate'
import { useDiscordPresence } from './discordPresence'
import { plural } from './utils'

type SortKey = 'newest' | 'oldest' | 'name' | 'size'

const SORTERS: Record<SortKey, (a: MediaItem, b: MediaItem) => number> = {
  newest: (a, b) => b.importedAt.localeCompare(a.importedAt),
  oldest: (a, b) => a.importedAt.localeCompare(b.importedAt),
  name: (a, b) => a.fileName.localeCompare(b.fileName, undefined, { numeric: true }),
  size: (a, b) => b.size - a.size
}

function matchesQuery(item: MediaItem, terms: string[]): boolean {
  const name = item.fileName.toLowerCase()
  return terms.every((term) => name.includes(term) || item.tags.some((tag) => tag.includes(term)))
}

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)
}

export function App() {
  const [library, setLibrary] = useState<LibraryState | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [untaggedView, setUntaggedView] = useState(false)
  const [activeTags, setActiveTags] = useState<string[]>([])
  const [sort, setSort] = useState<SortKey>('newest')
  const [thumbSize, setThumbSize] = useState(200)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [activeId, setActiveId] = useState<string | null>(null)
  const [viewerId, setViewerId] = useState<string | null>(null)
  const [scroller, setScroller] = useState<
    'setup' | { videos: MediaItem[]; tags: string[]; launch: LabPrefs } | null
  >(null)
  const [queue, setQueue] = useState<
    'setup' | { entries: QueueEntry[]; settings: QueueSettings; launch: LabPrefs } | null
  >(null)
  const [pixel, setPixel] = useState<
    'setup' | { entries: QueueEntry[]; settings: PixelSettings; launch: LabPrefs } | null
  >(null)
  const [hypno, setHypno] = useState<
    'setup' | { entries: QueueEntry[]; settings: HypnoSettings; launch: LabPrefs } | null
  >(null)
  const [trimmer, setTrimmer] = useState<'pick' | MediaItem | null>(null)
  const [dilation, setDilation] = useState<'pick' | MediaItem | null>(null)
  const [gifMaker, setGifMaker] = useState<'pick' | MediaItem | null>(null)
  const [themesOpen, setThemesOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [urlImportOpen, setUrlImportOpen] = useState(false)
  const [downloads, setDownloads] = useState<DownloadJob[]>([])
  const { copy } = useTheme()

  const [toasts, setToasts] = useState<Toast[]>([])
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const toastId = useRef(0)

  const items = library?.items ?? []

  const notify = useCallback((kind: ToastKind, title: string, detail?: string) => {
    const id = ++toastId.current
    setToasts((current) => [...current, { id, kind, title, detail }])
    setTimeout(
      () => setToasts((current) => current.filter((t) => t.id !== id)),
      kind === 'error' ? 9000 : 5000
    )
  }, [])

  useEffect(() => {
    window.api
      .getLibrary()
      .then(setLibrary)
      .catch((err: Error) => notify('error', 'Could not open repository', err.message))
      .finally(() => setLoading(false))
  }, [notify])

  useEffect(
    () =>
      window.api.onPreviewReady(({ id, remaining }) =>
        setLibrary(
          (lib) =>
            lib && {
              ...lib,
              previewIds: id ? [...lib.previewIds, id] : lib.previewIds,
              previewsPending: remaining
            }
        )
      ),
    []
  )
  // Downloads are tracked here (not in the dialog) so they keep updating when it's closed.
  const urlImportOpenRef = useRef(urlImportOpen)
  urlImportOpenRef.current = urlImportOpen
  useEffect(() => {
    window.api.getDownloads().then(setDownloads)
    return window.api.onDownloadUpdate((job) => {
      setDownloads((current) => {
        const index = current.findIndex((j) => j.id === job.id)
        if (index < 0) return [...current, job]
        const next = [...current]
        next[index] = job
        return next
      })
      if (job.status === 'done' && job.item) {
        const item = job.item
        setLibrary(
          (lib) => lib && (lib.items.some((i) => i.id === item.id) ? lib : { ...lib, items: [...lib.items, item] })
        )
        if (!urlImportOpenRef.current) {
          notify('success', 'Download finished', `${item.fileName} → ${item.type === 'video' ? 'Videos' : 'Pictures'}`)
        }
      } else if (job.status === 'failed' && !urlImportOpenRef.current) {
        notify('error', 'Download failed', `${job.url}\n${job.error ?? ''}`)
      }
    })
  }, [notify])
  const activeDownloads = downloads.filter((job) =>
    ['queued', 'downloading', 'importing'].includes(job.status)
  ).length

  const previewIds = useMemo(() => new Set(library?.previewIds ?? []), [library?.previewIds])

  const counts = useMemo(
    () => ({
      all: items.length,
      image: items.filter((i) => i.type === 'image').length,
      video: items.filter((i) => i.type === 'video').length
    }),
    [items]
  )

  const tagCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const item of items) for (const tag of item.tags) map.set(tag, (map.get(tag) ?? 0) + 1)
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [items])
  const allTags = useMemo(() => tagCounts.map(([tag]) => tag), [tagCounts])
  const untaggedCount = useMemo(() => items.filter((item) => item.tags.length === 0).length, [items])

  const visible = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    return items
      .filter((item) => {
        if (untaggedView) {
          // Keep the current selection on screen after tagging so more tags can be added.
          return item.tags.length === 0 || selected.has(item.id)
        }
        return typeFilter === 'all' || item.type === typeFilter
      })
      .filter((item) => untaggedView || activeTags.every((tag) => item.tags.includes(tag)))
      .filter((item) => matchesQuery(item, terms))
      .sort(SORTERS[sort])
  }, [items, query, typeFilter, activeTags, sort, untaggedView, selected])

  // Keep the selection limited to what's on screen so exports never include hidden items.
  useEffect(() => {
    const visibleIds = new Set(visible.map((item) => item.id))
    setSelected((current) => {
      const pruned = [...current].filter((id) => visibleIds.has(id))
      return pruned.length === current.size ? current : new Set(pruned)
    })
  }, [visible])

  const selectedItems = useMemo(
    () => visible.filter((item) => selected.has(item.id)),
    [visible, selected]
  )

  const mergeItems = useCallback((updated: MediaItem[]) => {
    const byId = new Map(updated.map((item) => [item.id, item]))
    setLibrary((lib) => lib && { ...lib, items: lib.items.map((i) => byId.get(i.id) ?? i) })
  }, [])

  const chooseRepository = async () => {
    try {
      const next = await window.api.chooseRepository()
      if (!next) return
      setLibrary(next)
      setSelected(new Set())
      setActiveTags([])
      setUntaggedView(false)
      setActiveId(null)
      notify('success', 'Repository ready', `Using ${next.root}`)
    } catch (err) {
      notify('error', 'Could not open that folder', (err as Error).message)
    }
  }

  const runImport = useCallback(
    async (task: () => Promise<ImportResult | null>) => {
      setBusy('Importing media…')
      try {
        const result = await task()
        if (!result) return
        const { imported, skipped } = result
        if (imported.length > 0) {
          setLibrary((lib) => lib && { ...lib, items: [...lib.items, ...imported] })
          setSelected(new Set(imported.map((i) => i.id)))
          setActiveId(imported[0].id)
          const photos = imported.filter((i) => i.type === 'image').length
          notify(
            'success',
            `Imported ${plural(imported.length, 'item')}`,
            `${plural(photos, 'photo')} → Pictures, ${plural(imported.length - photos, 'video')} → Videos`
          )
        }
        if (skipped.length > 0) {
          const reasons = [...new Set(skipped.map((s) => s.reason))].join('; ')
          notify(imported.length ? 'info' : 'error', `Skipped ${plural(skipped.length, 'file')}`, reasons)
        }
      } catch (err) {
        notify('error', 'Import failed', (err as Error).message)
      } finally {
        setBusy(null)
      }
    },
    [notify]
  )

  const refresh = async () => {
    setBusy('Rescanning repository…')
    try {
      const next = await window.api.refreshLibrary()
      if (next) setLibrary(next)
    } finally {
      setBusy(null)
    }
  }

  const addTags = useCallback(
    async (ids: string[], tags: string[]) => {
      try {
        mergeItems(await window.api.addTags(ids, tags))
      } catch (err) {
        notify('error', 'Could not add tags', (err as Error).message)
      }
    },
    [mergeItems, notify]
  )

  const removeTag = useCallback(
    async (ids: string[], tag: string) => {
      try {
        mergeItems(await window.api.removeTag(ids, tag))
      } catch (err) {
        notify('error', 'Could not remove tag', (err as Error).message)
      }
    },
    [mergeItems, notify]
  )

  const deleteItems = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return
      try {
        if (!(await window.api.confirmDelete(ids))) return
      } catch (err) {
        notify('error', 'Could not delete', (err as Error).message)
        return
      }

      const removing = new Set(ids)
      if (viewerId && removing.has(viewerId)) {
        const index = visible.findIndex((item) => item.id === viewerId)
        const next =
          visible.slice(index + 1).find((item) => !removing.has(item.id)) ??
          visible.slice(0, index).reverse().find((item) => !removing.has(item.id))
        setViewerId(next?.id ?? null)
      }
      setSelected((current) => new Set([...current].filter((id) => !removing.has(id))))
      if (activeId && removing.has(activeId)) setActiveId(null)

      setBusy(ids.length === 1 ? 'Deleting…' : `Deleting ${ids.length} items…`)
      try {
        await new Promise((resolve) => setTimeout(resolve, 60))
        const result = await window.api.deleteItems(ids)
        const gone = new Set(result.deletedIds)
        setLibrary(
          (lib) =>
            lib && {
              ...lib,
              items: lib.items.filter((item) => !gone.has(item.id)),
              previewIds: lib.previewIds.filter((id) => !gone.has(id))
            }
        )
        if (result.deletedIds.length > 0) {
          notify(
            'success',
            `Deleted ${plural(result.deletedIds.length, 'item')}`,
            'Moved to the Recycle Bin'
          )
        }
        if (result.failed.length > 0) {
          notify(
            'error',
            `${plural(result.failed.length, 'item')} could not be deleted`,
            result.failed.map((f) => `${f.fileName}: ${f.reason}`).join('\n')
          )
        }
      } catch (err) {
        notify('error', 'Could not delete', (err as Error).message)
      } finally {
        setBusy(null)
      }
    },
    [activeId, notify, viewerId, visible]
  )

  const exportSelected = async () => {
    const ids = selectedItems.map((item) => item.id)
    if (ids.length === 0) return
    try {
      const result = await window.api.exportItems(ids)
      if (!result) return
      if (result.exported > 0) {
        const copies = result.exported === 1 ? '1 copy' : `${result.exported} copies`
        notify('success', `Exported ${copies}`, result.destination)
      }
      if (result.failed.length > 0) {
        notify(
          'error',
          `${plural(result.failed.length, 'item')} could not be exported`,
          result.failed.map((f) => `${f.fileName}: ${f.reason}`).join('\n')
        )
      }
    } catch (err) {
      notify('error', 'Export failed', (err as Error).message)
    }
  }

  const handleItemClick = useCallback(
    (id: string, event: MouseEvent) => {
      if (event.shiftKey && activeId) {
        const from = visible.findIndex((i) => i.id === activeId)
        const to = visible.findIndex((i) => i.id === id)
        if (from >= 0 && to >= 0) {
          const range = visible.slice(Math.min(from, to), Math.max(from, to) + 1).map((i) => i.id)
          setSelected((current) =>
            event.ctrlKey || event.metaKey ? new Set([...current, ...range]) : new Set(range)
          )
          return
        }
      }
      if (event.ctrlKey || event.metaKey) {
        setSelected((current) => {
          const next = new Set(current)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return next
        })
      } else {
        setSelected(new Set([id]))
      }
      setActiveId(id)
    },
    [activeId, visible]
  )

  const toggleCheck = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setActiveId(id)
  }, [])

  const selectAll = useCallback(() => setSelected(new Set(visible.map((i) => i.id))), [visible])
  const clearSelection = useCallback(() => setSelected(new Set()), [])
  const closeViewer = useCallback(() => setViewerId(null), [])
  const closeScroller = useCallback(() => setScroller(null), [])
  const closeQueue = useCallback(() => setQueue(null), [])
  const closePixel = useCallback(() => setPixel(null), [])
  const closeHypno = useCallback(() => setHypno(null), [])
  const closeTrimmer = useCallback(() => setTrimmer(null), [])
  const closeDilation = useCallback(() => setDilation(null), [])
  const closeGif = useCallback(() => setGifMaker(null), [])
  const finishTrim = useCallback(
    (item: MediaItem, replaced: boolean) => {
      if (replaced) {
        mergeItems([item])
        notify('success', 'Video trimmed', item.fileName)
      } else {
        setLibrary((lib) => lib && { ...lib, items: [...lib.items, item] })
        notify('success', 'Trimmed copy saved', item.fileName)
      }
      setSelected(new Set([item.id]))
      setActiveId(item.id)
      setTrimmer(null)
    },
    [mergeItems, notify]
  )
  const finishDilation = useCallback(
    (item: MediaItem, replaced: boolean) => {
      if (replaced) {
        mergeItems([item])
        notify('success', 'Video time-dilated', item.fileName)
      } else {
        setLibrary((lib) => lib && { ...lib, items: [...lib.items, item] })
        notify('success', 'Time-dilated copy saved', item.fileName)
      }
      setSelected(new Set([item.id]))
      setActiveId(item.id)
      setDilation(null)
    },
    [mergeItems, notify]
  )
  const finishGif = useCallback(
    (item: MediaItem, replaced: boolean) => {
      if (replaced) {
        mergeItems([item])
        notify('success', 'Saved as GIF', item.fileName)
      } else {
        setLibrary((lib) => lib && { ...lib, items: [...lib.items, item] })
        notify('success', 'GIF saved', item.fileName)
      }
      setSelected(new Set([item.id]))
      setActiveId(item.id)
      setGifMaker(null)
    },
    [mergeItems, notify]
  )
  const finishQueue = useCallback(
    (played: number, failed: number) => {
      setQueue(null)
      if (played === 0 && failed > 0) {
        notify('error', 'Beat Bar stopped', 'None of the queued videos could be played.')
      } else {
        notify(
          'success',
          'Beat Bar finished',
          `Played ${plural(played, 'video')}${failed > 0 ? `, skipped ${failed} that couldn't play` : ''}.`
        )
      }
    },
    [notify]
  )
  const finishPixel = useCallback(
    (played: number, failed: number) => {
      setPixel(null)
      if (played === 0 && failed > 0) {
        notify('error', 'Pixel Perfection stopped', 'None of the queued videos could be played.')
      } else {
        notify(
          'success',
          'Pixel Perfection finished',
          `Played ${plural(played, 'video')}${failed > 0 ? `, skipped ${failed} that couldn't play` : ''}.`
        )
      }
    },
    [notify]
  )
  const failHypno = useCallback(() => {
    setHypno(null)
    notify('error', 'Hypno Station stopped', 'None of the queued videos could be played.')
  }, [notify])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (viewerId || scroller || queue || pixel || hypno || trimmer || dilation || gifMaker || themesOpen || settingsOpen || urlImportOpen || isTypingTarget(e.target)) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        e.preventDefault()
        setUrlImportOpen(true)
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        selectAll()
      } else if (e.key === 'Escape') {
        clearSelection()
      } else if (e.key === 'Enter' && activeId && selected.has(activeId)) {
        setViewerId(activeId)
      } else if (e.key === 'Delete' && selected.size > 0) {
        e.preventDefault()
        void deleteItems([...selected])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    viewerId,
    scroller,
    queue,
    pixel,
    hypno,
    trimmer,
    dilation,
    gifMaker,
    themesOpen,
    settingsOpen,
    urlImportOpen,
    activeId,
    selected,
    selectAll,
    clearSelection,
    deleteItems
  ])

  // Drag files or folders from Explorer onto the window to import them.
  useEffect(() => {
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      dragDepth.current++
      setDragging(true)
    }
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault()
    }
    const onLeave = () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) setDragging(false)
    }
    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      dragDepth.current = 0
      setDragging(false)
      const paths = [...(e.dataTransfer?.files ?? [])]
        .map((file) => window.api.getPathForFile(file))
        .filter(Boolean)
      if (paths.length > 0 && library) runImport(() => window.api.importPaths(paths))
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragover', onOver)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [library, runImport])

  const activeLab =
    hypno && hypno !== 'setup'
      ? 'Hypno Station'
      : pixel && pixel !== 'setup'
        ? 'Pixel Perfection'
        : queue && queue !== 'setup'
          ? 'Beat Bar'
          : scroller && scroller !== 'setup'
            ? 'Scroller'
            : null
  useDiscordPresence(activeLab)
  const update = useAppUpdate()

  if (loading) {
    return (
      <div className="splash">
        <Loader2 className="spin" size={28} />
      </div>
    )
  }

  if (!library) return <Welcome onChoose={chooseRepository} />

  const viewerIndex = viewerId ? visible.findIndex((i) => i.id === viewerId) : -1
  const filtersActive = query !== '' || activeTags.length > 0 || typeFilter !== 'all' || untaggedView
  const untaggedCaughtUp = untaggedView && untaggedCount === 0 && query === '' && visible.length === 0

  return (
    <div className="app" style={{ '--thumb-size': `${thumbSize}px` } as CSSProperties}>
      <Sidebar
        counts={counts}
        typeFilter={typeFilter}
        onTypeFilter={(filter) => {
          setTypeFilter(filter)
          setUntaggedView(false)
        }}
        untaggedCount={untaggedCount}
        untaggedView={untaggedView}
        onUntaggedView={() => {
          setUntaggedView(true)
          setActiveTags([])
          setSelected((current) => {
            const keep = [...current].filter((id) => {
              const item = items.find((entry) => entry.id === id)
              return item !== undefined && item.tags.length === 0
            })
            return keep.length === current.size ? current : new Set(keep)
          })
        }}
        tagCounts={tagCounts}
        activeTags={activeTags}
        onToggleTag={(tag) => {
          setUntaggedView(false)
          setActiveTags((current) =>
            current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag]
          )
        }}
        onClearTags={() => setActiveTags([])}
        root={library.root}
        onChangeRepository={chooseRepository}
        onOpenScroller={() => setScroller('setup')}
        onOpenQueue={() => setQueue('setup')}
        onOpenPixel={() => setPixel('setup')}
        onOpenHypno={() => setHypno('setup')}
        onOpenTrimmer={() => setTrimmer('pick')}
        onOpenTimeDilation={() => setDilation('pick')}
        onOpenGif={() => setGifMaker('pick')}
        onOpenThemes={() => setThemesOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        previewsPending={library.previewsPending}
      />

      <main className="main">
        <header className="toolbar">
          {(update.state === 'available' ||
            update.state === 'downloading' ||
            update.state === 'ready') && (
            <button
              className="btn btn-primary toolbar-update"
              disabled={update.state !== 'available'}
              onClick={() => void window.api.installUpdate()}
              title={`Download Goon Labs ${update.version} and install it`}
            >
              {update.state === 'available' ? (
                <Download size={16} />
              ) : (
                <Loader2 className="spin" size={16} />
              )}
              {update.state === 'available' && `Update to ${update.version}`}
              {update.state === 'downloading' &&
                `Downloading ${Math.round(update.progress * 100)}%`}
              {update.state === 'ready' && 'Installing…'}
            </button>
          )}
          <div className="search">
            <Search size={16} className="search-icon" />
            <input
              className="input search-input"
              placeholder={copy.searchPlaceholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
            />
            {query && (
              <button className="search-clear" onClick={() => setQuery('')} aria-label="Clear search">
                <X size={14} />
              </button>
            )}
          </div>

          <select className="input select" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="name">Name</option>
            <option value="size">Largest first</option>
          </select>

          <input
            className="size-slider"
            type="range"
            min={130}
            max={340}
            step={10}
            value={thumbSize}
            onChange={(e) => setThumbSize(Number(e.target.value))}
            title="Thumbnail size"
          />

          <div className="toolbar-spacer" />

          <button className="btn btn-ghost btn-icon" onClick={refresh} title="Rescan repository folders">
            <RefreshCw size={16} />
          </button>
          <button
            className="btn btn-secondary url-import-btn"
            onClick={() => setUrlImportOpen(true)}
            title="Download photos and videos from links (Ctrl+V)"
          >
            <Link size={16} /> <span className="btn-label">Import URL</span>
            {activeDownloads > 0 && <span className="btn-badge">{activeDownloads}</span>}
          </button>
          <button className="btn btn-secondary" onClick={() => runImport(() => window.api.importWithDialog('folder'))}>
            <FolderInput size={16} /> Import folder
          </button>
          <button className="btn btn-primary" onClick={() => runImport(() => window.api.importWithDialog('files'))}>
            <ImagePlus size={16} /> Import files
          </button>
        </header>

        <div className={`selection-bar ${selectedItems.length > 0 ? 'open' : ''}`}>
          <span className="selection-count">{plural(selectedItems.length, 'item')} selected</span>
          <button className="btn btn-ghost btn-sm" onClick={selectAll}>
            <CheckSquare size={14} /> Select all ({visible.length})
          </button>
          <button className="btn btn-ghost btn-sm" onClick={clearSelection}>
            <X size={14} /> Clear
          </button>
          <div className="toolbar-spacer" />
          {selectedItems.length === 1 && selectedItems[0].type === 'video' && (
            <>
              <button className="btn btn-secondary btn-sm" onClick={() => setTrimmer(selectedItems[0])}>
                <Scissors size={14} /> Trim
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => setDilation(selectedItems[0])}>
                <Clock size={14} /> Dilate
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => setGifMaker(selectedItems[0])}>
                <Image size={14} /> GIF
              </button>
            </>
          )}
          <button className="btn btn-primary btn-sm" onClick={exportSelected}>
            <Download size={14} /> Export selected
          </button>
          <button className="btn btn-danger btn-sm" onClick={() => deleteItems(selectedItems.map((item) => item.id))}>
            <Trash2 size={14} /> Delete
          </button>
        </div>

        <div className="content" onClick={(e) => e.target === e.currentTarget && clearSelection()}>
          {items.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">
                <Upload size={30} />
              </div>
              <h2>{copy.emptyTitle}</h2>
              <p>{copy.emptyBody}</p>
              <div className="empty-actions">
                <button className="btn btn-primary" onClick={() => runImport(() => window.api.importWithDialog('files'))}>
                  <ImagePlus size={16} /> Import files
                </button>
                <button className="btn btn-secondary" onClick={() => runImport(() => window.api.importWithDialog('folder'))}>
                  <FolderInput size={16} /> Import folder
                </button>
              </div>
            </div>
          ) : visible.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">
                {untaggedCaughtUp ? <TagX size={30} /> : <SearchX size={30} />}
              </div>
              <h2>{untaggedCaughtUp ? copy.untaggedEmptyTitle : 'Nothing matches'}</h2>
              <p>
                {untaggedCaughtUp
                  ? copy.untaggedEmptyBody
                  : 'Try a different search or clear your filters.'}
              </p>
              {filtersActive && (
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    setQuery('')
                    setActiveTags([])
                    setTypeFilter('all')
                    setUntaggedView(false)
                  }}
                >
                  Clear all filters
                </button>
              )}
            </div>
          ) : (
            <MediaGrid
              items={visible}
              selected={selected}
              activeId={activeId}
              onItemClick={handleItemClick}
              onToggleCheck={toggleCheck}
              onOpen={setViewerId}
            />
          )}
        </div>
      </main>

      <DetailsPanel
        items={selectedItems}
        allTags={allTags}
        autoFocusTags={untaggedView}
        tagHint={untaggedView ? copy.untaggedHint : undefined}
        quickTags={untaggedView ? allTags : []}
        onAddTags={addTags}
        onRemoveTag={removeTag}
        onOpenViewer={setViewerId}
        onOpenTrimmer={(item) => setTrimmer(item)}
        onOpenTimeDilation={(item) => setDilation(item)}
        onOpenGif={(item) => setGifMaker(item)}
        onReveal={(id) => window.api.revealItem(id)}
        onExport={exportSelected}
        onDelete={() => deleteItems(selectedItems.map((item) => item.id))}
      />

      {viewerIndex >= 0 && (
        <Viewer
          items={visible}
          index={viewerIndex}
          onNavigate={setViewerId}
          onClose={closeViewer}
          onDelete={(id) => deleteItems([id])}
        />
      )}

      {scroller === 'setup' && (
        <ScrollerSetup
          videos={items.filter((item) => item.type === 'video')}
          initialTags={activeTags}
          onStart={(videos, tags, launch) => setScroller({ videos, tags, launch })}
          onClose={closeScroller}
        />
      )}
      {scroller && scroller !== 'setup' && (
        <Scroller
          videos={scroller.videos}
          tags={scroller.tags}
          previewIds={previewIds}
          launch={scroller.launch}
          onClose={closeScroller}
        />
      )}

      {queue === 'setup' && (
        <QueueSetup
          videos={items.filter((item) => item.type === 'video')}
          initialTags={activeTags}
          onStart={(entries, settings, launch) => setQueue({ entries, settings, launch })}
          onClose={closeQueue}
        />
      )}
      {queue && queue !== 'setup' && (
        <QueuePlayer
          entries={queue.entries}
          settings={queue.settings}
          launch={queue.launch}
          onExit={closeQueue}
          onFinished={finishQueue}
        />
      )}

      {pixel === 'setup' && (
        <PixelSetup
          videos={items.filter((item) => item.type === 'video')}
          initialTags={activeTags}
          onStart={(entries, settings, launch) => setPixel({ entries, settings, launch })}
          onClose={closePixel}
        />
      )}
      {pixel && pixel !== 'setup' && (
        <PixelPlayer
          entries={pixel.entries}
          settings={pixel.settings}
          launch={pixel.launch}
          onExit={closePixel}
          onFinished={finishPixel}
        />
      )}

      {hypno === 'setup' && (
        <HypnoSetup
          videos={items.filter((item) => item.type === 'video')}
          initialTags={activeTags}
          onStart={(entries, settings, launch) => setHypno({ entries, settings, launch })}
          onClose={closeHypno}
        />
      )}
      {hypno && hypno !== 'setup' && (
        <HypnoPlayer
          entries={hypno.entries}
          settings={hypno.settings}
          launch={hypno.launch}
          onExit={closeHypno}
          onFailed={failHypno}
        />
      )}

      {trimmer === 'pick' && (
        <TrimmerSetup
          videos={items.filter((item) => item.type === 'video')}
          initialId={selectedItems.length === 1 && selectedItems[0].type === 'video' ? selectedItems[0].id : null}
          onPick={setTrimmer}
          onClose={closeTrimmer}
        />
      )}
      {trimmer && trimmer !== 'pick' && (
        <Trimmer
          item={trimmer}
          onClose={closeTrimmer}
          onPickAnother={() => setTrimmer('pick')}
          onSaved={finishTrim}
        />
      )}

      {dilation === 'pick' && (
        <TimeDilationSetup
          videos={items.filter((item) => item.type === 'video')}
          initialId={selectedItems.length === 1 && selectedItems[0].type === 'video' ? selectedItems[0].id : null}
          onPick={setDilation}
          onClose={closeDilation}
        />
      )}
      {dilation && dilation !== 'pick' && (
        <TimeDilation
          item={dilation}
          onClose={closeDilation}
          onPickAnother={() => setDilation('pick')}
          onSaved={finishDilation}
        />
      )}

      {gifMaker === 'pick' && (
        <GifSetup
          videos={items.filter((item) => item.type === 'video')}
          initialId={selectedItems.length === 1 && selectedItems[0].type === 'video' ? selectedItems[0].id : null}
          onPick={setGifMaker}
          onClose={closeGif}
        />
      )}
      {gifMaker && gifMaker !== 'pick' && (
        <GifMaker
          item={gifMaker}
          onClose={closeGif}
          onPickAnother={() => setGifMaker('pick')}
          onSaved={finishGif}
        />
      )}

      {urlImportOpen && (
        <UrlImport
          jobs={downloads}
          onClose={() => setUrlImportOpen(false)}
          onClear={() => window.api.clearDownloads().then(setDownloads)}
        />
      )}

      {themesOpen && <ThemePicker onClose={() => setThemesOpen(false)} />}
      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}

      {dragging && (
        <div className="drop-overlay">
          <div className="drop-card">
            <Upload size={36} />
            <h2>Drop to import</h2>
            <p>Photos go to Pictures, videos go to Videos.</p>
          </div>
        </div>
      )}

      {busy && (
        <div className="busy">
          <Loader2 className="spin" size={16} /> {busy}
        </div>
      )}

      <Toasts toasts={toasts} onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
    </div>
  )
}
