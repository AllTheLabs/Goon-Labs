import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import type { DilationSpan, GifOptions, ImportSource, TrimMode } from '../shared/types'
import { DownloadManager } from './downloads'
import { Library } from './library'
import { IMAGE_EXTENSIONS, VIDEO_EXTENSIONS } from './mediaTypes'
import { loadPixelModel } from './pixelModel'
import { handleMediaProtocol, registerMediaScheme } from './protocol'
import { installCapturePermissions, SessionRecording, windowSourceId } from './sessionCapture'

interface AppConfig {
  repositoryPath?: string
  sessionDir?: string
  lastSessionDir?: string
}

let mainWindow: BrowserWindow | null = null
let library: Library | null = null
const downloads = new DownloadManager(
  () => library,
  (job) => mainWindow?.webContents.send('downloads:update', job)
)
const sessionRecording = new SessionRecording()

registerMediaScheme()

// Versions before 2.0 were called "Media Manager". Keep using their data folder (repository
// choice, theme and other saved settings) instead of starting fresh under the new name.
{
  const appData = app.getPath('appData')
  const legacy = path.join(appData, 'Media Manager')
  const isDefault = app.getPath('userData') === path.join(appData, app.getName())
  if (isDefault && !existsSync(app.getPath('userData')) && existsSync(legacy)) {
    app.setPath('userData', legacy)
  }
}

const configPath = (): string => path.join(app.getPath('userData'), 'config.json')

async function readConfig(): Promise<AppConfig> {
  try {
    return JSON.parse(await fs.readFile(configPath(), 'utf8')) as AppConfig
  } catch {
    return {}
  }
}

async function writeConfig(config: AppConfig): Promise<void> {
  await fs.mkdir(path.dirname(configPath()), { recursive: true })
  await fs.writeFile(configPath(), JSON.stringify(config, null, 2), 'utf8')
}

function openLibrary(root: string): Promise<Library> {
  return Library.open(root, (id, remaining) => {
    if (library?.root === path.resolve(root)) {
      mainWindow?.webContents.send('media:preview-ready', { id, remaining })
    }
  })
}

async function openConfiguredLibrary(): Promise<Library | null> {
  const { repositoryPath } = await readConfig()
  if (!repositoryPath) return null
  try {
    await fs.access(repositoryPath)
    return await openLibrary(repositoryPath)
  } catch {
    return null
  }
}

function requireLibrary(): Library {
  if (!library) throw new Error('No media repository has been selected')
  return library
}

function registerIpc(): void {
  ipcMain.handle('library:get', async () => {
    library ??= await openConfiguredLibrary()
    return library?.state ?? null
  })

  ipcMain.handle('library:choose', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow!, {
      title: 'Choose a folder to use as your media repository',
      buttonLabel: 'Use this folder',
      properties: ['openDirectory', 'createDirectory']
    })
    if (canceled || filePaths.length === 0) return null
    library = await openLibrary(filePaths[0])
    await writeConfig({ repositoryPath: library.root })
    return library.state
  })

  ipcMain.handle('library:refresh', async () => {
    if (!library) return null
    await library.sync()
    return library.state
  })

  ipcMain.handle('media:import-dialog', async (_event, source: ImportSource) => {
    const lib = requireLibrary()
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow!, {
      title: source === 'folder' ? 'Import a folder of media' : 'Import media files',
      buttonLabel: 'Import',
      properties: source === 'folder' ? ['openDirectory'] : ['openFile', 'multiSelections'],
      filters:
        source === 'folder'
          ? undefined
          : [
              { name: 'Photos & Videos', extensions: [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS] },
              { name: 'Photos', extensions: IMAGE_EXTENSIONS },
              { name: 'Videos', extensions: VIDEO_EXTENSIONS }
            ]
    })
    if (canceled || filePaths.length === 0) return null
    return lib.importPaths(filePaths)
  })

  ipcMain.handle('media:import-paths', (_event, paths: string[]) =>
    requireLibrary().importPaths(paths)
  )

  ipcMain.handle('media:add-tags', (_event, ids: string[], tags: string[]) =>
    requireLibrary().addTags(ids, tags)
  )

  ipcMain.handle('media:remove-tag', (_event, ids: string[], tag: string) =>
    requireLibrary().removeTag(ids, tag)
  )

  ipcMain.handle('media:export', async (_event, ids: string[]) => {
    const lib = requireLibrary()
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow!, {
      title: `Export ${ids.length} item${ids.length === 1 ? '' : 's'} to…`,
      buttonLabel: 'Export here',
      properties: ['openDirectory', 'createDirectory']
    })
    if (canceled || filePaths.length === 0) return null
    const result = await lib.exportItems(ids, filePaths[0])
    if (result.exported > 0) shell.openPath(result.destination)
    return result
  })

  ipcMain.handle('media:confirm-delete', async (_event, ids: string[]) => {
    const lib = requireLibrary()
    const names = ids.map((id) => lib.item(id)?.fileName).filter((name): name is string => Boolean(name))
    const single = names.length === 1 ? names[0] : null
    const { response } = await dialog.showMessageBox(mainWindow!, {
      type: 'warning',
      buttons: ['Cancel', 'Delete'],
      defaultId: 1,
      cancelId: 0,
      noLink: true,
      title: 'Delete media',
      message: single ? `Delete “${single}”?` : `Delete ${ids.length} items?`,
      detail:
        ids.length === 1
          ? 'The file will be moved to the Recycle Bin and removed from your library.'
          : 'These files will be moved to the Recycle Bin and removed from your library.'
    })
    return response === 1
  })

  ipcMain.handle('media:delete', (_event, ids: string[]) => requireLibrary().deleteItems(ids))

  ipcMain.handle('media:reveal', (_event, id: string) => {
    const filePath = requireLibrary().absolutePathOf(id)
    if (filePath) shell.showItemInFolder(filePath)
  })

  ipcMain.handle('clipboard:read-text', () => clipboard.readText())

  ipcMain.handle('downloads:enqueue', (_event, urls: string[]) => {
    requireLibrary()
    return downloads.enqueue(urls)
  })
  ipcMain.handle('downloads:list', () => downloads.list())
  ipcMain.handle('downloads:cancel', (_event, id: string) => downloads.cancel(id))
  ipcMain.handle('downloads:retry', (_event, id: string) => downloads.retry(id))
  ipcMain.handle('downloads:clear', () => downloads.clearFinished())
  ipcMain.handle('downloads:info', () => downloads.info())

  ipcMain.handle('session:begin', async (_event, labName: string, options?: { prompt?: boolean }) => {
    const config = await readConfig()
    const filePath = await sessionRecording.begin(labName, {
      sessionDir: config.sessionDir,
      lastDir: config.lastSessionDir,
      prompt: options?.prompt
    })
    if (filePath) await writeConfig({ ...config, lastSessionDir: path.dirname(filePath) })
    return filePath
  })
  ipcMain.handle('session:append', (_event, data: ArrayBuffer) => sessionRecording.append(data))
  ipcMain.handle('session:finish', () => sessionRecording.finish())
  ipcMain.handle('session:reveal-path', (_event, filePath: string) => sessionRecording.reveal(filePath))
  ipcMain.handle('session:window-source', () => windowSourceId())

  ipcMain.handle('settings:get', async () => {
    const config = await readConfig()
    return { sessionDir: config.sessionDir ?? null }
  })
  ipcMain.handle('media:trim', (_event, id: string, start: number, end: number, mode: TrimMode) =>
    requireLibrary().trimVideo(id, start, end, mode)
  )
  ipcMain.handle(
    'media:dilate',
    (_event, id: string, spans: DilationSpan[], mode: TrimMode, interpolate: boolean) =>
      requireLibrary().dilateVideo(id, spans, mode, interpolate)
  )
  ipcMain.handle(
    'media:gif',
    (_event, id: string, start: number, end: number, options: GifOptions, mode: TrimMode) =>
      requireLibrary().makeGif(id, start, end, options, mode)
  )
  ipcMain.handle('pixel:model', async () => {
    const bytes = await loadPixelModel()
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  })

  ipcMain.handle('settings:choose-session-dir', async () => {
    const config = await readConfig()
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow!, {
      title: 'Choose recordings folder',
      defaultPath: config.sessionDir ?? config.lastSessionDir ?? app.getPath('videos'),
      properties: ['openDirectory']
    })
    if (canceled || !filePaths[0]) return null
    await writeConfig({ ...config, sessionDir: filePaths[0] })
    return filePaths[0]
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#0d0f14',
    autoHideMenuBar: true,
    title: 'Goon Labs',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })

  mainWindow.once('ready-to-show', () => {
    if (!mainWindow) return
    mainWindow.maximize()
    mainWindow.show()
  })
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.on('closed', () => (mainWindow = null))

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  handleMediaProtocol(() => library)
  installCapturePermissions()
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
