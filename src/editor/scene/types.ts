export type Vec3 = [number, number, number]

export type NodeKind =
  | 'empty'
  | 'box'
  | 'sphere'
  | 'plane'
  | 'cylinder'
  | 'capsule'
  | 'cone'
  | 'model'
  | 'directional-light'
  | 'point-light'
  | 'spot-light'
  | 'hemisphere-light'
  | 'camera'

export type SurfaceShader = 'lit' | 'unlit-color' | 'unlit-texture'
export type AlphaMode = 'opaque' | 'blend' | 'clip'
export type CullMode = 'back' | 'front' | 'off'

export interface PbrSlot {
  name: string
  color: string
  metalness: number
  roughness: number
  emissive: string
  emissiveIntensity: number
  opacity: number
  ao: number
  mapAssetId: string | null
  normalAssetId: string | null
  roughnessAssetId: string | null
  metalnessAssetId: string | null
  emissiveAssetId: string | null
  aoAssetId: string | null
  materialAssetId?: string | null
  shader?: SurfaceShader
  normalScale?: number
  alphaMode?: AlphaMode
  alphaCutoff?: number
  cull?: CullMode
  depthWrite?: boolean
  wireframe?: boolean
}

export interface ScenePicture {
  background: string
  exposure: number
  fog: boolean
  fogColor: string
  fogNear: number
  fogFar: number
  bloom: boolean
  bloomStrength: number
  bloomRadius: number
  bloomThreshold: number
  ao: boolean
  dof: boolean
  dofFocus: number
  dofFocal: number
  dofBokeh: number
  hue: number
  saturation: number
  envAssetId: string | null
}

export const DEFAULT_PICTURE: ScenePicture = {
  background: '#141414',
  exposure: 1.05,
  fog: false,
  fogColor: '#141414',
  fogNear: 12,
  fogFar: 80,
  bloom: false,
  bloomStrength: 0.35,
  bloomRadius: 0.4,
  bloomThreshold: 0.85,
  ao: false,
  dof: false,
  dofFocus: 8,
  dofFocal: 2,
  dofBokeh: 2,
  hue: 0,
  saturation: 1,
  envAssetId: null,
}

export type GizmoMode = 'translate' | 'rotate' | 'scale'
export type GizmoSpace = 'world' | 'local'
export type GizmoOrigin = 'pivot' | 'center'
export type PlayState = 'stopped' | 'playing' | 'paused'
export type LogLevel = 'info' | 'warn' | 'error'
export type CameraView = 'persp' | 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right'
export type SidePanel = 'inspector' | 'history'

export interface SceneNode {
  id: string
  name: string
  kind: NodeKind
  parentId: string | null
  order: number
  visible: boolean
  locked: boolean
  position: Vec3
  rotation: Vec3
  scale: Vec3
  color: string
  intensity: number
  fov: number
  spotAngle: number
  assetId: string | null
  clip: string
  clipAssetId: string | null
  clipTime: number
  clipPlaying: boolean
  metalness: number
  roughness: number
  emissive: string
  emissiveIntensity: number
  opacity: number
  ao: number
  mapAssetId: string | null
  normalAssetId: string | null
  roughnessAssetId: string | null
  metalnessAssetId: string | null
  emissiveAssetId: string | null
  aoAssetId: string | null
  materialAssetId: string | null
  shader: SurfaceShader
  normalScale: number
  alphaMode: AlphaMode
  alphaCutoff: number
  cull: CullMode
  depthWrite: boolean
  wireframe: boolean
  slots: PbrSlot[]
  castShadow: boolean
  receiveShadow: boolean
  shadowBias: number
  shadowNormalBias: number
  range: number
  decay: number
  penumbra: number
  groundColor: string
  near: number
  far: number
  /** 这个节点所属的预制体资源。实例根和从模板展开的子节点都有。 */
  prefabAssetId?: string
  /** 场景里这次放置的实例根 id。 */
  prefabInstanceId?: string
  /** 对应的模板节点 id。实例上新增的子物体没有这个字段。 */
  prefabTemplateId?: string
  /** 外层模板里代表这个嵌套预制体的节点 id。 */
  prefabHostTemplateId?: string
  /** 相对模板改过的属性名。 */
  prefabOverrides?: string[]
  /** 从这个实例里删掉的模板节点。 */
  prefabRemoved?: string[]
  /** 模板节点指向另一个预制体，展开时变成嵌套实例。 */
  nestedPrefabId?: string
}

export interface LogEntry {
  id: string
  level: LogLevel
  message: string
  time: number
}

export interface HistoryEntry {
  label: string
  before: Record<string, SceneNode>
  after: Record<string, SceneNode>
  beforeSelection: string[]
  afterSelection: string[]
  beforePicture: ScenePicture
  afterPicture: ScenePicture
}

export interface CameraRequest {
  nonce: number
  action: 'focus' | 'view'
  view: CameraView
}
