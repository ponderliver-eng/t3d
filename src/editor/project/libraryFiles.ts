import {
  assetDirectory,
  useAssetStore,
  type CutsceneAsset,
  type EffectAsset,
  type MaterialAsset,
  type PrefabAsset,
  type SceneAsset,
  type SceneSummary,
  type UiAsset,
} from '../assets/library'
import { ASSETS_ROOT, normalizeDir } from '../assets/folders'
import { forgetNavMesh, navRecord, rememberNavMesh, type StoredNavMesh } from '../../capabilities/navigation/archive'
import type { SceneNode, ScenePicture } from '../scene/types'
import {
  listAssetFiles,
  moveProjectFile,
  parentProjectPath,
  projectFileDiskPath,
  readProjectTextFile,
  readProjectTextHead,
  removeEmptyDirectory,
  removeProjectFile,
  safeFileName,
  writeProjectTextFile,
} from './disk'

/**
 * 库资源（场景、材质、预制体、特效、界面、过场）在目录工程里各占一个文件：
 *
 *   Assets/<资源面板里的目录>/<资源名>.t3dscene | .t3dmat | .t3dprefab | .t3dfx | .t3dui | .t3dcut
 *   Assets/<场景所在目录>/<场景名>.t3dnav        # 该场景烘焙好的导航网格
 *
 * 文件在哪个目录，资源就在资源面板的哪个目录；文件名（去掉扩展名）就是资源名。
 * 只有文件名装不下资源名（重名、含非法字符）时，才在文件里另存一个 name。
 *
 * 保存是增量的：按对象引用比较，只重写变过的资源；改名、换目录只移动文件。
 * 场景文件把摘要和画面设置写在前面、节点一行一个，没打开的场景只解析文件头，节点留在磁盘上。
 */

export type LibraryAsset = MaterialAsset | PrefabAsset | SceneAsset | EffectAsset | UiAsset | CutsceneAsset
type LibraryKind = LibraryAsset['kind']

const EXTENSIONS: Record<LibraryKind, string> = {
  scene: '.t3dscene',
  material: '.t3dmat',
  prefab: '.t3dprefab',
  effect: '.t3dfx',
  ui: '.t3dui',
  cutscene: '.t3dcut',
}
const NAV_EXTENSION = '.t3dnav'
const TMP_SUFFIX = '.tmp'
const SCENE_FORMAT = 't3d-scene'
const ASSET_FORMAT = 't3d-asset'
const NAV_FORMAT = 't3d-nav'
const FILE_VERSION = 1
const NODES_MARKER = '\n"nodes": {'
const MAP_KEYS = ['mapAssetId', 'normalAssetId', 'metallicRoughnessAssetId', 'roughnessAssetId', 'metalnessAssetId', 'emissiveAssetId', 'aoAssetId'] as const

interface Tracked {
  /** 上次落盘时的资源对象。引用没变就不用重写。null 表示磁盘内容需要重写。 */
  ref: LibraryAsset | null
  path: string
  /** 文件里另存了 name（文件名和资源名对不上）。 */
  named: boolean
}

interface TrackedNav {
  path: string
  /** 上次落盘时的记录。null 表示文件在磁盘上，但还没读进内存。 */
  ref: StoredNavMesh | null
}

const tracked = new Map<string, Tracked>()
const trackedNav = new Map<string, TrackedNav>()
let chain: Promise<void> = Promise.resolve()
let lastActiveSceneId = ''
let unloadPending = false

export function isLibraryAsset(asset: { kind: string }): asset is LibraryAsset {
  return asset.kind in EXTENSIONS
}

/** 换工程目录时调用：之前记下的文件位置全部作废，下一次保存会把内存里的库资源全量写出。 */
export function resetLibraryFiles() {
  tracked.clear()
  trackedNav.clear()
  lastActiveSceneId = ''
  unloadPending = false
}

/** 库资源文件的绝对路径。还没落盘或不在桌面端时返回 null。 */
export function libraryAssetDiskPath(id: string): string | null {
  const entry = tracked.get(id)
  return entry ? projectFileDiskPath(entry.path) : null
}

export interface LoadedLibrary {
  assets: LibraryAsset[]
  dirs: Record<string, string>
  activeSceneId: string
  navMeshes: Record<string, StoredNavMesh>
}

/**
 * 打开工程时扫一遍 Assets/，把库资源文件读进来。
 * 只有要打开的那个场景读全量，其余场景只读文件头。
 */
export function loadLibraryFiles(preferredSceneId: string): Promise<LoadedLibrary> {
  return enqueue(async () => {
    resetLibraryFiles()
    const paths = await listAssetFiles()
    const onDisk = new Set(paths)
    const files: Array<{ path: string, kind: LibraryKind }> = []
    for (const path of paths) {
      let logical = path
      if (path.endsWith(TMP_SUFFIX)) {
        logical = path.slice(0, -TMP_SUFFIX.length)
        if (!kindOfPath(logical) && !logical.endsWith(NAV_EXTENSION)) continue
        // 正式文件还在，说明临时文件是上次保存中断留下的。正式文件丢了才用临时文件顶上。
        if (onDisk.has(logical)) {
          await removeProjectFile(path).catch(() => undefined)
          continue
        }
      }
      const kind = kindOfPath(logical)
      if (kind) files.push({ path, kind })
    }

    const assets: LibraryAsset[] = []
    const dirs: Record<string, string> = {}
    const seen = new Set<string>()
    await runPool(files, 8, async file => {
      const fallbackName = stemOf(file.path)
      let read: { asset: LibraryAsset, named: boolean } | null = null
      if (file.kind === 'scene') {
        // 场景只取文件头；文件头认不出来（排版被改过）再读全文。
        const head = await readProjectTextHead(file.path, NODES_MARKER).catch(() => null)
        read = head ? readSceneStub(head, fallbackName) : null
        if (!read) {
          const text = await readProjectTextFile(file.path).catch(() => null)
          read = text ? readSceneFull(text, fallbackName) : null
        }
      } else {
        const text = await readProjectTextFile(file.path).catch(() => null)
        read = text ? readPlainAsset(text, file.kind, fallbackName) : null
      }
      if (!read) {
        console.warn('[project] 无法识别的资源文件', file.path)
        return
      }
      let asset = read.asset
      let ref: LibraryAsset | null = asset
      if (seen.has(asset.id)) {
        // 在资源管理器里复制出来的文件：换一个 id，下次保存重写。
        if (asset.kind === 'scene' && asset.unloaded) {
          const text = await readProjectTextFile(file.path).catch(() => null)
          const full = text ? readSceneFull(text, fallbackName) : null
          if (!full) return
          asset = full.asset
        }
        asset = { ...asset, id: crypto.randomUUID() }
        ref = null
      }
      seen.add(asset.id)
      assets.push(asset)
      dirs[asset.id] = parentProjectPath(file.path)
      tracked.set(asset.id, { ref, path: file.path, named: read.named })
      if (asset.kind === 'scene' && ref) {
        const navPath = navPathFor(file.path)
        if (onDisk.has(navPath)) trackedNav.set(asset.id, { path: navPath, ref: null })
      }
    })
    assets.sort((a, b) => a.name.localeCompare(b.name))

    const navMeshes: Record<string, StoredNavMesh> = {}
    const scenes = assets.filter((asset): asset is SceneAsset => asset.kind === 'scene')
    const active = scenes.find(scene => scene.id === preferredSceneId) ?? scenes.find(scene => !scene.unloaded) ?? scenes[0]
    if (active?.unloaded) {
      const loaded = await readSceneFromDisk(active)
      if (loaded) {
        assets[assets.indexOf(active)] = loaded.asset
        const entry = tracked.get(active.id)
        if (entry) entry.ref = loaded.asset
        if (loaded.nav) navMeshes[active.id] = loaded.nav
      }
    }
    lastActiveSceneId = active?.id ?? ''
    return { assets, dirs, activeSceneId: active?.id ?? '', navMeshes }
  })
}

/** 把壳场景的节点从磁盘读进内存。ids 为 null 表示全部。 */
export function loadSceneFiles(ids: string[] | null): Promise<void> {
  return enqueue(async () => {
    unloadPending = false
    const store = useAssetStore.getState()
    const targets = (ids ?? Object.keys(store.assets)).filter(id => {
      const asset = store.assets[id]
      return asset?.kind === 'scene' && asset.unloaded
    })
    for (const id of targets) {
      const stub = useAssetStore.getState().assets[id]
      if (!stub || stub.kind !== 'scene' || !stub.unloaded) continue
      const loaded = await readSceneFromDisk(stub)
      if (!loaded) continue
      const current = useAssetStore.getState().assets[id]
      if (!current || current.kind !== 'scene' || !current.unloaded) continue
      const asset: SceneAsset = { ...loaded.asset, name: current.name }
      if (loaded.nav) rememberNavMesh(id, loaded.nav)
      const entry = tracked.get(id)
      // 读盘期间被改了名：留着旧引用，让下一次保存照常把文件挪到新名字。
      if (entry && entry.ref === current) entry.ref = asset
      useAssetStore.getState().add(asset)
    }
  })
}

/**
 * 把内存里的库资源同步到磁盘：新资源写文件、变过的重写、改名/换目录移动、删掉的删文件。
 * 切换场景后的第一次保存，顺手把不再打开且已落盘的场景换回壳。
 */
export function syncLibraryFiles(activeSceneId: string): Promise<void> {
  return enqueue(async () => {
    const state = useAssetStore.getState()
    const library = Object.values(state.assets).filter(isLibraryAsset)
    const live = new Set(library.map(asset => asset.id))
    const keptFolders = new Set(state.folders.map(folder => normalizeDir(folder)))
    const vacated = new Set<string>()

    for (const [id, entry] of [...tracked]) {
      if (live.has(id)) continue
      await removeProjectFile(entry.path)
      vacated.add(parentProjectPath(entry.path))
      tracked.delete(id)
      const nav = trackedNav.get(id)
      if (nav) {
        await removeProjectFile(nav.path)
        trackedNav.delete(id)
      }
    }

    for (const listed of library) {
      let asset = listed
      const previous = tracked.get(asset.id)
      const dir = assetDirectory(asset.id, state.assetDirs)
      const path = allocate(dir, asset.name, EXTENSIONS[asset.kind], asset.id)
      const named = stemOf(path) !== asset.name
      if (previous && previous.ref === asset && previous.path === path && previous.named === named) {
        if (asset.kind === 'scene') await syncNav(asset.id, path, !asset.unloaded)
        continue
      }
      if (asset.kind === 'scene' && asset.unloaded) {
        // 壳场景的内容只在磁盘上，没有文件就没法写。
        if (!previous) continue
        if (named || previous.named) {
          // 文件里的 name 要改，得把整份内容读回来重写。
          const loaded = await readSceneFromDisk(asset)
          if (!loaded) continue
          const full: SceneAsset = { ...loaded.asset, name: asset.name }
          if (loaded.nav) rememberNavMesh(asset.id, loaded.nav)
          useAssetStore.getState().add(full)
          asset = full
        }
      }
      if (previous && previous.path !== path) {
        await moveProjectFile(previous.path, path)
        vacated.add(parentProjectPath(previous.path))
      }
      const unloaded = asset.kind === 'scene' && asset.unloaded === true
      if (!unloaded && (!previous || previous.named !== named || contentChanged(previous.ref, asset))) {
        await writeProjectTextFile(path, serializeAsset(asset, named))
      }
      tracked.set(asset.id, { ref: asset, path, named })
      if (asset.kind === 'scene') await syncNav(asset.id, path, !unloaded)
    }

    for (const dir of vacated) await pruneEmptyDirs(dir, keptFolders)

    if (lastActiveSceneId && activeSceneId && lastActiveSceneId !== activeSceneId) unloadPending = true
    if (activeSceneId) lastActiveSceneId = activeSceneId
    if (unloadPending && activeSceneId) {
      unloadPending = false
      unloadIdleScenes(activeSceneId)
    }
  })
}

/** 已落盘、没在编辑的场景换回壳，节点和导航网格从内存里放掉。 */
function unloadIdleScenes(activeSceneId: string) {
  const stubs: SceneAsset[] = []
  for (const asset of Object.values(useAssetStore.getState().assets)) {
    if (asset.kind !== 'scene' || asset.unloaded || asset.id === activeSceneId) continue
    const entry = tracked.get(asset.id)
    if (!entry || entry.ref !== asset) continue
    const nav = trackedNav.get(asset.id)
    if (navRecord(asset.id) !== (nav?.ref ?? null)) continue
    const stub: SceneAsset = {
      id: asset.id,
      name: asset.name,
      kind: 'scene',
      nodes: {},
      picture: asset.picture,
      editorView: asset.editorView ?? null,
      unloaded: true,
      summary: summarizeScene(asset.nodes, asset.picture),
    }
    entry.ref = stub
    if (nav) {
      nav.ref = null
      forgetNavMesh(asset.id)
    }
    stubs.push(stub)
  }
  if (stubs.length > 0) useAssetStore.getState().addMany(stubs)
}

async function syncNav(sceneId: string, scenePath: string, loaded: boolean) {
  const path = navPathFor(scenePath)
  const previous = trackedNav.get(sceneId)
  if (!loaded) {
    // 壳场景的导航网格没读进内存，只跟着场景文件走。
    if (previous && previous.path !== path) {
      await moveProjectFile(previous.path, path)
      previous.path = path
    }
    return
  }
  const record = navRecord(sceneId)
  if (!record) {
    if (previous) {
      await removeProjectFile(previous.path)
      trackedNav.delete(sceneId)
    }
    return
  }
  // 打开工程时记录会被重新整理成新对象，内容一样就认作同一份，不重写文件。
  if (previous?.ref && previous.ref !== record && sameNav(previous.ref, record)) previous.ref = record
  if (previous && previous.ref === record) {
    if (previous.path !== path) {
      await moveProjectFile(previous.path, path)
      previous.path = path
    }
    return
  }
  if (previous && previous.path !== path) await removeProjectFile(previous.path)
  const text = JSON.stringify({ format: NAV_FORMAT, version: FILE_VERSION, sceneId, ...record })
  await writeProjectTextFile(path, text)
  trackedNav.set(sceneId, { path, ref: record })
}

function sameNav(a: StoredNavMesh, b: StoredNavMesh): boolean {
  return a.mode === b.mode && a.signature === b.signature && a.triangles === b.triangles && a.bytes === b.bytes
}

async function readNavFromDisk(sceneId: string): Promise<StoredNavMesh | null> {
  const entry = trackedNav.get(sceneId)
  if (!entry) return null
  if (entry.ref) return entry.ref
  try {
    const text = await readProjectTextFile(entry.path)
    if (!text) return null
    const parsed = JSON.parse(text) as Partial<StoredNavMesh> & { format?: string }
    if (parsed.format !== NAV_FORMAT || typeof parsed.bytes !== 'string' || !parsed.bytes) return null
    if (parsed.mode !== 'solo' && parsed.mode !== 'tileCache') return null
    const record: StoredNavMesh = {
      bytes: parsed.bytes,
      mode: parsed.mode,
      signature: typeof parsed.signature === 'string' ? parsed.signature : '',
      triangles: typeof parsed.triangles === 'number' ? parsed.triangles : 0,
    }
    entry.ref = record
    return record
  } catch (error) {
    console.warn('[project] 导航网格文件读取失败', entry.path, error)
    return null
  }
}

async function readSceneFromDisk(stub: SceneAsset): Promise<{ asset: SceneAsset, nav: StoredNavMesh | null } | null> {
  const entry = tracked.get(stub.id)
  if (!entry) return null
  try {
    const text = await readProjectTextFile(entry.path)
    if (!text) throw new Error('文件不存在')
    const full = readSceneFull(text, stub.name)
    if (!full) throw new Error('内容无法识别')
    // 视口相机不在场景文件里（存在 project.t3d 的 workspace），沿用壳上记着的。
    const asset: SceneAsset = { ...full.asset, id: stub.id, name: stub.name, editorView: stub.editorView ?? full.asset.editorView ?? null }
    return { asset, nav: await readNavFromDisk(stub.id) }
  } catch (error) {
    console.warn('[project] 场景文件读取失败', entry.path, error)
    return null
  }
}

function serializeAsset(asset: LibraryAsset, named: boolean): string {
  if (asset.kind === 'scene') return serializeScene(asset, named)
  const { id, name, kind, ...data } = asset
  return `${JSON.stringify({
    format: ASSET_FORMAT,
    version: FILE_VERSION,
    kind,
    id,
    ...(named ? { name } : {}),
    ...data,
  }, null, 2)}\n`
}

/** 文件头在前、节点一行一个：只要名字和摘要时不用解析节点，版本管理里的差异也是按物体一行行出来。 */
function serializeScene(asset: SceneAsset, named: boolean): string {
  const head = [
    `"format": ${JSON.stringify(SCENE_FORMAT)}`,
    `"version": ${FILE_VERSION}`,
    `"id": ${JSON.stringify(asset.id)}`,
    ...(named ? [`"name": ${JSON.stringify(asset.name)}`] : []),
    `"summary": ${JSON.stringify(summarizeScene(asset.nodes, asset.picture))}`,
    `"picture": ${JSON.stringify(asset.picture ?? null)}`,
  ]
  const nodes = Object.entries(asset.nodes).map(([id, node]) => `${JSON.stringify(id)}: ${JSON.stringify(node)}`)
  return `{\n${head.join(',\n')},${NODES_MARKER}\n${nodes.join(',\n')}\n}\n}\n`
}

interface SceneFileHead {
  format?: string
  id?: string
  name?: string
  summary?: Partial<SceneSummary>
  picture?: ScenePicture | null
  editorView?: SceneAsset['editorView']
  nodes?: Record<string, SceneNode>
}

function readSceneStub(text: string, fallbackName: string): { asset: SceneAsset, named: boolean } | null {
  const cut = text.indexOf(NODES_MARKER)
  // 不是我们写出来的排版（比如被格式化过）：交给调用方读全文整份解析。
  if (cut < 0) return null
  try {
    const head = JSON.parse(`${text.slice(0, cut).replace(/,\s*$/, '')}\n}`) as SceneFileHead
    if (head.format !== SCENE_FORMAT || typeof head.id !== 'string' || !head.id) return null
    if (!head.summary || typeof head.summary !== 'object') return null
    const named = typeof head.name === 'string' && head.name.length > 0
    return {
      named,
      asset: {
        id: head.id,
        name: named ? head.name as string : fallbackName,
        kind: 'scene',
        nodes: {},
        picture: (head.picture ?? {}) as ScenePicture,
        editorView: head.editorView ?? null,
        unloaded: true,
        summary: cleanSummary(head.summary),
      },
    }
  } catch {
    return null
  }
}

function readSceneFull(text: string, fallbackName: string): { asset: SceneAsset, named: boolean } | null {
  try {
    const parsed = JSON.parse(text) as SceneFileHead
    if (parsed.format !== SCENE_FORMAT || typeof parsed.id !== 'string' || !parsed.id) return null
    const named = typeof parsed.name === 'string' && parsed.name.length > 0
    return {
      named,
      asset: {
        id: parsed.id,
        name: named ? parsed.name as string : fallbackName,
        kind: 'scene',
        nodes: parsed.nodes && typeof parsed.nodes === 'object' ? parsed.nodes : {},
        picture: (parsed.picture ?? {}) as ScenePicture,
        editorView: parsed.editorView ?? null,
      },
    }
  } catch {
    return null
  }
}

function readPlainAsset(text: string, kind: LibraryKind, fallbackName: string): { asset: LibraryAsset, named: boolean } | null {
  try {
    const { format, version: _version, name, ...data } = JSON.parse(text) as Record<string, unknown>
    if (format !== ASSET_FORMAT || data.kind !== kind || typeof data.id !== 'string' || !data.id) return null
    const named = typeof name === 'string' && name.length > 0
    return { named, asset: { ...data, name: named ? name : fallbackName } as unknown as LibraryAsset }
  } catch {
    return null
  }
}

function cleanSummary(value: Partial<SceneSummary>): SceneSummary {
  return {
    nodeCount: typeof value.nodeCount === 'number' ? value.nodeCount : 0,
    assets: Array.isArray(value.assets) ? value.assets.filter(item => typeof item === 'string') : [],
    shaders: value.shaders && typeof value.shaders === 'object' ? value.shaders : {},
    scripts: value.scripts && typeof value.scripts === 'object' ? value.scripts : {},
  }
}

export function summarizeScene(nodes: Record<string, SceneNode>, picture: ScenePicture | null | undefined): SceneSummary {
  const assets = new Set<string>()
  const shaders: Record<string, number> = {}
  const scripts: Record<string, number> = {}
  const add = (id: string | null | undefined) => { if (id) assets.add(id) }
  const addMaps = (source: Partial<Record<(typeof MAP_KEYS)[number], string | null>>) => {
    for (const key of MAP_KEYS) add(source[key])
  }
  add(picture?.envAssetId)
  let nodeCount = 0
  for (const node of Object.values(nodes)) {
    nodeCount += 1
    add(node.assetId)
    add(node.prefabAssetId)
    add(node.nestedPrefabId)
    add(node.clipAssetId)
    add(node.overlayAssetId)
    for (const state of node.animator?.states ?? []) add(state.clipAssetId)
    add(node.materialAssetId)
    add(node.effect?.assetId)
    add(node.effect?.materialAssetId)
    add(node.screen?.documentId)
    for (const override of Object.values(node.partOverrides ?? {})) add(override.materialAssetId)
    addMaps(node)
    const custom = new Set<string>()
    if (node.shader?.startsWith('custom:')) custom.add(node.shader)
    for (const slot of node.slots ?? []) {
      add(slot.materialAssetId)
      addMaps(slot)
      if (slot.shader?.startsWith('custom:')) custom.add(slot.shader)
    }
    for (const shader of custom) shaders[shader] = (shaders[shader] ?? 0) + 1
    const projectScripts = node.gameplay?.packs?.__project__ as Record<string, unknown> | undefined
    if (projectScripts) {
      for (const [scriptId, value] of Object.entries(projectScripts)) {
        if (value !== undefined) scripts[scriptId] = (scripts[scriptId] ?? 0) + 1
      }
    }
  }
  return { nodeCount, assets: [...assets], shaders, scripts }
}

/**
 * 除名字和视口相机外有没有字段换了对象。改名只移动文件，不重写内容；
 * 视口相机存在 project.t3d 的 workspace 里，转一下镜头不该重写整个场景文件。
 */
function contentChanged(previous: LibraryAsset | null, next: LibraryAsset): boolean {
  if (!previous) return true
  if (previous === next) return false
  const a = previous as unknown as Record<string, unknown>
  const b = next as unknown as Record<string, unknown>
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    if (key === 'name' || key === 'editorView') continue
    if (a[key] !== b[key]) return true
  }
  return false
}

function allocate(directory: string, name: string, extension: string, selfId: string): string {
  const used = new Set<string>()
  for (const [id, entry] of tracked) {
    if (id !== selfId) used.add(entry.path.toLowerCase())
  }
  const dir = normalizeDir(directory)
  const stem = safeFileName(name)
  const candidate = `${dir}/${stem}${extension}`
  if (!used.has(candidate.toLowerCase())) return candidate
  let index = 2
  while (used.has(`${dir}/${stem}-${index}${extension}`.toLowerCase())) index += 1
  return `${dir}/${stem}-${index}${extension}`
}

async function pruneEmptyDirs(start: string, kept: Set<string>) {
  let dir = normalizeDir(start)
  while (dir && dir !== ASSETS_ROOT && dir.startsWith(`${ASSETS_ROOT}/`) && !kept.has(dir)) {
    await removeEmptyDirectory(dir).catch(() => undefined)
    dir = parentProjectPath(dir)
  }
}

function kindOfPath(path: string): LibraryKind | null {
  const lower = path.toLowerCase()
  for (const [kind, extension] of Object.entries(EXTENSIONS) as Array<[LibraryKind, string]>) {
    if (lower.endsWith(extension)) return kind
  }
  return null
}

function stemOf(path: string): string {
  let fileName = path.split('/').pop() ?? ''
  if (fileName.endsWith(TMP_SUFFIX)) fileName = fileName.slice(0, -TMP_SUFFIX.length)
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(0, dot) : fileName
}

function navPathFor(scenePath: string): string {
  const base = scenePath.endsWith(TMP_SUFFIX) ? scenePath.slice(0, -TMP_SUFFIX.length) : scenePath
  const dot = base.lastIndexOf('.')
  return `${dot > 0 ? base.slice(0, dot) : base}${NAV_EXTENSION}`
}

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = chain.then(job, job)
  chain = run.then(() => undefined, () => undefined)
  return run
}

async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
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
