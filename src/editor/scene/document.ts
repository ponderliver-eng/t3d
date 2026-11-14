import type { MaterialAsset, PrefabAsset, SceneAsset } from '../assets/library'
import type { LayerDefinition, TagDefinition } from '../project/taxonomy'
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
  /** 官方能力包开关。缺省按各包的默认值。 */
  capabilities?: Record<string, boolean>
  tags?: TagDefinition[]
  layers?: LayerDefinition[]
  editorCullingMask?: number
  physicsCollisionMatrixEnabled?: boolean
  physicsCollisionRowMasks?: Record<string, number>
}
