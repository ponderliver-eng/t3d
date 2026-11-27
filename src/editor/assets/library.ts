import { create } from 'zustand'
import type { ClipCatalogEntry } from '../animation/playback'
import type { ModelHumanoidAvatar } from '../animation/humanoidAvatar'
import type { HumanoidRetargetAdjust } from '../animation/humanoidAdjust'
import type { UiDocument } from '../../runtime/ui/spec'
import type { CutsceneSequence } from '../../capabilities/cutscene/schema'
import type { PbrSlot, SceneNode, ScenePicture, EditorView } from '../scene/types'
import { ASSETS_ROOT, directoryExists, isWithin, joinDir, normalizeDir, parentDir, relocateDir, uniqueFolderName } from './folders'

export type FileKind = 'model' | 'texture' | 'animation' | 'audio' | 'environment' | 'document'

export interface FileAsset {
  id: string
  name: string
  kind: FileKind
  url: string
  fileName: string
  hash: string
  thumb: string | null
  humanoidAvatar?: ModelHumanoidAvatar | null
  humanoidRetarget?: HumanoidRetargetAdjust | null
  clipCatalog?: ClipCatalogEntry[]
  /** 导入时乘在模型根上，不写进场景物体的缩放。 */
  importScale?: number
  sockets?: ModelSocket[]
  materialHint?: import('./models').ModelMaterialHint
}

export interface ModelSocket {
  id: string
  name: string
  bone: string
}

export interface MaterialAsset {
  id: string
  name: string
  kind: 'material'
  slot: PbrSlot
}

export interface EffectAsset {
  id: string
  name: string
  kind: 'effect'
  quarksVersion: string
  simulation: unknown
  materialAssetId: string | null
}

export interface UiAsset {
  id: string
  name: string
  kind: 'ui'
  document: UiDocument
}

export interface CutsceneAsset {
  id: string
  name: string
  kind: 'cutscene'
  sequence: CutsceneSequence
}

export interface PrefabAsset {
  id: string
  name: string
  kind: 'prefab'
  rootId: string
  nodes: Record<string, SceneNode>
}

export interface SceneAsset {
  id: string
  name: string
  kind: 'scene'
  nodes: Record<string, SceneNode>
  picture: ScenePicture
  /** 编辑器视口相机。缺省表示还没记过。 */
  editorView?: EditorView | null
  /**
   * 目录工程里没打开的场景只留一个壳：nodes 为空，内容还在磁盘的场景文件里。
   * 要读 nodes 之前先 `ensureScenesLoaded`，只要数量或引用就看 summary。
   */
  unloaded?: boolean
  summary?: SceneSummary
}

/** 场景文件头里的摘要，没加载的场景靠它回答「有多少物体、用了哪些资源」。 */
export interface SceneSummary {
  nodeCount: number
  /** 节点和画面设置引用到的资源 id。 */
  assets: string[]
  /** 自定义着色器（`custom:<id>`）→ 用到它的节点数。 */
  shaders: Record<string, number>
  /** 工程脚本 id → 挂了它的节点数。 */
  scripts: Record<string, number>
}

type SceneLoader = (ids: string[] | null) => Promise<void>
let sceneLoader: SceneLoader | null = null

export function bindSceneLoader(loader: SceneLoader | null) {
  sceneLoader = loader
}

/** 把还留在磁盘上的场景读进内存。不传 ids 表示全部。没有壳场景时立即返回。 */
export async function ensureScenesLoaded(ids?: string[]): Promise<void> {
  const assets = useAssetStore.getState().assets
  const pending = (ids ?? Object.keys(assets)).filter(id => {
    const asset = assets[id]
    return asset?.kind === 'scene' && asset.unloaded
  })
  if (pending.length === 0 || !sceneLoader) return
  await sceneLoader(ids ? pending : null)
}

export function sceneNodeCount(asset: SceneAsset): number {
  return asset.unloaded ? asset.summary?.nodeCount ?? 0 : Object.keys(asset.nodes).length
}

export type ProjectAsset = FileAsset | MaterialAsset | PrefabAsset | SceneAsset | EffectAsset | UiAsset | CutsceneAsset

interface AssetState {
  assets: Record<string, ProjectAsset>
  folders: string[]
  assetDirs: Record<string, string>
  browseDir: string
  /** 资源树里展开的目录。 */
  expanded: Record<string, boolean>
  revision: number
  add: (asset: ProjectAsset) => void
  addMany: (assets: ProjectAsset[]) => void
  remove: (id: string) => void
  removeMany: (ids: string[]) => void
  rename: (id: string, name: string) => void
  patch: (id: string, patch: Partial<FileAsset>) => void
  writeScene: (id: string, nodes: Record<string, SceneNode>, picture: ScenePicture, editorView?: EditorView | null) => void
  updateMaterial: (id: string, slot: Partial<PbrSlot>) => void
  replaceMaterial: (id: string, slot: PbrSlot) => void
  updateEffect: (id: string, patch: { simulation?: unknown, materialAssetId?: string | null }) => void
  updateUi: (id: string, document: UiDocument) => void
  bump: () => void
  loadCatalog: (folders: string[], assetDirs: Record<string, string>) => void
  loadSession: (
    assets: Record<string, ProjectAsset>,
    folders: string[],
    assetDirs: Record<string, string>,
    browseDir?: string,
    expanded?: Record<string, boolean>,
  ) => void
  setBrowseDir: (dir: string) => void
  setExpanded: (expanded: Record<string, boolean>) => void
  place: (id: string, dir?: string) => void
  placeMany: (entries: Record<string, string>, extraFolders?: string[]) => void
  relocateBatch: (dirMoves: Array<{ from: string; to: string }>, itemMoves: Record<string, string>, extraFolders?: string[]) => void
  writePrefab: (id: string, rootId: string, nodes: Record<string, SceneNode>) => void
  createFolder: (parent?: string) => string
  renameFolder: (path: string, name: string) => void
  deleteFolder: (path: string) => void
  deleteFolders: (paths: string[]) => void
}

export function assetDirectory(id: string, assetDirs: Record<string, string>): string {
  return normalizeDir(assetDirs[id] ?? ASSETS_ROOT)
}

export const useAssetStore = create<AssetState>((set, get) => ({
  assets: {},
  folders: [],
  assetDirs: {},
  browseDir: ASSETS_ROOT,
  expanded: { [ASSETS_ROOT]: true },
  revision: 0,
  add: asset => set(state => ({ assets: { ...state.assets, [asset.id]: asset }, revision: state.revision + 1 })),
  addMany: list => set(state => {
    if (list.length === 0) return {}
    const assets = { ...state.assets }
    for (const asset of list) assets[asset.id] = asset
    return { assets, revision: state.revision + 1 }
  }),
  remove: id => set(state => {
    const assets = { ...state.assets }
    const assetDirs = { ...state.assetDirs }
    delete assets[id]
    delete assetDirs[id]
    return { assets, assetDirs, revision: state.revision + 1 }
  }),
  removeMany: ids => set(state => {
    if (ids.length === 0) return {}
    const assets = { ...state.assets }
    const assetDirs = { ...state.assetDirs }
    let changed = false
    for (const id of ids) {
      if (id in assets || id in assetDirs) changed = true
      delete assets[id]
      delete assetDirs[id]
    }
    if (!changed) return {}
    return { assets, assetDirs, revision: state.revision + 1 }
  }),
  rename: (id, name) => set(state => {
    const asset = state.assets[id]
    if (!asset) return {}
    return { assets: { ...state.assets, [id]: { ...asset, name } }, revision: state.revision + 1 }
  }),
  patch: (id, patch) => set(state => {
    const asset = state.assets[id]
    if (!asset || !('url' in asset)) return {}
    return { assets: { ...state.assets, [id]: { ...asset, ...patch } }, revision: state.revision + 1 }
  }),
  writeScene: (id, nodes, picture, editorView) => set(state => {
    const asset = state.assets[id]
    if (!asset || asset.kind !== 'scene') return {}
    const view = editorView === undefined ? asset.editorView ?? null : editorView
    if (
      JSON.stringify(asset.nodes) === JSON.stringify(nodes)
      && JSON.stringify(asset.picture) === JSON.stringify(picture)
      && JSON.stringify(asset.editorView ?? null) === JSON.stringify(view)
    ) return {}
    const { unloaded: _unloaded, summary: _summary, ...rest } = asset
    return { assets: { ...state.assets, [id]: { ...rest, nodes, picture, editorView: view } }, revision: state.revision + 1 }
  }),
  updateMaterial: (id, slot) => set(state => {
    const asset = state.assets[id]
    if (!asset || asset.kind !== 'material') return {}
    return { assets: { ...state.assets, [id]: { ...asset, slot: { ...asset.slot, ...slot } } }, revision: state.revision + 1 }
  }),
  replaceMaterial: (id, slot) => set(state => {
    const asset = state.assets[id]
    if (!asset || asset.kind !== 'material') return {}
    if (JSON.stringify(asset.slot) === JSON.stringify(slot)) return {}
    return { assets: { ...state.assets, [id]: { ...asset, slot } }, revision: state.revision + 1 }
  }),
  updateEffect: (id, patch) => set(state => {
    const asset = state.assets[id]
    if (!asset || asset.kind !== 'effect') return {}
    return { assets: { ...state.assets, [id]: { ...asset, ...patch } }, revision: state.revision + 1 }
  }),
  updateUi: (id, document) => set(state => {
    const asset = state.assets[id]
    if (!asset || asset.kind !== 'ui') return {}
    return { assets: { ...state.assets, [id]: { ...asset, document } }, revision: state.revision + 1 }
  }),
  bump: () => set(state => ({ revision: state.revision + 1 })),
  loadCatalog: (folders, assetDirs) => set({
    folders: [...new Set(folders.map(normalizeDir).filter(path => path !== ASSETS_ROOT))],
    assetDirs: Object.fromEntries(Object.entries(assetDirs).map(([id, dir]) => [id, normalizeDir(dir)])),
  }),
  loadSession: (assets, folders, assetDirs, browseDir, expanded) => set(state => ({
    assets,
    folders: [...new Set(folders.map(normalizeDir).filter(path => path !== ASSETS_ROOT))],
    assetDirs: Object.fromEntries(Object.entries(assetDirs).map(([id, dir]) => [id, normalizeDir(dir)])),
    browseDir: normalizeDir(browseDir || ASSETS_ROOT),
    expanded: expanded ?? { [ASSETS_ROOT]: true },
    revision: state.revision + 1,
  })),
  setBrowseDir: dir => set({ browseDir: normalizeDir(dir) }),
  setExpanded: expanded => set({ expanded }),
  writePrefab: (id, rootId, nodes) => set(state => {
    const asset = state.assets[id]
    if (!asset || asset.kind !== 'prefab') return {}
    return {
      assets: { ...state.assets, [id]: { ...asset, rootId, nodes } },
      revision: state.revision + 1,
    }
  }),
  place: (id, dir) => set(state => ({
    assetDirs: { ...state.assetDirs, [id]: normalizeDir(dir ?? state.browseDir) },
    revision: state.revision + 1,
  })),
  placeMany: (entries, extraFolders) => set(state => {
    const keys = Object.keys(entries)
    if (keys.length === 0 && (!extraFolders || extraFolders.length === 0)) return {}
    const assetDirs = { ...state.assetDirs }
    for (const [id, dir] of Object.entries(entries)) {
      assetDirs[id] = normalizeDir(dir)
    }
    const folders = extraFolders && extraFolders.length > 0
      ? [...new Set([...state.folders.map(normalizeDir), ...extraFolders.map(normalizeDir)])].filter(f => f !== ASSETS_ROOT)
      : state.folders
    return { assetDirs, folders, revision: state.revision + 1 }
  }),
  relocateBatch: (dirMoves, itemMoves, extraFolders) => set(state => {
    const cleanDirMoves = dirMoves
      .map(m => ({ from: normalizeDir(m.from), to: normalizeDir(m.to) }))
      .filter(m => m.from !== ASSETS_ROOT && m.from !== m.to && !isWithin(m.to, m.from))
    const itemKeys = Object.keys(itemMoves)
    if (cleanDirMoves.length === 0 && itemKeys.length === 0 && (!extraFolders || extraFolders.length === 0)) return {}
    const mapPath = (p: string): string => {
      const norm = normalizeDir(p)
      for (const move of cleanDirMoves) {
        if (isWithin(norm, move.from)) return relocateDir(norm, move.from, move.to)
      }
      return norm
    }
    const expanded: Record<string, boolean> = {}
    for (const [dir, open] of Object.entries(state.expanded)) {
      expanded[mapPath(dir)] = open
    }
    const assetDirs: Record<string, string> = {}
    for (const [id, dir] of Object.entries(state.assetDirs)) {
      assetDirs[id] = mapPath(dir)
    }
    for (const [id, dir] of Object.entries(itemMoves)) {
      assetDirs[id] = normalizeDir(dir)
    }
    const folderSet = new Set<string>()
    for (const folder of state.folders) folderSet.add(mapPath(folder))
    for (const move of cleanDirMoves) folderSet.add(move.to)
    for (const folder of extraFolders ?? []) folderSet.add(normalizeDir(folder))
    folderSet.delete(ASSETS_ROOT)
    return {
      folders: [...folderSet],
      assetDirs,
      browseDir: mapPath(state.browseDir),
      expanded,
      revision: state.revision + 1,
    }
  }),
  createFolder: parent => {
    const state = get()
    const base = normalizeDir(parent ?? state.browseDir)
    const path = joinDir(base, uniqueFolderName(base, state.folders, state.assetDirs))
    set({ folders: [...state.folders, path], browseDir: path, revision: state.revision + 1 })
    return path
  },
  renameFolder: (path, name) => {
    const clean = name.trim().replace(/[\\/]/g, '')
    const source = normalizeDir(path)
    const parent = parentDir(source)
    if (!clean || !parent) return
    const next = joinDir(parent, clean)
    if (next === source) return
    const state = get()
    if (directoryExists(next, state.folders, state.assetDirs)) return
    const expanded: Record<string, boolean> = {}
    for (const [dir, open] of Object.entries(state.expanded)) expanded[relocateDir(dir, source, next)] = open
    set({
      folders: [...new Set(state.folders.map(folder => relocateDir(folder, source, next)).filter(folder => folder !== ASSETS_ROOT))],
      assetDirs: Object.fromEntries(Object.entries(state.assetDirs).map(([id, dir]) => [id, relocateDir(dir, source, next)])),
      browseDir: relocateDir(state.browseDir, source, next),
      expanded,
      revision: state.revision + 1,
    })
  },
  deleteFolder: path => {
    get().deleteFolders([path])
  },
  deleteFolders: paths => {
    const sources = [...new Set(paths.map(normalizeDir))].filter(source => Boolean(parentDir(source)))
    if (sources.length === 0) return
    const state = get()
    const occupiedDirs: string[] = []
    for (const id of Object.keys(state.assets)) {
      occupiedDirs.push(assetDirectory(id, state.assetDirs))
    }
    for (const [key, dir] of Object.entries(state.assetDirs)) {
      if (key.startsWith('code:')) occupiedDirs.push(normalizeDir(dir))
    }
    const removable = sources.filter(source => !occupiedDirs.some(dir => isWithin(dir, source)))
    if (removable.length === 0) return
    const isRemoved = (dir: string) => removable.some(source => isWithin(dir, source))
    const expanded = { ...state.expanded }
    for (const dir of Object.entries(expanded).map(([k]) => k)) {
      if (isRemoved(dir)) delete expanded[dir]
    }
    let nextBrowse = state.browseDir
    while (isRemoved(nextBrowse)) {
      nextBrowse = parentDir(nextBrowse) ?? ASSETS_ROOT
    }
    set({
      folders: state.folders.filter(folder => !isRemoved(normalizeDir(folder))),
      browseDir: nextBrowse,
      expanded,
      revision: state.revision + 1,
    })
  },
}))

export function assetName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '')
}
