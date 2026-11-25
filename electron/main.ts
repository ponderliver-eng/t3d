import * as electron from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { PathGuard } from './services/pathGuard'
import { PackageArchiveSessions } from './services/packageArchive'
import { SecretStore } from './services/secretStore'
import { invokeModelChat, type ChatRequest } from './services/modelProviders'

const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage } = electron
const execFileAsync = promisify(execFile)

function pngToMultiResIco(pngBytes: Uint8Array): Buffer | null {
  const baseImg = nativeImage.createFromBuffer(Buffer.from(pngBytes))
  if (baseImg.isEmpty()) return null
  const sizes = [16, 32, 48, 64, 128, 256]
  const frames: Array<{ size: number; png: Buffer }> = []
  for (const size of sizes) {
    const resized = baseImg.resize({ width: size, height: size, quality: 'best' })
    const buf = resized.toPNG()
    if (buf.length > 0) frames.push({ size, png: buf })
  }
  if (frames.length === 0) return null

  const headerSize = 6 + frames.length * 16
  let offset = headerSize
  const totalSize = headerSize + frames.reduce((sum, f) => sum + f.png.length, 0)
  const out = Buffer.alloc(totalSize)

  out.writeUInt16LE(0, 0) // Reserved
  out.writeUInt16LE(1, 2) // ICO type
  out.writeUInt16LE(frames.length, 4)

  frames.forEach((frame, idx) => {
    const dirOffset = 6 + idx * 16
    out.writeUInt8(frame.size >= 256 ? 0 : frame.size, dirOffset)
    out.writeUInt8(frame.size >= 256 ? 0 : frame.size, dirOffset + 1)
    out.writeUInt8(0, dirOffset + 2)
    out.writeUInt8(0, dirOffset + 3)
    out.writeUInt16LE(1, dirOffset + 4)
    out.writeUInt16LE(32, dirOffset + 6)
    out.writeUInt32LE(frame.png.length, dirOffset + 8)
    out.writeUInt32LE(offset, dirOffset + 12)
    frame.png.copy(out, offset)
    offset += frame.png.length
  })

  return out
}

async function resolveRceditBinary(): Promise<string | null> {
  const binName = process.arch === 'ia32' ? 'rcedit.exe' : 'rcedit-x64.exe'
  const candidates = [
    path.join(process.cwd(), 'node_modules', 'rcedit', 'bin', binName),
    path.join(app.getAppPath(), 'node_modules', 'rcedit', 'bin', binName),
    path.join(__dirname, '..', 'node_modules', 'rcedit', 'bin', binName),
  ]
  for (const c of candidates) {
    if (fsSync.existsSync(c)) return c
  }
  return null
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL
const RENDERER_DIST = path.join(__dirname, '../dist')

app.commandLine.appendSwitch('enable-unsafe-webgpu')
app.commandLine.appendSwitch('ignore-gpu-blocklist')
app.commandLine.appendSwitch('force_high_performance_gpu')
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
// 显卡着色器磁盘缓存默认只有几 MB，一个场景编译出的着色器就能把它挤满，
// 结果每次打开都被淘汰重编。放大到 512MB，第二次打开才能直接复用。
app.commandLine.appendSwitch('gpu-disk-cache-size-kb', String(512 * 1024))

let mainWindow: electron.BrowserWindow | null = null

function resolveDefaultTact3dIcon(ext: 'ico' | 'png'): string | undefined {
  const file = `tact3d-icon.${ext}`
  const candidates = [
    path.join(RENDERER_DIST, file),
    path.join(__dirname, '../public', file),
    path.join(app.getAppPath(), 'public', file),
    path.join(process.cwd(), 'public', file),
  ]
  for (const c of candidates) {
    if (fsSync.existsSync(c)) return c
  }
  return undefined
}

function createWindow() {
  const iconPath = resolveDefaultTact3dIcon('ico') ?? resolveDefaultTact3dIcon('png')
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'Tact3D',
    ...(iconPath ? { icon: iconPath } : {}),
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
  stopProjectWatchers()
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

  ipcMain.handle('app:userLibraryRoot', () => userLibraryRoot)

  // 大体积资源包：主进程流式解压并建索引，渲染进程按偏移一次只取一个文件
  const packageSessions = new PackageArchiveSessions(path.join(app.getPath('temp'), 'T3D-pkg-staging'))
  void packageSessions.purgeStale()
  app.on('will-quit', () => packageSessions.closeAllSync())
  ipcMain.handle('package:open', (event, sessionId: string, packagePath: string) => {
    return packageSessions.open(sessionId, packagePath, (done, total) => {
      if (!event.sender.isDestroyed()) event.sender.send('package:progress', { sessionId, done, total })
    })
  })
  ipcMain.handle('package:read', (_event, sessionId: string, offset: number, size: number) => {
    return packageSessions.read(sessionId, offset, size)
  })
  ipcMain.handle('package:close', (_event, sessionId: string) => packageSessions.close(sessionId))

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
  ipcMain.handle(
    'player:buildElectron',
    async (
      _event,
      targetDir: string,
      options: {
        appName?: string
        width?: number
        height?: number
        fullscreen?: boolean
        resizable?: boolean
        iconPngBytes?: number[]
      },
    ) => {
      const safeTarget = pathGuard.assertAllowed(targetDir, '构建 Electron 桌面端')
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
        return { ok: false, appDir: '', executablePath: '', message: '未找到 dist-player 构建产物，请先运行 npm run build:player' }
      }

      const rawName = (options?.appName || 'Tact3D Game').trim()
      const safeExeName = rawName.replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_').trim() || 'Tact3D-Game'
      const appDir = path.join(safeTarget, 'resources', 'app')
      await fs.mkdir(appDir, { recursive: true })
      await fs.cp(shellDir, appDir, { recursive: true, force: true })
      await fs.copyFile(path.join(appDir, 'player.html'), path.join(appDir, 'index.html'))

      const width = Math.max(320, Math.round(Number(options?.width) || 1280))
      const height = Math.max(240, Math.round(Number(options?.height) || 720))
      const fullscreen = Boolean(options?.fullscreen)
      const resizable = options?.resizable !== false

      let icoPath = ''
      if (Array.isArray(options?.iconPngBytes) && options.iconPngBytes.length > 0) {
        try {
          const icoBuf = pngToMultiResIco(Uint8Array.from(options.iconPngBytes))
          if (icoBuf) {
            icoPath = path.join(appDir, 'app.ico')
            await fs.writeFile(icoPath, icoBuf)
          }
        } catch (err) {
          console.warn('[buildElectron] 生成 app.ico 失败:', err)
        }
      } else {
        const defaultIco = resolveDefaultTact3dIcon('ico')
        if (defaultIco) {
          icoPath = path.join(appDir, 'app.ico')
          await fs.copyFile(defaultIco, icoPath).catch(() => { icoPath = '' })
        }
      }

      await fs.writeFile(
        path.join(appDir, 'package.json'),
        `${JSON.stringify({ name: 'tact3d-player-app', version: '1.0.0', main: 'main.cjs' }, null, 2)}\n`,
        'utf-8',
      )

      const mainCjs = `const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ktx2': 'application/octet-stream',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.svg': 'image/svg+xml',
};

function startStaticServer(rootDir) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const reqPath = decodeURIComponent((req.url || '/').split('?')[0]);
      const rel = reqPath === '/' ? 'index.html' : reqPath.replace(/^\\/+/, '');
      const full = path.resolve(rootDir, rel);
      if (!full.startsWith(rootDir)) {
        res.writeHead(403);
        res.end();
        return;
      }
      fs.readFile(full, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end('Not Found');
          return;
        }
        const ext = path.extname(full).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, port: addr.port });
    });
  });
}

let serverRef = null;
app.commandLine.appendSwitch('enable-unsafe-webgpu');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('gpu-disk-cache-size-kb', String(512 * 1024));

app.whenReady().then(async () => {
  const { server, port } = await startStaticServer(__dirname);
  serverRef = server;
  const win = new BrowserWindow({
    width: ${width},
    height: ${height},
    fullscreen: ${fullscreen},
    resizable: ${resizable},
    title: ${JSON.stringify(rawName)},
    ${icoPath ? `icon: path.join(__dirname, 'app.ico'),` : ''}
    backgroundColor: '#141820',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.setMenu(null);
  win.loadURL('http://127.0.0.1:' + port + '/index.html');
});

app.on('window-all-closed', () => {
  if (serverRef) serverRef.close();
  app.quit();
});
`
      await fs.writeFile(path.join(appDir, 'main.cjs'), mainCjs, 'utf-8')

      let executablePath = ''
      let runtimeCopied = false
      let iconPatched = false
      const execDir = path.dirname(process.execPath)
      try {
        const entries = await fs.readdir(execDir, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.name === 'resources') continue
          const src = path.join(execDir, entry.name)
          const dest = path.join(safeTarget, entry.name)
          await fs.cp(src, dest, { recursive: true, force: true })
        }
        if (process.platform === 'win32') {
          const origExe = path.join(safeTarget, path.basename(process.execPath))
          const renamedExe = path.join(safeTarget, `${safeExeName}.exe`)
          if (origExe.toLowerCase() !== renamedExe.toLowerCase()) {
            await fs.rename(origExe, renamedExe).catch(() => undefined)
          }
          executablePath = renamedExe
          if (icoPath) {
            const rceditBin = await resolveRceditBinary()
            if (rceditBin) {
              try {
                await execFileAsync(rceditBin, [
                  executablePath,
                  '--set-icon',
                  icoPath,
                  '--set-version-string',
                  'ProductName',
                  rawName,
                  '--set-version-string',
                  'FileDescription',
                  rawName,
                ])
                iconPatched = true
              } catch (err) {
                console.warn('[buildElectron] rcedit 替换 exe 图标失败:', err)
              }
            } else {
              console.warn('[buildElectron] 未找到 rcedit 可执行文件，跳过替换 exe 图标')
            }
          }
        } else {
          executablePath = path.join(safeTarget, path.basename(process.execPath))
        }
        runtimeCopied = true
      } catch (err) {
        console.warn('[buildElectron] 复制 Electron 运行时失败:', err)
      }

      return {
        ok: true,
        appDir,
        executablePath,
        runtimeCopied,
        iconPatched,
        message: runtimeCopied
          ? `已构建 Electron 桌面端至 ${safeTarget}${iconPatched ? '（已替换 .exe 图标）' : ''}`
          : `已生成桌面端资源包（${appDir}），但复制运行时失败`,
      }
    },
  )
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
