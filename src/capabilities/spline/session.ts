import type { SceneNode } from '../../editor/scene/types'
import { createSplinePath, type MotionVec3, type SplinePath } from '../../runtime/motion'
import { registerRuntimeSystem, RUNTIME_STAGE, type SceneRuntimeHost } from '../../runtime/sceneRuntime'
import { getRuntimeWorld } from '../../runtime/world'
import type { CapabilityRuntimeModule } from '../registry'
import { normalizeSpline, SPLINE_CAPABILITY_ID, type SplineSpec } from './schema'

interface SplineAgentState {
  pathKey: string
  spline: SplinePath
  distance: number
  direction: 1 | -1
  finished: boolean
}

let unregister: (() => void) | null = null
const agents = new Map<string, SplineAgentState>()
const specCache = new WeakMap<object, SplineSpec>()

function specOf(raw: unknown): SplineSpec {
  if (!raw || typeof raw !== 'object') return normalizeSpline(raw)
  const cached = specCache.get(raw)
  if (cached) return cached
  const next = normalizeSpline(raw)
  specCache.set(raw, next)
  return next
}

function collectWaypoints(
  nodes: Record<string, SceneNode>,
  host: SceneRuntimeHost,
  ownerNode: SceneNode,
  spec: SplineSpec,
): { key: string; points: MotionVec3[] } {
  const pathParentId = spec.pathNodeId || ownerNode.id
  const children = Object.values(nodes)
    .filter((n) => n.parentId === pathParentId && n.id !== ownerNode.id)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

  const points: MotionVec3[] = []
  const keyParts: string[] = [pathParentId, spec.closed ? '1' : '0', String(spec.tension)]

  for (const child of children) {
    const obj = host.resolveObject(child.id)
    const p = obj
      ? { x: obj.position.x, y: obj.position.y, z: obj.position.z }
      : { x: child.position[0], y: child.position[1], z: child.position[2] }
    points.push(p)
    keyParts.push(`${child.id}:${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`)
  }
  return { key: keyParts.join('|'), points }
}

function stepSplineCapability(dt: number, host: SceneRuntimeHost): void {
  const runtime = getRuntimeWorld()
  if (runtime.getPlayState() !== 'playing') {
    if (agents.size > 0) agents.clear()
    return
  }

  const nodes = runtime.getNodes()
  const activeIds = new Set<string>()

  for (const node of Object.values(nodes)) {
    const raw = node.capabilities?.[SPLINE_CAPABILITY_ID]
    if (!raw) continue
    const spec = specOf(raw)
    if (!spec.enabled || !spec.autoStart) continue

    const obj = host.resolveObject(node.id)
    if (!obj) continue

    activeIds.add(node.id)
    const { key, points } = collectWaypoints(nodes, host, node, spec)
    if (points.length < 2) continue

    let agent = agents.get(node.id)
    if (!agent || agent.pathKey !== key) {
      const spline = createSplinePath(points, {
        closed: spec.closed || spec.mode === 'loop',
        tension: spec.tension,
      })
      const startDist = Math.max(0, Math.min(1, spec.startProgress)) * spline.length
      agent = {
        pathKey: key,
        spline,
        distance: startDist,
        direction: 1,
        finished: false,
      }
      agents.set(node.id, agent)
      const startPt = spline.pointAtDistance(startDist)
      obj.position.set(startPt.x, spec.planeXZ ? obj.position.y : startPt.y, startPt.z)
    }

    if (agent.finished || dt <= 0 || agent.spline.length <= 1e-6) continue

    const totalLen = agent.spline.length
    let nextDist = agent.distance + spec.speed * dt * agent.direction

    if (spec.mode === 'loop') {
      nextDist = ((nextDist % totalLen) + totalLen) % totalLen
    } else if (spec.mode === 'pingPong') {
      if (nextDist >= totalLen) {
        nextDist = totalLen - (nextDist - totalLen)
        agent.direction = -1
      } else if (nextDist <= 0) {
        nextDist = -nextDist
        agent.direction = 1
      }
    } else {
      if (nextDist >= totalLen) {
        nextDist = totalLen
        agent.finished = true
      } else if (nextDist <= 0) {
        nextDist = 0
        agent.finished = true
      }
    }

    agent.distance = nextDist
    const pt = agent.spline.pointAtDistance(nextDist)
    obj.position.set(pt.x, spec.planeXZ ? obj.position.y : pt.y, pt.z)

    if (spec.faceDirection) {
      const tan = agent.spline.tangentAtDistance(nextDist)
      const tx = tan.x * agent.direction
      const tz = tan.z * agent.direction
      if (Math.abs(tx) > 1e-5 || Math.abs(tz) > 1e-5) {
        obj.rotation.y = Math.atan2(tx, tz)
      }
    }
  }

  for (const id of agents.keys()) {
    if (!activeIds.has(id)) agents.delete(id)
  }
}

export function mount(): () => void {
  if (!unregister) {
    unregister = registerRuntimeSystem(
      'capability.spline',
      RUNTIME_STAGE.PRE_PHYSICS + 2,
      stepSplineCapability,
    )
  }
  return dispose
}

export function dispose(): void {
  unregister?.()
  unregister = null
  agents.clear()
}

const splineRuntimeModule: CapabilityRuntimeModule = { mount, dispose }
export default splineRuntimeModule
