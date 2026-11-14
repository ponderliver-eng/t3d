import type { MaterialAsset, PrefabAsset, SceneAsset } from './library'
import { assetDirectory, assetName, useAssetStore, type FileAsset } from './library'
import {
  artifactKey,
  migrateLegacyFilesToMeta,
  readAssetMetas,
  readFileBytes,
  readIdbArtifact,
  readIdbFiles,
  readSceneDocument,
  sha256,
  writeSceneDocument,
  type AssetMeta,
  type CachedFile,
} from './cache'
import { fileKindFor, warmCachedAsset } from './import'
import { useEditorStore } from '../scene/store'
import { translate } from '../i18n'
import { usePrefsStore } from '../prefs/store'
import { readPrefab } from './prefab'
import type { ProjectDocument } from '../scene/document'
import { normalizeCapabilities } from '../../capabilities/registry'
import { ALL_LAYERS_VISIBLE_MASK, ensureLayers, ensureTags } from '../project/taxonomy'
import { DEFAULT_PICTURE, type SceneNode } from '../scene/types'
import { releaseModel } from './models'
import { releaseTexture } from './textures'
import { ASSETS_ROOT, normalizeDir } from './folders'
import {
  adoptAsset,
  assetRecord,
  assetRecords,
  begin,
  beginPath,
  bindDirectoryFlush,
  DEFAULT_ASSET_FOLDERS,
  ensureDirectory,
  isDirectoryProject,
  listAssetDirectories,
  listAssetFiles,
  moveAssetFile,
  parentProjectPath,
  pickDirectory,
  readArtifact,
  readProjectPath,
  readProjectText,
  recordsFromUnknown,
  removeEmptyDirectory,
  ensureDirectoryPermission,
  retargetAsset,
  scaffold,
  setDirectoryFlushEnabled,
  snapshotSources,
  useProjectDirectory,
  writeArtifact,
  writeSourceAsset,
  type DirectoryAssetRecord,
} from '../project/disk'
import { RecentProjectService, type RecentProject } from '../project/recents'
import { directoryBaseName, electronBridge, joinProjectPath } from '../project/electronBridge'

const MAP_KEYS = ['mapAssetId', 'normalAssetId', 'metallicRoughnessAssetId', 'roughnessAssetId', 'metalnessAssetId', 'emissiveAssetId', 'aoAssetId'] as const

let opening: Promise<void> | null = null
let saveTimer = 0
let autosaveBound = false
let warmToken = 0
let layoutBound = false
let layoutSuspended = 0
let layoutPrevious = { folders: [] as string[], assetDirs: {} as Record<string, string> }
let layoutChain: Promise<void> = Promise.resolve()

export function openCachedProject(): Promise<void> {
  opening ??= openCachedNow().catch(error => {
    opening = null
    console.warn('[cache] 打开项目失败', error)
    useEditorStore.getState().log('warn', translate('log.cacheOpenFail'))
  })
  return opening
}

export function bindProjectAutosave() {
  if (autosaveBound) return
  autosaveBound = true
  bindDirectoryFlush(() => { void saveProjectNow() })
  bindDirectoryLayout()
  useEditorStore.subscribe(scheduleSave)
  useAssetStore.subscribe(scheduleSave)
  window.addEventListener('beforeunload', () => { void saveProjectNow() })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void saveProjectNow()
  })
}

export function notifyProjectSaved() {
  const name = useProjectDirectory.getState().name
  useEditorStore.getState().notify(name ? translate('menu.savedDirectory', { name }) : translate('menu.saved'))
}

export async function createDirectoryProject(): Promise<void> {
  if (useEditorStore.getState().playState !== 'stopped') return
  try {
    const picked = await pickDirectory()
    if (!picked) return
    const name = typeof picked === 'string' ? directoryBaseName(picked) : picked.name
    if (await readProjectText(picked)) {
      const opened = await openSource(picked, false)
      if (opened) useEditorStore.getState().log('info', translate('log.projectExists', { name }))
      return
    }
    suspendLayout()
    setDirectoryFlushEnabled(false)
    try {
      const sources = await collectSources()
      const artifacts = await collectArtifacts(sources)
      await scaffold(picked)
      if (typeof picked === 'string') {
        await beginPath(picked, name, [], null)
        RecentProjectService.addPath(picked, name)
      } else {
        await begin(picked, name, [], null)
        await RecentProjectService.add(picked, name)
      }
      useAssetStore.setState({ folders: withDefaultFolders(useAssetStore.getState().folders) })
      await runPool(sources, 4, async file => {
        const meta = metaForSource(file, artifacts.has(file.hash))
        const directory = assetDirectory(file.id, useAssetStore.getState().assetDirs)
        await writeSourceAsset(meta, file.bytes, directory)
      })
      for (const [hash, glb] of artifacts) await writeArtifact(artifactKey(hash), glb)
      await reconcileLooseAssets()
    } finally {
      setDirectoryFlushEnabled(true)
      await resumeLayout()
    }
    await saveProjectNow()
    const message = translate('log.projectCreated', { name })
    useEditorStore.getState().log('info', message)
    useEditorStore.getState().notify(message)
  } catch (error) {
    await salvageProject(error)
  }
}

export async function openDirectoryProject(): Promise<void> {
  if (useEditorStore.getState().playState !== 'stopped') return
  try {
    const picked = await pickDirectory()
    if (!picked) return
    await openSource(picked, true)
  } catch (error) {
    await salvageProject(error)
  }
}

export async function saveProjectNow() {
  const editor = useEditorStore.getState()
  if (editor.playState !== 'stopped' || editor.gesture) return
  editor.flushActiveScene()
  const library = Object.values(useAssetStore.getState().assets).filter(
    (asset): asset is MaterialAsset | PrefabAsset | SceneAsset => asset.kind === 'material' || asset.kind === 'prefab' || asset.kind === 'scene',
  )
  const catalog = useAssetStore.getState()
  const document: ProjectDocument = {
    schemaVersion: 2,
    savedAt: Date.now(),
    activeSceneId: editor.activeSceneId,
    nodes: editor.nodes,
    selection: editor.selection,
    picture: editor.picture,
    library,
    folders: catalog.folders,
    assetDirs: catalog.assetDirs,
    capabilities: editor.capabilities,
    tags: editor.tags,
    layers: editor.layers,
    editorCullingMask: editor.editorCullingMask,
    physicsCollisionMatrixEnabled: editor.physicsCollisionMatrixEnabled,
    physicsCollisionRowMasks: editor.physicsCollisionRowMasks,
  }
  await writeSceneDocument(document)
}

function scheduleSave() {
  if (!usePrefsStore.getState().autoSave) return
  const editor = useEditorStore.getState()
  if (editor.playState !== 'stopped' || editor.gesture) return
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => { void saveProjectNow() }, 300)
}

async function openCachedNow() {
  try {
    await RecentProjectService.seedFromLegacy()
  } catch (error) {
    console.warn('[project] 最近工程列表不可用', error)
  }
  if (usePrefsStore.getState().openLastProject) {
    const opened = await restoreLastProject()
    if (opened) return
  }
  await openNow()
}

async function restoreLastProject(): Promise<boolean> {
  const [last] = RecentProjectService.getAll()
  if (!last) return false
  if (last.path && electronBridge()) return restorePath(last)
  const handle = await RecentProjectService.handleOf(last.id)
  if (!handle) {
    RecentProjectService.remove(last.id)
    return false
  }
  const allowed = await ensureDirectoryPermission(handle)
  if (!allowed) {
    useEditorStore.getState().log('info', translate('log.projectPermission'))
    return false
  }
  try {
    const opened = await openSource(handle, false)
    if (!opened) {
      if (!(await readProjectText(handle))) RecentProjectService.remove(last.id)
      return false
    }
    return true
  } catch (error) {
    console.warn('[project] 恢复工程目录失败', error)
    if (isDirectoryProject()) await saveProjectNow().catch(saveError => console.warn('[project] 补存失败', saveError))
    useEditorStore.getState().log('warn', failureText(error))
    return isDirectoryProject()
  }
}

async function restorePath(last: RecentProject): Promise<boolean> {
  if (!last.path) return false
  const bridge = electronBridge()
  if (!bridge) return false
  const exists = await bridge.fs.exists(joinProjectPath(last.path, 'project.t3d'))
    || await bridge.fs.exists(joinProjectPath(last.path, 'project.t3d.tmp'))
  if (!exists) {
    RecentProjectService.remove(last.id)
    useEditorStore.getState().log('warn', translate('log.projectMissing'))
    return false
  }
  try {
    return await openSource(last.path, false)
  } catch (error) {
    console.warn('[project] 恢复工程目录失败', error)
    if (isDirectoryProject()) await saveProjectNow().catch(saveError => console.warn('[project] 补存失败', saveError))
    useEditorStore.getState().log('warn', failureText(error))
    return isDirectoryProject()
  }
}

export async function openRecentProject(id: string): Promise<void> {
  if (useEditorStore.getState().playState !== 'stopped') return
  const known = RecentProjectService.getAll().find(item => item.id === id)
  if (!known) {
    RecentProjectService.remove(id)
    useEditorStore.getState().log('warn', translate('log.projectMissing'))
    return
  }
  if (known.path) {
    if (!electronBridge()) {
      useEditorStore.getState().log('info', translate('log.projectPermission'))
      return
    }
    try {
      const opened = await openSource(known.path, true)
      if (!opened) RecentProjectService.remove(id)
    } catch (error) {
      await salvageProject(error)
    }
    return
  }
  const handle = await RecentProjectService.handleOf(id)
  if (!handle) {
    RecentProjectService.remove(id)
    useEditorStore.getState().log('warn', translate('log.projectMissing'))
    return
  }
  try {
    const allowed = await ensureDirectoryPermission(handle)
    if (!allowed) {
      useEditorStore.getState().log('info', translate('log.projectPermission'))
      return
    }
    const opened = await openSource(handle, true)
    if (!opened && !(await readProjectText(handle))) RecentProjectService.remove(id)
  } catch (error) {
    await salvageProject(error)
  }
}

async function openSource(source: FileSystemDirectoryHandle | string, announce: boolean): Promise<boolean> {
  const parsed = await readDirectoryFile(source)
  if (parsed === 'missing') {
    useEditorStore.getState().log('warn', translate('log.projectMissing'))
    return false
  }
  if (parsed === 'invalid') {
    useEditorStore.getState().log('error', translate('log.projectInvalid'))
    return false
  }
  const started = performance.now()
  const token = nextWarmToken()
  suspendLayout()
  setDirectoryFlushEnabled(false)
  let metas: AssetMeta[] = parsed.assets
  let document = parsed.document
  try {
    if (typeof source === 'string') {
      await beginPath(source, parsed.name, parsed.assets, parsed.document)
      RecentProjectService.addPath(source, parsed.name)
    } else {
      await begin(source, parsed.name, parsed.assets, parsed.document)
      await RecentProjectService.add(source, parsed.name)
    }
    const folders = mergeFolders(parsed.document.folders ?? [], await listAssetDirectories())
    document = { ...parsed.document, folders }
    replaceSession(document)
    const adopted = await reconcileLooseAssets()
    metas = [...parsed.assets, ...adopted]
    useEditorStore.getState().ensureSceneAsset()
  } finally {
    setDirectoryFlushEnabled(true)
    await resumeLayout()
  }
  await saveProjectNow()
  const sceneMs = performance.now() - started
  if (announce) useEditorStore.getState().log('info', translate('log.projectOpened', { name: parsed.name }))
  if (metas.length === 0) {
    useEditorStore.getState().log('info', translate('log.opened', { ms: Math.round(sceneMs) }))
    return true
  }
  void warmAssets(token, metas, document, started, sceneMs)
  return true
}

async function openNow() {
  const started = performance.now()
  const token = nextWarmToken()
  await migrateLegacyFilesToMeta()
  const [metas, stored] = await Promise.all([readAssetMetas(), readSceneDocument<ProjectDocument>()])
  const document = validDocument(stored)
  if (document) {
    useAssetStore.getState().loadCatalog(document.folders ?? [], document.assetDirs ?? {})
    for (const record of document.library) {
      if (!useAssetStore.getState().assets[record.id]) useAssetStore.getState().add(record)
    }
    useEditorStore.getState().loadDocument(document)
  }
  useEditorStore.getState().ensureSceneAsset()
  const sceneMs = performance.now() - started
  if (metas.length === 0) {
    useEditorStore.getState().log('info', translate('log.opened', { ms: Math.round(sceneMs) }))
    return
  }
  void warmAssets(token, metas, document, started, sceneMs)
}

async function warmAssets(token: number, metas: AssetMeta[], document: ProjectDocument | null, started: number, sceneMs: number) {
  const referenced = referencedAssetIds(document)
  const ordered = [...metas].sort((a, b) => rank(a, referenced) - rank(b, referenced))
  let hits = 0
  let parsed = 0
  let failed = 0
  await runPool(ordered, 3, async meta => {
    if (!warmCurrent(token)) return
    try {
      const asset = await materialize(meta)
      if (!warmCurrent(token)) return
      const ok = await warmCachedAsset(asset)
      if (!warmCurrent(token)) {
        releaseRuntimeAsset(asset.id, asset.url)
        useAssetStore.getState().remove(asset.id)
        return
      }
      if (!ok) failed += 1
      else if ((meta.kind === 'model' || meta.kind === 'animation') && meta.artifactReady) hits += 1
      else parsed += 1
    } catch (error) {
      failed += 1
      console.warn('[cache] 资源恢复失败', meta.name, error)
    }
  })
  if (!warmCurrent(token)) return
  const total = Math.round(performance.now() - started)
  useEditorStore.getState().log(
    'info',
    translate('log.openedDetail', { total, scene: Math.round(sceneMs), hits, parsed, failed }),
  )
}

async function materialize(meta: AssetMeta): Promise<FileAsset> {
  const asset: FileAsset = {
    id: meta.id,
    name: meta.name,
    kind: meta.kind,
    fileName: meta.fileName,
    hash: meta.hash,
    thumb: meta.thumb,
    url: '',
    ...(meta.humanoidAvatar ? { humanoidAvatar: meta.humanoidAvatar } : {}),
    ...(meta.humanoidRetarget ? { humanoidRetarget: meta.humanoidRetarget } : {}),
    ...(meta.clipCatalog?.length ? { clipCatalog: meta.clipCatalog } : {}),
    ...(typeof meta.importScale === 'number' ? { importScale: meta.importScale } : {}),
    ...(meta.sockets?.length ? { sockets: meta.sockets } : {}),
  }
  if ((meta.kind === 'model' || meta.kind === 'animation') && meta.artifactReady) return asset
  const bytes = await readFileBytes(meta.id)
  if (!bytes) throw new Error('缓存里没有源文件')
  asset.url = URL.createObjectURL(new Blob([bytes]))
  return asset
}

function rank(meta: AssetMeta, referenced: Set<string>): number {
  const used = referenced.has(meta.id) ? 0 : 2
  const ready = meta.artifactReady ? 0 : 1
  return used + ready
}

function referencedAssetIds(document: ProjectDocument | null): Set<string> {
  const ids = new Set<string>()
  if (!document) return ids
  collectNodeAssets(document.nodes, ids)
  if (document.picture.envAssetId) ids.add(document.picture.envAssetId)
  for (const record of document.library) {
    if (record.kind === 'prefab') collectNodeAssets(readPrefab(record).nodes, ids)
    if (record.kind === 'scene') {
      collectNodeAssets(record.nodes, ids)
      if (record.picture.envAssetId) ids.add(record.picture.envAssetId)
    }
    if (record.kind === 'material') {
      for (const key of MAP_KEYS) {
        const value = record.slot[key]
        if (value) ids.add(value)
      }
    }
  }
  return ids
}

function collectNodeAssets(nodes: Record<string, SceneNode>, ids: Set<string>) {
  for (const node of Object.values(nodes)) {
    if (node.assetId) ids.add(node.assetId)
    if (node.clipAssetId) ids.add(node.clipAssetId)
    if (node.materialAssetId) ids.add(node.materialAssetId)
    for (const key of MAP_KEYS) {
      const value = node[key]
      if (value) ids.add(value)
    }
    for (const slot of node.slots) {
      if (slot.materialAssetId) ids.add(slot.materialAssetId)
      for (const key of MAP_KEYS) {
        const value = slot[key]
        if (value) ids.add(value)
      }
    }
  }
}

function bindDirectoryLayout() {
  if (layoutBound) return
  layoutBound = true
  const current = useAssetStore.getState()
  layoutPrevious = { folders: current.folders, assetDirs: current.assetDirs }
  useAssetStore.subscribe(state => {
    const prev = layoutPrevious
    layoutPrevious = { folders: state.folders, assetDirs: state.assetDirs }
    if (layoutSuspended > 0 || !isDirectoryProject()) return
    const folders = state.folders.filter(folder => !prev.folders.includes(folder))
    const removed = prev.folders.filter(folder => !state.folders.includes(folder)).sort((a, b) => b.length - a.length)
    const moves: Array<{ id: string, dir: string }> = []
    for (const asset of Object.values(state.assets)) {
      if (!('fileName' in asset)) continue
      const record = assetRecord(asset.id)
      if (!record) continue
      const dir = assetDirectory(asset.id, state.assetDirs)
      if (parentProjectPath(record.relativePath) !== dir) moves.push({ id: asset.id, dir })
    }
    if (folders.length === 0 && removed.length === 0 && moves.length === 0) return
    layoutChain = layoutChain.then(async () => {
      for (const folder of folders) await ensureDirectory(folder)
      for (const move of moves) await moveAssetFile(move.id, move.dir)
      for (const folder of removed) await removeEmptyDirectory(folder)
    }).catch(error => {
      console.warn('[project] 目录同步失败', error)
    })
  })
}

function suspendLayout() {
  layoutSuspended += 1
}

async function resumeLayout() {
  layoutSuspended = Math.max(0, layoutSuspended - 1)
  if (layoutSuspended > 0 || !isDirectoryProject()) return
  for (const folder of useAssetStore.getState().folders) await ensureDirectory(folder)
  const state = useAssetStore.getState()
  for (const asset of Object.values(state.assets)) {
    if (!('fileName' in asset)) continue
    const record = assetRecord(asset.id)
    if (!record) continue
    const dir = assetDirectory(asset.id, state.assetDirs)
    if (parentProjectPath(record.relativePath) === dir) continue
    await moveAssetFile(asset.id, dir)
  }
}

async function readDirectoryFile(source: FileSystemDirectoryHandle | string): Promise<{ name: string, document: ProjectDocument, assets: DirectoryAssetRecord[] } | 'missing' | 'invalid'> {
  const text = await readProjectText(source)
  if (!text) return 'missing'
  try {
    const parsed = JSON.parse(text) as { schemaVersion?: number, name?: string, document?: ProjectDocument, assets?: unknown }
    if (parsed.schemaVersion !== 1) return 'invalid'
    const document = validDocument(parsed.document ?? null)
    if (!document) return 'invalid'
    const fallback = typeof source === 'string' ? directoryBaseName(source) : source.name
    const name = typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : fallback
    return { name, document, assets: recordsFromUnknown(parsed.assets) }
  } catch {
    return 'invalid'
  }
}

function replaceSession(document: ProjectDocument) {
  for (const asset of Object.values(useAssetStore.getState().assets)) {
    releaseRuntimeAsset(asset.id, 'url' in asset ? asset.url : '')
  }
  const assets: Record<string, MaterialAsset | PrefabAsset | SceneAsset> = {}
  for (const record of document.library) assets[record.id] = record
  useAssetStore.getState().loadSession(assets, document.folders ?? [], document.assetDirs ?? {})
  useEditorStore.getState().loadDocument(document)
}

async function collectSources(): Promise<CachedFile[]> {
  const byId = new Map<string, CachedFile>()
  if (isDirectoryProject()) {
    for (const item of await snapshotSources()) {
      byId.set(item.meta.id, {
        id: item.meta.id,
        name: item.meta.name,
        kind: item.meta.kind,
        fileName: item.meta.fileName,
        hash: item.meta.hash,
        thumb: item.meta.thumb,
        bytes: item.bytes,
      })
    }
  } else {
    for (const file of await readIdbFiles()) byId.set(file.id, file)
  }
  for (const asset of Object.values(useAssetStore.getState().assets)) {
    if (!('fileName' in asset)) continue
    const previous = byId.get(asset.id)
    const bytes = await bytesOf(asset.url, previous?.bytes ?? null)
    if (!bytes) continue
    byId.set(asset.id, {
      id: asset.id,
      name: asset.name,
      kind: asset.kind,
      fileName: asset.fileName,
      hash: asset.hash || previous?.hash || await sha256(bytes),
      thumb: asset.thumb,
      bytes,
    })
  }
  for (const file of byId.values()) {
    if (useAssetStore.getState().assets[file.id]) continue
    useAssetStore.getState().add({
      id: file.id,
      name: file.name,
      kind: file.kind,
      url: URL.createObjectURL(new Blob([file.bytes])),
      fileName: file.fileName,
      hash: file.hash,
      thumb: file.thumb,
    })
    useAssetStore.getState().place(file.id, ASSETS_ROOT)
  }
  return [...byId.values()]
}

async function collectArtifacts(files: CachedFile[]): Promise<Map<string, ArrayBuffer>> {
  const artifacts = new Map<string, ArrayBuffer>()
  const fromDirectory = isDirectoryProject()
  for (const file of files) {
    if ((file.kind !== 'model' && file.kind !== 'animation') || !file.hash || artifacts.has(file.hash)) continue
    const glb = fromDirectory ? await readArtifact(artifactKey(file.hash)) : await readIdbArtifact(file.hash)
    if (glb) artifacts.set(file.hash, glb)
  }
  return artifacts
}

function metaForSource(file: CachedFile, artifactReady: boolean): AssetMeta {
  const asset = useAssetStore.getState().assets[file.id]
  const base: AssetMeta = {
    id: file.id,
    name: file.name,
    kind: file.kind,
    fileName: file.fileName,
    hash: file.hash,
    thumb: file.thumb,
    byteLength: file.bytes.byteLength,
    artifactReady,
  }
  if (!asset || !('fileName' in asset)) return base
  return {
    ...base,
    name: asset.name,
    kind: asset.kind,
    fileName: asset.fileName,
    hash: asset.hash || file.hash,
    thumb: asset.thumb,
    ...(asset.humanoidAvatar !== undefined ? { humanoidAvatar: asset.humanoidAvatar } : {}),
    ...(asset.humanoidRetarget !== undefined ? { humanoidRetarget: asset.humanoidRetarget } : {}),
    ...(asset.clipCatalog !== undefined ? { clipCatalog: asset.clipCatalog } : {}),
    ...(typeof asset.importScale === 'number' ? { importScale: asset.importScale } : {}),
    ...(asset.sockets !== undefined ? { sockets: asset.sockets } : {}),
  }
}

async function reconcileLooseAssets(): Promise<AssetMeta[]> {
  const paths = await listAssetFiles()
  const onDisk = new Set(paths)
  const adopted: AssetMeta[] = []
  const byHash = new Map(assetRecords().filter(record => record.hash).map(record => [record.hash, record]))
  for (const relativePath of paths) {
    if (assetRecords().some(record => record.relativePath === relativePath)) continue
    const fileName = relativePath.split('/').pop() ?? ''
    const kind = fileKindFor(fileName)
    if (!kind) continue
    const bytes = await readProjectPath(relativePath)
    if (!bytes) continue
    const hash = await sha256(bytes)
    const existing = byHash.get(hash)
    if (existing) {
      if (!onDisk.has(existing.relativePath)) {
        retargetAsset(existing.id, relativePath)
        useAssetStore.getState().place(existing.id, parentProjectPath(relativePath))
      }
      continue
    }
    const id = crypto.randomUUID()
    const record: DirectoryAssetRecord = {
      id,
      name: assetName(fileName),
      kind,
      fileName,
      hash,
      thumb: null,
      byteLength: bytes.byteLength,
      artifactReady: false,
      relativePath,
    }
    adoptAsset(record)
    useAssetStore.getState().place(id, parentProjectPath(relativePath))
    adopted.push(record)
    byHash.set(hash, record)
  }
  if (adopted.length > 0) useEditorStore.getState().log('info', translate('log.projectLoose', { count: adopted.length }))
  return adopted
}

async function bytesOf(url: string, fallback: ArrayBuffer | null): Promise<ArrayBuffer | null> {
  if (url) {
    try {
      const response = await fetch(url)
      if (response.ok) return await response.arrayBuffer()
    } catch {
      // 浏览器对象地址失效时使用已保存的字节。
    }
  }
  return fallback
}

function releaseRuntimeAsset(id: string, url: string) {
  if (url.startsWith('blob:')) URL.revokeObjectURL(url)
  releaseModel(id)
  releaseTexture(id)
}

function nextWarmToken(): number {
  warmToken += 1
  return warmToken
}

function warmCurrent(token: number): boolean {
  return token === warmToken
}

function withDefaultFolders(folders: string[]): string[] {
  return [...new Set([...folders, ...DEFAULT_ASSET_FOLDERS].map(folder => normalizeDir(folder)))].filter(folder => folder !== ASSETS_ROOT)
}

function mergeFolders(folders: string[], diskFolders: string[]): string[] {
  return [...new Set([...folders, ...diskFolders].map(folder => normalizeDir(folder)))].filter(folder => folder !== ASSETS_ROOT)
}

async function salvageProject(error: unknown) {
  console.warn('[project]', error)
  if (isDirectoryProject()) await saveProjectNow().catch(saveError => console.warn('[project] 补存失败', saveError))
  useEditorStore.getState().log('error', failureText(error))
}

function failureText(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'browser') return translate('log.projectBrowser')
  const message = error instanceof Error ? error.message : String(error)
  return translate('log.projectFailed', { message })
}

function cleanAssetDirs(value: ProjectDocument['assetDirs']): Record<string, string> {
  if (!value) return {}
  const dirs: Record<string, string> = {}
  for (const [id, dir] of Object.entries(value)) {
    if (typeof dir === 'string') dirs[id] = dir
  }
  return dirs
}

function validDocument(document: ProjectDocument | null): ProjectDocument | null {
  if (!document || (document.schemaVersion !== 1 && document.schemaVersion !== 2) || !document.nodes) return null
  const library = Array.isArray(document.library) ? document.library : []
  const scenes = library.filter((asset): asset is SceneAsset => asset.kind === 'scene')
  const activeSceneId = document.activeSceneId && scenes.some(scene => scene.id === document.activeSceneId)
    ? document.activeSceneId
    : scenes[0]?.id ?? ''
  return {
    schemaVersion: 2,
    savedAt: document.savedAt || Date.now(),
    activeSceneId,
    nodes: document.nodes,
    selection: Array.isArray(document.selection) ? document.selection : [],
    picture: { ...DEFAULT_PICTURE, ...document.picture },
    library,
    folders: Array.isArray(document.folders) ? document.folders.filter(item => typeof item === 'string') : [],
    assetDirs: cleanAssetDirs(document.assetDirs),
    capabilities: normalizeCapabilities(document.capabilities),
    tags: ensureTags(document.tags),
    layers: ensureLayers(document.layers),
    editorCullingMask: typeof document.editorCullingMask === 'number' ? document.editorCullingMask >>> 0 : ALL_LAYERS_VISIBLE_MASK,
    physicsCollisionMatrixEnabled: document.physicsCollisionMatrixEnabled === true,
    physicsCollisionRowMasks: document.physicsCollisionRowMasks ?? {},
  }
}

async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  if (items.length === 0) return
  let index = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index
      index += 1
      await worker(items[current])
    }
  })
  await Promise.all(runners)
}
