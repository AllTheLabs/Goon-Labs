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
}

export interface LibraryState {
  root: string
  items: MediaItem[]
  /** Videos that have a lightweight preview copy for the Scroller. */
  previewIds: string[]
  previewsPending: number
}

export interface PreviewReadyEvent {
  /** The video whose preview just finished, or null when only the queue length changed. */
  id: string | null
  remaining: number
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
  sessionDir: string | null
  softwareWindow: boolean
  /** What this process actually launched with. A toggle change needs a restart. */
  softwareWindowActive: boolean
  discordRichPresence: boolean
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
  setDiscordActivity(activity: DiscordActivity): Promise<void>
  getUpdateStatus(): Promise<AppUpdateStatus>
  checkForUpdate(): Promise<AppUpdateStatus>
  installUpdate(): Promise<AppUpdateStatus>
  onUpdateStatus(listener: (status: AppUpdateStatus) => void): () => void
  relaunchApp(): Promise<void>
  chooseSessionDir(): Promise<string | null>
  trimVideo(id: string, start: number, end: number, mode: TrimMode): Promise<TrimResult>
  dilateVideo(id: string, spans: DilationSpan[], mode: TrimMode, interpolate: boolean): Promise<TrimResult>
  makeGif(id: string, start: number, end: number, options: GifOptions, mode: TrimMode): Promise<TrimResult>
  /** NudeNet ONNX weights for on-device Pixel Perfection detection. */
  getPixelModel(): Promise<ArrayBuffer>
}
