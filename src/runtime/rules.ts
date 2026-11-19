import { playBody, playUpper, stopUpper, bodyProgress } from '../editor/animation/director'
import { clipDuration } from '../editor/assets/models'
import { instantiatePrefab, readPrefab } from '../editor/assets/prefab'
import { useAssetStore } from '../editor/assets/library'
import { clearPlayCameraForce, forcePlayCamera } from '../editor/viewport/playCamera'
import { useEditorStore } from '../editor/scene/store'
import type { SceneNode, Vec3 } from '../editor/scene/types'
import { characterTraveling, orderCharacterMove } from './character'
import { onFootstep } from './signals'
import { addRuleScore } from './devices'
import { findPackAction, findPackCondition, findPackTrigger, findRow, listEnabledPackTriggers } from '../gameplay/registry'
import { playJuice } from '../gameplay/juice'
import { playSound, stopMusic } from './audio'
import { addRuntimeTag, clearRuntimeTags, nodeHasTag, removeRuntimeTag, tickRuntimeTags } from '../gameplay/runtimeTags'
import { setScreenVisible } from './ui/values'
import {
  readRuleStates,
  readRules,
  registerRuntimeSystem,
  type RuleCondition,
  type RuleEntry,
  type RuleStateNode,
  type RuleStep,
  type SceneRuntimeHost,
} from './sceneRuntime'

interface Job {
  nodeId: string
  ruleId: string
  stateId: string
  source: 'rule' | 'enter' | 'tick' | 'exit'
  steps: RuleStep[]
  index: number
  wait: number
  frame: boolean
  list: string[]
  target: string
  moving: boolean
  loop: { ids: string[], item: number, steps: RuleStep[], after: RuleStep[] } | null
}

interface StateCursor {
  stateId: string
  phase: 'entering' | 'ticking' | 'exiting'
  pendingId: string
}

export interface RuleTrace {
  ruleId: string
  stepId: string
  stateId: string
  waiting: boolean
  value: number | null
}

const jobs: Job[] = []
const vars = new Map<string, number>()
const texts = new Map<string, string>()
const messageFields = new Map<string, number>()
const inbox: { nodeId: string, trigger: RuleEntry['trigger'], message: string }[] = []
const heldKeys = new Set<string>()
const tappedKeys = new Set<string>()
const cursors = new Map<string, StateCursor>()
const traces = new Map<string, RuleTrace>()
let keysOn = false
let started = false

export function ruleTrace(nodeId: string): RuleTrace | null {
  return traces.get(nodeId) ?? null
}

function watchKeys() {
  if (keysOn || typeof window === 'undefined') return
  keysOn = true
  window.addEventListener('keydown', event => {
    const tag = (event.target as HTMLElement | null)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
    if (!heldKeys.has(event.code)) tappedKeys.add(event.code)
    heldKeys.add(event.code)
  })
  window.addEventListener('keyup', event => heldKeys.delete(event.code))
  window.addEventListener('blur', () => {
    heldKeys.clear()
    tappedKeys.clear()
  })
}

export function postRuleEvent(nodeId: string, trigger: RuleEntry['trigger'], message = '') {
  inbox.push({ nodeId, trigger, message })
}

export function postRuleMessage(message: string, nodeId = '', fields?: Record<string, number | string>) {
  if (!message) return
  texts.set('msg', message)
  messageFields.clear()
  if (fields) {
    for (const [key, raw] of Object.entries(fields)) {
      const number = typeof raw === 'number' ? raw : Number(raw)
      if (Number.isFinite(number)) messageFields.set(`msg.${key}`, number)
    }
  }
  inbox.push({ nodeId, trigger: 'message', message })
}

onFootstep(nodeId => postRuleMessage('onFootstep', nodeId))

function stepRules(dt: number, host: SceneRuntimeHost) {
  watchKeys()
  const state = useEditorStore.getState()
  if (state.playState !== 'playing') {
    jobs.length = 0
    vars.clear()
    texts.clear()
    messageFields.clear()
    clearRuntimeTags()
    inbox.length = 0
    tappedKeys.clear()
    cursors.clear()
    traces.clear()
    started = false
    clearPlayCameraForce()
    return
  }
  const now = performance.now() / 1000
  tickRuntimeTags(now)
  if (!started) {
    started = true
    for (const node of Object.values(state.nodes)) fire(node, 'playStart', '')
  }
  const batch = inbox.splice(0, inbox.length)
  for (const event of batch) {
    for (const node of Object.values(state.nodes)) {
      if (event.nodeId && event.nodeId !== node.id) continue
      if (event.trigger === 'message') {
        for (const rule of readRules(node.gameplay?.rules)) {
          if (rule.trigger === 'message' && rule.message && rule.message === event.message) arm(node, rule)
        }
        continue
      }
      fire(node, event.trigger, event.message)
    }
  }
  for (const node of Object.values(state.nodes)) {
    for (const rule of readRules(node.gameplay?.rules)) {
      if (rule.trigger === 'key' && keyHit(rule.key, tappedKeys)) arm(node, rule)
    }
  }
  const packTriggers = listEnabledPackTriggers(state.gameplayPacks)
  if (packTriggers.length > 0) {
    for (const node of Object.values(state.nodes)) {
      for (const rule of readRules(node.gameplay?.rules)) {
        const reg = findPackTrigger(rule.trigger, state.gameplayPacks)
        if (reg?.enabled && reg.def.poll?.(node, rule, host)) arm(node, rule)
      }
    }
  }
  tappedKeys.clear()
  tickStates(host)
  for (let i = jobs.length - 1; i >= 0; i -= 1) {
    if (advance(jobs[i], dt, host, now)) jobs.splice(i, 1)
  }
}

function keyHit(expected: string, codes: Set<string>): boolean {
  const want = expected.trim()
  if (!want || codes.size === 0) return false
  if (codes.has(want)) return true
  const upper = want.toUpperCase()
  if (want.length === 1 && upper >= 'A' && upper <= 'Z' && codes.has(`Key${upper}`)) return true
  if (want.length === 1 && want >= '0' && want <= '9' && codes.has(`Digit${want}`)) return true
  const lower = want.toLowerCase()
  for (const code of codes) {
    if (code.toLowerCase() === lower) return true
  }
  return false
}

function fire(node: SceneNode, trigger: RuleEntry['trigger'], message: string) {
  for (const rule of readRules(node.gameplay?.rules)) {
    if (rule.trigger !== trigger) continue
    if (trigger === 'message' && rule.message && rule.message !== message) continue
    arm(node, rule)
  }
}

function arm(node: SceneNode, rule: RuleEntry) {
  if (!rule.enabled) return
  if (!allPass(node, rule.conditions)) return
  if (rule.steps.length === 0) return
  jobs.push({
    nodeId: node.id, ruleId: rule.id, stateId: '', source: 'rule',
    steps: rule.steps.map(copyStep), index: 0, wait: 0, frame: false, list: [], target: '', moving: false, loop: null,
  })
}

function advance(job: Job, dt: number, host: SceneRuntimeHost, now: number): boolean {
  const node = useEditorStore.getState().nodes[job.nodeId]
  if (!node) return true
  let guard = 0
  while (job.index < job.steps.length && guard < 48) {
    guard += 1
    const step = job.steps[job.index]
    const waiting = step?.do === 'wait' && job.wait > 0 || step?.do === 'waitUpper' || step?.do === 'waitMark' || step?.do === 'waitFrame' && job.frame
    markTrace(job, step, waiting)
    if (!step) break
    if (step.do === 'wait') {
      if (job.wait <= 0) job.wait = Math.max(0, evaluate(step.value) || step.seconds)
      job.wait -= dt
      if (job.wait > 0) {
        markTrace(job, step, true)
        return false
      }
      job.wait = 0
      job.index += 1
      continue
    }
    if (step.do === 'waitFrame') {
      if (!job.frame) {
        job.frame = true
        markTrace(job, step, true)
        return false
      }
      job.frame = false
      job.index += 1
      continue
    }
    if (step.do === 'moveTo') {
      if (!job.moving) {
        const point = pointOf(step, job, host)
        if (!point) {
          job.index += 1
          continue
        }
        orderCharacterMove(job.nodeId, point[0], point[1], point[2])
        job.moving = true
        markTrace(job, step, true)
        return false
      }
      if (characterTraveling(job.nodeId)) {
        markTrace(job, step, true)
        return false
      }
      job.moving = false
      job.index += 1
      continue
    }
    if (step.do === 'waitUpper') {
      if (node.overlayPlaying) {
        markTrace(job, step, true)
        return false
      }
      job.index += 1
      continue
    }
    if (step.do === 'waitMark') {
      const mark = Math.min(1, Math.max(0, evaluate(step.value) || step.seconds))
      const progress = node.overlayClip ? overlayProgress(node) : bodyProgress(node.id)
      lastValue = progress
      if (progress + 0.001 < mark) {
        markTrace(job, step, true)
        return false
      }
      job.index += 1
      continue
    }
    if (step.do === 'if') {
      const passed = allPass(node, step.conditions)
      lastValue = passed ? 1 : 0
      if (passed && step.steps.length > 0) {
        job.steps = [...job.steps.slice(0, job.index + 1), ...step.steps.map(copyStep), ...job.steps.slice(job.index + 1)]
      }
      job.index += 1
      continue
    }
    if (step.do === 'each') {
      if (job.list.length === 0 || step.steps.length === 0) {
        job.index += 1
        continue
      }
      job.loop = {
        ids: job.list.slice(),
        item: 0,
        steps: step.steps.map(copyStep),
        after: job.steps.slice(job.index + 1).map(copyStep),
      }
      job.target = job.loop.ids[0]
      job.steps = job.loop.steps.map(copyStep)
      job.index = 0
      continue
    }
    if (step.do === 'switchState' && step.stateId) {
      const cursor = cursors.get(job.nodeId)
      if (cursor && cursor.stateId !== step.stateId) cursor.pendingId = step.stateId
      job.index += 1
      continue
    }
    run(node, step, job, host, now)
    job.index += 1
  }
  if (job.loop && job.index >= job.steps.length) {
    job.loop.item += 1
    if (job.loop.item < job.loop.ids.length) {
      job.target = job.loop.ids[job.loop.item]
      job.steps = job.loop.steps.map(copyStep)
      job.index = 0
      return false
    }
    job.steps = job.loop.after
    job.index = 0
    job.loop = null
    return false
  }
  const cursor = cursors.get(job.nodeId)
  traces.set(job.nodeId, { ruleId: '', stepId: '', stateId: cursor?.stateId ?? '', waiting: false, value: lastValue })
  return job.index >= job.steps.length
}

function markTrace(job: Job, step: RuleStep | undefined, waiting: boolean) {
  traces.set(job.nodeId, {
    ruleId: job.ruleId,
    stepId: step?.id ?? '',
    stateId: cursors.get(job.nodeId)?.stateId ?? job.stateId,
    waiting,
    value: lastValue,
  })
}

function run(node: SceneNode, step: RuleStep, job: Job, host: SceneRuntimeHost, now: number) {
  const actor = job.target ? useEditorStore.getState().nodes[job.target] ?? node : node
  if (step.do === 'message') {
    postRuleMessage(step.message)
    useEditorStore.getState().log('info', `${node.name}：${step.message}`)
    return
  }
  if (step.do === 'setVar') {
    const value = evaluate(step.value)
    lastValue = value
    if (step.name) vars.set(step.name, value)
    return
  }
  if (step.do === 'addTag') {
    const row = findRow(useEditorStore.getState().gameDatabase, 'tags', step.tag)
    if (step.tag.trim() && !row) useEditorStore.getState().log('warn', `玩法标签缺少一行：${step.tag}`)
    const fallback = Number(row?.fields?.defaultDurationSec ?? 0)
    const seconds = step.seconds > 0 ? step.seconds : (Number.isFinite(fallback) ? fallback : 0)
    addRuntimeTag(actor.id, step.tag, seconds, now)
    return
  }
  if (step.do === 'removeTag') {
    removeRuntimeTag(actor.id, step.tag)
    return
  }
  if (step.do === 'playClip' && step.clip) {
    playOn(actor, step, false)
    return
  }
  if (step.do === 'playUpper' && step.clip) {
    playOn(actor, step, true)
    return
  }
  if (step.do === 'stance') {
    if (!step.clip) stopUpper(actor.id)
    else playUpper(actor.id, { clip: step.clip, assetId: clipAsset(actor, step), loop: true, fade: actor.clipFade ?? 0.15 })
    return
  }
  if (step.do === 'showUi' || step.do === 'hideUi') {
    const screen = findNamed(step.name, 'screen')
    if (screen) setScreenVisible(screen.id, step.do === 'showUi')
    return
  }
  if (step.do === 'lock') {
    const target = step.name ? findNamed(step.name) : job.target ? useEditorStore.getState().nodes[job.target] : undefined
    const character = node.gameplay?.character
    if (!character) return
    useEditorStore.getState().updateNode(node.id, {
      gameplay: { ...node.gameplay, character: { ...character, lockTargetName: target?.name ?? '', lockTargetId: target?.id ?? '' } },
    })
    return
  }
  if (step.do === 'camera') {
    const camera = findNamed(step.name, 'camera')
    if (camera) forcePlayCamera(camera.id)
    return
  }
  if (step.do === 'spawn') spawnPrefab(node, step, host)
  if (step.do === 'hide') {
    const state = useEditorStore.getState()
    const nodes = { ...state.nodes }
    delete nodes[actor.id]
    useEditorStore.setState({
      nodes,
      selection: state.selection.filter(id => id !== actor.id),
      playDirty: true,
    })
    return
  }
  if (step.do === 'score') {
    const amount = evaluate(step.value)
    lastValue = amount
    addRuleScore(amount)
    return
  }
  if (step.do === 'juice') {
    playJuice(step.name, actor.id, host)
    return
  }
  if (step.do === 'sound') {
    const assetId = step.clipAssetId || step.name
    const music = step.tag === 'music'
    if (!assetId) {
      if (music) stopMusic()
      return
    }
    const volume = step.value.trim() ? evaluate(step.value) : 1
    lastValue = volume
    playSound({
      assetId,
      bus: music ? 'music' : 'sfx',
      loop: music,
      volume,
      parent: music ? null : host.resolveObject(actor.id),
    })
    return
  }
  if (step.do === 'gather') {
    job.list = gather(node, step, host)
    lastValue = job.list.length
    return
  }
  if (step.do === 'log') {
    useEditorStore.getState().log(step.level, step.message)
    return
  }
  const packAction = findPackAction(step.do, useEditorStore.getState().gameplayPacks)
  if (packAction?.enabled) {
    packAction.def.execute({
      node,
      actor,
      step,
      host,
      now,
      evaluate,
      postMessage: postRuleMessage,
      log: (level, message) => useEditorStore.getState().log(level, message),
      orderMove: (id, point) => orderCharacterMove(id, point[0], point[1], point[2]),
    })
  }
}

function allPass(node: SceneNode, conditions: RuleCondition[]): boolean {
  return conditions.every(item => passes(node, item))
}

function passes(node: SceneNode, cond: RuleCondition): boolean {
  if (cond.kind === 'always') return true
  if (cond.kind === 'formula') {
    const value = evaluate(cond.left)
    lastValue = value
    return value > 0
  }
  if (cond.kind === 'hasTag') return hasTag(node, cond.tag)
  if (cond.kind === 'missingTag') return !hasTag(node, cond.tag)
  if (cond.kind !== 'compare') {
    const packCond = findPackCondition(cond.kind, useEditorStore.getState().gameplayPacks)
    if (!packCond?.enabled) return false
    return packCond.def.test(node, cond, { hasTag: tag => hasTag(node, tag), evaluate })
  }
  const a = readValue(cond.left)
  const b = readValue(cond.right)
  if (cond.op === '!=') return a !== b
  if (cond.op === '>') return a > b
  if (cond.op === '<') return a < b
  if (cond.op === '>=') return a >= b
  if (cond.op === '<=') return a <= b
  return a === b
}

function hasTag(node: SceneNode, tag: string): boolean {
  return nodeHasTag(node, tag)
}

function readValue(token: string): number {
  const numeric = Number(token)
  if (token.trim() !== '' && Number.isFinite(numeric)) return numeric
  if (messageFields.has(token)) return messageFields.get(token) ?? 0
  return vars.get(token) ?? 0
}

function copyStep(step: RuleStep): RuleStep {
  return { ...step, conditions: step.conditions.map(item => ({ ...item })), steps: step.steps.map(copyStep) }
}

function tickStates(host: SceneRuntimeHost) {
  for (const node of Object.values(useEditorStore.getState().nodes)) {
    const tree = readRuleStates(node.gameplay?.ruleStates)
    if (tree.length === 0) {
      cursors.delete(node.id)
      continue
    }
    let cursor = cursors.get(node.id)
    if (!cursor) {
      const leaf = pickLeaf(node, tree[0])
      if (!leaf) continue
      cursor = { stateId: leaf.id, phase: 'entering', pendingId: '' }
      cursors.set(node.id, cursor)
      startEdge(node, leaf, 'enter')
      continue
    }
    if (jobs.some(job => job.nodeId === node.id && job.source !== 'rule' && job.stateId === cursor!.stateId)) continue
    const current = findState(tree, cursor.stateId)
    if (!current) {
      cursors.delete(node.id)
      continue
    }
    if (cursor.phase === 'entering') {
      cursor.phase = 'ticking'
      continue
    }
    if (cursor.phase === 'exiting') {
      enterPending(node, tree, cursor)
      continue
    }
    const jump = current.transitions.find(item => item.targetId && item.conditions.length > 0 && allPass(node, item.conditions) && findState(tree, item.targetId))
    const pending = cursor.pendingId && cursor.pendingId !== cursor.stateId ? cursor.pendingId : ''
    if (jump || pending) {
      cursor.pendingId = jump?.targetId || pending
      cursor.phase = 'exiting'
      startEdge(node, current, 'exit')
      if (!jobs.some(job => job.nodeId === node.id && job.source === 'exit')) enterPending(node, tree, cursor)
      continue
    }
    startEdge(node, current, 'tick')
  }
  void host
}

function startEdge(node: SceneNode, state: RuleStateNode, source: 'enter' | 'tick' | 'exit') {
  const steps = source === 'enter' ? state.onEnter : source === 'exit' ? state.onExit : state.onTick
  if (steps.length === 0) return
  jobs.push({
    nodeId: node.id,
    ruleId: '',
    stateId: state.id,
    source,
    steps: steps.map(copyStep),
    index: 0,
    wait: 0,
    frame: false,
    list: [],
    target: '',
    moving: false,
    loop: null,
  })
}

function enterPending(node: SceneNode, tree: RuleStateNode[], cursor: StateCursor) {
  const target = findState(tree, cursor.pendingId)
  const leaf = target ? pickLeaf(node, target) : undefined
  cursor.pendingId = ''
  if (!leaf) {
    cursor.phase = 'ticking'
    return
  }
  cursor.stateId = leaf.id
  cursor.phase = 'entering'
  startEdge(node, leaf, 'enter')
}

function findState(nodes: readonly RuleStateNode[], id: string): RuleStateNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node
    const child = findState(node.children, id)
    if (child) return child
  }
  return undefined
}

function pickLeaf(node: SceneNode, state: RuleStateNode | undefined): RuleStateNode | undefined {
  if (!state) return undefined
  if (state.children.length === 0) return state
  const chosen = state.children.find(child => child.enter.length === 0 || allPass(node, child.enter)) ?? state.children[0]
  return pickLeaf(node, chosen)
}

registerRuntimeSystem('core.rules', 35, stepRules)

let lastValue: number | null = null

function playOn(node: SceneNode, step: RuleStep, upper: boolean) {
  const assetId = clipAsset(node, step)
  const play = { clip: step.clip, assetId, loop: !upper, fade: node.clipFade ?? 0.15 }
  if (upper) playUpper(node.id, play)
  else playBody(node.id, play)
}

function clipAsset(node: SceneNode, step: RuleStep): string | null {
  if (!step.clipAssetId || step.clipAssetId === node.assetId) return null
  return step.clipAssetId
}

function overlayProgress(node: SceneNode): number {
  if (!node.overlayClip) return 0
  const duration = clipDuration(node.overlayAssetId || node.assetId, node.overlayClip)
  if (duration <= 0) return node.overlayPlaying ? 0 : 1
  return Math.min(1, Math.max(0, (node.overlayTime ?? 0) / duration))
}

function findNamed(name: string, kind?: SceneNode['kind']): SceneNode | undefined {
  const trimmed = name.trim()
  if (!trimmed) return undefined
  return Object.values(useEditorStore.getState().nodes).find(node => (!kind || node.kind === kind) && (node.id === trimmed || node.name === trimmed))
}

function pointOf(step: RuleStep, job: Job, host: SceneRuntimeHost): Vec3 | null {
  const named = step.name ? findNamed(step.name) : job.target ? useEditorStore.getState().nodes[job.target] : undefined
  if (named) {
    const object = host.resolveObject(named.id)
    if (!object) return null
    return [object.position.x, object.position.y, object.position.z]
  }
  const parts = step.value.split(',').map(item => Number(item.trim()))
  if (parts.length === 3 && parts.every(item => Number.isFinite(item))) return [parts[0], parts[1], parts[2]]
  return null
}

function gather(node: SceneNode, step: RuleStep, host: SceneRuntimeHost): string[] {
  const self = host.resolveObject(node.id)
  if (!self) return []
  const radius = Math.max(0.1, step.seconds > 0 ? step.seconds : evaluate(step.value) || 3)
  const angle = step.value.includes(',') ? 0 : Number(step.value)
  const limit = Number.isFinite(angle) && angle > 0 ? angle * Math.PI / 180 : Math.PI * 2
  const forward = { x: -Math.sin(yawOf(self.quaternion)), z: -Math.cos(yawOf(self.quaternion)) }
  const hits: string[] = []
  for (const other of Object.values(useEditorStore.getState().nodes)) {
    if (other.id === node.id || !other.visible) continue
    if (step.tag && !nodeHasTag(other, step.tag)) continue
    const object = host.resolveObject(other.id)
    if (!object) continue
    const dx = object.position.x - self.position.x
    const dz = object.position.z - self.position.z
    if (dx * dx + dz * dz > radius * radius) continue
    if (limit < Math.PI * 2) {
      const len = Math.hypot(dx, dz) || 1
      const dot = (forward.x * dx + forward.z * dz) / len
      if (Math.acos(Math.min(1, Math.max(-1, dot))) > limit / 2) continue
    }
    hits.push(other.id)
  }
  return hits
}

function yawOf(quaternion: { y: number, w: number }): number {
  return Math.atan2(2 * quaternion.w * quaternion.y, 1 - 2 * quaternion.y * quaternion.y)
}

function spawnPrefab(node: SceneNode, step: RuleStep, host: SceneRuntimeHost) {
  const asset = Object.values(useAssetStore.getState().assets).find(item => item.kind === 'prefab' && (item.id === step.name || item.name === step.name))
  if (!asset || asset.kind !== 'prefab') return
  const doc = readPrefab(asset)
  if (!doc.rootId) return
  const self = host.resolveObject(node.id)
  const parts = step.value.split(',').map(item => Number(item.trim()))
  const offset = parts.length >= 3 && parts.every(item => Number.isFinite(item)) ? parts : [1, 0, 0]
  const position: Vec3 = [
    (self?.position.x ?? node.position[0]) + offset[0],
    (self?.position.y ?? node.position[1]) + offset[1],
    (self?.position.z ?? node.position[2]) + offset[2],
  ]
  const state = useEditorStore.getState()
  const nodes = structuredClone(state.nodes)
  const lookup = (assetId: string) => {
    const nested = useAssetStore.getState().assets[assetId]
    if (!nested || nested.kind !== 'prefab') return null
    const next = readPrefab(nested)
    return next.rootId ? next : null
  }
  const id = instantiatePrefab(nodes, doc, asset.id, node.parentId, position, lookup)
  if (!id) return
  useEditorStore.setState({ nodes, playDirty: true })
}

function evaluate(source: string): number {
  const text = source.trim()
  if (!text) return 0
  let index = 0
  const skip = () => { while (text[index] === ' ') index += 1 }
  const unary = (): number => {
    skip()
    if (text[index] === '-') { index += 1; return -unary() }
    if (text[index] === '(') { index += 1; const value = expression(); skip(); if (text[index] === ')') index += 1; return value }
    const start = index
    if (/[0-9.]/.test(text[index] ?? '')) {
      while (/[0-9.]/.test(text[index] ?? '')) index += 1
      return Number(text.slice(start, index)) || 0
    }
    while (/[\w.]/.test(text[index] ?? '')) index += 1
    const name = text.slice(start, index)
    skip()
    if (text[index] === '(') {
      index += 1
      const args: number[] = []
      skip()
      if (text[index] !== ')') {
        args.push(expression())
        for (;;) {
          skip()
          if (text[index] !== ',') break
          index += 1
          args.push(expression())
        }
      }
      skip()
      if (text[index] === ')') index += 1
      return callFn(name, args)
    }
    return readValue(name)
  }
  const product = (): number => {
    let value = unary()
    for (;;) {
      skip()
      if (text[index] === '*') { index += 1; value *= unary() }
      else if (text[index] === '/') { index += 1; const divisor = unary(); value = divisor === 0 ? 0 : value / divisor }
      else break
    }
    return value
  }
  const sum = (): number => {
    let value = product()
    for (;;) {
      skip()
      if (text[index] === '+') { index += 1; value += product() }
      else if (text[index] === '-') { index += 1; value -= product() }
      else break
    }
    return value
  }
  const expression = (): number => {
    const value = sum()
    skip()
    const two = text.slice(index, index + 2)
    if (two === '>=' || two === '<=' || two === '==' || two === '!=') {
      index += 2
      return compare(value, sum(), two) ? 1 : 0
    }
    if (text[index] === '>' || text[index] === '<') {
      const op = text[index]
      index += 1
      return compare(value, sum(), op) ? 1 : 0
    }
    return value
  }
  const value = expression()
  return Number.isFinite(value) ? value : 0
}

function callFn(name: string, args: number[]): number {
  if (name === 'clamp' && args.length >= 3) return Math.min(Math.max(args[0], args[1]), args[2])
  if (name === 'min' && args.length > 0) return Math.min(...args)
  if (name === 'max' && args.length > 0) return Math.max(...args)
  if (name === 'abs' && args.length > 0) return Math.abs(args[0])
  return 0
}

function compare(left: number, right: number, op: string): boolean {
  if (op === '!=') return left !== right
  if (op === '>') return left > right
  if (op === '<') return left < right
  if (op === '>=') return left >= right
  if (op === '<=') return left <= right
  return left === right
}
