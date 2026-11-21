import { Quaternion, Vector3 } from 'three'
import { worldPose } from '../../runtime/transform'
import { getRuntimeWorld } from '../../runtime/world'
import type { SceneNode } from '../../editor/scene/types'
import type { CapabilityRuntimeModule } from '../registry'
import { registerPhysicsExtension, type PhysicsExtensionContext } from '../physics/session'
import { sampleWaterSurface } from '../water/session'
import { BUOYANCY_CAPABILITY_ID, normalizeBuoyancy, type BuoyancySampleMode, type BuoyancySpec } from './defaults'

let unregister: (() => void) | null = null

const tmpQuat = new Quaternion()
const tmpOffset = new Vector3()
const tmpScale = new Vector3()
const specCache = new WeakMap<object, BuoyancySpec>()

function specOf(raw: unknown): BuoyancySpec {
  if (!raw || typeof raw !== 'object') return normalizeBuoyancy(raw)
  const cached = specCache.get(raw)
  if (cached) return cached
  const next = normalizeBuoyancy(raw)
  specCache.set(raw, next)
  return next
}

function sampleOffsets(mode: BuoyancySampleMode, hx: number, hy: number, hz: number): Array<[number, number, number]> {
  if (mode === 'center') return [[0, 0, 0]]
  const ax = hx * 0.75
  const az = hz * 0.75
  if (mode === 'box8') {
    const ay = hy * 0.75
    return [
      [-ax, -ay, -az],
      [ax, -ay, -az],
      [-ax, -ay, az],
      [ax, -ay, az],
      [-ax, ay, -az],
      [ax, ay, -az],
      [-ax, ay, az],
      [ax, ay, az],
    ]
  }
  const by = -hy * 0.6
  return [
    [-ax, by, -az],
    [ax, by, -az],
    [-ax, by, az],
    [ax, by, az],
  ]
}

function halfExtents(nodes: Record<string, SceneNode>, node: SceneNode): [number, number, number] {
  const physics = node.physics
  if (!physics) return [0.5, 0.5, 0.5]
  const pose = worldPose(nodes, node.id)
  tmpScale.set(Math.abs(pose.scale.x), Math.abs(pose.scale.y), Math.abs(pose.scale.z))
  const size = physics.size
  if (physics.shape === 'sphere') {
    const r = Math.max(0.05, size[0]) * Math.max(tmpScale.x, tmpScale.y, tmpScale.z)
    return [r, r, r]
  }
  if (physics.shape === 'capsule') {
    const r = Math.max(0.05, size[0]) * Math.max(tmpScale.x, tmpScale.z)
    const hy = Math.max(r, Math.max(0.1, size[1]) * 0.5 * tmpScale.y)
    return [r, hy, r]
  }
  return [
    Math.max(0.05, size[0] * 0.5 * tmpScale.x),
    Math.max(0.05, size[1] * 0.5 * tmpScale.y),
    Math.max(0.05, size[2] * 0.5 * tmpScale.z),
  ]
}

function stepBuoyancy(ctx: PhysicsExtensionContext) {
  const runtime = getRuntimeWorld()
  const gravityY = Math.abs(runtime.getPicture().gravity?.[1] ?? -9.81)
  const stepDt = Math.max(ctx.dt, 1 / 120)
  const nodes = runtime.getNodes()

  for (const node of Object.values(nodes)) {
    const raw = node.capabilities?.[BUOYANCY_CAPABILITY_ID]
    if (!raw || !node.physics || node.physics.body !== 'dynamic') continue
    const spec = specOf(raw)
    if (!spec.enabled) continue

    const body = ctx.world.bodyState(node.id)
    if (!body) continue

    const [hx, hy, hz] = halfExtents(nodes, node)
    const points = sampleOffsets(spec.sampleMode, hx, hy, hz)
    const draft = spec.draftDepth > 0.01 ? spec.draftDepth : Math.max(0.15, hy * 1.4)
    const pointMass = body.mass / points.length
    const pointWeight = pointMass * gravityY * Math.max(0, node.physics.gravityScale ?? 1)

    tmpQuat.set(body.rotation[0], body.rotation[1], body.rotation[2], body.rotation[3])

    let subSum = 0
    for (let i = 0; i < points.length; i += 1) {
      const local = points[i]
      tmpOffset.set(local[0], local[1], local[2]).applyQuaternion(tmpQuat)
      const wx = body.position[0] + tmpOffset.x
      const wy = body.position[1] + tmpOffset.y
      const wz = body.position[2] + tmpOffset.z

      const water = sampleWaterSurface(wx, wz)
      if (!water || wy >= water.height) continue

      const submersion = Math.min(1, (water.height - wy) / draft)
      subSum += submersion

      const upForce = submersion * spec.buoyancyForce * pointWeight
      // 随波浪斜坡产生轻微横向推力，让物体自然随浪漂摇
      const wavePushX = water.normal[0] * upForce * 0.18
      const wavePushZ = water.normal[2] * upForce * 0.18

      // 该点世界线速度 = 质心线速度 + ω × r
      const vx = body.linvel[0] + (body.angvel[1] * tmpOffset.z - body.angvel[2] * tmpOffset.y)
      const vy = body.linvel[1] + (body.angvel[2] * tmpOffset.x - body.angvel[0] * tmpOffset.z)
      const vz = body.linvel[2] + (body.angvel[0] * tmpOffset.y - body.angvel[1] * tmpOffset.x)

      const dragGain = spec.waterDrag * submersion * pointMass
      const maxImpulseRate = pointMass / stepDt * 0.65
      const clampDrag = (v: number) => {
        const rawDrag = -v * dragGain
        const limit = Math.abs(v) * maxImpulseRate
        return Math.max(-limit, Math.min(limit, rawDrag))
      }

      ctx.world.applyForceAtPoint(
        node.id,
        [wavePushX + clampDrag(vx), upForce + clampDrag(vy), wavePushZ + clampDrag(vz)],
        [wx, wy, wz],
      )
    }

    if (subSum > 0 && spec.angularDrag > 0) {
      const avgSub = subSum / points.length
      const angGain = spec.angularDrag * avgSub * body.mass * 0.45
      const maxAngRate = body.mass / stepDt * 0.5
      const clampAng = (w: number) => {
        const rawTorque = -w * angGain
        const limit = Math.abs(w) * maxAngRate
        return Math.max(-limit, Math.min(limit, rawTorque))
      }
      ctx.world.applyTorque(node.id, [
        clampAng(body.angvel[0]),
        clampAng(body.angvel[1]),
        clampAng(body.angvel[2]),
      ])
    }
  }
}

export function mount(): () => void {
  if (!unregister) {
    unregister = registerPhysicsExtension('buoyancy', 20, stepBuoyancy)
  }
  return dispose
}

export function dispose(): void {
  unregister?.()
  unregister = null
}

const buoyancyRuntimeModule: CapabilityRuntimeModule = { mount, dispose }
export default buoyancyRuntimeModule
