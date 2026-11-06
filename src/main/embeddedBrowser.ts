import {
  app,
  session as electronSession,
  WebContentsView,
  type BrowserWindow,
  type Session,
  type WebContents
} from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { BrowserTheme } from '../shared/types'

const HOME = 'https://duckduckgo.com/'
const SEARCH = 'https://duckduckgo.com/?q='

export interface BrowserBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface BrowserNavState {
  url: string
  title: string
  canGoBack: boolean
  canGoForward: boolean
  loading: boolean
}

export function resolveBrowserInput(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return HOME
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (!/\s/.test(trimmed) && /^localhost(?::\d+)?(?:[/?#].*)?$/i.test(trimmed)) {
    return `http://${trimmed}`
  }
  if (!/\s/.test(trimmed) && /^[\w.-]+\.[a-z]{2,}(?:[/:?#].*)?$/i.test(trimmed)) {
    return `https://${trimmed}`
  }
  return `${SEARCH}${encodeURIComponent(trimmed)}`
}

function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

function isAllowedNavigation(url: string): boolean {
  return /^(https?:|about:|blob:|data:)/i.test(url)
}

const DEFAULT_THEME: BrowserTheme = {
  scheme: 'dark',
  bg: '#0d0f14',
  bgElev: '#13161d',
  border: '#252a36',
  borderStrong: '#323949',
  text: '#e8eaf0',
  textDim: '#9aa1b2',
  accent: '#7c6cff',
  accent2: '#5ab0ff'
}

function cssToken(value: string): string {
  return value.replace(/[;{}]/g, '').trim()
}

function isChallengeUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (/(^|\.)challenges\.cloudflare\.com$/i.test(parsed.hostname)) return true
    if (parsed.pathname.includes('/cdn-cgi/challenge')) return true
  } catch {
    /* ignore */
  }
  return false
}

export function parseBrowserTheme(raw: unknown): BrowserTheme | null {
  if (!raw || typeof raw !== 'object') return null
  const input = raw as Record<string, unknown>
  if (input.scheme !== 'dark' && input.scheme !== 'light') return null
  const color = (key: string, fallback: string): string => {
    const value = input[key]
    if (typeof value !== 'string' || value.length === 0 || value.length > 80) return fallback
    return cssToken(value) || fallback
  }
  return {
    scheme: input.scheme,
    bg: color('bg', DEFAULT_THEME.bg),
    bgElev: color('bgElev', DEFAULT_THEME.bgElev),
    border: color('border', DEFAULT_THEME.border),
    borderStrong: color('borderStrong', DEFAULT_THEME.borderStrong),
    text: color('text', DEFAULT_THEME.text),
    textDim: color('textDim', DEFAULT_THEME.textDim),
    accent: color('accent', DEFAULT_THEME.accent),
    accent2: color('accent2', DEFAULT_THEME.accent2)
  }
}

function browserThemeCss(theme: BrowserTheme): string {
  const scheme = theme.scheme === 'light' ? 'light' : 'dark'
  const accent = cssToken(theme.accent)
  const text = cssToken(theme.text)
  const thumb = cssToken(theme.borderStrong)
  const hover = cssToken(theme.textDim)
  return `
html { color-scheme: ${scheme}; }
::selection {
  background: color-mix(in srgb, ${accent} 40%, transparent);
  color: ${text};
}
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-thumb {
  background: ${thumb};
  border-radius: 10px;
  border: 2px solid transparent;
  background-clip: padding-box;
}
::-webkit-scrollbar-thumb:hover {
  background: ${hover};
  border: 2px solid transparent;
  background-clip: padding-box;
}
::-webkit-scrollbar-track,
::-webkit-scrollbar-corner { background: transparent; }
`
}

export function chromeUserAgent(): string {
  const chrome = process.versions.chrome || '136.0.0.0'
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`
}

/** Must run before app ready. Cloudflare loops if it sees Electron / blocked challenge cookies. */
export function installBrowserSwitches(): void {
  app.commandLine.appendSwitch(
    'disable-features',
    'TrackingProtection3pcd,ThirdPartyStoragePartitioning,UserAgentClientHint,CalculateNativeWinOcclusion'
  )
  app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled')
  app.userAgentFallback = chromeUserAgent()
}

/**
 * A Chromium pane attached to the main window. Uses an in-memory session so closing
 * it actually drops cookies, cache, and the renderer process instead of hiding a tab.
 */
export class EmbeddedBrowser {
  private view: WebContentsView | null = null
  private window: BrowserWindow | null = null
  private host: WebContents | null = null
  private partition: string | null = null
  private extensionId: string | null = null
  private visible = true
  private theme: BrowserTheme = DEFAULT_THEME
  private themeCssKey: string | null = null

  get open(): boolean {
    return this.view !== null
  }

  async show(win: BrowserWindow, host: WebContents, bounds: BrowserBounds): Promise<void> {
    await this.close()
    this.window = win
    this.host = host
    this.visible = true
    this.partition = 'persist:goon-browse'
    const view = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, '../preload/browser.js'),
        partition: this.partition,
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
        javascript: true,
        webviewTag: false,
        spellcheck: true,
        backgroundThrottling: true,
        safeDialogs: true
      }
    })
    this.view = view
    this.themeCssKey = null
    this.applyViewBackground()
    const wc = view.webContents
    const ua = chromeUserAgent()
    wc.session.setUserAgent(ua)
    wc.setUserAgent(ua)
    wc.setWindowOpenHandler(({ url }) => {
      if (isHttpUrl(url) && !wc.isDestroyed()) void wc.loadURL(url)
      return { action: 'deny' }
    })
    wc.on('will-navigate', (event, url) => {
      if (!isAllowedNavigation(url)) event.preventDefault()
    })
    wc.session.setPermissionRequestHandler((_contents, permission, callback) => {
      callback(permission === 'fullscreen' || permission === 'pointerLock' || permission === 'clipboard-sanitized-write')
    })
    const emit = () => this.emit()
    wc.on('did-navigate', emit)
    wc.on('did-navigate-in-page', emit)
    wc.on('page-title-updated', emit)
    wc.on('did-start-loading', emit)
    wc.on('did-stop-loading', emit)
    wc.on('did-fail-load', emit)
    const inject = () => {
      void this.injectOverlay(wc)
      void this.injectThemeCss()
    }
    wc.on('dom-ready', inject)
    wc.on('did-finish-load', inject)
    wc.on('did-navigate-in-page', () => {
      void this.injectOverlay(wc)
      void this.injectThemeCss()
    })
    wc.on('did-navigate', () => {
      this.themeCssKey = null
    })
    wc.on('destroyed', () => {
      if (this.view === view) {
        this.view = null
        this.window = null
        this.host = null
        this.partition = null
      }
    })
    win.contentView.addChildView(view)
    this.applyBounds(bounds)
    await this.loadImportExtension(wc.session)
    void wc.loadURL(HOME)
    this.emit()
  }

  setBounds(bounds: BrowserBounds): void {
    this.applyBounds(bounds)
  }

  setTheme(theme: BrowserTheme): void {
    this.theme = theme
    this.applyViewBackground()
    void this.injectThemeCss(true)
  }

  setVisible(visible: boolean): void {
    this.visible = visible
    const view = this.view
    if (!view) return
    view.setVisible(visible)
    const wc = view.webContents
    if (!wc.isDestroyed()) wc.setAudioMuted(!visible)
    if (!visible) view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
  }

  navigate(input: string): void {
    const wc = this.view?.webContents
    if (!wc || wc.isDestroyed()) return
    void wc.loadURL(resolveBrowserInput(input))
  }

  back(): void {
    const history = this.view?.webContents.navigationHistory
    if (history?.canGoBack()) history.goBack()
  }

  forward(): void {
    const history = this.view?.webContents.navigationHistory
    if (history?.canGoForward()) history.goForward()
  }

  reload(): void {
    const wc = this.view?.webContents
    if (!wc || wc.isDestroyed()) return
    if (wc.isLoading()) wc.stop()
    else wc.reload()
  }

  /** Tears down the renderer, GPU process, and in-memory session. Safe to call twice. */
  async close(): Promise<void> {
    const view = this.view
    const win = this.window
    const partition = this.partition
    this.view = null
    this.window = null
    this.host = null
    this.partition = null
    const extensionId = this.extensionId
    this.extensionId = null
    this.themeCssKey = null
    if (!view) return

    const wc = view.webContents
    try {
      if (!wc.isDestroyed()) {
        wc.setAudioMuted(true)
        wc.stop()
      }
    } catch {
      /* already gone */
    }

    if (extensionId) {
      try {
        view.webContents.session.removeExtension(extensionId)
      } catch {
        /* session already gone */
      }
    }

    if (win && !win.isDestroyed()) {
      try {
        win.contentView.removeChildView(view)
      } catch {
        /* already detached */
      }
    }

    if (!wc.isDestroyed()) {
      try {
        wc.removeAllListeners()
      } catch {
        /* */
      }
      try {
        wc.close({ waitForBeforeUnload: false })
      } catch {
        /* */
      }
    }

    if (partition) {
      try {
        const ses = electronSession.fromPartition(partition)
        await ses.closeAllConnections()
        await ses.clearCache()
        await ses.clearStorageData()
      } catch {
        /* session already dropped */
      }
    }
  }

  private extensionDir(): string {
    return app.isPackaged
      ? path.join(process.resourcesPath, 'extensions', 'goon-import')
      : path.join(__dirname, '../../extensions/goon-import')
  }

  private async loadImportExtension(ses: Session): Promise<void> {
    const dir = this.extensionDir()
    if (!existsSync(path.join(dir, 'manifest.json'))) return
    const already = ses.getAllExtensions().find((ext) => ext.name === 'Goon Labs Save')
    if (already) {
      this.extensionId = already.id
      return
    }
    try {
      const loaded = await ses.loadExtension(dir, { allowFileAccess: true })
      this.extensionId = loaded.id
    } catch (err) {
      console.error('Could not load the Goon Labs save extension', err)
    }
  }

  private applyViewBackground(): void {
    const view = this.view
    if (!view) return
    try {
      view.setBackgroundColor(this.theme.bg)
    } catch {
      /* view already gone */
    }
  }

  private async injectThemeCss(replace = false): Promise<void> {
    const wc = this.view?.webContents
    if (!wc || wc.isDestroyed()) return
    if (isChallengeUrl(wc.getURL())) return
    if (this.themeCssKey && !replace) return
    if (this.themeCssKey) {
      try {
        await wc.removeInsertedCSS(this.themeCssKey)
      } catch {
        /* document already swapped */
      }
      this.themeCssKey = null
    }
    try {
      this.themeCssKey = await wc.insertCSS(browserThemeCss(this.theme), { cssOrigin: 'user' })
    } catch {
      /* about:blank / navigating away */
    }
  }

  private async injectOverlay(wc: WebContents): Promise<void> {
    const overlay = path.join(this.extensionDir(), 'overlay.js')
    if (!existsSync(overlay) || wc.isDestroyed()) return
    try {
      await wc.executeJavaScript(readFileSync(overlay, 'utf8'), true)
    } catch {
      /* about:blank / navigating away */
    }
  }

  private applyBounds(bounds: BrowserBounds): void {
    const view = this.view
    if (!view) return
    const x = Math.round(Math.max(0, bounds.x))
    const y = Math.round(Math.max(0, bounds.y))
    const width = Math.round(Math.max(0, bounds.width))
    const height = Math.round(Math.max(0, bounds.height))
    if (!this.visible || width < 2 || height < 2) {
      view.setVisible(false)
      view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
      return
    }
    view.setVisible(true)
    view.setBounds({ x, y, width, height })
  }

  private emit(): void {
    const host = this.host
    const wc = this.view?.webContents
    if (!host || host.isDestroyed() || !wc || wc.isDestroyed()) return
    const history = wc.navigationHistory
    const state: BrowserNavState = {
      url: wc.getURL(),
      title: wc.getTitle(),
      canGoBack: history.canGoBack(),
      canGoForward: history.canGoForward(),
      loading: wc.isLoading()
    }
    host.send('browser:state', state)
  }
}
