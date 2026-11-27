import type { CutsceneAsset, EffectAsset, MaterialAsset, PrefabAsset, SceneAsset, UiAsset } from '../assets/library'
import type { StoredNavMesh } from '../../capabilities/navigation/archive'
import type { LayerDefinition, TagDefinition } from '../project/taxonomy'
import type { EditorView, SceneNode, ScenePicture } from './types'

export interface ProjectDocument {
  schemaVersion: 1 | 2
  savedAt: number
  activeSceneId: string
  nodes: Record<string, SceneNode>
  selection: string[]
  picture: ScenePicture
  library: Array<MaterialAsset | PrefabAsset | SceneAsset | EffectAsset | UiAsset | CutsceneAsset>
  folders?: string[]
  assetDirs?: Record<string, string>
  /** 官方能力包开关。缺省按各包的默认值。 */
  capabilities?: Record<string, boolean>
  /** 已启用的玩法包。核心包始终在内。关掉的包不出现在数据表目录，已写的行留着。 */
  gameplayPacks?: string[]
  /** 玩法标签、打击感和以后的领域表。一行一条。 */
  gameDatabase?: import('../../gameplay/types').GameDatabase
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

/**
 * 目录工程里 project.t3d 存的部分：只有工程设置。
 * 场景、材质、预制体等库资源和导航网格各自是 Assets/ 下的独立文件。
 */
export type ProjectSettingsDocument = Omit<ProjectDocument, 'nodes' | 'picture' | 'library' | 'navMeshes'>

/** 跟工程走的界面位置，换工程时各自恢复。 */
export interface ProjectWorkspace {
  assetExpanded?: string[]
  assetBrowseDir?: string
  inspectedAssetId?: string | null
  /** 属性面板各对象的滚动和展开，键是检查器主题。 */
  inspector?: Record<string, { scroll: number, open?: Record<string, boolean>, slot?: number | null }>
  /** AI 助手面板的打开状态与对话列表滚动位置。 */
  aiPanelOpen?: boolean
  aiPanelScrollTop?: number
  /** 目录工程里各场景的视口相机，按场景 id。不放进场景文件，免得转一下镜头就重写整个场景。 */
  sceneViews?: Record<string, EditorView>
}
