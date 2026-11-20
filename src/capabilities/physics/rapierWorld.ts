import RAPIER from '@dimforge/rapier3d-compat'
import type { CharacterMove, CharacterMoveResult, PhysicsBodyDesc, PhysicsDynamicBodyState, PhysicsPose, PhysicsWorld } from './world'

const STEP = 1 / 60
const CLIMB = 46 * Math.PI / 180
const SLIDE = 50 * Math.PI / 180

interface BodyData {
  id: string
  platform: [number, number, number]
}

interface LiveBody {
  body: RAPIER.RigidBody
  signature: string
  kind: PhysicsBodyDesc['body']
  prev: [number, number, number]
}

interface Puppet {
  body: RAPIER.RigidBody
  collider: RAPIER.Collider
  radius: number
  height: number
}

export async function createRapierWorld(): Promise<PhysicsWorld> {
  await RAPIER.init()
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
  world.timestep = STEP
  const bodies = new Map<string, LiveBody>()
  const puppets = new Map<string, Puppet>()
  let accumulator = 0
  const controller = world.createCharacterController(0.03)
  controller.setUp({ x: 0, y: 1, z: 0 })
  controller.setSlideEnabled(true)
  controller.enableAutostep(0.3, 0.18, true)
  controller.enableSnapToGround(0.25)
  controller.setMaxSlopeClimbAngle(CLIMB)
  controller.setMinSlopeSlideAngle(SLIDE)

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
          live = {
            body: createBody(world, desc),
            signature,
            kind: desc.body,
            prev: [desc.position[0], desc.position[1], desc.position[2]],
          }
          bodies.set(desc.id, live)
        }
        if (desc.body !== 'dynamic') writePose(live.body, desc)
        const data = bodyData(live.body)
        if (desc.body === 'kinematic') {
          data.platform = [
            desc.position[0] - live.prev[0],
            desc.position[1] - live.prev[1],
            desc.position[2] - live.prev[2],
          ]
          live.prev = [desc.position[0], desc.position[1], desc.position[2]]
        } else {
          data.platform = [0, 0, 0]
        }
      }
      for (const [id, live] of bodies) {
        if (seen.has(id)) continue
        world.removeRigidBody(live.body)
        bodies.delete(id)
      }
    },
    step(dt, beforeSubstep) {
      accumulator = Math.min(accumulator + dt, STEP * 4)
      while (accumulator >= STEP) {
        // Rapier 的 addForce / addForceAtPoint / addTorque 是持久力，step() 不会自动清零；
        // 每个子步前必须先清空，否则每帧叠加且离开水面后依然受力飞走。
        for (const live of bodies.values()) {
          if (live.kind !== 'dynamic') continue
          live.body.resetForces(false)
          live.body.resetTorques(false)
        }
        beforeSubstep?.(STEP)
        world.step()
        accumulator -= STEP
      }
    },
    moveCharacters(moves) {
      const seen = new Set<string>()
      const results: CharacterMoveResult[] = []
      for (const move of moves) {
        seen.add(move.id)
        const puppet = ensurePuppet(world, puppets, move)
        const half = capsuleHalf(puppet.height, puppet.radius)
        puppet.body.setTranslation({
          x: move.position[0],
          y: move.position[1] + half + puppet.radius,
          z: move.position[2],
        }, true)
        controller.computeColliderMovement(
          puppet.collider,
          { x: move.displacement[0], y: move.displacement[1], z: move.displacement[2] },
          undefined,
          undefined,
          collider => {
            const id = (collider.parent()?.userData as BodyData | undefined)?.id
            return id !== move.id
          },
        )
        const computed = controller.computedMovement()
        const grounded = controller.computedGrounded()
        let x = move.position[0] + computed.x
        let y = move.position[1] + computed.y
        let z = move.position[2] + computed.z
        if (grounded) {
          const count = controller.numComputedCollisions()
          for (let i = 0; i < count; i += 1) {
            const hit = controller.computedCollision(i)
            const data = hit?.collider?.parent()?.userData as BodyData | undefined
            if ((hit?.normal1.y ?? 0) <= 0.55 || !data?.platform) continue
            x += data.platform[0]
            y += data.platform[1]
            z += data.platform[2]
            break
          }
        }
        puppet.body.setNextKinematicTranslation({ x, y: y + half + puppet.radius, z })
        results.push({ id: move.id, position: [x, y, z], grounded })
      }
      for (const [id, puppet] of puppets) {
        if (seen.has(id)) continue
        world.removeRigidBody(puppet.body)
        puppets.delete(id)
      }
      return results
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
    bodyState(id): PhysicsDynamicBodyState | null {
      const live = bodies.get(id)
      if (!live || live.kind !== 'dynamic') return null
      const position = live.body.translation()
      const rotation = live.body.rotation()
      const linvel = live.body.linvel()
      const angvel = live.body.angvel()
      return {
        id,
        position: [position.x, position.y, position.z],
        rotation: [rotation.x, rotation.y, rotation.z, rotation.w],
        linvel: [linvel.x, linvel.y, linvel.z],
        angvel: [angvel.x, angvel.y, angvel.z],
        mass: live.body.mass(),
      }
    },
    applyForceAtPoint(id, force, worldPoint) {
      const live = bodies.get(id)
      if (!live || live.kind !== 'dynamic') return
      live.body.addForceAtPoint(
        { x: force[0], y: force[1], z: force[2] },
        { x: worldPoint[0], y: worldPoint[1], z: worldPoint[2] },
        true,
      )
    },
    applyTorque(id, torque) {
      const live = bodies.get(id)
      if (!live || live.kind !== 'dynamic') return
      live.body.addTorque({ x: torque[0], y: torque[1], z: torque[2] }, true)
    },
    dispose() {
      controller.free()
      puppets.clear()
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
  body.userData = { id: desc.id, platform: [0, 0, 0] } satisfies BodyData
  world.createCollider(colliderDesc(desc), body)
  return body
}

function bodyData(body: RAPIER.RigidBody): BodyData {
  const data = body.userData as BodyData | undefined
  if (data) return data
  const created: BodyData = { id: '', platform: [0, 0, 0] }
  body.userData = created
  return created
}

function capsuleHalf(height: number, radius: number): number {
  return Math.max(0.02, height * 0.5 - radius)
}

function ensurePuppet(world: RAPIER.World, puppets: Map<string, Puppet>, move: CharacterMove): Puppet {
  const radius = Math.max(0.05, move.radius)
  const height = Math.max(radius * 2 + 0.08, move.height)
  const current = puppets.get(move.id)
  if (current && Math.abs(current.radius - radius) < 0.001 && Math.abs(current.height - height) < 0.001) return current
  if (current) world.removeRigidBody(current.body)
  const half = capsuleHalf(height, radius)
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
    move.position[0],
    move.position[1] + half + radius,
    move.position[2],
  ))
  body.userData = { id: move.id, platform: [0, 0, 0] } satisfies BodyData
  const collider = world.createCollider(RAPIER.ColliderDesc.capsule(half, radius).setFriction(0), body)
  const puppet = { body, collider, radius, height }
  puppets.set(move.id, puppet)
  return puppet
}

function scaledPositions(source: Float32Array, sx: number, sy: number, sz: number): Float32Array {
  if (Math.abs(sx - 1) < 1e-4 && Math.abs(sy - 1) < 1e-4 && Math.abs(sz - 1) < 1e-4) return source
  const scaled = new Float32Array(source.length)
  for (let i = 0; i < source.length; i += 3) {
    scaled[i] = source[i]! * sx
    scaled[i + 1] = source[i + 1]! * sy
    scaled[i + 2] = source[i + 2]! * sz
  }
  return scaled
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
  if (desc.shape === 'cylinder' || desc.shape === 'cone') {
    const radius = Math.max(0.001, desc.size[0]) * Math.max(sx, sz)
    const half = Math.max(0.001, desc.size[1] * sy * 0.5)
    return desc.shape === 'cylinder'
      ? RAPIER.ColliderDesc.cylinder(half, radius)
      : RAPIER.ColliderDesc.cone(half, radius)
  }
  if (desc.shape === 'convex' && desc.mesh && desc.mesh.positions.length >= 12) {
    const hull = RAPIER.ColliderDesc.convexHull(scaledPositions(desc.mesh.positions, sx, sy, sz))
    if (hull) return hull
  }
  if (desc.shape === 'trimesh' && desc.mesh && desc.mesh.indices.length >= 3) {
    const flags = RAPIER.TriMeshFlags.MERGE_DUPLICATE_VERTICES
      | RAPIER.TriMeshFlags.DELETE_DEGENERATE_TRIANGLES
      | RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES
    return RAPIER.ColliderDesc.trimesh(scaledPositions(desc.mesh.positions, sx, sy, sz), desc.mesh.indices, flags)
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
    desc.mesh?.key ?? '',
  ].join('|')
}
