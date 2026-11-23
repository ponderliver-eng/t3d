import * as electron from 'electron'

const { contextBridge, ipcRenderer } = electron

contextBridge.exposeInMainWorld('__electron', {
  fs: {
    authorizeRoot: (dirPath: string) => ipcRenderer.invoke('fs:authorizeRoot', dirPath),
    readTextFile: (filePath: string) => ipcRenderer.invoke('fs:readTextFile', filePath),
    writeTextFile: (filePath: string, content: string) => ipcRenderer.invoke('fs:writeTextFile', filePath, content),
    exists: (filePath: string) => ipcRenderer.invoke('fs:exists', filePath),
    mkdir: (dirPath: string) => ipcRenderer.invoke('fs:mkdir', dirPath),
    readBinaryFile: (filePath: string) => ipcRenderer.invoke('fs:readBinaryFile', filePath),
    writeBinaryFile: (filePath: string, data: ArrayBuffer) => ipcRenderer.invoke('fs:writeBinaryFile', filePath, data),
    movePath: (src: string, dest: string) => ipcRenderer.invoke('fs:movePath', src, dest),
    unlinkFile: (filePath: string) => ipcRenderer.invoke('fs:unlinkFile', filePath),
    removeDir: (dirPath: string) => ipcRenderer.invoke('fs:removeDir', dirPath),
    list: (dirPath: string) => ipcRenderer.invoke('fs:list', dirPath),
  },
  shell: {
    showItemInFolder: (filePath: string) => ipcRenderer.invoke('shell:showItemInFolder', filePath),
    openPath: (targetPath: string) => ipcRenderer.invoke('shell:openPath', targetPath),
  },
  dialog: {
    showOpenDirectoryDialog: () => ipcRenderer.invoke('dialog:showOpenDirectoryDialog'),
  },
  player: {
    copyShell: (targetDir: string) => ipcRenderer.invoke('player:copyShell', targetDir),
    buildElectron: (
      targetDir: string,
      options: { appName?: string; width?: number; height?: number; fullscreen?: boolean; resizable?: boolean },
    ) => ipcRenderer.invoke('player:buildElectron', targetDir, options),
  },
  codeAssets: {
    watchProject: (projectDir: string) => ipcRenderer.invoke('codeAssets:watchProject', projectDir),
    openInEditor: (filePath: string, preferred?: string) => ipcRenderer.invoke('codeAssets:openInEditor', filePath, preferred),
    onChanged: (handler: (payload: { relativePath: string }) => void) => {
      const listener = (_event: unknown, payload: { relativePath: string }) => handler(payload)
      ipcRenderer.on('codeAsset:changed', listener)
      return () => ipcRenderer.removeListener('codeAsset:changed', listener)
    },
  },
  viewport: {
    capturePage: (rect?: { x: number; y: number; width: number; height: number }, maxWidth?: number) =>
      ipcRenderer.invoke('viewport:capturePage', rect, maxWidth),
  },
  ai: {
    listProviders: () => ipcRenderer.invoke('ai:listProviders'),
    saveProvider: (input: unknown) => ipcRenderer.invoke('ai:saveProvider', input),
    deleteProvider: (id: string) => ipcRenderer.invoke('ai:deleteProvider', id),
    setActiveProvider: (id: string, model?: string) => ipcRenderer.invoke('ai:setActiveProvider', id, model),
    chat: (requestId: string, request: unknown) => ipcRenderer.invoke('ai:chat', requestId, request),
    abort: (requestId: string) => ipcRenderer.invoke('ai:abort', requestId),
    onDelta: (handler: (delta: unknown) => void) => {
      const listener = (_event: unknown, delta: unknown) => handler(delta)
      ipcRenderer.on('ai:delta', listener)
      return () => ipcRenderer.removeListener('ai:delta', listener)
    },
  },
})
