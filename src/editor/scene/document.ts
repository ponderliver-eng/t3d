import type { MaterialAsset, PrefabAsset, SceneAsset } from '../assets/library'
import type { SceneNode, ScenePicture } from './types'

export interface ProjectDocument {
  schemaVersion: 1 | 2
  savedAt: number
  activeSceneId: string
  nodes: Record<string, SceneNode>
  selection: string[]
  picture: ScenePicture
  library: Array<MaterialAsset | PrefabAsset | SceneAsset>
  folders?: string[]
  assetDirs?: Record<string, string>
}
