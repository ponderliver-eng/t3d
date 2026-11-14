import { create } from 'zustand'
import type { PbrSlot, SceneNode, ScenePicture } from '../scene/types'

export type FileKind = 'model' | 'texture' | 'animation' | 'audio' | 'environment'

export interface FileAsset {
  id: string
  name: string
  kind: FileKind
  url: string
  fileName: string
  hash: string
  thumb: string | null
}

export interface MaterialAsset {
  id: string
  name: string
  kind: 'material'
  slot: PbrSlot
}

export interface PrefabAsset {
  id: string
  name: string
  kind: 'prefab'
  nodes: SceneNode[]
}

export interface SceneAsset {
  id: string
  name: string
  kind: 'scene'
  nodes: Record<string, SceneNode>
  picture: ScenePicture
}

export type ProjectAsset = FileAsset | MaterialAsset | PrefabAsset | SceneAsset

interface AssetState {
  assets: Record<string, ProjectAsset>
  revision: number
  add: (asset: ProjectAsset) => void
  remove: (id: string) => void
  rename: (id: string, name: string) => void
  patch: (id: string, patch: Partial<FileAsset>) => void
  writeScene: (id: string, nodes: Record<string, SceneNode>, picture: ScenePicture) => void
  updateMaterial: (id: string, slot: Partial<PbrSlot>) => void
  bump: () => void
}

export const useAssetStore = create<AssetState>(set => ({
  assets: {},
  revision: 0,
  add: asset => set(state => ({ assets: { ...state.assets, [asset.id]: asset }, revision: state.revision + 1 })),
  remove: id => set(state => {
    const assets = { ...state.assets }
    delete assets[id]
    return { assets, revision: state.revision + 1 }
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
  writeScene: (id, nodes, picture) => set(state => {
    const asset = state.assets[id]
    if (!asset || asset.kind !== 'scene') return {}
    if (JSON.stringify(asset.nodes) === JSON.stringify(nodes) && JSON.stringify(asset.picture) === JSON.stringify(picture)) return {}
    return { assets: { ...state.assets, [id]: { ...asset, nodes, picture } }, revision: state.revision + 1 }
  }),
  updateMaterial: (id, slot) => set(state => {
    const asset = state.assets[id]
    if (!asset || asset.kind !== 'material') return {}
    return { assets: { ...state.assets, [id]: { ...asset, slot: { ...asset.slot, ...slot } } }, revision: state.revision + 1 }
  }),
  bump: () => set(state => ({ revision: state.revision + 1 })),
}))

export function assetName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '')
}
