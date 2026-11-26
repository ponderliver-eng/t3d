import type { EasingName } from '../../runtime/motion'

export const CUTSCENE_CAPABILITY_ID = 'cutscene'

export type CutsceneKeyEase = 'smooth' | 'linear' | 'step' | EasingName

export type CutsceneValueType = 'number' | 'vec2' | 'vec3' | 'vec4' | 'color' | 'boolean' | 'string'

export interface CutscenePropertyKey {
  id: string
  time: number
  value: number | number[] | string | boolean
  ease?: CutsceneKeyEase
}

export interface CutsceneAnimClip {
  id: string
  name: string
  clipAssetId: string | null
  clipName: string
  startTime: number
  duration: number
  trimIn?: number
  speed?: number
  loop?: boolean
  inPlace?: boolean
  mask?: 'full' | 'upper' | 'lower'
}

export interface CutsceneActivationSpan {
  id: string
  startTime: number
  duration: number
  active: boolean
}

export interface CutsceneCameraShot {
  id: string
  cameraNodeId: string
  label?: string
  startTime: number
  duration: number
  /** 切入过渡时长（秒），> 0 时从上一机位平滑插值 */
  blendIn?: number
  /** 可选覆盖相机 FOV */
  fov?: number
}

export type CutsceneEventKind = 'message' | 'sound' | 'showUi' | 'hideUi'

export interface CutsceneEventKey {
  id: string
  time: number
  kind: CutsceneEventKind
  /** 消息名或 UI 屏幕名称/ID */
  name: string
  /** 音效资产 ID */
  assetId?: string | null
  volume?: number
  /** 可选消息附加数值载荷 */
  payload?: Record<string, number | string>
}

export type CutsceneTrackKind = 'animation' | 'property' | 'spline' | 'activation'

export interface CutsceneTrack {
  id: string
  kind: CutsceneTrackKind
  /** 目标节点 ID；空字符串或 '__picture__' 表示场景画面级属性 */
  targetNodeId: string
  label?: string
  muted?: boolean
  /** kind === 'animation' 时有效 */
  animLayer?: 'body' | 'overlay'
  clips?: CutsceneAnimClip[]
  /** kind === 'property' 时有效 */
  propertyPath?: string
  valueType?: CutsceneValueType
  keys?: CutscenePropertyKey[]
  /** kind === 'spline' 时有效（keys 存 0~1 进度） */
  splineNodeId?: string
  faceDirection?: boolean
  planeXZ?: boolean
  /** kind === 'activation' 时有效 */
  spans?: CutsceneActivationSpan[]
}

export interface CutsceneSequence {
  id: string
  name: string
  duration: number
  fps: number
  loop: boolean
  /** 进入试玩时自动播放 */
  autoPlay?: boolean
  /** 播放时锁定玩家角色输入与默认跟随镜头 */
  lockPlayerInput?: boolean
  /** 播完停止时恢复被驱动对象的初始状态 */
  restoreOnStop?: boolean
  cameraTrack: CutsceneCameraShot[]
  eventTrack: CutsceneEventKey[]
  tracks: CutsceneTrack[]
}

export interface CutsceneDirectorRef {
  id: string
  assetId: string
  autoPlay?: boolean
  loop?: boolean
  lockPlayerInput?: boolean
}

export interface CutsceneDocument {
  directors: CutsceneDirectorRef[]
  activeAssetId?: string
  sequences: CutsceneSequence[]
  activeSequenceId?: string
}

export function createEmptySequence(name = '过场序列 1', id?: string): CutsceneSequence {
  return {
    id: id || crypto.randomUUID(),
    name,
    duration: 8,
    fps: 30,
    loop: false,
    autoPlay: false,
    lockPlayerInput: true,
    restoreOnStop: false,
    cameraTrack: [],
    eventTrack: [],
    tracks: [],
  }
}

export function defaultCutsceneDocument(): CutsceneDocument {
  return {
    directors: [],
    activeAssetId: '',
    sequences: [],
    activeSequenceId: '',
  }
}

function finiteNum(v: unknown, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function normalizeAnimClip(raw: unknown): CutsceneAnimClip | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Partial<CutsceneAnimClip>
  return {
    id: typeof item.id === 'string' && item.id ? item.id : crypto.randomUUID(),
    name: typeof item.name === 'string' ? item.name : (item.clipName ?? ''),
    clipAssetId: typeof item.clipAssetId === 'string' && item.clipAssetId ? item.clipAssetId : null,
    clipName: typeof item.clipName === 'string' ? item.clipName : '',
    startTime: Math.max(0, finiteNum(item.startTime, 0)),
    duration: Math.max(0.05, finiteNum(item.duration, 1)),
    trimIn: Math.max(0, finiteNum(item.trimIn, 0)),
    speed: Math.max(0.01, finiteNum(item.speed, 1)),
    loop: item.loop === true,
    inPlace: item.inPlace === true,
    mask: item.mask === 'upper' || item.mask === 'lower' ? item.mask : 'full',
  }
}

function normalizePropertyKey(raw: unknown): CutscenePropertyKey | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Partial<CutscenePropertyKey>
  if (item.value === undefined || item.value === null) return null
  let value: CutscenePropertyKey['value']
  if (Array.isArray(item.value)) {
    value = item.value.map(v => finiteNum(v, 0))
  } else if (typeof item.value === 'number') {
    value = finiteNum(item.value, 0)
  } else if (typeof item.value === 'boolean' || typeof item.value === 'string') {
    value = item.value
  } else {
    return null
  }
  return {
    id: typeof item.id === 'string' && item.id ? item.id : crypto.randomUUID(),
    time: Math.max(0, finiteNum(item.time, 0)),
    value,
    ease: typeof item.ease === 'string' && item.ease ? (item.ease as CutsceneKeyEase) : 'smooth',
  }
}

function normalizeSpan(raw: unknown): CutsceneActivationSpan | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Partial<CutsceneActivationSpan>
  return {
    id: typeof item.id === 'string' && item.id ? item.id : crypto.randomUUID(),
    startTime: Math.max(0, finiteNum(item.startTime, 0)),
    duration: Math.max(0.05, finiteNum(item.duration, 1)),
    active: item.active !== false,
  }
}

function normalizeCameraShot(raw: unknown): CutsceneCameraShot | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Partial<CutsceneCameraShot>
  if (typeof item.cameraNodeId !== 'string') return null
  return {
    id: typeof item.id === 'string' && item.id ? item.id : crypto.randomUUID(),
    cameraNodeId: item.cameraNodeId,
    label: typeof item.label === 'string' ? item.label : '',
    startTime: Math.max(0, finiteNum(item.startTime, 0)),
    duration: Math.max(0.05, finiteNum(item.duration, 2)),
    blendIn: Math.max(0, finiteNum(item.blendIn, 0)),
    ...(typeof item.fov === 'number' && Number.isFinite(item.fov) ? { fov: item.fov } : {}),
  }
}

function normalizeEventKey(raw: unknown): CutsceneEventKey | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Partial<CutsceneEventKey>
  const kind: CutsceneEventKind =
    item.kind === 'sound' || item.kind === 'showUi' || item.kind === 'hideUi' ? item.kind : 'message'
  return {
    id: typeof item.id === 'string' && item.id ? item.id : crypto.randomUUID(),
    time: Math.max(0, finiteNum(item.time, 0)),
    kind,
    name: typeof item.name === 'string' ? item.name : '',
    assetId: typeof item.assetId === 'string' && item.assetId ? item.assetId : null,
    volume: Math.max(0, Math.min(2, finiteNum(item.volume, 1))),
    ...(item.payload && typeof item.payload === 'object' ? { payload: { ...item.payload } } : {}),
  }
}

function normalizeTrack(raw: unknown): CutsceneTrack | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Partial<CutsceneTrack>
  const kind: CutsceneTrackKind =
    item.kind === 'animation' || item.kind === 'spline' || item.kind === 'activation' ? item.kind : 'property'
  const keys = Array.isArray(item.keys)
    ? item.keys.map(normalizePropertyKey).filter((k): k is CutscenePropertyKey => k !== null).sort((a, b) => a.time - b.time)
    : undefined
  const clips = Array.isArray(item.clips)
    ? item.clips.map(normalizeAnimClip).filter((c): c is CutsceneAnimClip => c !== null).sort((a, b) => a.startTime - b.startTime)
    : undefined
  const spans = Array.isArray(item.spans)
    ? item.spans.map(normalizeSpan).filter((s): s is CutsceneActivationSpan => s !== null).sort((a, b) => a.startTime - b.startTime)
    : undefined
  return {
    id: typeof item.id === 'string' && item.id ? item.id : crypto.randomUUID(),
    kind,
    targetNodeId: typeof item.targetNodeId === 'string' ? item.targetNodeId : '',
    label: typeof item.label === 'string' ? item.label : '',
    muted: item.muted === true,
    ...(kind === 'animation' ? { animLayer: item.animLayer === 'overlay' ? 'overlay' : 'body', clips: clips ?? [] } : {}),
    ...(kind === 'property' ? {
      propertyPath: typeof item.propertyPath === 'string' ? item.propertyPath : 'position',
      valueType: (item.valueType as CutsceneValueType) || 'vec3',
      keys: keys ?? [],
    } : {}),
    ...(kind === 'spline' ? {
      splineNodeId: typeof item.splineNodeId === 'string' ? item.splineNodeId : '',
      faceDirection: item.faceDirection !== false,
      planeXZ: item.planeXZ === true,
      keys: keys ?? [],
    } : {}),
    ...(kind === 'activation' ? { spans: spans ?? [] } : {}),
  }
}

export function normalizeCutsceneSequence(raw: unknown): CutsceneSequence | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Partial<CutsceneSequence>
  return {
    id: typeof item.id === 'string' && item.id ? item.id : crypto.randomUUID(),
    name: typeof item.name === 'string' && item.name.trim() ? item.name : '过场序列',
    duration: Math.max(0.2, finiteNum(item.duration, 8)),
    fps: Math.max(12, Math.min(120, Math.round(finiteNum(item.fps, 30)))),
    loop: item.loop === true,
    autoPlay: item.autoPlay === true,
    lockPlayerInput: item.lockPlayerInput !== false,
    restoreOnStop: item.restoreOnStop === true,
    cameraTrack: Array.isArray(item.cameraTrack)
      ? item.cameraTrack.map(normalizeCameraShot).filter((c): c is CutsceneCameraShot => c !== null).sort((a, b) => a.startTime - b.startTime)
      : [],
    eventTrack: Array.isArray(item.eventTrack)
      ? item.eventTrack.map(normalizeEventKey).filter((e): e is CutsceneEventKey => e !== null).sort((a, b) => a.time - b.time)
      : [],
    tracks: Array.isArray(item.tracks)
      ? item.tracks.map(normalizeTrack).filter((t): t is CutsceneTrack => t !== null)
      : [],
  }
}

function normalizeDirectorRef(raw: unknown): CutsceneDirectorRef | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Partial<CutsceneDirectorRef>
  if (typeof item.assetId !== 'string' || !item.assetId) return null
  return {
    id: typeof item.id === 'string' && item.id ? item.id : crypto.randomUUID(),
    assetId: item.assetId,
    ...(typeof item.autoPlay === 'boolean' ? { autoPlay: item.autoPlay } : {}),
    ...(typeof item.loop === 'boolean' ? { loop: item.loop } : {}),
    ...(typeof item.lockPlayerInput === 'boolean' ? { lockPlayerInput: item.lockPlayerInput } : {}),
  }
}

export function normalizeCutsceneDocument(raw: unknown): CutsceneDocument {
  if (!raw || typeof raw !== 'object') return defaultCutsceneDocument()
  const obj = raw as Partial<CutsceneDocument>
  const directors = Array.isArray(obj.directors)
    ? obj.directors.map(normalizeDirectorRef).filter((d): d is CutsceneDirectorRef => d !== null)
    : []
  const sequences = Array.isArray(obj.sequences)
    ? obj.sequences.map(normalizeCutsceneSequence).filter((s): s is CutsceneSequence => s !== null)
    : []
  const activeId = typeof obj.activeSequenceId === 'string' && sequences.some(s => s.id === obj.activeSequenceId)
    ? obj.activeSequenceId
    : (sequences[0]?.id ?? '')
  const activeAssetId = typeof obj.activeAssetId === 'string' ? obj.activeAssetId : (directors[0]?.assetId ?? '')
  return {
    directors,
    activeAssetId,
    sequences,
    activeSequenceId: activeId,
  }
}
