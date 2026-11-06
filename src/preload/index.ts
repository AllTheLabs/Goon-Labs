import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  AppUpdateStatus,
  BrowserNavState,
  JobProgress,
  DownloadJob,
  LibraryState,
  MediaApi,
  PreviewReadyEvent,
  ThumbReadyEvent
} from '../shared/types'

const api: MediaApi = {
  getLibrary: () => ipcRenderer.invoke('library:get'),
  chooseRepository: () => ipcRenderer.invoke('library:choose'),
  refreshLibrary: () => ipcRenderer.invoke('library:refresh'),
  togglePins: (ids) => ipcRenderer.invoke('library:toggle-pins', ids),
  recordLibraryView: (id) => ipcRenderer.invoke('library:record-view', id),
  prioritizeThumbs: (ids) => ipcRenderer.invoke('library:prioritize-thumbs', ids),
  importWithDialog: (source) => ipcRenderer.invoke('media:import-dialog', source),
  importPaths: (paths) => ipcRenderer.invoke('media:import-paths', paths),
  addTags: (ids, tags) => ipcRenderer.invoke('media:add-tags', ids, tags),
  removeTag: (ids, tag) => ipcRenderer.invoke('media:remove-tag', ids, tag),
  exportItems: (ids) => ipcRenderer.invoke('media:export', ids),
  confirmDelete: (ids) => ipcRenderer.invoke('media:confirm-delete', ids),
  deleteItems: (ids) => ipcRenderer.invoke('media:delete', ids),
  revealItem: (id) => ipcRenderer.invoke('media:reveal', id),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  onPreviewReady: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: PreviewReadyEvent) =>
      listener(payload)
    ipcRenderer.on('media:preview-ready', handler)
    return () => ipcRenderer.removeListener('media:preview-ready', handler)
  },
  onThumbReady: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: ThumbReadyEvent) => listener(payload)
    ipcRenderer.on('media:thumb-ready', handler)
    return () => ipcRenderer.removeListener('media:thumb-ready', handler)
  },
  onLibrarySynced: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: LibraryState) => listener(payload)
    ipcRenderer.on('library:synced', handler)
    return () => ipcRenderer.removeListener('library:synced', handler)
  },
  readClipboardText: () => ipcRenderer.invoke('clipboard:read-text'),
  downloadUrls: (urls) => ipcRenderer.invoke('downloads:enqueue', urls),
  getDownloads: () => ipcRenderer.invoke('downloads:list'),
  cancelDownload: (id) => ipcRenderer.invoke('downloads:cancel', id),
  retryDownload: (id) => ipcRenderer.invoke('downloads:retry', id),
  clearDownloads: () => ipcRenderer.invoke('downloads:clear'),
  getDownloaderInfo: () => ipcRenderer.invoke('downloads:info'),
  onDownloadUpdate: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, job: DownloadJob) => listener(job)
    ipcRenderer.on('downloads:update', handler)
    return () => ipcRenderer.removeListener('downloads:update', handler)
  },
  beginSessionRecording: (labName, options) => ipcRenderer.invoke('session:begin', labName, options),
  appendSessionChunk: (data) => ipcRenderer.invoke('session:append', data),
  finishSessionRecording: () => ipcRenderer.invoke('session:finish'),
  revealPath: (filePath) => ipcRenderer.invoke('session:reveal-path', filePath),
  getWindowSourceId: () => ipcRenderer.invoke('session:window-source'),
  getAppSettings: () => ipcRenderer.invoke('settings:get'),
  setSoftwareWindow: (enabled) => ipcRenderer.invoke('settings:set-software-window', enabled),
  setDiscordRichPresence: (enabled) => ipcRenderer.invoke('settings:set-discord-presence', enabled),
  setSessionWatermark: (enabled) => ipcRenderer.invoke('settings:set-session-watermark', enabled),
  setDiscordActivity: (activity) => ipcRenderer.invoke('discord:set-activity', activity),
  getGoonStreak: () => ipcRenderer.invoke('streak:get'),
  onGoonStreak: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, count: number) => listener(count)
    ipcRenderer.on('streak:update', handler)
    return () => ipcRenderer.removeListener('streak:update', handler)
  },
  getUpdateStatus: () => ipcRenderer.invoke('update:status'),
  checkForUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateStatus: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, status: AppUpdateStatus) => listener(status)
    ipcRenderer.on('update:status', handler)
    return () => ipcRenderer.removeListener('update:status', handler)
  },
  getPendingChangelog: () => ipcRenderer.invoke('changelog:pending'),
  dismissChangelog: () => ipcRenderer.invoke('changelog:dismiss'),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  relaunchApp: () => ipcRenderer.invoke('app:relaunch'),
  trimVideo: (id, start, end, mode) => ipcRenderer.invoke('media:trim', id, start, end, mode),
  loopVideo: (id, start, end, mode) => ipcRenderer.invoke('media:loop', id, start, end, mode),
  dilateVideo: (id, spans, mode, interpolate) =>
    ipcRenderer.invoke('media:dilate', id, spans, mode, interpolate),
  onJobProgress: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: JobProgress) => listener(progress)
    ipcRenderer.on('job:progress', handler)
    return () => ipcRenderer.removeListener('job:progress', handler)
  },
  spliceVideo: (id, spans, mode) => ipcRenderer.invoke('media:splice', id, spans, mode),
  makeGif: (id, start, end, options, mode) =>
    ipcRenderer.invoke('media:gif', id, start, end, options, mode),
  getPixelModel: () => ipcRenderer.invoke('pixel:model'),
  getFilmstrip: (id, count, duration) => ipcRenderer.invoke('media:filmstrip', id, count, duration),
  openBrowser: (bounds) => ipcRenderer.invoke('browser:open', bounds),
  setBrowserBounds: (bounds) => ipcRenderer.invoke('browser:set-bounds', bounds),
  setBrowserVisible: (visible) => ipcRenderer.invoke('browser:set-visible', visible),
  setBrowserTheme: (theme) => ipcRenderer.invoke('browser:set-theme', theme),
  closeBrowser: () => ipcRenderer.invoke('browser:close'),
  browserNavigate: (input) => ipcRenderer.invoke('browser:navigate', input),
  browserBack: () => ipcRenderer.invoke('browser:back'),
  browserForward: () => ipcRenderer.invoke('browser:forward'),
  browserReload: () => ipcRenderer.invoke('browser:reload'),
  onBrowserState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: BrowserNavState) => listener(state)
    ipcRenderer.on('browser:state', handler)
    return () => ipcRenderer.removeListener('browser:state', handler)
  },
  onBrowserImportStarted: (listener) => {
    const handler = () => listener()
    ipcRenderer.on('browser:import-started', handler)
    return () => ipcRenderer.removeListener('browser:import-started', handler)
  }
}

contextBridge.exposeInMainWorld('api', api)
