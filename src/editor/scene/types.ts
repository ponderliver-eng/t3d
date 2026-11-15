import type { NodeScreen } from '../../runtime/ui/spec'

export type { NodeScreen }
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
  | 'effect'

export type SurfaceShader = 'lit' | 'unlit-color' | 'unlit-texture' | 'particle-unlit'
export type ParticleBlend = 'alpha' | 'premultiply' | 'additive' | 'multiply'
export type AlphaMode = 'opaque' | 'blend' | 'clip'
export type CullMode = 'back' | 'front' | 'off'

export type PhysicsBodyKind = 'static' | 'dynamic' | 'kinematic'
export type ColliderShape = 'box' | 'sphere' | 'capsule'

export interface NodePhysics {
  body: PhysicsBodyKind
  shape: ColliderShape
  /** 盒子是完整尺寸。球体用 x 当半径。胶囊用 x 当半径、y 当总高度。 */
  size: Vec3
  trigger: boolean
  mass: number
  friction: number
  restitution: number
  linearDamping: number
  angularDamping: number
  gravityScale: number
}

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
  /** glTF 金属粗糙图：G 粗糙，B 金属，R 遮蔽。 */
  metallicRoughnessAssetId: string | null
  /** 旧工程里分开的两张图。读取时并进 metallicRoughnessAssetId。 */
  roughnessAssetId?: string | null
  metalnessAssetId?: string | null
  emissiveAssetId: string | null
  /** 单独的遮蔽图。空着时用金属粗糙图的红通道。 */
  aoAssetId: string | null
  materialAssetId?: string | null
  shader?: SurfaceShader
  normalScale?: number
  alphaMode?: AlphaMode
  alphaCutoff?: number
  cull?: CullMode
  depthWrite?: boolean
  wireframe?: boolean
  /** 粒子无光材质的混合。其它着色器忽略。 */
  particleBlend?: ParticleBlend
}

export interface NavSettings {
  /** 水平格子，米。 */
  cellSize: number
  /** 高度格子，米。 */
  cellHeight: number
  /** 可走的最大坡度，度。 */
  walkableSlopeAngle: number
  /** 角色半径，米。 */
  agentRadius: number
  /** 角色高度，米。 */
  agentHeight: number
  /** 大于 0 时烘焙可被动态障碍挖开的网格，0 时只烘焙静态网格。 */
  maxObstacles: number
}

export const DEFAULT_NAV: NavSettings = {
  cellSize: 0.2,
  cellHeight: 0.2,
  walkableSlopeAngle: 45,
  agentRadius: 0.35,
  agentHeight: 1.8,
  maxObstacles: 32,
}

export type NavRole = 'surface' | 'obstacle'

export interface NodeEffect {
  /** 引用特效资源。空着表示模拟写在这个物体上。 */
  assetId: string | null
  quarksVersion: string
  simulation: unknown | null
  /** 空着则用资源上的材质。 */
  materialAssetId: string | null
  playing: boolean
}

export interface NodeNavigation {
  role: NavRole
  /** 障碍圆柱的半径，米。表面不使用。 */
  radius: number
  /** 障碍圆柱的高度，米。表面不使用。 */
  height: number
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
  /** 场景重力，米/秒²。物理能力包读取。 */
  gravity: Vec3
  /** 导航烘焙参数。关掉能力包不会清掉它。 */
  navigation: NavSettings
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
  gravity: [0, -9.81, 0],
  navigation: { ...DEFAULT_NAV },
}

export function normalizePicture(picture?: Partial<ScenePicture> | null): ScenePicture {
  const gravity = picture?.gravity
  return {
    ...DEFAULT_PICTURE,
    ...picture,
    gravity: gravity?.length === 3 ? gravity : DEFAULT_PICTURE.gravity,
    navigation: { ...DEFAULT_NAV, ...picture?.navigation },
  }
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
  /** 缺省为循环。false 时按 clipEnd 处理。 */
  clipLoop?: boolean
  /** 非循环播完后：停在最后一帧、停止，或回到状态机默认状态。 */
  clipEnd?: 'hold' | 'stop' | 'default'
  clipSpeed?: number
  clipFade?: number
  /** 钉住盆骨的水平位移，只留上下。 */
  clipInPlace?: boolean
  /** 这段直接播放作用到全身、上半身或下半身。 */
  clipMask?: 'full' | 'upper' | 'lower'
  animator?: import('../animation/animator').AnimatorController | null
  metalness: number
  roughness: number
  emissive: string
  emissiveIntensity: number
  opacity: number
  ao: number
  mapAssetId: string | null
  normalAssetId: string | null
  metallicRoughnessAssetId: string | null
  roughnessAssetId?: string | null
  metalnessAssetId?: string | null
  emissiveAssetId: string | null
  aoAssetId: string | null
  materialAssetId: string | null
  shader: SurfaceShader
  particleBlend?: ParticleBlend
  normalScale: number
  alphaMode: AlphaMode
  alphaCutoff: number
  cull: CullMode
  depthWrite: boolean
  wireframe: boolean
  /** 空着表示这个节点不参与物理。关掉能力包不会清掉它。 */
  physics?: NodePhysics | null
  /** 空着表示这个节点不参与导航。关掉能力包不会清掉它。 */
  navigation?: NodeNavigation | null
  /** 特效物体的播放数据。关掉能力包不会清掉它。 */
  effect?: NodeEffect | null
  /** 屏幕界面挂载。一份节点挂一份文档。 */
  screen?: NodeScreen | null
  /** 主标签，对应工程标签表的 id。 */
  tagId?: string | null
  /** 额外层级标签，存标签 id。 */
  tagIds?: string[]
  /** 渲染层 id。缺省为 Default。 */
  renderLayerId?: string
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
