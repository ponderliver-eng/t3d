import type { MaterialAsset, PrefabAsset, SceneAsset } from './library'
import { useAssetStore, type FileAsset } from './library'
import {
  migrateLegacyFilesToMeta,
  readAssetMetas,
  readFileBytes,
  readSceneDocument,
  writeSceneDocument,
  type AssetMeta,
} from './cache'
import { warmCachedAsset } from './import'
import { useEditorStore } from '../scene/store'
import type { ProjectDocument } from '../scene/document'
import { DEFAULT_PICTURE, type SceneNode } from '../scene/types'

const MAP_KEYS = ['mapAssetId', 'normalAssetId', 'roughnessAssetId', 'metalnessAssetId', 'emissiveAssetId', 'aoAssetId'] as const

let opening: Promise<void> | null = null
let saveTimer = 0
let autosaveBound = false

export function openCachedProject(): Promise<void> {
  opening ??= openNow().catch(error => {
    opening = null
    console.warn('[cache] 打开项目失败', error)
    useEditorStore.getState().log('warn', '本地项目缓存没能打开，使用空白场景')
  })
  return opening
}

export function bindProjectAutosave() {
  if (autosaveBound) return
  autosaveBound = true
  useEditorStore.subscribe(scheduleSave)
  useAssetStore.subscribe(scheduleSave)
  window.addEventListener('beforeunload', () => { void saveProjectNow() })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void saveProjectNow()
  })
}

export async function saveProjectNow() {
  const editor = useEditorStore.getState()
  if (editor.playState !== 'stopped' || editor.gesture) return
  editor.flushActiveScene()
  const library = Object.values(useAssetStore.getState().assets).filter(
    (asset): asset is MaterialAsset | PrefabAsset | SceneAsset => asset.kind === 'material' || asset.kind === 'prefab' || asset.kind === 'scene',
  )
  const document: ProjectDocument = {
    schemaVersion: 2,
    savedAt: Date.now(),
    activeSceneId: editor.activeSceneId,
    nodes: editor.nodes,
    selection: editor.selection,
    picture: editor.picture,
    library,
  }
  await writeSceneDocument(document)
}

function scheduleSave() {
  const editor = useEditorStore.getState()
  if (editor.playState !== 'stopped' || editor.gesture) return
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => { void saveProjectNow() }, 300)
}

async function openNow() {
  const started = performance.now()
  await migrateLegacyFilesToMeta()
  const [metas, stored] = await Promise.all([readAssetMetas(), readSceneDocument<ProjectDocument>()])
  const document = validDocument(stored)
  if (document) {
    for (const record of document.library) {
      if (!useAssetStore.getState().assets[record.id]) useAssetStore.getState().add(record)
    }
    useEditorStore.getState().loadDocument(document)
  }
  useEditorStore.getState().ensureSceneAsset()
  const sceneMs = performance.now() - started
  if (metas.length === 0) {
    useEditorStore.getState().log('info', `项目已打开，场景 ${Math.round(sceneMs)}ms`)
    return
  }
  void warmAssets(metas, document, started, sceneMs)
}

async function warmAssets(metas: AssetMeta[], document: ProjectDocument | null, started: number, sceneMs: number) {
  const referenced = referencedAssetIds(document)
  const ordered = [...metas].sort((a, b) => rank(a, referenced) - rank(b, referenced))
  let hits = 0
  let parsed = 0
  let failed = 0
  await runPool(ordered, 3, async meta => {
    try {
      const asset = await materialize(meta)
      const ok = await warmCachedAsset(asset)
      if (!ok) failed += 1
      else if ((meta.kind === 'model' || meta.kind === 'animation') && meta.artifactReady) hits += 1
      else parsed += 1
    } catch (error) {
      failed += 1
      console.warn('[cache] 资源恢复失败', meta.name, error)
    }
  })
  const total = Math.round(performance.now() - started)
  useEditorStore.getState().log(
    'info',
    `项目已打开 ${total}ms，场景 ${Math.round(sceneMs)}ms，成品命中 ${hits}，源文件解析 ${parsed}，失败 ${failed}`,
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
    if (record.kind === 'prefab') collectNodeAssets(Object.fromEntries(record.nodes.map(node => [node.id, node])), ids)
    if (record.kind === 'scene') {
      collectNodeAssets(record.nodes, ids)
      if (record.picture.envAssetId) ids.add(record.picture.envAssetId)
    }
  }
  return ids
}

function collectNodeAssets(nodes: Record<string, SceneNode>, ids: Set<string>) {
  for (const node of Object.values(nodes)) {
    if (node.assetId) ids.add(node.assetId)
    if (node.clipAssetId) ids.add(node.clipAssetId)
    for (const key of MAP_KEYS) {
      const value = node[key]
      if (value) ids.add(value)
    }
    for (const slot of node.slots) {
      for (const key of MAP_KEYS) {
        const value = slot[key]
        if (value) ids.add(value)
      }
    }
  }
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
