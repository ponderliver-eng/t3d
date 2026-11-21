import assert from 'node:assert/strict'
import test from 'node:test'

if (typeof (globalThis as { localStorage?: unknown }).localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: Storage }).localStorage = {
    get length() { return mem.size },
    clear: () => mem.clear(),
    getItem: (key: string) => mem.get(key) ?? null,
    key: (index: number) => [...mem.keys()][index] ?? null,
    removeItem: (key: string) => { mem.delete(key) },
    setItem: (key: string, val: string) => { mem.set(key, String(val)) },
  }
}
import {
  clearAllVirtualInput,
  consumeInputFrame,
  DEFAULT_INPUT_MAP,
  getActionAxis2D,
  injectVirtualInput,
  isActionPressed,
  normalizeInputMap,
  setInputActionMap,
  wasActionTapped,
} from '../src/core/input/actionMap'
import { diagnoseProject } from '../src/core/query/diagnose'
import { PlaytestSession } from '../src/playtest/session'
import { setRuntimeWorld, type RuntimeWorld } from '../src/runtime/world'
import type { SceneNode, ScenePicture } from '../src/editor/scene/types'

let storeModule: typeof import('../src/editor/scene/store') | null = null
async function getEditorStore() {
  storeModule ??= await import('../src/editor/scene/store')
  return storeModule.useEditorStore
}

test('InputActionMap 规范化与虚拟输入注入/帧消费', () => {
  setInputActionMap(normalizeInputMap(DEFAULT_INPUT_MAP))
  clearAllVirtualInput()

  injectVirtualInput([
    { type: 'axis', action: 'Move', x: 0.8, y: -0.6 },
    { type: 'actionDown', action: 'Jump' },
  ])

  const axis = getActionAxis2D('Move')
  assert.ok(Math.abs(axis.x - 0.8) < 1e-6)
  assert.ok(Math.abs(axis.y + 0.6) < 1e-6)
  assert.equal(isActionPressed('Jump'), true)
  assert.equal(wasActionTapped('Jump'), true)

  consumeInputFrame()
  assert.equal(wasActionTapped('Jump'), false)
  assert.equal(isActionPressed('Jump'), true)

  injectVirtualInput({ type: 'actionUp', action: 'Jump' })
  assert.equal(isActionPressed('Jump'), false)
  clearAllVirtualInput()
})

test('RuntimeWorld 独立运行时与 PlaytestSession 定步长冒烟测试', () => {
  const hero: SceneNode = {
    id: 'hero-1',
    name: 'Hero',
    kind: 'capsule',
    parentId: null,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    visible: true,
    color: '#ffffff',
    roughness: 0.5,
    metalness: 0,
    assetId: null,
    materialAssetId: null,
    slots: [],
    castShadow: true,
    receiveShadow: true,
    gameplay: {
      character: {
        enabled: true,
        driver: 'capsule',
        mode: 'adventure',
        clickButton: 'right',
        clickStop: 0.35,
        moveSpeed: 5,
        turnSpeed: 540,
        sprintMultiplier: 1.5,
        jumpSpeed: 6,
        maxJumps: 1,
        coyoteTime: 0.1,
        jumpBuffer: 0.1,
        gravity: 20,
        radius: 0.4,
        height: 1.8,
        capsuleOffset: [0, 0.9, 0],
        dash: false,
        dashKey: 'KeyC',
        dashDistance: 4,
        dashDuration: 0.15,
        dashInvincible: 0.2,
        dashCooldown: 1,
        footstepDistance: 1.5,
        footstepJuice: '',
        lockTargetName: '',
        idleClip: '',
        idleClipAssetId: '',
        walkClip: '',
        walkClipAssetId: '',
        runClip: '',
        runClipAssetId: '',
        jumpClip: '',
        jumpClipAssetId: '',
        airClip: '',
        airClipAssetId: '',
        landClip: '',
        landClipAssetId: '',
        dodgeClip: '',
        dodgeClipAssetId: '',
      },
    },
  }

  let nodes: Record<string, SceneNode> = { 'hero-1': hero }
  const standaloneWorld: RuntimeWorld = {
    getNodes: () => nodes,
    setNodes: (next) => {
      nodes = next
    },
    updateNode: (id, patch) => {
      if (nodes[id]) nodes = { ...nodes, [id]: { ...nodes[id], ...patch } }
    },
    getActiveSceneId: () => 'scene-1',
    getPicture: () => ({}) as ScenePicture,
    getCapabilities: () => ({}),
    getGameplayPacks: () => ['core'],
    getGameDatabase: () => ({ tables: {} }),
    getTags: () => [],
    getAsset: () => undefined,
    listAssets: () => [],
    getPlayState: () => 'playing',
    markPlayDirty: () => {},
    log: () => {},
  }
  setRuntimeWorld(standaloneWorld)

  const session = new PlaytestSession()
  const report = session.runSmoke(
    [
      { action: 'input', events: [{ type: 'axis', action: 'Move', x: 1, y: 0 }] },
      { action: 'step', seconds: 0.5, fixedDt: 1 / 60 },
      {
        action: 'assert',
        condition: { kind: 'elapsed', seconds: 0.49 },
        message: '定步长推进时长应达到 0.5s',
      },
      {
        action: 'assert',
        condition: { kind: 'nodeExists', nodeIdOrName: 'hero-1' },
        message: '主角节点应存在',
      },
    ],
    { autoStop: false },
  )

  assert.equal(report.ok, true)
  assert.equal(report.stepsSimulated, 30)
  assert.equal(report.assertions.length, 2)
  assert.equal(report.assertions.every((a) => a.passed), true)
  session.stop()
})

test('diagnoseProject 返回性能预算 metrics 统计', async () => {
  const useEditorStore = await getEditorStore()
  useEditorStore.setState({
    nodes: {},
    capabilities: {},
    gameplayPacks: ['core'],
  })
  const report = diagnoseProject({
    maxDrawCalls: 500,
    maxTriangles: 300_000,
    maxShadowLights: 2,
    maxAssetBytes: 100 * 1024 * 1024,
  })
  assert.ok(report.metrics)
  assert.equal(report.metrics?.nodeCount, 0)
  assert.equal(report.metrics?.shadowLights, 0)
})
