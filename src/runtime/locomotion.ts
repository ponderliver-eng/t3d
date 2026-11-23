import { getRuntimeWorld } from './world'
import {
  defaultLocomotion,
  registerRuntimeSystem,
  type LocomotionSpec,
  type SceneRuntimeHost,
} from './sceneRuntime'

/**
 * 运动动画：按节点「实际移动速度」在 待机 / 行走 / 奔跑 之间自动切换片段。
 * 它只看位移结果，不关心是谁在移动节点（脚本、导航、弹道、移动平台都行），
 * 所以动画切换不用写进移动脚本里，换角色只需要换片段名。
 * 玩家角色用内置 character 时由 character 自己切动画，这里会跳过。
 */
interface Track {
  x: number
  y: number
  z: number
  speed: number
  state: 'idle' | 'walk' | 'run'
  clipKey: string
}

const tracks = new Map<string, Track>()

/** 速度回落到阈值的这个比例以下才降档，避免在阈值附近来回抖动 */
const EXIT_RATIO = 0.8
/** 单帧位移折算超过这个速度视为瞬移（对象池取出、重生、传送），不计入速度 */
const TELEPORT_SPEED = 60

function pickState(spec: LocomotionSpec, speed: number, prev: Track['state']): Track['state'] {
  const runAt = spec.runClip ? Math.max(spec.walkSpeed, spec.runSpeed) : Infinity
  const walkAt = Math.max(0.01, spec.walkSpeed)
  if (speed >= runAt || (prev === 'run' && speed >= runAt * EXIT_RATIO)) return 'run'
  if (speed >= walkAt || (prev !== 'idle' && speed >= walkAt * EXIT_RATIO)) return 'walk'
  return 'idle'
}

function clipFor(spec: LocomotionSpec, state: Track['state']): { name: string; assetId: string } {
  if (state === 'run' && spec.runClip) return { name: spec.runClip, assetId: spec.runClipAssetId }
  if (state !== 'idle' && spec.walkClip) return { name: spec.walkClip, assetId: spec.walkClipAssetId }
  // 没填行走片段时移动中保持待机片段，总比不播强
  return { name: spec.idleClip, assetId: spec.idleClipAssetId }
}

function stepLocomotion(dt: number, host: SceneRuntimeHost) {
  const world = getRuntimeWorld()
  if (world.getPlayState() !== 'playing') {
    tracks.clear()
    return
  }
  if (dt <= 0) return
  const nodes = world.getNodes()
  const seen = new Set<string>()
  for (const node of Object.values(nodes)) {
    const raw = node.gameplay?.locomotion
    if (!raw?.enabled) continue
    // 内置角色控制器自带更完整的动画切换（含跳跃、闪避、游泳）
    if (node.gameplay?.character?.enabled) continue
    const object = host.resolveObject(node.id)
    if (!object || !object.visible) continue
    seen.add(node.id)
    const spec = { ...defaultLocomotion(), ...raw }
    const { x, y, z } = object.position
    let track = tracks.get(node.id)
    if (!track) {
      track = { x, y, z, speed: 0, state: 'idle', clipKey: '' }
      tracks.set(node.id, track)
    } else {
      const planar = Math.hypot(x - track.x, z - track.z) / dt
      const vertical = Math.abs(y - track.y) / dt
      track.x = x
      track.y = y
      track.z = z
      if (planar > TELEPORT_SPEED) {
        track.speed = 0
      } else {
        track.speed += (planar - track.speed) * Math.min(1, dt * 14)
        // 离地（明显的竖直运动）时保持当前片段，落地后再按水平速度判断
        if (vertical <= 2) track.state = pickState(spec, track.speed, track.state)
      }
    }
    const clip = clipFor(spec, track.state)
    if (!clip.name) continue
    const key = `${clip.assetId}\0${clip.name}`
    if (key === track.clipKey) continue
    track.clipKey = key
    const own = !clip.assetId || clip.assetId === node.assetId
    world.playBody?.(node.id, clip.name, { assetId: own ? null : clip.assetId, loop: true, fade: spec.fade })
  }
  if (tracks.size > seen.size) {
    for (const id of tracks.keys()) if (!seen.has(id)) tracks.delete(id)
  }
}

/** 试玩验收用：读取某节点当前的运动动画状态 */
export function readLocomotionState(nodeId: string): { state: 'idle' | 'walk' | 'run'; speed: number } | null {
  const track = tracks.get(nodeId)
  return track ? { state: track.state, speed: Number(track.speed.toFixed(2)) } : null
}

// 在脚本、物理、导航与内置角色都移动完之后、动画更新之前执行
registerRuntimeSystem('core.locomotion', 58, stepLocomotion)
