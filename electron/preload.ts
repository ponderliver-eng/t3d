import * as electron from 'electron'

const { contextBridge, ipcRenderer } = electron

contextBridge.exposeInMainWorld('__electron', {
  fs: {
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
})
