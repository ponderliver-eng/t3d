import { CAPABILITIES, capabilityEnabled, isKnownCapabilityDataKey, type CapabilityManifest } from '../../capabilities/registry'
import { ASSETS_ROOT, isWithin, normalizeDir } from '../../editor/assets/folders'
import { assetDirectory, useAssetStore } from '../../editor/assets/library'
import { useEditorStore } from '../../editor/scene/store'
import type { SceneNode } from '../../editor/scene/types'
import { CORE_COMPONENTS, describeCoreComponents, isCoreComponentId } from '../../gameplay/coreComponents'
import { listGameplayPacks, tableRows } from '../../gameplay/registry'
import { codeAssetDirKey, defaultCodeAssetDir, useCodeAssetStore } from '../codeAssets/workspace'
import { commandBus } from '../commands/bus'

function resolveCodeAssetFolder(
  kind: 'script' | 'shader',
  id: string,
  relativePath: string,
  assetDirs: Record<string, string>,
): string {
  const dirKey = codeAssetDirKey(kind, id)
  if (assetDirs[dirKey]) return normalizeDir(assetDirs[dirKey])
  if (relativePath.startsWith(`${ASSETS_ROOT}/`) && relativePath.includes('/')) {
    return normalizeDir(relativePath.slice(0, relativePath.lastIndexOf('/')))
  }
  return defaultCodeAssetDir(kind)
}

export interface OutlineNodeItem {
  id: string
  name: string
  kind: string
  parentId: string | null
  position: [number, number, number]
  visible: boolean
  children?: OutlineNodeItem[]
}

export function queryProjectOverview() {
  const state = useEditorStore.getState()
  const assetState = useAssetStore.getState()
  const assets = Object.values(assetState.assets)

  const assetCounts: Record<string, number> = {}
  const folderCounts: Record<string, number> = {}
  for (const f of assetState.folders) {
    const dir = normalizeDir(f)
    if (!(dir in folderCounts)) folderCounts[dir] = 0
  }
  const scenes: Array<{ id: string; name: string; active: boolean }> = []
  for (const asset of assets) {
    assetCounts[asset.kind] = (assetCounts[asset.kind] ?? 0) + 1
    const dir = assetDirectory(asset.id, assetState.assetDirs)
    folderCounts[dir] = (folderCounts[dir] ?? 0) + 1
    if (asset.kind === 'scene') {
      scenes.push({ id: asset.id, name: asset.name, active: asset.id === state.activeSceneId })
    }
  }
  for (const code of Object.values(useCodeAssetStore.getState().assets)) {
    assetCounts[code.kind] = (assetCounts[code.kind] ?? 0) + 1
    const dir = resolveCodeAssetFolder(code.kind, code.id, code.relativePath, assetState.assetDirs)
    folderCounts[dir] = (folderCounts[dir] ?? 0) + 1
  }
  if (!(ASSETS_ROOT in folderCounts)) folderCounts[ASSETS_ROOT] = 0

  const enabledCapabilities = CAPABILITIES
    .filter((c) => capabilityEnabled(state.capabilities, c.id))
    .map((c) => c.id)

  return {
    activeSceneId: state.activeSceneId,
    playState: state.playState,
    scenes,
    nodeCount: Object.keys(state.nodes).length,
    outlineTop: querySceneOutline(null, 2),
    enabledCapabilities,
    enabledGameplayPacks: [...state.gameplayPacks],
    assetCounts,
    assetFolders: Object.entries(folderCounts)
      .sort(([a], [b]) => a.localeCompare(b, 'zh'))
      .map(([path, count]) => ({ path, count })),
    viewportStats: {
      triangles: state.viewportStats.triangles,
      calls: state.viewportStats.calls,
      fps: state.viewportStats.fps,
    },
  }
}

export function querySceneOutline(parentId: string | null = null, maxDepth = 3): OutlineNodeItem[] {
  const { nodes } = useEditorStore.getState()
  const byParent = new Map<string | null, SceneNode[]>()
  for (const node of Object.values(nodes)) {
    const key = node.parentId ?? null
    const list = byParent.get(key)
    if (list) list.push(node)
    else byParent.set(key, [node])
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.order - b.order)
  }

  const build = (pid: string | null, depth: number): OutlineNodeItem[] => {
    const list = byParent.get(pid) ?? []
    return list.map((n) => {
      const item: OutlineNodeItem = {
        id: n.id,
        name: n.name,
        kind: n.kind,
        parentId: n.parentId,
        position: [...n.position],
        visible: n.visible,
      }
      if (depth < maxDepth) {
        const children = build(n.id, depth + 1)
        if (children.length > 0) item.children = children
      }
      return item
    })
  }

  return build(parentId, 1)
}

/** 节点动画字段说明：这些是 SceneNode 的既有字段，不属于任何能力包，登记清单里单独说明一次 */
const NODE_ANIMATION_NOTE = {
  dataPath: 'node.clip / clipAssetId / clipPlaying / clipLoop / clipSpeed',
  description:
    '模型节点的静态动画槽位：试玩开始时若 clipPlaying 为真则循环播放 clip。它只是「开局默认动画」，不会随运动状态切换。',
  howToDrive: [
    '玩家角色随移动自动切 idle/walk/run/jump：用内置组件 character（gameplay__setCoreComponent），填 idleClip/walkClip/runClip。',
    '脚本或导航驱动的对象（敌人、NPC）按速度自动切 idle/walk/run：用内置组件 locomotion，脚本里不用写动画切换。',
    '脚本里按逻辑播放：self.anim.playBody(clipName, { loop, fade, speed }) / playUpper / stopUpper；片段来自其他资产时参数声明为 ref(target:"clip")。',
  ],
}

/** 节点上各数据槽由谁驱动：运行时识别的才会在试玩中生效，其余只是数据 */
function describeNodeDrivers(node: SceneNode): string[] {
  const notes: string[] = []
  const gameplay = node.gameplay
  for (const item of CORE_COMPONENTS) {
    const data = gameplay?.[item.id] as { enabled?: boolean } | null | undefined
    if (data) notes.push(`gameplay.${item.id}：内置${item.label}，${data.enabled === false ? '已停用' : '试玩中由引擎驱动'}`)
  }
  const enabledPacks = useEditorStore.getState().gameplayPacks
  for (const [packId, bag] of Object.entries(gameplay?.packs ?? {})) {
    if (packId === '__project__') {
      const compiled = useCodeAssetStore.getState().assets
      for (const [scriptId, params] of Object.entries((bag ?? {}) as Record<string, unknown>)) {
        const record = compiled[scriptId]
        const disabled = Boolean(params && typeof params === 'object' && (params as Record<string, unknown>).__enabled === false)
        notes.push(
          `脚本 ${scriptId}：${!record ? '脚本不存在，不会运行' : !record.ok ? '编译失败，不会运行' : disabled ? '已停用' : '试玩中运行'}`,
        )
      }
      continue
    }
    if (packId === 'core' || packId === 't3d.core') {
      const keys = Object.keys((bag ?? {}) as Record<string, unknown>).filter((key) => isCoreComponentId(key))
      if (keys.length > 0) {
        notes.push(`gameplay.packs.core.${keys.join('/')}：仅数据，运行时不读取这里；内置组件请用 gameplay__setCoreComponent 写到 gameplay.<组件>`)
      }
      continue
    }
    if (!enabledPacks.includes(packId)) notes.push(`gameplay.packs.${packId}：玩法包未启用，仅数据`)
  }
  for (const capId of Object.keys(node.capabilities ?? {})) {
    if (!isKnownCapabilityDataKey(capId)) {
      notes.push(`capabilities.${capId}：不是已登记的能力包，运行时不读取，纯属无效数据（可能是之前误写的，建议清理）`)
    } else if (!capId.startsWith('__') && capId !== 'splinePath' && !capabilityEnabled(useEditorStore.getState().capabilities, capId)) {
      notes.push(`capabilities.${capId}：能力包未启用，仅数据`)
    }
  }
  if (node.clip) {
    notes.push(`clip="${node.clip}"：${node.clipPlaying ? '试玩开局自动播放' : '未勾选播放，仅数据'}（不随运动状态切换）`)
  }
  return notes
}

export function queryNodeInspect(nodeId: string) {
  const { nodes } = useEditorStore.getState()
  const node = nodes[nodeId]
  if (!node) return null

  const ruleCount = node.gameplay?.rules?.length ?? 0
  const coreData: Record<string, unknown> = {}
  for (const item of CORE_COMPONENTS) {
    if (item.id === 'character' || item.id === 'cameraFollow') continue
    const data = node.gameplay?.[item.id]
    if (data) coreData[item.id] = data
  }
  return {
    id: node.id,
    name: node.name,
    kind: node.kind,
    parentId: node.parentId,
    visible: node.visible,
    locked: node.locked,
    transform: {
      position: [...node.position],
      rotation: [...node.rotation],
      scale: [...node.scale],
    },
    assetId: node.assetId,
    physics: node.physics ?? null,
    navigation: node.navigation ?? null,
    capabilities: node.capabilities ?? {},
    gameplay: {
      character: node.gameplay?.character ?? null,
      cameraFollow: node.gameplay?.cameraFollow ?? null,
      ...coreData,
      packs: node.gameplay?.packs ?? {},
      ...(ruleCount > 0 ? { manualRulesNote: `该节点含 ${ruleCount} 条人工手配律令（只读提示，AI 不修改律令）` } : {}),
    },
    ...(node.kind === 'model' || node.clip
      ? {
          animation: {
            clip: node.clip,
            clipAssetId: node.clipAssetId,
            clipPlaying: node.clipPlaying,
            clipLoop: node.clipLoop ?? true,
            clipSpeed: node.clipSpeed ?? 1,
          },
        }
      : {}),
    drivers: describeNodeDrivers(node),
    // null 只表示「还没挂」，不是「引擎不支持」
    availableCoreComponents: {
      note: 'gameplay 里为 null 或缺失的内置组件只是尚未挂载；引擎运行时已实现，用 gameplay__setCoreComponent({ nodeId, componentId, patch }) 挂上即生效',
      notMounted: CORE_COMPONENTS.filter((item) => !node.gameplay?.[item.id]).map((item) => `${item.id}（${item.label}）`),
    },
    tagId: node.tagId ?? null,
    tagIds: node.tagIds ?? [],
    renderLayerId: node.renderLayerId ?? 'default',
  }
}

export function queryAssetSearch(query = '', kind?: string, folder?: string) {
  const q = query.trim().toLowerCase()
  const assetState = useAssetStore.getState()
  const assets = Object.values(assetState.assets)
  const targetFolder = folder?.trim() ? normalizeDir(folder) : null

  const regularResults = assets
    .filter((asset) => {
      if (kind && asset.kind !== kind) return false
      const dir = assetDirectory(asset.id, assetState.assetDirs)
      if (targetFolder && !isWithin(dir, targetFolder)) return false
      if (!q) return true
      return asset.name.toLowerCase().includes(q) || asset.id.toLowerCase().includes(q)
    })
    .map((asset) => ({
      id: asset.id,
      name: asset.name,
      kind: asset.kind,
      folder: assetDirectory(asset.id, assetState.assetDirs),
      ...(asset.kind === 'model' ? { importScale: asset.importScale ?? 1, clipCount: asset.clipCatalog?.length ?? 0 } : {}),
    }))

  const codeResults = Object.values(useCodeAssetStore.getState().assets)
    .filter((code) => {
      if (kind && code.kind !== kind) return false
      const dir = resolveCodeAssetFolder(code.kind, code.id, code.relativePath, assetState.assetDirs)
      if (targetFolder && !isWithin(dir, targetFolder)) return false
      if (!q) return true
      return (
        code.name.toLowerCase().includes(q) ||
        code.id.toLowerCase().includes(q) ||
        code.relativePath.toLowerCase().includes(q)
      )
    })
    .map((code) => ({
      id: code.id,
      name: code.name,
      kind: code.kind,
      folder: resolveCodeAssetFolder(code.kind, code.id, code.relativePath, assetState.assetDirs),
      relativePath: code.relativePath,
      ok: code.ok,
    }))

  return [...regularResults, ...codeResults].slice(0, 60)
}

export function queryRegistryDescribe(
  category: 'capabilities' | 'gameplayPacks' | 'coreComponents' | 'commands' | 'all',
  id?: string,
) {
  const out: Record<string, unknown> = {}
  if (category === 'coreComponents' || category === 'all') {
    out.coreComponents = describeCoreComponents(id)
    out.nodeAnimation = NODE_ANIMATION_NOTE
  }
  if (category === 'capabilities' || category === 'all') {
    const items = (CAPABILITIES as readonly CapabilityManifest[]).filter((c) => !id || c.id === id)
    out.capabilities = items.map((c) => ({
      id: c.id,
      defaultEnabled: c.defaultEnabled,
      category: c.category,
      dependencies: c.dependencies ?? [],
    }))
  }
  if (category === 'gameplayPacks' || category === 'all') {
    const packs = listGameplayPacks().filter((p) => !id || p.id === id)
    out.gameplayPacks = packs.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      dependencies: p.dependencies ?? [],
      tables: p.tables?.map((t) => ({ tableId: t.tableId, title: t.title })) ?? [],
      components: p.components?.map((c) => ({ componentId: c.componentId, label: c.label, defaultData: c.defaultData() })) ?? [],
      ...(p.components?.length
        ? {}
        : { note: '该包不提供可挂载组件（只有数据表/标签等）。角色控制器、跟随相机、运动动画等引擎内置组件见 category: "coreComponents"' }),
    }))
  }
  if (category === 'commands' || category === 'all') {
    out.commands = commandBus.list().filter((c) => !id || c.id === id)
  }
  return out
}

export function queryDbRows(tableId: string, limit = 50) {
  const db = useEditorStore.getState().gameDatabase
  const rows = tableRows(db, tableId)
  return {
    tableId,
    total: rows.length,
    rows: rows.slice(0, limit),
  }
}
