export type Vec3 = [number, number, number]

export type NodeKind =
  | 'empty'
  | 'box'
  | 'sphere'
  | 'plane'
  | 'cylinder'
  | 'capsule'
  | 'model'
  | 'directional-light'
  | 'point-light'
  | 'spot-light'
  | 'hemisphere-light'
  | 'camera'

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
