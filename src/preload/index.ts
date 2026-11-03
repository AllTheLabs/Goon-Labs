import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { AppUpdateStatus, DownloadJob, MediaApi, PreviewReadyEvent } from '../shared/types'

const api: MediaApi = {
  getLibrary: () => ipcRenderer.invoke('library:get'),
  chooseRepository: () => ipcRenderer.invoke('library:choose'),
  refreshLibrary: () => ipcRenderer.invoke('library:refresh'),
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
  setDiscordActivity: (activity) => ipcRenderer.invoke('discord:set-activity', activity),
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
  chooseSessionDir: () => ipcRenderer.invoke('settings:choose-session-dir'),
  trimVideo: (id, start, end, mode) => ipcRenderer.invoke('media:trim', id, start, end, mode),
  dilateVideo: (id, spans, mode, interpolate) =>
    ipcRenderer.invoke('media:dilate', id, spans, mode, interpolate),
  makeGif: (id, start, end, options, mode) =>
    ipcRenderer.invoke('media:gif', id, start, end, options, mode),
  getPixelModel: () => ipcRenderer.invoke('pixel:model')
}

contextBridge.exposeInMainWorld('api', api)
