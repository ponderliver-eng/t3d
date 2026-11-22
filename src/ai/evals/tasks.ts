import { commandBus } from '../../core/commands/bus'
import { useCodeAssetStore } from '../../core/codeAssets/workspace'
import { useAssetStore } from '../../editor/assets/library'
import { useEditorStore } from '../../editor/scene/store'
import type { SmokeStep } from '../../playtest/session'
import type { UiNode } from '../../runtime/ui/spec'
import { findRecipe } from '../knowledge/recipes'

/**
 * AI 评测任务集：从「一句话小改动」到「完整 Demo」的固定任务。
 * 每次调整提示词、工具或模型适配后跑一遍（见 runner.ts），用通过率 / 步数 / 耗时 / token 说话。
 *
 * 约定：任务提示里会指定关键节点的名称（如 Player），检查逻辑按名称定位。
 */

export interface EvalCheckResult {
  name: string
  pass: boolean
  note?: string
}

export interface EvalTask {
  id: string
  /** small：应在 1~4 步内完成；medium：单个功能；large：完整玩法 */
  size: 'small' | 'medium' | 'large'
  prompt: string
  /** 期望的模型步数上限（超出记为效率不达标，但不影响功能通过） */
  stepBudget: number
  /** 发送提示前的工程准备（通过指令层执行） */
  setup?: () => Promise<void>
  /** 编辑态检查：直接读工程数据 */
  staticChecks?: () => EvalCheckResult[]
  /** 试玩态检查：返回冒烟步骤；运行时报错与断言失败都会判为不通过 */
  smoke?: () => SmokeStep[]
}

function nodeByName(name: string) {
  return Object.values(useEditorStore.getState().nodes).find((n) => n.name === name)
}

function scriptSource(id: string): string {
  return useCodeAssetStore.getState().assets[id]?.source ?? ''
}

function attachedScriptIds(nodeName: string): string[] {
  const node = nodeByName(nodeName)
  return Object.keys((node?.gameplay?.packs as Record<string, Record<string, unknown>> | undefined)?.__project__ ?? {})
}

function uiBoundVariables(): Set<string> {
  const vars = new Set<string>()
  const walk = (node: UiNode) => {
    for (const binding of node.bindings ?? []) {
      if (binding.source.kind === 'variable') vars.add(binding.source.varId)
    }
    for (const child of node.children ?? []) walk(child)
  }
  for (const asset of Object.values(useAssetStore.getState().assets)) {
    if (asset.kind === 'ui' && asset.document?.root) walk(asset.document.root)
  }
  return vars
}

function moveForwardSmoke(nodeName: string, minDistance: number): SmokeStep[] {
  const node = nodeByName(nodeName)
  const from = (node?.position ?? [0, 0, 0]) as [number, number, number]
  return [
    { action: 'step', seconds: 0.3 },
    { action: 'input', events: [{ type: 'axis', action: 'Move', x: 0, y: 1 }] },
    { action: 'step', seconds: 1.2 },
    {
      action: 'assert',
      condition: { kind: 'nodeMoved', nodeIdOrName: nodeName, from, minDistance },
      message: `${nodeName} 应在向前输入下移动至少 ${minDistance} 米`,
    },
    { action: 'input', events: [{ type: 'clear' }] },
  ]
}

async function createScript(id: string, source: string): Promise<void> {
  await commandBus.dispatch('script.create', { id, source })
}

const BROKEN_SPINNER = `import { defineBehavior } from "t3d/runtime"

export default defineBehavior({
  name: "旋转器",
  description: "让节点绕 Y 轴匀速旋转",
  params: {
    speed: { type: "number", label: "旋转速度", default: 1.5 },
  },
  onUpdate(self, dt) {
    self.rotateYaw(self.params.speed * dt)
  },
})
`

export const EVAL_TASKS: EvalTask[] = [
  {
    id: 'small-create-node',
    size: 'small',
    stepBudget: 3,
    prompt: '在场景里创建一个名为 EvalCube 的立方体，放在 (2, 0.5, 0)。',
    staticChecks: () => {
      const node = nodeByName('EvalCube')
      const pos = node?.position ?? [NaN, NaN, NaN]
      return [
        { name: '节点存在且为立方体', pass: node?.kind === 'box' },
        {
          name: '位置正确',
          pass: Math.abs(pos[0] - 2) < 0.01 && Math.abs(pos[1] - 0.5) < 0.01 && Math.abs(pos[2]) < 0.01,
          note: `实际 ${JSON.stringify(pos)}`,
        },
      ]
    },
  },
  {
    id: 'small-edit-param',
    size: 'small',
    stepBudget: 4,
    prompt: '把 EvalCollectible 脚本里拾取半径的默认值改成 2.5，其它不要动。',
    setup: async () => {
      const recipe = findRecipe('collectible')
      if (recipe) await createScript('EvalCollectible', recipe.files[0].source)
    },
    staticChecks: () => {
      const source = scriptSource('EvalCollectible')
      const original = findRecipe('collectible')?.files[0].source ?? ''
      const changedLines = source.split('\n').filter((line, i) => line !== original.split('\n')[i]).length
      return [
        { name: '半径默认值已改为 2.5', pass: /radius:[^\n]*default:\s*2\.5\b/.test(source) },
        { name: '脚本仍可编译', pass: useCodeAssetStore.getState().assets.EvalCollectible?.ok === true },
        { name: '只改动了一行（局部修改而非重写）', pass: changedLines === 1, note: `改动 ${changedLines} 行` },
      ]
    },
  },
  {
    id: 'small-fix-runtime-error',
    size: 'small',
    stepBudget: 6,
    prompt: 'EvalSpinner 这个方块试玩时不转，控制台一直在报错，帮我修好。',
    setup: async () => {
      await createScript('EvalSpinnerScript', BROKEN_SPINNER)
      const res = await commandBus.dispatch('scene.createNode', { kind: 'box', name: 'EvalSpinner', position: [0, 1, 0] })
      if (res.ok) await commandBus.dispatch('script.attach', { nodeId: 'EvalSpinner', scriptId: 'EvalSpinnerScript' })
    },
    staticChecks: () => [
      { name: '没有新建多余脚本', pass: !Object.keys(useCodeAssetStore.getState().assets).some((id) => /probe|test|debug/i.test(id)) },
    ],
    smoke: () => [{ action: 'step', seconds: 1 }],
  },
  {
    id: 'medium-wasd-mover',
    size: 'medium',
    stepBudget: 10,
    prompt: '做一个可以用 WASD 在地面上移动的角色：用胶囊体，节点命名为 Player；再加一块地面。',
    staticChecks: () => [
      { name: 'Player 节点存在', pass: Boolean(nodeByName('Player')) },
      { name: 'Player 挂有脚本', pass: attachedScriptIds('Player').length > 0 },
    ],
    smoke: () => moveForwardSmoke('Player', 1),
  },
  {
    id: 'medium-follow-camera',
    size: 'medium',
    stepBudget: 12,
    prompt: '做一个第三人称场景：角色节点叫 Player（胶囊体即可，WASD 移动），相机节点叫 MainCamera，平滑跟随 Player。',
    staticChecks: () => [
      { name: 'MainCamera 是相机', pass: nodeByName('MainCamera')?.kind === 'camera' },
      { name: 'MainCamera 挂有跟随脚本', pass: attachedScriptIds('MainCamera').length > 0 },
    ],
    smoke: () => {
      const cam = nodeByName('MainCamera')
      const from = (cam?.position ?? [0, 0, 0]) as [number, number, number]
      return [
        ...moveForwardSmoke('Player', 1),
        { action: 'step', seconds: 1 },
        {
          action: 'assert',
          condition: { kind: 'nodeMoved', nodeIdOrName: 'MainCamera', from, minDistance: 0.5 },
          message: '相机应跟随角色移动',
        },
      ]
    },
  },
  {
    id: 'medium-hud',
    size: 'medium',
    stepBudget: 8,
    prompt: '做一个游戏 HUD：左上角生命条绑定界面变量 hp，右上角分数绑定界面变量 score，并挂到场景里。',
    staticChecks: () => {
      const vars = uiBoundVariables()
      const hasScreen = Object.values(useEditorStore.getState().nodes).some((n) => n.kind === 'screen')
      return [
        { name: '绑定了 hp', pass: vars.has('hp') },
        { name: '绑定了 score', pass: vars.has('score') },
        { name: '已挂载到场景', pass: hasScreen },
      ]
    },
  },
  {
    id: 'medium-collect-coins',
    size: 'medium',
    stepBudget: 16,
    prompt:
      '做一个收集金币的小场景：玩家节点叫 Player（WASD 移动），场景里摆 5 个金币（名称以 Coin 开头），玩家碰到金币后金币消失并加 1 分，分数写入界面变量 score 并显示在 HUD 上。',
    staticChecks: () => {
      const coins = Object.values(useEditorStore.getState().nodes).filter((n) => n.name.startsWith('Coin'))
      return [
        { name: '至少 5 个金币', pass: coins.length >= 5, note: `实际 ${coins.length}` },
        { name: 'HUD 绑定了 score', pass: uiBoundVariables().has('score') },
      ]
    },
    smoke: () => [
      ...moveForwardSmoke('Player', 1),
      { action: 'assert', condition: { kind: 'uiVarEquals', name: 'score', value: 0 }, message: '未碰到金币前分数应为 0（且变量已初始化）' },
    ],
  },
  {
    id: 'large-topdown-shooter',
    size: 'large',
    stepBudget: 32,
    prompt:
      '做一个俯视角射击小游戏 Demo：玩家节点叫 Player，WASD 移动、按住鼠标左键或攻击键射击；敌人一波一波出现并追击玩家；HUD 显示生命（界面变量 hp，0~1）和分数（界面变量 score）；玩家死亡后显示结算界面。',
    staticChecks: () => {
      const vars = uiBoundVariables()
      const materials = Object.values(useAssetStore.getState().assets).filter((a) => a.kind === 'material')
      const nodes = Object.values(useEditorStore.getState().nodes)
      return [
        { name: 'Player 存在并挂有脚本', pass: attachedScriptIds('Player').length > 0 },
        { name: 'HUD 绑定 hp 与 score', pass: vars.has('hp') && vars.has('score') },
        { name: '有相机', pass: nodes.some((n) => n.kind === 'camera') },
        { name: '有光源', pass: nodes.some((n) => n.kind.endsWith('-light')) },
        { name: '至少 2 个界面屏幕（HUD + 结算）', pass: nodes.filter((n) => n.kind === 'screen').length >= 2 },
        { name: '用材质区分了对象（至少 3 种）', pass: materials.length >= 3, note: `实际 ${materials.length}` },
      ]
    },
    smoke: () => {
      const baseCount = Object.keys(useEditorStore.getState().nodes).length
      return [
        ...moveForwardSmoke('Player', 1),
        { action: 'assert', condition: { kind: 'uiVarEquals', name: 'hp', value: 1 }, message: '开局生命应为满值 1' },
        { action: 'input', events: [{ type: 'actionDown', action: 'Attack' }] },
        { action: 'step', seconds: 4 },
        {
          action: 'assert',
          condition: { kind: 'nodeCountAtLeast', min: baseCount + 2 },
          message: '运行数秒后应已生成敌人或子弹',
        },
        { action: 'input', events: [{ type: 'clear' }] },
      ]
    },
  },
]
