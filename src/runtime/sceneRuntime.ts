import type { Group } from 'three'
import { tickPhysics } from '../capabilities/physics/session'
import { tickNavigation } from '../capabilities/navigation/session'
import { tickParticles } from '../capabilities/particles/session'
import type { SceneNode, Vec3 } from '../editor/scene/types'
import { scalePlayDt } from '../gameplay/juiceClock'
import { measureCost } from './frameProfile'

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
  /** 朝移动方向转身的角速度，度/秒。越肩、锁定和第一人称会再快一截。 */
  turnSpeed: number
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
  lockTargetId?: string
  lockTargetName: string
  idleClip: string
  idleClipAssetId: string
  walkClip: string
  walkClipAssetId: string
  runClip: string
  runClipAssetId: string
  jumpClip: string
  jumpClipAssetId: string
  airClip: string
  airClipAssetId: string
  landClip: string
  landClipAssetId: string
  dodgeClip: string
  dodgeClipAssetId: string
}

export function defaultCharacter(): CharacterSpec {
  return {
    enabled: true,
    driver: 'capsule',
    mode: 'adventure',
    clickButton: 'right',
    clickStop: 0.35,
    moveSpeed: 4.5,
    turnSpeed: 540,
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
    lockTargetId: '',
    lockTargetName: '',
    idleClip: '',
    idleClipAssetId: '',
    walkClip: '',
    walkClipAssetId: '',
    runClip: '',
    runClipAssetId: '',
    jumpClip: '',
    jumpClipAssetId: '',
    airClip: '',
    airClipAssetId: '',
    landClip: '',
    landClipAssetId: '',
    dodgeClip: '',
    dodgeClipAssetId: '',
  }
}

export type CameraOrbit = 'none' | 'rightDrag' | 'mouse'

export interface CameraFollowSpec {
  enabled: boolean
  /** 最近套用的机位。手改参数后清空。 */
  preset?: CharacterMode | ''
  /** 跟随的物体。空着表示跟自己。旧场景里的名字只作兼容。 */
  targetId?: string
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
  /** 滚轮沿镜头臂拉近拉远。 */
  zoom: boolean
  zoomSpeed: number
  minDistance: number
  maxDistance: number
  /** 试玩里右键转出的水平角，度。空着表示开局跟编辑镜头。 */
  orbitYaw?: number
  /** 试玩里右键转出的俯仰角，度。空着表示开局跟编辑镜头。 */
  orbitPitch?: number
}

export function defaultCameraFollow(): CameraFollowSpec {
  return {
    enabled: true,
    targetId: '',
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
    zoom: true,
    zoomSpeed: 0.18,
    minDistance: 0.8,
    maxDistance: 18,
  }
}

export function cameraPresetForMode(mode: CharacterMode): Partial<CameraFollowSpec> {
  if (mode === 'strafe') return { offset: [0.65, 0.45, -2.2], pivot: [0, 1.5, 0], orbit: 'mouse', localOffset: false, lookAtTarget: true, fov: 55, collision: true }
  if (mode === 'lockOn') return { offset: [0.35, 2.2, -4.8], pivot: [0, 1.35, 0], orbit: 'rightDrag', localOffset: false, lookAtTarget: true, fov: 58, collision: true }
  if (mode === 'pointAndClick') return { offset: [0, 10.5, -7.2], pivot: [0, 0.8, 0], orbit: 'none', localOffset: false, lookAtTarget: true, fov: 48, collision: false }
  if (mode === 'topDown') return { offset: [0, 9.5, -6.5], pivot: [0, 0.8, 0], orbit: 'none', localOffset: false, lookAtTarget: true, fov: 50, collision: false }
  if (mode === 'side25d') return { offset: [0, 1.6, -7.5], pivot: [0, 1.2, 0], orbit: 'none', localOffset: false, lookAtTarget: true, fov: 45, collision: false }
  if (mode === 'firstPerson') return { offset: [0, 0, 0.12], pivot: [0, 1.65, 0], orbit: 'mouse', localOffset: false, lookAtTarget: false, fov: 72, collision: false, zoom: false, damping: 0, minPitch: -85, maxPitch: 85 }
  return { offset: [0, 1.8, -4.2], pivot: [0, 1.4, 0], orbit: 'rightDrag', localOffset: false, lookAtTarget: true, fov: 60, collision: true }
}

export function resolveCharacterCamera(character: CharacterSpec, raw?: Partial<CameraFollowSpec> | null): CameraFollowSpec {
  const mode = character.mode
  const preset = cameraPresetForMode(mode)
  const base = { ...defaultCameraFollow(), ...preset, ...raw, preset: mode }
  base.targetId = ''
  base.targetName = ''
  base.lookAtTarget = true
  if (mode === 'pointAndClick' || mode === 'topDown' || mode === 'side25d') {
    base.orbit = 'none'
    base.localOffset = false
    base.collision = false
    return base
  }
  if (mode === 'firstPerson') {
    base.orbit = 'mouse'
    base.localOffset = false
    base.collision = false
    base.zoom = false
    base.lookAtTarget = false
    base.damping = 0
    if (base.minPitch === -35 && base.maxPitch === 70) {
      base.minPitch = -85
      base.maxPitch = 85
    }
    // 眼睛高度只放在 pivot。旧预设又把同样的高度写进 offset，镜头会绕着头甩。
    if (base.offset[1] > 0.4 && Math.abs(base.offset[1] - base.pivot[1]) < 0.05) {
      base.offset = [base.offset[0], 0, base.offset[2]]
    }
    return base
  }
  if (mode === 'strafe') {
    base.orbit = 'mouse'
    // 朝向跟镜头走。若再把角色朝向加回镜头，越肩偏移会让两边互相追，镜头自己转个不停。
    base.localOffset = false
    return base
  }
  base.localOffset = false
  if (base.orbit === 'none') base.orbit = 'rightDrag'
  if (character.driver !== 'capsule' && character.clickButton === 'right' && base.orbit === 'rightDrag') {
    base.orbit = 'mouse'
  }
  return base
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

export type CoreRuleTriggerKind = 'playStart' | 'interact' | 'key' | 'message' | 'enter' | 'exit' | 'hit'
export type CoreRuleCondKind = 'always' | 'hasTag' | 'missingTag' | 'compare' | 'formula'
export type CoreRuleStepKind =
  | 'message' | 'setVar' | 'addTag' | 'removeTag' | 'wait' | 'waitFrame' | 'waitUpper' | 'waitMark'
  | 'playClip' | 'playUpper' | 'stance'
  | 'if' | 'gather' | 'each' | 'switchState'
  | 'showUi' | 'hideUi' | 'lock' | 'camera' | 'moveTo' | 'spawn' | 'hide' | 'score' | 'juice' | 'log'

export type RuleTriggerKind = CoreRuleTriggerKind | (string & {})
export type RuleCondKind = CoreRuleCondKind | (string & {})
export type RuleStepKind = CoreRuleStepKind | (string & {})

export interface RuleCondition {
  id: string
  kind: RuleCondKind
  tag: string
  left: string
  op: string
  right: string
}

export interface RuleStep {
  id: string
  do: RuleStepKind
  message: string
  name: string
  value: string
  tag: string
  seconds: number
  clip: string
  /** 片段所在的模型或动画资源。空着表示用物体自己的模型。 */
  clipAssetId: string
  stateId: string
  level: 'info' | 'warn' | 'error'
  conditions: RuleCondition[]
  steps: RuleStep[]
}

export interface RuleJump {
  id: string
  targetId: string
  conditions: RuleCondition[]
}

export interface RuleStateNode {
  id: string
  name: string
  children: RuleStateNode[]
  onEnter: RuleStep[]
  onTick: RuleStep[]
  onExit: RuleStep[]
  transitions: RuleJump[]
  /** 作为子状态时的进入条件。空表示可以进入。 */
  enter: RuleCondition[]
}

export interface RuleEntry {
  id: string
  name: string
  enabled: boolean
  trigger: RuleTriggerKind
  message: string
  key: string
  conditions: RuleCondition[]
  steps: RuleStep[]
}

const TRIGGERS: CoreRuleTriggerKind[] = ['playStart', 'interact', 'key', 'message', 'enter', 'exit', 'hit']
const CONDS: CoreRuleCondKind[] = ['always', 'hasTag', 'missingTag', 'compare', 'formula']
const STEPS: CoreRuleStepKind[] = [
  'message', 'setVar', 'addTag', 'removeTag', 'wait', 'waitFrame', 'waitUpper', 'waitMark',
  'playClip', 'playUpper', 'stance',
  'if', 'gather', 'each', 'switchState',
  'showUi', 'hideUi', 'lock', 'camera', 'moveTo', 'spawn', 'hide', 'score', 'juice', 'log',
]

export function isCoreTrigger(kind: string): kind is CoreRuleTriggerKind {
  return TRIGGERS.includes(kind as CoreRuleTriggerKind)
}

export function isCoreCondition(kind: string): kind is CoreRuleCondKind {
  return CONDS.includes(kind as CoreRuleCondKind)
}

export function isCoreStep(kind: string): kind is CoreRuleStepKind {
  return STEPS.includes(kind as CoreRuleStepKind)
}

export function emptyCondition(kind: RuleCondKind = 'hasTag'): RuleCondition {
  return { id: crypto.randomUUID(), kind, tag: '', left: '', op: '==', right: '' }
}

export function emptyStep(kind: RuleStepKind = 'message'): RuleStep {
  return {
    id: crypto.randomUUID(),
    do: kind,
    message: '',
    name: '',
    value: '0',
    tag: '',
    seconds: kind === 'wait' ? 0.5 : 0,
    clip: '',
    clipAssetId: '',
    stateId: '',
    level: 'info',
    conditions: kind === 'if' ? [emptyCondition('hasTag')] : [],
    steps: [],
  }
}

export function emptyRule(): RuleEntry {
  return {
    id: crypto.randomUUID(),
    name: '',
    enabled: true,
    trigger: 'playStart',
    message: '',
    key: 'KeyE',
    conditions: [],
    steps: [],
  }
}

export function emptyRuleState(name = ''): RuleStateNode {
  return {
    id: crypto.randomUUID(),
    name,
    children: [],
    onEnter: [],
    onTick: [],
    onExit: [],
    transitions: [],
    enter: [],
  }
}

export function readRules(raw: unknown): RuleEntry[] {
  if (!Array.isArray(raw)) return []
  return raw.map(normalizeRule).filter((rule): rule is RuleEntry => !!rule)
}

export function readRuleStates(raw: unknown): RuleStateNode[] {
  if (!Array.isArray(raw)) return []
  return raw.map(normalizeState).filter((node): node is RuleStateNode => !!node)
}

function normalizeRule(raw: unknown): RuleEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Partial<RuleEntry> & { cond?: RuleCondKind, tag?: string, left?: string, op?: string, right?: string }
  const legacy = item.cond && item.cond !== 'always'
    ? [emptyCondition(item.cond)]
    : []
  if (legacy[0] && item.cond) {
    legacy[0].tag = item.tag ?? ''
    legacy[0].left = item.left ?? ''
    legacy[0].op = item.op || '=='
    legacy[0].right = item.right ?? ''
  }
  return {
    id: item.id || crypto.randomUUID(),
    name: item.name ?? '',
    enabled: item.enabled !== false,
    trigger: typeof item.trigger === 'string' && item.trigger ? item.trigger : 'playStart',
    message: item.message ?? '',
    key: item.key || 'KeyE',
    conditions: Array.isArray(item.conditions) && item.conditions.length > 0 ? item.conditions.map(normalizeCondition) : legacy,
    steps: Array.isArray(item.steps) ? item.steps.map(normalizeStep) : [],
  }
}

function normalizeCondition(raw: unknown): RuleCondition {
  const item = (raw ?? {}) as Partial<RuleCondition>
  return {
    id: item.id || crypto.randomUUID(),
    kind: typeof item.kind === 'string' && item.kind ? item.kind : 'always',
    tag: item.tag ?? '',
    left: item.left ?? '',
    op: item.op || '==',
    right: item.right ?? '',
  }
}

function normalizeStep(raw: unknown): RuleStep {
  const item = (raw ?? {}) as Partial<RuleStep> & { cond?: RuleCondKind, left?: string, op?: string, right?: string }
  const kind = typeof item.do === 'string' && item.do ? item.do : 'message'
  const step = emptyStep(kind)
  step.id = item.id || step.id
  step.message = item.message ?? ''
  step.name = item.name ?? ''
  step.value = item.value ?? '0'
  step.tag = item.tag ?? ''
  step.seconds = Number.isFinite(item.seconds) ? Number(item.seconds) : step.seconds
  step.clip = item.clip ?? ''
  step.clipAssetId = item.clipAssetId ?? ''
  step.stateId = item.stateId ?? ''
  step.level = item.level === 'warn' || item.level === 'error' ? item.level : 'info'
  const legacy = item.do === 'if' && item.cond
    ? [{ ...emptyCondition(isCoreCondition(item.cond) ? item.cond : 'always'), tag: item.tag ?? '', left: item.left ?? '', op: item.op || '==', right: item.right ?? '' }]
    : []
  step.conditions = Array.isArray(item.conditions) && item.conditions.length > 0 ? item.conditions.map(normalizeCondition) : legacy
  step.steps = Array.isArray(item.steps) ? item.steps.map(normalizeStep) : []
  return step
}

function normalizeState(raw: unknown): RuleStateNode | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Partial<RuleStateNode>
  if (!item.id) return null
  return {
    id: item.id,
    name: item.name ?? '',
    children: Array.isArray(item.children) ? item.children.map(normalizeState).filter((node): node is RuleStateNode => !!node) : [],
    onEnter: Array.isArray(item.onEnter) ? item.onEnter.map(normalizeStep) : [],
    onTick: Array.isArray(item.onTick) ? item.onTick.map(normalizeStep) : [],
    onExit: Array.isArray(item.onExit) ? item.onExit.map(normalizeStep) : [],
    transitions: Array.isArray(item.transitions) ? item.transitions.map(jump => ({
      id: jump.id || crypto.randomUUID(),
      targetId: jump.targetId ?? '',
      conditions: Array.isArray(jump.conditions) ? jump.conditions.map(normalizeCondition) : [],
    })) : [],
    enter: Array.isArray(item.enter) ? item.enter.map(normalizeCondition) : [],
  }
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
  ruleStates?: RuleStateNode[]
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
  /** 自上次读取后积累的滚轮像素。读一次即清零。正值是向下滚。 */
  wheel?: () => number
  /** 从起点沿方向探测场景，返回最近交点距离。忽略 ignoreId。 */
  probe?: (origin: Vec3, direction: Vec3, max: number, ignoreId: string) => number | null
  /** 取走一次地面点击。没有则返回 null。 */
  consumeClick?: (button: 'left' | 'right') => Vec3 | null
  /** 当前鼠标在视口内的归一化坐标（[-1, 1]），供边缘滚屏、瞄准等玩法使用。 */
  pointerNormalized?: () => { x: number, y: number }
  /** 取走一次点击命中的节点与世界坐标（区分点中单位/建筑还是空地）。 */
  consumeNodeClick?: (button: 'left' | 'right') => { nodeId: string | null, point: Vec3 } | null
  /** 开启或关闭试玩态左键拉框选择（供策略/指挥类玩法包按需开启）。 */
  setPlayMarqueeEnabled?: (enabled: boolean) => void
  /** 取走试玩态最近一次左键拉框选中的节点 ID 列表。 */
  consumePlayMarquee?: () => { ids: string[], additive: boolean } | null
}

/**
 * 五阶段帧流水线顺序常量（供核心系统与社区扩展能力包对齐挂载阶段）：
 * - PrePhysics (0~49): 输入、移动平台、角色意图、跟随镜头、交互机关、律令、载具输入
 * - Physics & Nav (50): Rapier 物理世界与载具悬挂步进、Recast 导航网格步进
 * - Animation (60): AnimationMixer 关键帧骨骼动画推进
 * - PostAnimation (70): 骨骼后处理能力包（LookAt、Foot IK、SpringBone 头发衣物摆动、布娃娃混合）
 * - PreRender (80): 粒子系统、水体波浪与反射相机更新、体积云噪声推进
 */
export const RUNTIME_STAGE = {
  PRE_PHYSICS: 10,
  PHYSICS_NAV: 50,
  ANIMATION: 60,
  POST_ANIMATION: 70,
  PRE_RENDER: 80,
} as const

export type RuntimeSystemStep = (dt: number, host: SceneRuntimeHost) => void

const systems: Array<{ id: string, order: number, step: RuntimeSystemStep }> = []
const postAnimationSystems: Array<{ id: string, order: number, step: RuntimeSystemStep }> = []

export function registerRuntimeSystem(id: string, order: number, step: RuntimeSystemStep): () => void {
  const target = order >= RUNTIME_STAGE.POST_ANIMATION ? postAnimationSystems : systems
  const index = target.findIndex(item => item.id === id)
  if (index >= 0) target.splice(index, 1)
  target.push({ id, order, step })
  target.sort((a, b) => a.order - b.order)
  return () => {
    const idx = target.findIndex(item => item.id === id)
    if (idx >= 0) target.splice(idx, 1)
  }
}

/**
 * 统一场景运行时五阶段步进：
 * 1. PrePhysics：已注册的输入、角色、跟随相机、机关、律令与物理前能力包（order < 70）
 * 2. Physics & Nav：物理世界步进（Rapier + 物理扩展）与导航网格同步（Recast）
 * 3. Animation：骨骼关键帧动画混合器推进（AnimationMixer）
 * 4. PostAnimation：骨骼后处理与渲染前能力包（IK / SpringBone / LookAt / 水体更新，order >= 70）
 * 5. PreRender VFX：粒子系统模拟（Quarks）
 */
export function stepSceneRuntime(dt: number, host: SceneRuntimeHost) {
  const scaled = scalePlayDt(dt)
  for (const system of systems) {
    measureCost(system.id, () => system.step(scaled, host))
  }
  measureCost('physics', () => tickPhysics(scaled, host.resolveObject))
  measureCost('navigation', () => tickNavigation())
  if (host.ready) {
    measureCost('animation', () => host.updateAnimations(scaled))
    for (const system of postAnimationSystems) {
      measureCost(system.id, () => system.step(scaled, host))
    }
    measureCost('particles', () => tickParticles(scaled, host.resolveObject))
  }
}

export function hasGameplayComponent(node: SceneNode, key: keyof NodeGameplay): boolean {
  return Boolean(node.gameplay?.[key])
}
