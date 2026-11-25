import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import zlib from 'node:zlib'
import { Transform, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

/**
 * 大体积资源包（.unitypackage = tar.gz）的流式索引。
 *
 * 整包不进内存：压缩流边解压边写到临时 tar 文件，同时用状态机解析 tar 头，
 * 只记录每个条目的「路径 + 在 tar 里的偏移 + 大小」。之后按偏移从临时文件里
 * 一次读一个条目。内存占用只和「单个条目」有关，和包的总大小无关。
 */

export interface TarIndexEntry {
  path: string
  /** tar 类型标记：'0' 普通文件，'5' 目录（目录不进索引） */
  type: string
  /** 条目内容在（解压后的）tar 流里的起始偏移 */
  offset: number
  size: number
  /** 扫描时就读出来的小文件内容（路径名、.meta 这类元数据） */
  inline?: Uint8Array
}

export type TarInlinePredicate = (entryPath: string, size: number) => boolean

const BLOCK = 512

export class TarIndexer {
  readonly entries: TarIndexEntry[] = []
  /** 已处理的 tar 字节数 */
  position = 0
  private readonly header = Buffer.alloc(BLOCK)
  private headerFill = 0
  private bodyRemaining = 0
  private padRemaining = 0
  private capture: { kind: 'inline' | 'longName' | 'pax', entry: TarIndexEntry | null, chunks: Buffer[] } | null = null
  private pendingPath: string | null = null
  private ended = false

  constructor(private readonly shouldInline: TarInlinePredicate = () => false) {}

  write(chunk: Uint8Array): void {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
    let cursor = 0
    while (cursor < data.length) {
      if (this.ended) {
        this.position += data.length - cursor
        return
      }
      const available = data.length - cursor
      if (this.bodyRemaining > 0) {
        const take = Math.min(this.bodyRemaining, available)
        // 必须拷贝：解压流会复用底层缓冲
        if (this.capture) this.capture.chunks.push(Buffer.from(data.subarray(cursor, cursor + take)))
        this.bodyRemaining -= take
        cursor += take
        this.position += take
        if (this.bodyRemaining === 0) this.finishBody()
        continue
      }
      if (this.padRemaining > 0) {
        const take = Math.min(this.padRemaining, available)
        this.padRemaining -= take
        cursor += take
        this.position += take
        continue
      }
      const take = Math.min(BLOCK - this.headerFill, available)
      data.copy(this.header, this.headerFill, cursor, cursor + take)
      this.headerFill += take
      cursor += take
      this.position += take
      if (this.headerFill === BLOCK) {
        this.headerFill = 0
        this.readHeader()
      }
    }
  }

  /** 流结束时调用：内容没读完说明包被截断了。 */
  finish(): void {
    if (this.bodyRemaining > 0 || this.headerFill > 0) {
      throw new Error('资源包不完整：文件在中途被截断')
    }
  }

  private readHeader() {
    const header = this.header
    if (isZeroBlock(header)) {
      this.ended = true
      return
    }
    const name = readString(header, 0, 100)
    const prefix = readString(header, 345, 155)
    const size = readSize(header, 124, 12)
    const type = readString(header, 156, 1) || '0'
    this.bodyRemaining = size
    this.padRemaining = (BLOCK - (size % BLOCK)) % BLOCK

    if (type === 'L') {
      // GNU 长文件名：内容是下一个条目的完整路径
      this.capture = { kind: 'longName', entry: null, chunks: [] }
    } else if (type === 'x') {
      // pax 扩展头：其中的 path 记录覆盖下一个条目的路径
      this.capture = { kind: 'pax', entry: null, chunks: [] }
    } else if (type === 'g') {
      this.capture = null
    } else {
      const entryPath = normalizePath(this.pendingPath ?? (prefix ? `${prefix}/${name}` : name))
      this.pendingPath = null
      if (entryPath && type !== '5') {
        const entry: TarIndexEntry = { path: entryPath, type, offset: this.position, size }
        this.entries.push(entry)
        this.capture = size > 0 && this.shouldInline(entryPath, size) ? { kind: 'inline', entry, chunks: [] } : null
        if (size === 0 && this.shouldInline(entryPath, 0)) entry.inline = new Uint8Array(0)
      } else {
        this.capture = null
      }
    }
    if (this.bodyRemaining === 0) this.finishBody()
  }

  private finishBody() {
    const capture = this.capture
    this.capture = null
    if (!capture) return
    const bytes = Buffer.concat(capture.chunks)
    if (capture.kind === 'inline' && capture.entry) {
      capture.entry.inline = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    } else if (capture.kind === 'longName') {
      this.pendingPath = bytes.toString('utf-8').replace(/\0+$/, '')
    } else if (capture.kind === 'pax') {
      const found = paxPath(bytes.toString('utf-8'))
      if (found) this.pendingPath = found
    }
  }
}

function paxPath(text: string): string | null {
  // 每条记录形如 "<长度> key=value\n"
  let cursor = 0
  while (cursor < text.length) {
    const space = text.indexOf(' ', cursor)
    if (space < 0) break
    const length = Number.parseInt(text.slice(cursor, space), 10)
    if (!Number.isFinite(length) || length <= 0) break
    const record = text.slice(space + 1, cursor + length).replace(/\n$/, '')
    const eq = record.indexOf('=')
    if (eq > 0 && record.slice(0, eq) === 'path') return record.slice(eq + 1)
    cursor += length
  }
  return null
}

function isZeroBlock(block: Buffer): boolean {
  for (let i = 0; i < block.length; i += 1) if (block[i] !== 0) return false
  return true
}

function readString(block: Buffer, offset: number, length: number): string {
  let end = offset
  const max = offset + length
  while (end < max && block[end] !== 0) end += 1
  return block.toString('utf-8', offset, end).trim()
}

function readSize(block: Buffer, offset: number, length: number): number {
  // 超过 8GB 的条目用二进制大端表示（最高位为 1）
  if ((block[offset]! & 0x80) !== 0) {
    let value = 0
    for (let i = offset + 1; i < offset + length; i += 1) value = value * 256 + block[i]!
    return value
  }
  const raw = readString(block, offset, length)
  if (!raw) return 0
  const value = Number.parseInt(raw, 8)
  return Number.isFinite(value) && value >= 0 ? value : 0
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/')
}

/** 单次读取上限：超过这个大小的单个条目无法整份交给渲染进程。 */
export const PACKAGE_READ_LIMIT = 1536 * 1024 * 1024
/** 扫描时直接读出来的元数据文件大小上限。 */
const INLINE_LIMIT = 4 * 1024 * 1024

export interface PackageOpenResult {
  sessionId: string
  /** 解压后的 tar 总字节数 */
  tarBytes: number
  entries: TarIndexEntry[]
}

interface PackageSession {
  tarPath: string
  /** tar 文件是不是我们解压出来的临时文件（是的话关闭时要删） */
  temporary: boolean
  tarBytes: number
  handle: fsp.FileHandle | null
  abort: AbortController
}

/** Unity 资源包里每条记录是一个目录，目录下的这两个文件是扫描阶段必须读到的元数据。 */
function unityPackageInline(entryPath: string, size: number): boolean {
  if (size > INLINE_LIMIT) return false
  const slash = entryPath.indexOf('/')
  if (slash < 0) return false
  const leaf = entryPath.slice(slash + 1)
  return leaf === 'pathname' || leaf === 'asset.meta'
}

export class PackageArchiveSessions {
  private readonly sessions = new Map<string, PackageSession>()

  constructor(private readonly stagingDir: string) {}

  /** 启动时清掉上次异常退出留下的临时文件。 */
  async purgeStale(): Promise<void> {
    try {
      const names = await fsp.readdir(this.stagingDir)
      await Promise.all(names.map(name => fsp.rm(path.join(this.stagingDir, name), { force: true }).catch(() => undefined)))
    } catch {
      // 目录还不存在
    }
  }

  async open(
    sessionId: string,
    packagePath: string,
    onProgress?: (done: number, total: number) => void,
  ): Promise<PackageOpenResult> {
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(sessionId)) throw new Error('资源包会话编号不合法')
    if (!/\.unitypackage$/i.test(packagePath)) throw new Error('只支持 .unitypackage 资源包')
    await this.close(sessionId)
    const stat = await fsp.stat(packagePath)
    const gzip = await isGzip(packagePath)
    const abort = new AbortController()
    const session: PackageSession = {
      tarPath: packagePath,
      temporary: false,
      tarBytes: stat.size,
      handle: null,
      abort,
    }
    this.sessions.set(sessionId, session)
    const indexer = new TarIndexer(unityPackageInline)
    let done = 0
    let lastReport = 0
    const report = (force = false) => {
      const now = Date.now()
      if (!force && now - lastReport < 150) return
      lastReport = now
      onProgress?.(done, stat.size)
    }
    try {
      // 读取流必须在接上管道的同一刻才创建：挂了 data 监听的流会立刻开始吐数据，
      // 中间只要隔一个 await（建目录、查磁盘空间），开头的数据就丢了，表现为随机报「资源包已损坏」
      const openSource = () => {
        const source = fs.createReadStream(packagePath, { highWaterMark: 1024 * 1024 })
        source.on('data', chunk => {
          done += chunk.length
          report()
        })
        return source
      }
      const tap = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          try {
            indexer.write(chunk)
            callback(null, chunk)
          } catch (error) {
            callback(error as Error)
          }
        },
      })
      if (gzip) {
        await fsp.mkdir(this.stagingDir, { recursive: true })
        await assertFreeSpace(this.stagingDir, stat.size)
        session.tarPath = path.join(this.stagingDir, `${sessionId}.tar`)
        session.temporary = true
        const sink = fs.createWriteStream(session.tarPath, { highWaterMark: 1024 * 1024 })
        await pipeline(openSource(), zlib.createGunzip(), tap, sink, { signal: abort.signal })
      } else {
        // 未压缩的 tar：直接在原文件上建索引，不需要临时文件
        const indexOnly = new Writable({
          write(chunk: Buffer, _encoding, callback) {
            try {
              indexer.write(chunk)
              callback()
            } catch (error) {
              callback(error as Error)
            }
          },
        })
        await pipeline(openSource(), indexOnly, { signal: abort.signal })
      }
      indexer.finish()
      session.tarBytes = indexer.position
      session.handle = await fsp.open(session.tarPath, 'r')
      report(true)
      return { sessionId, tarBytes: session.tarBytes, entries: indexer.entries }
    } catch (error) {
      await this.close(sessionId)
      // 取消时会话已经先被关掉，那一刻写入流还占着文件删不掉；这里等流结束后再删一次
      if (session.temporary) await fsp.rm(session.tarPath, { force: true }).catch(() => undefined)
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOSPC') throw new Error('磁盘空间不足，无法解压资源包')
      if (code === 'ABORT_ERR') throw new Error('已取消')
      if (code === 'Z_DATA_ERROR' || code === 'Z_BUF_ERROR') throw new Error('资源包已损坏，无法解压')
      throw error
    }
  }

  async read(sessionId: string, offset: number, size: number): Promise<ArrayBuffer> {
    const session = this.sessions.get(sessionId)
    if (!session?.handle) throw new Error('资源包会话已关闭')
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0 || offset + size > session.tarBytes) {
      throw new Error('资源包读取范围越界')
    }
    if (size > PACKAGE_READ_LIMIT) {
      throw new Error(`单个文件超过 ${Math.round(PACKAGE_READ_LIMIT / 1024 / 1024)}MB，无法导入`)
    }
    const buffer = new ArrayBuffer(size)
    const view = new Uint8Array(buffer)
    let filled = 0
    while (filled < size) {
      const { bytesRead } = await session.handle.read(view, filled, size - filled, offset + filled)
      if (bytesRead === 0) throw new Error('资源包读取失败：临时文件不完整')
      filled += bytesRead
    }
    return buffer
  }

  async close(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) return
    this.sessions.delete(sessionId)
    session.abort.abort()
    await session.handle?.close().catch(() => undefined)
    if (session.temporary) await fsp.rm(session.tarPath, { force: true }).catch(() => undefined)
  }

  /** 退出应用时同步清理，避免留下几个 GB 的临时文件。 */
  closeAllSync(): void {
    for (const session of this.sessions.values()) {
      session.abort.abort()
      if (session.temporary) {
        try { fs.rmSync(session.tarPath, { force: true }) } catch { /* 文件仍被占用时留给下次启动清理 */ }
      }
    }
    this.sessions.clear()
  }
}

async function isGzip(filePath: string): Promise<boolean> {
  const handle = await fsp.open(filePath, 'r')
  try {
    const magic = Buffer.alloc(2)
    const { bytesRead } = await handle.read(magic, 0, 2, 0)
    return bytesRead === 2 && magic[0] === 0x1f && magic[1] === 0x8b
  } finally {
    await handle.close()
  }
}

async function assertFreeSpace(dir: string, compressedBytes: number): Promise<void> {
  try {
    const info = await fsp.statfs(dir)
    const free = Number(info.bavail) * Number(info.bsize)
    // 解压后的大小事先不知道，至少要留出压缩包本身的 1.5 倍
    const needed = compressedBytes * 1.5
    if (free < needed) {
      throw Object.assign(new Error(`磁盘空间不足：解压资源包至少需要 ${formatGb(needed)}，临时目录所在磁盘只剩 ${formatGb(free)}`), { code: 'T3D_SPACE' })
    }
  } catch (error) {
    if ((error as { code?: string }).code === 'T3D_SPACE') throw error
    // 查不到剩余空间时不拦截，写满时会报 ENOSPC
  }
}

function formatGb(bytes: number): string {
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}GB`
}
