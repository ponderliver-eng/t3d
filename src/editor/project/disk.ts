import { create } from 'zustand'
import type { AssetMeta } from '../assets/cache'
import type { ProjectDocument } from '../scene/document'
import { ASSETS_ROOT, normalizeDir } from '../assets/folders'
import { directoryBaseName, electronBridge, joinProjectPath, toArrayBuffer } from './electronBridge'

/**
 * 目录工程，对应 GM 的 project.gm3d + Assets/ + .cache/gm3d/。
 *
 *   <工程文件夹>/
 *     project.t3d
 *     .gitignore          # 忽略 .cache/
 *     Assets/             # 源文件，子目录与资源面板一致
 *     .cache/t3d/
 *       import-artifacts/ # 可丢弃的 GLB 成品
 *       editor-library/v1/cache-index.json
 *
 * 浏览器拿不到绝对路径，只保存目录句柄。权限在用户手势里授予，刷新后若仍为 granted 则直接恢复。
 */

export const PROJECT_FILE = 'project.t3d'
export const CACHE_ROOT = '.cache/t3d'
export const IMPORT_ARTIFACTS = `${CACHE_ROOT}/import-artifacts`
export const TEXTURE_ARTIFACTS = `${CACHE_ROOT}/texture-artifacts`
export const TEXTURE_ORIGINALS = `${CACHE_ROOT}/texture-originals`
export const CACHE_INDEX_PATH = `${CACHE_ROOT}/editor-library/v1/cache-index.json`
export const DEFAULT_ASSET_FOLDERS = [
  'Assets/Models',
  'Assets/Images',
  'Assets/Audio',
  'Assets/Materials',
  'Assets/Animations',
  'Assets/Scripts',
  'Assets/Shaders',
]

const HANDLE_DB = 't3d-project-directory'
const HANDLE_STORE = 'handles'
const RECENT_STORE = 'recents'
const HANDLE_KEY = 'current'
const DB_VERSION = 2
const CACHE_INDEX_VERSION = 1

export interface DirectoryAssetRecord extends AssetMeta {
  relativePath: string
}

interface CacheIndexFile {
  schemaVersion: number
  generatedAt: number
  artifacts: Record<string, { path: string, bytes: number, savedAt: number }>
}

interface DirectoryProjectState {
  active: boolean
  name: string
  epoch: number
}

export const useProjectDirectory = create<DirectoryProjectState>(() => ({
  active: false,
  name: '',
  epoch: 0,
}))

type ProjectRoot =
  | { kind: 'handle', handle: FileSystemDirectoryHandle }
  | { kind: 'path', path: string }

let root: ProjectRoot | null = null
let texArtifactsDirPromise: Promise<FileSystemDirectoryHandle | null> | null = null
let projectName = ''
let records = new Map<string, DirectoryAssetRecord>()
let storedDocument: ProjectDocument | null = null
let cacheIndex: CacheIndexFile = emptyIndex()
let flushHook: (() => void) | null = null
let flushTimer = 0
let flushEnabled = true
let ioChain: Promise<void> = Promise.resolve()

export function projectRootPath(): string | null {
  return root?.kind === 'path' ? root.path : null
}

export function assetDiskPath(id: string): string | null {
  const base = projectRootPath()
  const record = records.get(id)
  if (!base || !record) return null
  return joinProjectPath(base, record.relativePath)
}

export function folderDiskPath(relativeDir: string): string | null {
  const base = projectRootPath()
  if (!base) return null
  return joinProjectPath(base, relativeDir)
}

export function isDirectoryProject(): boolean {
  return root !== null
}

export function directoryProjectName(): string {
  return projectName
}

export function bindDirectoryFlush(hook: () => void) {
  flushHook = hook
}

export function setDirectoryFlushEnabled(enabled: boolean) {
  flushEnabled = enabled
  if (!enabled) window.clearTimeout(flushTimer)
}

export function assetRecord(id: string): DirectoryAssetRecord | undefined {
  return records.get(id)
}

export function assetRecords(): DirectoryAssetRecord[] {
  return [...records.values()]
}

export function sceneDocument<T>(): T | null {
  return storedDocument as T | null
}

export async function pickDirectory(): Promise<FileSystemDirectoryHandle | string | null> {
  const desktop = electronBridge()
  if (desktop) return desktop.dialog.showOpenDirectoryDialog()
  if (typeof window.showDirectoryPicker !== 'function') {
    throw Object.assign(new Error('showDirectoryPicker'), { code: 'browser' })
  }
  try {
    return await window.showDirectoryPicker({
      id: 't3d-project',
      mode: 'readwrite',
      startIn: 'documents',
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null
    throw error
  }
}

export async function restoreGrantedHandle(): Promise<FileSystemDirectoryHandle | 'prompt' | 'missing'> {
  const handle = await loadHandle()
  if (!handle) return 'missing'
  const allowed = await ensureDirectoryPermission(handle)
  return allowed ? handle : 'prompt'
}

/** 已持久授权时刷新后可直接通过；否则尝试申请，没有用户手势时会失败。 */
export async function ensureDirectoryPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const mode = { mode: 'readwrite' as const }
  try {
    if ((await handle.queryPermission(mode)) === 'granted') return true
  } catch {
    return false
  }
  try {
    return (await handle.requestPermission(mode)) === 'granted'
  } catch {
    return false
  }
}

export async function storedDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  return loadHandle()
}

export function openProjectDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(HANDLE_DB, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(HANDLE_STORE)) db.createObjectStore(HANDLE_STORE)
      if (!db.objectStoreNames.contains(RECENT_STORE)) db.createObjectStore(RECENT_STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export const RECENT_HANDLE_STORE = RECENT_STORE

export async function readProjectText(source: FileSystemDirectoryHandle | string): Promise<string | null> {
  if (typeof source === 'string') {
    await electronBridge()?.fs.authorizeRoot?.(source)
  }
  const current = asRoot(source)
  return await readText(current, PROJECT_FILE) ?? await readText(current, `${PROJECT_FILE}.tmp`)
}

export async function scaffold(source: FileSystemDirectoryHandle | string): Promise<void> {
  const current = asRoot(source)
  await ensureDirectoryOn(current, ASSETS_ROOT)
  for (const folder of DEFAULT_ASSET_FOLDERS) await ensureDirectoryOn(current, folder)
  await ensureDirectoryOn(current, IMPORT_ARTIFACTS)
  await ensureDirectoryOn(current, CACHE_INDEX_PATH.slice(0, CACHE_INDEX_PATH.lastIndexOf('/')))
  const gitignore = await readText(current, '.gitignore')
  if (gitignore == null) {
    await writeText(current, '.gitignore', '.cache/\n')
    return
  }
  const ignoresCache = gitignore.split(/\r?\n/).some(line => {
    const trimmed = line.trim()
    return trimmed === '.cache' || trimmed === '.cache/'
  })
  if (!ignoresCache) await writeText(current, '.gitignore', `${gitignore.replace(/\s*$/, '')}\n.cache/\n`)
}

export async function begin(
  handle: FileSystemDirectoryHandle,
  name: string,
  assets: DirectoryAssetRecord[],
  document: ProjectDocument | null,
): Promise<void> {
  await beginRoot({ kind: 'handle', handle }, name || handle.name, assets, document)
  await rememberHandle(handle)
}

export async function beginPath(
  absPath: string,
  name: string,
  assets: DirectoryAssetRecord[],
  document: ProjectDocument | null,
): Promise<void> {
  await electronBridge()?.fs.authorizeRoot?.(absPath)
  await beginRoot({ kind: 'path', path: absPath }, name || directoryBaseName(absPath), assets, document)
}

export function projectDirectoryPath(): string | null {
  return root?.kind === 'path' ? root.path : null
}

async function beginRoot(
  next: ProjectRoot,
  name: string,
  assets: DirectoryAssetRecord[],
  document: ProjectDocument | null,
): Promise<void> {
  root = next
  texArtifactsDirPromise = null
  projectName = name
  records = new Map(assets.map(asset => [asset.id, asset]))
  storedDocument = document
  cacheIndex = await readIndex()
  useProjectDirectory.setState(state => ({ active: true, name: projectName, epoch: state.epoch + 1 }))
}

export async function listAssetDirectories(): Promise<string[]> {
  const { dirs } = await walkAssets()
  return dirs
}

export async function listAssetFiles(): Promise<string[]> {
  const { files } = await walkAssets()
  return files
}

export async function readProjectPath(path: string): Promise<ArrayBuffer | null> {
  const handle = requireRoot()
  assertLayoutPath(path)
  return readBytes(handle, path)
}

export async function ensureDirectory(path: string): Promise<void> {
  assertLayoutPath(path)
  await ensureDirectoryOn(requireRoot(), path)
}

export async function removeEmptyDirectory(path: string): Promise<void> {
  const normal = normalizeLayoutPath(path)
  if (!normal || normal === ASSETS_ROOT || normal === '.cache' || normal === CACHE_ROOT) return
  if (!normal.startsWith(`${ASSETS_ROOT}/`)) return
  const current = requireRoot()
  if (current.kind === 'path') {
    const desktop = electronBridge()
    if (!desktop) return
    const full = joinProjectPath(current.path, normal)
    const entries = await desktop.fs.list(full)
    if (entries.length > 0) return
    await desktop.fs.removeDir(full)
    return
  }
  const directory = await getDirectory(current.handle, normal, false)
  if (!directory) return
  const first = await directory.entries().next()
  if (!first.done) return
  const parts = normal.split('/')
  const name = parts.pop()
  if (!name) return
  const parentPath = parts.join('/')
  const parent = parentPath ? await getDirectory(current.handle, parentPath, false) : current.handle
  if (!parent) return
  await parent.removeEntry(name).catch(() => undefined)
}

export async function writeSourceAsset(meta: AssetMeta, bytes: ArrayBuffer, directory: string): Promise<void> {
  const handle = requireRoot()
  const existing = records.get(meta.id)
  const relativePath = allocatePath(normalizeDir(directory), meta.fileName, meta.id)
  assertLayoutPath(relativePath)
  await writeBytes(handle, relativePath, bytes)
  if (existing && existing.relativePath !== relativePath) await removeFile(handle, existing.relativePath)
  records.set(meta.id, {
    ...meta,
    relativePath,
    byteLength: bytes.byteLength,
    artifactReady: meta.artifactReady,
  })
  scheduleFlush()
}

export async function readAssetBytes(id: string): Promise<ArrayBuffer | null> {
  const record = records.get(id)
  if (!record) return null
  return readBytes(requireRoot(), record.relativePath)
}

export function patchAsset(id: string, patch: Partial<AssetMeta>): void {
  const current = records.get(id)
  if (!current) return
  records.set(id, { ...current, ...patch, id: current.id, relativePath: current.relativePath })
  scheduleFlush()
}

export function retargetAsset(id: string, relativePath: string): void {
  const current = records.get(id)
  const clean = normalizeLayoutPath(relativePath)
  if (!current || !clean || current.relativePath === clean) return
  assertLayoutPath(clean)
  current.relativePath = clean
  records.set(id, current)
  scheduleFlush()
}

export function adoptAsset(record: DirectoryAssetRecord): void {
  assertLayoutPath(record.relativePath)
  records.set(record.id, record)
  scheduleFlush()
}

export async function forgetAsset(id: string, artifactKey: string | null): Promise<void> {
  const current = records.get(id)
  records.delete(id)
  try {
    if (current) await removeFile(requireRoot(), current.relativePath)
    if (artifactKey) await deleteArtifact(artifactKey)
    await deleteOriginalTexture(id)
  } finally {
    scheduleFlush()
  }
}

export async function moveAssetFile(id: string, directory: string): Promise<void> {
  const current = records.get(id)
  if (!current) return
  const next = allocatePath(normalizeDir(directory), current.fileName, id)
  if (next === current.relativePath) return
  assertLayoutPath(next)
  await moveFile(requireRoot(), current.relativePath, next)
  current.relativePath = next
  records.set(id, current)
  scheduleFlush()
}

export async function snapshotSources(): Promise<Array<{ meta: DirectoryAssetRecord, bytes: ArrayBuffer }>> {
  const handle = requireRoot()
  const out: Array<{ meta: DirectoryAssetRecord, bytes: ArrayBuffer }> = []
  for (const meta of records.values()) {
    const bytes = await readBytes(handle, meta.relativePath)
    if (bytes) out.push({ meta, bytes })
  }
  return out
}

export function artifactFilePath(key: string): string {
  return `${IMPORT_ARTIFACTS}/${key}.glb`
}

export async function readArtifact(key: string): Promise<ArrayBuffer | null> {
  if (!key) return null
  return readBytes(requireRoot(), artifactFilePath(key))
}

export async function writeArtifact(key: string, bytes: ArrayBuffer): Promise<void> {
  const path = artifactFilePath(key)
  await writeBytes(requireRoot(), path, bytes)
  cacheIndex.artifacts[key] = { path, bytes: bytes.byteLength, savedAt: Date.now() }
  await writeIndex()
}

export async function deleteArtifact(key: string): Promise<void> {
  if (!key) return
  await removeFile(requireRoot(), artifactFilePath(key))
  delete cacheIndex.artifacts[key]
  await writeIndex()
}

function originalTexturePath(id: string): string {
  return `${TEXTURE_ORIGINALS}/${id}.t3dorig`
}

export async function writeOriginalTexture(id: string, fileName: string, bytes: ArrayBuffer): Promise<void> {
  const nameBytes = new TextEncoder().encode(fileName)
  const packed = new Uint8Array(4 + nameBytes.byteLength + bytes.byteLength)
  new DataView(packed.buffer).setUint32(0, nameBytes.byteLength, true)
  packed.set(nameBytes, 4)
  packed.set(new Uint8Array(bytes), 4 + nameBytes.byteLength)
  await writeBytes(requireRoot(), originalTexturePath(id), packed.buffer)
}

export async function readOriginalTexture(id: string): Promise<{ fileName: string, bytes: ArrayBuffer } | null> {
  if (!root) return null
  const packed = await readBytes(root, originalTexturePath(id))
  if (!packed || packed.byteLength < 4) return null
  const nameLen = new DataView(packed).getUint32(0, true)
  if (4 + nameLen > packed.byteLength) return null
  const fileName = new TextDecoder().decode(new Uint8Array(packed, 4, nameLen))
  const bytes = packed.slice(4 + nameLen)
  return { fileName, bytes }
}

export async function hasOriginalTexture(id: string): Promise<boolean> {
  if (!root) return false
  const path = originalTexturePath(id)
  if (root.kind === 'path') {
    const desktop = electronBridge()
    if (!desktop) return false
    return desktop.fs.exists(joinProjectPath(root.path, path))
  }
  const file = await getFile(root.handle, path, false)
  return file !== null
}

export async function deleteOriginalTexture(id: string): Promise<void> {
  if (!root) return
  await removeFile(root, originalTexturePath(id)).catch(() => undefined)
}

function textureArtifactFilePath(key: string): string {
  return `${TEXTURE_ARTIFACTS}/${key}.t3dtex`
}

function getTexArtifactsDir(handle: FileSystemDirectoryHandle, create: boolean): Promise<FileSystemDirectoryHandle | null> {
  if (!create && texArtifactsDirPromise) return texArtifactsDirPromise
  const next = getDirectory(handle, TEXTURE_ARTIFACTS, create).catch(() => null)
  if (!create) texArtifactsDirPromise = next
  return next
}

export async function readTextureArtifactFile(key: string): Promise<ArrayBuffer | null> {
  if (!key || !root) return null
  if (root.kind === 'handle') {
    const dir = await getTexArtifactsDir(root.handle, false)
    if (!dir) return null
    try {
      const file = await dir.getFileHandle(`${key}.t3dtex`, { create: false })
      return (await file.getFile()).arrayBuffer()
    } catch {
      return null
    }
  }
  return readBytes(root, textureArtifactFilePath(key))
}

export async function writeTextureArtifactFile(key: string, bytes: ArrayBuffer): Promise<void> {
  if (!key || !root) return
  if (root.kind === 'handle') {
    const dir = await getDirectory(root.handle, TEXTURE_ARTIFACTS, true)
    if (!dir) return
    texArtifactsDirPromise = Promise.resolve(dir)
    const file = await dir.getFileHandle(`${key}.t3dtex`, { create: true })
    const writable = await file.createWritable()
    try {
      await writable.write(bytes)
    } finally {
      await writable.close()
    }
    return
  }
  await writeBytes(root, textureArtifactFilePath(key), bytes)
}

export async function deleteTextureArtifactFile(key: string): Promise<void> {
  if (!key || !root) return
  await removeFile(root, textureArtifactFilePath(key)).catch(() => undefined)
}

export async function pruneArtifacts(validKeys: ReadonlySet<string>): Promise<number> {
  if (!root) return 0
  let removed = 0
  for (const key of Object.keys(cacheIndex.artifacts)) {
    if (validKeys.has(key)) continue
    await removeFile(requireRoot(), artifactFilePath(key)).catch(() => undefined)
    delete cacheIndex.artifacts[key]
    removed += 1
  }
  if (removed > 0) await writeIndex()
  return removed
}

export async function flushDocument(document: ProjectDocument): Promise<void> {
  const handle = requireRoot()
  storedDocument = document
  const payload = {
    schemaVersion: 1 as const,
    name: projectName,
    savedAt: Date.now(),
    document,
    assets: [...records.values()].map(record => ({ ...record })),
  }
  const text = JSON.stringify(payload, null, 2)
  await chainIo(async () => {
    await writeTextAtomic(handle, PROJECT_FILE, text)
  })
}

export function parentProjectPath(path: string): string {
  const clean = normalizeLayoutPath(path)
  if (!clean) return ASSETS_ROOT
  const index = clean.lastIndexOf('/')
  return index < 0 ? ASSETS_ROOT : clean.slice(0, index)
}

export function recordsFromUnknown(value: unknown): DirectoryAssetRecord[] {
  if (!Array.isArray(value)) return []
  const out: DirectoryAssetRecord[] = []
  for (const item of value) {
    const record = asRecord(item)
    if (record) out.push(record)
  }
  return out
}

function scheduleFlush() {
  if (!flushEnabled || !root) return
  window.clearTimeout(flushTimer)
  flushTimer = window.setTimeout(() => flushHook?.(), 300)
}

function emptyIndex(): CacheIndexFile {
  return { schemaVersion: CACHE_INDEX_VERSION, generatedAt: Date.now(), artifacts: {} }
}

function requireRoot(): ProjectRoot {
  if (!root) throw new Error('没有打开的项目目录')
  return root
}

function asRoot(source: FileSystemDirectoryHandle | string): ProjectRoot {
  return typeof source === 'string' ? { kind: 'path', path: source } : { kind: 'handle', handle: source }
}

function allocatePath(directory: string, fileName: string, selfId: string): string {
  const used = new Set<string>()
  for (const record of records.values()) {
    if (record.id !== selfId) used.add(record.relativePath.toLowerCase())
  }
  const safeName = safeFileName(fileName)
  const dir = normalizeDir(directory)
  let candidate = `${dir}/${safeName}`
  if (!used.has(candidate.toLowerCase())) return candidate
  const dot = safeName.lastIndexOf('.')
  const stem = dot > 0 ? safeName.slice(0, dot) : safeName
  const ext = dot > 0 ? safeName.slice(dot) : ''
  let index = 2
  while (used.has(`${dir}/${stem}-${index}${ext}`.toLowerCase())) index += 1
  return `${dir}/${stem}-${index}${ext}`
}

function safeFileName(name: string): string {
  const cleaned = name.replace(/[<>:"|?*\u0000-\u001f\\/]/g, '_').replace(/[. ]+$/g, '')
  return cleaned || 'asset'
}

function assertLayoutPath(path: string) {
  const normal = normalizeLayoutPath(path)
  if (!normal) throw new Error('空路径')
  const allowed = normal === PROJECT_FILE
    || normal === `${PROJECT_FILE}.tmp`
    || normal === '.gitignore'
    || normal === ASSETS_ROOT
    || normal.startsWith(`${ASSETS_ROOT}/`)
    || normal === CACHE_ROOT
    || normal.startsWith(`${CACHE_ROOT}/`)
    || normal === '.cache'
  if (!allowed) throw new Error(`路径超出项目布局：${normal}`)
}

function normalizeLayoutPath(path: string): string {
  return path.replace(/\\/g, '/').split('/').filter(part => part && part !== '.' && part !== '..').join('/')
}

async function walkAssets(): Promise<{ files: string[], dirs: string[] }> {
  const files: string[] = []
  const dirs: string[] = []
  const current = requireRoot()
  if (current.kind === 'path') {
    await walkPath(current.path, ASSETS_ROOT, files, dirs)
    return { files, dirs }
  }
  const assets = await getDirectory(current.handle, ASSETS_ROOT, false)
  if (!assets) return { files, dirs }
  await walk(assets, ASSETS_ROOT, files, dirs)
  return { files, dirs }
}

async function walkPath(absRoot: string, prefix: string, files: string[], dirs: string[]): Promise<void> {
  const desktop = electronBridge()
  if (!desktop) return
  const entries = await desktop.fs.list(joinProjectPath(absRoot, prefix))
  for (const entry of entries) {
    if (!entry.name || entry.name.startsWith('.')) continue
    const next = `${prefix}/${entry.name}`
    if (entry.kind === 'directory') {
      dirs.push(next)
      await walkPath(absRoot, next, files, dirs)
    } else {
      files.push(next)
    }
  }
}

async function walk(
  directory: FileSystemDirectoryHandle,
  prefix: string,
  files: string[],
  dirs: string[],
): Promise<void> {
  for await (const [name, handle] of directory.entries()) {
    if (!name || name.startsWith('.')) continue
    const path = `${prefix}/${name}`
    if (handle.kind === 'directory') {
      dirs.push(path)
      await walk(handle as FileSystemDirectoryHandle, path, files, dirs)
    } else if (handle.kind === 'file') {
      files.push(path)
    }
  }
}

async function readIndex(): Promise<CacheIndexFile> {
  const text = await readText(requireRoot(), CACHE_INDEX_PATH)
  if (!text) return emptyIndex()
  try {
    const parsed = JSON.parse(text) as Partial<CacheIndexFile>
    if (!parsed || parsed.schemaVersion !== CACHE_INDEX_VERSION || !parsed.artifacts || typeof parsed.artifacts !== 'object') {
      return emptyIndex()
    }
    return {
      schemaVersion: CACHE_INDEX_VERSION,
      generatedAt: typeof parsed.generatedAt === 'number' ? parsed.generatedAt : Date.now(),
      artifacts: parsed.artifacts,
    }
  } catch {
    return emptyIndex()
  }
}

async function writeIndex(): Promise<void> {
  const handle = requireRoot()
  cacheIndex.generatedAt = Date.now()
  const text = JSON.stringify(cacheIndex, null, 2)
  await chainIo(() => writeText(handle, CACHE_INDEX_PATH, text))
}

function chainIo(job: () => Promise<void>): Promise<void> {
  const run = ioChain.then(job, job)
  ioChain = run.then(() => undefined, () => undefined)
  return run
}

async function writeTextAtomic(current: ProjectRoot, path: string, text: string): Promise<void> {
  const tmp = `${path}.tmp`
  await writeText(current, tmp, text)
  await removeFile(current, path)
  const moved = await moveFile(current, tmp, path)
  if (!moved) {
    await writeText(current, path, text)
    await removeFile(current, tmp)
  }
}

async function moveFile(current: ProjectRoot, fromPath: string, toPath: string): Promise<boolean> {
  if (current.kind === 'path') return movePathFile(current.path, fromPath, toPath)
  if (fromPath === toPath) return true
  const source = await getFile(current.handle, fromPath, false)
  if (!source) return false
  const parts = normalizeLayoutPath(toPath).split('/')
  const name = parts.pop()
  if (!name) return false
  const parent = await ensureDirectoryHandle(current.handle, parts.join('/'))
  const movable = source as FileSystemFileHandle & {
    move?: (dir: FileSystemDirectoryHandle, name: string) => Promise<void>
  }
  if (movable.move) {
    try {
      await movable.move(parent, name)
      return true
    } catch (error) {
      console.warn('[project] 直接移动失败，改为复制', fromPath, error)
    }
  }
  const bytes = await (await source.getFile()).arrayBuffer()
  await writeBytes(current, toPath, bytes)
  await removeFile(current, fromPath)
  return true
}

async function movePathFile(absRoot: string, fromPath: string, toPath: string): Promise<boolean> {
  const desktop = electronBridge()
  if (!desktop) return false
  const from = joinProjectPath(absRoot, fromPath)
  const to = joinProjectPath(absRoot, toPath)
  if (!(await desktop.fs.exists(from))) return false
  try {
    await desktop.fs.movePath(from, to)
    return true
  } catch (error) {
    console.warn('[project] 直接移动失败，改为复制', fromPath, error)
  }
  const raw = await desktop.fs.readBinaryFile(from)
  if (!raw) return false
  const bytes = toArrayBuffer(raw)
  await desktop.fs.writeBinaryFile(to, bytes)
  await desktop.fs.unlinkFile(from)
  return true
}

async function ensureDirectoryOn(current: ProjectRoot, path: string): Promise<void> {
  if (current.kind === 'path') {
    const desktop = electronBridge()
    if (!desktop) throw new Error('没有桌面文件接口')
    await desktop.fs.mkdir(joinProjectPath(current.path, path))
    return
  }
  await ensureDirectoryHandle(current.handle, path)
}

async function ensureDirectoryHandle(handle: FileSystemDirectoryHandle, path: string): Promise<FileSystemDirectoryHandle> {
  const parts = normalizeLayoutPath(path).split('/').filter(Boolean)
  let current = handle
  for (const part of parts) current = await current.getDirectoryHandle(part, { create: true })
  return current
}

async function getDirectory(
  handle: FileSystemDirectoryHandle,
  path: string,
  create: boolean,
): Promise<FileSystemDirectoryHandle | null> {
  try {
    const parts = normalizeLayoutPath(path).split('/').filter(Boolean)
    let current = handle
    for (const part of parts) current = await current.getDirectoryHandle(part, { create })
    return current
  } catch (error) {
    if (!create && error instanceof DOMException && error.name === 'NotFoundError') return null
    throw error
  }
}

async function getFile(
  handle: FileSystemDirectoryHandle,
  path: string,
  create: boolean,
): Promise<FileSystemFileHandle | null> {
  const parts = normalizeLayoutPath(path).split('/').filter(Boolean)
  const name = parts.pop()
  if (!name) return null
  const parent = await getDirectory(handle, parts.join('/'), create)
  if (!parent) return null
  try {
    return await parent.getFileHandle(name, { create })
  } catch (error) {
    if (!create && error instanceof DOMException && error.name === 'NotFoundError') return null
    throw error
  }
}

async function readBytes(current: ProjectRoot, path: string): Promise<ArrayBuffer | null> {
  if (current.kind === 'path') {
    const desktop = electronBridge()
    if (!desktop) return null
    const full = joinProjectPath(current.path, path)
    try {
      const data = await desktop.fs.readBinaryFile(full)
      return data ? toArrayBuffer(data) : null
    } catch {
      return null
    }
  }
  const file = await getFile(current.handle, path, false)
  if (!file) return null
  return (await file.getFile()).arrayBuffer()
}

async function readText(current: ProjectRoot, path: string): Promise<string | null> {
  if (current.kind === 'path') {
    const desktop = electronBridge()
    if (!desktop) return null
    const full = joinProjectPath(current.path, path)
    if (!(await desktop.fs.exists(full))) return null
    return desktop.fs.readTextFile(full)
  }
  const file = await getFile(current.handle, path, false)
  if (!file) return null
  return (await file.getFile()).text()
}

async function writeBytes(current: ProjectRoot, path: string, bytes: ArrayBuffer): Promise<void> {
  assertLayoutPath(path)
  if (current.kind === 'path') {
    const desktop = electronBridge()
    if (!desktop) throw new Error('没有桌面文件接口')
    await desktop.fs.writeBinaryFile(joinProjectPath(current.path, path), bytes)
    return
  }
  const file = await getFile(current.handle, path, true)
  if (!file) throw new Error(`无法写入 ${path}`)
  const writable = await file.createWritable()
  try {
    await writable.write(bytes)
  } finally {
    await writable.close()
  }
}

async function writeText(current: ProjectRoot, path: string, text: string): Promise<void> {
  assertLayoutPath(path)
  if (current.kind === 'path') {
    const desktop = electronBridge()
    if (!desktop) throw new Error('没有桌面文件接口')
    await desktop.fs.writeTextFile(joinProjectPath(current.path, path), text)
    return
  }
  const file = await getFile(current.handle, path, true)
  if (!file) throw new Error(`无法写入 ${path}`)
  const writable = await file.createWritable()
  try {
    await writable.write(text)
  } finally {
    await writable.close()
  }
}

async function removeFile(current: ProjectRoot, path: string): Promise<void> {
  if (current.kind === 'path') {
    const desktop = electronBridge()
    if (!desktop) return
    const full = joinProjectPath(current.path, path)
    if (await desktop.fs.exists(full)) await desktop.fs.unlinkFile(full)
    return
  }
  const parts = normalizeLayoutPath(path).split('/').filter(Boolean)
  const name = parts.pop()
  if (!name) return
  const parent = await getDirectory(current.handle, parts.join('/'), false)
  if (!parent) return
  await parent.removeEntry(name).catch(error => {
    if (error instanceof DOMException && error.name === 'NotFoundError') return
    throw error
  })
}

function asRecord(value: unknown): DirectoryAssetRecord | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Partial<DirectoryAssetRecord>
  if (typeof row.id !== 'string' || typeof row.name !== 'string' || typeof row.fileName !== 'string') return null
  if (typeof row.hash !== 'string' || !isFileKind(row.kind)) return null
  const relativePath = typeof row.relativePath === 'string' ? normalizeLayoutPath(row.relativePath) : ''
  if (!relativePath.startsWith(`${ASSETS_ROOT}/`)) return null
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    fileName: row.fileName,
    hash: row.hash,
    thumb: typeof row.thumb === 'string' ? row.thumb : null,
    byteLength: typeof row.byteLength === 'number' ? row.byteLength : 0,
    artifactReady: row.artifactReady === true,
    relativePath,
    ...(row.humanoidAvatar !== undefined ? { humanoidAvatar: row.humanoidAvatar } : {}),
    ...(row.humanoidRetarget !== undefined ? { humanoidRetarget: row.humanoidRetarget } : {}),
    ...(row.clipCatalog !== undefined ? { clipCatalog: row.clipCatalog } : {}),
    ...(typeof row.importScale === 'number' ? { importScale: row.importScale } : {}),
    ...(row.sockets !== undefined ? { sockets: row.sockets } : {}),
  }
}

function isFileKind(value: unknown): value is AssetMeta['kind'] {
  return value === 'model' || value === 'texture' || value === 'animation' || value === 'audio' || value === 'environment' || value === 'document'
}

async function rememberHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openProjectDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, 'readwrite')
    tx.objectStore(HANDLE_STORE).put(handle, HANDLE_KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function loadHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openProjectDb()
  return new Promise((resolve, reject) => {
    const query = db.transaction(HANDLE_STORE, 'readonly').objectStore(HANDLE_STORE).get(HANDLE_KEY)
    query.onsuccess = () => resolve((query.result as FileSystemDirectoryHandle | undefined) ?? null)
    query.onerror = () => reject(query.error)
  })
}
