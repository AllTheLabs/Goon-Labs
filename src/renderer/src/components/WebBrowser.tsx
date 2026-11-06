import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowLeft, ArrowRight, Loader2, RotateCw, X } from 'lucide-react'
import type { BrowserNavState, DownloadJob } from '../../../shared/types'
import { useTheme } from '../themes'
import { DownloadHud } from './DownloadHud'

const EMPTY_STATE: BrowserNavState = {
  url: '',
  title: '',
  canGoBack: false,
  canGoForward: false,
  loading: false
}

function displayUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.hostname === 'duckduckgo.com' && parsed.pathname === '/') {
      const query = parsed.searchParams.get('q')
      if (query) return query
      return ''
    }
  } catch {
    /* not a URL yet */
  }
  return url
}

export function WebBrowser({
  occluded,
  jobs,
  onClose
}: {
  occluded: boolean
  jobs: DownloadJob[]
  onClose: () => void
}) {
  const { copy, icons } = useTheme()
  const SearchIcon = icons.webBrowser
  const paneRef = useRef<HTMLDivElement>(null)
  const editing = useRef(false)
  const [state, setState] = useState(EMPTY_STATE)
  const [draft, setDraft] = useState('')

  const syncBounds = useCallback(() => {
    const pane = paneRef.current
    if (!pane) return
    const rect = pane.getBoundingClientRect()
    void window.api.setBrowserBounds({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height
    })
  }, [])

  useEffect(() => {
    return window.api.onBrowserState((next) => {
      setState(next)
      if (!editing.current) setDraft(displayUrl(next.url))
    })
  }, [])

  useLayoutEffect(() => {
    const pane = paneRef.current
    if (!pane) return
    const rect = pane.getBoundingClientRect()
    void window.api.openBrowser({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height
    })
    const observer = new ResizeObserver(syncBounds)
    observer.observe(pane)
    window.addEventListener('resize', syncBounds)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', syncBounds)
      void window.api.closeBrowser()
    }
  }, [syncBounds])

  useEffect(() => {
    void window.api.setBrowserVisible(!occluded)
    if (!occluded) syncBounds()
  }, [occluded, syncBounds])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    editing.current = false
    void window.api.browserNavigate(draft)
  }

  return (
    <div className="web-browser">
      <header className="toolbar web-browser-toolbar">
        <button
          className="btn btn-ghost btn-icon"
          disabled={!state.canGoBack}
          onClick={() => window.api.browserBack()}
          title="Back"
        >
          <ArrowLeft size={16} />
        </button>
        <button
          className="btn btn-ghost btn-icon"
          disabled={!state.canGoForward}
          onClick={() => window.api.browserForward()}
          title="Forward"
        >
          <ArrowRight size={16} />
        </button>
        <button
          className="btn btn-ghost btn-icon"
          onClick={() => window.api.browserReload()}
          title={state.loading ? 'Stop' : 'Reload'}
        >
          {state.loading ? <Loader2 className="spin" size={16} /> : <RotateCw size={16} />}
        </button>
        <form className="web-browser-omnibox" onSubmit={submit}>
          <SearchIcon className="web-browser-omnibox-icon" size={16} />
          <input
            className="input web-browser-input"
            value={draft}
            placeholder={copy.webSearchPlaceholder}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            onFocus={(event) => {
              editing.current = true
              event.currentTarget.select()
            }}
            onBlur={() => {
              editing.current = false
              setDraft(displayUrl(state.url))
            }}
            onChange={(event) => setDraft(event.target.value)}
          />
        </form>
        <DownloadHud jobs={jobs} />
        <button className="btn btn-ghost btn-icon" onClick={onClose} title="Close the browser">
          <X size={16} />
        </button>
        {state.loading && <span className="web-browser-loading" />}
      </header>
      <div className="web-browser-pane" ref={paneRef} />
    </div>
  )
}
