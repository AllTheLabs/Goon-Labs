import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('goonlabs', {
  import: (urls: string[]) => ipcRenderer.invoke('browser:import-media', urls)
})
