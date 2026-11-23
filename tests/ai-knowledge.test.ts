import assert from 'node:assert/strict'
import test from 'node:test'
import { Group } from 'three'
import { clearScriptRuntimeState, compileAndRegisterScript } from '../src/core/codeAssets/scriptRuntime'
import { lintScriptSource } from '../src/core/codeAssets/scriptLint'
import { clearAllVirtualInput, injectVirtualInput } from '../src/core/input/actionMap'
import { stepSceneRuntime, type SceneRuntimeHost } from '../src/runtime/sceneRuntime'
import { uiValues } from '../src/runtime/ui/values'
import { setRuntimeWorld, type RuntimeWorld } from '../src/runtime/world'
import type { SceneNode, ScenePicture } from '../src/editor/scene/types'
import { RECIPES, findRecipe, formatRecipeIndexForPrompt } from '../src/ai/knowledge/recipes'

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
    roughness: 0.5,
    metalness: 0,
    assetId: null,
    materialAssetId: null,
    slots: [],
    castShadow: false,
    receiveShadow: true,
    gameplay: {},
    ...patch,
  } as SceneNode
}

function withScripts(scripts: Record<string, Record<string, unknown>>): Partial<SceneNode> {
  return { gameplay: { packs: { __project__: scripts } } } as Partial<SceneNode>
}

/** 最小可运行的无头世界：节点表可变，Object3D 按需创建并与节点初始位姿对齐 */
function createHeadlessWorld(initial: SceneNode[]) {
  let nodes: Record<string, SceneNode> = Object.fromEntries(initial.map((n) => [n.id, n]))
  const objects = new Map<string, Group>()
  const errors: string[] = []
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
      if (level === 'error') errors.push(message)
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
        obj.rotation.set(
          (node.rotation[0] * Math.PI) / 180,
          (node.rotation[1] * Math.PI) / 180,
          (node.rotation[2] * Math.PI) / 180,
        )
        obj.visible = node.visible
        objects.set(id, obj)
      }
      return obj
    },
    updateAnimations: () => {},
  }
  setRuntimeWorld(world)
  return {
    host,
    errors,
    nodes: () => nodes,
    positionOf: (id: string) => {
      const obj = host.resolveObject(id)
      return obj ? { x: obj.position.x, y: obj.position.y, z: obj.position.z } : null
    },
    run: (seconds: number) => {
      const steps = Math.round(seconds * 60)
      for (let i = 0; i < steps; i += 1) stepSceneRuntime(1 / 60, host)
    },
  }
}

function registerRecipeScripts(recipeIds: string[]): void {
  for (const recipeId of recipeIds) {
    const recipe = findRecipe(recipeId)
    assert.ok(recipe, `范例 ${recipeId} 不存在`)
    for (const file of recipe.files) {
      const res = compileAndRegisterScript(file.scriptId, `Assets/Scripts/${file.scriptId}.ts`, file.source)
      assert.equal(res.ok, true, `${file.scriptId} 编译失败: ${JSON.stringify(res.diagnostics)}`)
    }
  }
}

test('范例库：每份脚本都能通过真实编译与静态反模式检查', () => {
  clearScriptRuntimeState()
  const seenRecipeIds = new Set<string>()
  const seenScriptIds = new Set<string>()
  for (const recipe of RECIPES) {
    assert.ok(!seenRecipeIds.has(recipe.id), `范例 ID 重复: ${recipe.id}`)
    seenRecipeIds.add(recipe.id)
    assert.ok(recipe.files.length > 0, `${recipe.id} 没有脚本`)
    assert.ok(recipe.setup.length > 0 && recipe.verify, `${recipe.id} 缺少搭建或验收说明`)
    for (const file of recipe.files) {
      assert.ok(!seenScriptIds.has(file.scriptId), `脚本 ID 重复: ${file.scriptId}`)
      seenScriptIds.add(file.scriptId)
      const res = compileAndRegisterScript(file.scriptId, `Assets/Scripts/${file.scriptId}.ts`, file.source)
      assert.equal(res.ok, true, `${file.scriptId} 编译失败: ${JSON.stringify(res.diagnostics)}`)
      const lintErrors = lintScriptSource(file.source).filter((d) => d.severity === 'error')
      assert.deepEqual(lintErrors, [], `${file.scriptId} 存在静态反模式`)
    }
  }
  for (const recipe of RECIPES) {
    assert.ok(formatRecipeIndexForPrompt().includes(recipe.id))
  }
  clearScriptRuntimeState()
})

test('范例库：第三人称控制器按输入移动并在落地后停在地面', () => {
  clearScriptRuntimeState()
  clearAllVirtualInput()
  registerRecipeScripts(['third-person-controller'])
  const sim = createHeadlessWorld([
    makeNode('cam', 'Camera', { kind: 'camera', position: [0, 3, -6] }),
    makeNode('player', 'Player', {
      position: [0, 2, 0],
      ...withScripts({ ThirdPersonController: {} }),
    }),
  ])
  // 相机在 -Z 侧看向 +Z：水平方位角为 180°
  sim.host.yaw = () => Math.PI

  // 相机在 -Z 侧，向前推摇杆应当让角色沿 +Z 远离相机
  injectVirtualInput({ type: 'axis', action: 'Move', x: 0, y: 1 })
  sim.run(1.5)
  const pos = sim.positionOf('player')
  assert.deepEqual(sim.errors, [])
  assert.ok(pos && pos.z > 3, `角色应向前移动，实际 z=${pos?.z}`)
  assert.ok(pos && Math.abs(pos.x) < 0.01, `角色不应横移，实际 x=${pos?.x}`)
  assert.ok(pos && Math.abs(pos.y) < 1e-6, `角色应落到地面，实际 y=${pos?.y}`)

  clearAllVirtualInput()
  clearScriptRuntimeState()
})

test('范例库：射击 + 敌人 + 对局管理联动（子弹击杀敌人后加分）', () => {
  clearScriptRuntimeState()
  clearAllVirtualInput()
  registerRecipeScripts(['shooting', 'enemy-wave', 'health-score-hud'])
  const sim = createHeadlessWorld([
    makeNode('bulletTpl', 'BulletTemplate', {
      visible: false,
      position: [0, -50, 0],
      ...withScripts({ Bullet: {} }),
    }),
    makeNode('player', 'Player', {
      ...withScripts({ PlayerShooter: { bullet: 'bulletTpl' }, PlayerHealth: {} }),
    }),
    // 直接摆在玩家正前方（+Z）的敌人：1 点血，站着不动
    makeNode('enemy', 'Enemy', {
      position: [0, 1.1, 6],
      ...withScripts({ ChaseEnemy: { maxHp: 1, speed: 0, score: 7, targetTag: 'nobody' } }),
    }),
    makeNode('gm', 'GameManager', { kind: 'empty', ...withScripts({ GameManager: {} }) }),
  ])

  sim.run(0.1)
  assert.equal(uiValues().variables.score, 0)
  assert.equal(uiValues().variables.hp, 1)

  injectVirtualInput({ type: 'actionDown', action: 'Attack' })
  sim.run(1.5)
  assert.deepEqual(sim.errors, [])
  assert.equal(uiValues().variables.score, 7, '击杀后应加上敌人的分值')

  clearAllVirtualInput()
  clearScriptRuntimeState()
})

test('范例库：玩家受击扣血并在死亡时广播', () => {
  clearScriptRuntimeState()
  clearAllVirtualInput()
  registerRecipeScripts(['enemy-wave', 'health-score-hud'])
  const sim = createHeadlessWorld([
    makeNode('player', 'Player', { ...withScripts({ PlayerHealth: { maxHp: 20, invincibleTime: 0 } }) }),
    makeNode('enemy', 'Enemy', {
      position: [0, 0, 0.5],
      ...withScripts({ ChaseEnemy: { damage: 10, attackInterval: 0.2 } }),
    }),
    makeNode('gm', 'GameManager', { kind: 'empty', ...withScripts({ GameManager: {} }) }),
  ])

  sim.run(1.5)
  assert.deepEqual(sim.errors, [])
  assert.equal(uiValues().variables.hp, 0)
  assert.equal(uiValues().variables.resultTitle, '失败')

  clearAllVirtualInput()
  clearScriptRuntimeState()
})
