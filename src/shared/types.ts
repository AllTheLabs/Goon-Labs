export type MediaType = 'image' | 'video'

export interface MediaItem {
  id: string
  fileName: string
  /** Path relative to the repository root, always using forward slashes. */
  relPath: string
  type: MediaType
  size: number
  importedAt: string
  tags: string[]
  /** Seconds, when known. Videos only. */
  duration?: number
  width?: number
  height?: number
}

export interface LibraryViewStats {
  count: number
  lastViewedAt: number
}

export interface LibraryShelf {
  pinnedIds: string[]
  views: Record<string, LibraryViewStats>
}

export interface LibraryState {
  root: string
  items: MediaItem[]
  /** Lab recordings in `sessions/`. Not part of the main library or lab setups. */
  sessions: MediaItem[]
  /** Videos that have a lightweight preview copy for the Scroller. */
  previewIds: string[]
  previewsPending: number
  /** Items that have a JPEG still for the library grid. */
  thumbIds: string[]
  thumbsPending: number
  pinnedIds: string[]
  views: Record<string, LibraryViewStats>
}

export interface PreviewReadyEvent {
  /** The video whose preview just finished, or null when only the queue length changed. */
  id: string | null
  remaining: number
}

export interface ThumbReadyEvent {
  /** The item whose still just finished, or null when only the queue length changed. */
  id: string | null
  remaining: number
  duration?: number
  width?: number
  height?: number
}

export interface ImportResult {
  imported: MediaItem[]
  skipped: { path: string; reason: string }[]
}

export interface ExportResult {
  destination: string
  exported: number
  failed: { fileName: string; reason: string }[]
}

export interface DeleteResult {
  deletedIds: string[]
  failed: { fileName: string; reason: string }[]
}

export type ImportSource = 'files' | 'folder'

export type DownloadStatus = 'queued' | 'downloading' | 'importing' | 'done' | 'failed' | 'cancelled'

export interface DownloadJob {
  id: string
  url: string
  status: DownloadStatus
  /** Bytes received so far. */
  received: number
  /** Total bytes, when the server says. */
  total: number | null
  fileName: string | null
  /** What's happening right now, when it isn't just transferring bytes (e.g. "Merging video and audio…"). */
  note?: string
  error?: string
  /** The first imported library item once the download is done. */
  item?: MediaItem
  /** How many items were imported (playlists can produce several). */
  importedCount?: number
}

export interface DownloaderInfo {
  /** yt-dlp's version once installed, or null if it will be installed on first use. */
  ytDlpVersion: string | null
}

export interface AppSettings {
  softwareWindow: boolean
  /** What this process actually launched with. A toggle change needs a restart. */
  softwareWindowActive: boolean
  discordRichPresence: boolean
  /** Draw the app logo and GitHub URL on labs (and therefore recordings). Off by default. */
  sessionWatermark: boolean
}

export interface ChangelogRelease {
  version: string
  title: string
  body: string
  url: string
}

export interface AppChangelog {
  currentVersion: string
  fromVersion: string
  releases: ChangelogRelease[]
}

export type AppUpdateStatus =
  | { state: 'idle'; currentVersion: string }
  | { state: 'available'; currentVersion: string; version: string }
  | { state: 'downloading'; currentVersion: string; version: string; progress: number }
  | { state: 'ready'; currentVersion: string; version: string }
  | { state: 'error'; currentVersion: string; message: string }

/** What Discord Rich Presence should show right now. */
export interface DiscordActivity {
  /** Canonical lab name, or null when not in a lab. */
  lab: string | null
  idle: boolean
}

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

/** Colors from the active Goon Labs theme, used to tint the embedded browser. */
export interface BrowserTheme {
  scheme: 'dark' | 'light'
  bg: string
  bgElev: string
  border: string
  borderStrong: string
  text: string
  textDim: string
  accent: string
  accent2: string
}

export type TrimMode = 'new' | 'replace'

export interface TrimResult {
  item: MediaItem
  replaced: boolean
}

export const DILATION_FACTORS = [1.5, 2, 2.5] as const
export type DilationFactor = (typeof DILATION_FACTORS)[number]

/** One slow-motion span on a Time Dilation timeline. */
export interface DilationSpan {
  start: number
  end: number
  factor: DilationFactor
}

export interface DilationProgressStep {
  id: string
  label: string
  state: 'pending' | 'active' | 'done'
}

/** Live status while a utility is encoding or scanning. */
export interface DilationProgress {
  title: string
  detail: string
  /** 0–1 overall. */
  percent: number
  current: number
  total: number
  steps: DilationProgressStep[]
}

export type JobProgress = DilationProgress
export type JobProgressStep = DilationProgressStep

/** One keep-span on a Splicer timeline. */
export interface SpliceSpan {
  start: number
  end: number
}

export const GIF_QUALITIES = ['low', 'medium', 'high', 'ultra'] as const
export type GifQuality = (typeof GIF_QUALITIES)[number]

export const GIF_FPS = [8, 10, 12, 15, 20, 24] as const
export type GifFps = (typeof GIF_FPS)[number]

export interface GifOptions {
  quality: GifQuality
  fps: GifFps
  loop: boolean
}

export interface MediaApi {
  getLibrary(): Promise<LibraryState | null>
  chooseRepository(): Promise<LibraryState | null>
  refreshLibrary(): Promise<LibraryState | null>
  /** Pin ids that are not pinned; unpin if every id is already pinned. */
  togglePins(ids: string[]): Promise<LibraryShelf>
  /** Counts an open in the library viewer. Labs and utilities do not call this. */
  recordLibraryView(id: string): Promise<LibraryShelf>
  /** Generate stills for these ids before the rest of the queue (visible cards). */
  prioritizeThumbs(ids: string[]): Promise<void>
  importWithDialog(source: ImportSource): Promise<ImportResult | null>
  importPaths(paths: string[]): Promise<ImportResult>
  addTags(ids: string[], tags: string[]): Promise<MediaItem[]>
  removeTag(ids: string[], tag: string): Promise<MediaItem[]>
  exportItems(ids: string[]): Promise<ExportResult | null>
  /** Asks before deleting. False means the user cancelled. */
  confirmDelete(ids: string[]): Promise<boolean>
  deleteItems(ids: string[]): Promise<DeleteResult>
  revealItem(id: string): Promise<void>
  getPathForFile(file: File): string
  /** Returns an unsubscribe function. */
  onPreviewReady(listener: (event: PreviewReadyEvent) => void): () => void
  onThumbReady(listener: (event: ThumbReadyEvent) => void): () => void
  /** Full library after the background disk walk finishes. */
  onLibrarySynced(listener: (state: LibraryState) => void): () => void
  readClipboardText(): Promise<string>
  downloadUrls(urls: string[]): Promise<DownloadJob[]>
  getDownloads(): Promise<DownloadJob[]>
  cancelDownload(id: string): Promise<void>
  retryDownload(id: string): Promise<void>
  /** Forgets finished, failed and cancelled downloads. */
  clearDownloads(): Promise<DownloadJob[]>
  getDownloaderInfo(): Promise<DownloaderInfo>
  /** Returns an unsubscribe function. */
  onDownloadUpdate(listener: (job: DownloadJob) => void): () => void
  beginSessionRecording(labName: string, options?: { prompt?: boolean }): Promise<string | null>
  appendSessionChunk(data: ArrayBuffer): Promise<void>
  finishSessionRecording(): Promise<string | null>
  revealPath(filePath: string): Promise<void>
  getWindowSourceId(): Promise<string | null>
  getAppSettings(): Promise<AppSettings>
  setSoftwareWindow(enabled: boolean): Promise<boolean>
  setDiscordRichPresence(enabled: boolean): Promise<boolean>
  setSessionWatermark(enabled: boolean): Promise<boolean>
  setDiscordActivity(activity: DiscordActivity): Promise<void>
  /** Consecutive local days the app has been opened. Opening today counts. */
  getGoonStreak(): Promise<number>
  onGoonStreak(listener: (count: number) => void): () => void
  getUpdateStatus(): Promise<AppUpdateStatus>
  checkForUpdate(): Promise<AppUpdateStatus>
  installUpdate(): Promise<AppUpdateStatus>
  onUpdateStatus(listener: (status: AppUpdateStatus) => void): () => void
  getPendingChangelog(): Promise<AppChangelog | null>
  dismissChangelog(): Promise<void>
  openExternal(url: string): Promise<void>
  relaunchApp(): Promise<void>
  trimVideo(id: string, start: number, end: number, mode: TrimMode): Promise<TrimResult>
  loopVideo(id: string, start: number, end: number, mode: TrimMode): Promise<TrimResult>
  dilateVideo(id: string, spans: DilationSpan[], mode: TrimMode, interpolate: boolean): Promise<TrimResult>
  onJobProgress(listener: (progress: JobProgress) => void): () => void
  spliceVideo(id: string, spans: SpliceSpan[], mode: TrimMode): Promise<TrimResult>
  makeGif(id: string, start: number, end: number, options: GifOptions, mode: TrimMode): Promise<TrimResult>
  /** NudeNet ONNX weights for on-device Pixel Perfection detection. */
  getPixelModel(): Promise<ArrayBuffer>
  /** Evenly spaced JPEG stills for an editor timeline, using the player's duration. */
  getFilmstrip(id: string, count: number, duration: number): Promise<string[]>
  openBrowser(bounds: BrowserBounds): Promise<void>
  setBrowserBounds(bounds: BrowserBounds): Promise<void>
  setBrowserVisible(visible: boolean): Promise<void>
  setBrowserTheme(theme: BrowserTheme): Promise<void>
  closeBrowser(): Promise<void>
  browserNavigate(input: string): Promise<void>
  browserBack(): Promise<void>
  browserForward(): Promise<void>
  browserReload(): Promise<void>
  onBrowserState(listener: (state: BrowserNavState) => void): () => void
  onBrowserImportStarted(listener: () => void): () => void
}
