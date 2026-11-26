/**
 * T3D 脚本与运行时接口契约（阶段 0 定稿）
 * 对应工程目录中的 `.t3d/runtime.d.ts`，供 AI、应用内检查器与外部编辑器使用。
 */

export interface Vec2 {
  x: number
  y: number
}

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface Vec4 {
  x: number
  y: number
  z: number
  w: number
}

export type ScriptParamSchema =
  | { type: 'number'; default: number; min?: number; max?: number; step?: number; label: string; unit?: string }
  | { type: 'boolean'; default: boolean; label: string }
  | { type: 'string'; default: string; label: string }
  | { type: 'color'; default: string; label: string }
  | { type: 'vec2'; default: readonly [number, number]; label: string }
  | { type: 'vec3'; default: readonly [number, number, number]; label: string }
  | { type: 'vec4'; default: readonly [number, number, number, number]; label: string }
  | { type: 'enum'; options: ReadonlyArray<{ value: string; label: string }>; default: string; label: string }
  | { type: 'texture'; default?: string; label: string }
  | { type: 'ref'; target: 'asset' | 'node' | 'tableRow' | 'clip'; kinds?: readonly string[]; tableId?: string; label: string }
  | { type: 'object'; fields: Record<string, ScriptParamSchema>; label?: string }
  | { type: 'list'; item: ScriptParamSchema; label: string }

export type ScriptParamMap = Record<string, ScriptParamSchema>

export type ScriptParamRuntimeValue<S extends ScriptParamSchema> =
  S['type'] extends 'number' ? number :
  S['type'] extends 'boolean' ? boolean :
  S['type'] extends 'string' ? string :
  S['type'] extends 'color' ? string :
  S['type'] extends 'enum' ? string :
  S['type'] extends 'vec2' ? Vec2 :
  S['type'] extends 'vec3' ? Vec3 :
  S['type'] extends 'vec4' ? Vec4 :
  S['type'] extends 'texture' ? string | null :
  S extends { type: 'ref'; target: 'node' } ? NodeHandle | null :
  S['type'] extends 'ref' ? string | null :
  S extends { type: 'list'; item: infer Item extends ScriptParamSchema } ? ReadonlyArray<ScriptParamRuntimeValue<Item>> :
  S extends { type: 'object'; fields: infer Fields extends Record<string, ScriptParamSchema> } ? {
    readonly [K in keyof Fields]: ScriptParamRuntimeValue<Fields[K]>
  } :
  unknown

export type ScriptParamValues<P extends ScriptParamMap> = {
  readonly [K in keyof P]: ScriptParamRuntimeValue<P[K]>
}

export type BehaviorState = Record<string, unknown>

export interface ScriptMessage {
  readonly name: string
  readonly payload?: unknown
  readonly sender?: NodeHandle
}

export interface RaycastHit {
  readonly node: NodeHandle
  readonly point: Vec3
  readonly normal: Vec3
  readonly distance: number
}

export interface CollisionInfo {
  readonly other: NodeHandle
  readonly point: Vec3
  readonly normal: Vec3
  readonly relativeSpeed: number
}

export interface NodeHandle {
  readonly id: string
  readonly name: string
  readonly tags: readonly string[]
  readonly parent: NodeHandle | null
  position: Vec3
  /** 欧拉角（弧度） */
  rotation: Vec3
  scale: Vec3
  visible: boolean
  hasTag(tag: string): boolean
  addTag(tag: string): void
  removeTag(tag: string): void
  getChildren(): readonly NodeHandle[]
  sendMessage(name: string, payload?: unknown): void
  getBehavior<
    P extends ScriptParamMap,
    S extends BehaviorState,
    M extends BehaviorMethodMap<P, S>,
  >(behavior: BehaviorAsset<P, S, M>): BehaviorInstance<M> | null
  destroy(): void
}

export interface CloneNodeOptions {
  position?: Vec3
  /** 欧拉角（弧度） */
  rotation?: Vec3
  scale?: Vec3
  parent?: NodeHandle | string | null
  visible?: boolean
  name?: string
  initMessage?: string
  initPayload?: unknown
}

export interface PoolAcquireOptions {
  position?: Vec3
  /** 欧拉角（弧度） */
  rotation?: Vec3
  scale?: Vec3
  payload?: unknown
}

export interface PoolStats {
  active: number
  pooled: number
  total: number
}

export interface PoolApi {
  preload(templateOrPrefab: string | NodeHandle, count: number): void
  acquire(templateOrPrefab: string | NodeHandle, options?: PoolAcquireOptions): NodeHandle | null
  release(node: NodeHandle): void
  stats(templateOrPrefab?: string | NodeHandle): PoolStats
}

export type EasingName =
  | 'linear'
  | 'inQuad'
  | 'outQuad'
  | 'inOutQuad'
  | 'inCubic'
  | 'outCubic'
  | 'inOutCubic'
  | 'inOutSine'
  | 'outBack'
  | 'inOutBack'
  | 'outBounce'
  | 'outElastic'

export type CurveKeyInput =
  | readonly [number, number]
  | { t: number; v: number; mode?: 'linear' | 'smooth' | 'step' }

export interface AnimationCurve {
  eval(t: number): number
}

export interface CurveApi {
  create(keys: readonly CurveKeyInput[], options?: { wrap?: 'clamp' | 'loop' | 'pingPong' }): AnimationCurve
  eval(keys: readonly CurveKeyInput[], t: number, options?: { wrap?: 'clamp' | 'loop' | 'pingPong' }): number
  ease(name: EasingName, t: number): number
  parabola(t: number, height?: number): number
  pulse(t: number): number
}

export type SplinePointsInput =
  | string
  | NodeHandle
  | ReadonlyArray<Vec3 | NodeHandle>

export interface SplinePath {
  readonly length: number
  readonly closed: boolean
  readonly points: readonly Vec3[]
  pointAt(t: number): Vec3
  tangentAt(t: number): Vec3
  pointAtDistance(distance: number): Vec3
  tangentAtDistance(distance: number): Vec3
}

export interface SplineFollowOptions {
  speed?: number
  closed?: boolean
  tension?: number
  loop?: boolean
  pingPong?: boolean
  faceDirection?: boolean
  planeXZ?: boolean
  startProgress?: number
  onArrive?: () => void
}

export interface SplineApi {
  create(pointsOrParent: SplinePointsInput, options?: { closed?: boolean; tension?: number }): SplinePath
  follow(pointsOrParent: SplinePointsInput | SplinePath, options?: SplineFollowOptions): boolean
  stop(): void
  readonly isFollowing: boolean
  readonly progress: number
}

export interface TweenOptions {
  ease?: EasingName
  delay?: number
  repeat?: number
  yoyo?: boolean
  onUpdate?: (progress: number) => void
  onComplete?: () => void
}

export interface TweenTargetProps {
  position?: Vec3
  rotation?: Vec3
  scale?: Vec3
}

export interface TweenApi {
  to(target: NodeHandle | TweenTargetProps, props: TweenTargetProps, duration: number, options?: TweenOptions): number
  value(from: number, to: number, duration: number, onUpdate: (val: number) => void, options?: TweenOptions): number
  punchScale(strength?: number, duration?: number): number
  shakePosition(intensity?: number, duration?: number): number
  cancel(tweenId: number): void
  cancelAll(): void
}

export interface PhysicsApi {
  raycast(origin: Vec3, direction: Vec3, maxDistance: number, options?: { ignoreTags?: readonly string[] }): RaycastHit | null
  sphereCast(center: Vec3, radius: number, options?: { tag?: string }): readonly NodeHandle[]
  getVelocity(): Vec3
  setVelocity(velocity: Vec3): void
  applyImpulse(impulse: Vec3): void
  applyForce(force: Vec3): void
}

export interface NavApi {
  moveTo(target: Vec3, speed?: number): boolean
  stop(): void
  readonly isMoving: boolean
}

export interface CrowdApi {
  moveTo(target: Vec3, options?: { speed?: number; arriveDist?: number; onArrive?: () => void }): void
  stop(): void
  readonly isMoving: boolean
  formation(
    units: readonly (NodeHandle | string)[],
    center: Vec3,
    options?: {
      formation?: 'line' | 'grid' | 'wedge' | 'circle'
      spacing?: number
      facingYaw?: number
      speed?: number
      arriveDist?: number
    },
  ): void
  stats(): { total: number; moving: number }
}

export interface ProjectileLaunchOptions {
  direction?: Vec3
  target?: NodeHandle | string | null
  owner?: NodeHandle | string | null
  mode?: 'linear' | 'homing' | 'ballistic'
  speed?: number
  gravity?: number
  turnRate?: number
  maxLifetime?: number
  hitRadius?: number
  targetTag?: string
  damage?: number
  destroyOnHit?: boolean
  onHit?: (hitNode: NodeHandle | null, pos: Vec3) => void
}

export interface ProjectileApi {
  launch(options?: ProjectileLaunchOptions): void
  reset(): void
}

export interface SystemCrowdApi {
  moveTo(node: NodeHandle | string, target: Vec3, options?: { speed?: number; arriveDist?: number; onArrive?: () => void }): void
  stop(node: NodeHandle | string): void
  formation(
    units: readonly (NodeHandle | string)[],
    center: Vec3,
    options?: {
      formation?: 'line' | 'grid' | 'wedge' | 'circle'
      spacing?: number
      facingYaw?: number
      speed?: number
      arriveDist?: number
    },
  ): void
  stats(): { total: number; moving: number }
}

export interface SystemProjectileApi {
  launch(node: NodeHandle | string, options?: ProjectileLaunchOptions): void
  reset(node: NodeHandle | string): void
}

export interface AnimApi {
  playBody(clipName: string, options?: { loop?: boolean; fade?: number; speed?: number }): void
  playUpper(clipName: string, options?: { loop?: boolean; fade?: number; speed?: number }): void
  stopUpper(fade?: number): void
}

export interface CutsceneApi {
  play(nameOrId: string, options?: { loop?: boolean; speed?: number; startTime?: number; onComplete?: () => void }): boolean
  stop(nameOrId?: string): void
  isPlaying(nameOrId?: string): boolean
}

export interface AudioApi {
  playSfx(assetId: string, options?: { volume?: number; pitch?: number; position?: Vec3 }): void
  playBgm(assetId: string, options?: { volume?: number; loop?: boolean }): void
  stopBgm(fadeSeconds?: number): void
}

export interface FxApi {
  spawn(effectId: string, position: Vec3, options?: { scale?: number; autoDestroySec?: number }): void
}

export interface InputApi {
  isPressed(action: string): boolean
  justPressed(action: string): boolean
  isKeyPressed(code: string): boolean
  justReleased(action: string): boolean
  axis1D(action: string): number
  axis2D(action: string): Vec2
  /** 相对当前观察相机的世界水平移动方向（y 恒为 0，长度为输入强度 0~1）。W 即画面里的「远处」 */
  moveDirection(action?: string): Vec3
  pointerDelta(): Vec2
  pointerPosition(): Vec2
  wheelDelta(): number
  isMouseButtonPressed(button: 0 | 1 | 2): boolean
  justPressedMouseButton(button: 0 | 1 | 2): boolean
  justReleasedMouseButton(button: 0 | 1 | 2): boolean
}

export interface UiScreenPoint {
  /** 屏幕像素 X（相对视口左上角） */
  x: number
  /** 屏幕像素 Y（相对视口左上角） */
  y: number
  /** 归一化坐标 [-1, 1] */
  ndcX: number
  ndcY: number
  /** 是否在相机前方且处于视口内 */
  visible: boolean
}

export interface UiApi {
  getVar<T = unknown>(key: string): T | undefined
  setVar(key: string, value: unknown): void
  onEvent(eventName: string, handler: (payload?: unknown) => void): () => void
  showScreen(screenIdOrName: string): void
  hideScreen(screenIdOrName: string): void
  toggleScreen(screenIdOrName: string): void
  isScreenVisible(screenIdOrName: string): boolean
  worldToScreen(position: Vec3 | NodeHandle): UiScreenPoint | null
}

export interface SceneApi {
  currentId(): string
  load(sceneId: string, options?: { spawnPoint?: string }): void
}

export interface KeyValueStoreApi {
  get<T = unknown>(key: string): T | undefined
  set(key: string, value: unknown): void
  remove(key: string): void
}

export interface TableApi {
  getRow<T = Record<string, unknown>>(tableId: string, rowId: string): T | null
}

export interface ScriptContext<
  P extends ScriptParamMap = ScriptParamMap,
  S extends BehaviorState = BehaviorState,
> {
  readonly node: NodeHandle
  readonly params: ScriptParamValues<P>
  readonly state: S
  readonly elapsedTime: number

  position: Vec3
  rotation: Vec3
  scale: Vec3
  visible: boolean
  /** 当前脚本开关是否启用 */
  readonly enabled: boolean
  hasTag(tag: string): boolean
  addTag(tag: string): void
  removeTag(tag: string): void
  readonly forward: Vec3
  readonly right: Vec3

  distanceTo(target: Vec3 | NodeHandle): number
  directionTo(target: Vec3 | NodeHandle, options?: { planeXZ?: boolean }): Vec3
  translate(delta: Vec3, space?: 'local' | 'world'): void
  rotateY(radians: number): void
  moveToward(target: Vec3 | NodeHandle, maxDistance: number, options?: { faceTarget?: boolean; planeXZ?: boolean }): boolean
  lookAt(target: Vec3 | NodeHandle, options?: { yOnly?: boolean }): void
  sendMessage(name: string, payload?: unknown): void
  broadcast(name: string, payload?: unknown): void
  getBehavior<
    OP extends ScriptParamMap,
    OS extends BehaviorState,
    OM extends BehaviorMethodMap<OP, OS>,
  >(behavior: BehaviorAsset<OP, OS, OM>): BehaviorInstance<OM> | null

  findNodeById(id: string): NodeHandle | null
  findNodesByTag(tag: string): readonly NodeHandle[]
  findNodesInRadius(center: Vec3, radius: number, tag?: string): readonly NodeHandle[]
  cloneNode(templateOrName: string | NodeHandle, options?: CloneNodeOptions): NodeHandle | null
  spawnPrefab(prefabId: string, options?: { position?: Vec3; rotation?: Vec3; name?: string }): NodeHandle | null
  destroyNode(node: NodeHandle): void
  readonly pool: PoolApi

  after(seconds: number, callback: () => void): number
  every(seconds: number, callback: () => void): number
  cancelTimer(timerId: number): void

  readonly physics: PhysicsApi
  readonly nav: NavApi
  readonly spline: SplineApi
  readonly tween: TweenApi
  readonly curve: CurveApi
  readonly crowd: CrowdApi
  readonly projectile: ProjectileApi
  readonly anim: AnimApi
  readonly cutscene: CutsceneApi
  readonly audio: AudioApi
  readonly fx: FxApi
  readonly input: InputApi
  readonly ui: UiApi
  readonly scene: SceneApi
  readonly global: KeyValueStoreApi
  readonly storage: KeyValueStoreApi
  readonly tables: TableApi

  log(...args: unknown[]): void
  warn(...args: unknown[]): void
}

export type BehaviorMethod<
  P extends ScriptParamMap,
  S extends BehaviorState,
  Args extends unknown[] = any[],
  Ret = any,
> = (self: ScriptContext<P, S>, ...args: Args) => Ret

export type BehaviorMethodMap<
  P extends ScriptParamMap = ScriptParamMap,
  S extends BehaviorState = BehaviorState,
> = Record<string, BehaviorMethod<P, S, any[], any>>

export type BehaviorInstance<M extends BehaviorMethodMap<any, any>> = {
  readonly [K in keyof M]: M[K] extends (self: any, ...args: infer Args) => infer Ret
    ? (...args: Args) => Ret
    : never
}

export interface GizmoDrawOptions {
  color?: string
}

export interface GizmosApi {
  readonly isSelected: boolean
  line(from: Vec3 | NodeHandle, to: Vec3 | NodeHandle, opts?: GizmoDrawOptions): void
  arrow(from: Vec3 | NodeHandle, dir: Vec3, length?: number, opts?: GizmoDrawOptions): void
  wireSphere(center: Vec3 | NodeHandle, radius: number, opts?: GizmoDrawOptions): void
  wireBox(center: Vec3 | NodeHandle, size: Vec3, opts?: GizmoDrawOptions): void
  disc(center: Vec3 | NodeHandle, radius: number, opts?: GizmoDrawOptions & { normal?: Vec3 }): void
  radiusHandle(paramKey: string, opts?: GizmoDrawOptions & { center?: Vec3 | NodeHandle; axis?: 'x' | 'y' | 'z' }): void
  positionHandle(paramKey: string, opts?: GizmoDrawOptions): void
}

export interface BehaviorDefinition<
  P extends ScriptParamMap = ScriptParamMap,
  S extends BehaviorState = BehaviorState,
  M extends BehaviorMethodMap<NoInfer<P>, NoInfer<S>> = BehaviorMethodMap<NoInfer<P>, NoInfer<S>>,
> {
  name: string
  description?: string
  params?: P
  createState?: () => S
  onStart?(self: ScriptContext<NoInfer<P>, NoInfer<S>>): void
  /** 脚本启用时调用（首次在 onStart 之后执行；关闭后重新开启时也会调用，不再重复 onStart） */
  onEnable?(self: ScriptContext<NoInfer<P>, NoInfer<S>>): void
  /** 脚本关闭或销毁前调用（可用于暂停物理速度、声音或还原临时状态） */
  onDisable?(self: ScriptContext<NoInfer<P>, NoInfer<S>>): void
  onSpawn?(self: ScriptContext<NoInfer<P>, NoInfer<S>>, payload?: unknown): void
  onStep?(self: ScriptContext<NoInfer<P>, NoInfer<S>>, dt: number): void
  onTriggerEnter?(self: ScriptContext<NoInfer<P>, NoInfer<S>>, other: NodeHandle): void
  onTriggerExit?(self: ScriptContext<NoInfer<P>, NoInfer<S>>, other: NodeHandle): void
  onCollision?(self: ScriptContext<NoInfer<P>, NoInfer<S>>, hit: CollisionInfo): void
  onMessage?(self: ScriptContext<NoInfer<P>, NoInfer<S>>, message: ScriptMessage): void
  onDestroy?(self: ScriptContext<NoInfer<P>, NoInfer<S>>): void
  /** 仅在编辑器停止状态下绘制辅助线与交互手柄；试玩态及导出包中不执行 */
  onDrawGizmos?(self: ScriptContext<NoInfer<P>, NoInfer<S>>, gizmos: GizmosApi): void
  methods?: M
}

export interface BehaviorAsset<
  P extends ScriptParamMap = ScriptParamMap,
  S extends BehaviorState = BehaviorState,
  M extends BehaviorMethodMap<P, S> = BehaviorMethodMap<P, S>,
> {
  readonly __t3dKind: 'behavior'
  readonly definition: BehaviorDefinition<P, S, M>
}

export function defineBehavior<
  P extends ScriptParamMap = Record<string, never>,
  S extends BehaviorState = Record<string, unknown>,
  M extends BehaviorMethodMap<NoInfer<P>, NoInfer<S>> = BehaviorMethodMap<NoInfer<P>, NoInfer<S>>,
>(
  definition: BehaviorDefinition<P, S, M>,
): BehaviorAsset<P, S, M>

// --- 运行时系统（defineSystem）---

export type RuntimeStageName = 'prePhysics' | 'postAnimation' | 'preRender'

export interface SystemWorldApi {
  readonly elapsedTime: number
  findNodeById(id: string): NodeHandle | null
  findNodesByTag(tag: string): readonly NodeHandle[]
  findNodesInRadius(center: Vec3, radius: number, tag?: string): readonly NodeHandle[]
  cloneNode(templateOrName: string | NodeHandle, options?: CloneNodeOptions): NodeHandle | null
  spawnPrefab(prefabId: string, options?: { position?: Vec3; rotation?: Vec3; name?: string }): NodeHandle | null
  destroyNode(node: NodeHandle): void
  readonly pool: PoolApi
  broadcast(name: string, payload?: unknown): void
  after(seconds: number, callback: () => void): number
  every(seconds: number, callback: () => void): number
  cancelTimer(timerId: number): void
  readonly curve: CurveApi
  readonly crowd: SystemCrowdApi
  readonly projectile: SystemProjectileApi
  readonly cutscene: CutsceneApi
  readonly input: InputApi
  readonly ui: UiApi
  readonly scene: SceneApi
  readonly global: KeyValueStoreApi
  readonly storage: KeyValueStoreApi
  readonly tables: TableApi
  log(...args: unknown[]): void
  warn(...args: unknown[]): void
}

export interface SystemDefinition<S extends BehaviorState = BehaviorState> {
  name: string
  description?: string
  stage?: RuntimeStageName | 'postPhysics'
  order?: number
  createState?: () => S
  state?: () => S
  onMount?(world: SystemWorldApi, state: S): void
  onInit?(world: SystemWorldApi, state: S): void
  onStep?(world: SystemWorldApi, state: S, dt: number): void
  onUpdate?(world: SystemWorldApi, state: S, dt: number): void
  onDispose?(world: SystemWorldApi, state: S): void
  onDestroy?(world: SystemWorldApi, state: S): void
}

export interface SystemAsset<S extends BehaviorState = BehaviorState> {
  readonly __t3dKind: 'system'
  readonly definition: SystemDefinition<S>
}

export function defineSystem<S extends BehaviorState = Record<string, unknown>>(
  definition: SystemDefinition<S>,
): SystemAsset<S>
