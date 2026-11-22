import type { ColliderShape, PhysicsBodyKind, Vec3 } from '../../editor/scene/types'

export interface PhysicsBodyDesc {
  id: string
  body: PhysicsBodyKind
  shape: ColliderShape
  size: Vec3
  position: Vec3
  /** 四元数 x y z w。 */
  rotation: [number, number, number, number]
  scale: Vec3
  trigger: boolean
  mass: number
  friction: number
  restitution: number
  linearDamping: number
  angularDamping: number
  gravityScale: number
  /** Rapier 交互组。缺省表示与所有层相撞。 */
  collisionGroups?: number
  /** 凸包和三角网格使用。顶点在刚体局部空间。 */
  mesh?: { key: string, positions: Float32Array, indices: Uint32Array }
}

export interface PhysicsPose {
  id: string
  position: Vec3
  rotation: [number, number, number, number]
}

export interface PhysicsDynamicBodyState extends PhysicsPose {
  linvel: Vec3
  angvel: Vec3
  mass: number
}

/** 胶囊角色这一帧想走的位移。position 是脚底。 */
export interface CharacterMove {
  id: string
  position: Vec3
  displacement: Vec3
  radius: number
  height: number
  dt?: number
  /**
   * 是否与动态刚体双向交互（推开、踩压、随平台移动）。默认 false。
   * 只要有角色开着，物理世界就改为按渲染帧时长推进，否则用固定 1/60 步长。
   */
  interact?: boolean
  /** 角色质量 (kg)，用于踩重、推力与抗撞击。 */
  mass?: number
  /** 推力倍率。 */
  pushStrength?: number
}

export interface CharacterMoveResult {
  id: string
  position: Vec3
  grounded: boolean
  /** 站在旋转动态平台（如浮力木筏）上带动的偏航角变化 (rad)。 */
  yawDelta?: number
  /** 被动态刚体撞击产生的瞬时速度增量 (m/s)。 */
  impulse?: Vec3
}

/** 试玩循环只依赖这个接口。具体库留在各自的实现文件里。 */
export interface PhysicsWorld {
  setGravity(gravity: Vec3): void
  sync(bodies: PhysicsBodyDesc[]): void
  step(dt: number, beforeSubstep?: (subDt: number) => void): void
  dynamicPoses(): PhysicsPose[]
  /** 读取动态刚体的当前位姿、线速度、角速度与总质量（不存在或非动态刚体返回 null）。 */
  bodyState(id: string): PhysicsDynamicBodyState | null
  /** 在世界坐标 point 处对动态刚体施加持续力（牛顿），会产生浮力与倾斜力矩。 */
  applyForceAtPoint(id: string, force: Vec3, worldPoint: Vec3): void
  /** 对动态刚体施加力矩（牛顿·米），用于水中角阻尼。 */
  applyTorque(id: string, torque: Vec3): void
  /** 直接设置动态刚体线速度。 */
  setLinearVelocity(id: string, velocity: Vec3): void
  /** 对动态刚体施加瞬时冲量。 */
  applyImpulse(id: string, impulse: Vec3): void
  /** 运动学胶囊贴着碰撞体走。陡坡会滑下，站在运动学平台上会跟着平台。 */
  moveCharacters(moves: CharacterMove[]): CharacterMoveResult[]
  dispose(): void
}
