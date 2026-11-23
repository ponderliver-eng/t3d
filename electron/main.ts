import * as electron from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import { spawn } from 'node:child_process'
import { PathGuard } from './services/pathGuard'
import { SecretStore } from './services/secretStore'
import { invokeModelChat, type ChatRequest } from './services/modelProviders'

const { app, BrowserWindow, ipcMain, dialog, shell } = electron

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL
const RENDERER_DIST = path.join(__dirname, '../dist')

app.commandLine.appendSwitch('enable-unsafe-webgpu')
app.commandLine.appendSwitch('ignore-gpu-blocklist')
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
// 显卡着色器磁盘缓存默认只有几 MB，一个场景编译出的着色器就能把它挤满，
// 结果每次打开都被淘汰重编。放大到 512MB，第二次打开才能直接复用。
app.commandLine.appendSwitch('gpu-disk-cache-size-kb', String(512 * 1024))

let mainWindow: electron.BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'Tact3D',
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

let projectWatchers: fsSync.FSWatcher[] = []
let watchedProjectRoot = ''

function stopProjectWatchers() {
  for (const watcher of projectWatchers) {
    try { watcher.close() } catch { /* ignore */ }
  }
  projectWatchers = []
  watchedProjectRoot = ''
}

async function startProjectCodeWatchers(projectDir: string) {
  if (watchedProjectRoot === projectDir && projectWatchers.length > 0) return
  stopProjectCodeWatchers()
  watchedProjectRoot = projectDir
  const pendingTimers = new Map<string, NodeJS.Timeout>()

  const scheduleEmit = (rel: string) => {
    const cleanRel = rel.replace(/\\/g, '/')
    if (!cleanRel.endsWith('.ts') || cleanRel.endsWith('.d.ts')) return
    const prev = pendingTimers.get(cleanRel)
    if (prev) clearTimeout(prev)
    const timer = setTimeout(() => {
      pendingTimers.delete(cleanRel)
      mainWindow?.webContents.send('codeAsset:changed', { relativePath: cleanRel })
    }, 120)
    pendingTimers.set(cleanRel, timer)
  }

  // 监听 Assets 目录树下所有 .ts / .shader.ts（与工程资源目录完全同步）
  const absAssets = path.join(projectDir, 'Assets')
  try {
    await fs.mkdir(absAssets, { recursive: true })
    const watcher = fsSync.watch(absAssets, { recursive: true }, (_eventType, fileName) => {
      if (!fileName) return
      scheduleEmit(`Assets/${String(fileName).replace(/\\/g, '/')}`)
    })
    projectWatchers.push(watcher)
  } catch {
    // ignore watcher setup failures
  }

  // 向后兼容旧工程根目录的 scripts / shaders（若存在则继续监听，不再主动创建空目录）
  for (const subDir of ['scripts', 'shaders']) {
    const absSub = path.join(projectDir, subDir)
    try {
      const stat = await fs.stat(absSub)
      if (!stat.isDirectory()) continue
      const watcher = fsSync.watch(absSub, (_eventType, fileName) => {
        if (!fileName) return
        scheduleEmit(`${subDir}/${String(fileName).replace(/\\/g, '/')}`)
      })
      projectWatchers.push(watcher)
    } catch {
      // 目录不存在时跳过
    }
  }
}

function registerIpc() {
  const userLibraryRoot = path.join(app.getPath('userData'), 'T3D')
  const pathGuard = new PathGuard([userLibraryRoot])
  const secretStore = new SecretStore(app.getPath('userData'))
  const inflightChats = new Map<string, AbortController>()

  ipcMain.handle('ai:listProviders', () => secretStore.listPublic())
  ipcMain.handle('ai:saveProvider', (_event, input) => secretStore.saveProvider(input))
  ipcMain.handle('ai:deleteProvider', (_event, id: string) => secretStore.deleteProvider(id))
  ipcMain.handle('ai:setActiveProvider', (_event, id: string, model?: string) => secretStore.setActiveProvider(id, model))
  ipcMain.handle('ai:abort', (_event, requestId: string) => {
    const controller = inflightChats.get(requestId)
    if (controller) {
      controller.abort()
      inflightChats.delete(requestId)
    }
  })
  ipcMain.handle('ai:chat', async (event, requestId: string, request: ChatRequest) => {
    const controller = new AbortController()
    inflightChats.set(requestId, controller)
    try {
      const { config, apiKey } = await secretStore.resolveCredentials(request.providerId)
      return await invokeModelChat(
        config,
        apiKey,
        request,
        (delta) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send('ai:delta', delta)
          }
        },
        requestId,
        controller.signal,
      )
    } catch (error) {
      if (!event.sender.isDestroyed()) {
        event.sender.send('ai:delta', {
          requestId,
          type: 'error',
          error: error instanceof Error ? error.message : String(error),
        })
      }
      throw error
    } finally {
      inflightChats.delete(requestId)
    }
  })

  ipcMain.handle('fs:authorizeRoot', (_event, dirPath: string) => {
    return pathGuard.authorizeRoot(dirPath)
  })
  ipcMain.handle('fs:readTextFile', async (_event, filePath: string) => {
    const safe = pathGuard.assertAllowed(filePath, '读取文本文件')
    return fs.readFile(safe, 'utf-8')
  })
  ipcMain.handle('fs:writeTextFile', async (_event, filePath: string, content: string) => {
    const safe = pathGuard.assertAllowed(filePath, '写入文本文件')
    await fs.mkdir(path.dirname(safe), { recursive: true })
    await fs.writeFile(safe, content, 'utf-8')
  })
  ipcMain.handle('fs:exists', async (_event, filePath: string) => {
    const safe = pathGuard.assertAllowed(filePath, '检查路径')
    try {
      await fs.access(safe)
      return true
    } catch {
      return false
    }
  })
  ipcMain.handle('fs:mkdir', async (_event, dirPath: string) => {
    const safe = pathGuard.assertAllowed(dirPath, '创建目录')
    await fs.mkdir(safe, { recursive: true })
  })
  ipcMain.handle('fs:readBinaryFile', async (_event, filePath: string) => {
    const safe = pathGuard.assertAllowed(filePath, '读取二进制文件')
    try {
      const buf = await fs.readFile(safe)
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  })
  ipcMain.handle('fs:writeBinaryFile', async (_event, filePath: string, data: ArrayBuffer | Uint8Array) => {
    const safe = pathGuard.assertAllowed(filePath, '写入二进制文件')
    await fs.mkdir(path.dirname(safe), { recursive: true })
    const bytes = data instanceof Uint8Array ? data : Buffer.from(data)
    await fs.writeFile(safe, bytes)
  })
  ipcMain.handle('fs:movePath', async (_event, src: string, dest: string) => {
    const safeSrc = pathGuard.assertAllowed(src, '移动源路径')
    const safeDest = pathGuard.assertAllowed(dest, '移动目标路径')
    await fs.mkdir(path.dirname(safeDest), { recursive: true })
    await fs.rename(safeSrc, safeDest)
  })
  ipcMain.handle('fs:unlinkFile', async (_event, filePath: string) => {
    const safe = pathGuard.assertAllowed(filePath, '删除文件')
    await fs.unlink(safe).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
  })
  ipcMain.handle('fs:removeDir', async (_event, dirPath: string) => {
    const safe = pathGuard.assertAllowed(dirPath, '删除目录')
    await fs.rmdir(safe).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
  })
  ipcMain.handle('fs:list', async (_event, dirPath: string) => {
    const safe = pathGuard.assertAllowed(dirPath, '列出目录')
    try {
      const entries = await fs.readdir(safe, { withFileTypes: true })
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
    const safe = pathGuard.assertAllowed(filePath, '在文件夹中显示')
    shell.showItemInFolder(safe)
  })
  ipcMain.handle('shell:openPath', async (_event, targetPath: string) => {
    const safe = pathGuard.assertAllowed(targetPath, '用外部程序打开')
    const error = await shell.openPath(safe)
    if (error) throw new Error(error)
  })
  ipcMain.handle('dialog:showOpenDirectoryDialog', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow
    const result = await dialog.showOpenDialog(win ?? undefined, { properties: ['openDirectory'] })
    if (result.canceled || !result.filePaths[0]) return null
    return pathGuard.authorizeRoot(result.filePaths[0])
  })
  ipcMain.handle('player:copyShell', async (_event, targetDir: string) => {
    const safeTarget = pathGuard.assertAllowed(targetDir, '复制 Web 播放包外壳')
    const candidates = [
      path.join(__dirname, '../dist-player'),
      path.join(app.getAppPath(), 'dist-player'),
      path.join(process.cwd(), 'dist-player'),
    ]
    let shellDir: string | null = null
    for (const candidate of candidates) {
      try {
        await fs.access(path.join(candidate, 'player.html'))
        shellDir = candidate
        break
      } catch {
        // try next
      }
    }
    if (!shellDir) {
      return { ok: false, copiedFiles: [], message: '未找到 dist-player 构建产物，请先运行 npm run build:player' }
    }
    await fs.cp(shellDir, safeTarget, { recursive: true, force: true })
    const playerHtml = path.join(safeTarget, 'player.html')
    const indexHtml = path.join(safeTarget, 'index.html')
    await fs.copyFile(playerHtml, indexHtml)
    return { ok: true, copiedFiles: [playerHtml, indexHtml], message: '已复制 Web 播放包外壳' }
  })
  ipcMain.handle('codeAssets:watchProject', async (_event, projectDir: string) => {
    const safe = pathGuard.assertAllowed(projectDir, '监听代码资产目录')
    await startProjectCodeWatchers(safe)
    return true
  })
  ipcMain.handle('codeAssets:openInEditor', async (_event, filePath: string, preferred?: string) => {
    const safe = pathGuard.assertAllowed(filePath, '在外部编辑器打开代码资产')
    const cmd = preferred === 'code' ? 'code' : 'cursor'
    try {
      const child = spawn(cmd, [safe], { detached: true, stdio: 'ignore', shell: process.platform === 'win32' })
      child.unref()
      return { ok: true, launcher: cmd }
    } catch {
      const err = await shell.openPath(safe)
      if (err) throw new Error(err)
      return { ok: true, launcher: 'system' }
    }
  })
  ipcMain.handle(
    'viewport:capturePage',
    async (
      event,
      rect?: { x: number; y: number; width: number; height: number },
      maxWidth?: number,
    ) => {
      const win = BrowserWindow.fromWebContents(event.sender) ?? mainWindow
      if (!win || win.isDestroyed()) return null
      const safeRect = rect && rect.width > 4 && rect.height > 4
        ? {
            x: Math.max(0, Math.round(rect.x)),
            y: Math.max(0, Math.round(rect.y)),
            width: Math.max(1, Math.round(rect.width)),
            height: Math.max(1, Math.round(rect.height)),
          }
        : undefined
      let image = safeRect ? await win.webContents.capturePage(safeRect) : await win.webContents.capturePage()
      if (image.isEmpty()) return null
      const size = image.getSize()
      const capW = typeof maxWidth === 'number' && maxWidth > 0 ? Math.round(maxWidth) : 960
      if (size.width > capW && capW > 0) {
        const capH = Math.max(1, Math.round((size.height * capW) / size.width))
        image = image.resize({ width: capW, height: capH, quality: 'good' })
      }
      const jpeg = image.toJPEG(86)
      return `data:image/jpeg;base64,${jpeg.toString('base64')}`
    },
  )
}
