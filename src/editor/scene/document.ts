import type { EffectAsset, MaterialAsset, PrefabAsset, SceneAsset } from '../assets/library'
import type { StoredNavMesh } from '../../capabilities/navigation/archive'
import type { LayerDefinition, TagDefinition } from '../project/taxonomy'
import type { SceneNode, ScenePicture } from './types'

export interface ProjectDocument {
  schemaVersion: 1 | 2
  savedAt: number
  activeSceneId: string
  nodes: Record<string, SceneNode>
  selection: string[]
  picture: ScenePicture
  library: Array<MaterialAsset | PrefabAsset | SceneAsset | EffectAsset>
  folders?: string[]
  assetDirs?: Record<string, string>
  /** 官方能力包开关。缺省按各包的默认值。 */
  capabilities?: Record<string, boolean>
  tags?: TagDefinition[]
  layers?: LayerDefinition[]
  editorCullingMask?: number
  physicsCollisionMatrixEnabled?: boolean
  physicsCollisionRowMasks?: Record<string, number>
  /** 按场景 id 保存的导航网格。关掉能力包不会清掉它。 */
  navMeshes?: Record<string, StoredNavMesh>
}
