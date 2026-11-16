import { registerRuntimeSystem, type InteractSpec, type MoverSpec, type SceneRuntimeHost, type TriggerZoneSpec } from './sceneRuntime'
import { useEditorStore } from '../editor/scene/store'
import type { SceneNode, Vec3 } from '../editor/scene/types'
import { relocateCharacter } from './character'
import { writeUiVariable } from './ui/values'

const interactUsed = new Set<string>()
const zones = new Map<string, { inside: Set<string>, used: boolean }>()
let prompt = ''
const promptListeners = new Set<() => void>()
const pressed = new Set<string>()
let listening = false

export function playPrompt(): string {
  return prompt
}

export function subscribePlayPrompt(listener: () => void): () => void {
  promptListeners.add(listener)
  return () => promptListeners.delete(listener)
}

function setPrompt(next: string) {
  if (next === prompt) return
  prompt = next
  promptListeners.forEach(listener => listener())
}

function ensureKeys() {
  if (listening || typeof window === 'undefined') return
  listening = true
  window.addEventListener('keydown', event => {
    const element = event.target as HTMLElement | null
    const tag = element?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element?.isContentEditable) return
    pressed.add(event.code)
  })
  window.addEventListener('keyup', event => pressed.delete(event.code))
  window.addEventListener('blur', () => pressed.clear())
}

function stepDevices(_dt: number, host: SceneRuntimeHost) {
  ensureKeys()
  const state = useEditorStore.getState()
  if (state.playState !== 'playing') {
    interactUsed.clear()
    zones.clear()
    pressed.clear()
    setPrompt('')
    return
  }
  const actors = Object.values(state.nodes).filter(node => node.gameplay?.character?.enabled)
  let nextPrompt = ''
  for (const node of Object.values(state.nodes)) {
    if (node.gameplay?.interact?.enabled) nextPrompt = nearerPrompt(nextPrompt, touchInteract(node, node.gameplay.interact, actors, host))
    if (node.gameplay?.trigger?.enabled) touchTrigger(node, node.gameplay.trigger, actors, host)
  }
  setPrompt(nextPrompt)
  pressed.clear()
}

function touchInteract(node: SceneNode, spec: InteractSpec, actors: SceneNode[], host: SceneRuntimeHost): string {
  if (spec.once && interactUsed.has(node.id)) return ''
  const self = host.resolveObject(node.id)
  if (!self) return ''
  const radius = Math.max(0.2, spec.radius)
  const near = actors.some(actor => matchesTag(actor, spec.filterTagId) && within(self, host.resolveObject(actor.id), radius))
  if (!near) return ''
  if (pressed.has(spec.key || 'KeyE')) {
    interactUsed.add(node.id)
    const message = spec.message || 'onInteract'
    useEditorStore.getState().log('info', `${node.name}：${message}`)
    hear(message)
    grantInteractScore()
    return ''
  }
  return spec.prompt || '按 E 交互'
}

function touchTrigger(node: SceneNode, spec: TriggerZoneSpec, actors: SceneNode[], host: SceneRuntimeHost) {
  const live = zones.get(node.id) ?? { inside: new Set<string>(), used: false }
  const self = host.resolveObject(node.id)
  if (!self) return
  if (spec.once && live.used && live.inside.size === 0) return
  const radius = Math.max(0.2, spec.radius)
  const nowInside = new Set<string>()
  for (const actor of actors) {
    if (!matchesTag(actor, spec.filterTagId)) continue
    if (!within(self, host.resolveObject(actor.id), radius)) continue
    nowInside.add(actor.id)
    if (!live.inside.has(actor.id)) {
      useEditorStore.getState().log('info', `${node.name}：${spec.enterMessage || 'onZoneEnter'}`)
      hear(spec.enterMessage || 'onZoneEnter')
      live.used = true
    }
  }
  for (const id of live.inside) {
    if (nowInside.has(id)) continue
    useEditorStore.getState().log('info', `${node.name}：${spec.exitMessage || 'onZoneExit'}`)
    live.used = true
  }
  live.inside = nowInside
  zones.set(node.id, live)
}

function matchesTag(node: SceneNode, tagId: string): boolean {
  if (!tagId) return true
  if (node.tagId === tagId) return true
  return (node.tagIds ?? []).includes(tagId)
}

function within(self: { position: { x: number, y: number, z: number } } | null, other: { position: { x: number, y: number, z: number } } | null, radius: number): boolean {
  if (!self || !other) return false
  const dx = self.position.x - other.position.x
  const dy = self.position.y - other.position.y
  const dz = self.position.z - other.position.z
  return dx * dx + dy * dy + dz * dz <= radius * radius
}

function nearerPrompt(current: string, next: string): string {
  return next || current
}

interface Ride {
  origin: Vec3 | null
  travel: number
  forward: boolean
  started: boolean
  wait: number
}

function stepMovers(dt: number, host: SceneRuntimeHost) {
  carries.length = 0
  const state = useEditorStore.getState()
  if (state.playState !== 'playing') {
    rides.clear()
    heard.clear()
    return
  }
  for (const node of Object.values(state.nodes)) {
    const spec = node.gameplay?.mover
    if (!spec?.enabled) continue
    const object = host.resolveObject(node.id)
    if (!object) continue
    const ride = rides.get(node.id) ?? { origin: null, travel: 0, forward: true, started: spec.autoPlay, wait: 0 }
    if (!ride.origin) ride.origin = [object.position.x, object.position.y, object.position.z]
    if (!ride.started && heard.has(spec.startMessage)) ride.started = true
    const before: Vec3 = [object.position.x, object.position.y, object.position.z]
    if (ride.started) advanceRide(ride, spec, dt)
    const duration = Math.max(0.05, spec.duration)
    const along = ride.forward ? ride.travel / duration : 1 - ride.travel / duration
    const span = smooth(along)
    object.position.set(
      ride.origin[0] + spec.offset[0] * span,
      ride.origin[1] + spec.offset[1] * span,
      ride.origin[2] + spec.offset[2] * span,
    )
    rides.set(node.id, ride)
    carries.push({
      x: object.position.x,
      y: object.position.y,
      z: object.position.z,
      dx: object.position.x - before[0],
      dy: object.position.y - before[1],
      dz: object.position.z - before[2],
      radius: Math.max(0.4, spec.carryRadius),
    })
  }
}

function advanceRide(ride: Ride, spec: MoverSpec, dt: number) {
  const duration = Math.max(0.05, spec.duration)
  if (ride.wait > 0) {
    ride.wait = Math.max(0, ride.wait - dt)
    if (ride.wait > 0 || !spec.pingPong) return
    ride.travel = 0
    ride.forward = !ride.forward
    return
  }
  ride.travel += dt
  if (ride.travel < duration) return
  ride.travel = duration
  ride.wait = spec.pause
  if (!spec.pingPong) ride.started = false
  else if (spec.pause <= 0) {
    ride.travel = 0
    ride.forward = !ride.forward
  }
}

const rides = new Map<string, Ride>()
const carries: { x: number, z: number, y: number, dx: number, dy: number, dz: number, radius: number }[] = []
const heard = new Set<string>()
let spawnId = ''
let fallAt = 0
let scoreValue = 0
let scoreState = ''
let clock = 0
let shownTime = -1

function hear(message: string) {
  if (message) heard.add(message)
}

export function carryFor(x: number, y: number, z: number): { dx: number, dy: number, dz: number } | null {
  for (const item of carries) {
    const flat = (item.x - x) ** 2 + (item.z - z) ** 2
    if (flat > item.radius * item.radius) continue
    if (y < item.y - 0.35 || y > item.y + 1.8) continue
    return item
  }
  return null
}

function stepRound(_dt: number, host: SceneRuntimeHost) {
  const state = useEditorStore.getState()
  if (state.playState !== 'playing') {
    spawnId = ''
    fallAt = 0
    scoreValue = 0
    scoreState = ''
    clock = 0
    shownTime = -1
    return
  }
  const actors = Object.values(state.nodes).filter(node => node.gameplay?.character?.enabled)
  let abyssY = -12
  let abyssDelay = 1.2
  let abyssMessage = 'onPlayerRespawned'
  let abyssName = ''
  for (const node of Object.values(state.nodes)) {
    const spec = node.gameplay?.checkpoint
    if (!spec?.enabled) continue
    const point = host.resolveObject(node.id)
    if (!point) continue
    if (spec.spawn && !spawnId) spawnId = node.id
    if (node.id === spawnId || !abyssName) {
      abyssY = spec.abyssY
      abyssDelay = spec.delay
      abyssMessage = spec.message || abyssMessage
      abyssName = node.name
    }
    for (const actor of actors) {
      const body = host.resolveObject(actor.id)
      if (!body || !within(point, body, spec.radius) || spawnId === node.id) continue
      spawnId = node.id
      abyssY = spec.abyssY
      abyssDelay = spec.delay
      abyssMessage = spec.message || abyssMessage
      abyssName = node.name
      useEditorStore.getState().log('info', `${node.name}：检查点`)
    }
  }
  const now = performance.now() / 1000
  if (abyssName) for (const actor of actors) {
    const body = host.resolveObject(actor.id)
    if (!body) continue
    if (body.position.y < abyssY && fallAt <= 0) fallAt = now + Math.max(0, abyssDelay)
    if (fallAt > 0 && now >= fallAt) {
      const home = spawnId ? host.resolveObject(spawnId) : null
      if (home) {
        relocateCharacter(actor.id, home.position.x, home.position.y + 0.05, home.position.z)
        useEditorStore.getState().log('info', `${abyssName}：${abyssMessage}`)
      }
      fallAt = 0
    }
  }
  const board = Object.values(state.nodes).find(node => node.gameplay?.score?.enabled)
  const score = board?.gameplay?.score
  if (!score || scoreState === 'done') return
  if (clock <= 0) {
    clock = performance.now() / 1000
    writeUiVariable('objective', score.title)
    writeUiVariable('score', scoreValue)
  }
  const elapsed = performance.now() / 1000 - clock
  const left = score.timeLimit > 0 ? Math.ceil(Math.max(0, score.timeLimit - elapsed)) : 0
  if (left !== shownTime) {
    shownTime = left
    writeUiVariable('timeLeft', score.timeLimit > 0 ? left : '')
  }
  if (score.timeLimit > 0 && left <= 0 && scoreState !== 'defeat') {
    scoreState = 'defeat'
    useEditorStore.getState().log('info', `${board?.name}：${score.defeatMessage}`)
  }
}

function grantInteractScore() {
  const state = useEditorStore.getState()
  const board = Object.values(state.nodes).find(node => node.gameplay?.score?.enabled)
  const score = board?.gameplay?.score
  if (!score || scoreState === 'done' || scoreState === 'defeat' || scoreState === 'victory') return
  scoreValue += Math.max(0, score.perInteract)
  writeUiVariable('score', scoreValue)
  writeUiVariable('objective', score.title)
  if (scoreValue >= score.target) {
    scoreState = 'victory'
    useEditorStore.getState().log('info', `${board?.name}：${score.victoryMessage}`)
  }
}

function smooth(value: number): number {
  const t = Math.min(1, Math.max(0, value))
  return t * t * (3 - 2 * t)
}

registerRuntimeSystem('core.movers', 8, stepMovers)
registerRuntimeSystem('core.devices', 30, stepDevices)
registerRuntimeSystem('core.round', 40, stepRound)
