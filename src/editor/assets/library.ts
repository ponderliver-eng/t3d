import { create } from 'zustand'
import type { PbrSlot, SceneNode } from '../scene/types'

export type FileKind = 'model' | 'texture' | 'animation' | 'audio' | 'environment'

export interface FileAsset {
  id: string
  name: string
  kind: FileKind
  url: string
  fileName: string
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

export type ProjectAsset = FileAsset | MaterialAsset | PrefabAsset

interface AssetState {
  assets: Record<string, ProjectAsset>
  revision: number
  add: (asset: ProjectAsset) => void
  remove: (id: string) => void
  rename: (id: string, name: string) => void
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
  bump: () => set(state => ({ revision: state.revision + 1 })),
}))

export function assetName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '')
}
