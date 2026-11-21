import { findNavigationPath } from '../../capabilities/navigation/session'
import type { SceneNode, Vec3 as TupleVec3 } from '../../editor/scene/types'
import { findRow } from '../../gameplay/registry'
import { playSound, stopMusic } from '../../runtime/audio'
import { measureCost } from '../../runtime/frameProfile'
import { registerRuntimeSystem, RUNTIME_STAGE, type SceneRuntimeHost } from '../../runtime/sceneRuntime'
import { uiValues, writeUiVariable } from '../../runtime/ui/values'
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
  onUpdate?: (self: unknown, dt: number) => void
  onDestroy?: (self: unknown) => void
  onMessage?: (self: unknown, msg: { name: string; payload?: unknown; sender?: unknown }) => void
}

export interface SystemDefinition {
  name: string
  stage?: 'prePhysics' | 'postPhysics' | 'postAnimation'
  order?: number
  onInit?: (api: unknown) => void
  onUpdate?: (api: unknown, dt: number) => void
  onDestroy?: (api: unknown) => void
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
  state: Record<string, unknown>
}

const compiledBehaviors = new Map<string, BehaviorDefinition>()
const compiledSystems = new Map<string, { def: SystemDefinition; unregister: () => void }>()
const instanceStates = new Map<string, BehaviorInstanceRecord>()
const messageQueue: Array<{ targetNodeId: string | null; name: string; payload?: unknown; senderId?: string }> = []
const globalMemory = new Map<string, unknown>()
const persistentMemory = new Map<string, unknown>()
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

function makeNodeHandle(nodeId: string, host: SceneRuntimeHost) {
  const world = getRuntimeWorld()
  const node = world.getNodes()[nodeId]
  if (!node) return null
  const obj = host.resolveObject(nodeId)
  const tags: string[] = [
    ...(node.tagId ? [node.tagId] : []),
    ...(node.tagIds ?? []),
  ]
  return {
    get id() { return node.id },
    get name() { return node.name },
    get tags() { return tags },
    get position(): Vec3Obj {
      return obj
        ? { x: obj.position.x, y: obj.position.y, z: obj.position.z }
        : toVec3Obj(node.position)
    },
    set position(val: Vec3Obj) {
      if (obj) obj.position.set(val.x, val.y, val.z)
      else world.updateNode(nodeId, { position: [val.x, val.y, val.z] })
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
    },
    get scale(): Vec3Obj {
      return obj
        ? { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z }
        : toVec3Obj(node.scale)
    },
    set scale(val: Vec3Obj) {
      if (obj) obj.scale.set(val.x, val.y, val.z)
    },
    get visible(): boolean {
      return obj ? obj.visible : node.visible
    },
    set visible(val: boolean) {
      if (obj) obj.visible = val
      world.updateNode(nodeId, { visible: val })
    },
    hasTag: (tag: string) => tags.includes(tag) || tags.some((t) => t.startsWith(`${tag}.`)),
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
      const next = { ...world.getNodes() }
      delete next[nodeId]
      world.setNodes(next)
    },
  }
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
  const resolvedParams: Record<string, unknown> = {}
  const inputRecord = rawParams && typeof rawParams === 'object' ? (rawParams as Record<string, unknown>) : {}
  for (const [k, schema] of Object.entries(def?.params ?? {})) {
    const val = k in inputRecord ? inputRecord[k] : defaultForSchema(schema)
    if (schema.type === 'vec2' && Array.isArray(val)) resolvedParams[k] = { x: Number(val[0]) || 0, y: Number(val[1]) || 0 }
    else if (schema.type === 'vec3' && Array.isArray(val)) resolvedParams[k] = { x: Number(val[0]) || 0, y: Number(val[1]) || 0, z: Number(val[2]) || 0 }
    else if (schema.type === 'ref' && schema.target === 'node' && typeof val === 'string') resolvedParams[k] = makeNodeHandle(val, host)
    else resolvedParams[k] = val
  }

  const handle = makeNodeHandle(node.id, host)!
  const obj = host.resolveObject(node.id)

  return {
    node: handle,
    params: resolvedParams,
    state: stateObj,
    elapsedTime: simElapsed,
    get position() { return handle.position },
    set position(v: Vec3Obj) { handle.position = v },
    get rotation() { return handle.rotation },
    set rotation(v: Vec3Obj) { handle.rotation = v },
    get scale() { return handle.scale },
    set scale(v: Vec3Obj) { handle.scale = v },
    get visible() { return handle.visible },
    set visible(v: boolean) { handle.visible = v },
    moveToward(target: Vec3Obj, maxDistance: number): boolean {
      const vec = resolveVec3Input(target)
      if (!vec) return false
      const cur = handle.position
      const dx = vec.x - cur.x
      const dy = vec.y - cur.y
      const dz = vec.z - cur.z
      const dist = Math.hypot(dx, dy, dz)
      if (dist <= 1e-4 || dist <= maxDistance) {
        handle.position = { x: vec.x, y: vec.y, z: vec.z }
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
    lookAt(target: Vec3Obj) {
      const vec = resolveVec3Input(target)
      if (obj && vec && Number.isFinite(vec.x) && Number.isFinite(vec.y) && Number.isFinite(vec.z)) {
        obj.lookAt(vec.x, vec.y, vec.z)
      }
    },
    sendMessage(name: string, payload?: unknown) {
      messageQueue.push({ targetNodeId: node.id, name, payload, senderId: node.id })
    },
    broadcast(name: string, payload?: unknown) {
      messageQueue.push({ targetNodeId: null, name, payload, senderId: node.id })
    },
    getBehavior: (behavior: BehaviorDefinition) => handle.getBehavior(behavior),
    findNodeById: (id: string) => makeNodeHandle(id, host),
    findNodesByTag: (tag: string) =>
      Object.values(world.getNodes())
        .filter((n) => n.tagId === tag || n.tagIds?.includes(tag))
        .map((n) => makeNodeHandle(n.id, host))
        .filter(Boolean),
    findNodesInRadius: (center: Vec3Obj, radius: number, tag?: string) => {
      const r2 = radius * radius
      return Object.values(world.getNodes())
        .filter((n) => {
          if (tag && n.tagId !== tag && !n.tagIds?.includes(tag)) return false
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
    spawnPrefab: (prefabId: string, opts?: { position?: Vec3Obj }) => {
      const pos: TupleVec3 = opts?.position ? [opts.position.x, opts.position.y, opts.position.z] : [0, 0, 0]
      world.instantiatePrefab?.(prefabId, { position: pos })
      return null
    },
    destroyNode: (target: { id: string }) => {
      const next = { ...world.getNodes() }
      delete next[target.id]
      world.setNodes(next)
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
      sphereCast: () => [],
      getVelocity: () => ({ x: 0, y: 0, z: 0 }),
      setVelocity: () => {},
      applyImpulse: () => {},
      applyForce: () => {},
    },
    nav: {
      moveTo: (target: Vec3Obj) => {
        const cur = handle.position
        const path = findNavigationPath([cur.x, cur.y, cur.z], [target.x, target.y, target.z])
        return Boolean(path && path.length > 0)
      },
      stop: () => {},
      isMoving: false,
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
    audio: {
      playSfx: (assetId: string, opts?: { volume?: number; pitch?: number }) => {
        playSound({ assetId, bus: 'sfx', volume: opts?.volume, playbackRate: opts?.pitch, parent: obj ?? undefined })
      },
      playBgm: (assetId: string, opts?: { volume?: number; loop?: boolean }) => {
        playSound({ assetId, bus: 'music', volume: opts?.volume, loop: opts?.loop ?? true })
      },
      stopBgm: () => stopMusic(),
    },
    fx: { spawn: () => {} },
    input: {
      isPressed: (actionOrKey: string) => isActionPressed(actionOrKey) || isKeyHeld(actionOrKey) || isKeyHeld(`Key${actionOrKey.toUpperCase()}`),
      justPressed: (actionOrKey: string) => wasActionTapped(actionOrKey) || wasKeyTapped(actionOrKey) || wasKeyTapped(`Key${actionOrKey.toUpperCase()}`),
      isKeyPressed: (code: string) => isKeyHeld(code) || isKeyHeld(`Key${code.toUpperCase()}`),
      justReleased: () => false,
      axis1D: (action: string) => (isActionPressed(action) ? 1 : 0),
      axis2D: (action: string) => getActionAxis2D(action),
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
      onEvent: () => () => {},
    },
    scene: {
      currentId: () => world.getActiveSceneId(),
      load: () => {},
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
      def.stage === 'postAnimation'
        ? RUNTIME_STAGE.POST_ANIMATION
        : def.stage === 'postPhysics'
          ? RUNTIME_STAGE.PHYSICS_NAV + 5
          : RUNTIME_STAGE.PRE_PHYSICS + 1
    const unregister = registerRuntimeSystem(
      `script.${id}`,
      baseOrder + (def.order ?? 0),
      (dt, host) => {
        if (getRuntimeWorld().getPlayState() !== 'playing') return
        def.onUpdate?.({ host, elapsedTime: simElapsed }, dt)
      },
    )
    compiledSystems.set(id, { def, unregister })
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

export function clearScriptRuntimeState(): void {
  instanceStates.clear()
  messageQueue.length = 0
  globalMemory.clear()
  simElapsed = 0
  framePointerDelta = { x: 0, y: 0 }
  framePointerPos = { x: 0, y: 0 }
  frameWheelDelta = 0
  prevMouseButtons = 0
  currMouseButtons = 0
}

function stepProjectScripts(dt: number, host: SceneRuntimeHost) {
  const world = getRuntimeWorld()
  if (world.getPlayState() !== 'playing') {
    clearScriptRuntimeState()
    return
  }
  simElapsed += Math.max(0, dt)
  framePointerDelta = host.peekPointerDelta?.() ?? host.pointerDelta?.() ?? { x: 0, y: 0 }
  framePointerPos = host.pointerNormalized?.() ?? { x: 0, y: 0 }
  frameWheelDelta = host.peekWheel?.() ?? host.wheel?.() ?? 0
  prevMouseButtons = currMouseButtons
  currMouseButtons = host.mouseButtons ? host.mouseButtons() : (host.rightHeld?.() ? 2 : 0)
  const nodes = world.getNodes()
  const activeKeys = new Set<string>()

  for (const node of Object.values(nodes)) {
    const projectScripts = node.gameplay?.packs?.__project__
    if (!projectScripts || typeof projectScripts !== 'object') continue
    for (const [scriptId, rawParams] of Object.entries(projectScripts as Record<string, unknown>)) {
      if (rawParams && typeof rawParams === 'object' && (rawParams as Record<string, unknown>).__enabled === false) {
        continue
      }
      const def = compiledBehaviors.get(scriptId)
      if (!def) continue
      const key = instanceKey(node.id, scriptId)
      activeKeys.add(key)
      let rec = instanceStates.get(key)
      if (!rec) {
        rec = {
          nodeId: node.id,
          scriptId,
          started: false,
          state: def.state ? { ...def.state() } : {},
        }
        instanceStates.set(key, rec)
      }
      const ctx = buildScriptContext(node, scriptId, rawParams, rec.state, host)
      measureCost(`script:${scriptId}`, () => {
        try {
          if (!rec!.started) {
            rec!.started = true
            def.onStart?.(ctx)
          }
          def.onUpdate?.(ctx, dt)
        } catch (error) {
          world.log('error', `脚本 "${def.name}" 运行错误: ${error instanceof Error ? error.message : String(error)}`)
        }
      })
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
          world.log('error', `脚本 "${def.name}" 消息处理错误: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
  }

  // 清理已移除节点或卸载脚本的实例状态
  for (const [key, rec] of instanceStates.entries()) {
    if (activeKeys.has(key)) continue
    const def = compiledBehaviors.get(rec.scriptId)
    const node = nodes[rec.nodeId]
    if (def?.onDestroy && node) {
      const ctx = buildScriptContext(node, rec.scriptId, {}, rec.state, host)
      try { def.onDestroy(ctx) } catch { /* ignore */ }
    }
    instanceStates.delete(key)
  }
}

registerRuntimeSystem('core.projectScripts', RUNTIME_STAGE.PRE_PHYSICS + 2, stepProjectScripts)
