import { evalEasing } from '../../runtime/motion'
import { registerRuntimeSystem, RUNTIME_STAGE, type SceneRuntimeHost } from '../../runtime/sceneRuntime'
import { getRuntimeWorld } from '../../runtime/world'
import type { CapabilityRuntimeModule } from '../registry'
import { normalizeTween, TWEEN_CAPABILITY_ID, type TweenSpec } from './schema'

interface TweenAgentState {
  basePos: [number, number, number]
  baseRot: [number, number, number]
  baseScale: [number, number, number]
  delayLeft: number
  elapsed: number
  reversed: boolean
  finished: boolean
}

let unregister: (() => void) | null = null
const agents = new Map<string, TweenAgentState>()
const specCache = new WeakMap<object, TweenSpec>()

function specOf(raw: unknown): TweenSpec {
  if (!raw || typeof raw !== 'object') return normalizeTween(raw)
  const cached = specCache.get(raw)
  if (cached) return cached
  const next = normalizeTween(raw)
  specCache.set(raw, next)
  return next
}

function stepTweenCapability(dt: number, host: SceneRuntimeHost): void {
  const runtime = getRuntimeWorld()
  if (runtime.getPlayState() !== 'playing') {
    if (agents.size > 0) agents.clear()
    return
  }

  const nodes = runtime.getNodes()
  const activeIds = new Set<string>()

  for (const node of Object.values(nodes)) {
    const raw = node.capabilities?.[TWEEN_CAPABILITY_ID]
    if (!raw) continue
    const spec = specOf(raw)
    if (!spec.enabled || !spec.autoStart) continue

    const obj = host.resolveObject(node.id)
    if (!obj) continue

    activeIds.add(node.id)
    let agent = agents.get(node.id)
    if (!agent) {
      agent = {
        basePos: [obj.position.x, obj.position.y, obj.position.z],
        baseRot: [obj.rotation.x, obj.rotation.y, obj.rotation.z],
        baseScale: [obj.scale.x, obj.scale.y, obj.scale.z],
        delayLeft: Math.max(0, spec.delay),
        elapsed: 0,
        reversed: false,
        finished: false,
      }
      agents.set(node.id, agent)
    }

    if (agent.finished || dt <= 0) continue

    if (agent.delayLeft > 0) {
      agent.delayLeft -= dt
      if (agent.delayLeft > 0) continue
      agent.elapsed += -agent.delayLeft
      agent.delayLeft = 0
    } else {
      agent.elapsed += dt
    }

    const dur = Math.max(0.05, spec.duration)
    let rawT = agent.elapsed / dur
    const effectiveLoop = spec.property === 'floatBob' && spec.loopMode === 'once' ? 'pingPong' : spec.loopMode

    if (rawT >= 1) {
      if (effectiveLoop === 'loop') {
        agent.elapsed = agent.elapsed % dur
        rawT = agent.elapsed / dur
      } else if (effectiveLoop === 'pingPong') {
        const cycles = Math.floor(rawT)
        if (cycles % 2 === 1) agent.reversed = !agent.reversed
        agent.elapsed = agent.elapsed % dur
        rawT = agent.elapsed / dur
      } else {
        rawT = 1
        agent.finished = true
      }
    }

    const progress = agent.reversed ? 1 - rawT : rawT
    const eased = evalEasing(spec.ease, progress)
    const [dx, dy, dz] = spec.delta

    if (spec.property === 'positionOffset' || spec.property === 'floatBob') {
      obj.position.set(
        agent.basePos[0] + dx * eased,
        agent.basePos[1] + dy * eased,
        agent.basePos[2] + dz * eased,
      )
    } else if (spec.property === 'rotationOffset') {
      const rx = (dx * Math.PI) / 180
      const ry = (dy * Math.PI) / 180
      const rz = (dz * Math.PI) / 180
      obj.rotation.set(
        agent.baseRot[0] + rx * eased,
        agent.baseRot[1] + ry * eased,
        agent.baseRot[2] + rz * eased,
      )
    } else if (spec.property === 'scaleMultiplier') {
      obj.scale.set(
        agent.baseScale[0] * (1 + dx * eased),
        agent.baseScale[1] * (1 + dy * eased),
        agent.baseScale[2] * (1 + dz * eased),
      )
    }
  }

  for (const id of agents.keys()) {
    if (!activeIds.has(id)) agents.delete(id)
  }
}

export function mount(): () => void {
  if (!unregister) {
    unregister = registerRuntimeSystem(
      'capability.tween',
      RUNTIME_STAGE.PRE_PHYSICS + 3,
      stepTweenCapability,
    )
  }
  return dispose
}

export function dispose(): void {
  unregister?.()
  unregister = null
  agents.clear()
}

const tweenRuntimeModule: CapabilityRuntimeModule = { mount, dispose }
export default tweenRuntimeModule
