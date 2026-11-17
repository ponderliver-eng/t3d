import type { EffectAsset, MaterialAsset, PrefabAsset, SceneAsset, UiAsset } from '../assets/library'
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
  library: Array<MaterialAsset | PrefabAsset | SceneAsset | EffectAsset | UiAsset>
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
  /** 资源树展开、选中资源和属性面板滚动。 */
  workspace?: ProjectWorkspace
}

/** 跟工程走的界面位置，换工程时各自恢复。 */
export interface ProjectWorkspace {
  assetExpanded?: string[]
  assetBrowseDir?: string
  inspectedAssetId?: string | null
  /** 属性面板各对象的滚动和展开，键是检查器主题。 */
  inspector?: Record<string, { scroll: number, open?: Record<string, boolean>, slot?: number | null }>
}
