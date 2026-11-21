import { capabilityEnabled } from '../../capabilities/registry'
import { useAssetStore } from '../../editor/assets/library'
import { useEditorStore } from '../../editor/scene/store'
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
