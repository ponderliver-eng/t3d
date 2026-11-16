import { create } from 'zustand'
import type { ClipCatalogEntry } from '../animation/playback'
import type { ModelHumanoidAvatar } from '../animation/humanoidAvatar'
import type { HumanoidRetargetAdjust } from '../animation/humanoidAdjust'
import type { UiDocument } from '../../runtime/ui/spec'
import type { PbrSlot, SceneNode, ScenePicture, EditorView } from '../scene/types'
import { ASSETS_ROOT, directoryExists, isWithin, joinDir, normalizeDir, parentDir, relocateDir, uniqueFolderName } from './folders'

export type FileKind = 'model' | 'texture' | 'animation' | 'audio' | 'environment'

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
}

export type ProjectAsset = FileAsset | MaterialAsset | PrefabAsset | SceneAsset | EffectAsset | UiAsset

interface AssetState {
  assets: Record<string, ProjectAsset>
  folders: string[]
  assetDirs: Record<string, string>
  browseDir: string
  revision: number
  add: (asset: ProjectAsset) => void
  remove: (id: string) => void
  rename: (id: string, name: string) => void
  patch: (id: string, patch: Partial<FileAsset>) => void
  writeScene: (id: string, nodes: Record<string, SceneNode>, picture: ScenePicture, editorView?: EditorView | null) => void
  updateMaterial: (id: string, slot: Partial<PbrSlot>) => void
  updateEffect: (id: string, patch: { simulation?: unknown, materialAssetId?: string | null }) => void
  updateUi: (id: string, document: UiDocument) => void
  bump: () => void
  loadCatalog: (folders: string[], assetDirs: Record<string, string>) => void
  loadSession: (assets: Record<string, ProjectAsset>, folders: string[], assetDirs: Record<string, string>) => void
  setBrowseDir: (dir: string) => void
  place: (id: string, dir?: string) => void
  writePrefab: (id: string, rootId: string, nodes: Record<string, SceneNode>) => void
  createFolder: (parent?: string) => string
  renameFolder: (path: string, name: string) => void
  deleteFolder: (path: string) => void
}

export function assetDirectory(id: string, assetDirs: Record<string, string>): string {
  return normalizeDir(assetDirs[id] ?? ASSETS_ROOT)
}

export const useAssetStore = create<AssetState>((set, get) => ({
  assets: {},
  folders: [],
  assetDirs: {},
  browseDir: ASSETS_ROOT,
  revision: 0,
  add: asset => set(state => ({ assets: { ...state.assets, [asset.id]: asset }, revision: state.revision + 1 })),
  remove: id => set(state => {
    const assets = { ...state.assets }
    const assetDirs = { ...state.assetDirs }
    delete assets[id]
    delete assetDirs[id]
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
    return { assets: { ...state.assets, [id]: { ...asset, nodes, picture, editorView: view } }, revision: state.revision + 1 }
  }),
  updateMaterial: (id, slot) => set(state => {
    const asset = state.assets[id]
    if (!asset || asset.kind !== 'material') return {}
    return { assets: { ...state.assets, [id]: { ...asset, slot: { ...asset.slot, ...slot } } }, revision: state.revision + 1 }
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
  loadSession: (assets, folders, assetDirs) => set(state => ({
    assets,
    folders: [...new Set(folders.map(normalizeDir).filter(path => path !== ASSETS_ROOT))],
    assetDirs: Object.fromEntries(Object.entries(assetDirs).map(([id, dir]) => [id, normalizeDir(dir)])),
    browseDir: ASSETS_ROOT,
    revision: state.revision + 1,
  })),
  setBrowseDir: dir => set({ browseDir: normalizeDir(dir) }),
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
    set({
      folders: [...new Set(state.folders.map(folder => relocateDir(folder, source, next)).filter(folder => folder !== ASSETS_ROOT))],
      assetDirs: Object.fromEntries(Object.entries(state.assetDirs).map(([id, dir]) => [id, relocateDir(dir, source, next)])),
      browseDir: relocateDir(state.browseDir, source, next),
      revision: state.revision + 1,
    })
  },
  deleteFolder: path => {
    const source = normalizeDir(path)
    const parent = parentDir(source)
    if (!parent) return
    const state = get()
    const remains = Object.keys(state.assets).some(id => isWithin(assetDirectory(id, state.assetDirs), source))
    if (remains) return
    set({
      folders: state.folders.filter(folder => {
        const dir = normalizeDir(folder)
        return dir !== source && !dir.startsWith(`${source}/`)
      }),
      browseDir: isWithin(state.browseDir, source) ? parent : state.browseDir,
      revision: state.revision + 1,
    })
  },
}))

export function assetName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '')
}
