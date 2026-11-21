import assert from 'node:assert/strict'
import test from 'node:test'
import { executeAiTool } from '../src/ai/tools'
import { saveAndCompileCodeAsset } from '../src/core/codeAssets/workspace'
import { ensureCoreCommandsRegistered } from '../src/core/commands/registerAll'
import { installPackBundle, listAllRecipes, sedimentProjectToPack, trustAndActivatePack, uninstallPack, usePackStore } from '../src/core/packs/manager'
import { createBranch, listBranches, promoteBranchToMain, switchBranch } from '../src/core/project/checkpoints'
import { useEditorStore } from '../src/editor/scene/store'
import { getGameplayPack } from '../src/gameplay/registry'

ensureCoreCommandsRegistered()

test('阶段 4: 轻量实验分支 A/B 切换与设为主线', () => {
  useEditorStore.getState().newScene()
  const baseCount = Object.keys(useEditorStore.getState().nodes).length

  const bRes = createBranch('方案B-加方块')
  assert.equal(bRes.ok, true)
  useEditorStore.getState().createNode('box')
  const bCount = Object.keys(useEditorStore.getState().nodes).length
  assert.equal(bCount, baseCount + 1)

  const swMain = switchBranch('main')
  assert.equal(swMain.ok, true)
  assert.equal(Object.keys(useEditorStore.getState().nodes).length, baseCount)

  const swB = switchBranch(bRes.branch!.id)
  assert.equal(swB.ok, true)
  assert.equal(Object.keys(useEditorStore.getState().nodes).length, bCount)

  const promo = promoteBranchToMain(bRes.branch!.id)
  assert.equal(promo.ok, true)
  assert.equal(Object.keys(useEditorStore.getState().nodes).length, bCount)
  assert.ok(listBranches().some(b => b.id === 'main' && b.isActive))
})

test('阶段 4: 全层级能力包沉淀、规整 __project__ 脚本与信任卸载', async () => {
  useEditorStore.getState().newScene()
  useEditorStore.getState().createNode('box')
  const nodeId = Object.keys(useEditorStore.getState().nodes).find(id => useEditorStore.getState().nodes[id].kind === 'box')!

  const compiled = await saveAndCompileCodeAsset(
    'script',
    'patrol_test',
    `import { defineBehavior } from 't3d/runtime'\nexport default defineBehavior({ name: '巡逻测试', params: { speed: { type: 'number', default: 3, label: '速度' } }, onUpdate() {} })`,
  )
  assert.equal(compiled.ok, true)

  const curNode = useEditorStore.getState().nodes[nodeId]
  useEditorStore.setState({
    nodes: {
      ...useEditorStore.getState().nodes,
      [nodeId]: {
        ...curNode,
        gameplay: { tags: [], packs: { __project__: { patrol_test: { speed: 5 } } } },
      },
    },
  })

  const sed = await sedimentProjectToPack({
    id: 'my-rts',
    name: 'RTS 测试包',
    tier: 'gameplay',
    migrateProjectScripts: true,
  })
  assert.equal(sed.ok, true)
  assert.equal(sed.bundle?.manifest.id, 'user.my-rts')
  assert.equal(sed.bundle?.components.length, 1)

  const updatedNode = useEditorStore.getState().nodes[nodeId]
  assert.ok(updatedNode.gameplay?.packs?.['user.my-rts']?.patrol_test)
  assert.equal((updatedNode.gameplay?.packs?.__project__ as Record<string, unknown> | undefined)?.patrol_test, undefined)
  assert.ok(getGameplayPack('user.my-rts'))
  assert.ok(listAllRecipes().length >= 4)

  // 卸载与导入未信任包验证
  assert.equal(uninstallPack('user.my-rts'), true)
  assert.equal(getGameplayPack('user.my-rts'), undefined)

  const importedBundle = structuredClone(sed.bundle!)
  importedBundle.manifest.trust = 'imported'
  const inst = await installPackBundle(importedBundle)
  assert.equal(inst.needsTrustConfirmation, true)
  assert.equal(usePackStore.getState().installed['user.my-rts'].trusted, false)
  assert.equal(getGameplayPack('user.my-rts'), undefined)

  assert.equal(await trustAndActivatePack('user.my-rts'), true)
  assert.ok(getGameplayPack('user.my-rts'))
})

test('阶段 4: AI 工具面 pack__list 与 branch__list 可用', async () => {
  const packRes = await executeAiTool('pack__list', {})
  assert.equal(packRes.ok, true)
  const branchRes = await executeAiTool('branch__list', {})
  assert.equal(branchRes.ok, true)
})
