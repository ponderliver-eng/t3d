import { useEditorStore } from '../editor/scene/store'
import type { Vec3 } from '../editor/scene/types'
import { defaultCameraFollow, registerRuntimeSystem, type CameraFollowSpec, type SceneRuntimeHost } from './sceneRuntime'

interface Arm {
  yaw: number
  pitch: number
  position: Vec3 | null
}

const arms = new Map<string, Arm>()

function stepCameras(dt: number, host: SceneRuntimeHost) {
  const state = useEditorStore.getState()
  if (state.playState !== 'playing') {
    arms.clear()
    return
  }
  const active = Object.values(state.nodes).find(node => node.gameplay?.cameraFollow?.enabled)
  if (!active?.gameplay?.cameraFollow) return
  const spec = { ...defaultCameraFollow(), ...active.gameplay.cameraFollow }
  const target = resolveTarget(spec, active.id, state.nodes)
  const targetObject = target ? host.resolveObject(target.id) : null
  if (!targetObject) return
  const focus: Vec3 = [
    targetObject.position.x + spec.pivot[0],
    targetObject.position.y + spec.pivot[1],
    targetObject.position.z + spec.pivot[2],
  ]
  const arm = arms.get(active.id) ?? { yaw: host.yaw?.() ?? 0, pitch: host.pitch?.() ?? 0.35, position: null }
  const q = targetObject.quaternion
  const targetYaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z))
  const offset = orbitOffset(spec, arm, host, targetYaw)
  let desired: Vec3 = [focus[0] + offset[0], focus[1] + offset[1], focus[2] + offset[2]]
  if (spec.collision) desired = spring(host, focus, desired, target.id, spec.collisionRadius)
  const alpha = spec.damping > 0 && dt > 0 ? 1 - Math.exp(-spec.damping * dt) : 1
  const from = arm.position ?? desired
  const next: Vec3 = [
    from[0] + (desired[0] - from[0]) * alpha,
    from[1] + (desired[1] - from[1]) * alpha,
    from[2] + (desired[2] - from[2]) * alpha,
  ]
  arm.position = next
  arms.set(active.id, arm)
  host.poseCamera?.(next, spec.lookAtTarget ? focus : next, spec.fov)
}

function resolveTarget(spec: CameraFollowSpec, selfId: string, nodes: Record<string, { id: string, name: string }>) {
  if (!spec.targetName) return nodes[selfId]
  return Object.values(nodes).find(node => node.name === spec.targetName) ?? nodes[selfId]
}

function orbitOffset(spec: CameraFollowSpec, arm: Arm, host: SceneRuntimeHost, targetYaw: number): Vec3 {
  if (spec.orbit === 'none') {
    if (!spec.localOffset) return spec.offset
    const sin = Math.sin(targetYaw)
    const cos = Math.cos(targetYaw)
    return [spec.offset[0] * cos + spec.offset[2] * sin, spec.offset[1], -spec.offset[0] * sin + spec.offset[2] * cos]
  }
  if (spec.orbit === 'rightDrag') {
    arm.yaw = host.yaw?.() ?? arm.yaw
    arm.pitch = clampPitch(host.pitch?.() ?? arm.pitch, spec)
  } else {
    const delta = host.pointerDelta?.() ?? { x: 0, y: 0 }
    const sens = Math.max(0.01, spec.sensitivity) * Math.PI / 180
    arm.yaw += delta.x * sens
    arm.pitch = clampPitch(arm.pitch + delta.y * sens, spec)
  }
  const radius = Math.max(0.15, Math.hypot(spec.offset[0], spec.offset[1], spec.offset[2]))
  const shoulder = spec.offset[0]
  const back = Math.sqrt(Math.max(0.01, radius * radius - shoulder * shoulder))
  const local: Vec3 = [shoulder, back * Math.sin(arm.pitch), -back * Math.cos(arm.pitch)]
  const sin = Math.sin(arm.yaw)
  const cos = Math.cos(arm.yaw)
  return [local[0] * cos + local[2] * sin, local[1], -local[0] * sin + local[2] * cos]
}

function clampPitch(pitch: number, spec: CameraFollowSpec): number {
  const min = spec.minPitch * Math.PI / 180
  const max = spec.maxPitch * Math.PI / 180
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

registerRuntimeSystem('core.camera', 20, stepCameras)
