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
  if (mode === 'strafe') return { offset: [0.65, 0.45, -2.2], pivot: [0, 1.5, 0], orbit: 'mouse', localOffset: true, lookAtTarget: true, fov: 55, collision: true }
  if (mode === 'lockOn') return { offset: [0.35, 2.2, -4.8], pivot: [0, 1.35, 0], orbit: 'rightDrag', localOffset: false, lookAtTarget: true, fov: 58, collision: true }
  if (mode === 'pointAndClick') return { offset: [0, 10.5, -7.2], pivot: [0, 0.8, 0], orbit: 'none', localOffset: false, lookAtTarget: true, fov: 48, collision: false }
  if (mode === 'topDown') return { offset: [0, 9.5, -6.5], pivot: [0, 0.8, 0], orbit: 'none', localOffset: false, lookAtTarget: true, fov: 50, collision: false }
  if (mode === 'side25d') return { offset: [0, 1.6, -7.5], pivot: [0, 1.2, 0], orbit: 'none', localOffset: false, lookAtTarget: true, fov: 45, collision: false }
  if (mode === 'firstPerson') return { offset: [0, 1.65, 0.15], pivot: [0, 1.65, 0], orbit: 'mouse', localOffset: false, lookAtTarget: true, fov: 72, collision: false, zoom: false }
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
    return base
  }
  if (mode === 'strafe') {
    base.orbit = 'mouse'
    base.localOffset = true
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

export type RuleTriggerKind = 'playStart' | 'interact' | 'key' | 'message' | 'enter' | 'exit' | 'hit'
export type RuleCondKind = 'always' | 'hasTag' | 'missingTag' | 'compare'
export type RuleStepKind = 'message' | 'setVar' | 'addTag' | 'removeTag' | 'wait' | 'playClip' | 'if' | 'switchState' | 'log'

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

const TRIGGERS: RuleTriggerKind[] = ['playStart', 'interact', 'key', 'message', 'enter', 'exit', 'hit']
const CONDS: RuleCondKind[] = ['always', 'hasTag', 'missingTag', 'compare']
const STEPS: RuleStepKind[] = ['message', 'setVar', 'addTag', 'removeTag', 'wait', 'playClip', 'if', 'switchState', 'log']

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
    trigger: TRIGGERS.includes(item.trigger as RuleTriggerKind) ? item.trigger as RuleTriggerKind : 'playStart',
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
    kind: CONDS.includes(item.kind as RuleCondKind) ? item.kind as RuleCondKind : 'always',
    tag: item.tag ?? '',
    left: item.left ?? '',
    op: item.op || '==',
    right: item.right ?? '',
  }
}

function normalizeStep(raw: unknown): RuleStep {
  const item = (raw ?? {}) as Partial<RuleStep> & { cond?: RuleCondKind, left?: string, op?: string, right?: string }
  const step = emptyStep(STEPS.includes(item.do as RuleStepKind) ? item.do as RuleStepKind : 'message')
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
    ? [{ ...emptyCondition(CONDS.includes(item.cond) ? item.cond : 'always'), tag: item.tag ?? '', left: item.left ?? '', op: item.op || '==', right: item.right ?? '' }]
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
