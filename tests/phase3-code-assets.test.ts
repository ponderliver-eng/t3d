import assert from 'node:assert/strict'
import test from 'node:test'
import { Group } from 'three'
import { checkAndTranspileTs } from '../src/core/codeAssets/compiler'
import { clearScriptRuntimeState, compileAndRegisterScript } from '../src/core/codeAssets/scriptRuntime'
import { compileShaderSource, getCompiledShaderParam, setCompiledShaderParam } from '../src/core/codeAssets/shaderRuntime'
import { RUNTIME_DTS_SUMMARY } from '../src/core/codeAssets/typeDefs'
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

test('checkAndTranspileTs 执行语义类型检查并覆盖完整 RUNTIME_DTS_SUMMARY', () => {
  for (const key of ['anim', 'character', 'physics', 'nav', 'crowd', 'projectile', 'scene', 'shader', 'getBehavior', 'fx', 'global', 'storage', 'tables']) {
    assert.ok(RUNTIME_DTS_SUMMARY.includes(key), `RUNTIME_DTS_SUMMARY 缺少 ${key}`)
  }

  const badApi = checkAndTranspileTs(
    'scripts/bad-api.ts',
    `
      import { defineBehavior } from 't3d/runtime'
      export default defineBehavior({
        name: 'BadApi',
        onUpdate(self) {
          self.anim.nonExistentMethod('idle')
        },
      })
    `,
  )
  assert.equal(badApi.ok, false)
  assert.ok(badApi.diagnostics.some((d) => d.message.includes('nonExistentMethod')))

  const goodApi = checkAndTranspileTs(
    'scripts/good-api.ts',
    `
      import { defineBehavior } from 't3d/runtime'
      export default defineBehavior({
        name: 'GoodApi',
        onStart(self) {
          self.anim.playBody('idle', { loop: true })
          self.nav.moveTo({ x: 1, y: 0, z: 2 }, 3)
          self.crowd.moveTo([1, 0, 2])
          self.projectile.launch({ speed: 10 })
          self.physics.applyImpulse({ x: 0, y: 1, z: 0 })
          self.character.setModifiers({ moveSpeedMul: 0.7, gravityMul: 1, inputLock: false })
          const sid = self.scene.currentId()
          if (sid) self.log(sid)
        },
      })
    `,
  )
  assert.equal(goodApi.ok, true)
})

test('compileShaderSource 支持扩充 TSL 节点、渲染状态与运行期 Uniform 动态更新', () => {
  const waterLikeShader = `
    import { defineShader, float, vec3, mix, sin, time, uv, frontFacing, select, linearDepth, screenUV, viewportSharedTexture } from 't3d/shader'
    export default defineShader({
      name: 'AdvancedWaterLike',
      mode: 'lit',
      transparent: true,
      side: 'double',
      depthWrite: false,
      blending: 'normal',
      params: {
        waveAmp: { type: 'number', default: 0.2, label: 'Wave Amp' },
        shallow: { type: 'color', default: '#22d3ee', label: 'Shallow' },
        deep: { type: 'color', default: '#0f172a', label: 'Deep' },
      },
      surface(p) {
        const wave = sin(uv().x.mul(10).add(time)).mul(p.waveAmp)
        const depthFade = linearDepth().mul(0.01).clamp(0, 1)
        const bg = viewportSharedTexture(screenUV)
        const col = select(frontFacing, mix(p.shallow, p.deep, depthFade), bg.rgb)
        return { baseColor: col, opacity: float(0.85), vertexOffset: vec3(0, wave, 0) }
      },
    })
  `
  const res = compileShaderSource('adv_water', 'shaders/adv_water.shader.ts', waterLikeShader)
  assert.equal(res.ok, true, JSON.stringify(res.diagnostics))
  assert.ok(res.exports?.material)
  assert.equal(res.exports?.material.depthWrite, false)
  assert.equal(setCompiledShaderParam('adv_water', 'waveAmp', 0.55), true)
  assert.equal(getCompiledShaderParam('adv_water', 'waveAmp'), 0.55)
})

test('运行时报错带阶段/脚本/节点/堆栈信息且同错误自动去重', () => {
  clearScriptRuntimeState()
  const errScript = `
    import { defineBehavior } from 't3d/runtime'
    export default defineBehavior({
      name: 'Thrower',
      onUpdate() {
        throw new Error('boom_test')
      },
    })
  `
  const res = compileAndRegisterScript('thrower', 'scripts/thrower.ts', errScript)
  assert.equal(res.ok, true)

  const nodeObj = new Group()
  const nodes: Record<string, SceneNode> = {
    'n-err': {
      id: 'n-err',
      name: 'BuggyBox',
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
      gameplay: { packs: { __project__: { thrower: {} } } },
    },
  }

  const errorLogs: string[] = []
  setRuntimeWorld({
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
    log: (lvl, msg) => {
      if (lvl === 'error') errorLogs.push(msg)
    },
  })

  const host: SceneRuntimeHost = {
    ready: true,
    resolveObject: (id) => (id === 'n-err' ? nodeObj : null),
    updateAnimations: () => {},
  }

  for (let i = 0; i < 5; i += 1) stepSceneRuntime(1 / 60, host)
  assert.equal(errorLogs.length, 1)
  assert.ok(errorLogs[0].includes('[onUpdate]'))
  assert.ok(errorLogs[0].includes('BuggyBox'))
  assert.ok(errorLogs[0].includes('n-err'))
  assert.ok(errorLogs[0].includes('boom_test'))
  assert.ok(errorLogs[0].includes('scripts/thrower.ts'))
  clearScriptRuntimeState()
})
