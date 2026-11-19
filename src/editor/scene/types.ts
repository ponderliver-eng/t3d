import type { NodeScreen } from '../../runtime/ui/spec'
import type { NodeGameplay } from '../../runtime/sceneRuntime'

export type { NodeScreen, NodeGameplay }
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
  | 'screen'

export type SurfaceShader = 'lit' | 'unity-standard' | 'unlit-color' | 'unlit-texture' | 'particle-unlit'
export type ParticleBlend = 'alpha' | 'premultiply' | 'additive' | 'multiply'
export type AlphaMode = 'opaque' | 'blend' | 'clip'
export type CullMode = 'back' | 'front' | 'off'

export type PhysicsBodyKind = 'static' | 'dynamic' | 'kinematic'
export type ColliderShape = 'box' | 'sphere' | 'capsule' | 'cylinder' | 'cone' | 'convex' | 'trimesh'

export interface NodePhysics {
  body: PhysicsBodyKind
  shape: ColliderShape
  /** 盒子是完整尺寸。球体用 x 当半径。胶囊、圆柱、圆锥用 x 当半径、y 当总高度。凸包和三角网格读物体网格。 */
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

export type ToneMap = 'none' | 'linear' | 'reinhard' | 'cineon' | 'aces' | 'agx' | 'neutral'

const TONE_MAPS: readonly ToneMap[] = ['none', 'linear', 'reinhard', 'cineon', 'aces', 'agx', 'neutral']

export function toneMapOf(value: unknown): ToneMap {
  return typeof value === 'string' && TONE_MAPS.includes(value as ToneMap) ? value as ToneMap : 'aces'
}

export interface ScenePicture {
  background: string
  exposure: number
  /** 输出到屏幕前的色调映射。曝光仍单独调节。 */
  toneMapping: ToneMap
  fog: boolean
  fogColor: string
  fogNear: number
  fogFar: number
  bloom: boolean
  bloomStrength: number
  bloomRadius: number
  bloomThreshold: number
  /** 屏幕空间反射。默认关。只反射当前画面里看得见的表面。 */
  ssr: boolean
  ssrQuality: number
  ssrDistance: number
  ssrThickness: number
  ssrIntensity: number
  /** 屏幕空间全局光照。默认关。间接光和一份遮蔽都来自当前画面。 */
  ssgi: boolean
  ssgiSlices: number
  ssgiSteps: number
  ssgiRadius: number
  ssgiIntensity: number
  ssgiOcclusion: number
  /** 空间降噪。默认关。关掉时不创建降噪节点。 */
  ssgiDenoise: boolean
  /** 体积光。默认关。只对有距离的点光、聚光和矩形光散射，方向光不参与。 */
  volume: boolean
  volumeDensity: number
  volumeSteps: number
  volumeSize: number
  volumeHeight: number
  volumeColor: string
  /** 后期抗锯齿（SMAA）。默认开。 */
  aa: boolean
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
  /** 系统音效。总音量、音乐、音效。不是能力包。 */
  audio: PictureAudio
  /** 导航烘焙参数。关掉能力包不会清掉它。 */
  navigation: NavSettings
  /** 场景级扩展能力包（如体积云 clouds、大气天象等）按能力包 id 挂载的数据槽，关闭能力包时不清除数据。 */
  capabilities?: Record<string, unknown>
}

export interface PictureAudio {
  master: number
  music: number
  sfx: number
}

export const DEFAULT_PICTURE_AUDIO: PictureAudio = { master: 1, music: 0.8, sfx: 1 }

export const DEFAULT_PICTURE: ScenePicture = {
  background: '#141414',
  exposure: 1.05,
  toneMapping: 'aces',
  fog: false,
  fogColor: '#141414',
  fogNear: 12,
  fogFar: 80,
  bloom: false,
  bloomStrength: 0.35,
  bloomRadius: 0.4,
  bloomThreshold: 0.85,
  ssr: false,
  ssrQuality: 0.5,
  ssrDistance: 5,
  ssrThickness: 0.05,
  ssrIntensity: 1,
  ssgi: false,
  ssgiSlices: 2,
  ssgiSteps: 8,
  ssgiRadius: 8,
  ssgiIntensity: 4,
  ssgiOcclusion: 1,
  ssgiDenoise: false,
  volume: false,
  volumeDensity: 0.25,
  volumeSteps: 24,
  volumeSize: 40,
  volumeHeight: 16,
  volumeColor: '#d7e6ff',
  aa: true,
  ao: false,
  dof: false,
  dofFocus: 8,
  dofFocal: 2,
  dofBokeh: 2,
  hue: 0,
  saturation: 1,
  envAssetId: null,
  gravity: [0, -9.81, 0],
  audio: { ...DEFAULT_PICTURE_AUDIO },
  navigation: { ...DEFAULT_NAV },
}

export function normalizePicture(picture?: Partial<ScenePicture> | null): ScenePicture {
  const gravity = picture?.gravity
  const legacyAudio = picture?.capabilities && typeof picture.capabilities === 'object'
    ? picture.capabilities.audio
    : undefined
  const capabilities = picture?.capabilities && typeof picture.capabilities === 'object'
    ? { ...picture.capabilities }
    : undefined
  if (capabilities) delete capabilities.audio
  return {
    ...DEFAULT_PICTURE,
    ...picture,
    toneMapping: toneMapOf(picture?.toneMapping),
    ssgiDenoise: picture?.ssgiDenoise === true,
    gravity: gravity?.length === 3 ? gravity : DEFAULT_PICTURE.gravity,
    audio: { ...DEFAULT_PICTURE_AUDIO, ...pictureAudio(picture?.audio), ...pictureAudio(legacyAudio) },
    navigation: { ...DEFAULT_NAV, ...picture?.navigation },
    ...(capabilities && Object.keys(capabilities).length > 0 ? { capabilities } : {}),
  }
}

function pictureAudio(value: unknown): Partial<PictureAudio> {
  if (!value || typeof value !== 'object') return {}
  const row = value as Partial<PictureAudio>
  const next: Partial<PictureAudio> = {}
  if (typeof row.master === 'number') next.master = row.master
  if (typeof row.music === 'number') next.music = row.music
  if (typeof row.sfx === 'number') next.sfx = row.sfx
  return next
}

export type GizmoMode = 'translate' | 'rotate' | 'scale'
export type GizmoSpace = 'world' | 'local'
export type GizmoOrigin = 'pivot' | 'center'
export type PlayState = 'stopped' | 'playing' | 'paused'
export type LogLevel = 'info' | 'warn' | 'error'
export type CameraView = 'persp' | 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right'

/** 编辑器视口相机，按场景保存，不是场景里的相机物体。 */
export interface EditorView {
  view: CameraView
  pivot: Vec3
  orbitDistance: number
  yaw: number
  pitch: number
  orthoSize: number
}

const EDITOR_VIEWS: readonly CameraView[] = ['persp', 'top', 'bottom', 'front', 'back', 'left', 'right']

export function normalizeEditorView(value: unknown): EditorView | null {
  if (!value || typeof value !== 'object') return null
  const view = value as Partial<EditorView>
  if (!view.view || !EDITOR_VIEWS.includes(view.view)) return null
  if (!view.pivot || view.pivot.length !== 3) return null
  if (typeof view.orbitDistance !== 'number' || typeof view.yaw !== 'number' || typeof view.pitch !== 'number' || typeof view.orthoSize !== 'number') return null
  return {
    view: view.view,
    pivot: [view.pivot[0], view.pivot[1], view.pivot[2]],
    orbitDistance: view.orbitDistance,
    yaw: view.yaw,
    pitch: view.pitch,
    orthoSize: view.orthoSize,
  }
}
export type SidePanel = 'inspector' | 'history'

export interface ModelPartOverride {
  castShadow?: boolean
  receiveShadow?: boolean
  materialAssetId?: string | null
}

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
  /** 这段直接播放作用到全身、上半身或下半身。有上半身覆盖时，全身会改成只播下半身。 */
  clipMask?: 'full' | 'upper' | 'lower'
  /** 叠在身体层上的上半身片段。空着表示没有覆盖。 */
  overlayClip?: string
  overlayAssetId?: string | null
  overlayTime?: number
  overlayPlaying?: boolean
  overlayLoop?: boolean
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
  /** 核心玩法包（角色、跟随相机、触发器、律令）与领域包统一挂载槽。 */
  gameplay?: NodeGameplay | null
  /** 节点级扩展能力包（如水体 water、车辆 vehicle、弹簧骨骼 springBone、IK 等）按能力包 id 挂载的数据槽，关闭能力包时不清除数据。 */
  capabilities?: Record<string, unknown> | null
  /** 主标签，对应工程标签表的 id。 */
  tagId?: string | null
  /** 额外层级标签，存标签 id。 */
  tagIds?: string[]
  /** 渲染层 id。缺省为 Default。 */
  renderLayerId?: string
  /** 模型里要藏起来的部位路径。 */
  hiddenParts?: string[]
  /** 按部位路径单独覆盖阴影与材质球，未设置时跟随模型整体。 */
  partOverrides?: Record<string, ModelPartOverride>
  /** 非空时，这个节点跟着父模型上的这根骨头走。存的是骨骼路径。 */
  socketBone?: string
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

export interface LogPart {
  text: string
  /** 有资源编号时，这段文字是可点击的下划线，用来在资源窗口选中它。 */
  assetId?: string
}

export interface LogEntry {
  id: string
  level: LogLevel
  message: string
  time: number
  parts?: LogPart[]
}

export interface HistoryEntry {
  label: string
  before: Record<string, SceneNode>
  after: Record<string, SceneNode>
  beforeSelection: string[]
  afterSelection: string[]
  beforePicture: ScenePicture
  afterPicture: ScenePicture
  /** 只改了材质资源，撤销时不动场景物体。 */
  materialsOnly?: boolean
  beforeMaterials?: Record<string, PbrSlot>
  afterMaterials?: Record<string, PbrSlot>
  /** 只改了玩法包开关或游戏数据库。 */
  databaseOnly?: boolean
  beforeDatabase?: import('../../gameplay/types').GameDatabase
  afterDatabase?: import('../../gameplay/types').GameDatabase
  beforePacks?: string[]
  afterPacks?: string[]
}

export interface CameraRequest {
  nonce: number
  action: 'focus' | 'view'
  view: CameraView
}
