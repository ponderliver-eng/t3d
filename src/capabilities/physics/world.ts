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

/** 胶囊角色这一帧想走的位移。position 是脚底。 */
export interface CharacterMove {
  id: string
  position: Vec3
  displacement: Vec3
  radius: number
  height: number
}

export interface CharacterMoveResult {
  id: string
  position: Vec3
  grounded: boolean
}

/** 试玩循环只依赖这个接口。具体库留在各自的实现文件里。 */
export interface PhysicsWorld {
  setGravity(gravity: Vec3): void
  sync(bodies: PhysicsBodyDesc[]): void
  step(dt: number): void
  dynamicPoses(): PhysicsPose[]
  /** 运动学胶囊贴着碰撞体走。陡坡会滑下，站在运动学平台上会跟着平台。 */
  moveCharacters(moves: CharacterMove[]): CharacterMoveResult[]
  dispose(): void
}
