import RAPIER from '@dimforge/rapier3d-compat'
import type { PhysicsBodyDesc, PhysicsPose, PhysicsWorld } from './world'

const STEP = 1 / 60

interface LiveBody {
  body: RAPIER.RigidBody
  signature: string
  kind: PhysicsBodyDesc['body']
}

export async function createRapierWorld(): Promise<PhysicsWorld> {
  await RAPIER.init()
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
  world.timestep = STEP
  const bodies = new Map<string, LiveBody>()
  let accumulator = 0

  const api: PhysicsWorld = {
    setGravity(gravity) {
      world.gravity = { x: gravity[0], y: gravity[1], z: gravity[2] }
    },
    sync(next) {
      const seen = new Set<string>()
      for (const desc of next) {
        seen.add(desc.id)
        const signature = signatureOf(desc)
        let live = bodies.get(desc.id)
        if (!live || live.signature !== signature) {
          if (live) world.removeRigidBody(live.body)
          live = { body: createBody(world, desc), signature, kind: desc.body }
          bodies.set(desc.id, live)
        }
        if (desc.body !== 'dynamic') writePose(live.body, desc)
      }
      for (const [id, live] of bodies) {
        if (seen.has(id)) continue
        world.removeRigidBody(live.body)
        bodies.delete(id)
      }
    },
    step(dt) {
      accumulator = Math.min(accumulator + dt, STEP * 4)
      while (accumulator >= STEP) {
        world.step()
        accumulator -= STEP
      }
    },
    dynamicPoses() {
      const poses: PhysicsPose[] = []
      for (const [id, live] of bodies) {
        if (live.kind !== 'dynamic') continue
        const position = live.body.translation()
        const rotation = live.body.rotation()
        poses.push({
          id,
          position: [position.x, position.y, position.z],
          rotation: [rotation.x, rotation.y, rotation.z, rotation.w],
        })
      }
      return poses
    },
    dispose() {
      bodies.clear()
      world.free()
    },
  }
  return api
}

function createBody(world: RAPIER.World, desc: PhysicsBodyDesc): RAPIER.RigidBody {
  const bodyDesc = desc.body === 'dynamic'
    ? RAPIER.RigidBodyDesc.dynamic()
    : desc.body === 'kinematic'
      ? RAPIER.RigidBodyDesc.kinematicPositionBased()
      : RAPIER.RigidBodyDesc.fixed()
  bodyDesc
    .setTranslation(desc.position[0], desc.position[1], desc.position[2])
    .setRotation({ x: desc.rotation[0], y: desc.rotation[1], z: desc.rotation[2], w: desc.rotation[3] })
    .setLinearDamping(Math.max(0, desc.linearDamping))
    .setAngularDamping(Math.max(0, desc.angularDamping))
    .setGravityScale(desc.gravityScale)
  if (desc.body === 'dynamic') bodyDesc.setAdditionalMass(Math.max(0.001, desc.mass))
  const body = world.createRigidBody(bodyDesc)
  world.createCollider(colliderDesc(desc), body)
  return body
}

function colliderDesc(desc: PhysicsBodyDesc): RAPIER.ColliderDesc {
  const collider = shapeDesc(desc)
  collider.setSensor(desc.trigger)
  collider.setFriction(Math.max(0, desc.friction))
  collider.setRestitution(Math.max(0, desc.restitution))
  if (desc.collisionGroups !== undefined) collider.setCollisionGroups(desc.collisionGroups)
  return collider
}

function shapeDesc(desc: PhysicsBodyDesc): RAPIER.ColliderDesc {
  const sx = Math.max(0.001, desc.scale[0])
  const sy = Math.max(0.001, desc.scale[1])
  const sz = Math.max(0.001, desc.scale[2])
  if (desc.shape === 'sphere') {
    const radius = Math.max(0.001, desc.size[0]) * Math.max(sx, sy, sz)
    return RAPIER.ColliderDesc.ball(radius)
  }
  if (desc.shape === 'capsule') {
    const radius = Math.max(0.001, desc.size[0]) * Math.max(sx, sz)
    const height = Math.max(radius * 2 + 0.02, desc.size[1] * sy)
    const half = Math.max(0.001, height * 0.5 - radius)
    return RAPIER.ColliderDesc.capsule(half, radius)
  }
  return RAPIER.ColliderDesc.cuboid(
    Math.max(0.001, desc.size[0] * 0.5 * sx),
    Math.max(0.001, desc.size[1] * 0.5 * sy),
    Math.max(0.001, desc.size[2] * 0.5 * sz),
  )
}

function writePose(body: RAPIER.RigidBody, desc: PhysicsBodyDesc) {
  const translation = { x: desc.position[0], y: desc.position[1], z: desc.position[2] }
  const rotation = { x: desc.rotation[0], y: desc.rotation[1], z: desc.rotation[2], w: desc.rotation[3] }
  if (desc.body === 'kinematic') {
    body.setNextKinematicTranslation(translation)
    body.setNextKinematicRotation(rotation)
    return
  }
  body.setTranslation(translation, true)
  body.setRotation(rotation, true)
}

function signatureOf(desc: PhysicsBodyDesc): string {
  const n = (value: number) => value.toFixed(4)
  return [
    desc.body,
    desc.shape,
    desc.trigger ? 1 : 0,
    desc.size.map(n).join(','),
    desc.scale.map(n).join(','),
    n(desc.mass),
    n(desc.friction),
    n(desc.restitution),
    n(desc.linearDamping),
    n(desc.angularDamping),
    n(desc.gravityScale),
    desc.collisionGroups ?? 'all',
  ].join('|')
}
