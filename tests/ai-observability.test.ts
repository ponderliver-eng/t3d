import assert from 'node:assert/strict'
import test from 'node:test'
import { Group } from 'three'
import {
  clearScriptRuntimeState,
  compileAndRegisterScript,
  readScriptStateSnapshot,
} from '../src/core/codeAssets/scriptRuntime'
import { clearAllVirtualInput, injectVirtualInput } from '../src/core/input/actionMap'
import { CORE_COMPONENTS, applyCoreComponentPatch, describeCoreComponents } from '../src/gameplay/coreComponents'
import { summarizeInfoLogs, summarizeRuntimeLogs } from '../src/playtest/session'
// 内置角色控制器以副作用方式注册到运行时（编辑器视口与导出播放器入口都会导入它）
import '../src/runtime/character'
import { stepSceneRuntime, type SceneRuntimeHost } from '../src/runtime/sceneRuntime'
import { setRuntimeWorld, type RuntimeWorld } from '../src/runtime/world'
import type { SceneNode, ScenePicture } from '../src/editor/scene/types'

function makeNode(id: string, name: string, patch: Partial<SceneNode> = {}): SceneNode {
  return {
    id,
    name,
    kind: 'box',
    parentId: null,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    visible: true,
    color: '#ffffff',
    assetId: null,
    gameplay: {},
    ...patch,
  } as SceneNode
}

function createHeadlessWorld(initial: SceneNode[]) {
  let nodes: Record<string, SceneNode> = Object.fromEntries(initial.map((n) => [n.id, n]))
  const objects = new Map<string, Group>()
  const logs: Array<{ level: string; message: string }> = []
  const world: RuntimeWorld = {
    getNodes: () => nodes,
    setNodes: (next) => {
      nodes = next
    },
    updateNode: (id, patch) => {
      if (nodes[id]) nodes = { ...nodes, [id]: { ...nodes[id], ...patch } }
    },
    getActiveSceneId: () => 'default',
    getPicture: () => ({}) as ScenePicture,
    getCapabilities: () => ({}),
    getGameplayPacks: () => ['core'],
    getGameDatabase: () => ({ tables: {} }),
    getTags: () => [],
    getAsset: () => undefined,
    listAssets: () => [],
    getPlayState: () => 'playing',
    markPlayDirty: () => {},
    log: (level, message) => {
      logs.push({ level, message })
    },
  }
  const host: SceneRuntimeHost = {
    ready: true,
    resolveObject: (id) => {
      const node = nodes[id]
      if (!node) return null
      let obj = objects.get(id)
      if (!obj) {
        obj = new Group()
        obj.position.set(node.position[0], node.position[1], node.position[2])
        obj.visible = node.visible
        objects.set(id, obj)
      }
      return obj
    },
    updateAnimations: () => {},
    yaw: () => 0,
  }
  setRuntimeWorld(world)
  return {
    host,
    logs,
    run: (seconds: number) => {
      const steps = Math.round(seconds * 60)
      for (let i = 0; i < steps; i += 1) stepSceneRuntime(1 / 60, host)
    },
  }
}

const COUNTER_SOURCE = `
import { defineBehavior } from 't3d/runtime'
export default defineBehavior({
  name: '计数器',
  params: { step: { type: 'number', default: 1, label: '步长' } },
  state: () => ({ ticks: 0, phase: 'idle', target: { x: 0, y: 0, z: 0 }, history: [] as number[] }),
  onStart(self) {
    self.log('counter started')
  },
  onUpdate(self, dt) {
    self.state.ticks += 1
    self.state.phase = self.state.ticks > 30 ? 'late' : 'early'
    self.state.history.push(self.state.ticks)
    self.log('tick')
  },
})
`

test('可观测性：self.state 快照与 self.log 日志可在试玩中读回', () => {
  clearScriptRuntimeState()
  const res = compileAndRegisterScript('Counter', 'Assets/Scripts/Counter.ts', COUNTER_SOURCE)
  assert.equal(res.ok, true, JSON.stringify(res.diagnostics))
  const sim = createHeadlessWorld([
    makeNode('a', 'A', { gameplay: { packs: { __project__: { Counter: {} } } } } as Partial<SceneNode>),
    makeNode('b', 'B'),
  ])
  sim.run(1)

  const snapshot = readScriptStateSnapshot('a')
  assert.ok(snapshot?.Counter, '应返回 Counter 脚本的状态')
  assert.equal(snapshot.Counter.ticks, 60)
  assert.equal(snapshot.Counter.phase, 'late')
  assert.deepEqual(snapshot.Counter.target, { x: 0, y: 0, z: 0 })
  // 长数组被截断并注明总数，避免把返回值撑爆
  const history = snapshot.Counter.history as unknown[]
  assert.equal(history.length, 13)
  assert.match(String(history[12]), /60/)
  assert.equal(readScriptStateSnapshot('b'), null, '没有脚本的节点返回 null')

  // 快照是副本：改它不影响运行时
  ;(snapshot.Counter as Record<string, unknown>).ticks = -1
  assert.equal(readScriptStateSnapshot('a')?.Counter.ticks, 60)

  const info = summarizeInfoLogs(sim.logs)
  assert.ok(info.some((line) => line.includes('counter started')), `应包含 onStart 日志：${JSON.stringify(info)}`)
  assert.ok(info.some((line) => line.includes('tick') && line.includes('重复 60 次')), `逐帧日志应折叠计数：${JSON.stringify(info)}`)
  assert.equal(summarizeRuntimeLogs(sim.logs).errorCount, 0)

  clearScriptRuntimeState()
  assert.equal(readScriptStateSnapshot('a'), null, '退出试玩后不再有运行时状态')
})

test('可观测性：普通日志汇总不混入报错，超量时注明省略', () => {
  const logs = [
    { level: 'error', message: 'boom' },
    { level: 'warn', message: 'careful' },
    ...Array.from({ length: 50 }, (_, i) => ({ level: 'info', message: `line ${i}` })),
  ]
  const lines = summarizeInfoLogs(logs, 10)
  assert.equal(lines.length, 11)
  assert.ok(!lines.some((line) => line.includes('boom') || line.includes('careful')))
  assert.match(lines[10], /另有 40 种/)
})

test('内置组件：登记表完整，未知字段与非法枚举被拒绝', () => {
  const described = describeCoreComponents()
  assert.equal(described.length, CORE_COMPONENTS.length)
  const character = described.find((item) => item.id === 'character')
  assert.ok(character && 'idleClip' in character.defaults && 'walkClip' in character.defaults && 'runClip' in character.defaults)

  const unknown = applyCoreComponentPatch(null, 'character', { walkSpeed: 3 })
  assert.equal(unknown.ok, false)
  assert.ok(!unknown.ok && unknown.hint.includes('moveSpeed'), '应提示可用字段')

  const badEnum = applyCoreComponentPatch(null, 'character', { mode: 'flying' })
  assert.equal(badEnum.ok, false)
  assert.ok(!badEnum.ok && badEnum.hint.includes('topDown'))

  assert.equal(applyCoreComponentPatch(null, 'animation', {}).ok, false)
})

test('内置组件：挂载角色会补全默认值并配好跟随相机，移除时成对清理', () => {
  const mounted = applyCoreComponentPatch({ packs: { __project__: { Foo: {} } } }, 'character', {
    moveSpeed: 6,
    mode: 'topDown',
    idleClip: 'Idle',
  })
  assert.ok(mounted.ok)
  const gameplay = mounted.gameplay!
  assert.equal(gameplay.character?.moveSpeed, 6)
  assert.equal(gameplay.character?.idleClip, 'Idle')
  assert.equal(gameplay.character?.jumpSpeed, 6.5, '未指定的字段取默认值')
  assert.equal(gameplay.cameraFollow?.orbit, 'none', '俯视角模式应套用对应机位')
  assert.equal(gameplay.cameraFollow?.preset, 'topDown')
  assert.deepEqual(gameplay.packs, { __project__: { Foo: {} } }, '不影响已有脚本挂载')

  // 再次小改只动指定字段，保留已调的镜头参数
  const tweaked = applyCoreComponentPatch(gameplay, 'cameraFollow', { fov: 40 })
  assert.ok(tweaked.ok)
  assert.equal(tweaked.gameplay?.cameraFollow?.fov, 40)
  const again = applyCoreComponentPatch(tweaked.gameplay, 'character', { moveSpeed: 7 })
  assert.ok(again.ok)
  assert.equal(again.gameplay?.cameraFollow?.fov, 40)
  assert.equal(again.gameplay?.character?.idleClip, 'Idle')

  const removed = applyCoreComponentPatch(again.gameplay, 'character', null)
  assert.ok(removed.ok)
  assert.equal(removed.gameplay?.character, undefined)
  assert.equal(removed.gameplay?.cameraFollow, undefined)
  assert.deepEqual(removed.gameplay?.packs, { __project__: { Foo: {} } })

})

test('内置组件：角色控制器无需脚本即可响应 Move 输入', () => {
  clearScriptRuntimeState()
  clearAllVirtualInput()
  const mounted = applyCoreComponentPatch(null, 'character', { mode: 'topDown', dash: false })
  assert.ok(mounted.ok)
  const sim = createHeadlessWorld([makeNode('hero', 'Hero', { gameplay: mounted.gameplay } as Partial<SceneNode>)])
  const before = sim.host.resolveObject('hero')!.position.clone()
  injectVirtualInput({ type: 'axis', action: 'Move', x: 0, y: 1 })
  sim.run(1)
  const after = sim.host.resolveObject('hero')!.position
  const moved = Math.hypot(after.x - before.x, after.z - before.z)
  assert.deepEqual(sim.logs.filter((item) => item.level === 'error'), [])
  assert.ok(moved > 2, `角色应在 1 秒内水平移动超过 2 米，实际 ${moved.toFixed(2)}`)
  clearAllVirtualInput()
  clearScriptRuntimeState()
})
