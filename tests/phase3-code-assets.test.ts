import assert from 'node:assert/strict'
import test from 'node:test'
import { Group } from 'three'
import { checkAndTranspileTs } from '../src/core/codeAssets/compiler'
import { clearScriptRuntimeState, compileAndRegisterScript } from '../src/core/codeAssets/scriptRuntime'
import { compileShaderSource } from '../src/core/codeAssets/shaderRuntime'
import { stepSceneRuntime, type SceneRuntimeHost } from '../src/runtime/sceneRuntime'
import { setRuntimeWorld, type RuntimeWorld } from '../src/runtime/world'
import type { SceneNode, ScenePicture } from '../src/editor/scene/types'

test('checkAndTranspileTs 返回统一诊断格式', () => {
  const bad = checkAndTranspileTs('scripts/broken.ts', 'export const x = ;')
  assert.equal(bad.ok, false)
  assert.ok(bad.diagnostics.length > 0)
  assert.equal(bad.diagnostics[0].file, 'scripts/broken.ts')
  assert.equal(bad.diagnostics[0].severity, 'error')
  assert.ok(bad.diagnostics[0].line >= 1)
})

test('compileShaderSource 编译 TSL 着色器并生成 NodeMaterial', () => {
  const shaderCode = `
    import { defineShader, mix, sin, time, uv } from 't3d/shader'
    export default defineShader({
      name: 'Pulse',
      mode: 'lit',
      params: {
        a: { type: 'color', default: '#ff0000', label: 'Color A' },
        b: { type: 'color', default: '#00ff00', label: 'Color B' },
        speed: { type: 'number', default: 2, label: 'Speed' },
      },
      surface(p) {
        const t = sin(uv().x.add(time.mul(p.speed))).mul(0.5).add(0.5)
        return { baseColor: mix(p.a, p.b, t), roughness: 0.4, metalness: 0.2 }
      },
    })
  `
  const res = compileShaderSource('pulse', 'shaders/pulse.shader.ts', shaderCode, { speed: 4 })
  assert.equal(res.ok, true)
  assert.ok(res.exports?.material)
  assert.equal(res.exports?.paramValues.speed, 4)
})

test('compileAndRegisterScript 挂载 __project__ 槽位并支持热重载保留 self.state', () => {
  clearScriptRuntimeState()
  const v1 = `
    import { defineBehavior } from 't3d/runtime'
    export default defineBehavior({
      name: 'Counter',
      params: { step: { type: 'number', default: 1, label: 'Step' } },
      state: () => ({ count: 0 }),
      onUpdate(self) {
        self.state.count += self.params.step
      },
    })
  `
  const r1 = compileAndRegisterScript('counter', 'scripts/counter.ts', v1)
  assert.equal(r1.ok, true)

  const nodeObj = new Group()
  const nodes: Record<string, SceneNode> = {
    'n-1': {
      id: 'n-1',
      name: 'CounterNode',
      kind: 'box',
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
      castShadow: false,
      receiveShadow: true,
      gameplay: {
        packs: {
          __project__: {
            counter: { step: 2 },
          },
        },
      },
    },
  }

  let lastCountLog = ''
  const world: RuntimeWorld = {
    getNodes: () => nodes,
    setNodes: () => {},
    updateNode: () => {},
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
    log: (_lvl, msg) => {
      lastCountLog = msg
    },
  }
  setRuntimeWorld(world)

  const host: SceneRuntimeHost = {
    ready: true,
    resolveObject: (id) => (id === 'n-1' ? nodeObj : null),
    updateAnimations: () => {},
  }

  stepSceneRuntime(1 / 60, host)
  stepSceneRuntime(1 / 60, host)

  // 热重载脚本：改为每次 +10 并输出 count，验证之前积累的 count=4 被保留
  const v2 = `
    import { defineBehavior } from 't3d/runtime'
    export default defineBehavior({
      name: 'Counter',
      params: { step: { type: 'number', default: 1, label: 'Step' } },
      state: () => ({ count: 0 }),
      onUpdate(self) {
        self.state.count += 10
        self.log('count=' + self.state.count)
      },
    })
  `
  const r2 = compileAndRegisterScript('counter', 'scripts/counter.ts', v2)
  assert.equal(r2.ok, true)

  stepSceneRuntime(1 / 60, host)
  assert.equal(lastCountLog, 'count=14')
  clearScriptRuntimeState()
})
