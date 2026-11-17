import * as electron from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs/promises'

const { app, BrowserWindow, ipcMain, dialog, shell } = electron

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL
const RENDERER_DIST = path.join(__dirname, '../dist')

app.commandLine.appendSwitch('enable-unsafe-webgpu')
app.commandLine.appendSwitch('ignore-gpu-blocklist')

let mainWindow: electron.BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'T3D',
    backgroundColor: '#1a1a1a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  })
  if (VITE_DEV_SERVER_URL) mainWindow.loadURL(VITE_DEV_SERVER_URL)
  else mainWindow.loadFile(path.join(RENDERER_DIST, 'index.html'))
  mainWindow.on('closed', () => { mainWindow = null })
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

function registerIpc() {
  ipcMain.handle('fs:readTextFile', async (_event, filePath: string) => fs.readFile(filePath, 'utf-8'))
  ipcMain.handle('fs:writeTextFile', async (_event, filePath: string, content: string) => {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, content, 'utf-8')
  })
  ipcMain.handle('fs:exists', async (_event, filePath: string) => {
    try {
      await fs.access(filePath)
      return true
    } catch {
      return false
    }
  })
  ipcMain.handle('fs:mkdir', async (_event, dirPath: string) => {
    await fs.mkdir(dirPath, { recursive: true })
  })
  ipcMain.handle('fs:readBinaryFile', async (_event, filePath: string) => {
    const buf = await fs.readFile(filePath)
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  })
  ipcMain.handle('fs:writeBinaryFile', async (_event, filePath: string, data: ArrayBuffer | Uint8Array) => {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    const bytes = data instanceof Uint8Array ? data : Buffer.from(data)
    await fs.writeFile(filePath, bytes)
  })
  ipcMain.handle('fs:movePath', async (_event, src: string, dest: string) => {
    await fs.mkdir(path.dirname(dest), { recursive: true })
    await fs.rename(src, dest)
  })
  ipcMain.handle('fs:unlinkFile', async (_event, filePath: string) => {
    await fs.unlink(filePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
  })
  ipcMain.handle('fs:removeDir', async (_event, dirPath: string) => {
    await fs.rmdir(dirPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
  })
  ipcMain.handle('fs:list', async (_event, dirPath: string) => {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true })
      return entries.map(entry => ({
        name: entry.name,
        kind: entry.isDirectory() ? 'directory' as const : 'file' as const,
      }))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  })
  ipcMain.handle('shell:showItemInFolder', (_event, filePath: string) => {
    shell.showItemInFolder(filePath)
  })
  ipcMain.handle('shell:openPath', async (_event, targetPath: string) => {
    const error = await shell.openPath(targetPath)
    if (error) throw new Error(error)
  })
  ipcMain.handle('dialog:showOpenDirectoryDialog', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow
    const result = await dialog.showOpenDialog(win ?? undefined, { properties: ['openDirectory'] })
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })
}
