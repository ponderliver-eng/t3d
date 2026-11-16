import type { Group } from 'three'
import { tickPhysics } from '../capabilities/physics/session'
import { tickNavigation } from '../capabilities/navigation/session'
import { tickParticles } from '../capabilities/particles/session'
import type { SceneNode, Vec3 } from '../editor/scene/types'

/**
 * 核心玩法包（Core Pack）与领域包（Domain Packs）在节点上的统一挂载契约。
 * 保持与编辑器 UI 解耦，试玩（Play）和未来独立导出（Player）共用同一份规格与步进顺序。
 */
export type CharacterDriver = 'capsule' | 'nav' | 'hybrid'
export type CharacterMode = 'adventure' | 'strafe' | 'lockOn' | 'pointAndClick' | 'topDown' | 'side25d' | 'firstPerson'

export interface CharacterSpec {
  enabled: boolean
  driver: CharacterDriver
  mode: CharacterMode
  clickButton: 'left' | 'right'
  clickStop: number
  moveSpeed: number
  sprintMultiplier: number
  jumpSpeed: number
  maxJumps: number
  coyoteTime: number
  jumpBuffer: number
  gravity: number
  radius: number
  height: number
  dash: boolean
  dashKey: string
  dashDistance: number
  dashDuration: number
  dashInvincible: number
  dashCooldown: number
  footstepDistance: number
  lockTargetName: string
  idleClip: string
  walkClip: string
  runClip: string
  jumpClip: string
  dodgeClip: string
}

export function defaultCharacter(): CharacterSpec {
  return {
    enabled: true,
    driver: 'capsule',
    mode: 'adventure',
    clickButton: 'right',
    clickStop: 0.35,
    moveSpeed: 4.5,
    sprintMultiplier: 1.6,
    jumpSpeed: 6.5,
    maxJumps: 2,
    coyoteTime: 0.12,
    jumpBuffer: 0.12,
    gravity: 18,
    radius: 0.35,
    height: 1.7,
    dash: true,
    dashKey: 'KeyC',
    dashDistance: 4,
    dashDuration: 0.22,
    dashInvincible: 0.35,
    dashCooldown: 0.8,
    footstepDistance: 1.6,
    lockTargetName: '',
    idleClip: '',
    walkClip: '',
    runClip: '',
    jumpClip: '',
    dodgeClip: '',
  }
}

export type CameraOrbit = 'none' | 'rightDrag' | 'mouse'

export interface CameraFollowSpec {
  enabled: boolean
  /** 跟随的物体名。空着表示跟自己。 */
  targetName: string
  offset: Vec3
  pivot: Vec3
  orbit: CameraOrbit
  sensitivity: number
  minPitch: number
  maxPitch: number
  collision: boolean
  collisionRadius: number
  localOffset: boolean
  damping: number
  lookAtTarget: boolean
  fov: number
}

export function defaultCameraFollow(): CameraFollowSpec {
  return {
    enabled: true,
    targetName: '',
    offset: [0, 1.8, -4.2],
    pivot: [0, 1.4, 0],
    orbit: 'rightDrag',
    sensitivity: 0.25,
    minPitch: -35,
    maxPitch: 70,
    collision: true,
    collisionRadius: 0.2,
    localOffset: false,
    damping: 8,
    lookAtTarget: true,
    fov: 60,
  }
}

export function cameraPresetForMode(mode: CharacterMode): Partial<CameraFollowSpec> {
  if (mode === 'strafe') return { offset: [0.65, 0.45, -2.2], pivot: [0, 1.5, 0], orbit: 'mouse', localOffset: true, fov: 55, collision: true }
  if (mode === 'lockOn') return { offset: [0.35, 2.2, -4.8], pivot: [0, 1.35, 0], orbit: 'rightDrag', fov: 58, collision: true }
  if (mode === 'pointAndClick') return { offset: [0, 10.5, -7.2], pivot: [0, 0.8, 0], orbit: 'none', fov: 48, collision: false }
  if (mode === 'topDown') return { offset: [0, 9.5, -6.5], pivot: [0, 0.8, 0], orbit: 'none', fov: 50, collision: false }
  if (mode === 'side25d') return { offset: [0, 1.6, -7.5], pivot: [0, 1.2, 0], orbit: 'none', fov: 45, collision: false }
  if (mode === 'firstPerson') return { offset: [0, 1.65, 0.15], pivot: [0, 1.65, 0], orbit: 'mouse', localOffset: true, fov: 72, collision: false }
  return { offset: [0, 1.8, -4.2], pivot: [0, 1.4, 0], orbit: 'rightDrag', fov: 60, collision: true, localOffset: false }
}

export interface InteractSpec {
  enabled: boolean
  prompt: string
  key: string
  radius: number
  filterTagId: string
  message: string
  once: boolean
}

export function defaultInteract(): InteractSpec {
  return {
    enabled: true,
    prompt: '按 E 交互',
    key: 'KeyE',
    radius: 2.5,
    filterTagId: '',
    message: 'onInteract',
    once: false,
  }
}

export interface TriggerZoneSpec {
  enabled: boolean
  radius: number
  filterTagId: string
  enterMessage: string
  exitMessage: string
  once: boolean
}

export function defaultTrigger(): TriggerZoneSpec {
  return {
    enabled: true,
    radius: 3,
    filterTagId: '',
    enterMessage: 'onZoneEnter',
    exitMessage: 'onZoneExit',
    once: false,
  }
}

export interface MoverSpec {
  enabled: boolean
  offset: Vec3
  duration: number
  pause: number
  pingPong: boolean
  autoPlay: boolean
  startMessage: string
  carryRadius: number
}

export function defaultMover(): MoverSpec {
  return {
    enabled: true,
    offset: [0, 3, 0],
    duration: 2.5,
    pause: 0.6,
    pingPong: true,
    autoPlay: true,
    startMessage: 'onActivateMover',
    carryRadius: 1.6,
  }
}

export interface CheckpointSpec {
  enabled: boolean
  spawn: boolean
  radius: number
  delay: number
  abyssY: number
  message: string
}

export function defaultCheckpoint(): CheckpointSpec {
  return {
    enabled: true,
    spawn: false,
    radius: 2.5,
    delay: 1.2,
    abyssY: -12,
    message: 'onPlayerRespawned',
  }
}

export interface ScoreSpec {
  enabled: boolean
  title: string
  target: number
  perInteract: number
  timeLimit: number
  victoryMessage: string
  defeatMessage: string
}

export function defaultScore(): ScoreSpec {
  return {
    enabled: true,
    title: '到达目标',
    target: 100,
    perInteract: 50,
    timeLimit: 0,
    victoryMessage: 'onStageVictory',
    defeatMessage: 'onStageDefeat',
  }
}

export interface RuleEntry {
  id: string
  when: string
  params?: Record<string, unknown>
  actions: Array<{
    do: string
    targetNodeId?: string | null
    params?: Record<string, unknown>
  }>
}

export interface NodeGameplay {
  character?: CharacterSpec | null
  cameraFollow?: CameraFollowSpec | null
  interact?: InteractSpec | null
  trigger?: TriggerZoneSpec | null
  mover?: MoverSpec | null
  checkpoint?: CheckpointSpec | null
  score?: ScoreSpec | null
  rules?: RuleEntry[]
  /** 领域包（属性、战斗、感知、背包、对话）按包 id 挂载的数据槽，关闭领域包时不清除数据。 */
  packs?: Record<string, unknown>
}

export interface SceneRuntimeHost {
  readonly ready: boolean
  resolveObject: (id: string) => Group | null
  updateAnimations: (dt: number) => void
  /** 当前观察相机的水平朝向，弧度。角色用它决定前后左右。 */
  yaw?: () => number
  pitch?: () => number
  poseCamera?: (position: Vec3, lookAt: Vec3, fov: number) => void
  pointerDelta?: () => { x: number, y: number }
  rightHeld?: () => boolean
  /** 从起点沿方向探测场景，返回最近交点距离。忽略 ignoreId。 */
  probe?: (origin: Vec3, direction: Vec3, max: number, ignoreId: string) => number | null
  /** 取走一次地面点击。没有则返回 null。 */
  consumeClick?: (button: 'left' | 'right') => Vec3 | null
}

export type RuntimeSystemStep = (dt: number, host: SceneRuntimeHost) => void

const systems: Array<{ id: string, order: number, step: RuntimeSystemStep }> = []

export function registerRuntimeSystem(id: string, order: number, step: RuntimeSystemStep): () => void {
  const index = systems.findIndex(item => item.id === id)
  if (index >= 0) systems.splice(index, 1)
  systems.push({ id, order, step })
  systems.sort((a, b) => a.order - b.order)
  return () => {
    const idx = systems.findIndex(item => item.id === id)
    if (idx >= 0) systems.splice(idx, 1)
  }
}

/**
 * 统一场景运行时步进：
 * 1. 已注册的核心包/领域包系统（输入、角色控制器、跟随相机、触发器与律令）
 * 2. 物理世界步进（Rapier）
 * 3. 导航网格与动态障碍同步（Recast）
 * 4. 粒子系统模拟（Quarks）
 * 5. 骨骼动画混合器推进（AnimationMixer）
 */
export function stepSceneRuntime(dt: number, host: SceneRuntimeHost) {
  for (const system of systems) {
    system.step(dt, host)
  }
  tickPhysics(dt, host.resolveObject)
  tickNavigation()
  if (host.ready) {
    tickParticles(dt, host.resolveObject)
    host.updateAnimations(dt)
  }
}

export function hasGameplayComponent(node: SceneNode, key: keyof NodeGameplay): boolean {
  return Boolean(node.gameplay?.[key])
}
