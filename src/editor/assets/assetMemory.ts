import { translate } from '../i18n'
import { useEditorStore } from '../scene/store'
import { useAssetStore } from './library'
import { failedAssetLoads, setLoadFailureReporter } from './loadFailures'
import { isModelBusy, loadedModelIds, loadedModelSlots, modelGeometryBytes, releaseModel } from './models'
import { liveReferencedAssetIds } from './project'
import {
  isTextureBusy,
  loadedTextureIds,
  releaseTexture,
  restoreDegradedTextures,
  setTextureMemoryPressureHandler,
  textureMemoryBytes,
  textureMemoryStats,
} from './textures'

/**
 * 资源内存治理：加载只跟着「当前场景的引用」走，场景没用到的贴图和模型可以随时放掉。
 *
 * 放掉的只是内存和显存里的副本，工程文件和磁盘上的成品都在；下次用到时从成品重新读。
 * 试玩期间不回收（运行时可能随时生成预制体）。
 */

export interface AssetSweepResult {
  textures: number
  models: number
  /** 估算释放的字节数（贴图显存 + 模型顶点数据） */
  bytes: number
  /** 恢复成全清晰度的贴图数 */
  restored: number
}

let initialized = false
let sceneSwitchTimer = 0
let pressureNoticeAt = 0

/**
 * 当前编辑状态用到的全部资源。宁可多留也不能漏：漏掉的贴图会被放掉又立刻重新加载，画面会闪一下。
 * 所以除了节点上的显式字段，还把节点、画面设置、被引用资源的内容整个扫一遍，
 * 凡是出现的资源编号都算引用（玩法数据、能力包参数、着色器参数、模型自动绑定的材质都能覆盖到）。
 */
export function collectLiveReferences(): Set<string> {
  const editor = useEditorStore.getState()
  const assets = useAssetStore.getState().assets
  const keep = liveReferencedAssetIds()
  // 正在资源检视面板里看的那个资源也留着
  if (editor.inspectedAssetId) keep.add(editor.inspectedAssetId)
  const queue = [...keep]
  const scan = (value: unknown, depth: number) => {
    if (value === null || value === undefined || depth > 24) return
    if (typeof value === 'string') {
      if (value.length <= 64 && !keep.has(value) && value in assets) {
        keep.add(value)
        queue.push(value)
      }
      return
    }
    if (typeof value !== 'object') return
    if (Array.isArray(value)) {
      for (const item of value) scan(item, depth + 1)
      return
    }
    for (const item of Object.values(value as Record<string, unknown>)) scan(item, depth + 1)
  }
  for (const node of Object.values(editor.nodes)) scan(node, 0)
  scan(editor.picture, 0)
  while (queue.length > 0) {
    const id = queue.pop()!
    const asset = assets[id]
    // 场景资源里是别的场景的节点，不展开（否则等于把所有场景都算成在用）
    if (!asset || asset.kind === 'scene') continue
    scan(asset, 0)
    if (asset.kind === 'model') scan(loadedModelSlots(id), 0)
  }
  return keep
}

/** 回收场景没用到的贴图和模型。试玩中或有资源正在加载时跳过对应的项。 */
export function releaseUnreferencedAssets(): AssetSweepResult {
  const result: AssetSweepResult = { textures: 0, models: 0, bytes: 0, restored: 0 }
  const editor = useEditorStore.getState()
  if (editor.playState !== 'stopped') return result
  const keep = collectLiveReferences()

  for (const id of loadedTextureIds()) {
    if (keep.has(id) || isTextureBusy(id)) continue
    result.bytes += textureMemoryBytes(id)
    releaseTexture(id)
    result.textures += 1
  }
  const assets = useAssetStore.getState().assets
  for (const id of loadedModelIds()) {
    if (keep.has(id) || isModelBusy(id)) continue
    // 动作资源常常只按片段名被引用（查不出编号引用），而且不带网格和贴图，占用很小：已加载的留着
    if (assets[id]?.kind === 'animation') continue
    result.bytes += modelGeometryBytes(id)
    releaseModel(id, { dispose: true })
    result.models += 1
  }
  result.restored = restoreDegradedTextures()
  return result
}

/** 回收并在日志里说明结果（菜单和批量导入结束时用）。 */
export function releaseUnreferencedAssetsWithLog(): AssetSweepResult {
  const editor = useEditorStore.getState()
  if (editor.playState !== 'stopped') {
    editor.log('warn', translate('memory.sweepWhilePlaying'))
    return { textures: 0, models: 0, bytes: 0, restored: 0 }
  }
  const result = releaseUnreferencedAssets()
  const stats = textureMemoryStats()
  editor.log('info', translate('memory.sweepDone', {
    textures: result.textures,
    models: result.models,
    freed: formatMb(result.bytes),
    used: formatMb(stats.bytes),
    budget: formatMb(stats.budgetBytes),
  }))
  return result
}

/** 资源内存的估算统计，供诊断和界面显示。 */
export function assetMemoryStats() {
  const textures = textureMemoryStats()
  let modelBytes = 0
  const models = loadedModelIds()
  for (const id of models) modelBytes += modelGeometryBytes(id)
  return {
    textureBytes: textures.bytes,
    textureCount: textures.count,
    textureBudgetBytes: textures.budgetBytes,
    degradedTextures: textures.degraded,
    modelBytes,
    modelCount: models.length,
    failedLoads: failedAssetLoads(),
  }
}

/** 编辑器启动时调用一次：接上「超预算回收」「切换场景回收」「加载失败上报」。 */
export function initAssetMemory() {
  if (initialized) return
  initialized = true

  setLoadFailureReporter(info => {
    const asset = useAssetStore.getState().assets[info.assetId]
    const name = asset?.name ?? info.name
    const text = translate('memory.loadFailed', { kind: info.kind, name, message: info.message })
    useEditorStore.getState().log('error', text, [{ text, assetId: info.assetId }])
  })

  setTextureMemoryPressureHandler(({ usedBytes, budgetBytes }) => {
    const swept = releaseUnreferencedAssets()
    const after = textureMemoryStats()
    if (after.bytes <= after.budgetBytes) return
    // 回收后仍然超预算：说明是当前场景本身太大，之后新加载的贴图会降清晰度。每分钟最多提示一次
    const now = performance.now()
    if (pressureNoticeAt && now - pressureNoticeAt < 60000) return
    pressureNoticeAt = now
    useEditorStore.getState().log('warn', translate('memory.overBudget', {
      used: formatMb(swept.textures > 0 ? after.bytes : usedBytes),
      budget: formatMb(budgetBytes),
    }))
  })

  let previousScene = useEditorStore.getState().activeSceneId
  useEditorStore.subscribe(state => {
    if (state.activeSceneId === previousScene) return
    previousScene = state.activeSceneId
    // 等新场景把自己要用的资源请求出来之后再回收，共用的资源就不会被白白放掉重读
    if (sceneSwitchTimer) window.clearTimeout(sceneSwitchTimer)
    sceneSwitchTimer = window.setTimeout(() => {
      sceneSwitchTimer = 0
      releaseUnreferencedAssets()
    }, 4000)
  })
}

function formatMb(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)}MB`
}
