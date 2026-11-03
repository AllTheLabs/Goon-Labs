import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { AppUpdateStatus } from '../shared/types'

autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = true

let pendingVersion: string | null = null
let status: AppUpdateStatus = { state: 'idle', currentVersion: app.getVersion() }
let notify: ((next: AppUpdateStatus) => void) | null = null

function current(): string {
  return app.getVersion()
}

function emit(next: AppUpdateStatus): void {
  status = next
  notify?.(next)
}

autoUpdater.on('update-available', (info) => {
  pendingVersion = info.version
  emit({ state: 'available', currentVersion: current(), version: info.version })
})

autoUpdater.on('update-not-available', () => {
  pendingVersion = null
  emit({ state: 'idle', currentVersion: current() })
})

autoUpdater.on('download-progress', (progress) => {
  emit({
    state: 'downloading',
    currentVersion: current(),
    version: pendingVersion ?? current(),
    progress: Math.min(1, progress.percent / 100)
  })
})

autoUpdater.on('update-downloaded', (info) => {
  pendingVersion = info.version
  emit({ state: 'ready', currentVersion: current(), version: info.version })
  setTimeout(() => autoUpdater.quitAndInstall(true, true), 700)
})

autoUpdater.on('error', (err) => {
  emit({ state: 'error', currentVersion: current(), message: err.message })
})

export function getUpdateStatus(): AppUpdateStatus {
  return { ...status, currentVersion: current() }
}

export function onUpdateStatus(listener: (next: AppUpdateStatus) => void): void {
  notify = listener
}

export async function checkForUpdate(): Promise<AppUpdateStatus> {
  if (status.state === 'downloading' || status.state === 'ready') return status
  if (!app.isPackaged) {
    emit({ state: 'idle', currentVersion: current() })
    return status
  }
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    emit({ state: 'error', currentVersion: current(), message: (err as Error).message })
  }
  return status
}

export async function installUpdate(): Promise<AppUpdateStatus> {
  if (status.state === 'downloading' || status.state === 'ready') return status
  if (!app.isPackaged) {
    emit({ state: 'error', currentVersion: current(), message: 'Updates install from a packaged build' })
    return status
  }
  if (status.state !== 'available') await checkForUpdate()
  if (status.state !== 'available') {
    if (status.state !== 'error') {
      emit({ state: 'error', currentVersion: current(), message: 'No update is available' })
    }
    return status
  }
  try {
    await autoUpdater.downloadUpdate()
  } catch (err) {
    emit({ state: 'error', currentVersion: current(), message: (err as Error).message })
  }
  return status
}
