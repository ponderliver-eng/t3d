import type { SceneNode } from '../../editor/scene/types'
import { registerRuntimeSystem, RUNTIME_STAGE, type SceneRuntimeHost } from '../../runtime/sceneRuntime'
import { getRuntimeWorld } from '../../runtime/world'
import type { CapabilityRuntimeModule } from '../registry'
import {
  CROWD_CAPABILITY_ID,
  normalizeCrowd,
  type CrowdFormationType,
  type CrowdSpec,
} from './schema'

interface CrowdAgentState {
  nodeId: string
  vx: number
  vy: number
  vz: number
  target: { x: number; y: number; z: number } | null
  arriveDist: number
  speedOverride?: number
  onArrive?: () => void
  onArriveMessage?: (nodeId: string) => void
}

const agents = new Map<string, CrowdAgentState>()
let unregisterCrowd: (() => void) | null = null

function readNodePosition(host: SceneRuntimeHost, node: SceneNode): { x: number; y: number; z: number } {
  const obj = host.resolveObject(node.id)
  if (obj) return { x: obj.position.x, y: obj.position.y, z: obj.position.z }
  return { x: node.position[0], y: node.position[1], z: node.position[2] }
}

function writeNodePosition(host: SceneRuntimeHost, node: SceneNode, x: number, y: number, z: number) {
  const obj = host.resolveObject(node.id)
  if (obj) obj.position.set(x, y, z)
  node.position = [x, y, z]
}

function writeNodeYaw(host: SceneRuntimeHost, node: SceneNode, dx: number, dz: number) {
  if (dx * dx + dz * dz < 1e-6) return
  const yawRad = Math.atan2(dx, dz)
  const obj = host.resolveObject(node.id)
  if (obj) obj.rotation.y = yawRad
  node.rotation = [node.rotation[0], (yawRad * 180) / Math.PI, node.rotation[2]]
}

export function setCrowdTarget(
  nodeId: string,
  target: { x: number; y: number; z: number },
  options?: { speed?: number; arriveDist?: number; onArrive?: () => void },
) {
  const existing = agents.get(nodeId)
  if (existing) {
    existing.target = { x: target.x, y: target.y, z: target.z }
    existing.arriveDist = Math.max(0.05, options?.arriveDist ?? 0.35)
    existing.speedOverride = options?.speed
    existing.onArrive = options?.onArrive
  } else {
    agents.set(nodeId, {
      nodeId,
      vx: 0,
      vy: 0,
      vz: 0,
      target: { x: target.x, y: target.y, z: target.z },
      arriveDist: Math.max(0.05, options?.arriveDist ?? 0.35),
      speedOverride: options?.speed,
      onArrive: options?.onArrive,
    })
  }
}

export function stopCrowdAgent(nodeId: string) {
  const agent = agents.get(nodeId)
  if (!agent) return
  agent.target = null
  agent.vx = 0
  agent.vy = 0
  agent.vz = 0
  agent.onArrive = undefined
}

export function isCrowdMoving(nodeId: string): boolean {
  const agent = agents.get(nodeId)
  return Boolean(agent && agent.target)
}

export function getCrowdStats() {
  let moving = 0
  for (const agent of agents.values()) {
    if (agent.target) moving += 1
  }
  return { total: agents.size, moving }
}

export function setCrowdFormation(
  nodeIds: string[],
  center: { x: number; y: number; z: number },
  options?: {
    formation?: CrowdFormationType
    spacing?: number
    facingYaw?: number
    speed?: number
    arriveDist?: number
  },
) {
  const count = nodeIds.length
  if (count === 0) return
  const formation = options?.formation ?? 'grid'
  const spacing = Math.max(0.5, options?.spacing ?? 1.8)
  const yaw = options?.facingYaw ?? 0
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)

  const rotateOffset = (lx: number, lz: number) => ({
    x: center.x + lx * cos + lz * sin,
    y: center.y,
    z: center.z - lx * sin + lz * cos,
  })

  if (formation === 'line') {
    const half = (count - 1) * 0.5
    for (let i = 0; i < count; i += 1) {
      const target = rotateOffset((i - half) * spacing, 0)
      setCrowdTarget(nodeIds[i], target, options)
    }
    return
  }

  if (formation === 'wedge') {
    for (let i = 0; i < count; i += 1) {
      if (i === 0) {
        setCrowdTarget(nodeIds[i], rotateOffset(0, 0), options)
      } else {
        const rank = Math.ceil(i / 2)
        const side = i % 2 === 1 ? -1 : 1
        setCrowdTarget(nodeIds[i], rotateOffset(side * rank * spacing * 0.85, -rank * spacing), options)
      }
    }
    return
  }

  if (formation === 'circle') {
    const radius = Math.max(spacing, (count * spacing) / (Math.PI * 2))
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2
      setCrowdTarget(
        nodeIds[i],
        rotateOffset(Math.cos(angle) * radius, Math.sin(angle) * radius),
        options,
      )
    }
    return
  }

  // grid
  const cols = Math.max(1, Math.ceil(Math.sqrt(count)))
  const rows = Math.ceil(count / cols)
  for (let i = 0; i < count; i += 1) {
    const col = i % cols
    const row = Math.floor(i / cols)
    const lx = (col - (cols - 1) * 0.5) * spacing
    const lz = -(row - (rows - 1) * 0.5) * spacing
    setCrowdTarget(nodeIds[i], rotateOffset(lx, lz), options)
  }
}

function stepCrowdRuntime(dt: number, host: SceneRuntimeHost) {
  const world = getRuntimeWorld()
  const nodes = world.getNodes()

  interface Entry {
    node: SceneNode
    spec: CrowdSpec
    pos: { x: number; y: number; z: number }
    agent: CrowdAgentState
  }

  const entries: Entry[] = []
  let maxRadius = 1.0

  for (const node of Object.values(nodes)) {
    const raw = node.capabilities?.[CROWD_CAPABILITY_ID]
    if (!raw || !node.visible) continue
    const spec = normalizeCrowd(raw)
    if (!spec.enabled) continue
    let agent = agents.get(node.id)
    if (!agent) {
      agent = {
        nodeId: node.id,
        vx: 0,
        vy: 0,
        vz: 0,
        target: null,
        arriveDist: 0.35,
      }
      agents.set(node.id, agent)
    }
    if (spec.radius > maxRadius) maxRadius = spec.radius
    entries.push({
      node,
      spec,
      pos: readNodePosition(host, node),
      agent,
    })
  }

  // 清理已销毁或移除组件的 agent
  const activeSet = new Set(entries.map((e) => e.node.id))
  for (const id of agents.keys()) {
    if (!activeSet.has(id)) agents.delete(id)
  }

  if (entries.length === 0) return

  // 空间网格哈希加速局部邻居查询
  const cellSize = Math.max(1.2, maxRadius * 2.4)
  const grid = new Map<string, number[]>()
  for (let i = 0; i < entries.length; i += 1) {
    const p = entries[i].pos
    const cx = Math.floor(p.x / cellSize)
    const cz = Math.floor(p.z / cellSize)
    const key = `${cx},${cz}`
    let bucket = grid.get(key)
    if (!bucket) {
      bucket = []
      grid.set(key, bucket)
    }
    bucket.push(i)
  }

  const safeDt = Math.min(0.05, Math.max(0.0001, dt))

  for (let i = 0; i < entries.length; i += 1) {
    const { node, spec, pos, agent } = entries[i]
    const maxSpeed = Math.max(0.1, agent.speedOverride ?? spec.maxSpeed)

    let desiredVx = 0
    let desiredVy = 0
    let desiredVz = 0
    let hasGoal = false

    if (agent.target) {
      const gx = agent.target.x - pos.x
      const gy = spec.planeXZ ? 0 : agent.target.y - pos.y
      const gz = agent.target.z - pos.z
      const dist = Math.hypot(gx, gy, gz)
      if (dist <= agent.arriveDist) {
        agent.target = null
        agent.vx = 0
        agent.vy = 0
        agent.vz = 0
        const cb = agent.onArrive
        agent.onArrive = undefined
        if (cb) {
          try {
            cb()
          } catch (err) {
            console.warn('[Crowd] onArrive 回调异常:', err)
          }
        }
      } else {
        hasGoal = true
        const slowRadius = Math.max(agent.arriveDist * 2.5, 1.0)
        const speed = dist < slowRadius ? maxSpeed * (dist / slowRadius) : maxSpeed
        desiredVx = (gx / dist) * speed
        desiredVy = (gy / dist) * speed
        desiredVz = (gz / dist) * speed
      }
    }

    // 群体分离 / 凝聚 / 对齐力
    let sepX = 0
    let sepY = 0
    let sepZ = 0
    let cohX = 0
    let cohY = 0
    let cohZ = 0
    let aliX = 0
    let aliY = 0
    let aliZ = 0
    let neighborCount = 0

    const cx = Math.floor(pos.x / cellSize)
    const cz = Math.floor(pos.z / cellSize)

    for (let ox = -1; ox <= 1; ox += 1) {
      for (let oz = -1; oz <= 1; oz += 1) {
        const bucket = grid.get(`${cx + ox},${cz + oz}`)
        if (!bucket) continue
        for (const j of bucket) {
          if (j === i) continue
          const other = entries[j]
          const dx = pos.x - other.pos.x
          const dy = spec.planeXZ ? 0 : pos.y - other.pos.y
          const dz = pos.z - other.pos.z
          const d2 = dx * dx + dy * dy + dz * dz
          const minDist = spec.radius + other.spec.radius
          if (d2 > minDist * minDist * 2.25) continue

          const d = Math.sqrt(d2)
          if (d < minDist) {
            if (d > 1e-4) {
              const push = ((minDist - d) / minDist) * maxSpeed
              sepX += (dx / d) * push
              sepY += (dy / d) * push
              sepZ += (dz / d) * push
            } else {
              // 极近重叠时按索引确定微小错开方向
              const angle = (i * 2.39996) % (Math.PI * 2)
              sepX += Math.cos(angle) * maxSpeed * 0.5
              sepZ += Math.sin(angle) * maxSpeed * 0.5
            }
          }
          neighborCount += 1
          cohX += other.pos.x
          cohY += other.pos.y
          cohZ += other.pos.z
          aliX += other.agent.vx
          aliY += other.agent.vy
          aliZ += other.agent.vz
        }
      }
    }

    let steerVx = desiredVx + sepX * spec.separationWeight
    let steerVy = desiredVy + sepY * spec.separationWeight
    let steerVz = desiredVz + sepZ * spec.separationWeight

    if (neighborCount > 0 && hasGoal) {
      const inv = 1 / neighborCount
      const cxAvg = cohX * inv - pos.x
      const cyAvg = spec.planeXZ ? 0 : cohY * inv - pos.y
      const czAvg = cohZ * inv - pos.z
      const cLen = Math.hypot(cxAvg, cyAvg, czAvg)
      if (cLen > 1e-4) {
        steerVx += (cxAvg / cLen) * maxSpeed * spec.cohesionWeight * 0.5
        steerVy += (cyAvg / cLen) * maxSpeed * spec.cohesionWeight * 0.5
        steerVz += (czAvg / cLen) * maxSpeed * spec.cohesionWeight * 0.5
      }
      steerVx += aliX * inv * spec.alignmentWeight * 0.4
      steerVy += aliY * inv * spec.alignmentWeight * 0.4
      steerVz += aliZ * inv * spec.alignmentWeight * 0.4
    }

    // 限速
    const spd = Math.hypot(steerVx, steerVy, steerVz)
    if (spd > maxSpeed) {
      const k = maxSpeed / spd
      steerVx *= k
      steerVy *= k
      steerVz *= k
    }

    // 阻尼平滑插值
    const blend = Math.min(1, safeDt * 10)
    agent.vx += (steerVx - agent.vx) * blend
    agent.vy += (steerVy - agent.vy) * blend
    agent.vz += (steerVz - agent.vz) * blend

    const moved = Math.hypot(agent.vx, agent.vy, agent.vz)
    if (moved < 0.01 && !hasGoal) {
      agent.vx = 0
      agent.vy = 0
      agent.vz = 0
      continue
    }

    const nx = pos.x + agent.vx * safeDt
    const ny = spec.planeXZ ? pos.y : pos.y + agent.vy * safeDt
    const nz = pos.z + agent.vz * safeDt
    writeNodePosition(host, node, nx, ny, nz)

    if (spec.faceDirection && (agent.vx * agent.vx + agent.vz * agent.vz) > 0.04) {
      writeNodeYaw(host, node, agent.vx, agent.vz)
    }
  }
}

export function ensureCrowdRuntime() {
  if (unregisterCrowd) return
  unregisterCrowd = registerRuntimeSystem(
    'capability.crowd',
    RUNTIME_STAGE.PRE_PHYSICS + 4,
    stepCrowdRuntime,
  )
}

export function mount() {
  ensureCrowdRuntime()
  return dispose
}

export function dispose() {
  unregisterCrowd?.()
  unregisterCrowd = null
  agents.clear()
}

export const crowdRuntimeModule: CapabilityRuntimeModule = {
  mount,
  dispose,
}
