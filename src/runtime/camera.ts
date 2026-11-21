import { juiceShake } from '../gameplay/juiceClock'
import type { SceneNode, Vec3 } from '../editor/scene/types'
import { defaultCameraFollow, defaultCharacter, registerRuntimeSystem, resolveCharacterCamera, type CameraFollowSpec, type SceneRuntimeHost } from './sceneRuntime'
import { getRuntimeWorld } from './world'

interface Arm {
  yaw: number
  pitch: number
  /** 相对偏移长度的倍率。1 是组件上写的距离。 */
  zoom: number
  startYaw: number
  startPitch: number
  position: Vec3 | null
  local: boolean
  noted: boolean
}

export interface CameraArmPose {
  zoom: number
  yaw: number
  pitch: number
  changed: boolean
}

const arms = new Map<string, Arm>()

function stepCameras(dt: number, host: SceneRuntimeHost) {
  const world = getRuntimeWorld()
  const playState = world.getPlayState()
  if (playState === 'stopped') {
    arms.clear()
    return
  }
  if (playState !== 'playing') return
  const nodes = world.getNodes()
  const wheel = host.wheel?.() ?? 0
  const active = Object.values(nodes).find(node => node.gameplay?.character?.enabled && node.gameplay.cameraFollow?.enabled !== false)
    ?? Object.values(nodes).find(node => node.gameplay?.cameraFollow?.enabled)
  if (!active) return
  const character = active.gameplay?.character?.enabled ? { ...defaultCharacter(), ...active.gameplay.character } : null
  const spec = character
    ? resolveCharacterCamera(character, active.gameplay?.cameraFollow)
    : { ...defaultCameraFollow(), ...active.gameplay?.cameraFollow }
  if (!spec.enabled) return
  const target = character ? active : resolveTarget(spec, active.id, nodes)
  const targetObject = target ? host.resolveObject(target.id) : null
  if (!targetObject) return
  const lockNode = character?.mode === 'lockOn' ? resolveLock(character, active.id, nodes) : undefined
  const lockObject = lockNode ? host.resolveObject(lockNode.id) : null
  const focus: Vec3 = [
    targetObject.position.x + spec.pivot[0],
    targetObject.position.y + spec.pivot[1],
    targetObject.position.z + spec.pivot[2],
  ]
  const lookAt: Vec3 = lockObject ? [
    (focus[0] + lockObject.position.x) * 0.5,
    (focus[1] + lockObject.position.y + spec.pivot[1] * 0.6) * 0.5,
    (focus[2] + lockObject.position.z) * 0.5,
  ] : focus
  const arm = arms.get(active.id) ?? freshArm(spec, host)
  if (arm.local !== spec.localOffset) {
    arm.local = spec.localOffset
    arm.yaw = spec.localOffset ? 0 : (host.yaw?.() ?? arm.yaw)
    arm.position = null
  }
  const q = targetObject.quaternion
  const targetYaw = lockObject
    ? Math.atan2(lockObject.position.x - targetObject.position.x, lockObject.position.z - targetObject.position.z)
    : Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z))
  steer(spec, arm, host)
  arm.pitch = clampPitch(arm.pitch, spec)
  if (character?.mode === 'firstPerson') {
    poseFirstPerson(active.id, spec, arm, focus, host)
    return
  }
  const scale = dolly(spec, arm, wheel)
  const yaw = lockObject
    ? targetYaw + Math.PI
    : (spec.orbit === 'none' ? targetYaw : (spec.localOffset ? targetYaw + arm.yaw : arm.yaw))
  const offset = orbitOffset(spec, yaw, arm.pitch, scale)
  let desired: Vec3 = [focus[0] + offset[0], focus[1] + offset[1], focus[2] + offset[2]]
  if (spec.collision) desired = spring(host, focus, desired, target.id, spec.collisionRadius)
  const alpha = spec.damping > 0 && dt > 0 ? 1 - Math.exp(-spec.damping * dt) : 1
  const from = arm.position ?? desired
  const next: Vec3 = [
    from[0] + (desired[0] - from[0]) * alpha,
    from[1] + (desired[1] - from[1]) * alpha,
    from[2] + (desired[2] - from[2]) * alpha,
  ]
  const shake = juiceShake()
  const shaken: Vec3 = [next[0] + shake.x, next[1] + shake.y, next[2]]
  arm.position = next
  arms.set(active.id, arm)
  if (!arm.noted && armChanged(arm)) {
    arm.noted = true
    getRuntimeWorld().markPlayDirty()
  }
  host.poseCamera?.(shaken, lookPoint(shaken, lookAt, spec.lookAtTarget), spec.fov)
}

/** 第一人称停在眼睛上，朝向跟着鼠标。不把眼睛高度再当成绕头公转的力臂。 */
function poseFirstPerson(id: string, spec: CameraFollowSpec, arm: Arm, focus: Vec3, host: SceneRuntimeHost) {
  const yaw = arm.yaw
  const pitch = arm.pitch
  const flat = Math.cos(pitch)
  const forward: Vec3 = [-Math.sin(yaw) * flat, Math.sin(pitch), -Math.cos(yaw) * flat]
  const right: Vec3 = [Math.cos(yaw), 0, -Math.sin(yaw)]
  const eye: Vec3 = [
    focus[0] + right[0] * spec.offset[0] + forward[0] * spec.offset[2],
    focus[1] + spec.offset[1] + forward[1] * spec.offset[2],
    focus[2] + right[2] * spec.offset[0] + forward[2] * spec.offset[2],
  ]
  const look: Vec3 = [eye[0] + forward[0], eye[1] + forward[1], eye[2] + forward[2]]
  arm.position = eye
  arms.set(id, arm)
  if (!arm.noted && armChanged(arm)) {
    arm.noted = true
    getRuntimeWorld().markPlayDirty()
  }
  const shake = juiceShake()
  host.poseCamera?.(
    [eye[0] + shake.x, eye[1] + shake.y, eye[2]],
    [look[0] + shake.x, look[1] + shake.y, look[2]],
    spec.fov,
  )
}

function freshArm(spec: CameraFollowSpec, host: SceneRuntimeHost): Arm {
  const yaw = typeof spec.orbitYaw === 'number'
    ? spec.orbitYaw * Math.PI / 180
    : (spec.localOffset ? 0 : (host.yaw?.() ?? 0))
  const pitch = clampPitch(
    typeof spec.orbitPitch === 'number' ? spec.orbitPitch * Math.PI / 180 : (host.pitch?.() ?? 0),
    spec,
  )
  return { yaw, pitch, zoom: 1, startYaw: yaw, startPitch: pitch, position: null, local: spec.localOffset, noted: false }
}

function armChanged(arm: Arm): boolean {
  return Math.abs(arm.zoom - 1) > 0.001 || Math.abs(angleDelta(arm.yaw, arm.startYaw)) > 0.001 || Math.abs(angleDelta(arm.pitch, arm.startPitch)) > 0.001
}

function angleDelta(current: number, start: number): number {
  let delta = current - start
  if (delta > Math.PI) delta -= Math.PI * 2
  if (delta < -Math.PI) delta += Math.PI * 2
  return delta
}

/** 试玩中滚轮和右键转出来的机位。保存修改时写回跟随镜头。 */
export function cameraArmOf(id: string): CameraArmPose | null {
  const arm = arms.get(id)
  if (!arm) return null
  return { zoom: arm.zoom, yaw: arm.yaw, pitch: arm.pitch, changed: armChanged(arm) }
}

/** 距离已经写进偏移后，倍率收回 1，避免下一帧再乘一次。 */
export function settleCameraArm(id: string) {
  const arm = arms.get(id)
  if (!arm) return
  arm.zoom = 1
  arm.startYaw = arm.yaw
  arm.startPitch = arm.pitch
  arm.noted = false
}

function resolveLock(character: { lockTargetId?: string, lockTargetName: string }, selfId: string, nodes: Record<string, SceneNode>) {
  if (character.lockTargetId && character.lockTargetId !== selfId && nodes[character.lockTargetId]) return nodes[character.lockTargetId]
  if (!character.lockTargetId && character.lockTargetName) {
    return Object.values(nodes).find(item => item.id !== selfId && item.name === character.lockTargetName)
  }
  return undefined
}

function resolveTarget(spec: CameraFollowSpec, selfId: string, nodes: Record<string, { id: string, name: string }>) {
  if (spec.targetId && nodes[spec.targetId]) return nodes[spec.targetId]
  if (!spec.targetId && spec.targetName) return Object.values(nodes).find(node => node.name === spec.targetName) ?? nodes[selfId]
  return nodes[selfId]
}

function steer(spec: CameraFollowSpec, arm: Arm, host: SceneRuntimeHost) {
  const delta = host.pointerDelta?.() ?? { x: 0, y: 0 }
  if (spec.orbit === 'none') return
  const drag = spec.orbit === 'mouse' || host.rightHeld?.() === true
  if (!drag) return
  const sens = Math.max(0.01, spec.sensitivity) * 0.02
  arm.yaw -= delta.x * sens
  arm.pitch = clampPitch(arm.pitch - delta.y * sens, spec)
}

function dolly(spec: CameraFollowSpec, arm: Arm, wheel: number): number {
  if (!spec.zoom) {
    arm.zoom = 1
    return 1
  }
  const base = Math.max(0.05, Math.hypot(spec.offset[0], spec.offset[1], spec.offset[2]))
  const minScale = Math.max(0.05, spec.minDistance) / base
  const maxScale = Math.max(minScale, spec.maxDistance) / base
  if (wheel) {
    const steps = Math.sign(wheel) * Math.min(Math.abs(wheel), 400) / 100
    arm.zoom *= Math.exp(steps * Math.max(0.01, spec.zoomSpeed))
  }
  arm.zoom = Math.min(maxScale, Math.max(minScale, arm.zoom))
  return arm.zoom
}

function orbitOffset(spec: CameraFollowSpec, yaw: number, pitch: number, scale = 1): Vec3 {
  const scaled: Vec3 = [spec.offset[0] * scale, spec.offset[1] * scale, spec.offset[2] * scale]
  if (spec.orbit === 'none' && !spec.localOffset) return scaled
  const pitchNow = spec.orbit === 'none' ? 0 : pitch
  const [x, y, z] = scaled
  const behind = -z
  const cp = Math.cos(pitchNow)
  const sp = Math.sin(pitchNow)
  const y1 = y * cp - behind * sp
  const z1 = y * sp + behind * cp
  const sy = Math.sin(yaw)
  const cy = Math.cos(yaw)
  return [x * cy + z1 * sy, y1, -x * sy + z1 * cy]
}

function lookPoint(eye: Vec3, focus: Vec3, lookAtTarget: boolean): Vec3 {
  if (lookAtTarget) return focus
  const dx = eye[0] - focus[0]
  const dy = eye[1] - focus[1]
  const dz = eye[2] - focus[2]
  const len = Math.hypot(dx, dy, dz)
  if (len < 1e-4) return [eye[0], eye[1], eye[2] - 1]
  return [eye[0] + dx / len, eye[1] + dy / len, eye[2] + dz / len]
}

function clampPitch(pitch: number, spec: CameraFollowSpec): number {
  let min = spec.minPitch * Math.PI / 180
  let max = spec.maxPitch * Math.PI / 180
  if (min > max) [min, max] = [max, min]
  return Math.min(max, Math.max(min, pitch))
}

function spring(host: SceneRuntimeHost, focus: Vec3, desired: Vec3, ignoreId: string, radius: number): Vec3 {
  const dx = desired[0] - focus[0]
  const dy = desired[1] - focus[1]
  const dz = desired[2] - focus[2]
  const dist = Math.hypot(dx, dy, dz)
  if (dist < 0.25 || !host.probe) return desired
  const hit = host.probe(focus, [dx / dist, dy / dist, dz / dist], dist, ignoreId)
  if (hit === null || hit >= dist) return desired
  const safe = Math.max(0.2, hit - radius)
  return [focus[0] + dx / dist * safe, focus[1] + dy / dist * safe, focus[2] + dz / dist * safe]
}

registerRuntimeSystem('core.camera', 75, stepCameras)
