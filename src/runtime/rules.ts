import { playBody } from '../editor/animation/director'
import { useEditorStore } from '../editor/scene/store'
import type { SceneNode } from '../editor/scene/types'
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
}

const jobs: Job[] = []
const vars = new Map<string, number>()
const tags = new Map<string, Map<string, number>>()
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

export function postRuleMessage(message: string, nodeId = '') {
  if (!message) return
  inbox.push({ nodeId, trigger: 'message', message })
}

function stepRules(dt: number, host: SceneRuntimeHost) {
  watchKeys()
  const state = useEditorStore.getState()
  if (state.playState !== 'playing') {
    jobs.length = 0
    vars.clear()
    tags.clear()
    inbox.length = 0
    tappedKeys.clear()
    cursors.clear()
    traces.clear()
    started = false
    return
  }
  const now = performance.now() / 1000
  for (const [nodeId, bag] of tags) {
    for (const [tag, until] of bag) {
      if (until > 0 && now >= until) bag.delete(tag)
    }
    if (bag.size === 0) tags.delete(nodeId)
  }
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
  jobs.push({ nodeId: node.id, ruleId: rule.id, stateId: '', source: 'rule', steps: rule.steps.map(copyStep), index: 0, wait: 0 })
}

function advance(job: Job, dt: number, host: SceneRuntimeHost, now: number): boolean {
  const node = useEditorStore.getState().nodes[job.nodeId]
  if (!node) return true
  let guard = 0
  while (job.index < job.steps.length && guard < 32) {
    guard += 1
    const step = job.steps[job.index]
    traces.set(job.nodeId, {
      ruleId: job.ruleId,
      stepId: step?.id ?? '',
      stateId: cursors.get(job.nodeId)?.stateId ?? job.stateId,
      waiting: step?.do === 'wait' && job.wait > 0,
    })
    if (!step) break
    if (step.do === 'wait') {
      if (job.wait <= 0) job.wait = Math.max(0, step.seconds)
      job.wait -= dt
      if (job.wait > 0) {
        traces.set(job.nodeId, { ruleId: job.ruleId, stepId: step.id, stateId: cursors.get(job.nodeId)?.stateId ?? job.stateId, waiting: true })
        return false
      }
      job.wait = 0
      job.index += 1
      continue
    }
    if (step.do === 'if') {
      if (allPass(node, step.conditions) && step.steps.length > 0) {
        job.steps = [...job.steps.slice(0, job.index + 1), ...step.steps.map(copyStep), ...job.steps.slice(job.index + 1)]
      }
      job.index += 1
      continue
    }
    if (step.do === 'switchState' && step.stateId) {
      const cursor = cursors.get(job.nodeId)
      if (cursor && cursor.stateId !== step.stateId) {
        cursor.pendingId = step.stateId
      }
      job.index += 1
      continue
    }
    run(node, step, host, now)
    job.index += 1
  }
  const cursor = cursors.get(job.nodeId)
  traces.set(job.nodeId, { ruleId: '', stepId: '', stateId: cursor?.stateId ?? '', waiting: false })
  return job.index >= job.steps.length
}

function run(node: SceneNode, step: RuleStep, host: SceneRuntimeHost, now: number) {
  if (step.do === 'message') {
    postRuleMessage(step.message)
    useEditorStore.getState().log('info', `${node.name}：${step.message}`)
    return
  }
  if (step.do === 'setVar') {
    const numeric = Number(step.value)
    vars.set(step.name, Number.isFinite(numeric) ? numeric : readValue(step.value))
    return
  }
  if (step.do === 'addTag') {
    const bag = tags.get(node.id) ?? new Map<string, number>()
    bag.set(step.tag, step.seconds > 0 ? now + step.seconds : 0)
    tags.set(node.id, bag)
    return
  }
  if (step.do === 'removeTag') {
    tags.get(node.id)?.delete(step.tag)
    return
  }
  if (step.do === 'playClip' && step.clip) {
    if (host.resolveObject(node.id)) {
      const own = !step.clipAssetId || step.clipAssetId === node.assetId
      playBody(node.id, { clip: step.clip, assetId: own ? null : step.clipAssetId, loop: true, fade: node.clipFade ?? 0.15 })
    }
    return
  }
  if (step.do === 'log') {
    useEditorStore.getState().log(step.level, step.message)
  }
}

function allPass(node: SceneNode, conditions: RuleCondition[]): boolean {
  return conditions.every(item => passes(node, item))
}

function passes(node: SceneNode, cond: RuleCondition): boolean {
  if (cond.kind === 'always') return true
  if (cond.kind === 'hasTag') return hasTag(node, cond.tag)
  if (cond.kind === 'missingTag') return !hasTag(node, cond.tag)
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
  if (!tag) return false
  if (node.tagId === tag || (node.tagIds ?? []).includes(tag)) return true
  return tags.get(node.id)?.has(tag) ?? false
}

function readValue(token: string): number {
  const numeric = Number(token)
  if (token.trim() !== '' && Number.isFinite(numeric)) return numeric
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
