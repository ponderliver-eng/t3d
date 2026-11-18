import { findNavigationPath } from '../capabilities/navigation/session'
import { moveCharacters } from '../capabilities/physics/session'
import { addRuntimeTag } from '../gameplay/runtimeTags'
import { clearJuice } from '../gameplay/juiceClock'
import { emitFootstep } from './signals'
import { carryFor } from './devices'
import { clipDuration } from '../editor/assets/models'
import { playBody } from '../editor/animation/director'
import { useEditorStore } from '../editor/scene/store'
import type { Vec3 } from '../editor/scene/types'
import {
  defaultCharacter,
  registerRuntimeSystem,
  type CharacterSpec,
  type SceneRuntimeHost,
} from './sceneRuntime'

interface Motion {
  yaw: number
  vy: number
  grounded: boolean
  lastGrounded: number
  jumpBufferUntil: number
  jumpsUsed: number
  dashUntil: number
  dashReady: number
  dashX: number
  dashZ: number
  invincibleUntil: number
  clip: string
  /** 起跳、滞空、落地各用自己的片段。 */
  jumpPhase: 'none' | 'rise' | 'hang' | 'land'
  jumpTime: number
  path: Vec3[]
  pathIndex: number
  footstep: number
  footsteps: number
}

const keys = new Set<string>()
const pressed = new Set<string>()
const motion = new Map<string, Motion>()
let listening = false

function ensureKeys() {
  if (listening || typeof window === 'undefined') return
  listening = true
  const down = (event: KeyboardEvent) => {
    if (typing(event.target)) return
    if (!keys.has(event.code)) pressed.add(event.code)
    keys.add(event.code)
  }
  window.addEventListener('keydown', down)
  window.addEventListener('keyup', event => {
    keys.delete(event.code)
    pressed.delete(event.code)
  })
  window.addEventListener('blur', () => {
    keys.clear()
    pressed.clear()
  })
}

function typing(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) return false
  const tag = element.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable
}

function held(code: string): boolean {
  return keys.has(code)
}

function tapped(code: string): boolean {
  return pressed.has(code)
}

function consumeTaps() {
  pressed.clear()
}

export function characterInvincible(nodeId: string, now = performance.now() / 1000): boolean {
  return (motion.get(nodeId)?.invincibleUntil ?? 0) > now
}

export function characterTraveling(id: string): boolean {
  if (orders.has(id)) return true
  const live = motion.get(id)
  if (!live) return false
  return live.pathIndex < live.path.length
}

export function relocateCharacter(id: string, x: number, y: number, z: number) {
  relocations.set(id, [x, y, z])
}

const orders = new Map<string, Vec3>()

export function orderCharacterMove(id: string, x: number, y: number, z: number) {
  orders.set(id, [x, y, z])
}

const relocations = new Map<string, Vec3>()

function takeRelocation(id: string): Vec3 | null {
  const next = relocations.get(id) ?? null
  if (next) relocations.delete(id)
  return next
}

function stepCharacters(dt: number, host: SceneRuntimeHost) {
  ensureKeys()
  const state = useEditorStore.getState()
  if (state.playState !== 'playing') {
    motion.clear()
    orders.clear()
    consumeTaps()
    clearJuice()
    return
  }
  const now = performance.now() / 1000
  const yaw = host.yaw?.() ?? 0
  for (const node of Object.values(state.nodes)) {
    const raw = node.gameplay?.character
    if (!raw?.enabled) continue
    const spec = { ...defaultCharacter(), ...raw }
    const object = host.resolveObject(node.id)
    if (!object) continue
    const live = motion.get(node.id) ?? freshMotion(yawOf(object.quaternion))
    const order = orders.get(node.id)
    if (order) {
      const path = findNavigationPath([object.position.x, object.position.y, object.position.z], order)
      live.path = path && path.length > 1 ? path.slice(1) : [order]
      live.pathIndex = 0
      orders.delete(node.id)
    }
    const placed = takeRelocation(node.id)
    if (placed) {
      object.position.set(placed[0], placed[1], placed[2])
      live.vy = 0
      live.grounded = true
    }
    const wish = wishInput(spec)
    const sprint = held('ShiftLeft') || held('ShiftRight')
    const speed = spec.moveSpeed * (sprint && wish.amount > 0 ? spec.sprintMultiplier : 1)
    const basis = facingBasis(spec, node.id, state.nodes, object.position.x, object.position.z, yaw, host)
    const world = rotate(wish.x, wish.z, basis.moveYaw)
    const dashPressed = spec.dash && tapped(spec.dashKey || 'KeyC')
    if (dashPressed && now >= live.dashReady) {
      const dir = wish.amount > 0.1 ? world : { x: Math.sin(live.yaw), z: Math.cos(live.yaw) }
      const len = Math.hypot(dir.x, dir.z) || 1
      live.dashX = dir.x / len
      live.dashZ = dir.z / len
      live.dashUntil = now + spec.dashDuration
      live.dashReady = live.dashUntil + spec.dashCooldown
      live.invincibleUntil = now + spec.dashInvincible
      addRuntimeTag(node.id, 'State.Invincible', spec.dashInvincible, now)
      live.path = []
    }
    const click = spec.mode === 'pointAndClick' || spec.driver !== 'capsule'
      ? host.consumeClick?.(spec.clickButton) ?? null
      : null
    if (click && (spec.driver === 'nav' || spec.driver === 'hybrid' || spec.mode === 'pointAndClick')) {
      const path = findNavigationPath([object.position.x, object.position.y, object.position.z], click)
      live.path = path && path.length > 1 ? path.slice(1) : [click]
      live.pathIndex = 0
    }
    if (wish.amount > 0.1 || now < live.dashUntil) live.path = []
    const dodging = now < live.dashUntil
    let moveX = 0
    let moveZ = 0
    if (dodging) {
      moveX = live.dashX * (spec.dashDistance / Math.max(0.05, spec.dashDuration))
      moveZ = live.dashZ * (spec.dashDistance / Math.max(0.05, spec.dashDuration))
    } else if (wish.amount > 0.1 && spec.driver !== 'nav') {
      moveX = world.x * speed
      moveZ = world.z * speed
    } else if (spec.driver === 'nav' && wish.amount > 0.1) {
      const steered = steer([object.position.x, object.position.y, object.position.z], {
        x: object.position.x + world.x * 2,
        y: object.position.y,
        z: object.position.z + world.z * 2,
      }, spec.clickStop)
      moveX = steered.x * speed
      moveZ = steered.z * speed
    } else if (live.path.length > 0) {
      const steered = followPath(object.position.x, object.position.z, live, spec.clickStop)
      moveX = steered.x * speed
      moveZ = steered.z * speed
    }
    const feet = object.position.y
    const ground = groundUnder(host, object.position.x, feet, object.position.z, node.id, spec)
    const onGround = ground !== null && feet <= ground + 0.08 && live.vy <= 0.1
    if (onGround) live.lastGrounded = now
    const coyote = now - live.lastGrounded <= spec.coyoteTime
    if (tapped('Space')) live.jumpBufferUntil = now + spec.jumpBuffer
    if (onGround && live.vy <= 0) live.jumpsUsed = 0
    const canJump = (coyote && live.jumpsUsed === 0) || (!onGround && live.jumpsUsed > 0 && live.jumpsUsed < spec.maxJumps) || (onGround && live.jumpsUsed < spec.maxJumps)
    let jumped = false
    if (now <= live.jumpBufferUntil && canJump && !dodging) {
      live.vy = spec.jumpSpeed
      live.jumpsUsed += 1
      live.jumpBufferUntil = 0
      live.lastGrounded = -999
      jumped = true
    }
    const supported = onGround || live.grounded
    if (!(supported && live.vy <= 0)) live.vy -= spec.gravity * dt
    let nextX = object.position.x + moveX * dt
    let nextY = feet + live.vy * dt
    let nextZ = object.position.z + moveZ * dt
    let landed = false
    if (spec.driver !== 'nav') {
      const solved = moveCharacters([{
        id: node.id,
        position: [object.position.x, feet, object.position.z],
        displacement: [moveX * dt, live.vy * dt, moveZ * dt],
        radius: spec.radius,
        height: spec.height,
      }])
      const step = solved?.[0]
      if (step) {
        nextX = step.position[0]
        nextY = step.position[1]
        nextZ = step.position[2]
        landed = step.grounded && live.vy <= 0.35
      } else {
        const blocked = slide(host, object.position.x, feet + spec.height * 0.45, object.position.z, nextX, nextZ, node.id, spec.radius)
        nextX = blocked.x
        nextZ = blocked.z
        landed = ground !== null && live.vy <= 0 && nextY <= ground + 0.08
        if (landed && ground !== null) nextY = ground
      }
    } else if (ground !== null && live.vy <= 0 && nextY <= ground + 0.08) {
      nextY = ground
      landed = true
    }
    if (landed) {
      live.vy = 0
      live.grounded = true
      live.lastGrounded = now
      if (!jumped) live.jumpsUsed = 0
    } else {
      live.grounded = false
    }
    const traveled = Math.hypot(nextX - object.position.x, nextZ - object.position.z)
    if (live.grounded && traveled > 0) {
      live.footstep += traveled
      if (live.footstep >= spec.footstepDistance) {
        live.footstep = 0
        live.footsteps += 1
        emitFootstep(node.id)
      }
    }
    object.position.set(nextX, nextY, nextZ)
    const carry = carryFor(nextX, nextY, nextZ)
    if (carry && live.grounded) object.position.set(nextX + carry.dx, nextY + carry.dy, nextZ + carry.dz)
    const face = faceYaw(spec, basis, wish, moveX, moveZ, dodging, live)
    if (face !== null) {
      const rate = Math.max(30, spec.turnSpeed) * Math.PI / 180 * (basis.lock ? 1.5 : 1)
      live.yaw = stepYaw(live.yaw, face, rate * dt)
    }
    object.quaternion.set(0, Math.sin(live.yaw / 2), 0, Math.cos(live.yaw / 2))
    stepJumpPose(node.id, node.assetId ?? '', spec, live, dt, now, jumped, dodging, wish.amount > 0.1 || Math.hypot(moveX, moveZ) > 0.2)
    if (live.jumpPhase !== 'none') {
      motion.set(node.id, live)
      continue
    }
    const clip = pickClip(spec, dodging, Math.hypot(moveX, moveZ) > 0.2, sprint)
    const clipKey = clip.name ? `${clip.assetId}\0${clip.name}` : ''
    if (clipKey && clipKey !== live.clip) {
      live.clip = clipKey
      const own = !clip.assetId || clip.assetId === node.assetId
      playBody(node.id, {
        clip: clip.name,
        assetId: own ? null : clip.assetId,
        loop: clip.name !== spec.dodgeClip && clip.name !== spec.landClip,
        fade: 0.12,
      })
    }
    motion.set(node.id, live)
  }
  consumeTaps()
}

function freshMotion(yaw: number): Motion {
  return {
    yaw, vy: 0, grounded: false, lastGrounded: 0, jumpBufferUntil: 0, jumpsUsed: 0,
    dashUntil: 0, dashReady: 0, dashX: 0, dashZ: 1, invincibleUntil: 0,
    clip: '', jumpPhase: 'none', jumpTime: 0, path: [], pathIndex: 0, footstep: 0, footsteps: 0,
  }
}

function wishInput(spec: CharacterSpec): { x: number, z: number, amount: number } {
  let x = 0
  let z = 0
  if (held('KeyW') || held('ArrowUp')) z += 1
  if (held('KeyS') || held('ArrowDown')) z -= 1
  if (held('KeyD') || held('ArrowRight')) x += 1
  if (held('KeyA') || held('ArrowLeft')) x -= 1
  if (spec.mode === 'side25d') z = 0
  const amount = Math.hypot(x, z)
  if (amount > 1) { x /= amount; z /= amount }
  return { x, z, amount: amount > 1 ? 1 : amount }
}

function facingBasis(
  spec: CharacterSpec,
  selfId: string,
  nodes: Record<string, { id: string, name: string }>,
  x: number,
  z: number,
  cameraYaw: number,
  host: SceneRuntimeHost,
): { moveYaw: number, faceYaw: number, lock: boolean } {
  if (spec.mode === 'side25d') return { moveYaw: cameraYaw, faceYaw: 0, lock: false }
  if (spec.mode === 'lockOn') {
    const target = spec.lockTargetId && spec.lockTargetId !== selfId
      ? nodes[spec.lockTargetId]
      : spec.lockTargetName
        ? Object.values(nodes).find(item => item.id !== selfId && item.name === spec.lockTargetName)
        : undefined
    const targetObject = target ? host.resolveObject(target.id) : null
    if (targetObject) {
      const yaw = Math.atan2(targetObject.position.x - x, targetObject.position.z - z)
      return { moveYaw: yaw, faceYaw: yaw, lock: true }
    }
  }
  if (spec.mode === 'strafe' || spec.mode === 'firstPerson' || spec.mode === 'lockOn') {
    // 镜头朝向是视线的 -Z；角色正面是模型的 +Z，同一个角会让脸和镜头相反。
    return { moveYaw: cameraYaw, faceYaw: cameraYaw + Math.PI, lock: true }
  }
  return { moveYaw: cameraYaw, faceYaw: cameraYaw, lock: false }
}

function rotate(x: number, z: number, yaw: number): { x: number, z: number } {
  const sin = Math.sin(yaw)
  const cos = Math.cos(yaw)
  return {
    x: x * cos - z * sin,
    z: -x * sin - z * cos,
  }
}

function faceYaw(spec: CharacterSpec, basis: { faceYaw: number, lock: boolean }, wish: { amount: number }, moveX: number, moveZ: number, dodging: boolean, live: Motion): number | null {
  if (dodging) return Math.atan2(live.dashX, live.dashZ)
  if (basis.lock || spec.mode === 'strafe' || spec.mode === 'firstPerson' || spec.mode === 'lockOn') return basis.faceYaw
  if (wish.amount > 0.1 || Math.hypot(moveX, moveZ) > 0.2) return Math.atan2(moveX, moveZ)
  return null
}

function yawOf(q: { x: number, y: number, z: number, w: number }): number {
  return Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z))
}

function stepYaw(current: number, target: number, maxStep: number): number {
  let delta = target - current
  if (delta > Math.PI) delta -= Math.PI * 2
  if (delta < -Math.PI) delta += Math.PI * 2
  if (Math.abs(delta) <= maxStep) return target
  return current + Math.sign(delta) * maxStep
}

function followPath(x: number, z: number, live: Motion, stop: number): { x: number, z: number } {
  while (live.pathIndex < live.path.length) {
    const point = live.path[live.pathIndex]
    if (Math.hypot(point[0] - x, point[2] - z) <= stop) live.pathIndex += 1
    else break
  }
  if (live.pathIndex >= live.path.length) {
    live.path = []
    return { x: 0, z: 0 }
  }
  const point = live.path[live.pathIndex]
  return steerPoint(x, z, point[0], point[2])
}

function steer(from: Vec3, to: { x: number, y: number, z: number }, stop: number): { x: number, z: number } {
  const path = findNavigationPath(from, [to.x, to.y, to.z])
  const next = path && path.length > 1 ? path[1] : [to.x, to.y, to.z] as Vec3
  if (Math.hypot(next[0] - from[0], next[2] - from[2]) <= stop) return { x: 0, z: 0 }
  return steerPoint(from[0], from[2], next[0], next[2])
}

function steerPoint(x: number, z: number, tx: number, tz: number): { x: number, z: number } {
  const dx = tx - x
  const dz = tz - z
  const len = Math.hypot(dx, dz) || 1
  return { x: dx / len, z: dz / len }
}

/** 起跳、滞空、落地各播自己的片段。没填的那一段就跳过。 */
function airborne(live: Motion, now: number): boolean {
  return now - live.lastGrounded >= 0.12 || live.vy < -2
}

function stepJumpPose(id: string, ownerAssetId: string, spec: CharacterSpec, live: Motion, dt: number, now: number, jumped: boolean, dodging: boolean, moving: boolean) {
  const anyJump = spec.jumpClip || spec.airClip || spec.landClip
  if (dodging || !anyJump) {
    if (live.jumpPhase !== 'none') live.clip = ''
    live.jumpPhase = 'none'
    return
  }
  const begin = (phase: Motion['jumpPhase']) => {
    live.jumpPhase = phase
    live.jumpTime = 0
    live.clip = ''
  }
  if (jumped && (spec.jumpClip || spec.airClip)) begin(spec.jumpClip ? 'rise' : 'hang')
  else if (live.jumpPhase === 'rise') {
    live.jumpTime += dt
    const duration = clipDuration(spec.jumpClipAssetId || ownerAssetId, spec.jumpClip)
    const finished = duration > 0 && live.jumpTime >= duration - 0.02
    const falling = live.vy <= 0 && live.jumpTime >= 0.12
    if (live.grounded) begin(spec.landClip ? 'land' : 'none')
    else if (finished || falling) begin('hang')
  } else if (live.jumpPhase === 'hang') {
    live.jumpTime += dt
    if (live.grounded) begin(spec.landClip ? 'land' : 'none')
  } else if (live.jumpPhase === 'land') {
    live.jumpTime += dt
    const duration = clipDuration(spec.landClipAssetId || ownerAssetId, spec.landClip)
    const contact = duration > 0 ? Math.min(0.22, Math.max(0.12, duration * 0.4)) : 0.16
    const finished = (duration > 0 && live.jumpTime >= Math.min(duration, 0.5) - 0.02) || (duration <= 0 && live.jumpTime >= 0.28)
    if (!live.grounded && airborne(live, now)) begin(spec.airClip ? 'hang' : 'none')
    else if (finished) begin('none')
    else if (moving && live.jumpTime >= contact) begin('none')
  } else if (!live.grounded && spec.airClip && airborne(live, now)) begin('hang')
  if (live.jumpPhase === 'rise' && spec.jumpClip) playOwned(id, ownerAssetId, live, spec.jumpClip, spec.jumpClipAssetId, false)
  else if (live.jumpPhase === 'hang' && spec.airClip) playOwned(id, ownerAssetId, live, spec.airClip, spec.airClipAssetId, true)
  else if (live.jumpPhase === 'land' && spec.landClip) playOwned(id, ownerAssetId, live, spec.landClip, spec.landClipAssetId, false)
}

function playOwned(id: string, ownerAssetId: string, live: Motion, name: string, assetId: string, loop: boolean) {
  const key = `${loop ? 'loop' : 'once'}\0${assetId}\0${name}`
  if (live.clip === key) return
  live.clip = key
  const own = !assetId || assetId === ownerAssetId
  playBody(id, { clip: name, assetId: own ? null : assetId, loop, fade: 0.1 })
}

function pickClip(spec: CharacterSpec, dodging: boolean, moving: boolean, sprint: boolean): { name: string, assetId: string } {
  if (dodging && spec.dodgeClip) return { name: spec.dodgeClip, assetId: spec.dodgeClipAssetId }
  if (moving && sprint && spec.runClip) return { name: spec.runClip, assetId: spec.runClipAssetId }
  if (moving && spec.walkClip) return { name: spec.walkClip, assetId: spec.walkClipAssetId }
  return { name: spec.idleClip, assetId: spec.idleClipAssetId }
}

function groundUnder(host: SceneRuntimeHost, x: number, y: number, z: number, id: string, spec: CharacterSpec): number | null {
  const distance = host.probe?.([x, y + spec.height * 0.5, z], [0, -1, 0], spec.height + 0.45, id)
  if (distance === null || distance === undefined) return null
  return y + spec.height * 0.5 - distance
}

function slide(host: SceneRuntimeHost, x: number, y: number, z: number, nextX: number, nextZ: number, id: string, radius: number): { x: number, z: number } {
  const dx = nextX - x
  const dz = nextZ - z
  const length = Math.hypot(dx, dz)
  if (length < 1e-5 || !host.probe) return { x: nextX, z: nextZ }
  const hit = host.probe([x, y, z], [dx / length, 0, dz / length], length + radius, id)
  if (hit === null || hit > length + radius * 0.2) return { x: nextX, z: nextZ }
  const allowed = Math.max(0, hit - radius)
  return { x: x + (dx / length) * allowed, z: z + (dz / length) * allowed }
}

export function characterOrDefault(spec: Partial<CharacterSpec> | null | undefined): CharacterSpec {
  return { ...defaultCharacter(), ...spec, enabled: spec?.enabled === true }
}

registerRuntimeSystem('core.character', 10, stepCharacters)
