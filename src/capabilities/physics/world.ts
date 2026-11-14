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
}

export interface PhysicsPose {
  id: string
  position: Vec3
  rotation: [number, number, number, number]
}

/** 试玩循环只依赖这个接口。具体库留在各自的实现文件里。 */
export interface PhysicsWorld {
  setGravity(gravity: Vec3): void
  sync(bodies: PhysicsBodyDesc[]): void
  step(dt: number): void
  dynamicPoses(): PhysicsPose[]
  dispose(): void
}
