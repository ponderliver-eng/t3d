import { Vector3 } from 'three'
import { findNavigationPath } from '../../capabilities/navigation/session'
import { listRuntimeTags, nodeHasTag } from '../../gameplay/runtimeTags'
import {
  getCrowdStats,
  isCrowdMoving,
  setCrowdFormation,
  setCrowdTarget,
  stopCrowdAgent,
} from '../../capabilities/crowd/session'
import type { CrowdFormationType } from '../../capabilities/crowd/schema'
import {
  bindProjectileRuntimeHooks,
  launchProjectile,
  resetProjectileState,
} from '../../capabilities/projectile/session'
import type { ProjectileMode } from '../../capabilities/projectile/schema'
import { applyPhysicsForce, applyPhysicsImpulse, getPhysicsBodyState, setPhysicsVelocity } from '../../capabilities/physics/session'
import type { SceneNode, Vec3 as TupleVec3 } from '../../editor/scene/types'
import { findRow } from '../../gameplay/registry'
import { playSound, stopMusic } from '../../runtime/audio'
import {
  clearCharacterModifiers,
  getCharacterModifiers,
  setCharacterModifiers,
  type CharacterRuntimeModifiers,
} from '../../runtime/character'
import { onCharacterEvent } from '../../runtime/signals'
import { getCompiledShaderParam, setCompiledShaderParam } from './shaderRuntime'
import { measureCost } from '../../runtime/frameProfile'
import {
  createAnimationCurve,
  createSplinePath,
  evalEasing,
  type CurveKeyInput,
  type EasingName,
  type SplinePath,
} from '../../runtime/motion'
import { registerRuntimeSystem, RUNTIME_STAGE, type SceneRuntimeHost } from '../../runtime/sceneRuntime'
import { onUiClick, setScreenVisible, uiValues, writeUiVariable } from '../../runtime/ui/values'
import { getRuntimeWorld } from '../../runtime/world'
import { getActionAxis2D, isActionPressed, isKeyHeld, wasActionTapped, wasKeyTapped } from '../input/actionMap'
import { defaultForSchema, type FieldSchema } from '../schema/fieldSchema'
import { checkAndTranspileTs, evaluateTranspiledModule, type CompileResult } from './compiler'

export interface Vec2Obj {
  x: number
  y: number
}

export interface Vec3Obj {
  x: number
  y: number
  z: number
}

export interface BehaviorDefinition {
  name: string
  description?: string
  params?: Record<string, FieldSchema>
  state?: () => Record<string, unknown>
  methods?: Record<string, (self: unknown, ...args: unknown[]) => unknown>
  onStart?: (self: unknown) => void
  onEnable?: (self: unknown) => void
  onDisable?: (self: unknown) => void
  onSpawn?: (self: unknown, payload?: unknown) => void
  onUpdate?: (self: unknown, dt: number) => void
  onDestroy?: (self: unknown) => void
  onMessage?: (self: unknown, msg: { name: string; payload?: unknown; sender?: unknown }) => void
  onDrawGizmos?: (self: unknown, gizmos: unknown) => void
}

export type ScriptGizmoCommand =
  | { kind: 'line'; from: Vec3Obj; to: Vec3Obj; color: string }
  | { kind: 'arrow'; from: Vec3Obj; dir: Vec3Obj; length: number; color: string }
  | { kind: 'wireSphere'; center: Vec3Obj; radius: number; color: string }
  | { kind: 'wireBox'; center: Vec3Obj; size: Vec3Obj; color: string }
  | { kind: 'disc'; center: Vec3Obj; normal: Vec3Obj; radius: number; color: string }
  | { kind: 'radiusHandle'; paramKey: string; center: Vec3Obj; radius: number; axis: 'x' | 'y' | 'z'; color: string; min?: number; max?: number }
  | { kind: 'positionHandle'; paramKey: string; position: Vec3Obj; color: string }

export interface SystemDefinition {
  name: string
  description?: string
  stage?: 'prePhysics' | 'postPhysics' | 'postAnimation' | 'preRender'
  order?: number
  state?: () => Record<string, unknown>
  createState?: () => Record<string, unknown>
  onInit?: (api: unknown, state: Record<string, unknown>) => void
  onMount?: (api: unknown, state: Record<string, unknown>) => void
  onUpdate?: (api: unknown, state: Record<string, unknown>, dt: number) => void
  onStep?: (api: unknown, state: Record<string, unknown>, dt: number) => void
  onDestroy?: (api: unknown, state: Record<string, unknown>) => void
  onDispose?: (api: unknown, state: Record<string, unknown>) => void
}

export interface CompiledScriptAsset {
  id: string
  file: string
  kind: 'behavior' | 'system'
  behavior?: BehaviorDefinition
  system?: SystemDefinition
}

interface BehaviorInstanceRecord {
  nodeId: string
  scriptId: string
  started: boolean
  enabled: boolean
  lastRawParams?: unknown
  state: Record<string, unknown>
}

const compiledBehaviors = new Map<string, BehaviorDefinition>()
const compiledSystems = new Map<string, { def: SystemDefinition; unregister: () => void; mounted: boolean; state: Record<string, unknown> }>()
const instanceStates = new Map<string, BehaviorInstanceRecord>()
const runtimeErrorCounts = new Map<string, number>()

function extractShortStack(error: unknown): string {
  if (!(error instanceof Error) || !error.stack) return ''
  const lines = error.stack
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  if (lines.length === 0) return ''
  const scriptFrames = lines.filter((line) => line.includes('t3d:///'))
  const picked = (scriptFrames.length > 0 ? scriptFrames : lines).slice(0, 3)
  return `\n  at ${picked.join('\n  at ')}`
}

function reportRuntimeError(
  phase: string,
  scriptId: string,
  label: string,
  error: unknown,
  nodeId?: string,
): void {
  const world = getRuntimeWorld()
  const message = error instanceof Error ? error.message : String(error)
  const key = `${phase}|${scriptId}|${nodeId ?? ''}|${message}`
  const count = (runtimeErrorCounts.get(key) ?? 0) + 1
  runtimeErrorCounts.set(key, count)
  const nodeName = nodeId ? world.getNodes()[nodeId]?.name : undefined
  const nodeDesc = nodeId ? ` 节点=${nodeName ? `"${nodeName}"(${nodeId})` : nodeId}` : ''
  if (count === 1) {
    const stack = extractShortStack(error)
    world.log('error', `[${phase}] ${label} (${scriptId})${nodeDesc}: ${message}${stack}`)
  } else if (count === 10 || count === 100 || count === 1000) {
    world.log('error', `[${phase}] ${label} (${scriptId})${nodeDesc} 已重复报错 ${count} 次: ${message}`)
  }
}
const messageQueue: Array<{ targetNodeId: string | null; name: string; payload?: unknown; senderId?: string }> = []
const uiEventHandlers = new Map<string, Map<string, Set<(payload?: unknown) => void>>>()
const uiEventQueue: Array<{ eventName: string; payload: { nodeId: string; kind: string; varId?: string; value?: string } }> = []
let uiClickSubscribed = false
let characterEventSubscribed = false
const globalMemory = new Map<string, unknown>()
const persistentMemory = new Map<string, unknown>()
const navAgents = new Map<string, { scriptId?: string; path: TupleVec3[]; index: number; speed: number }>()

interface PoolBucket {
  all: string[]
  idle: string[]
  templatePos?: TupleVec3
  templateRotDeg?: TupleVec3
  templateScale?: TupleVec3
  templateTagId?: string | null
  templateTagIds?: string[]
}

interface ScriptTimer {
  id: number
  nodeId: string
  scriptId: string
  remaining: number
  interval: number
  repeat: boolean
  callback: () => void
}

interface SplineFollowAgent {
  nodeId: string
  scriptId?: string
  spline: SplinePath
  distance: number
  speed: number
  direction: 1 | -1
  loop: boolean
  pingPong: boolean
  faceDirection: boolean
  planeXZ: boolean
  onArrive?: () => void
}

interface TweenTask {
  id: number
  ownerNodeId: string
  scriptId?: string
  delayRemaining: number
  elapsed: number
  duration: number
  ease: EasingName
  repeat: number
  yoyo: boolean
  reversed: boolean
  completedCount: number
  apply: (t: number) => void
  onUpdate?: (progress: number) => void
  onComplete?: () => void
}

const pooledInactive = new Set<string>()
const nodePoolKey = new Map<string, string>()
const poolBuckets = new Map<string, PoolBucket>()
const scriptTimers = new Map<number, ScriptTimer>()
const splineFollowAgents = new Map<string, SplineFollowAgent>()
const activeTweens = new Map<number, TweenTask>()
const sfxCooldownAt = new Map<string, number>()
let nextTimerId = 1
let nextTweenId = 1

function ensureCharacterEventBridge() {
  if (characterEventSubscribed) return
  characterEventSubscribed = true
  onCharacterEvent((nodeId, event, payload) => {
    if (getRuntimeWorld().getPlayState() !== 'playing') return
    messageQueue.push({ targetNodeId: nodeId, name: event, payload, senderId: nodeId })
  })
}

function ensureUiClickBridge() {
  if (uiClickSubscribed) return
  uiClickSubscribed = true
  onUiClick((action, uiNodeId) => {
    if (getRuntimeWorld().getPlayState() !== 'playing') return
    if (action.kind === 'sendMessage' && action.message) {
      const payload = { nodeId: uiNodeId, kind: action.kind }
      uiEventQueue.push({
        eventName: action.message,
        payload,
      })
      messageQueue.push({
        targetNodeId: null,
        name: action.message,
        payload,
      })
    } else if (action.kind === 'setVariable' && action.varId) {
      uiEventQueue.push({
        eventName: `var:${action.varId}`,
        payload: { nodeId: uiNodeId, kind: action.kind, varId: action.varId, value: action.value },
      })
    }
  })
}

function resolveScreenNodeId(screenIdOrName: string): string | null {
  const nodes = getRuntimeWorld().getNodes()
  if (nodes[screenIdOrName]?.kind === 'screen') return screenIdOrName
  const hit = Object.values(nodes).find((n) => n.kind === 'screen' && n.name === screenIdOrName)
  return hit ? hit.id : null
}
let simElapsed = 0
let framePointerDelta = { x: 0, y: 0 }
let framePointerPos = { x: 0, y: 0 }
let frameWheelDelta = 0
let prevMouseButtons = 0
let currMouseButtons = 0

function mouseButtonMask(button: number): number {
  if (button === 0) return 1
  if (button === 1) return 4
  if (button === 2) return 2
  return 0
}

function instanceKey(nodeId: string, scriptId: string): string {
  return `${nodeId}::${scriptId}`
}

function resolveVec3Input(target: unknown): Vec3Obj | null {
  if (!target || typeof target !== 'object') return null
  const rec = target as { x?: unknown; y?: unknown; z?: unknown; position?: unknown }
  if (typeof rec.x === 'number' && typeof rec.y === 'number' && typeof rec.z === 'number') {
    return { x: rec.x, y: rec.y, z: rec.z }
  }
  if (rec.position && typeof rec.position === 'object') {
    const pos = rec.position as { x?: unknown; y?: unknown; z?: unknown }
    if (typeof pos.x === 'number' && typeof pos.y === 'number' && typeof pos.z === 'number') {
      return { x: pos.x, y: pos.y, z: pos.z }
    }
  }
  return null
}

function toVec3Obj(tuple: TupleVec3): Vec3Obj {
  return { x: tuple[0], y: tuple[1], z: tuple[2] }
}

function makeNodeHandle(nodeId: string, host: SceneRuntimeHost): Record<string, any> | null {
  const world = getRuntimeWorld()
  const node = world.getNodes()[nodeId]
  if (!node) return null
  const obj = host.resolveObject(nodeId)
  const collectTags = (): string[] => {
    const out: string[] = []
    if (node.tagId && !out.includes(node.tagId)) out.push(node.tagId)
    if (Array.isArray(node.tagIds)) {
      for (const t of node.tagIds) {
        if (t && !out.includes(t)) out.push(t)
      }
    }
    for (const rt of listRuntimeTags(node.id)) {
      if (rt.tag && !out.includes(rt.tag)) out.push(rt.tag)
    }
    return out
  }
  return {
    get id() { return node.id },
    get name() { return node.name },
    get tags() { return collectTags() },
    get parent() { return node.parentId ? makeNodeHandle(node.parentId, host) : null },
    get position(): Vec3Obj {
      return obj
        ? { x: obj.position.x, y: obj.position.y, z: obj.position.z }
        : toVec3Obj(node.position)
    },
    set position(val: Vec3Obj) {
      if (!val || typeof val !== 'object') return
      const x = typeof val.x === 'number' && Number.isFinite(val.x) ? val.x : (obj ? obj.position.x : node.position[0])
      const y = typeof val.y === 'number' && Number.isFinite(val.y) ? val.y : (obj ? obj.position.y : node.position[1])
      const z = typeof val.z === 'number' && Number.isFinite(val.z) ? val.z : (obj ? obj.position.z : node.position[2])
      if (obj) obj.position.set(x, y, z)
      node.position[0] = x
      node.position[1] = y
      node.position[2] = z
    },
    get rotation(): Vec3Obj {
      return obj
        ? { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z }
        : {
            x: (node.rotation[0] * Math.PI) / 180,
            y: (node.rotation[1] * Math.PI) / 180,
            z: (node.rotation[2] * Math.PI) / 180,
          }
    },
    set rotation(val: Vec3Obj) {
      if (obj) obj.rotation.set(val.x, val.y, val.z)
      node.rotation[0] = (val.x * 180) / Math.PI
      node.rotation[1] = (val.y * 180) / Math.PI
      node.rotation[2] = (val.z * 180) / Math.PI
    },
    get scale(): Vec3Obj {
      return obj
        ? { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z }
        : toVec3Obj(node.scale)
    },
    set scale(val: Vec3Obj) {
      if (obj) obj.scale.set(val.x, val.y, val.z)
      node.scale[0] = val.x
      node.scale[1] = val.y
      node.scale[2] = val.z
    },
    get visible(): boolean {
      if (pooledInactive.has(nodeId)) return false
      return obj ? obj.visible : node.visible
    },
    set visible(val: boolean) {
      if (obj) obj.visible = val
      node.visible = val
      if (!nodePoolKey.has(nodeId)) {
        world.updateNode(nodeId, { visible: val })
      }
    },
    hasTag: (tag: string) => nodeHasTag(node, String(tag ?? '')),
    addTag: (tag: string) => {
      const t = String(tag ?? '').trim()
      if (!t) return
      const list = Array.isArray(node.tagIds) ? [...node.tagIds] : []
      if (!list.includes(t)) {
        list.push(t)
        node.tagIds = list
      }
    },
    removeTag: (tag: string) => {
      const t = String(tag ?? '').trim()
      if (!t) return
      if (node.tagId === t) node.tagId = undefined
      if (Array.isArray(node.tagIds)) {
        node.tagIds = node.tagIds.filter((x) => x !== t)
      }
    },
    getChildren: () => {
      const all = world.getNodes()
      return Object.values(all)
        .filter((c) => c.parentId === node.id && !isNodePooledInactive(c.id, all))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((c) => makeNodeHandle(c.id, host))
        .filter(Boolean)
    },
    sendMessage: (name: string, payload?: unknown) => {
      messageQueue.push({ targetNodeId: nodeId, name, payload })
    },
    getBehavior: (behavior: BehaviorDefinition) => {
      const targetEntry = Object.entries(node.gameplay?.packs?.__project__ ?? {}).find(
        ([sid]) => compiledBehaviors.get(sid) === behavior || compiledBehaviors.get(sid)?.name === behavior?.name,
      )
      if (!targetEntry) return null
      const [sid, rawParams] = targetEntry
      const rec = instanceStates.get(instanceKey(nodeId, sid))
      if (!rec) return null
      const ctx = buildScriptContext(node, sid, rawParams, rec.state, host)
      const wrapped: Record<string, (...args: unknown[]) => unknown> = {}
      for (const [mName, fn] of Object.entries(behavior.methods ?? {})) {
        wrapped[mName] = (...args: unknown[]) => fn(ctx, ...args)
      }
      return wrapped
    },
    destroy: () => {
      destroyOrReleaseNode(nodeId, host)
    },
  }
}

function cancelTimersForNode(nodeId: string): void {
  for (const [tid, t] of scriptTimers.entries()) {
    if (t.nodeId === nodeId) scriptTimers.delete(tid)
  }
  splineFollowAgents.delete(nodeId)
  for (const [twId, tw] of activeTweens.entries()) {
    if (tw.ownerNodeId === nodeId) activeTweens.delete(twId)
  }
}

function resolveSplinePointsInput(
  input: unknown,
  host: SceneRuntimeHost,
): { points: Vec3Obj[]; closed?: boolean; tension?: number } {
  const world = getRuntimeWorld()
  const nodes = world.getNodes()
  if (Array.isArray(input)) {
    const pts: Vec3Obj[] = []
    for (const item of input) {
      const v = resolveVec3Input(item)
      if (v) pts.push(v)
    }
    return { points: pts }
  }
  const parentNode = resolveTemplateNode(input as string | { id?: string } | null | undefined, nodes)
  if (!parentNode) return { points: [] }

  // 优先读取 Spline 曲线节点的 splinePath 控制点
  const rawSplinePath = parentNode.capabilities?.splinePath as
    | { points?: unknown; closed?: boolean; tension?: number }
    | undefined
  if (parentNode.kind === 'spline' || rawSplinePath) {
    const pathObj = host.resolveObject(parentNode.id)
    if (pathObj) pathObj.updateMatrixWorld()
    const rawPts = Array.isArray(rawSplinePath?.points) ? rawSplinePath.points : []
    const pts: Vec3Obj[] = []
    for (const p of rawPts) {
      if (!Array.isArray(p) || p.length < 3) continue
      const lx = Number(p[0]) || 0
      const ly = Number(p[1]) || 0
      const lz = Number(p[2]) || 0
      if (pathObj) {
        const v = new Vector3(lx, ly, lz).applyMatrix4(pathObj.matrixWorld)
        pts.push({ x: v.x, y: v.y, z: v.z })
      } else {
        pts.push({
          x: parentNode.position[0] + lx,
          y: parentNode.position[1] + ly,
          z: parentNode.position[2] + lz,
        })
      }
    }
    return {
      points: pts,
      closed: typeof rawSplinePath?.closed === 'boolean' ? rawSplinePath.closed : undefined,
      tension: typeof rawSplinePath?.tension === 'number' ? rawSplinePath.tension : undefined,
    }
  }

  const children = Object.values(nodes)
    .filter((n) => n.parentId === parentNode.id && !isNodePooledInactive(n.id, nodes))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const targets = children.length > 0 ? children : [parentNode]
  return {
    points: targets.map((n) => {
      const obj = host.resolveObject(n.id)
      return obj
        ? { x: obj.position.x, y: obj.position.y, z: obj.position.z }
        : toVec3Obj(n.position)
    }),
  }
}

function buildCurveApi() {
  return {
    create: (keys: readonly CurveKeyInput[], options?: { wrap?: 'clamp' | 'loop' | 'pingPong' }) =>
      createAnimationCurve(keys, options),
    eval: (keys: readonly CurveKeyInput[], t: number, options?: { wrap?: 'clamp' | 'loop' | 'pingPong' }) =>
      createAnimationCurve(keys, options).eval(t),
    ease: (name: EasingName, t: number) => evalEasing(name, t),
    parabola: (t: number, height = 1) => {
      const u = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0))
      return 4 * u * (1 - u) * height
    },
    pulse: (t: number) => {
      const u = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0))
      return Math.sin(u * Math.PI)
    },
  }
}

function isNodePooledInactive(nodeId: string, nodes: Record<string, SceneNode>): boolean {
  let cur: string | null = nodeId
  let guard = 0
  while (cur && guard < 16) {
    if (pooledInactive.has(cur)) return true
    cur = nodes[cur]?.parentId ?? null
    guard += 1
  }
  return false
}

function resolveTemplateNode(
  templateOrName: string | { id?: string } | null | undefined,
  nodes: Record<string, SceneNode>,
): SceneNode | null {
  if (!templateOrName) return null
  if (typeof templateOrName === 'object' && typeof templateOrName.id === 'string') {
    return nodes[templateOrName.id] ?? null
  }
  if (typeof templateOrName === 'string') {
    const key = templateOrName.trim()
    if (!key) return null
    if (nodes[key]) return nodes[key]
    return Object.values(nodes).find((n) => n.name === key) ?? null
  }
  return null
}

function cloneSceneSubtree(
  templateNode: SceneNode,
  options: {
    position?: Vec3Obj
    rotation?: Vec3Obj
    scale?: Vec3Obj
    parent?: { id?: string } | string | null
    visible?: boolean
    name?: string
  } | undefined,
  host: SceneRuntimeHost,
): string | null {
  const world = getRuntimeWorld()
  const allNodes = world.getNodes()
  const clonedMap: Record<string, SceneNode> = {}
  const idMap = new Map<string, string>()

  const collect = (srcId: string) => {
    const src = allNodes[srcId]
    if (!src) return
    const nextId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `rt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    idMap.set(srcId, nextId)
    for (const child of Object.values(allNodes)) {
      if (child.parentId === srcId) collect(child.id)
    }
  }
  collect(templateNode.id)
  if (idMap.size === 0) return null

  const rootNewId = idMap.get(templateNode.id)!
  const parentOpt = options?.parent
  const resolvedParentId = parentOpt === undefined
    ? templateNode.parentId
    : parentOpt === null
      ? null
      : typeof parentOpt === 'string'
        ? (allNodes[parentOpt]?.id ?? Object.values(allNodes).find((n) => n.name === parentOpt)?.id ?? null)
        : (parentOpt.id ?? null)

  for (const [oldId, newId] of idMap.entries()) {
    const src = allNodes[oldId]
    const copy = structuredClone(src) as SceneNode
    copy.id = newId
    if (oldId === templateNode.id) {
      copy.parentId = resolvedParentId
      copy.visible = options?.visible !== undefined ? options.visible : true
      if (options?.name) copy.name = options.name
      else copy.name = `${src.name}_${newId.slice(0, 4)}`
      const posVec = resolveVec3Input(options?.position)
      if (posVec) copy.position = [posVec.x, posVec.y, posVec.z]
      const rotVec = resolveVec3Input(options?.rotation)
      if (rotVec) {
        copy.rotation = [
          (rotVec.x * 180) / Math.PI,
          (rotVec.y * 180) / Math.PI,
          (rotVec.z * 180) / Math.PI,
        ]
      }
      const scaleVec = resolveVec3Input(options?.scale)
      if (scaleVec) copy.scale = [scaleVec.x, scaleVec.y, scaleVec.z]
    } else {
      copy.parentId = src.parentId ? (idMap.get(src.parentId) ?? null) : null
    }
    delete copy.prefabAssetId
    delete copy.prefabInstanceId
    delete copy.prefabTemplateId
    delete copy.prefabHostTemplateId
    clonedMap[newId] = copy
  }

  world.setNodes({ ...allNodes, ...clonedMap })
  const spawnedObj = host.resolveObject(rootNewId)
  if (spawnedObj) {
    const rootNode = clonedMap[rootNewId]
    spawnedObj.visible = rootNode.visible
    spawnedObj.position.set(rootNode.position[0], rootNode.position[1], rootNode.position[2])
    spawnedObj.rotation.set(
      (rootNode.rotation[0] * Math.PI) / 180,
      (rootNode.rotation[1] * Math.PI) / 180,
      (rootNode.rotation[2] * Math.PI) / 180,
    )
    spawnedObj.scale.set(rootNode.scale[0], rootNode.scale[1], rootNode.scale[2])
  }
  return rootNewId
}

function spawnFromTemplateOrPrefab(
  templateOrPrefab: string | { id?: string } | null | undefined,
  options: {
    position?: Vec3Obj
    rotation?: Vec3Obj
    scale?: Vec3Obj
    parent?: { id?: string } | string | null
    visible?: boolean
    name?: string
  } | undefined,
  host: SceneRuntimeHost,
): {
  rootId: string
  templatePos?: TupleVec3
  templateRotDeg?: TupleVec3
  templateScale?: TupleVec3
  templateTagId?: string | null
  templateTagIds?: string[]
} | null {
  const world = getRuntimeWorld()
  const nodes = world.getNodes()
  const tplNode = resolveTemplateNode(templateOrPrefab, nodes)
  if (tplNode) {
    const rootId = cloneSceneSubtree(tplNode, options, host)
    if (!rootId) return null
    return {
      rootId,
      templatePos: [...tplNode.position],
      templateRotDeg: [...tplNode.rotation],
      templateScale: [...tplNode.scale],
      templateTagId: tplNode.tagId,
      templateTagIds: tplNode.tagIds ? [...tplNode.tagIds] : undefined,
    }
  }
  if (typeof templateOrPrefab === 'string' && templateOrPrefab.trim()) {
    const posVec = resolveVec3Input(options?.position)
    const pos: TupleVec3 = posVec ? [posVec.x, posVec.y, posVec.z] : [0, 0, 0]
    const parentOpt = options?.parent
    const parentId = typeof parentOpt === 'string' ? parentOpt : parentOpt && 'id' in parentOpt ? (parentOpt.id ?? null) : null
    const rootId = world.instantiatePrefab?.(templateOrPrefab.trim(), { parentId, position: pos }) ?? null
    if (!rootId) return null
    const spawned = world.getNodes()[rootId]
    if (spawned) {
      if (options?.visible !== undefined) spawned.visible = options.visible
      if (options?.name) spawned.name = options.name
      const rotVec = resolveVec3Input(optsOrRot(options?.rotation))
      if (rotVec) {
        spawned.rotation = [(rotVec.x * 180) / Math.PI, (rotVec.y * 180) / Math.PI, (rotVec.z * 180) / Math.PI]
      }
      const scaleVec = resolveVec3Input(options?.scale)
      if (scaleVec) spawned.scale = [scaleVec.x, scaleVec.y, scaleVec.z]
      const spawnedObj = host.resolveObject(rootId)
      if (spawnedObj) {
        spawnedObj.visible = spawned.visible
        spawnedObj.position.set(spawned.position[0], spawned.position[1], spawned.position[2])
        spawnedObj.rotation.set(
          (spawned.rotation[0] * Math.PI) / 180,
          (spawned.rotation[1] * Math.PI) / 180,
          (spawned.rotation[2] * Math.PI) / 180,
        )
        spawnedObj.scale.set(spawned.scale[0], spawned.scale[1], spawned.scale[2])
      }
      return {
        rootId,
        templatePos: [0, 0, 0],
        templateRotDeg: [...spawned.rotation],
        templateScale: [...spawned.scale],
        templateTagId: spawned.tagId,
        templateTagIds: spawned.tagIds ? [...spawned.tagIds] : undefined,
      }
    }
    return { rootId }
  }
  return null
}

function optsOrRot(rot: Vec3Obj | undefined) {
  return rot
}

function resetAndInvokeSpawn(nodeId: string, payload: unknown, host: SceneRuntimeHost): void {
  const nodes = getRuntimeWorld().getNodes()
  const targetNode = nodes[nodeId]
  if (!targetNode) return

  const subtreeIds: string[] = []
  const collectSubtree = (id: string) => {
    subtreeIds.push(id)
    for (const candidate of Object.values(nodes)) {
      if (candidate.parentId === id) collectSubtree(candidate.id)
    }
  }
  collectSubtree(nodeId)

  for (const subId of subtreeIds) {
    const subNode = nodes[subId]
    if (!subNode) continue
    const projectScripts = subNode.gameplay?.packs?.__project__
    if (!projectScripts || typeof projectScripts !== 'object') continue
    for (const [sid, rawParams] of Object.entries(projectScripts as Record<string, unknown>)) {
      if (rawParams && typeof rawParams === 'object' && (rawParams as Record<string, unknown>).__enabled === false) continue
      const def = compiledBehaviors.get(sid)
      if (!def) continue
      const key = instanceKey(subId, sid)
      const rec: BehaviorInstanceRecord = {
        nodeId: subId,
        scriptId: sid,
        started: true,
        enabled: true,
        lastRawParams: rawParams,
        state: def.state ? { ...def.state() } : {},
      }
      instanceStates.set(key, rec)
      const ctx = buildScriptContext(subNode, sid, rawParams, rec.state, host)
      try {
        def.onStart?.(ctx)
        def.onEnable?.(ctx)
        def.onSpawn?.(ctx, payload)
      } catch (error) {
        reportRuntimeError('onSpawn', sid, `脚本 "${def.name}"`, error, subId)
      }
    }
  }
}

function releaseToPool(nodeId: string, host: SceneRuntimeHost): boolean {
  const pKey = nodePoolKey.get(nodeId)
  if (!pKey) return false
  const bucket = poolBuckets.get(pKey)
  if (!bucket) return false
  if (pooledInactive.has(nodeId)) return true
  pooledInactive.add(nodeId)
  const nodes = getRuntimeWorld().getNodes()
  const resetSubtree = (id: string) => {
    cancelTimersForNode(id)
    navAgents.delete(id)
    resetProjectileState(id)
    stopCrowdAgent(id)
    splineFollowAgents.delete(id)
    for (const [tid, tw] of activeTweens.entries()) {
      if (tw.ownerNodeId === id) activeTweens.delete(tid)
    }
    if (nodes[id]?.physics) {
      setPhysicsVelocity(id, [0, 0, 0])
    }
    for (const child of Object.values(nodes)) {
      if (child.parentId === id) resetSubtree(child.id)
    }
  }
  resetSubtree(nodeId)
  const obj = host.resolveObject(nodeId)
  if (obj) obj.visible = false
  const n = nodes[nodeId]
  if (n) n.visible = false
  if (!bucket.idle.includes(nodeId)) {
    bucket.idle.push(nodeId)
  }
  return true
}

function destroyOrReleaseNode(nodeId: string, host: SceneRuntimeHost): void {
  if (releaseToPool(nodeId, host)) return
  cancelTimersForNode(nodeId)
  navAgents.delete(nodeId)
  const world = getRuntimeWorld()
  const prev = world.getNodes()
  if (!prev[nodeId]) return
  const next = { ...prev }
  const removeTree = (id: string) => {
    delete next[id]
    cancelTimersForNode(id)
    for (const child of Object.values(prev)) {
      if (child.parentId === id) removeTree(child.id)
    }
  }
  removeTree(nodeId)
  world.setNodes(next)
}

function resolvePoolKey(templateOrPrefab: string | { id?: string } | null | undefined): string | null {
  if (!templateOrPrefab) return null
  if (typeof templateOrPrefab === 'object' && typeof templateOrPrefab.id === 'string') {
    return `node:${templateOrPrefab.id}`
  }
  if (typeof templateOrPrefab === 'string' && templateOrPrefab.trim()) {
    return `ref:${templateOrPrefab.trim()}`
  }
  return null
}

function resolveParamValue(schema: FieldSchema, rawVal: unknown, host: SceneRuntimeHost): unknown {
  if (schema.type === 'vec2' && Array.isArray(rawVal)) {
    return { x: Number(rawVal[0]) || 0, y: Number(rawVal[1]) || 0 }
  }
  if (schema.type === 'vec3' && Array.isArray(rawVal)) {
    return { x: Number(rawVal[0]) || 0, y: Number(rawVal[1]) || 0, z: Number(rawVal[2]) || 0 }
  }
  if (schema.type === 'ref' && schema.target === 'node' && typeof rawVal === 'string') {
    return makeNodeHandle(rawVal, host)
  }
  return rawVal
}

function buildScriptContext(
  node: SceneNode,
  scriptId: string,
  rawParams: unknown,
  stateObj: Record<string, unknown>,
  host: SceneRuntimeHost,
) {
  const world = getRuntimeWorld()
  const def = compiledBehaviors.get(scriptId)
  const paramSchemas = def?.params ?? {}
  const readLatestInputRecord = (): Record<string, unknown> => {
    const liveNode = world.getNodes()[node.id]
    const liveRaw = (liveNode?.gameplay?.packs?.__project__ as Record<string, unknown> | undefined)?.[scriptId]
    const chosen = liveRaw !== undefined ? liveRaw : rawParams
    return chosen && typeof chosen === 'object' ? (chosen as Record<string, unknown>) : {}
  }
  // 使用 Proxy 动态读取最新节点参数，确保 onStart / after / tween 等回调闭包捕获的 self.params 在 Play 调参时也能实时生效
  const liveParams = new Proxy(paramSchemas as Record<string, unknown>, {
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined
      const schema = paramSchemas[prop]
      if (!schema) return undefined
      const inputRecord = readLatestInputRecord()
      const val = prop in inputRecord ? inputRecord[prop] : defaultForSchema(schema)
      return resolveParamValue(schema, val, host)
    },
    has(_target, prop) {
      return typeof prop === 'string' && prop in paramSchemas
    },
    ownKeys() {
      return Object.keys(paramSchemas)
    },
    getOwnPropertyDescriptor(_target, prop) {
      if (typeof prop !== 'string' || !(prop in paramSchemas)) return undefined
      return { enumerable: true, configurable: true }
    },
  })

  const handle = makeNodeHandle(node.id, host)!
  const obj = host.resolveObject(node.id)

  return {
    node: handle,
    params: liveParams,
    state: stateObj,
    get elapsedTime() { return simElapsed },
    get position() { return handle.position },
    set position(v: Vec3Obj) { handle.position = v },
    get rotation() { return handle.rotation },
    set rotation(v: Vec3Obj) { handle.rotation = v },
    get scale() { return handle.scale },
    set scale(v: Vec3Obj) { handle.scale = v },
    get visible() { return handle.visible },
    set visible(v: boolean) { handle.visible = v },
    get enabled() { return readLatestInputRecord().__enabled !== false },
    hasTag: (tag: string) => handle.hasTag(tag),
    addTag: (tag: string) => handle.addTag(tag),
    removeTag: (tag: string) => handle.removeTag(tag),
    get forward(): Vec3Obj {
      const yaw = handle.rotation.y
      return { x: Math.sin(yaw), y: 0, z: Math.cos(yaw) }
    },
    get right(): Vec3Obj {
      const yaw = handle.rotation.y
      return { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) }
    },
    distanceTo(target: Vec3Obj | { position?: Vec3Obj }): number {
      const vec = resolveVec3Input(target)
      if (!vec) return Number.POSITIVE_INFINITY
      const cur = handle.position
      return Math.hypot(vec.x - cur.x, vec.y - cur.y, vec.z - cur.z)
    },
    directionTo(target: Vec3Obj | { position?: Vec3Obj }, options?: { planeXZ?: boolean }): Vec3Obj {
      const vec = resolveVec3Input(target)
      if (!vec) return { x: 0, y: 0, z: 1 }
      const cur = handle.position
      const dx = vec.x - cur.x
      const dy = options?.planeXZ ? 0 : vec.y - cur.y
      const dz = vec.z - cur.z
      const len = Math.hypot(dx, dy, dz)
      if (len <= 1e-6) return { x: 0, y: 0, z: 1 }
      return { x: dx / len, y: dy / len, z: dz / len }
    },
    translate(delta: Vec3Obj, space: 'local' | 'world' = 'world'): void {
      const cur = handle.position
      if (space === 'local') {
        const yaw = handle.rotation.y
        const sinY = Math.sin(yaw)
        const cosY = Math.cos(yaw)
        const wx = delta.x * cosY + delta.z * sinY
        const wz = -delta.x * sinY + delta.z * cosY
        handle.position = { x: cur.x + wx, y: cur.y + delta.y, z: cur.z + wz }
      } else {
        handle.position = { x: cur.x + delta.x, y: cur.y + delta.y, z: cur.z + delta.z }
      }
    },
    rotateY(radians: number): void {
      const rot = handle.rotation
      handle.rotation = { x: rot.x, y: rot.y + radians, z: rot.z }
    },
    moveToward(
      target: Vec3Obj | { position?: Vec3Obj },
      maxDistance: number,
      options?: { faceTarget?: boolean; planeXZ?: boolean },
    ): boolean {
      const vec = resolveVec3Input(target)
      if (!vec) return false
      const cur = handle.position
      const dx = vec.x - cur.x
      const dy = options?.planeXZ ? 0 : vec.y - cur.y
      const dz = vec.z - cur.z
      const dist = Math.hypot(dx, dy, dz)
      if (options?.faceTarget && (Math.abs(dx) > 1e-5 || Math.abs(dz) > 1e-5)) {
        const yaw = Math.atan2(dx, dz)
        const r = handle.rotation
        handle.rotation = { x: r.x, y: yaw, z: r.z }
      }
      if (dist <= 1e-4 || dist <= maxDistance) {
        handle.position = { x: vec.x, y: options?.planeXZ ? cur.y : vec.y, z: vec.z }
        return true
      }
      const ratio = maxDistance / dist
      handle.position = {
        x: cur.x + dx * ratio,
        y: cur.y + dy * ratio,
        z: cur.z + dz * ratio,
      }
      return false
    },
    lookAt(target: Vec3Obj | { position?: Vec3Obj }, options?: { yOnly?: boolean }) {
      const vec = resolveVec3Input(target)
      if (!vec || !Number.isFinite(vec.x) || !Number.isFinite(vec.y) || !Number.isFinite(vec.z)) return
      const cur = handle.position
      if (options?.yOnly) {
        const dx = vec.x - cur.x
        const dz = vec.z - cur.z
        if (Math.abs(dx) > 1e-5 || Math.abs(dz) > 1e-5) {
          const r = handle.rotation
          handle.rotation = { x: r.x, y: Math.atan2(dx, dz), z: r.z }
        }
        return
      }
      if (!obj) {
        const dx = vec.x - cur.x
        const dz = vec.z - cur.z
        const dy = vec.y - cur.y
        const horiz = Math.hypot(dx, dz)
        const yaw = Math.atan2(dx, dz)
        const pitch = -Math.atan2(dy, Math.max(1e-5, horiz))
        handle.rotation = { x: pitch, y: yaw, z: 0 }
        return
      }
      if (node.kind === 'camera') {
        const p = obj.position
        obj.lookAt(2 * p.x - vec.x, 2 * p.y - vec.y, 2 * p.z - vec.z)
      } else {
        obj.lookAt(vec.x, vec.y, vec.z)
      }
      node.rotation[0] = (obj.rotation.x * 180) / Math.PI
      node.rotation[1] = (obj.rotation.y * 180) / Math.PI
      node.rotation[2] = (obj.rotation.z * 180) / Math.PI
    },
    sendMessage(name: string, payload?: unknown) {
      messageQueue.push({ targetNodeId: node.id, name, payload, senderId: node.id })
    },
    broadcast(name: string, payload?: unknown) {
      messageQueue.push({ targetNodeId: null, name, payload, senderId: node.id })
    },
    getBehavior: (behavior: BehaviorDefinition) => handle.getBehavior(behavior),
    findNodeById: (id: string) => makeNodeHandle(id, host),
    findNodesByTag: (tag: string) => {
      const all = world.getNodes()
      return Object.values(all)
        .filter((n) => !isNodePooledInactive(n.id, all) && nodeHasTag(n, tag))
        .map((n) => makeNodeHandle(n.id, host))
        .filter(Boolean)
    },
    findNodesInRadius: (center: Vec3Obj, radius: number, tag?: string) => {
      const r2 = radius * radius
      const all = world.getNodes()
      return Object.values(all)
        .filter((n) => {
          if (isNodePooledInactive(n.id, all)) return false
          if (tag && !nodeHasTag(n, tag)) return false
          const p = host.resolveObject(n.id)?.position
          const x = p ? p.x : n.position[0]
          const y = p ? p.y : n.position[1]
          const z = p ? p.z : n.position[2]
          const dx = x - center.x
          const dy = y - center.y
          const dz = z - center.z
          return dx * dx + dy * dy + dz * dz <= r2
        })
        .map((n) => makeNodeHandle(n.id, host))
        .filter(Boolean)
    },
    cloneNode: (
      templateOrName: string | { id?: string },
      opts?: {
        position?: Vec3Obj
        rotation?: Vec3Obj
        scale?: Vec3Obj
        parent?: { id?: string } | string | null
        visible?: boolean
        name?: string
        initMessage?: string
        initPayload?: unknown
      },
    ) => {
      const tpl = resolveTemplateNode(templateOrName, world.getNodes())
      if (!tpl) return null
      const spawnedId = cloneSceneSubtree(tpl, opts, host)
      if (!spawnedId) return null
      if (opts?.initMessage) {
        messageQueue.push({ targetNodeId: spawnedId, name: opts.initMessage, payload: opts.initPayload, senderId: node.id })
      }
      return makeNodeHandle(spawnedId, host)
    },
    spawnPrefab: (
      prefabId: string,
      opts?: { position?: Vec3Obj; rotation?: Vec3Obj; scale?: Vec3Obj; parent?: { id?: string } | string | null; name?: string },
    ) => {
      const posVec = resolveVec3Input(opts?.position)
      const pos: TupleVec3 = posVec ? [posVec.x, posVec.y, posVec.z] : [0, 0, 0]
      const parentId = typeof opts?.parent === 'string'
        ? opts.parent
        : opts?.parent && typeof opts.parent === 'object'
          ? (opts.parent.id ?? null)
          : null
      const spawnedId = world.instantiatePrefab?.(prefabId, { parentId, position: pos }) ?? null
      if (!spawnedId) return null
      const spawnedNode = world.getNodes()[spawnedId]
      if (spawnedNode) {
        if (opts?.name) spawnedNode.name = opts.name
        const rotVec = resolveVec3Input(opts?.rotation)
        if (rotVec) {
          spawnedNode.rotation = [(rotVec.x * 180) / Math.PI, (rotVec.y * 180) / Math.PI, (rotVec.z * 180) / Math.PI]
        }
        const scaleVec = resolveVec3Input(opts?.scale)
        if (scaleVec) spawnedNode.scale = [scaleVec.x, scaleVec.y, scaleVec.z]
      }
      return makeNodeHandle(spawnedId, host)
    },
    destroyNode: (target: { id?: string } | string) => {
      const targetId = typeof target === 'string' ? target : target?.id
      if (targetId) destroyOrReleaseNode(targetId, host)
    },
    pool: {
      preload: (templateOrPrefab: string | { id?: string }, count: number) => {
        const key = resolvePoolKey(templateOrPrefab)
        if (!key) return
        const targetCount = Math.max(0, Math.min(200, Math.floor(count)))
        let bucket = poolBuckets.get(key)
        if (!bucket) {
          bucket = { all: [], idle: [] }
          poolBuckets.set(key, bucket)
        }
        while (bucket.all.length < targetCount) {
          const spawned = spawnFromTemplateOrPrefab(templateOrPrefab, { visible: false }, host)
          if (!spawned) break
          if (!bucket.templatePos && spawned.templatePos) bucket.templatePos = spawned.templatePos
          if (!bucket.templateRotDeg && spawned.templateRotDeg) bucket.templateRotDeg = spawned.templateRotDeg
          if (!bucket.templateScale && spawned.templateScale) bucket.templateScale = spawned.templateScale
          if (bucket.templateTagId === undefined && spawned.templateTagId !== undefined) bucket.templateTagId = spawned.templateTagId
          if (bucket.templateTagIds === undefined && spawned.templateTagIds !== undefined) bucket.templateTagIds = spawned.templateTagIds
          pooledInactive.add(spawned.rootId)
          nodePoolKey.set(spawned.rootId, key)
          bucket.all.push(spawned.rootId)
          bucket.idle.push(spawned.rootId)
        }
      },
      acquire: (
        templateOrPrefab: string | { id?: string },
        opts?: { position?: Vec3Obj; rotation?: Vec3Obj; scale?: Vec3Obj; payload?: unknown },
      ) => {
        const key = resolvePoolKey(templateOrPrefab)
        if (!key) return null
        let bucket = poolBuckets.get(key)
        if (!bucket) {
          bucket = { all: [], idle: [] }
          poolBuckets.set(key, bucket)
        }
        const allNodes = world.getNodes()
        let pickedId: string | null = null
        while (bucket.idle.length > 0) {
          const cand = bucket.idle.pop()!
          if (allNodes[cand]) {
            pickedId = cand
            break
          }
        }
        if (!pickedId) {
          const spawned = spawnFromTemplateOrPrefab(templateOrPrefab, {
            position: opts?.position,
            rotation: opts?.rotation,
            scale: opts?.scale,
            visible: true,
          }, host)
          if (!spawned) return null
          if (!bucket.templatePos && spawned.templatePos) bucket.templatePos = spawned.templatePos
          if (!bucket.templateRotDeg && spawned.templateRotDeg) bucket.templateRotDeg = spawned.templateRotDeg
          if (!bucket.templateScale && spawned.templateScale) bucket.templateScale = spawned.templateScale
          if (bucket.templateTagId === undefined && spawned.templateTagId !== undefined) bucket.templateTagId = spawned.templateTagId
          if (bucket.templateTagIds === undefined && spawned.templateTagIds !== undefined) bucket.templateTagIds = spawned.templateTagIds
          pickedId = spawned.rootId
          nodePoolKey.set(pickedId, key)
          bucket.all.push(pickedId)
        } else {
          pooledInactive.delete(pickedId)
          const n = world.getNodes()[pickedId]
          const objTarget = host.resolveObject(pickedId)
          const posVec = resolveVec3Input(opts?.position)
          const rotVec = resolveVec3Input(opts?.rotation)
          const scaleVec = resolveVec3Input(opts?.scale)
          if (n) {
            n.visible = true
            n.tagId = bucket.templateTagId
            n.tagIds = bucket.templateTagIds ? [...bucket.templateTagIds] : undefined
            if (posVec) n.position = [posVec.x, posVec.y, posVec.z]
            else if (bucket.templatePos) n.position = [...bucket.templatePos]
            if (rotVec) n.rotation = [(rotVec.x * 180) / Math.PI, (rotVec.y * 180) / Math.PI, (rotVec.z * 180) / Math.PI]
            else if (bucket.templateRotDeg) n.rotation = [...bucket.templateRotDeg]
            if (scaleVec) n.scale = [scaleVec.x, scaleVec.y, scaleVec.z]
            else if (bucket.templateScale) n.scale = [...bucket.templateScale]
          }
          if (objTarget && n) {
            objTarget.visible = true
            objTarget.position.set(n.position[0], n.position[1], n.position[2])
            objTarget.rotation.set(
              (n.rotation[0] * Math.PI) / 180,
              (n.rotation[1] * Math.PI) / 180,
              (n.rotation[2] * Math.PI) / 180,
            )
            objTarget.scale.set(n.scale[0], n.scale[1], n.scale[2])
          }
        }
        resetAndInvokeSpawn(pickedId, opts?.payload, host)
        return makeNodeHandle(pickedId, host)
      },
      release: (target: { id?: string } | string) => {
        const targetId = typeof target === 'string' ? target : target?.id
        if (targetId) destroyOrReleaseNode(targetId, host)
      },
      stats: (templateOrPrefab?: string | { id?: string }) => {
        if (templateOrPrefab) {
          const key = resolvePoolKey(templateOrPrefab)
          const b = key ? poolBuckets.get(key) : undefined
          const total = b ? b.all.length : 0
          const pooled = b ? b.idle.length : 0
          return { active: Math.max(0, total - pooled), pooled, total }
        }
        let total = 0
        let pooled = 0
        for (const b of poolBuckets.values()) {
          total += b.all.length
          pooled += b.idle.length
        }
        return { active: Math.max(0, total - pooled), pooled, total }
      },
    },
    after: (seconds: number, callback: () => void) => {
      const id = nextTimerId++
      const delay = Math.max(0, Number(seconds) || 0)
      scriptTimers.set(id, { id, nodeId: node.id, scriptId, remaining: delay, interval: delay, repeat: false, callback })
      return id
    },
    every: (seconds: number, callback: () => void) => {
      const id = nextTimerId++
      const interval = Math.max(0.016, Number(seconds) || 0.1)
      scriptTimers.set(id, { id, nodeId: node.id, scriptId, remaining: interval, interval, repeat: true, callback })
      return id
    },
    cancelTimer: (timerId: number) => {
      scriptTimers.delete(timerId)
    },
    physics: {
      raycast: (origin: Vec3Obj, dir: Vec3Obj, maxDistance: number) => {
        const dist = host.probe?.(
          [origin.x, origin.y, origin.z],
          [dir.x, dir.y, dir.z],
          maxDistance,
          node.id,
        )
        if (dist === null || dist === undefined) return null
        return {
          node: handle,
          point: {
            x: origin.x + dir.x * dist,
            y: origin.y + dir.y * dist,
            z: origin.z + dir.z * dist,
          },
          normal: { x: 0, y: 1, z: 0 },
          distance: dist,
        }
      },
      sphereCast: (center: Vec3Obj, radius: number, options?: { tag?: string }) => {
        const nodes = world.getNodes()
        const r2 = radius * radius
        const hits = []
        for (const n of Object.values(nodes)) {
          if (!n.visible || n.id === node.id || isNodePooledInactive(n.id, nodes)) continue
          if (options?.tag && n.tagId !== options.tag && !n.tagIds?.includes(options.tag)) continue
          const o = host.resolveObject(n.id)
          const px = o ? o.position.x : n.position[0]
          const py = o ? o.position.y : n.position[1]
          const pz = o ? o.position.z : n.position[2]
          const dx = px - center.x
          const dy = py - center.y
          const dz = pz - center.z
          if (dx * dx + dy * dy + dz * dz <= r2) {
            const h = makeNodeHandle(n.id, host)
            if (h) hits.push(h)
          }
        }
        return hits
      },
      getVelocity: () => {
        const st = getPhysicsBodyState(node.id)
        if (!st) return { x: 0, y: 0, z: 0 }
        return { x: st.linvel[0], y: st.linvel[1], z: st.linvel[2] }
      },
      setVelocity: (velocity: Vec3Obj) => {
        setPhysicsVelocity(node.id, [velocity.x, velocity.y, velocity.z])
      },
      applyImpulse: (impulse: Vec3Obj) => {
        applyPhysicsImpulse(node.id, [impulse.x, impulse.y, impulse.z])
      },
      applyForce: (force: Vec3Obj) => {
        applyPhysicsForce(node.id, [force.x, force.y, force.z])
      },
    },
    nav: {
      moveTo: (target: Vec3Obj, speed = 3.5) => {
        const cur = handle.position
        const path = findNavigationPath([cur.x, cur.y, cur.z], [target.x, target.y, target.z])
        if (!path || path.length === 0) {
          navAgents.delete(node.id)
          return false
        }
        navAgents.set(node.id, { scriptId, path, index: 0, speed: Math.max(0.1, speed) })
        return true
      },
      stop: () => {
        navAgents.delete(node.id)
      },
      get isMoving() {
        return navAgents.has(node.id)
      },
    },
    spline: {
      create: (pointsOrParent: unknown, options?: { closed?: boolean; tension?: number }) => {
        const resolved = resolveSplinePointsInput(pointsOrParent, host)
        return createSplinePath(resolved.points, {
          closed: options?.closed ?? resolved.closed,
          tension: options?.tension ?? resolved.tension,
        })
      },
      follow: (
        pointsOrParent: unknown,
        options?: {
          speed?: number
          closed?: boolean
          tension?: number
          loop?: boolean
          pingPong?: boolean
          faceDirection?: boolean
          planeXZ?: boolean
          startProgress?: number
          onArrive?: () => void
        },
      ) => {
        let spline: SplinePath
        if (pointsOrParent && typeof pointsOrParent === 'object' && 'pointAtDistance' in pointsOrParent) {
          spline = pointsOrParent as SplinePath
        } else {
          const resolved = resolveSplinePointsInput(pointsOrParent, host)
          spline = createSplinePath(resolved.points, {
            closed: options?.closed ?? options?.loop ?? resolved.closed,
            tension: options?.tension ?? resolved.tension,
          })
        }
        if (spline.points.length === 0) {
          splineFollowAgents.delete(node.id)
          return false
        }
        const startT = Math.max(0, Math.min(1, Number(options?.startProgress ?? 0)))
        const startDist = startT * spline.length
        const startPos = spline.pointAtDistance(startDist)
        handle.position = {
          x: startPos.x,
          y: options?.planeXZ ? handle.position.y : startPos.y,
          z: startPos.z,
        }
        splineFollowAgents.set(node.id, {
          nodeId: node.id,
          scriptId,
          spline,
          distance: startDist,
          speed: Math.max(0.01, Number(options?.speed ?? 4)),
          direction: 1,
          loop: Boolean(options?.loop),
          pingPong: Boolean(options?.pingPong),
          faceDirection: options?.faceDirection !== false,
          planeXZ: Boolean(options?.planeXZ),
          onArrive: options?.onArrive,
        })
        return true
      },
      stop: () => {
        splineFollowAgents.delete(node.id)
      },
      get isFollowing() {
        return splineFollowAgents.has(node.id)
      },
      get progress() {
        const ag = splineFollowAgents.get(node.id)
        if (!ag || ag.spline.length <= 1e-6) return 0
        return Math.max(0, Math.min(1, ag.distance / ag.spline.length))
      },
    },
    tween: {
      to: (
        target: unknown,
        props: { position?: Vec3Obj; rotation?: Vec3Obj; scale?: Vec3Obj },
        duration: number,
        options?: {
          ease?: EasingName
          delay?: number
          repeat?: number
          yoyo?: boolean
          onUpdate?: (progress: number) => void
          onComplete?: () => void
        },
      ) => {
        const targetHandle =
          target && typeof target === 'object' && 'id' in target && typeof (target as { id?: unknown }).id === 'string'
            ? (makeNodeHandle((target as { id: string }).id, host) ?? (target as Record<string, any>))
            : (target as Record<string, any>)
        if (!targetHandle) return -1
        const startPos = props.position && targetHandle.position ? { ...targetHandle.position } : null
        const startRot = props.rotation && targetHandle.rotation ? { ...targetHandle.rotation } : null
        const startScale = props.scale && targetHandle.scale ? { ...targetHandle.scale } : null
        const endPos = resolveVec3Input(props.position)
        const endRot = resolveVec3Input(props.rotation)
        const endScale = resolveVec3Input(props.scale)
        const id = nextTweenId++
        const dur = Math.max(0.001, Number(duration) || 0.001)
        activeTweens.set(id, {
          id,
          ownerNodeId: node.id,
          scriptId,
          delayRemaining: Math.max(0, Number(options?.delay ?? 0)),
          elapsed: 0,
          duration: dur,
          ease: options?.ease ?? 'outQuad',
          repeat: Math.max(0, Math.floor(options?.repeat ?? 0)),
          yoyo: Boolean(options?.yoyo),
          reversed: false,
          completedCount: 0,
          apply: (t: number) => {
            if (startPos && endPos) {
              targetHandle.position = {
                x: startPos.x + (endPos.x - startPos.x) * t,
                y: startPos.y + (endPos.y - startPos.y) * t,
                z: startPos.z + (endPos.z - startPos.z) * t,
              }
            }
            if (startRot && endRot) {
              targetHandle.rotation = {
                x: startRot.x + (endRot.x - startRot.x) * t,
                y: startRot.y + (endRot.y - startRot.y) * t,
                z: startRot.z + (endRot.z - startRot.z) * t,
              }
            }
            if (startScale && endScale) {
              targetHandle.scale = {
                x: startScale.x + (endScale.x - startScale.x) * t,
                y: startScale.y + (endScale.y - startScale.y) * t,
                z: startScale.z + (endScale.z - startScale.z) * t,
              }
            }
          },
          onUpdate: options?.onUpdate,
          onComplete: options?.onComplete,
        })
        return id
      },
      value: (
        from: number,
        to: number,
        duration: number,
        onUpdate: (val: number) => void,
        options?: { ease?: EasingName; delay?: number; repeat?: number; yoyo?: boolean; onComplete?: () => void },
      ) => {
        const id = nextTweenId++
        const dur = Math.max(0.001, Number(duration) || 0.001)
        activeTweens.set(id, {
          id,
          ownerNodeId: node.id,
          scriptId,
          delayRemaining: Math.max(0, Number(options?.delay ?? 0)),
          elapsed: 0,
          duration: dur,
          ease: options?.ease ?? 'outQuad',
          repeat: Math.max(0, Math.floor(options?.repeat ?? 0)),
          yoyo: Boolean(options?.yoyo),
          reversed: false,
          completedCount: 0,
          apply: (t: number) => {
            onUpdate(from + (to - from) * t)
          },
          onComplete: options?.onComplete,
        })
        return id
      },
      punchScale: (strength = 0.25, duration = 0.22) => {
        const base = { ...handle.scale }
        const id = nextTweenId++
        const dur = Math.max(0.05, Number(duration) || 0.22)
        activeTweens.set(id, {
          id,
          ownerNodeId: node.id,
          scriptId,
          delayRemaining: 0,
          elapsed: 0,
          duration: dur,
          ease: 'linear',
          repeat: 0,
          yoyo: false,
          reversed: false,
          completedCount: 0,
          apply: (t: number) => {
            const pulse = Math.sin(t * Math.PI) * strength
            handle.scale = {
              x: base.x * (1 + pulse),
              y: base.y * (1 + pulse),
              z: base.z * (1 + pulse),
            }
          },
          onComplete: () => {
            handle.scale = base
          },
        })
        return id
      },
      shakePosition: (intensity = 0.18, duration = 0.25) => {
        const base = { ...handle.position }
        const id = nextTweenId++
        const dur = Math.max(0.05, Number(duration) || 0.25)
        activeTweens.set(id, {
          id,
          ownerNodeId: node.id,
          scriptId,
          delayRemaining: 0,
          elapsed: 0,
          duration: dur,
          ease: 'linear',
          repeat: 0,
          yoyo: false,
          reversed: false,
          completedCount: 0,
          apply: (t: number) => {
            const decay = 1 - t
            const amp = intensity * decay
            handle.position = {
              x: base.x + (Math.random() * 2 - 1) * amp,
              y: base.y + (Math.random() * 2 - 1) * amp,
              z: base.z + (Math.random() * 2 - 1) * amp,
            }
          },
          onComplete: () => {
            handle.position = base
          },
        })
        return id
      },
      cancel: (tweenId: number) => {
        activeTweens.delete(tweenId)
      },
      cancelAll: () => {
        for (const [twId, tw] of activeTweens.entries()) {
          if (tw.ownerNodeId === node.id) activeTweens.delete(twId)
        }
      },
    },
    curve: buildCurveApi(),
    crowd: {
      moveTo: (
        target: Vec3Obj | [number, number, number],
        options?: { speed?: number; arriveDist?: number; onArrive?: () => void },
      ) => {
        const v = resolveVec3Input(target)
        if (!v) return
        setCrowdTarget(node.id, v, options)
      },
      stop: () => stopCrowdAgent(node.id),
      get isMoving() {
        return isCrowdMoving(node.id)
      },
      formation: (
        units: readonly (string | { id?: string })[],
        center: Vec3Obj | [number, number, number],
        options?: {
          formation?: CrowdFormationType
          spacing?: number
          facingYaw?: number
          speed?: number
          arriveDist?: number
        },
      ) => {
        const c = resolveVec3Input(center)
        if (!c) return
        const nodes = world.getNodes()
        const ids = units
          .map((u) => resolveTemplateNode(u, nodes)?.id ?? (typeof u === 'string' ? u : u?.id))
          .filter((id): id is string => Boolean(id))
        setCrowdFormation(ids, c, options)
      },
      stats: () => getCrowdStats(),
    },
    projectile: {
      launch: (options?: {
        direction?: Vec3Obj | [number, number, number]
        target?: string | { id?: string } | null
        owner?: string | { id?: string } | null
        mode?: ProjectileMode
        speed?: number
        gravity?: number
        turnRate?: number
        maxLifetime?: number
        hitRadius?: number
        targetTag?: string
        damage?: number
        destroyOnHit?: boolean
        onHit?: (hitNode: ReturnType<typeof makeNodeHandle>, pos: Vec3Obj) => void
      }) => {
        const nodes = world.getNodes()
        const targetId = options?.target ? (resolveTemplateNode(options.target, nodes)?.id ?? (typeof options.target === 'string' ? options.target : options.target?.id)) : null
        const ownerId = options?.owner ? (resolveTemplateNode(options.owner, nodes)?.id ?? (typeof options.owner === 'string' ? options.owner : options.owner?.id)) : node.id
        launchProjectile(node.id, {
          direction: options?.direction ? (resolveVec3Input(options.direction) ?? undefined) : undefined,
          targetId,
          ownerId,
          mode: options?.mode,
          speed: options?.speed,
          gravity: options?.gravity,
          turnRate: options?.turnRate,
          maxLifetime: options?.maxLifetime,
          hitRadius: options?.hitRadius,
          targetTag: options?.targetTag,
          damage: options?.damage,
          destroyOnHit: options?.destroyOnHit,
          onHit: options?.onHit
            ? (hitNodeId, pos) => {
                options.onHit!(makeNodeHandle(hitNodeId, host), pos)
              }
            : undefined,
        })
      },
      reset: () => resetProjectileState(node.id),
    },
    anim: {
      playBody: (clipName: string, opts?: { loop?: boolean; fade?: number; speed?: number }) => {
        world.playBody?.(node.id, clipName, opts)
      },
      playUpper: (clipName: string, opts?: { loop?: boolean; fade?: number; speed?: number }) => {
        world.playUpper?.(node.id, clipName, opts)
      },
      stopUpper: (fade?: number) => world.stopUpper?.(node.id, fade),
    },
    character: {
      setModifiers: (patch: CharacterRuntimeModifiers) => setCharacterModifiers(node.id, patch),
      getModifiers: () => getCharacterModifiers(node.id),
      clearModifiers: () => clearCharacterModifiers(node.id),
    },
    audio: {
      playSfx: (assetId: string, opts?: { volume?: number; pitch?: number }) => {
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
        const last = sfxCooldownAt.get(assetId) ?? 0
        if (now - last < 40) return
        sfxCooldownAt.set(assetId, now)
        playSound({ assetId, bus: 'sfx', volume: opts?.volume, playbackRate: opts?.pitch, parent: obj ?? undefined })
      },
      playBgm: (assetId: string, opts?: { volume?: number; loop?: boolean }) => {
        playSound({ assetId, bus: 'music', volume: opts?.volume, loop: opts?.loop ?? true })
      },
      stopBgm: () => stopMusic(),
    },
    fx: {
      spawn: (effectId: string, position: Vec3Obj, options?: { scale?: number; autoDestroySec?: number }) => {
        const nodes = world.getNodes()
        const id = `fx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        const s = options?.scale ?? 1
        const fxNode: SceneNode = {
          ...node,
          id,
          name: `FX_${effectId.slice(0, 8)}`,
          kind: 'effect',
          parentId: null,
          visible: true,
          locked: false,
          position: [position.x, position.y, position.z],
          rotation: [0, 0, 0],
          scale: [s, s, s],
          castShadow: false,
          receiveShadow: false,
          assetId: effectId,
          slots: [],
          gameplay: {},
          physics: undefined,
          effect: {
            assetId: effectId,
            quarksVersion: '1.0',
            playing: true,
            materialAssetId: null,
            simulation: null,
          },
        }
        world.setNodes({ ...nodes, [id]: fxNode })
        const ttl = options?.autoDestroySec !== undefined ? options.autoDestroySec : 3
        if (ttl > 0) {
          const tid = nextTimerId++
          scriptTimers.set(tid, {
            id: tid,
            nodeId: id,
            scriptId,
            remaining: ttl,
            interval: ttl,
            repeat: false,
            callback: () => destroyOrReleaseNode(id, host),
          })
        }
      },
    },
    input: {
      isPressed: (actionOrKey: string) => isActionPressed(actionOrKey) || isKeyHeld(actionOrKey) || isKeyHeld(`Key${actionOrKey.toUpperCase()}`),
      justPressed: (actionOrKey: string) => wasActionTapped(actionOrKey) || wasKeyTapped(actionOrKey) || wasKeyTapped(`Key${actionOrKey.toUpperCase()}`),
      isKeyPressed: (code: string) => isKeyHeld(code) || isKeyHeld(`Key${code.toUpperCase()}`),
      justReleased: () => false,
      axis1D: (action: string) => (isActionPressed(action) ? 1 : 0),
      axis2D: (action: string) => getActionAxis2D(action),
      moveDirection: (action = 'Move') => viewRelativeMove(action, host),
      pointerDelta: () => ({ ...framePointerDelta }),
      pointerPosition: () => ({ ...framePointerPos }),
      wheelDelta: () => frameWheelDelta,
      isMouseButtonPressed: (button: number) => (currMouseButtons & mouseButtonMask(button)) !== 0,
      justPressedMouseButton: (button: number) =>
        (currMouseButtons & mouseButtonMask(button)) !== 0 && (prevMouseButtons & mouseButtonMask(button)) === 0,
      justReleasedMouseButton: (button: number) =>
        (currMouseButtons & mouseButtonMask(button)) === 0 && (prevMouseButtons & mouseButtonMask(button)) !== 0,
    },
    ui: {
      getVar: (key: string) => uiValues().variables[key],
      setVar: (key: string, value: unknown) => writeUiVariable(key, value),
      onEvent: (eventName: string, handler: (payload?: unknown) => void) => {
        ensureUiClickBridge()
        const instKey = instanceKey(node.id, scriptId)
        let byEvent = uiEventHandlers.get(instKey)
        if (!byEvent) {
          byEvent = new Map()
          uiEventHandlers.set(instKey, byEvent)
        }
        let set = byEvent.get(eventName)
        if (!set) {
          set = new Set()
          byEvent.set(eventName, set)
        }
        set.add(handler)
        return () => {
          set?.delete(handler)
        }
      },
      showScreen: (screenIdOrName: string) => {
        const sid = resolveScreenNodeId(screenIdOrName)
        if (sid) setScreenVisible(sid, true)
      },
      hideScreen: (screenIdOrName: string) => {
        const sid = resolveScreenNodeId(screenIdOrName)
        if (sid) setScreenVisible(sid, false)
      },
      toggleScreen: (screenIdOrName: string) => {
        const sid = resolveScreenNodeId(screenIdOrName)
        if (!sid) return
        const nodeTarget = world.getNodes()[sid]
        const curMap = uiValues().screens
        const cur = sid in curMap ? curMap[sid] : Boolean(nodeTarget?.screen?.visibleOnPlay ?? true)
        setScreenVisible(sid, !cur)
      },
      isScreenVisible: (screenIdOrName: string) => {
        const sid = resolveScreenNodeId(screenIdOrName)
        if (!sid) return false
        const nodeTarget = world.getNodes()[sid]
        const curMap = uiValues().screens
        return sid in curMap ? curMap[sid] : Boolean(nodeTarget?.screen?.visibleOnPlay ?? true)
      },
      worldToScreen: (position: Vec3Obj | { position?: Vec3Obj }) => {
        const vec = resolveVec3Input(position)
        if (!vec || !host.worldToScreen) return null
        return host.worldToScreen([vec.x, vec.y, vec.z])
      },
    },
    scene: {
      currentId: () => world.getActiveSceneId(),
      load: (sceneId: string, options?: { spawnPoint?: string }) => {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('t3d:load-scene', { detail: { sceneId, spawnPoint: options?.spawnPoint } }))
        }
      },
    },
    shader: {
      setParam: (shaderId: string, paramName: string, value: unknown) => setCompiledShaderParam(shaderId, paramName, value),
      getParam: (shaderId: string, paramName: string) => getCompiledShaderParam(shaderId, paramName),
    },
    global: {
      get: (key: string) => globalMemory.get(key),
      set: (key: string, value: unknown) => { globalMemory.set(key, value) },
      remove: (key: string) => { globalMemory.delete(key) },
    },
    storage: {
      get: (key: string) => persistentMemory.get(key),
      set: (key: string, value: unknown) => { persistentMemory.set(key, value) },
      remove: (key: string) => { persistentMemory.delete(key) },
    },
    tables: {
      getRow: (tableId: string, rowId: string) => findRow(world.getGameDatabase(), tableId, rowId)?.fields ?? null,
    },
    log: (...args: unknown[]) => world.log('info', args.map(String).join(' ')),
    warn: (...args: unknown[]) => world.log('warn', args.map(String).join(' ')),
  }
}

function buildSystemWorldApi(systemId: string, host: SceneRuntimeHost) {
  const world = getRuntimeWorld()
  const sysNodeId = `__system__:${systemId}`
  const poolHelpers = {
    preload: (templateOrPrefab: string | { id?: string }, count: number) => {
      const key = resolvePoolKey(templateOrPrefab)
      if (!key) return
      const targetCount = Math.max(0, Math.min(200, Math.floor(count)))
      let bucket = poolBuckets.get(key)
      if (!bucket) {
        bucket = { all: [], idle: [] }
        poolBuckets.set(key, bucket)
      }
      while (bucket.all.length < targetCount) {
        const spawned = spawnFromTemplateOrPrefab(templateOrPrefab, { visible: false }, host)
        if (!spawned) break
        if (!bucket.templatePos && spawned.templatePos) bucket.templatePos = spawned.templatePos
        if (!bucket.templateRotDeg && spawned.templateRotDeg) bucket.templateRotDeg = spawned.templateRotDeg
        if (!bucket.templateScale && spawned.templateScale) bucket.templateScale = spawned.templateScale
        if (bucket.templateTagId === undefined && spawned.templateTagId !== undefined) bucket.templateTagId = spawned.templateTagId
        if (bucket.templateTagIds === undefined && spawned.templateTagIds !== undefined) bucket.templateTagIds = spawned.templateTagIds
        pooledInactive.add(spawned.rootId)
        nodePoolKey.set(spawned.rootId, key)
        bucket.all.push(spawned.rootId)
        bucket.idle.push(spawned.rootId)
      }
    },
    acquire: (
      templateOrPrefab: string | { id?: string },
      opts?: { position?: Vec3Obj; rotation?: Vec3Obj; scale?: Vec3Obj; payload?: unknown },
    ) => {
      const key = resolvePoolKey(templateOrPrefab)
      if (!key) return null
      let bucket = poolBuckets.get(key)
      if (!bucket) {
        bucket = { all: [], idle: [] }
        poolBuckets.set(key, bucket)
      }
      const allNodes = world.getNodes()
      let pickedId: string | null = null
      while (bucket.idle.length > 0) {
        const cand = bucket.idle.pop()!
        if (allNodes[cand]) {
          pickedId = cand
          break
        }
      }
      if (!pickedId) {
        const spawned = spawnFromTemplateOrPrefab(templateOrPrefab, {
          position: opts?.position,
          rotation: opts?.rotation,
          scale: opts?.scale,
          visible: true,
        }, host)
        if (!spawned) return null
        if (!bucket.templatePos && spawned.templatePos) bucket.templatePos = spawned.templatePos
        if (!bucket.templateRotDeg && spawned.templateRotDeg) bucket.templateRotDeg = spawned.templateRotDeg
        if (!bucket.templateScale && spawned.templateScale) bucket.templateScale = spawned.templateScale
        if (bucket.templateTagId === undefined && spawned.templateTagId !== undefined) bucket.templateTagId = spawned.templateTagId
        if (bucket.templateTagIds === undefined && spawned.templateTagIds !== undefined) bucket.templateTagIds = spawned.templateTagIds
        pickedId = spawned.rootId
        nodePoolKey.set(pickedId, key)
        bucket.all.push(pickedId)
      } else {
        pooledInactive.delete(pickedId)
        const n = world.getNodes()[pickedId]
        const objTarget = host.resolveObject(pickedId)
        const posVec = resolveVec3Input(opts?.position)
        const rotVec = resolveVec3Input(opts?.rotation)
        const scaleVec = resolveVec3Input(opts?.scale)
        if (n) {
          n.visible = true
          n.tagId = bucket.templateTagId
          n.tagIds = bucket.templateTagIds ? [...bucket.templateTagIds] : undefined
          if (posVec) n.position = [posVec.x, posVec.y, posVec.z]
          else if (bucket.templatePos) n.position = [...bucket.templatePos]
          if (rotVec) n.rotation = [(rotVec.x * 180) / Math.PI, (rotVec.y * 180) / Math.PI, (rotVec.z * 180) / Math.PI]
          else if (bucket.templateRotDeg) n.rotation = [...bucket.templateRotDeg]
          if (scaleVec) n.scale = [scaleVec.x, scaleVec.y, scaleVec.z]
          else if (bucket.templateScale) n.scale = [...bucket.templateScale]
        }
        if (objTarget && n) {
          objTarget.visible = true
          objTarget.position.set(n.position[0], n.position[1], n.position[2])
          objTarget.rotation.set(
            (n.rotation[0] * Math.PI) / 180,
            (n.rotation[1] * Math.PI) / 180,
            (n.rotation[2] * Math.PI) / 180,
          )
          objTarget.scale.set(n.scale[0], n.scale[1], n.scale[2])
        }
      }
      resetAndInvokeSpawn(pickedId, opts?.payload, host)
      return makeNodeHandle(pickedId, host)
    },
    release: (target: { id?: string } | string) => {
      const targetId = typeof target === 'string' ? target : target?.id
      if (targetId) destroyOrReleaseNode(targetId, host)
    },
    stats: (templateOrPrefab?: string | { id?: string }) => {
      if (templateOrPrefab) {
        const key = resolvePoolKey(templateOrPrefab)
        const b = key ? poolBuckets.get(key) : undefined
        const total = b ? b.all.length : 0
        const pooled = b ? b.idle.length : 0
        return { active: Math.max(0, total - pooled), pooled, total }
      }
      let total = 0
      let pooled = 0
      for (const b of poolBuckets.values()) {
        total += b.all.length
        pooled += b.idle.length
      }
      return { active: Math.max(0, total - pooled), pooled, total }
    },
  }

  return {
    get elapsedTime() { return simElapsed },
    findNodeById: (id: string) => makeNodeHandle(id, host),
    findNodesByTag: (tag: string) => {
      const all = world.getNodes()
      return Object.values(all)
        .filter((n) => !isNodePooledInactive(n.id, all) && nodeHasTag(n, tag))
        .map((n) => makeNodeHandle(n.id, host))
        .filter(Boolean)
    },
    findNodesInRadius: (center: Vec3Obj, radius: number, tag?: string) => {
      const r2 = radius * radius
      const all = world.getNodes()
      return Object.values(all)
        .filter((n) => {
          if (isNodePooledInactive(n.id, all)) return false
          if (tag && !nodeHasTag(n, tag)) return false
          const p = host.resolveObject(n.id)?.position
          const x = p ? p.x : n.position[0]
          const y = p ? p.y : n.position[1]
          const z = p ? p.z : n.position[2]
          const dx = x - center.x
          const dy = y - center.y
          const dz = z - center.z
          return dx * dx + dy * dy + dz * dz <= r2
        })
        .map((n) => makeNodeHandle(n.id, host))
        .filter(Boolean)
    },
    cloneNode: (templateOrName: string | { id?: string }, opts?: Record<string, unknown>) => {
      const tpl = resolveTemplateNode(templateOrName, world.getNodes())
      if (!tpl) return null
      const spawnedId = cloneSceneSubtree(tpl, opts as Parameters<typeof cloneSceneSubtree>[1], host)
      if (!spawnedId) return null
      const initMsg = typeof opts?.initMessage === 'string' ? opts.initMessage : undefined
      if (initMsg) {
        messageQueue.push({ targetNodeId: spawnedId, name: initMsg, payload: opts?.initPayload })
      }
      return makeNodeHandle(spawnedId, host)
    },
    spawnPrefab: (prefabId: string, opts?: { position?: Vec3Obj; rotation?: Vec3Obj; name?: string }) => {
      const posVec = resolveVec3Input(opts?.position)
      const pos: TupleVec3 = posVec ? [posVec.x, posVec.y, posVec.z] : [0, 0, 0]
      const spawnedId = world.instantiatePrefab?.(prefabId, { position: pos }) ?? null
      if (!spawnedId) return null
      const spawnedNode = world.getNodes()[spawnedId]
      if (spawnedNode && opts?.name) spawnedNode.name = opts.name
      return makeNodeHandle(spawnedId, host)
    },
    destroyNode: (target: { id?: string } | string) => {
      const targetId = typeof target === 'string' ? target : target?.id
      if (targetId) destroyOrReleaseNode(targetId, host)
    },
    pool: poolHelpers,
    broadcast: (name: string, payload?: unknown) => {
      messageQueue.push({ targetNodeId: null, name, payload })
    },
    after: (seconds: number, callback: () => void) => {
      const id = nextTimerId++
      const delay = Math.max(0, Number(seconds) || 0)
      scriptTimers.set(id, { id, nodeId: sysNodeId, scriptId: systemId, remaining: delay, interval: delay, repeat: false, callback })
      return id
    },
    every: (seconds: number, callback: () => void) => {
      const id = nextTimerId++
      const interval = Math.max(0.016, Number(seconds) || 0.1)
      scriptTimers.set(id, { id, nodeId: sysNodeId, scriptId: systemId, remaining: interval, interval, repeat: true, callback })
      return id
    },
    cancelTimer: (timerId: number) => {
      scriptTimers.delete(timerId)
    },
    curve: buildCurveApi(),
    crowd: {
      moveTo: (
        targetNode: string | { id?: string },
        target: Vec3Obj | [number, number, number],
        options?: { speed?: number; arriveDist?: number; onArrive?: () => void },
      ) => {
        const nodes = world.getNodes()
        const id = resolveTemplateNode(targetNode, nodes)?.id ?? (typeof targetNode === 'string' ? targetNode : targetNode?.id)
        const v = resolveVec3Input(target)
        if (id && v) setCrowdTarget(id, v, options)
      },
      stop: (targetNode: string | { id?: string }) => {
        const nodes = world.getNodes()
        const id = resolveTemplateNode(targetNode, nodes)?.id ?? (typeof targetNode === 'string' ? targetNode : targetNode?.id)
        if (id) stopCrowdAgent(id)
      },
      formation: (
        units: readonly (string | { id?: string })[],
        center: Vec3Obj | [number, number, number],
        options?: {
          formation?: CrowdFormationType
          spacing?: number
          facingYaw?: number
          speed?: number
          arriveDist?: number
        },
      ) => {
        const c = resolveVec3Input(center)
        if (!c) return
        const nodes = world.getNodes()
        const ids = units
          .map((u) => resolveTemplateNode(u, nodes)?.id ?? (typeof u === 'string' ? u : u?.id))
          .filter((id): id is string => Boolean(id))
        setCrowdFormation(ids, c, options)
      },
      stats: () => getCrowdStats(),
    },
    projectile: {
      launch: (
        projNode: string | { id?: string },
        options?: {
          direction?: Vec3Obj | [number, number, number]
          target?: string | { id?: string } | null
          owner?: string | { id?: string } | null
          mode?: ProjectileMode
          speed?: number
          gravity?: number
          turnRate?: number
          maxLifetime?: number
          hitRadius?: number
          targetTag?: string
          damage?: number
          destroyOnHit?: boolean
          onHit?: (hitNode: ReturnType<typeof makeNodeHandle>, pos: Vec3Obj) => void
        },
      ) => {
        const nodes = world.getNodes()
        const id = resolveTemplateNode(projNode, nodes)?.id ?? (typeof projNode === 'string' ? projNode : projNode?.id)
        if (!id) return
        const targetId = options?.target ? (resolveTemplateNode(options.target, nodes)?.id ?? (typeof options.target === 'string' ? options.target : options.target?.id)) : null
        const ownerId = options?.owner ? (resolveTemplateNode(options.owner, nodes)?.id ?? (typeof options.owner === 'string' ? options.owner : options.owner?.id)) : null
        launchProjectile(id, {
          direction: options?.direction ? (resolveVec3Input(options.direction) ?? undefined) : undefined,
          targetId,
          ownerId,
          mode: options?.mode,
          speed: options?.speed,
          gravity: options?.gravity,
          turnRate: options?.turnRate,
          maxLifetime: options?.maxLifetime,
          hitRadius: options?.hitRadius,
          targetTag: options?.targetTag,
          damage: options?.damage,
          destroyOnHit: options?.destroyOnHit,
          onHit: options?.onHit
            ? (hitNodeId, pos) => {
                options.onHit!(makeNodeHandle(hitNodeId, host), pos)
              }
            : undefined,
        })
      },
      reset: (projNode: string | { id?: string }) => {
        const nodes = world.getNodes()
        const id = resolveTemplateNode(projNode, nodes)?.id ?? (typeof projNode === 'string' ? projNode : projNode?.id)
        if (id) resetProjectileState(id)
      },
    },
    input: {
      isPressed: (actionOrKey: string) => isActionPressed(actionOrKey) || isKeyHeld(actionOrKey) || isKeyHeld(`Key${actionOrKey.toUpperCase()}`),
      justPressed: (actionOrKey: string) => wasActionTapped(actionOrKey) || wasKeyTapped(actionOrKey) || wasKeyTapped(`Key${actionOrKey.toUpperCase()}`),
      isKeyPressed: (code: string) => isKeyHeld(code) || isKeyHeld(`Key${code.toUpperCase()}`),
      justReleased: () => false,
      axis1D: (action: string) => (isActionPressed(action) ? 1 : 0),
      axis2D: (action: string) => getActionAxis2D(action),
      moveDirection: (action = 'Move') => viewRelativeMove(action, host),
      pointerDelta: () => ({ ...framePointerDelta }),
      pointerPosition: () => ({ ...framePointerPos }),
      wheelDelta: () => frameWheelDelta,
      isMouseButtonPressed: (button: number) => (currMouseButtons & mouseButtonMask(button)) !== 0,
      justPressedMouseButton: (button: number) =>
        (currMouseButtons & mouseButtonMask(button)) !== 0 && (prevMouseButtons & mouseButtonMask(button)) === 0,
      justReleasedMouseButton: (button: number) =>
        (currMouseButtons & mouseButtonMask(button)) === 0 && (prevMouseButtons & mouseButtonMask(button)) !== 0,
    },
    ui: {
      getVar: (key: string) => uiValues().variables[key],
      setVar: (key: string, value: unknown) => writeUiVariable(key, value),
      onEvent: (eventName: string, handler: (payload?: unknown) => void) => {
        ensureUiClickBridge()
        const instKey = `sys:${systemId}`
        let byEvent = uiEventHandlers.get(instKey)
        if (!byEvent) {
          byEvent = new Map()
          uiEventHandlers.set(instKey, byEvent)
        }
        let set = byEvent.get(eventName)
        if (!set) {
          set = new Set()
          byEvent.set(eventName, set)
        }
        set.add(handler)
        return () => { set?.delete(handler) }
      },
      showScreen: (screenIdOrName: string) => {
        const sid = resolveScreenNodeId(screenIdOrName)
        if (sid) setScreenVisible(sid, true)
      },
      hideScreen: (screenIdOrName: string) => {
        const sid = resolveScreenNodeId(screenIdOrName)
        if (sid) setScreenVisible(sid, false)
      },
      toggleScreen: (screenIdOrName: string) => {
        const sid = resolveScreenNodeId(screenIdOrName)
        if (!sid) return
        const nodeTarget = world.getNodes()[sid]
        const curMap = uiValues().screens
        const cur = sid in curMap ? curMap[sid] : Boolean(nodeTarget?.screen?.visibleOnPlay ?? true)
        setScreenVisible(sid, !cur)
      },
      isScreenVisible: (screenIdOrName: string) => {
        const sid = resolveScreenNodeId(screenIdOrName)
        if (!sid) return false
        const nodeTarget = world.getNodes()[sid]
        const curMap = uiValues().screens
        return sid in curMap ? curMap[sid] : Boolean(nodeTarget?.screen?.visibleOnPlay ?? true)
      },
      worldToScreen: (position: Vec3Obj | { position?: Vec3Obj }) => {
        const vec = resolveVec3Input(position)
        if (!vec || !host.worldToScreen) return null
        return host.worldToScreen([vec.x, vec.y, vec.z])
      },
    },
    scene: {
      currentId: () => world.getActiveSceneId(),
      load: (sceneId: string, options?: { spawnPoint?: string }) => {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('t3d:load-scene', { detail: { sceneId, spawnPoint: options?.spawnPoint } }))
        }
      },
    },
    shader: {
      setParam: (shaderId: string, paramName: string, value: unknown) => setCompiledShaderParam(shaderId, paramName, value),
      getParam: (shaderId: string, paramName: string) => getCompiledShaderParam(shaderId, paramName),
    },
    global: {
      get: (key: string) => globalMemory.get(key),
      set: (key: string, value: unknown) => { globalMemory.set(key, value) },
      remove: (key: string) => { globalMemory.delete(key) },
    },
    storage: {
      get: (key: string) => persistentMemory.get(key),
      set: (key: string, value: unknown) => { persistentMemory.set(key, value) },
      remove: (key: string) => { persistentMemory.delete(key) },
    },
    tables: {
      getRow: (tableId: string, rowId: string) => findRow(world.getGameDatabase(), tableId, rowId)?.fields ?? null,
    },
    log: (...args: unknown[]) => world.log('info', args.map(String).join(' ')),
    warn: (...args: unknown[]) => world.log('warn', args.map(String).join(' ')),
  }
}

export function createRuntimeSdk() {
  return {
    defineBehavior: (def: BehaviorDefinition) => ({ __t3dKind: 'behavior', ...def }),
    defineSystem: (def: SystemDefinition) => ({ __t3dKind: 'system', ...def }),
  }
}

export function compileAndRegisterScript(
  id: string,
  fileName: string,
  source: string,
): CompileResult<CompiledScriptAsset> {
  const transpiled = checkAndTranspileTs(fileName, source)
  if (!transpiled.ok || !transpiled.jsCode) {
    return { ok: false, diagnostics: transpiled.diagnostics }
  }
  const evaluated = evaluateTranspiledModule<Record<string, unknown>>(fileName, transpiled.jsCode, {
    't3d/runtime': createRuntimeSdk(),
  })
  if (!evaluated.ok || !evaluated.exports) {
    return { ok: false, diagnostics: evaluated.diagnostics }
  }

  const exp = evaluated.exports as Record<string, unknown> & { __t3dKind?: string }
  if (exp.__t3dKind === 'system') {
    const def = exp as unknown as SystemDefinition
    const prev = compiledSystems.get(id)
    prev?.unregister()
    const baseOrder =
      def.stage === 'preRender'
        ? RUNTIME_STAGE.PRE_RENDER - 1
        : def.stage === 'postAnimation'
          ? RUNTIME_STAGE.POST_ANIMATION
          : def.stage === 'postPhysics'
            ? RUNTIME_STAGE.PHYSICS_NAV + 5
            : RUNTIME_STAGE.PRE_PHYSICS + 1
    const sysEntry = {
      def,
      mounted: false,
      state: def.createState ? { ...def.createState() } : def.state ? { ...def.state() } : {},
      unregister: () => {},
    }
    const unregister = registerRuntimeSystem(
      `script.${id}`,
      baseOrder + (def.order ?? 0),
      (dt, host) => {
        if (getRuntimeWorld().getPlayState() !== 'playing') return
        const api = buildSystemWorldApi(id, host)
        try {
          if (!sysEntry.mounted) {
            sysEntry.mounted = true
            sysEntry.state = def.createState ? { ...def.createState() } : def.state ? { ...def.state() } : {}
            def.onMount?.(api, sysEntry.state)
            def.onInit?.(api, sysEntry.state)
          }
          def.onStep?.(api, sysEntry.state, dt)
          def.onUpdate?.(api, sysEntry.state, dt)
        } catch (error) {
          reportRuntimeError('system', id, `系统 "${def.name}"`, error)
        }
      },
    )
    sysEntry.unregister = unregister
    compiledSystems.set(id, sysEntry)
    return {
      ok: true,
      diagnostics: transpiled.diagnostics,
      jsCode: transpiled.jsCode,
      exports: { id, file: fileName, kind: 'system', system: def },
    }
  }

  const def = exp as unknown as BehaviorDefinition
  if (exp.__t3dKind !== 'behavior' || typeof def.name !== 'string' || !def.name.trim()) {
    return {
      ok: false,
      diagnostics: [
        {
          file: fileName,
          line: 1,
          column: 1,
          severity: 'error',
          message: '脚本必须通过 export default defineBehavior({ name, description, params, onUpdate }) 或 defineSystem(...) 导出',
          hint: '请从 "t3d/runtime" 导入 defineBehavior，并提供 name（中文标题）、description（作用说明）和 onUpdate(self, dt) 回调；修改位置请整体赋值 self.position = { x, y, z }',
        },
      ],
    }
  }

  // 热重载：保留已存在实例的 self.state 与 started 标记
  compiledBehaviors.set(id, def)
  return {
    ok: true,
    diagnostics: transpiled.diagnostics,
    jsCode: transpiled.jsCode,
    exports: { id, file: fileName, kind: 'behavior', behavior: def },
  }
}

export function getRegisteredBehavior(scriptId: string): BehaviorDefinition | undefined {
  return compiledBehaviors.get(scriptId)
}

/**
 * 把二维输入轴换算成「相对当前观察相机」的世界水平方向（y 恒为 0，长度即输入强度，最大 1）。
 * 与内置角色控制器用的是同一个相机水平方位角（宿主按视线方向算出，不受俯仰影响），
 * 脚本不需要自己从相机旋转里推方位角。
 */
export function viewRelativeMove(action: string, host: SceneRuntimeHost): Vec3Obj {
  const axis = getActionAxis2D(action)
  const length = Math.hypot(axis.x, axis.y)
  if (length < 1e-4) return { x: 0, y: 0, z: 0 }
  const scale = length > 1 ? 1 / length : 1
  const yaw = host.yaw?.() ?? 0
  const sin = Math.sin(yaw)
  const cos = Math.cos(yaw)
  // 相机 yaw=0 时视线朝 -Z、右手边是 +X
  return {
    x: (axis.x * cos - axis.y * sin) * scale,
    y: 0,
    z: (-axis.x * sin - axis.y * cos) * scale,
  }
}

function snapshotStateValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value ?? null
  if (typeof value === 'number') return Number.isFinite(value) ? Number(value.toFixed(4)) : String(value)
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value.length > 200 ? `${value.slice(0, 200)}…` : value
  if (typeof value === 'function') return '[function]'
  if (depth <= 0) return Array.isArray(value) ? `[array ${value.length}]` : '[object]'
  if (Array.isArray(value)) {
    const head = value.slice(0, 12).map((item) => snapshotStateValue(item, depth - 1))
    if (value.length > 12) head.push(`…共 ${value.length} 项`)
    return head
  }
  if (value instanceof Map) return `[Map ${value.size}]`
  if (value instanceof Set) return `[Set ${value.size}]`
  const out: Record<string, unknown> = {}
  let count = 0
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (count >= 24) {
      out['…'] = '字段过多已省略'
      break
    }
    out[key] = snapshotStateValue(item, depth - 1)
    count += 1
  }
  return out
}

/**
 * 只读快照：试玩期间某个节点上各行为脚本的 self.state（供试玩验收与调试读取，不暴露可变引用）。
 * 非试玩或该节点没有已启动的脚本实例时返回 null。
 */
export function readScriptStateSnapshot(nodeId: string): Record<string, Record<string, unknown>> | null {
  let out: Record<string, Record<string, unknown>> | null = null
  for (const rec of instanceStates.values()) {
    if (rec.nodeId !== nodeId) continue
    out ??= {}
    out[rec.scriptId] = snapshotStateValue(rec.state, 3) as Record<string, unknown>
  }
  return out
}

export function unregisterCompiledScript(scriptId: string): void {
  compiledBehaviors.delete(scriptId)
  const sys = compiledSystems.get(scriptId)
  if (sys) {
    sys.unregister()
    compiledSystems.delete(scriptId)
  }
}

export function clearAllCompiledScripts(): void {
  clearScriptRuntimeState()
  compiledBehaviors.clear()
  for (const sys of compiledSystems.values()) {
    sys.unregister()
  }
  compiledSystems.clear()
}

export function clearScriptRuntimeState(): void {
  for (const [sysId, sys] of compiledSystems.entries()) {
    if (sys.mounted) {
      sys.mounted = false
      const noopHost: SceneRuntimeHost = { ready: false, resolveObject: () => null, updateAnimations: () => {} }
      const api = buildSystemWorldApi(sysId, noopHost)
      try {
        sys.def.onDispose?.(api, sys.state)
        sys.def.onDestroy?.(api, sys.state)
      } catch { /* ignore */ }
      sys.state = {}
    }
  }
  instanceStates.clear()
  runtimeErrorCounts.clear()
  messageQueue.length = 0
  uiEventHandlers.clear()
  uiEventQueue.length = 0
  globalMemory.clear()
  navAgents.clear()
  pooledInactive.clear()
  nodePoolKey.clear()
  poolBuckets.clear()
  scriptTimers.clear()
  splineFollowAgents.clear()
  activeTweens.clear()
  sfxCooldownAt.clear()
  nextTimerId = 1
  nextTweenId = 1
  simElapsed = 0
  framePointerDelta = { x: 0, y: 0 }
  framePointerPos = { x: 0, y: 0 }
  frameWheelDelta = 0
  prevMouseButtons = 0
  currMouseButtons = 0
}

type TaskOwnerState = 'active' | 'disabled' | 'destroyed'

/**
 * 统一的任务归属门控：所有由脚本发起的跨帧任务（Tween / Timer / Spline / Nav 等）
 * 在推进前统一经过这里，确保脚本开关关闭时冻结、卸载或删节点时自动清理。
 */
function resolveTaskOwnerState(
  nodeId: string,
  scriptId: string | undefined,
  nodes: Record<string, SceneNode>,
  mountedKeys: ReadonlySet<string>,
  activeKeys: ReadonlySet<string>,
): TaskOwnerState {
  if (nodeId.startsWith('__system__:')) return 'active'
  if (!nodes[nodeId] || isNodePooledInactive(nodeId, nodes)) return 'destroyed'
  if (!scriptId) return 'active'
  const key = instanceKey(nodeId, scriptId)
  if (!mountedKeys.has(key)) return 'destroyed'
  return activeKeys.has(key) ? 'active' : 'disabled'
}

function stepProjectScripts(dt: number, host: SceneRuntimeHost) {
  const world = getRuntimeWorld()
  if (world.getPlayState() !== 'playing') {
    clearScriptRuntimeState()
    return
  }
  ensureUiClickBridge()
  ensureCharacterEventBridge()
  bindProjectileRuntimeHooks({
    onHit: ({ projectileId, targetId, ownerId, damage, position }) => {
      messageQueue.push({
        targetNodeId: targetId,
        name: 'onProjectileHit',
        payload: { projectileId, targetId, ownerId, damage, position },
        senderId: projectileId,
      })
      messageQueue.push({
        targetNodeId: projectileId,
        name: 'onProjectileHit',
        payload: { projectileId, targetId, ownerId, damage, position },
        senderId: projectileId,
      })
    },
    onRecycle: (nodeId, runtimeHost) => {
      destroyOrReleaseNode(nodeId, runtimeHost)
    },
    isNodeInactive: (nodeId, nodes) => isNodePooledInactive(nodeId, nodes),
  })
  simElapsed += Math.max(0, dt)
  framePointerDelta = host.peekPointerDelta?.() ?? host.pointerDelta?.() ?? { x: 0, y: 0 }
  framePointerPos = host.pointerNormalized?.() ?? { x: 0, y: 0 }
  frameWheelDelta = host.peekWheel?.() ?? host.wheel?.() ?? 0
  prevMouseButtons = currMouseButtons
  currMouseButtons = host.mouseButtons ? host.mouseButtons() : (host.rightHeld?.() ? 2 : 0)
  const nodes = world.getNodes()
  const mountedKeys = new Set<string>()
  const activeKeys = new Set<string>()
  for (const sysId of compiledSystems.keys()) {
    mountedKeys.add(`sys:${sysId}`)
    activeKeys.add(`sys:${sysId}`)
  }

  for (const node of Object.values(nodes)) {
    if (isNodePooledInactive(node.id, nodes)) continue
    const projectScripts = node.gameplay?.packs?.__project__
    if (!projectScripts || typeof projectScripts !== 'object') continue
    for (const [scriptId, rawParams] of Object.entries(projectScripts as Record<string, unknown>)) {
      const def = compiledBehaviors.get(scriptId)
      if (!def) continue
      const key = instanceKey(node.id, scriptId)
      // 只要脚本仍挂在存活节点上，就保留实例状态与 started 标记；禁用只暂停执行，不销毁重建
      mountedKeys.add(key)
      const isEnabled = !(rawParams && typeof rawParams === 'object' && (rawParams as Record<string, unknown>).__enabled === false)
      if (!isEnabled) {
        const disabledRec = instanceStates.get(key)
        if (disabledRec && disabledRec.enabled) {
          disabledRec.enabled = false
          disabledRec.lastRawParams = rawParams
          if (def.onDisable) {
            const ctx = buildScriptContext(node, scriptId, rawParams, disabledRec.state, host)
            try {
              def.onDisable(ctx)
            } catch (error) {
              reportRuntimeError('onDisable', scriptId, `脚本 "${def.name}"`, error, node.id)
            }
          }
        }
        continue
      }
      activeKeys.add(key)
      let rec = instanceStates.get(key)
      if (!rec) {
        rec = {
          nodeId: node.id,
          scriptId,
          started: false,
          enabled: false,
          lastRawParams: rawParams,
          state: def.state ? { ...def.state() } : {},
        }
        instanceStates.set(key, rec)
      } else {
        rec.lastRawParams = rawParams
      }
      const ctx = buildScriptContext(node, scriptId, rawParams, rec.state, host)
      measureCost(`script:${scriptId}`, () => {
        let phase = 'onUpdate'
        try {
          if (!rec!.started) {
            rec!.started = true
            phase = 'onStart'
            def.onStart?.(ctx)
          }
          if (!rec!.enabled) {
            rec!.enabled = true
            phase = 'onEnable'
            def.onEnable?.(ctx)
          }
          phase = 'onUpdate'
          def.onUpdate?.(ctx, dt)
        } catch (error) {
          reportRuntimeError(phase, scriptId, `脚本 "${def.name}"`, error, node.id)
        }
      })
    }
  }

  // 推进已激活的导航代理移动
  if (navAgents.size > 0 && dt > 0) {
    for (const [agentId, agent] of navAgents) {
      const ownerState = resolveTaskOwnerState(agentId, agent.scriptId, nodes, mountedKeys, activeKeys)
      if (ownerState === 'destroyed') {
        navAgents.delete(agentId)
        continue
      }
      if (ownerState === 'disabled') continue
      const obj = host.resolveObject(agentId)
      const n = nodes[agentId]
      if (!obj && !n) {
        navAgents.delete(agentId)
        continue
      }
      const targetPt = agent.path[agent.index]
      if (!targetPt) {
        navAgents.delete(agentId)
        continue
      }
      const curX = obj ? obj.position.x : n.position[0]
      const curY = obj ? obj.position.y : n.position[1]
      const curZ = obj ? obj.position.z : n.position[2]
      const dx = targetPt[0] - curX
      const dy = targetPt[1] - curY
      const dz = targetPt[2] - curZ
      const dist = Math.hypot(dx, dy, dz)
      const stepDist = agent.speed * dt
      if (dist <= Math.max(0.05, stepDist)) {
        if (obj) obj.position.set(targetPt[0], targetPt[1], targetPt[2])
        agent.index += 1
        if (agent.index >= agent.path.length) navAgents.delete(agentId)
      } else {
        const inv = stepDist / dist
        if (obj) {
          obj.position.set(curX + dx * inv, curY + dy * inv, curZ + dz * inv)
          obj.rotation.y = Math.atan2(dx, dz)
        }
      }
    }
  }

  // 推进 Spline 路径跟随代理
  if (splineFollowAgents.size > 0 && dt > 0) {
    for (const [agentId, ag] of Array.from(splineFollowAgents.entries())) {
      const ownerState = resolveTaskOwnerState(agentId, ag.scriptId, nodes, mountedKeys, activeKeys)
      if (ownerState === 'destroyed') {
        splineFollowAgents.delete(agentId)
        continue
      }
      if (ownerState === 'disabled') continue
      const n = nodes[agentId]
      const h = makeNodeHandle(agentId, host)
      if (!n || !h) {
        splineFollowAgents.delete(agentId)
        continue
      }
      const totalLen = ag.spline.length
      if (totalLen <= 1e-6) {
        splineFollowAgents.delete(agentId)
        ag.onArrive?.()
        continue
      }
      let nextDist = ag.distance + ag.speed * dt * ag.direction
      let arrived = false
      if (ag.loop) {
        nextDist = ((nextDist % totalLen) + totalLen) % totalLen
      } else if (ag.pingPong) {
        if (nextDist >= totalLen) {
          nextDist = totalLen - (nextDist - totalLen)
          ag.direction = -1
        } else if (nextDist <= 0) {
          nextDist = -nextDist
          ag.direction = 1
        }
      } else {
        if (nextDist >= totalLen) {
          nextDist = totalLen
          arrived = true
        } else if (nextDist <= 0) {
          nextDist = 0
          arrived = true
        }
      }
      ag.distance = nextDist
      const pt = ag.spline.pointAtDistance(nextDist)
      const cur = h.position
      h.position = { x: pt.x, y: ag.planeXZ ? cur.y : pt.y, z: pt.z }
      if (ag.faceDirection) {
        const tan = ag.spline.tangentAtDistance(nextDist)
        const tx = tan.x * ag.direction
        const tz = tan.z * ag.direction
        if (Math.abs(tx) > 1e-5 || Math.abs(tz) > 1e-5) {
          const r = h.rotation
          h.rotation = { x: r.x, y: Math.atan2(tx, tz), z: r.z }
        }
      }
      if (arrived) {
        splineFollowAgents.delete(agentId)
        try {
          ag.onArrive?.()
        } catch (error) {
          reportRuntimeError('spline.onArrive', 'spline', 'Spline 到达回调', error, ag.nodeId)
        }
      }
    }
  }

  // 推进 Tween 补间动画
  if (activeTweens.size > 0 && dt > 0) {
    for (const tw of Array.from(activeTweens.values())) {
      if (!activeTweens.has(tw.id)) continue
      const ownerState = resolveTaskOwnerState(tw.ownerNodeId, tw.scriptId, nodes, mountedKeys, activeKeys)
      if (ownerState === 'destroyed') {
        activeTweens.delete(tw.id)
        continue
      }
      if (ownerState === 'disabled') continue
      if (tw.delayRemaining > 0) {
        tw.delayRemaining -= dt
        if (tw.delayRemaining > 0) continue
        tw.elapsed += -tw.delayRemaining
        tw.delayRemaining = 0
      } else {
        tw.elapsed += dt
      }
      const rawT = Math.min(1, tw.elapsed / tw.duration)
      const progress = tw.reversed ? 1 - rawT : rawT
      const eased = evalEasing(tw.ease, progress)
      try {
        tw.apply(eased)
        tw.onUpdate?.(eased)
      } catch (error) {
        reportRuntimeError('tween.onUpdate', 'tween', 'Tween 更新回调', error, tw.ownerNodeId)
        activeTweens.delete(tw.id)
        continue
      }
      if (rawT >= 1) {
        if (tw.completedCount < tw.repeat) {
          tw.completedCount += 1
          tw.elapsed = 0
          if (tw.yoyo) tw.reversed = !tw.reversed
        } else {
          activeTweens.delete(tw.id)
          try {
            tw.onComplete?.()
          } catch (error) {
            reportRuntimeError('tween.onComplete', 'tween', 'Tween 完成回调', error, tw.ownerNodeId)
          }
        }
      }
    }
  }

  // 推进托管定时器（after / every）
  if (scriptTimers.size > 0 && dt > 0) {
    const timerSnapshot = Array.from(scriptTimers.values())
    for (const timer of timerSnapshot) {
      if (!scriptTimers.has(timer.id)) continue
      const ownerState = resolveTaskOwnerState(timer.nodeId, timer.scriptId, nodes, mountedKeys, activeKeys)
      if (ownerState === 'destroyed') {
        scriptTimers.delete(timer.id)
        continue
      }
      if (ownerState === 'disabled') continue
      timer.remaining -= dt
      if (timer.remaining <= 0) {
        if (timer.repeat) {
          timer.remaining += timer.interval
          if (timer.remaining <= 0) timer.remaining = timer.interval
        } else {
          scriptTimers.delete(timer.id)
        }
        try {
          timer.callback()
        } catch (error) {
          reportRuntimeError('timer', 'timer', '脚本定时器回调', error, timer.nodeId)
        }
      }
    }
  }

  // 派发消息队列
  if (messageQueue.length > 0) {
    const batch = messageQueue.splice(0, messageQueue.length)
    for (const msg of batch) {
      for (const rec of instanceStates.values()) {
        if (msg.targetNodeId && msg.targetNodeId !== rec.nodeId) continue
        const def = compiledBehaviors.get(rec.scriptId)
        const node = nodes[rec.nodeId]
        if (!def?.onMessage || !node) continue
        const rawParams = (node.gameplay?.packs?.__project__ as Record<string, unknown> | undefined)?.[rec.scriptId]
        if (rawParams && typeof rawParams === 'object' && (rawParams as Record<string, unknown>).__enabled === false) continue
        const ctx = buildScriptContext(node, rec.scriptId, rawParams, rec.state, host)
        const sender = msg.senderId ? makeNodeHandle(msg.senderId, host) : undefined
        try {
          def.onMessage(ctx, { name: msg.name, payload: msg.payload, sender })
        } catch (error) {
          reportRuntimeError(`onMessage:${msg.name}`, rec.scriptId, `脚本 "${def.name}"`, error, rec.nodeId)
        }
      }
    }
  }

  // 派发 UI 点击事件队列
  if (uiEventQueue.length > 0) {
    const uiBatch = uiEventQueue.splice(0, uiEventQueue.length)
    for (const evt of uiBatch) {
      for (const [instKey, byEvent] of uiEventHandlers.entries()) {
        if (!activeKeys.has(instKey)) continue
        const handlers = byEvent.get(evt.eventName)
        if (!handlers || handlers.size === 0) continue
        for (const fn of [...handlers]) {
          try {
            fn(evt.payload)
          } catch (error) {
            reportRuntimeError(`uiEvent:${evt.eventName}`, instKey, `UI 事件 "${evt.eventName}"`, error, evt.payload.nodeId)
          }
        }
      }
    }
  }

  // 清理已移除节点或卸载脚本的实例状态（暂时关闭 __enabled 不销毁）
  for (const [key, rec] of instanceStates.entries()) {
    if (mountedKeys.has(key)) continue
    uiEventHandlers.delete(key)
    const def = compiledBehaviors.get(rec.scriptId)
    const node = nodes[rec.nodeId]
    if (node && (def?.onDisable || def?.onDestroy)) {
      const ctx = buildScriptContext(node, rec.scriptId, rec.lastRawParams ?? {}, rec.state, host)
      if (rec.enabled && def.onDisable) {
        try { def.onDisable(ctx) } catch { /* ignore */ }
      }
      if (def.onDestroy) {
        try { def.onDestroy(ctx) } catch { /* ignore */ }
      }
    }
    instanceStates.delete(key)
  }
}

function resolveGizmoNodePos(node: SceneNode, nodes: Record<string, SceneNode>): Vec3Obj {
  let x = node.position[0]
  let y = node.position[1]
  let z = node.position[2]
  let curParent = node.parentId ? nodes[node.parentId] : undefined
  let guard = 0
  while (curParent && guard < 16) {
    x += curParent.position[0]
    y += curParent.position[1]
    z += curParent.position[2]
    curParent = curParent.parentId ? nodes[curParent.parentId] : undefined
    guard += 1
  }
  return { x, y, z }
}

function makeReadonlyNodeHandle(node: SceneNode, nodes: Record<string, SceneNode>) {
  const tags: string[] = [...(node.tagId ? [node.tagId] : []), ...(node.tagIds ?? [])]
  return {
    id: node.id,
    name: node.name,
    tags,
    position: resolveGizmoNodePos(node, nodes),
    rotation: {
      x: (node.rotation[0] * Math.PI) / 180,
      y: (node.rotation[1] * Math.PI) / 180,
      z: (node.rotation[2] * Math.PI) / 180,
    },
    scale: toVec3Obj(node.scale),
    visible: node.visible,
    hasTag: (tag: string) => tags.includes(tag) || tags.some((t) => t.startsWith(`${tag}.`)),
    sendMessage: () => {},
    destroy: () => {},
  }
}

export function collectScriptGizmos(
  node: SceneNode,
  scriptId: string,
  rawParams: unknown,
  isSelected: boolean,
  nodes: Record<string, SceneNode>,
): ScriptGizmoCommand[] {
  const def = compiledBehaviors.get(scriptId)
  if (!def?.onDrawGizmos) return []
  const inputRecord = rawParams && typeof rawParams === 'object' ? (rawParams as Record<string, unknown>) : {}
  if (inputRecord.__enabled === false) return []

  const resolvedParams: Record<string, unknown> = {}
  for (const [k, schema] of Object.entries(def.params ?? {})) {
    const val = k in inputRecord ? inputRecord[k] : defaultForSchema(schema)
    if (schema.type === 'vec2' && Array.isArray(val)) resolvedParams[k] = { x: Number(val[0]) || 0, y: Number(val[1]) || 0 }
    else if (schema.type === 'vec3' && Array.isArray(val)) resolvedParams[k] = { x: Number(val[0]) || 0, y: Number(val[1]) || 0, z: Number(val[2]) || 0 }
    else if (schema.type === 'ref' && schema.target === 'node' && typeof val === 'string') {
      const targetNode = nodes[val]
      resolvedParams[k] = targetNode ? makeReadonlyNodeHandle(targetNode, nodes) : null
    } else resolvedParams[k] = val
  }

  const handle = makeReadonlyNodeHandle(node, nodes)
  const selfCtx = {
    node: handle,
    params: resolvedParams,
    state: {},
    elapsedTime: 0,
    position: handle.position,
    rotation: handle.rotation,
    scale: handle.scale,
    visible: handle.visible,
    findNodeById: (id: string) => (nodes[id] ? makeReadonlyNodeHandle(nodes[id], nodes) : null),
    findNodesByTag: (tag: string) =>
      Object.values(nodes)
        .filter((n) => n.tagId === tag || n.tagIds?.includes(tag))
        .map((n) => makeReadonlyNodeHandle(n, nodes)),
  }

  const commands: ScriptGizmoCommand[] = []
  const MAX_COMMANDS = 128
  const push = (cmd: ScriptGizmoCommand) => {
    if (commands.length < MAX_COMMANDS) commands.push(cmd)
  }

  const gizmosApi = {
    isSelected,
    line(from: unknown, to: unknown, opts?: { color?: string }) {
      const a = resolveVec3Input(from)
      const b = resolveVec3Input(to)
      if (!a || !b) return
      push({ kind: 'line', from: a, to: b, color: opts?.color ?? '#38bdf8' })
    },
    arrow(from: unknown, dir: unknown, length = 1.5, opts?: { color?: string }) {
      const a = resolveVec3Input(from)
      const d = resolveVec3Input(dir)
      const len = Number(length)
      if (!a || !d || !Number.isFinite(len) || len <= 0) return
      push({ kind: 'arrow', from: a, dir: d, length: len, color: opts?.color ?? '#fbbf24' })
    },
    wireSphere(center: unknown, radius: number, opts?: { color?: string }) {
      const c = resolveVec3Input(center)
      const r = Number(radius)
      if (!c || !Number.isFinite(r) || r <= 0) return
      push({ kind: 'wireSphere', center: c, radius: r, color: opts?.color ?? '#38bdf8' })
    },
    wireBox(center: unknown, size: unknown, opts?: { color?: string }) {
      const c = resolveVec3Input(center)
      const s = resolveVec3Input(size)
      if (!c || !s) return
      push({ kind: 'wireBox', center: c, size: s, color: opts?.color ?? '#34d399' })
    },
    disc(center: unknown, radius: number, opts?: { normal?: Vec3Obj; color?: string }) {
      const c = resolveVec3Input(center)
      const r = Number(radius)
      if (!c || !Number.isFinite(r) || r <= 0) return
      const n = resolveVec3Input(opts?.normal) ?? { x: 0, y: 1, z: 0 }
      push({ kind: 'disc', center: c, normal: n, radius: r, color: opts?.color ?? '#38bdf8' })
    },
    radiusHandle(paramKey: string, opts?: { center?: Vec3Obj; axis?: 'x' | 'y' | 'z'; color?: string }) {
      const schema = def.params?.[paramKey]
      if (!schema || schema.type !== 'number') return
      const rawVal = Number(resolvedParams[paramKey])
      const r = Number.isFinite(rawVal) ? Math.max(0.05, rawVal) : Math.max(0.05, schema.default)
      const c = resolveVec3Input(opts?.center) ?? handle.position
      push({
        kind: 'radiusHandle',
        paramKey,
        center: c,
        radius: r,
        axis: opts?.axis ?? 'x',
        color: opts?.color ?? '#38bdf8',
        min: schema.min,
        max: schema.max,
      })
    },
    positionHandle(paramKey: string, opts?: { color?: string }) {
      const schema = def.params?.[paramKey]
      if (!schema || schema.type !== 'vec3') return
      const pos = resolveVec3Input(resolvedParams[paramKey])
      if (!pos) return
      push({
        kind: 'positionHandle',
        paramKey,
        position: pos,
        color: opts?.color ?? '#fbbf24',
      })
    },
  }

  try {
    def.onDrawGizmos(selfCtx, gizmosApi)
  } catch {
    // 编辑器绘制 Gizmo 报错时静默兜底，避免影响视口主循环
  }
  return commands
}

registerRuntimeSystem('core.projectScripts', RUNTIME_STAGE.PRE_PHYSICS + 2, stepProjectScripts)
