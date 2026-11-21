import { CAPABILITIES, capabilityEnabled, type CapabilityManifest } from '../../capabilities/registry'
import { useAssetStore } from '../../editor/assets/library'
import { useEditorStore } from '../../editor/scene/store'
import type { SceneNode } from '../../editor/scene/types'
import { listGameplayPacks, tableRows } from '../../gameplay/registry'
import { commandBus } from '../commands/bus'

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
  const assets = Object.values(useAssetStore.getState().assets)

  const assetCounts: Record<string, number> = {}
  const scenes: Array<{ id: string; name: string; active: boolean }> = []
  for (const asset of assets) {
    assetCounts[asset.kind] = (assetCounts[asset.kind] ?? 0) + 1
    if (asset.kind === 'scene') {
      scenes.push({ id: asset.id, name: asset.name, active: asset.id === state.activeSceneId })
    }
  }

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

export function queryNodeInspect(nodeId: string) {
  const { nodes } = useEditorStore.getState()
  const node = nodes[nodeId]
  if (!node) return null

  const ruleCount = node.gameplay?.rules?.length ?? 0
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
      packs: node.gameplay?.packs ?? {},
      ...(ruleCount > 0 ? { manualRulesNote: `该节点含 ${ruleCount} 条人工手配律令（只读提示，AI 不修改律令）` } : {}),
    },
    tagId: node.tagId ?? null,
    tagIds: node.tagIds ?? [],
    renderLayerId: node.renderLayerId ?? 'default',
  }
}

export function queryAssetSearch(query = '', kind?: string) {
  const q = query.trim().toLowerCase()
  const assets = Object.values(useAssetStore.getState().assets)
  return assets
    .filter((asset) => {
      if (kind && asset.kind !== kind) return false
      if (!q) return true
      return asset.name.toLowerCase().includes(q) || asset.id.toLowerCase().includes(q)
    })
    .slice(0, 60)
    .map((asset) => ({
      id: asset.id,
      name: asset.name,
      kind: asset.kind,
      ...(asset.kind === 'model' ? { importScale: asset.importScale ?? 1, clipCount: asset.clipCatalog?.length ?? 0 } : {}),
    }))
}

export function queryRegistryDescribe(category: 'capabilities' | 'gameplayPacks' | 'commands' | 'all', id?: string) {
  const out: Record<string, unknown> = {}
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
