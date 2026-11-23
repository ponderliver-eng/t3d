import { capabilityEnabled, isKnownCapabilityDataKey } from '../../capabilities/registry'
import { useAssetStore } from '../../editor/assets/library'
import { useEditorStore } from '../../editor/scene/store'
import type { UiNode } from '../../runtime/ui/spec'
import { useCodeAssetStore } from '../codeAssets/workspace'
import { getInputActionMap } from '../input/actionMap'
import { readMainRenderMetrics } from '../preview/offscreenPreview'

export type DiagnoseSeverity = 'error' | 'warning' | 'info'

export interface PerformanceBudget {
  maxDrawCalls: number
  maxTriangles: number
  maxShadowLights: number
  maxAssetBytes: number
}

export const DEFAULT_PERFORMANCE_BUDGET: PerformanceBudget = {
  maxDrawCalls: 600,
  maxTriangles: 350_000,
  maxShadowLights: 3,
  maxAssetBytes: 120 * 1024 * 1024,
}

export interface DiagnoseIssue {
  severity: DiagnoseSeverity
  category: 'reference' | 'playability' | 'ui' | 'budget' | 'pack'
  target?: string
  message: string
  hint: string
}

export interface DiagnoseReport {
  ok: boolean
  errorCount: number
  warningCount: number
  issues: DiagnoseIssue[]
  metrics?: {
    nodeCount: number
    assetCount: number
    assetBytes: number
    shadowLights: number
    drawCalls?: number
    triangles?: number
    geometries?: number
    textures?: number
  }
}

export function diagnoseProject(budget: PerformanceBudget = DEFAULT_PERFORMANCE_BUDGET): DiagnoseReport {
  const state = useEditorStore.getState()
  const assets = useAssetStore.getState().assets
  const nodes = Object.values(state.nodes)
  const issues: DiagnoseIssue[] = []

  let hasCamera = false
  let hasLight = false
  let hasCharacterOrPlayer = false

  for (const node of nodes) {
    if (node.kind === 'camera') hasCamera = true
    if (
      node.kind === 'directional-light' ||
      node.kind === 'point-light' ||
      node.kind === 'spot-light' ||
      node.kind === 'hemisphere-light'
    ) {
      hasLight = true
    }
    if (node.gameplay?.character?.enabled || node.tagId === 'player' || node.tagIds?.includes('player')) {
      hasCharacterOrPlayer = true
    }

    if (node.parentId && !state.nodes[node.parentId]) {
      issues.push({
        severity: 'error',
        category: 'reference',
        target: node.id,
        message: `节点 "${node.name}" 的父节点 "${node.parentId}" 不存在`,
        hint: '调用 scene.reparentNode 将其移到根级或有效的父节点下',
      })
    }

    if (node.assetId && !assets[node.assetId]) {
      issues.push({
        severity: 'error',
        category: 'reference',
        target: node.id,
        message: `节点 "${node.name}" 引用的资产 "${node.assetId}" 已丢失`,
        hint: '请重新指派有效的模型/特效/界面资产或删除无效节点',
      })
    }

    if (node.materialAssetId && !assets[node.materialAssetId]) {
      issues.push({
        severity: 'error',
        category: 'reference',
        target: node.id,
        message: `节点 "${node.name}" 引用的材质资产 "${node.materialAssetId}" 不存在`,
        hint: '请通过 asset.assignMaterial 重新绑定有效材质',
      })
    }

    for (const slot of node.slots) {
      if (slot.materialAssetId && !assets[slot.materialAssetId]) {
        issues.push({
          severity: 'error',
          category: 'reference',
          target: node.id,
          message: `节点 "${node.name}" 槽位 "${slot.name}" 引用的材质资产 "${slot.materialAssetId}" 不存在`,
          hint: '请通过 asset.assignMaterial 重新绑定有效材质',
        })
      }
    }

    if (node.capabilities?.water && !capabilityEnabled(state.capabilities, 'water')) {
      issues.push({
        severity: 'warning',
        category: 'pack',
        target: node.id,
        message: `节点 "${node.name}" 挂有水体配置，但工程尚未启用 water 能力包`,
        hint: '调用 capability.setEnabled 开启 water 能力包',
      })
    }

    for (const capId of Object.keys(node.capabilities ?? {})) {
      if (isKnownCapabilityDataKey(capId)) continue
      issues.push({
        severity: 'warning',
        category: 'pack',
        target: node.id,
        message: `节点 "${node.name}" 上的 capabilities.${capId} 不是已登记的能力包，运行时不会读取`,
        hint: '这是无效数据。角色移动/动画请用 gameplay.setCoreComponent 挂 character 或 locomotion',
      })
    }

    if (node.gameplay?.packs) {
      for (const packId of Object.keys(node.gameplay.packs)) {
        if (packId !== 'core' && packId !== '__project__' && !state.gameplayPacks.includes(packId)) {
          issues.push({
            severity: 'warning',
            category: 'pack',
            target: node.id,
            message: `节点 "${node.name}" 使用了未启用的玩法包 "${packId}"`,
            hint: `调用 gameplay.setPackEnabled 开启 "${packId}"`,
          })
        }
      }
    }
  }

  // 跨层断链体检 1：脚本编译错误、节点挂载与 ref 参数空缺
  const codeAssets = Object.values(useCodeAssetStore.getState().assets)
  const scriptAssets = codeAssets.filter((a) => a.kind === 'script')
  const scriptById = new Map(scriptAssets.map((s) => [s.id, s]))

  for (const script of scriptAssets) {
    if (!script.ok) {
      issues.push({
        severity: 'error',
        category: 'playability',
        target: script.id,
        message: `脚本 "${script.relativePath}" 编译失败（${script.diagnostics[0]?.message ?? '存在语法或结构错误'}）`,
        hint: '调用 script__read 查看源码并用 script.update / script.patch 修复',
      })
    }
  }

  const mountedScriptIds = new Set<string>()
  for (const node of nodes) {
    const projectScripts = node.gameplay?.packs?.__project__ as Record<string, Record<string, unknown>> | undefined
    if (!projectScripts || typeof projectScripts !== 'object') continue
    for (const [scriptId, rawConfig] of Object.entries(projectScripts)) {
      if (!rawConfig || typeof rawConfig !== 'object') continue
      if (rawConfig.__enabled === false) continue
      mountedScriptIds.add(scriptId)
      const scriptRecord = scriptById.get(scriptId)
      if (!scriptRecord) {
        issues.push({
          severity: 'error',
          category: 'reference',
          target: node.id,
          message: `节点 "${node.name}" 挂载了不存在的脚本 "${scriptId}"`,
          hint: '检查 scriptId 或从节点移除无效脚本',
        })
        continue
      }
      const paramSchema = scriptRecord.compiledScript?.behavior?.params
      if (paramSchema && typeof paramSchema === 'object') {
        for (const [paramKey, rawDef] of Object.entries(paramSchema)) {
          if (!rawDef || typeof rawDef !== 'object') continue
          const def = rawDef as { type?: string; target?: string; optional?: boolean; default?: unknown }
          if (def.type !== 'ref') continue
          const val = rawConfig[paramKey] ?? def.default
          const strVal = typeof val === 'string' ? val.trim() : ''
          if (!strVal) {
            if (!def.optional) {
              issues.push({
                severity: 'warning',
                category: 'reference',
                target: node.id,
                message: `节点 "${node.name}" 上的脚本 "${scriptId}" 缺少引用参数 "${paramKey}"（当前为空）`,
                hint: `调用 script.attach 为 "${node.name}" 的 ${scriptId}.params.${paramKey} 传入有效节点或资产 ID`,
              })
            }
          } else if (def.target === 'node' && !state.nodes[strVal]) {
            issues.push({
              severity: 'error',
              category: 'reference',
              target: node.id,
              message: `节点 "${node.name}" 脚本 "${scriptId}" 的节点引用 "${paramKey}" 指向了不存在的节点 "${strVal}"`,
              hint: `调用 script.attach 更新 ${scriptId}.params.${paramKey} 为有效的场景节点 ID`,
            })
          } else if (def.target === 'asset' && !assets[strVal]) {
            issues.push({
              severity: 'error',
              category: 'reference',
              target: node.id,
              message: `节点 "${node.name}" 脚本 "${scriptId}" 的资产引用 "${paramKey}" 指向了不存在的资产 "${strVal}"`,
              hint: `调用 script.attach 更新 ${scriptId}.params.${paramKey} 为有效的资产 ID`,
            })
          }
        }
      }
    }
  }

  // 跨层断链体检 2：脚本中使用的输入 Action 是否已在工程输入映射中注册
  const inputActions = getInputActionMap().actions
  const inputActionRe = /\b(?:self|world)\.input\.(?:isPressed|justPressed|justReleased|axis1D|axis2D)\(\s*["']([^"']+)["']/g
  const reportedMissingActions = new Set<string>()
  for (const script of scriptAssets) {
    if (!mountedScriptIds.has(script.id) && script.compiledScript?.kind !== 'system') continue
    let m: RegExpExecArray | null
    while ((m = inputActionRe.exec(script.source)) !== null) {
      const actionName = m[1]
      if (!inputActions[actionName] && !reportedMissingActions.has(actionName)) {
        reportedMissingActions.add(actionName)
        issues.push({
          severity: 'warning',
          category: 'playability',
          target: script.id,
          message: `脚本 "${script.id}" 读取了输入动作 "${actionName}"，但工程输入配置中未注册该动作`,
          hint: `调用 input.setAction 注册 "${actionName}" 的按键映射（或改用已注册动作：${Object.keys(inputActions).join(', ')}）`,
        })
      }
    }
  }

  // 跨层断链体检 3：已挂载 UI 界面中的变量绑定与按钮消息是否在脚本中有写入/监听
  const allScriptSources = scriptAssets.map((s) => s.source).join('\n')
  const scriptSetVars = new Set<string>()
  const setVarRe = /\bui\.setVar\(\s*["']([^"']+)["']/g
  let varMatch: RegExpExecArray | null
  while ((varMatch = setVarRe.exec(allScriptSources)) !== null) {
    scriptSetVars.add(varMatch[1])
  }
  const scriptEventHandlers = new Set<string>()
  const onEventRe = /\bui\.onEvent\(\s*["']([^"']+)["']/g
  let evMatch: RegExpExecArray | null
  while ((evMatch = onEventRe.exec(allScriptSources)) !== null) {
    scriptEventHandlers.add(evMatch[1])
  }

  const uiBoundVars = new Map<string, string>()
  const uiSentMessages = new Map<string, string>()
  const uiSelfSetVars = new Set<string>()
  const collectUiRefs = (uiNode: UiNode, screenName: string): void => {
    if (Array.isArray(uiNode.bindings)) {
      for (const b of uiNode.bindings) {
        if (b?.source?.kind === 'variable' && b.source.varId) {
          uiBoundVars.set(b.source.varId, screenName)
        }
      }
    }
    if (uiNode.click?.kind === 'sendMessage' && uiNode.click.message) {
      uiSentMessages.set(uiNode.click.message, screenName)
    } else if (uiNode.click?.kind === 'setVariable' && uiNode.click.varId) {
      uiSelfSetVars.add(uiNode.click.varId)
    }
    if (Array.isArray(uiNode.children)) {
      for (const child of uiNode.children) collectUiRefs(child, screenName)
    }
  }

  for (const node of nodes) {
    if (node.kind === 'screen' && node.screen?.documentId) {
      const uiAsset = assets[node.screen.documentId]
      if (uiAsset?.kind === 'ui') {
        collectUiRefs(uiAsset.document.root, uiAsset.name)
      }
    }
  }

  if (scriptAssets.length > 0) {
    for (const [varId, uiName] of uiBoundVars.entries()) {
      if (!scriptSetVars.has(varId) && !uiSelfSetVars.has(varId)) {
        issues.push({
          severity: 'warning',
          category: 'ui',
          target: varId,
          message: `UI "${uiName}" 绑定了变量 "${varId}"，但没有任何脚本调用 ui.setVar("${varId}", ...) 更新它`,
          hint: `在相关脚本中添加 self.ui.setVar("${varId}", value)（或 world.ui.setVar）`,
        })
      }
    }
    for (const [msgName, uiName] of uiSentMessages.entries()) {
      const quotedPresent =
        scriptEventHandlers.has(msgName) ||
        allScriptSources.includes(`"${msgName}"`) ||
        allScriptSources.includes(`'${msgName}'`)
      if (!quotedPresent) {
        issues.push({
          severity: 'warning',
          category: 'ui',
          target: msgName,
          message: `UI "${uiName}" 的按钮会发送事件 "${msgName}"，但当前没有脚本监听或处理它`,
          hint: `在脚本中通过 self.ui.onEvent("${msgName}", () => { ... }) 或 onMessage 响应此事件`,
        })
      }
    }
  }

  if (!hasCamera) {
    issues.push({
      severity: 'warning',
      category: 'playability',
      message: '当前场景没有相机节点',
      hint: '可创建一个 camera 节点或为角色启用跟随相机',
    })
  }

  if (!hasLight) {
    issues.push({
      severity: 'warning',
      category: 'playability',
      message: '当前场景没有任何灯光节点，画面可能全黑',
      hint: '调用 scene.createNode 创建一个 directional-light 或 hemisphere-light',
    })
  }

  if (nodes.length > 0 && !hasCharacterOrPlayer) {
    issues.push({
      severity: 'info',
      category: 'playability',
      message: '当前场景未检测到带有角色控制器的主角节点',
      hint: '如为可操控游戏，建议配置角色组件或玩家标签',
    })
  }

  let shadowLights = 0
  for (const node of nodes) {
    if (
      (node.kind === 'directional-light' || node.kind === 'spot-light' || node.kind === 'point-light') &&
      node.castShadow
    ) {
      shadowLights += 1
    }
  }
  if (shadowLights > budget.maxShadowLights) {
    issues.push({
      severity: 'warning',
      category: 'budget',
      message: `实时阴影光源数量过多（当前 ${shadowLights} 个，建议不超过 ${budget.maxShadowLights} 个）`,
      hint: '关闭次要光源的 castShadow 以降低阴影渲染开销',
    })
  }

  const assetList = Object.values(assets)
  let assetBytes = 0
  for (const asset of assetList) {
    if ('byteLength' in asset && typeof asset.byteLength === 'number') {
      assetBytes += asset.byteLength
    }
  }
  if (assetBytes > budget.maxAssetBytes) {
    issues.push({
      severity: 'warning',
      category: 'budget',
      message: `工程资产总体积较大（${(assetBytes / (1024 * 1024)).toFixed(1)} MB，预算 ${(budget.maxAssetBytes / (1024 * 1024)).toFixed(0)} MB）`,
      hint: '建议压缩贴图、开启 Meshopt/KTX2 或清理未引用资产',
    })
  }

  const renderMetrics = readMainRenderMetrics()
  if (renderMetrics) {
    if (renderMetrics.drawCalls > budget.maxDrawCalls) {
      issues.push({
        severity: renderMetrics.drawCalls > budget.maxDrawCalls * 2 ? 'error' : 'warning',
        category: 'budget',
        message: `DrawCall 超出预算（当前 ${renderMetrics.drawCalls}，预算 ${budget.maxDrawCalls}）`,
        hint: '建议合并静态网格、复用材质或减少动态光源数量',
      })
    }
    if (renderMetrics.triangles > budget.maxTriangles) {
      issues.push({
        severity: renderMetrics.triangles > budget.maxTriangles * 2 ? 'error' : 'warning',
        category: 'budget',
        message: `三角面数超出预算（当前 ${renderMetrics.triangles}，预算 ${budget.maxTriangles}）`,
        hint: '建议对远景模型减面或替换低模',
      })
    }
  }

  const errorCount = issues.filter((i) => i.severity === 'error').length
  const warningCount = issues.filter((i) => i.severity === 'warning').length
  return {
    ok: errorCount === 0,
    errorCount,
    warningCount,
    issues,
    metrics: {
      nodeCount: nodes.length,
      assetCount: assetList.length,
      assetBytes,
      shadowLights,
      drawCalls: renderMetrics?.drawCalls,
      triangles: renderMetrics?.triangles,
      geometries: renderMetrics?.geometries,
      textures: renderMetrics?.textures,
    },
  }
}
