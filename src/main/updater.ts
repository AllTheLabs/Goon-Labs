import { promises as fs } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { AppUpdateStatus } from '../shared/types'

autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = true
autoUpdater.disableWebInstaller = true
autoUpdater.disableDifferentialDownload = true
autoUpdater.logger = console

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

function newerThanCurrent(version: string | undefined): boolean {
  if (!version) return false
  const parse = (raw: string) =>
    raw
      .replace(/^v/i, '')
      .split('.')
      .map((part) => Number.parseInt(part, 10) || 0)
  const left = parse(version)
  const right = parse(current())
  const len = Math.max(left.length, right.length)
  for (let i = 0; i < len; i++) {
    const delta = (left[i] ?? 0) - (right[i] ?? 0)
    if (delta > 0) return true
    if (delta < 0) return false
  }
  return false
}

async function clearUpdaterCache(): Promise<void> {
  const root = process.env.LOCALAPPDATA
  if (!root) return
  for (const name of ['goon-labs-updater', 'Goon-Labs-updater']) {
    await fs.rm(path.join(root, name), { recursive: true, force: true }).catch(() => {})
  }
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
    const result = await autoUpdater.checkForUpdates()
    const version = result?.updateInfo?.version
    if (result?.isUpdateAvailable && newerThanCurrent(version)) {
      pendingVersion = version ?? null
      emit({ state: 'available', currentVersion: current(), version: version! })
    } else if (status.state !== 'error') {
      pendingVersion = null
      emit({ state: 'idle', currentVersion: current() })
    }
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
  const download = async () => autoUpdater.downloadUpdate()
  try {
    await download()
  } catch (err) {
    await clearUpdaterCache()
    try {
      await download()
    } catch (retryErr) {
      emit({ state: 'error', currentVersion: current(), message: (retryErr as Error).message })
    }
  }
  return status
}
