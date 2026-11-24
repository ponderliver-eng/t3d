import assert from 'node:assert/strict'
import test from 'node:test'
import { Group } from 'three'
import { checkAndTranspileTs } from '../src/core/codeAssets/compiler'
import { clearScriptRuntimeState, compileAndRegisterScript } from '../src/core/codeAssets/scriptRuntime'
import {
  buildPostEffectNode,
  compileShaderSource,
  getCompiledPostEffect,
  getCompiledShaderParam,
  setCompiledShaderParam,
} from '../src/core/codeAssets/shaderRuntime'
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

test('compileShaderSource 支持 physical 扩展材质、自定义光照模型与 definePostEffect 后期链', () => {
  const physRes = compileShaderSource(
    'phys_glass',
    'shaders/phys_glass.shader.ts',
    `
    import { defineShader, color } from 't3d/shader'
    export default defineShader({
      name: 'PhysGlass',
      mode: 'physical',
      params: {
        tint: { type: 'color', default: '#aaddff', label: '颜色' },
        coat: { type: 'number', default: 0.9, label: '清漆' },
      },
      surface(p) {
        return {
          baseColor: p.tint,
          roughness: 0.08,
          transmission: 0.95,
          ior: 1.5,
          clearcoat: p.coat,
          iridescence: 0.4,
        }
      },
    })
    `,
  )
  assert.equal(physRes.ok, true, JSON.stringify(physRes.diagnostics))
  const physMat = physRes.exports?.material as unknown as Record<string, unknown>
  assert.ok(physMat.clearcoatNode)
  assert.ok(physMat.transmissionNode)
  assert.ok(physMat.iorNode)
  assert.ok(physMat.iridescenceNode)

  const toonRes = compileShaderSource(
    'toon_custom',
    'shaders/toon_custom.shader.ts',
    `
    import { defineShader, color, step, dot } from 't3d/shader'
    export default defineShader({
      name: 'ToonCustom',
      mode: 'toon',
      params: {
        base: { type: 'color', default: '#ffaa66', label: '基础色' },
        cutoff: { type: 'number', default: 0.3, label: '色阶阈值' },
      },
      surface(p) {
        return { baseColor: p.base }
      },
      lighting: {
        direct(ctx) {
          const ndl = dot(ctx.normal, ctx.lightDirection)
          const band = step(ctx.params.cutoff, ndl)
          return ctx.diffuseColor.mul(ctx.lightColor).mul(band.mul(0.7).add(0.3))
        },
      },
    })
    `,
  )
  assert.equal(toonRes.ok, true, JSON.stringify(toonRes.diagnostics))
  const toonMat = toonRes.exports?.material as unknown as { setupLightingModel?: () => unknown }
  assert.equal(typeof toonMat.setupLightingModel, 'function')

  const postRes = compileShaderSource(
    'vignette_fx',
    'shaders/vignette_fx.shader.ts',
    `
    import { definePostEffect, vec4, smoothstep, distance, vec2, float, mix } from 't3d/shader'
    export default definePostEffect({
      name: 'Vignette',
      params: {
        strength: { type: 'number', default: 0.5, label: '暗角强度' },
      },
      apply(ctx) {
        const d = distance(ctx.uv, vec2(0.5, 0.5))
        const mask = mix(float(1), ctx.params.strength.oneMinus(), smoothstep(0.2, 0.8, d))
        return vec4(ctx.color.rgb.mul(mask), ctx.color.a)
      },
    })
    `,
  )
  assert.equal(postRes.ok, true, JSON.stringify(postRes.diagnostics))
  assert.ok(getCompiledPostEffect('vignette_fx'))
  assert.equal(setCompiledShaderParam('vignette_fx', 'strength', 0.8), true)
  assert.equal(getCompiledShaderParam('vignette_fx', 'strength'), 0.8)
  const fakeNode = { rgb: { mul: () => ({}) }, a: {} }
  const outNode = buildPostEffectNode('vignette_fx', {
    color: fakeNode,
    depth: fakeNode,
    normal: fakeNode,
    uv: { x: 0.5, y: 0.5 },
  })
  assert.ok(outNode)
})

test('脚本开关关闭再开启：暂停执行但保留 state，不重复触发 onStart；卸载才触发 onDestroy', () => {
  clearScriptRuntimeState()
  const events: string[] = []
  const res = compileAndRegisterScript(
    'toggle_life',
    'Assets/Scripts/ToggleLife.ts',
    `
    import { defineBehavior } from 't3d/runtime'
    export default defineBehavior({
      name: 'ToggleLife',
      state: () => ({ count: 0 }),
      onStart(self) {
        self.log('start:' + self.enabled)
      },
      onEnable(self) {
        self.log('enable')
      },
      onDisable(self) {
        self.log('disable')
      },
      onUpdate(self) {
        self.state.count = Number(self.state.count) + 1
        self.log('update:' + self.state.count)
      },
      onDestroy(self) {
        self.log('destroy')
      },
    })
    `,
  )
  assert.equal(res.ok, true, JSON.stringify(res.diagnostics))

  const node = {
    id: 'n1',
    name: 'Box',
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
    gameplay: { packs: { __project__: { toggle_life: { __enabled: true } } } },
  } as unknown as SceneNode
  let nodes: Record<string, SceneNode> = { n1: node }
  const obj = new Group()
  const world: RuntimeWorld = {
    getNodes: () => nodes,
    setNodes: (next) => { nodes = next },
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
    log: (_level, msg) => { events.push(msg) },
  }
  const host: SceneRuntimeHost = {
    ready: true,
    resolveObject: (id) => (id === 'n1' ? obj : null),
    updateAnimations: () => {},
  }
  setRuntimeWorld(world)

  // 1. 启用首帧：触发 start -> enable -> update:1
  stepSceneRuntime(1 / 60, host)
  // 2. 关闭开关两帧：首帧触发 disable，之后暂停执行，不触发 onDestroy
  nodes = { n1: { ...node, gameplay: { packs: { __project__: { toggle_life: { __enabled: false } } } } } }
  stepSceneRuntime(1 / 60, host)
  stepSceneRuntime(1 / 60, host)
  // 3. 重新开启：触发 enable -> update:2，不重复触发 start
  nodes = { n1: { ...node, gameplay: { packs: { __project__: { toggle_life: { __enabled: true } } } } } }
  stepSceneRuntime(1 / 60, host)
  // 4. 卸载脚本：先触发一次 disable，再触发 destroy
  nodes = { n1: { ...node, gameplay: { packs: { __project__: {} } } } }
  stepSceneRuntime(1 / 60, host)

  assert.deepEqual(events, ['start:true', 'enable', 'update:1', 'disable', 'enable', 'update:2', 'disable', 'destroy'])
  clearScriptRuntimeState()
})

test('脚本开关关闭时暂停该脚本发起的 Tween 与定时器，开启后从断点继续', () => {
  clearScriptRuntimeState()
  const logs: string[] = []
  const res = compileAndRegisterScript(
    'tween_toggle',
    'Assets/Scripts/TweenToggle.ts',
    `
    import { defineBehavior } from 't3d/runtime'
    export default defineBehavior({
      name: 'TweenToggle',
      onStart(self) {
        self.log('start')
        self.after(0.1, () => {
          self.tween.to(self.node, { position: { x: 10, y: 0, z: 0 } }, 0.4, {
            ease: 'linear',
            onComplete: () => self.log('done'),
          })
        })
      },
    })
    `,
  )
  assert.equal(res.ok, true, JSON.stringify(res.diagnostics))

  const node = {
    id: 'n1',
    name: 'Cube',
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
    gameplay: { packs: { __project__: { tween_toggle: { __enabled: true } } } },
  } as unknown as SceneNode
  let nodes: Record<string, SceneNode> = { n1: node }
  const obj = new Group()
  const world: RuntimeWorld = {
    getNodes: () => nodes,
    setNodes: (next) => { nodes = next },
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
    log: (_level, msg) => { logs.push(msg) },
  }
  const host: SceneRuntimeHost = {
    ready: true,
    resolveObject: (id) => (id === 'n1' ? obj : null),
    updateAnimations: () => {},
  }
  setRuntimeWorld(world)

  // 推进 0.2s：after(0.1) 已触发，tween 推进约 0.1s（x 约为 2.5）
  for (let i = 0; i < 4; i += 1) stepSceneRuntime(0.05, host)
  const pausedX = obj.position.x
  assert.ok(pausedX > 1 && pausedX < 5, `暂停前应在运动中，x=${pausedX}`)

  // 关闭脚本开关并推进 0.5s：位置与定时器都应完全冻结
  nodes = { n1: { ...node, gameplay: { packs: { __project__: { tween_toggle: { __enabled: false } } } } } }
  for (let i = 0; i < 10; i += 1) stepSceneRuntime(0.05, host)
  assert.equal(obj.position.x, pausedX, '关闭开关后 Tween 不应继续推进')
  assert.deepEqual(logs, ['start'])

  // 重新开启并推进 0.4s：应从断点继续直到完成，且不重复触发 start
  nodes = { n1: { ...node, gameplay: { packs: { __project__: { tween_toggle: { __enabled: true } } } } } }
  for (let i = 0; i < 8; i += 1) stepSceneRuntime(0.05, host)
  assert.ok(Math.abs(obj.position.x - 10) < 1e-4, `开启后应继续走到终点，x=${obj.position.x}`)
  assert.deepEqual(logs, ['start', 'done'])

  clearScriptRuntimeState()
})

test('Play 期间修改脚本参数：onStart/after 回调闭包捕获的 self.params 也能实时读到最新值', () => {
  clearScriptRuntimeState()
  const seen: number[] = []
  const res = compileAndRegisterScript(
    'live_params',
    'Assets/Scripts/LiveParams.ts',
    `
    import { defineBehavior } from 't3d/runtime'
    export default defineBehavior({
      name: 'LiveParams',
      params: {
        height: { type: 'number', default: 1.5, label: '高度' },
      },
      onStart(self) {
        self.log(String(self.params.height))
        self.after(0.1, () => {
          self.log(String(self.params.height))
        })
      },
    })
    `,
  )
  assert.equal(res.ok, true, JSON.stringify(res.diagnostics))

  const node = {
    id: 'n1',
    name: 'Box',
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
    gameplay: { packs: { __project__: { live_params: { __enabled: true, height: 1.5 } } } },
  } as unknown as SceneNode
  let nodes: Record<string, SceneNode> = { n1: node }
  const obj = new Group()
  const world: RuntimeWorld = {
    getNodes: () => nodes,
    setNodes: (next) => { nodes = next },
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
    log: (_level, msg) => { seen.push(Number(msg)) },
  }
  const host: SceneRuntimeHost = {
    ready: true,
    resolveObject: (id) => (id === 'n1' ? obj : null),
    updateAnimations: () => {},
  }
  setRuntimeWorld(world)

  stepSceneRuntime(0.05, host)
  // Play 期间用户在面板里把 height 改成 4.2
  nodes = { n1: { ...node, gameplay: { packs: { __project__: { live_params: { __enabled: true, height: 4.2 } } } } } }
  stepSceneRuntime(0.06, host)

  assert.deepEqual(seen, [1.5, 4.2])
  clearScriptRuntimeState()
})
