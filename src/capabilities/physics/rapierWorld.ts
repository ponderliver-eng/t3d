import RAPIER from '@dimforge/rapier3d-compat'
import { Quaternion, Vector3 } from 'three'
import type { Vec3 } from '../../editor/scene/types'
import type { CharacterMove, CharacterMoveResult, PhysicsBodyDesc, PhysicsDynamicBodyState, PhysicsPose, PhysicsWorld } from './world'

/** 单个物理子步的最长时长。帧时长超过它就拆成等长的多个子步。 */
const STEP = 1 / 60
/** 一帧最多推进的时长，卡顿后不追帧。 */
const MAX_FRAME = STEP * 4
/** 短于这个时长的帧先攒着，避免极小步长带来的数值问题。 */
const MIN_STEP = 1 / 480
const CLIMB = 46 * Math.PI / 180
const SLIDE = 50 * Math.PI / 180
/** 角色控制器与碰撞体之间保留的间隙。 */
const SKIN = 0.03
/** 接地后向下找支撑体的距离，要盖过 SKIN。 */
const SUPPORT_REACH = SKIN + 0.07
/** 法线朝上到这个程度才算能站的支撑面。 */
const SUPPORT_NORMAL = 0.55
/** 向上速度超过它视为起跳，不再跟随脚下的平台。 */
const JUMP_SPEED = 0.5
/** 角色位置与上一帧结果相差超过它，视为被外部传送。 */
const TELEPORT_DISTANCE = 0.5
const DOWN = { x: 0, y: -1, z: 0 }
const IDENTITY_ROTATION = { x: 0, y: 0, z: 0, w: 1 }

interface BodyData {
  id: string
  platform: [number, number, number]
}

interface PendingForce {
  force: Vec3
  point: Vec3
}

interface LiveBody {
  body: RAPIER.RigidBody
  signature: string
  kind: PhysicsBodyDesc['body']
  prev: [number, number, number]
  prevRot: [number, number, number, number]
  /** 本帧物理推进让刚体绕 Y 轴转过的角度，站在上面的角色跟着转。 */
  yawDelta: number
  characterForces: PendingForce[]
  forceFrame: number
}

interface Puppet {
  body: RAPIER.RigidBody
  collider: RAPIER.Collider
  radius: number
  height: number
  standingHandle: number | null
  /** 角色脚底在所踩动态刚体局部坐标里的位置。 */
  localAnchor: [number, number, number]
  /** 上一次移动算出的脚底位置，用来识别角色是否被外部传送。 */
  lastOut: [number, number, number]
  lastFrame: number
}

const tmpPrevQuat = new Quaternion()
const tmpCurrQuat = new Quaternion()
const tmpDeltaQuat = new Quaternion()
const tmpRel = new Vector3()

export async function createRapierWorld(): Promise<PhysicsWorld> {
  await RAPIER.init()
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
  world.timestep = STEP
  const bodies = new Map<string, LiveBody>()
  const bodyByHandle = new Map<number, LiveBody>()
  const puppets = new Map<string, Puppet>()
  let pending = 0
  let frameIndex = 0
  /** 最近一次有角色以「物理交互」方式移动的帧号，决定物理用哪种方式推进。 */
  let interactFrame = -1
  const controller = world.createCharacterController(SKIN)
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
          if (live) {
            bodyByHandle.delete(live.body.handle)
            world.removeRigidBody(live.body)
          }
          const created = createBody(world, desc)
          live = {
            body: created,
            signature,
            kind: desc.body,
            prev: [desc.position[0], desc.position[1], desc.position[2]],
            prevRot: [desc.rotation[0], desc.rotation[1], desc.rotation[2], desc.rotation[3]],
            yawDelta: 0,
            characterForces: [],
            forceFrame: 0,
          }
          bodies.set(desc.id, live)
          bodyByHandle.set(created.handle, live)
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
        bodyByHandle.delete(live.body.handle)
        world.removeRigidBody(live.body)
        bodies.delete(id)
      }
    },
    step(dt, beforeSubstep) {
      frameIndex += 1
      // 上一帧没再提交移动的角色（被删除、停用）在这里回收胶囊。
      // 不能在 moveCharacters 里按「本次调用没出现」来回收：每个角色各调用一次，会互相删掉对方。
      for (const [id, puppet] of puppets) {
        if (puppet.lastFrame >= frameIndex - 1) continue
        world.removeRigidBody(puppet.body)
        puppets.delete(id)
      }
      pending = Math.min(pending + Math.max(0, dt), MAX_FRAME)
      for (const live of bodies.values()) live.yawDelta = 0
      // 两种推进方式：
      // - 默认：固定 1/60 步长的累加器，结果稳定、开销与帧率无关。
      // - 有角色开着「物理交互」：按渲染帧的实际时长推进（过长的帧拆成等长子步）。
      //   角色是按帧时长走的；刚体若按固定步长走，一帧可能推进 0/1/2 步，
      //   推箱子、站浮板时角色与刚体每帧都有错位，表现为持续抖动。
      const perFrame = interactFrame >= frameIndex - 1
      let count: number
      let sub: number
      if (perFrame) {
        if (pending < MIN_STEP) return
        count = Math.max(1, Math.ceil(pending / STEP - 1e-6))
        sub = pending / count
        pending = 0
      } else {
        count = Math.floor(pending / STEP + 1e-9)
        if (count === 0) return
        sub = STEP
        pending = Math.max(0, pending - count * STEP)
      }
      world.timestep = sub
      for (const live of bodies.values()) {
        if (live.kind !== 'dynamic') continue
        const r = live.body.rotation()
        live.prevRot[0] = r.x
        live.prevRot[1] = r.y
        live.prevRot[2] = r.z
        live.prevRot[3] = r.w
      }
      for (let i = 0; i < count; i += 1) {
        // Rapier 的 addForce / addForceAtPoint / addTorque 是持久力，step() 不会自动清零；
        // 每个子步前必须先清空，再施加角色推踩力与扩展力（浮力）。
        for (const live of bodies.values()) {
          if (live.kind !== 'dynamic') continue
          live.body.resetForces(false)
          live.body.resetTorques(false)
          for (const item of live.characterForces) {
            live.body.addForceAtPoint(
              { x: item.force[0], y: item.force[1], z: item.force[2] },
              { x: item.point[0], y: item.point[1], z: item.point[2] },
              true,
            )
          }
        }
        beforeSubstep?.(sub)
        world.step()
      }
      for (const live of bodies.values()) {
        if (live.kind !== 'dynamic') continue
        live.characterForces.length = 0
        const r = live.body.rotation()
        tmpPrevQuat.set(live.prevRot[0], live.prevRot[1], live.prevRot[2], live.prevRot[3]).invert()
        tmpCurrQuat.set(r.x, r.y, r.z, r.w)
        tmpDeltaQuat.multiplyQuaternions(tmpCurrQuat, tmpPrevQuat)
        live.yawDelta = Math.atan2(
          2 * (tmpDeltaQuat.w * tmpDeltaQuat.y + tmpDeltaQuat.x * tmpDeltaQuat.z),
          1 - 2 * (tmpDeltaQuat.y * tmpDeltaQuat.y + tmpDeltaQuat.z * tmpDeltaQuat.z),
        )
      }
    },
    moveCharacters(moves) {
      const results: CharacterMoveResult[] = []
      const gravityMag = Math.abs(world.gravity.y)
      const pushForce = (live: LiveBody, force: Vec3, point: Vec3) => {
        // 物理没推进的帧（帧时长过短被攒到下一帧）里，旧的力还没用掉，先丢弃再写本帧的
        if (live.forceFrame !== frameIndex) {
          live.forceFrame = frameIndex
          live.characterForces.length = 0
        }
        live.characterForces.push({ force, point })
      }
      for (const move of moves) {
        const puppet = ensurePuppet(world, puppets, move)
        puppet.lastFrame = frameIndex
        const half = capsuleHalf(puppet.height, puppet.radius)
        const interact = move.interact === true
        if (interact) interactFrame = frameIndex
        const exclude = (collider: RAPIER.Collider) => {
          const id = (collider.parent()?.userData as BodyData | undefined)?.id
          return id !== move.id
        }

        const charMass = Math.max(1, move.mass ?? 65)
        const pushStrength = Math.max(0, move.pushStrength ?? 1)
        const moveDt = Math.max(1 / 480, move.dt ?? STEP)
        const charVx = move.displacement[0] / moveDt
        const charVy = move.displacement[1] / moveDt
        const charVz = move.displacement[2] / moveDt

        let startX = move.position[0]
        let startY = move.position[1]
        let startZ = move.position[2]
        let yawDelta = 0
        // 角色被外部挪走（重生点、传送）时，不能再被拉回原来踩着的平台
        const moved = Math.hypot(startX - puppet.lastOut[0], startY - puppet.lastOut[1], startZ - puppet.lastOut[2])
        if (moved > TELEPORT_DISTANCE) puppet.standingHandle = null
        // 1. 脚下的平台这一帧已经动过了：先把角色放回平台上的同一个局部点，再做本帧移动。
        // 用局部锚点而不是累加位移，平台起伏、倾斜、旋转时角色都钉在同一处，不会陷进去再被顶出来。
        if (charVy <= JUMP_SPEED && puppet.standingHandle !== null) {
          const stood = bodyByHandle.get(puppet.standingHandle)
          if (stood && stood.kind === 'dynamic' && interact) {
            const currT = stood.body.translation()
            const currR = stood.body.rotation()
            tmpCurrQuat.set(currR.x, currR.y, currR.z, currR.w)
            tmpRel.set(puppet.localAnchor[0], puppet.localAnchor[1], puppet.localAnchor[2]).applyQuaternion(tmpCurrQuat)
            startX = currT.x + tmpRel.x
            startY = currT.y + tmpRel.y
            startZ = currT.z + tmpRel.z
            yawDelta = stood.yawDelta
          } else if (stood && stood.kind === 'kinematic') {
            const plat = bodyData(stood.body).platform
            startX += plat[0]
            startY += plat[1]
            startZ += plat[2]
          }
        }

        puppet.body.setTranslation({
          x: startX,
          y: startY + half + puppet.radius,
          z: startZ,
        }, true)
        controller.computeColliderMovement(
          puppet.collider,
          { x: move.displacement[0], y: move.displacement[1], z: move.displacement[2] },
          undefined,
          undefined,
          exclude,
        )
        const computed = controller.computedMovement()
        const grounded = controller.computedGrounded()
        const x = startX + computed.x
        const y = startY + computed.y
        const z = startZ + computed.z
        let impX = 0
        let impY = 0
        let impZ = 0

        let support: RAPIER.RigidBody | null = null
        let supportX = x
        let supportY = y
        let supportZ = z
        const pushedHandles = new Set<number>()

        const count = controller.numComputedCollisions()
        for (let i = 0; i < count; i += 1) {
          const hit = controller.computedCollision(i)
          if (!hit) continue
          const parentBody = hit.collider?.parent()
          if (!parentBody) continue
          const live = bodyByHandle.get(parentBody.handle)
          const isSupport = grounded && hit.normal1.y > SUPPORT_NORMAL
          if (isSupport && !support) {
            support = parentBody
            supportX = hit.witness1.x
            supportY = hit.witness1.y
            supportZ = hit.witness1.z
          }

          if (!interact || !live || live.kind !== 'dynamic') continue

          // 2. 侧向推力：按角色与箱子沿推动方向的速度差施力，箱子追上角色速度后力自然归零
          const horizNormal = Math.hypot(hit.normal1.x, hit.normal1.z)
          if (!isSupport && horizNormal > 0.25 && pushStrength > 0 && !pushedHandles.has(parentBody.handle)) {
            const nx = hit.normal1.x / horizNormal
            const nz = hit.normal1.z / horizNormal
            const charAlong = -(charVx * nx + charVz * nz)
            const bv = live.body.linvel()
            const boxAlong = -(bv.x * nx + bv.z * nz)
            const diff = charAlong - boxAlong
            if (charAlong > 0.05 && diff > 0.02) {
              pushedHandles.add(parentBody.handle)
              const bodyMass = live.body.mass()
              const effectiveMass = Math.min(charMass, bodyMass * 2)
              const forceMag = effectiveMass * Math.min(diff, 6) * 20 * pushStrength
              pushForce(live, [-nx * forceMag, 0, -nz * forceMag], [hit.witness1.x, hit.witness1.y, hit.witness1.z])
            }
          }

          // 3. 被高速动态刚体撞击（忽略脚下支撑面的正常托举，避免浪涌把站立角色误判成撞飞）
          if (!isSupport) {
            const bv = live.body.linvel()
            const bw = live.body.angvel()
            const bt = live.body.translation()
            const rx = hit.witness1.x - bt.x
            const ry = hit.witness1.y - bt.y
            const rz = hit.witness1.z - bt.z
            const pvx = bv.x + (bw.y * rz - bw.z * ry)
            const pvy = bv.y + (bw.z * rx - bw.x * rz)
            const pvz = bv.z + (bw.x * ry - bw.y * rx)
            const relApproach = (pvx - charVx) * hit.normal1.x + (pvy - charVy) * hit.normal1.y + (pvz - charVz) * hit.normal1.z
            if (relApproach > 1.4) {
              const bodyMass = live.body.mass()
              const ratio = bodyMass / (bodyMass + charMass)
              const kick = (relApproach - 1.4) * ratio * 0.9
              impX += hit.normal1.x * kick
              impY += Math.max(0, hit.normal1.y) * kick * 0.6
              impZ += hit.normal1.z * kick
            }
          }
        }

        // 4. 站稳之后角色的垂直位移是 0，控制器不做扫掠，也就不上报脚下的碰撞。
        // 只靠上面的碰撞列表会在落地的下一帧就丢掉「踩着谁」，所以这里单独向下扫一次。
        if (grounded && !support) {
          const hit = world.castShape(
            { x, y: y + half + puppet.radius, z },
            IDENTITY_ROTATION,
            DOWN,
            puppet.collider.shape,
            0,
            SUPPORT_REACH,
            true,
            undefined,
            undefined,
            puppet.collider,
            puppet.body,
          )
          const parentBody = hit?.collider.parent()
          if (hit && parentBody && hit.normal1.y > SUPPORT_NORMAL) {
            support = parentBody
            supportX = hit.witness1.x
            supportY = hit.witness1.y
            supportZ = hit.witness1.z
          }
        }

        const stood = support ? bodyByHandle.get(support.handle) : undefined
        puppet.standingHandle = support ? support.handle : null
        if (stood && stood.kind === 'dynamic' && interact) {
          // 5. 踩踏重量压在接触点上，并记下角色在刚体局部坐标里的落脚点供下一帧随动
          pushForce(stood, [0, -charMass * gravityMag, 0], [supportX, supportY, supportZ])
          const currT = stood.body.translation()
          const currR = stood.body.rotation()
          tmpCurrQuat.set(currR.x, currR.y, currR.z, currR.w).invert()
          tmpRel.set(x - currT.x, y - currT.y, z - currT.z).applyQuaternion(tmpCurrQuat)
          puppet.localAnchor[0] = tmpRel.x
          puppet.localAnchor[1] = tmpRel.y
          puppet.localAnchor[2] = tmpRel.z
        }

        puppet.body.setNextKinematicTranslation({ x, y: y + half + puppet.radius, z })
        puppet.lastOut[0] = x
        puppet.lastOut[1] = y
        puppet.lastOut[2] = z
        const result: CharacterMoveResult = { id: move.id, position: [x, y, z], grounded }
        if (Math.abs(yawDelta) > 1e-6) result.yawDelta = yawDelta
        if (Math.abs(impX) > 1e-3 || Math.abs(impY) > 1e-3 || Math.abs(impZ) > 1e-3) {
          result.impulse = [impX, impY, impZ]
        }
        results.push(result)
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
    setLinearVelocity(id, velocity) {
      const live = bodies.get(id)
      if (!live || live.kind !== 'dynamic') return
      live.body.setLinvel({ x: velocity[0], y: velocity[1], z: velocity[2] }, true)
    },
    applyImpulse(id, impulse) {
      const live = bodies.get(id)
      if (!live || live.kind !== 'dynamic') return
      live.body.applyImpulse({ x: impulse[0], y: impulse[1], z: impulse[2] }, true)
    },
    dispose() {
      controller.free()
      puppets.clear()
      bodies.clear()
      bodyByHandle.clear()
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
  const puppet: Puppet = {
    body,
    collider,
    radius,
    height,
    standingHandle: null,
    localAnchor: [0, 0, 0],
    lastOut: [move.position[0], move.position[1], move.position[2]],
    lastFrame: 0,
  }
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
    const half = Math.max(0.001, desc.size[1] * 0.5 * sy - radius)
    return RAPIER.ColliderDesc.capsule(half, radius)
  }
  if ((desc.shape === 'convex' || desc.shape === 'trimesh') && desc.mesh && desc.mesh.positions.length >= 9) {
    const positions = scaledPositions(desc.mesh.positions, sx, sy, sz)
    if (desc.shape === 'convex') {
      const hull = RAPIER.ColliderDesc.convexHull(positions)
      if (hull) return hull
    } else if (desc.mesh.indices.length >= 3) {
      return RAPIER.ColliderDesc.trimesh(positions, desc.mesh.indices)
    }
  }
  return RAPIER.ColliderDesc.cuboid(
    Math.max(0.001, desc.size[0] * 0.5 * sx),
    Math.max(0.001, desc.size[1] * 0.5 * sy),
    Math.max(0.001, desc.size[2] * 0.5 * sz),
  )
}

function writePose(body: RAPIER.RigidBody, desc: PhysicsBodyDesc) {
  const pos = { x: desc.position[0], y: desc.position[1], z: desc.position[2] }
  const rot = { x: desc.rotation[0], y: desc.rotation[1], z: desc.rotation[2], w: desc.rotation[3] }
  if (desc.body === 'kinematic') {
    body.setNextKinematicTranslation(pos)
    body.setNextKinematicRotation(rot)
    return
  }
  body.setTranslation(pos, false)
  body.setRotation(rot, false)
}

function signatureOf(desc: PhysicsBodyDesc): string {
  return [
    desc.body,
    desc.shape,
    desc.trigger ? 1 : 0,
    desc.size.map(n => n.toFixed(3)).join(','),
    desc.scale.map(n => n.toFixed(3)).join(','),
    desc.mass.toFixed(3),
    desc.friction.toFixed(3),
    desc.restitution.toFixed(3),
    desc.linearDamping.toFixed(3),
    desc.angularDamping.toFixed(3),
    desc.gravityScale.toFixed(3),
    desc.collisionGroups ?? 'all',
    desc.mesh?.key ?? '',
  ].join('|')
}
