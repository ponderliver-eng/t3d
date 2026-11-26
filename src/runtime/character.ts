import { findNavigationPath } from '../capabilities/navigation/session'
import { moveCharacters } from '../capabilities/physics/session'
import { sampleWaterSurface } from '../capabilities/water/session'
import { addRuntimeTag } from '../gameplay/runtimeTags'
import { clearJuice } from '../gameplay/juiceClock'
import { isCutsceneInputLocked } from '../capabilities/cutscene/session'
import { emitCharacterEvent, emitFootstep } from './signals'
import { playJuice } from '../gameplay/juice'
import { carryFor } from './devices'
import type { Vec3 } from '../editor/scene/types'
import { getRuntimeWorld } from './world'
import {
  bindGlobalInputListeners,
  getActionAxis2D,
  isActionPressed,
  isKeyHeld,
  wasActionTapped,
  wasKeyTapped,
} from '../core/input/actionMap'
import {
  defaultCharacter,
  registerRuntimeSystem,
  RUNTIME_STAGE,
  type CharacterSpec,
  type SceneRuntimeHost,
} from './sceneRuntime'

interface Motion {
  yaw: number
  vy: number
  extVx: number
  extVy: number
  extVz: number
  grounded: boolean
  swimming: boolean
  swimJumpUntil: number
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

const motion = new Map<string, Motion>()

function ensureKeys() {
  bindGlobalInputListeners()
}

function held(code: string): boolean {
  return isKeyHeld(code)
}

function tapped(code: string): boolean {
  return wasKeyTapped(code)
}

function consumeTaps() {
  // 帧末由 stepSceneRuntime 统一调用 consumeInputFrame()
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

export interface CharacterRuntimeModifiers {
  moveSpeedMul?: number
  gravityMul?: number
  inputLock?: boolean
}

const runtimeModifiers = new Map<string, CharacterRuntimeModifiers>()

export function setCharacterModifiers(nodeId: string, patch: CharacterRuntimeModifiers): void {
  const prev = runtimeModifiers.get(nodeId) ?? {}
  runtimeModifiers.set(nodeId, { ...prev, ...patch })
}

export function getCharacterModifiers(nodeId: string): CharacterRuntimeModifiers {
  return { ...(runtimeModifiers.get(nodeId) ?? {}) }
}

export function clearCharacterModifiers(nodeId: string): void {
  runtimeModifiers.delete(nodeId)
}

let simClock = 0

function stepCharacters(dt: number, host: SceneRuntimeHost) {
  ensureKeys()
  const worldState = getRuntimeWorld()
  if (worldState.getPlayState() !== 'playing') {
    simClock = 0
    motion.clear()
    orders.clear()
    runtimeModifiers.clear()
    consumeTaps()
    clearJuice()
    return
  }
  if (isCutsceneInputLocked()) {
    consumeTaps()
    return
  }
  simClock += Math.max(0, dt)
  const now = simClock
  const nodes = worldState.getNodes()
  const yaw = host.yaw?.() ?? 0
  for (const node of Object.values(nodes)) {
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
    const mods = runtimeModifiers.get(node.id)
    const inputLocked = Boolean(mods?.inputLock)
    const moveSpeedMul = typeof mods?.moveSpeedMul === 'number' && Number.isFinite(mods.moveSpeedMul) ? Math.max(0, mods.moveSpeedMul) : 1
    const gravityMul = typeof mods?.gravityMul === 'number' && Number.isFinite(mods.gravityMul) ? Math.max(0, mods.gravityMul) : 1
    const effectiveGravity = spec.gravity * gravityMul

    const wish = inputLocked ? { x: 0, z: 0, amount: 0 } : wishInput(spec)
    const sprint = !inputLocked && (isActionPressed('Sprint') || held('ShiftLeft') || held('ShiftRight'))
    const speed = spec.moveSpeed * moveSpeedMul * (sprint && wish.amount > 0 ? spec.sprintMultiplier : 1)
    const basis = facingBasis(spec, node.id, nodes, object.position.x, object.position.z, yaw, host)
    const world = rotate(wish.x, wish.z, basis.moveYaw)
    const dashPressed = !inputLocked && spec.dash && (wasActionTapped('Dash') || tapped(spec.dashKey || 'KeyC'))
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
    const useCapsule = spec.driver !== 'nav'
    const shift = useCapsule ? capsuleShift(spec, object.quaternion) : { x: 0, y: 0, z: 0 }
    const feet = object.position.y + shift.y
    const footX = object.position.x + shift.x
    const footZ = object.position.z + shift.z
    const water = spec.swim !== false ? sampleWaterSurface(footX, footZ) : null
    const submerged = water ? water.height - feet : -999
    const swimOffset = spec.swimHeightOffset ?? 0
    const targetSubmerged = Math.max(0.1, spec.height * 0.68 - swimOffset)
    const enterDepth = spec.height * 0.62
    const exitDepth = Math.max(0.05, Math.min(spec.height * 0.48, targetSubmerged - 0.18))
    const ground = useCapsule && live.grounded
      ? feet
      : groundUnder(host, useCapsule ? footX : object.position.x, useCapsule ? feet : object.position.y, useCapsule ? footZ : object.position.z, node.id, spec)
    const touchingFloor = ground !== null && feet <= ground + 0.12
    const swimJumping = now <= live.swimJumpUntil
    const wasGrounded = live.grounded
    if (water && submerged >= enterDepth) {
      if (!live.swimming) {
        live.swimming = true
        live.jumpsUsed = 0
        live.jumpPhase = 'none'
        live.clip = ''
        emitCharacterEvent(node.id, 'onEnterWater', { waterHeight: water.height })
      }
    } else if (!water || (submerged < exitDepth && (touchingFloor || swimJumping || submerged < -0.2))) {
      if (live.swimming) {
        live.swimming = false
        live.clip = ''
        if (!swimJumping) live.lastGrounded = now
        emitCharacterEvent(node.id, 'onExitWater')
      }
    }

    const onGround = !live.swimming && (live.grounded || (ground !== null && feet <= ground + 0.08 && live.vy <= 0.1))
    if (onGround) live.lastGrounded = now
    const coyote = now - live.lastGrounded <= spec.coyoteTime
    if (!inputLocked && (wasActionTapped('Jump') || tapped('Space'))) live.jumpBufferUntil = now + spec.jumpBuffer
    if (onGround && live.vy <= 0) live.jumpsUsed = 0
    const canJump = !inputLocked && (live.swimming || (coyote && live.jumpsUsed === 0) || (!onGround && live.jumpsUsed > 0 && live.jumpsUsed < spec.maxJumps) || (onGround && live.jumpsUsed < spec.maxJumps))
    let jumped = false
    if (now <= live.jumpBufferUntil && canJump && !dodging) {
      if (live.swimming) {
        live.vy = Math.max(live.vy, spec.jumpSpeed * 0.85)
        live.swimJumpUntil = now + 0.28
      } else {
        live.vy = spec.jumpSpeed
        live.jumpsUsed += 1
      }
      live.jumpBufferUntil = 0
      live.lastGrounded = -999
      jumped = true
      emitCharacterEvent(node.id, 'onJump', { swimming: live.swimming, jumpIndex: live.jumpsUsed })
    }
    if (live.swimming && water) {
      const swimScale = Math.max(0.1, spec.swimSpeedMultiplier ?? 0.65)
      if (!dodging) {
        moveX *= swimScale
        moveZ *= swimScale
      }
      if (now <= live.swimJumpUntil) {
        live.vy -= effectiveGravity * dt
      } else {
        // 弹簧-阻尼浮力：让角色随实时浪高柔和起伏，并叠加轻微的随浪斜坡漂流
        const targetFeetY = water.height - targetSubmerged
        live.vy += ((targetFeetY - feet) * 18 - live.vy * 6) * dt
        moveX += water.normal[0] * 0.45
        moveZ += water.normal[2] * 0.45
      }
    } else {
      const supported = onGround || live.grounded
      if (!(supported && live.vy <= 0)) live.vy -= effectiveGravity * dt
    }
    const damp = Math.exp(-(live.grounded ? 10 : 2.5) * dt)
    live.extVx *= damp
    live.extVy *= damp
    live.extVz *= damp
    if (Math.abs(live.extVx) < 0.01) live.extVx = 0
    if (Math.abs(live.extVy) < 0.01) live.extVy = 0
    if (Math.abs(live.extVz) < 0.01) live.extVz = 0
    const dispX = (moveX + live.extVx) * dt
    const dispY = (live.vy + live.extVy) * dt
    const dispZ = (moveZ + live.extVz) * dt
    let nextX = object.position.x + dispX
    let nextY = object.position.y + dispY
    let nextZ = object.position.z + dispZ
    let landed = false
    let platformYaw = 0
    if (spec.driver !== 'nav') {
      const solved = moveCharacters([{
        id: node.id,
        position: [footX, feet, footZ],
        displacement: [dispX, dispY, dispZ],
        radius: spec.radius,
        height: spec.height,
        dt,
        interact: spec.physicsInteract ?? false,
        mass: spec.mass ?? 65,
        pushStrength: spec.pushStrength ?? 1,
      }])
      const step = solved?.[0]
      if (step) {
        nextX = step.position[0] - shift.x
        nextY = step.position[1] - shift.y
        nextZ = step.position[2] - shift.z
        if (step.yawDelta) platformYaw = step.yawDelta
        if (step.impulse) {
          live.extVx += step.impulse[0]
          live.extVy += step.impulse[1]
          live.extVz += step.impulse[2]
          if (step.impulse[1] > 0.6) live.vy = Math.max(live.vy, step.impulse[1])
        }
        landed = step.grounded && live.vy <= 0.35 && live.extVy <= 0.6
      } else {
        const blocked = slide(host, footX, feet + spec.height * 0.45, footZ, footX + dispX, footZ + dispZ, node.id, spec.radius)
        nextX = blocked.x - shift.x
        nextZ = blocked.z - shift.z
        landed = ground !== null && live.vy <= 0 && nextY <= ground + 0.08
        if (landed && ground !== null) nextY = ground - shift.y
      }
    } else if (ground !== null && live.vy <= 0 && nextY <= ground + 0.08) {
      nextY = ground
      landed = true
    }
    if (landed && !live.swimming) {
      live.vy = 0
      live.grounded = true
      live.lastGrounded = now
      if (!jumped) live.jumpsUsed = 0
      if (!wasGrounded) emitCharacterEvent(node.id, 'onLand')
    } else {
      live.grounded = false
    }
    const traveled = Math.hypot(nextX - object.position.x, nextZ - object.position.z)
    if (live.grounded && !live.swimming && traveled > 0) {
      live.footstep += traveled
      if (live.footstep >= spec.footstepDistance) {
        live.footstep = 0
        live.footsteps += 1
        emitFootstep(node.id)
        if (spec.footstepJuice) playJuice(spec.footstepJuice, node.id, host)
      }
    }
    object.position.set(nextX, nextY, nextZ)
    const carry = carryFor(nextX, nextY, nextZ)
    if (carry && live.grounded) object.position.set(nextX + carry.dx, nextY + carry.dy, nextZ + carry.dz)
    if (platformYaw) live.yaw += platformYaw
    const face = faceYaw(spec, basis, wish, moveX, moveZ, dodging, live)
    if (face !== null) {
      const rate = Math.max(30, spec.turnSpeed) * Math.PI / 180 * (basis.lock ? 1.5 : 1)
      live.yaw = stepYaw(live.yaw, face, rate * dt)
    }
    object.quaternion.set(0, Math.sin(live.yaw / 2), 0, Math.cos(live.yaw / 2))
    if (live.swimming) {
      live.jumpPhase = 'none'
    } else {
      stepJumpPose(node.id, node.assetId ?? '', spec, live, dt, now, jumped, dodging, wish.amount > 0.1 || Math.hypot(moveX, moveZ) > 0.2)
    }
    if (live.jumpPhase !== 'none') {
      motion.set(node.id, live)
      continue
    }
    const clip = pickClip(spec, dodging, wish.amount > 0.1 || Math.hypot(moveX, moveZ) > 0.2, sprint, live.swimming)
    const clipKey = clip.name ? `${clip.assetId}\0${clip.name}` : ''
    if (clipKey && clipKey !== live.clip) {
      live.clip = clipKey
      const own = !clip.assetId || clip.assetId === node.assetId
      getRuntimeWorld().playBody?.(node.id, clip.name, {
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
    yaw, vy: 0, extVx: 0, extVy: 0, extVz: 0, grounded: false, swimming: false, swimJumpUntil: 0, lastGrounded: 0, jumpBufferUntil: 0, jumpsUsed: 0,
    dashUntil: 0, dashReady: 0, dashX: 0, dashZ: 1, invincibleUntil: 0,
    clip: '', jumpPhase: 'none', jumpTime: 0, path: [], pathIndex: 0, footstep: 0, footsteps: 0,
  }
}

function wishInput(spec: CharacterSpec): { x: number, z: number, amount: number } {
  const axis = getActionAxis2D('Move')
  const x = axis.x
  const z = spec.mode === 'side25d' ? 0 : axis.y
  const amount = Math.hypot(x, z)
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

function capsuleShift(spec: CharacterSpec, q: { x: number, y: number, z: number, w: number }): { x: number, y: number, z: number } {
  const offset = spec.capsuleOffset ?? [0, 0, 0]
  const yaw = yawOf(q)
  const sin = Math.sin(yaw)
  const cos = Math.cos(yaw)
  return {
    x: offset[0] * cos + offset[2] * sin,
    y: offset[1],
    z: -offset[0] * sin + offset[2] * cos,
  }
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
    const duration = getRuntimeWorld().clipDuration?.(spec.jumpClipAssetId || ownerAssetId, spec.jumpClip) ?? 0
    const finished = duration > 0 && live.jumpTime >= duration - 0.02
    const falling = live.vy <= 0 && live.jumpTime >= 0.12
    if (live.grounded) begin(spec.landClip ? 'land' : 'none')
    else if (finished || falling) begin('hang')
  } else if (live.jumpPhase === 'hang') {
    live.jumpTime += dt
    if (live.grounded) begin(spec.landClip ? 'land' : 'none')
  } else if (live.jumpPhase === 'land') {
    live.jumpTime += dt
    const duration = getRuntimeWorld().clipDuration?.(spec.landClipAssetId || ownerAssetId, spec.landClip) ?? 0
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
  getRuntimeWorld().playBody?.(id, name, { assetId: own ? null : assetId, loop, fade: 0.1 })
}

function pickClip(spec: CharacterSpec, dodging: boolean, moving: boolean, sprint: boolean, swimming: boolean): { name: string, assetId: string } {
  if (dodging && spec.dodgeClip) return { name: spec.dodgeClip, assetId: spec.dodgeClipAssetId }
  if (swimming) {
    if (moving && spec.swimClip) return { name: spec.swimClip, assetId: spec.swimClipAssetId ?? '' }
    if (spec.swimIdleClip) return { name: spec.swimIdleClip, assetId: spec.swimIdleClipAssetId ?? '' }
    if (spec.swimClip) return { name: spec.swimClip, assetId: spec.swimClipAssetId ?? '' }
  }
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

// 排在物理步进之后：脚下、身前的刚体这一帧已经动完，角色跟着它们的新位姿走，同帧不错位。
registerRuntimeSystem('core.character', RUNTIME_STAGE.POST_PHYSICS, stepCharacters)
