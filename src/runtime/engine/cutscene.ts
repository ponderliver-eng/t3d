import {
  Color,
  LoopOnce,
  LoopRepeat,
  PerspectiveCamera,
  Quaternion,
  Vector3,
  type AnimationAction,
  type AnimationClip,
  type AnimationMixer,
  type Light,
  type Object3D,
} from 'three'
import { markSkeletonsDirty } from './materials'
import type {
  CutsceneAnimClip,
  CutsceneCameraShot,
  CutsceneKeyEase,
  CutscenePropertyKey,
  CutsceneValueType,
} from '../../capabilities/cutscene/schema'
import type { PbrSlot, SceneNode, ScenePicture, Vec3 } from '../../editor/scene/types'
import { evalEasing, type EasingName } from '../motion'
import { buildPlayableClip, type HumanoidClipBuildOptions } from './animation'
import { applyRuntimeMaterialProperty, readRuntimeMaterialProperty } from './materials'

const DEG_TO_RAD = Math.PI / 180
const RAD_TO_DEG = 180 / Math.PI

// ============================================================================
// 运行时内存覆写表（严禁 60Hz 刷 Store，Cutscene 驱动的脚本/能力/画面参数写入此处）
// ============================================================================

const scriptParamOverrides = new Map<string, Map<string, Record<string, unknown>>>()
const nodeCapOverrides = new Map<string, Map<string, Record<string, unknown>>>()
const pictureOverrides = new Map<string, unknown>()
const cutsceneDrivenAnimNodes = new Set<string>()

export function setCutsceneScriptParamOverride(nodeId: string, scriptId: string, paramKey: string, value: unknown): void {
  let byScript = scriptParamOverrides.get(nodeId)
  if (!byScript) {
    byScript = new Map()
    scriptParamOverrides.set(nodeId, byScript)
  }
  let rec = byScript.get(scriptId)
  if (!rec) {
    rec = {}
    byScript.set(scriptId, rec)
  }
  rec[paramKey] = value
}

export function getCutsceneScriptParamOverride(nodeId: string, scriptId: string): Record<string, unknown> | undefined {
  return scriptParamOverrides.get(nodeId)?.get(scriptId)
}

export function setCutsceneNodeCapOverride(nodeId: string, capId: string, key: string, value: unknown): void {
  let byCap = nodeCapOverrides.get(nodeId)
  if (!byCap) {
    byCap = new Map()
    nodeCapOverrides.set(nodeId, byCap)
  }
  let rec = byCap.get(capId)
  if (!rec) {
    rec = {}
    byCap.set(capId, rec)
  }
  rec[key] = value
}

export function getCutsceneNodeCapOverride(nodeId: string, capId: string): Record<string, unknown> | undefined {
  return nodeCapOverrides.get(nodeId)?.get(capId)
}

export function setCutscenePictureOverride(path: string, value: unknown): void {
  pictureOverrides.set(path, value)
}

export function getCutscenePictureOverride(path: string): unknown {
  return pictureOverrides.get(path)
}

export function applyCutscenePictureOverrides(base: ScenePicture): ScenePicture {
  if (pictureOverrides.size === 0) return base
  let next: ScenePicture | null = null
  const ensure = () => {
    if (!next) {
      next = {
        ...base,
        ...(base.capabilities ? { capabilities: { ...base.capabilities } } : {}),
      }
    }
    return next
  }
  for (const [path, value] of pictureOverrides.entries()) {
    if (path.startsWith('capabilities.')) {
      const rest = path.slice('capabilities.'.length)
      const dot = rest.indexOf('.')
      if (dot > 0) {
        const capId = rest.slice(0, dot)
        const field = rest.slice(dot + 1)
        const target = ensure()
        const caps = (target.capabilities ?? {}) as Record<string, Record<string, unknown> | undefined>
        target.capabilities = {
          ...caps,
          [capId]: { ...(caps[capId] ?? {}), [field]: value },
        }
      }
    } else {
      const target = ensure() as unknown as Record<string, unknown>
      target[path] = value
    }
  }
  return next ?? base
}

export function markCutsceneAnimNode(nodeId: string): void {
  cutsceneDrivenAnimNodes.add(nodeId)
}

export function isCutsceneDrivingAnim(nodeId: string): boolean {
  return cutsceneDrivenAnimNodes.has(nodeId)
}

export function clearCutsceneOverrides(): void {
  scriptParamOverrides.clear()
  nodeCapOverrides.clear()
  pictureOverrides.clear()
  cutsceneDrivenAnimNodes.clear()
}

export function clearCutsceneAnimMarks(): void {
  cutsceneDrivenAnimNodes.clear()
}

// ============================================================================
// 通用属性关键帧插值器
// ============================================================================

const tmpColorA = new Color()
const tmpColorB = new Color()
const tmpColorOut = new Color()

export function evalEaseFactor(ease: CutsceneKeyEase | undefined, u: number): number {
  if (ease === 'step') return 0
  if (ease === 'linear') return u
  if (!ease || ease === 'smooth') return u * u * (3 - 2 * u)
  return evalEasing(ease as EasingName, u)
}

function interpolateValue(
  a: CutscenePropertyKey['value'],
  b: CutscenePropertyKey['value'],
  t: number,
  valueType: CutsceneValueType,
): CutscenePropertyKey['value'] {
  if (valueType === 'boolean' || valueType === 'string') {
    return t >= 1 ? b : a
  }
  if (valueType === 'color') {
    if (typeof a === 'string' && typeof b === 'string') {
      tmpColorA.set(a)
      tmpColorB.set(b)
      tmpColorOut.copy(tmpColorA).lerp(tmpColorB, t)
      return `#${tmpColorOut.getHexString()}`
    }
    return t >= 1 ? b : a
  }
  if (valueType === 'vec2' || valueType === 'vec3' || valueType === 'vec4') {
    const arrA = Array.isArray(a) ? a : [0, 0, 0, 0]
    const arrB = Array.isArray(b) ? b : arrA
    const len = valueType === 'vec2' ? 2 : valueType === 'vec3' ? 3 : 4
    const out: number[] = []
    for (let i = 0; i < len; i += 1) {
      const va = Number(arrA[i]) || 0
      const vb = Number(arrB[i]) || 0
      out.push(va + (vb - va) * t)
    }
    return out
  }
  const na = Number(a) || 0
  const nb = Number(b) || 0
  return na + (nb - na) * t
}

export function evaluatePropertyKeys(
  keys: readonly CutscenePropertyKey[],
  time: number,
  valueType: CutsceneValueType,
): CutscenePropertyKey['value'] | undefined {
  if (keys.length === 0) return undefined
  if (keys.length === 1 || time <= keys[0].time) return keys[0].value
  const last = keys[keys.length - 1]
  if (time >= last.time) return last.value

  for (let i = 0; i < keys.length - 1; i += 1) {
    const k0 = keys[i]
    const k1 = keys[i + 1]
    if (time <= k1.time) {
      const span = k1.time - k0.time
      if (span <= 1e-6) return k1.value
      const rawU = Math.max(0, Math.min(1, (time - k0.time) / span))
      const factor = evalEaseFactor(k0.ease, rawU)
      return interpolateValue(k0.value, k1.value, factor, valueType)
    }
  }
  return last.value
}

// ============================================================================
// 骨骼动画确定性采样（支持跨骨架重定向 + 重叠交叉淡入淡出）
// ============================================================================

export interface CutsceneAnimResolver {
  getClip: (assetId: string, clipName: string) => AnimationClip | null
  getRetargetOptions?: (sourceAssetId: string, ownerAssetId: string, rawClip: AnimationClip) => Omit<HumanoidClipBuildOptions, 'rawClip' | 'sourceId' | 'ownerAssetId' | 'mask' | 'inPlace'> | null
}

function ensureClipAction(
  mixer: AnimationMixer,
  actions: Map<string, AnimationAction>,
  ownerAssetId: string,
  clipEntry: CutsceneAnimClip,
  resolver: CutsceneAnimResolver,
): AnimationAction | null {
  const sourceId = clipEntry.clipAssetId || ownerAssetId
  if (!sourceId || !clipEntry.clipName) return null
  const mask = clipEntry.mask ?? 'full'
  const inPlace = clipEntry.inPlace === true
  const cacheKey = `cutscene:${sourceId}:${ownerAssetId}:${clipEntry.clipName}:${mask}:${inPlace ? 1 : 0}`
  const existing = actions.get(cacheKey)
  if (existing) return existing

  const rawClip = resolver.getClip(sourceId, clipEntry.clipName)
  if (!rawClip) return null

  const extra = resolver.getRetargetOptions?.(sourceId, ownerAssetId, rawClip)
  const playable = buildPlayableClip({
    rawClip,
    sourceId,
    ownerAssetId,
    mask,
    inPlace,
    ...extra,
  })
  const action = mixer.clipAction(playable)
  actions.set(cacheKey, action)
  return action
}

export function sampleCutsceneAnimationClips(
  mixer: AnimationMixer,
  actions: Map<string, AnimationAction>,
  ownerAssetId: string,
  clips: readonly CutsceneAnimClip[],
  time: number,
  resolver: CutsceneAnimResolver,
): boolean {
  const active: Array<{ entry: CutsceneAnimClip; action: AnimationAction; localTime: number; weight: number }> = []

  for (const entry of clips) {
    if (time < entry.startTime || time > entry.startTime + entry.duration) continue
    const action = ensureClipAction(mixer, actions, ownerAssetId, entry, resolver)
    if (!action) continue
    const rawDur = Math.max(0.001, action.getClip().duration || entry.duration)
    const speed = entry.speed ?? 1
    const trimIn = entry.trimIn ?? 0
    let localTime = (time - entry.startTime) * speed + trimIn
    if (entry.loop) {
      localTime = ((localTime % rawDur) + rawDur) % rawDur
    } else {
      localTime = Math.max(0, Math.min(rawDur, localTime))
    }
    active.push({ entry, action, localTime, weight: 1 })
  }

  if (active.length === 0) return false

  // 计算双片段重叠区的线性交叉混合权重
  if (active.length >= 2) {
    active.sort((a, b) => a.entry.startTime - b.entry.startTime)
    const prev = active[active.length - 2]
    const next = active[active.length - 1]
    const overlapStart = next.entry.startTime
    const overlapEnd = Math.min(prev.entry.startTime + prev.entry.duration, next.entry.startTime + next.entry.duration)
    const overlapSpan = Math.max(1e-4, overlapEnd - overlapStart)
    const alpha = Math.max(0, Math.min(1, (time - overlapStart) / overlapSpan))
    for (const item of active) item.weight = 0
    prev.weight = 1 - alpha
    next.weight = alpha
  }

  const activeActions = new Set(active.map(a => a.action))
  for (const act of actions.values()) {
    if (!activeActions.has(act)) {
      act.enabled = false
      act.weight = 0
      act.stop()
    }
  }

  for (const item of active) {
    const act = item.action
    act.setLoop(item.entry.loop ? LoopRepeat : LoopOnce, item.entry.loop ? Infinity : 1)
    act.clampWhenFinished = !item.entry.loop
    act.enabled = true
    act.paused = false
    act.weight = item.weight
    if (!act.isRunning()) act.play()
    act.time = item.localTime
  }

  markSkeletonsDirty(mixer.getRoot() as Object3D)
  mixer.update(0)
  return true
}

// ============================================================================
// 通用属性读写（支持节点变换、灯光、相机、材质/Shader、能力包、玩法、脚本）
// ============================================================================

export function applyCutsceneNodeProperty(
  node: SceneNode,
  obj: Object3D | null,
  path: string,
  value: unknown,
): void {
  if (path === 'position' && Array.isArray(value) && obj) {
    obj.position.set(Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0)
    return
  }
  if (path === 'rotation' && Array.isArray(value) && obj) {
    obj.rotation.set(
      (Number(value[0]) || 0) * DEG_TO_RAD,
      (Number(value[1]) || 0) * DEG_TO_RAD,
      (Number(value[2]) || 0) * DEG_TO_RAD,
    )
    return
  }
  if (path === 'scale' && Array.isArray(value) && obj) {
    obj.scale.set(Number(value[0]) || 1, Number(value[1]) || 1, Number(value[2]) || 1)
    return
  }
  if (path === 'visible' && obj) {
    obj.visible = Boolean(value)
    return
  }

  // 灯光属性
  if (obj && (node.kind.endsWith('-light'))) {
    let light: Light | null = null
    obj.traverse(c => {
      if (!light && (c as Light).isLight) light = c as Light
    })
    if (light) {
      const l = light as Light & { distance?: number; angle?: number; decay?: number; groundColor?: Color }
      if (path === 'intensity' && typeof value === 'number') { l.intensity = value; return }
      if (path === 'color' && typeof value === 'string') { l.color.set(value); return }
      if (path === 'groundColor' && typeof value === 'string' && l.groundColor) { l.groundColor.set(value); return }
      if (path === 'range' && typeof value === 'number' && 'distance' in l) { l.distance = value; return }
      if (path === 'spotAngle' && typeof value === 'number' && 'angle' in l) { l.angle = value * DEG_TO_RAD; return }
    }
  }

  // 相机属性
  if (obj && node.kind === 'camera') {
    let cam: PerspectiveCamera | null = null
    obj.traverse(c => {
      if (!cam && (c as PerspectiveCamera).isPerspectiveCamera) cam = c as PerspectiveCamera
    })
    if (cam) {
      const c = cam as PerspectiveCamera
      if (path === 'fov' && typeof value === 'number') { c.fov = value; c.updateProjectionMatrix(); return }
      if (path === 'near' && typeof value === 'number') { c.near = Math.max(0.001, value); c.updateProjectionMatrix(); return }
      if (path === 'far' && typeof value === 'number') { c.far = Math.max(c.near + 0.01, value); c.updateProjectionMatrix(); return }
    }
  }

  // 脚本参数覆写：gameplay.packs.__project__.<scriptId>.<paramKey>
  if (path.startsWith('gameplay.packs.__project__.')) {
    const rest = path.slice('gameplay.packs.__project__.'.length)
    const dot = rest.indexOf('.')
    if (dot > 0) {
      const scriptId = rest.slice(0, dot)
      const paramKey = rest.slice(dot + 1)
      setCutsceneScriptParamOverride(node.id, scriptId, paramKey, value)
    }
    return
  }

  // 节点能力包参数覆写：capabilities.<capId>.<key>
  if (path.startsWith('capabilities.')) {
    const rest = path.slice('capabilities.'.length)
    const dot = rest.indexOf('.')
    if (dot > 0) {
      const capId = rest.slice(0, dot)
      const key = rest.slice(dot + 1)
      setCutsceneNodeCapOverride(node.id, capId, key, value)
    }
    return
  }

  // 材质与自定义着色器 Uniform（直接改写 Three.js Material 实例）
  if (obj) {
    applyRuntimeMaterialProperty(obj, path, value)
  }
}

export function readCutsceneNodeProperty(
  node: SceneNode,
  obj: Object3D | null,
  path: string,
): unknown {
  if (path === 'position') {
    return obj ? [obj.position.x, obj.position.y, obj.position.z] : [...node.position]
  }
  if (path === 'rotation') {
    return obj
      ? [obj.rotation.x * RAD_TO_DEG, obj.rotation.y * RAD_TO_DEG, obj.rotation.z * RAD_TO_DEG]
      : [...node.rotation]
  }
  if (path === 'scale') {
    return obj ? [obj.scale.x, obj.scale.y, obj.scale.z] : [...node.scale]
  }
  if (path === 'visible') {
    return obj ? obj.visible : node.visible
  }
  if (path === 'intensity') return node.intensity
  if (path === 'color') return obj ? (readRuntimeMaterialProperty(obj, 'color') ?? node.color) : node.color
  if (path === 'groundColor') return node.groundColor
  if (path === 'range') return node.range
  if (path === 'spotAngle') return node.spotAngle
  if (path === 'fov') return node.fov
  if (path === 'near') return node.near
  if (path === 'far') return node.far

  if (path.startsWith('gameplay.packs.__project__.')) {
    const rest = path.slice('gameplay.packs.__project__.'.length)
    const dot = rest.indexOf('.')
    if (dot > 0) {
      const scriptId = rest.slice(0, dot)
      const paramKey = rest.slice(dot + 1)
      const pack = node.gameplay?.packs?.__project__ as Record<string, Record<string, unknown> | undefined> | undefined
      return pack?.[scriptId]?.[paramKey]
    }
  }

  if (path.startsWith('capabilities.')) {
    const rest = path.slice('capabilities.'.length)
    const dot = rest.indexOf('.')
    if (dot > 0) {
      const capId = rest.slice(0, dot)
      const key = rest.slice(dot + 1)
      const cap = node.capabilities?.[capId] as Record<string, unknown> | undefined
      return cap?.[key]
    }
  }

  if (obj) {
    const matVal = readRuntimeMaterialProperty(obj, path)
    if (matVal !== undefined) return matVal
  }
  return (node as unknown as Record<string, unknown>)[path]
}

export function readCutscenePictureProperty(picture: ScenePicture, path: string): unknown {
  if (path.startsWith('capabilities.')) {
    const rest = path.slice('capabilities.'.length)
    const dot = rest.indexOf('.')
    if (dot > 0) {
      const capId = rest.slice(0, dot)
      const field = rest.slice(dot + 1)
      const cap = picture.capabilities?.[capId] as Record<string, unknown> | undefined
      return cap?.[field]
    }
  }
  return (picture as unknown as Record<string, unknown>)[path]
}

// ============================================================================
// 导演镜头轨求值（支持切镜与重叠/blendIn 平滑插值）
// ============================================================================

const tmpPosA = new Vector3()
const tmpPosB = new Vector3()
const tmpQuatA = new Quaternion()
const tmpQuatB = new Quaternion()
const tmpForward = new Vector3()
const tmpLookAt = new Vector3()

function readCameraPose(
  shot: CutsceneCameraShot,
  nodes: Record<string, SceneNode>,
  resolveObject: (id: string) => Object3D | null,
): { pos: Vector3; quat: Quaternion; fov: number } | null {
  const node = nodes[shot.cameraNodeId]
  const obj = resolveObject(shot.cameraNodeId)
  if (!node || !obj) return null
  obj.updateWorldMatrix(true, false)
  const pos = new Vector3()
  const quat = new Quaternion()
  const scale = new Vector3()
  obj.matrixWorld.decompose(pos, quat, scale)
  const fov = typeof shot.fov === 'number' ? shot.fov : node.fov
  return { pos, quat, fov }
}

export function evaluateCutsceneCameraTrack(
  shots: readonly CutsceneCameraShot[],
  time: number,
  nodes: Record<string, SceneNode>,
  resolveObject: (id: string) => Object3D | null,
): { position: Vec3; lookAt: Vec3; fov: number } | null {
  if (shots.length === 0) return null
  const active = shots.filter(s => time >= s.startTime && time <= s.startTime + s.duration)
  if (active.length === 0) return null

  active.sort((a, b) => a.startTime - b.startTime)
  const current = active[active.length - 1]
  const poseB = readCameraPose(current, nodes, resolveObject)
  if (!poseB) return null

  let pos = poseB.pos
  let quat = poseB.quat
  let fov = poseB.fov

  // 若存在两个镜头重叠，或配置了 blendIn 且能找到前序镜头，执行球面插值过渡
  if (active.length >= 2) {
    const prev = active[active.length - 2]
    const poseA = readCameraPose(prev, nodes, resolveObject)
    if (poseA) {
      const overlapEnd = Math.min(prev.startTime + prev.duration, current.startTime + current.duration)
      const span = Math.max(1e-4, overlapEnd - current.startTime)
      const u = Math.max(0, Math.min(1, (time - current.startTime) / span))
      const s = u * u * (3 - 2 * u)
      tmpPosA.copy(poseA.pos).lerp(poseB.pos, s)
      tmpQuatA.copy(poseA.quat).slerp(poseB.quat, s)
      pos = tmpPosA
      quat = tmpQuatA
      fov = poseA.fov + (poseB.fov - poseA.fov) * s
    }
  } else if ((current.blendIn ?? 0) > 0 && time - current.startTime < (current.blendIn ?? 0)) {
    const idx = shots.indexOf(current)
    const prev = idx > 0 ? shots[idx - 1] : null
    const poseA = prev ? readCameraPose(prev, nodes, resolveObject) : null
    if (poseA) {
      const u = Math.max(0, Math.min(1, (time - current.startTime) / Math.max(1e-4, current.blendIn!)))
      const s = u * u * (3 - 2 * u)
      tmpPosB.copy(poseA.pos).lerp(poseB.pos, s)
      tmpQuatB.copy(poseA.quat).slerp(poseB.quat, s)
      pos = tmpPosB
      quat = tmpQuatB
      fov = poseA.fov + (poseB.fov - poseA.fov) * s
    }
  }

  tmpForward.set(0, 0, -1).applyQuaternion(quat)
  tmpLookAt.copy(pos).add(tmpForward)
  return {
    position: [pos.x, pos.y, pos.z],
    lookAt: [tmpLookAt.x, tmpLookAt.y, tmpLookAt.z],
    fov,
  }
}

// ============================================================================
// 可动画属性清单枚举（自动扫描节点/材质/Shader/能力包/脚本参数）
// ============================================================================

export interface AnimatablePropertyDesc {
  path: string
  label: string
  valueType: CutsceneValueType
  currentValue: CutscenePropertyKey['value']
}

export function listAnimatablePropertiesForNode(
  node: SceneNode,
  obj: Object3D | null,
  customShaderParams?: Record<string, { type: string; label?: string; default?: unknown }>,
  scriptSchemas?: Record<string, { name: string; params: Record<string, { type: string; label?: string; default?: unknown }> }>,
): AnimatablePropertyDesc[] {
  const out: AnimatablePropertyDesc[] = [
    { path: 'position', label: '位置 (Position)', valueType: 'vec3', currentValue: readCutsceneNodeProperty(node, obj, 'position') as number[] },
    { path: 'rotation', label: '旋转 (Rotation)', valueType: 'vec3', currentValue: readCutsceneNodeProperty(node, obj, 'rotation') as number[] },
    { path: 'scale', label: '缩放 (Scale)', valueType: 'vec3', currentValue: readCutsceneNodeProperty(node, obj, 'scale') as number[] },
    { path: 'visible', label: '可见性 (Visible)', valueType: 'boolean', currentValue: Boolean(readCutsceneNodeProperty(node, obj, 'visible')) },
  ]

  if (node.kind.endsWith('-light')) {
    out.push(
      { path: 'intensity', label: '灯光强度 (Intensity)', valueType: 'number', currentValue: node.intensity },
      { path: 'color', label: '灯光颜色 (Color)', valueType: 'color', currentValue: node.color },
    )
    if (node.kind === 'point-light' || node.kind === 'spot-light') {
      out.push({ path: 'range', label: '照射距离 (Range)', valueType: 'number', currentValue: node.range })
    }
    if (node.kind === 'spot-light') {
      out.push({ path: 'spotAngle', label: '聚光角 (Spot Angle)', valueType: 'number', currentValue: node.spotAngle })
    }
    if (node.kind === 'hemisphere-light') {
      out.push({ path: 'groundColor', label: '地面颜色 (Ground Color)', valueType: 'color', currentValue: node.groundColor })
    }
  } else if (node.kind === 'camera') {
    out.push(
      { path: 'fov', label: '视场角 (FOV)', valueType: 'number', currentValue: node.fov },
      { path: 'near', label: '近裁剪面 (Near)', valueType: 'number', currentValue: node.near },
      { path: 'far', label: '远裁剪面 (Far)', valueType: 'number', currentValue: node.far },
    )
  } else if (node.kind !== 'empty' && node.kind !== 'effect' && node.kind !== 'screen' && node.kind !== 'spline') {
    if (node.kind === 'model' && node.slots.length > 0) {
      node.slots.forEach((slot: PbrSlot, idx: number) => {
        const prefix = `slots.${idx}.`
        const slotTag = slot.name || `材质槽 ${idx}`
        out.push(
          { path: `${prefix}color`, label: `[${slotTag}] 基础色`, valueType: 'color', currentValue: slot.color },
          { path: `${prefix}emissive`, label: `[${slotTag}] 自发光色`, valueType: 'color', currentValue: slot.emissive },
          { path: `${prefix}emissiveIntensity`, label: `[${slotTag}] 自发光强度`, valueType: 'number', currentValue: slot.emissiveIntensity },
          { path: `${prefix}metalness`, label: `[${slotTag}] 金属度`, valueType: 'number', currentValue: slot.metalness },
          { path: `${prefix}roughness`, label: `[${slotTag}] 粗糙度`, valueType: 'number', currentValue: slot.roughness },
          { path: `${prefix}opacity`, label: `[${slotTag}] 不透明度`, valueType: 'number', currentValue: slot.opacity },
        )
      })
    } else {
      out.push(
        { path: 'color', label: '材质基础色 (Color)', valueType: 'color', currentValue: node.color },
        { path: 'emissive', label: '自发光色 (Emissive)', valueType: 'color', currentValue: node.emissive },
        { path: 'emissiveIntensity', label: '自发光强度', valueType: 'number', currentValue: node.emissiveIntensity },
        { path: 'metalness', label: '金属度 (Metalness)', valueType: 'number', currentValue: node.metalness },
        { path: 'roughness', label: '粗糙度 (Roughness)', valueType: 'number', currentValue: node.roughness },
        { path: 'opacity', label: '不透明度 (Opacity)', valueType: 'number', currentValue: node.opacity },
      )
    }
    if (customShaderParams) {
      for (const [key, schema] of Object.entries(customShaderParams)) {
        const vt = schemaToValueType(schema.type)
        if (!vt) continue
        const cur = (node.capabilities?.__materialShaderParams as Record<string, unknown> | undefined)?.[key] ?? schema.default ?? 0
        out.push({
          path: `shaderParams.${key}`,
          label: `Shader: ${schema.label || key}`,
          valueType: vt,
          currentValue: cur as CutscenePropertyKey['value'],
        })
      }
    }
  }

  // 节点能力包参数（如水体 waveHeight 等）
  if (node.capabilities) {
    for (const [capId, capData] of Object.entries(node.capabilities)) {
      if (capId.startsWith('__') || !capData || typeof capData !== 'object') continue
      for (const [k, v] of Object.entries(capData as Record<string, unknown>)) {
        const vt = inferValueType(v)
        if (!vt) continue
        out.push({
          path: `capabilities.${capId}.${k}`,
          label: `${capId}.${k}`,
          valueType: vt,
          currentValue: v as CutscenePropertyKey['value'],
        })
      }
    }
  }

  // 挂载的脚本参数（__project__）
  const scripts = node.gameplay?.packs?.__project__ as Record<string, Record<string, unknown> | undefined> | undefined
  if (scripts) {
    for (const [scriptId, rawParams] of Object.entries(scripts)) {
      const schemaMeta = scriptSchemas?.[scriptId]
      const labelPrefix = schemaMeta?.name || scriptId
      if (schemaMeta?.params) {
        for (const [paramKey, schema] of Object.entries(schemaMeta.params)) {
          const vt = schemaToValueType(schema.type)
          if (!vt) continue
          const cur = rawParams?.[paramKey] ?? schema.default ?? 0
          out.push({
            path: `gameplay.packs.__project__.${scriptId}.${paramKey}`,
            label: `脚本 [${labelPrefix}].${schema.label || paramKey}`,
            valueType: vt,
            currentValue: cur as CutscenePropertyKey['value'],
          })
        }
      } else if (rawParams && typeof rawParams === 'object') {
        for (const [paramKey, val] of Object.entries(rawParams)) {
          if (paramKey.startsWith('__')) continue
          const vt = inferValueType(val)
          if (!vt) continue
          out.push({
            path: `gameplay.packs.__project__.${scriptId}.${paramKey}`,
            label: `脚本 [${labelPrefix}].${paramKey}`,
            valueType: vt,
            currentValue: val as CutscenePropertyKey['value'],
          })
        }
      }
    }
  }

  return out
}

export function listAnimatablePropertiesForPicture(picture: ScenePicture): AnimatablePropertyDesc[] {
  const out: AnimatablePropertyDesc[] = [
    { path: 'exposure', label: '画面曝光 (Exposure)', valueType: 'number', currentValue: picture.exposure },
    { path: 'bloomStrength', label: '泛光强度 (Bloom)', valueType: 'number', currentValue: picture.bloomStrength },
    { path: 'dofFocus', label: '景深焦距 (DOF Focus)', valueType: 'number', currentValue: picture.dofFocus },
    { path: 'dofFocal', label: '景深范围 (DOF Focal)', valueType: 'number', currentValue: picture.dofFocal },
    { path: 'fogNear', label: '线性雾起点 (Fog Near)', valueType: 'number', currentValue: picture.fogNear },
    { path: 'fogFar', label: '线性雾终点 (Fog Far)', valueType: 'number', currentValue: picture.fogFar },
    { path: 'hue', label: '色调偏移 (Hue)', valueType: 'number', currentValue: picture.hue },
    { path: 'saturation', label: '饱和度 (Saturation)', valueType: 'number', currentValue: picture.saturation },
  ]
  if (picture.capabilities) {
    for (const [capId, capData] of Object.entries(picture.capabilities)) {
      if (capId === 'cutscene' || capId === 'postEffects' || !capData || typeof capData !== 'object') continue
      for (const [k, v] of Object.entries(capData as Record<string, unknown>)) {
        const vt = inferValueType(v)
        if (!vt) continue
        out.push({
          path: `capabilities.${capId}.${k}`,
          label: `环境 [${capId}].${k}`,
          valueType: vt,
          currentValue: v as CutscenePropertyKey['value'],
        })
      }
    }
  }
  return out
}

function schemaToValueType(type: string): CutsceneValueType | null {
  if (type === 'number' || type === 'vec2' || type === 'vec3' || type === 'vec4' || type === 'color' || type === 'boolean') {
    return type
  }
  if (type === 'string' || type === 'enum') return 'string'
  return null
}

function inferValueType(v: unknown): CutsceneValueType | null {
  if (typeof v === 'number') return 'number'
  if (typeof v === 'boolean') return 'boolean'
  if (typeof v === 'string') return /^#[0-9a-fA-F]{3,8}$/.test(v) ? 'color' : 'string'
  if (Array.isArray(v)) {
    if (v.length === 2) return 'vec2'
    if (v.length === 3) return 'vec3'
    if (v.length === 4) return 'vec4'
  }
  return null
}
