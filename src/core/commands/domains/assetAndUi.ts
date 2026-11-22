import { ASSETS_ROOT, normalizeDir } from '../../../editor/assets/folders'
import { useAssetStore } from '../../../editor/assets/library'
import { useEditorStore } from '../../../editor/scene/store'
import type { PbrSlot, Vec3 } from '../../../editor/scene/types'
import { UI_LAYERS, UI_NODE_TYPES, type UiDocument, type UiLayer, type UiNode } from '../../../runtime/ui/spec'
import { commandBus } from '../bus'
import type { CommandDef } from '../types'

interface CreateMaterialParams {
  name: string
  color: string
  roughness: number
  metalness: number
  shaderId?: string
  folder?: string
}

const createMaterialCmd: CommandDef<CreateMaterialParams, { assetId: string; name: string; folder: string }> = {
  id: 'asset.createMaterial',
  title: '新建材质资产',
  description: '创建一个新的 PBR 材质资产并加入资产库（可选直接绑定自定义着色器 shaderId 与存放目录 folder）',
  risk: 'safe',
  params: {
    type: 'object',
    fields: {
      name: { type: 'string', minLength: 1, default: '新材质', label: '材质名称' },
      color: { type: 'color', default: '#cccccc', label: '基础颜色' },
      roughness: { type: 'number', default: 0.65, min: 0, max: 1, label: '粗糙度' },
      metalness: { type: 'number', default: 0.04, min: 0, max: 1, label: '金属度' },
      shaderId: { type: 'string', default: '', label: '自定义着色器 ID（可选）', optional: true },
      folder: { type: 'string', default: 'Assets/Materials', label: '存放目录（如 Assets/Materials/Props）', optional: true },
    },
  },
  run(_ctx, p) {
    const assetId = crypto.randomUUID()
    const cleanShaderId = typeof p.shaderId === 'string' ? p.shaderId.trim() : ''
    const targetDir = normalizeDir(p.folder?.trim() || 'Assets/Materials')
    const slot: PbrSlot = {
      name: p.name,
      color: p.color,
      metalness: p.metalness,
      roughness: p.roughness,
      emissive: '#000000',
      emissiveIntensity: 0,
      opacity: 1,
      ao: 1,
      mapAssetId: null,
      normalAssetId: null,
      metallicRoughnessAssetId: null,
      emissiveAssetId: null,
      aoAssetId: null,
      ...(cleanShaderId ? { shader: `custom:${cleanShaderId}` as const } : {}),
    }
    const store = useAssetStore.getState()
    ensureAssetFolderPath(targetDir)
    store.add({
      id: assetId,
      name: p.name,
      kind: 'material',
      slot,
    })
    store.place(assetId, targetDir)
    return {
      ok: true,
      value: { assetId, name: p.name, folder: targetDir },
      changed: { assetsChanged: [assetId], summary: `新建材质资产 ${p.name} (${targetDir})` },
    }
  },
}

interface AssignMaterialParams {
  nodeId: string
  materialId: string
}

const assignMaterialCmd: CommandDef<AssignMaterialParams, { nodeId: string; materialId: string }> = {
  id: 'asset.assignMaterial',
  title: '为节点指派材质',
  risk: 'safe',
  params: {
    type: 'object',
    fields: {
      nodeId: { type: 'ref', target: 'node', required: true, label: '节点 ID' },
      materialId: { type: 'ref', target: 'asset', kinds: ['material'], required: true, label: '材质资产 ID' },
    },
  },
  run(_ctx, p) {
    const state = useEditorStore.getState()
    if (!state.nodes[p.nodeId]) {
      return { ok: false, code: 'node.notFound', message: `节点 "${p.nodeId}" 不存在` }
    }
    const mat = useAssetStore.getState().assets[p.materialId]
    if (!mat || mat.kind !== 'material') {
      return {
        ok: false,
        code: 'asset.notFound',
        message: `材质资产 "${p.materialId}" 不存在`,
        hint: '请用 asset.search 查询 kind=material 的有效资产 ID',
      }
    }
    state.assignMaterial(p.nodeId, p.materialId)
    return {
      ok: true,
      value: { nodeId: p.nodeId, materialId: p.materialId },
      changed: { nodesUpdated: [p.nodeId], summary: `为节点指派材质 ${mat.name}` },
    }
  },
}

interface RenameAssetParams {
  assetId: string
  name: string
}

const renameAssetCmd: CommandDef<RenameAssetParams, { assetId: string; name: string }> = {
  id: 'asset.rename',
  title: '重命名资产',
  risk: 'safe',
  params: {
    type: 'object',
    fields: {
      assetId: { type: 'ref', target: 'asset', required: true, label: '资产 ID' },
      name: { type: 'string', minLength: 1, default: '', label: '新名称' },
    },
  },
  run(_ctx, p) {
    const asset = useAssetStore.getState().assets[p.assetId]
    if (!asset) {
      return { ok: false, code: 'asset.notFound', message: `资产 "${p.assetId}" 不存在` }
    }
    useAssetStore.getState().rename(p.assetId, p.name.trim())
    return {
      ok: true,
      value: { assetId: p.assetId, name: p.name.trim() },
      changed: { assetsChanged: [p.assetId], summary: `重命名资产为 ${p.name.trim()}` },
    }
  },
}

function normalizeUiNode(raw: unknown, depth = 0): UiNode {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const rawType = typeof src.type === 'string' && (UI_NODE_TYPES as readonly string[]).includes(src.type)
    ? (src.type as UiNode['type'])
    : (depth === 0 ? 'panel' : 'text')
  const layoutSrc = src.layout && typeof src.layout === 'object' ? (src.layout as Record<string, unknown>) : {}
  const mode = layoutSrc.mode === 'flex' ? 'flex' : 'anchor'
  const children = Array.isArray(src.children)
    ? src.children.map((c) => normalizeUiNode(c, depth + 1))
    : undefined

  return {
    ...(src as Partial<UiNode>),
    id: typeof src.id === 'string' && src.id.trim() ? src.id : crypto.randomUUID(),
    type: rawType,
    name: typeof src.name === 'string' && src.name.trim() ? src.name : (depth === 0 ? 'Root' : rawType),
    layout: {
      ...(layoutSrc as Partial<NonNullable<UiNode['layout']>>),
      mode,
      ...(depth === 0 && mode === 'anchor' && !layoutSrc.anchorMin && !layoutSrc.anchorMax
        ? { anchorMin: { x: 0, y: 0 }, anchorMax: { x: 1, y: 1 }, pivot: { x: 0, y: 0 }, x: 0, y: 0 }
        : {}),
    },
    ...(children ? { children } : {}),
  }
}

function normalizeUiDocument(raw: unknown): UiDocument {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const rootRaw = src.root && typeof src.root === 'object' ? src.root : src
  return {
    schemaVersion: 1,
    root: normalizeUiNode(rootRaw, 0),
  }
}

interface CreateUiDocParams {
  name: string
  document: Record<string, unknown>
  mountToScene?: boolean
  layer?: UiLayer
  folder?: string
}

const createUiDocCmd: CommandDef<CreateUiDocParams, { assetId: string; name: string; mounted?: boolean; folder: string }> = {
  id: 'ui.createDocument',
  title: '新建界面文档资产',
  description: '创建一个 UiDocument 界面资产（支持可选 mountToScene 挂载到当前场景与存放目录 folder）',
  risk: 'safe',
  params: {
    type: 'object',
    fields: {
      name: { type: 'string', minLength: 1, default: '新界面', label: '界面名称' },
      document: { type: 'object', fields: {}, label: 'UiDocument 数据（含 schemaVersion: 1 和 root 节点树）' },
      mountToScene: { type: 'boolean', default: false, optional: true, label: '立即挂载到场景' },
      layer: {
        type: 'enum',
        options: UI_LAYERS.map((l) => ({ value: l, label: l })),
        default: 'hud',
        optional: true,
        label: '挂载层级',
      },
      folder: { type: 'string', default: 'Assets/UI', optional: true, label: '存放目录（如 Assets/UI/Menus）' },
    },
  },
  run(_ctx, p) {
    const assetId = crypto.randomUUID()
    const doc = normalizeUiDocument(p.document)
    const targetDir = normalizeDir(p.folder?.trim() || 'Assets/UI')
    const store = useAssetStore.getState()
    ensureAssetFolderPath(targetDir)
    store.add({
      id: assetId,
      name: p.name,
      kind: 'ui',
      document: doc,
    })
    store.place(assetId, targetDir)
    if (p.mountToScene) {
      useEditorStore.getState().mountScreen(assetId, [0, 0, 0])
      if (p.layer) {
        const nodes = useEditorStore.getState().nodes
        const screenNode = Object.values(nodes).find((n) => n.kind === 'screen' && n.screen?.documentId === assetId)
        if (screenNode && screenNode.screen) {
          useEditorStore.getState().updateNode(screenNode.id, {
            name: p.name,
            screen: { ...screenNode.screen, layer: p.layer },
          })
        }
      }
    }
    return {
      ok: true,
      value: { assetId, name: p.name, mounted: Boolean(p.mountToScene), folder: targetDir },
      changed: {
        assetsChanged: [assetId],
        summary: `新建界面文档 ${p.name}${p.mountToScene ? ' 并挂载到场景' : ''}`,
      },
    }
  },
}

interface UpdateUiDocParams {
  assetId: string
  name?: string
  document: Record<string, unknown>
}

const updateUiDocCmd: CommandDef<UpdateUiDocParams, { assetId: string; name: string }> = {
  id: 'ui.updateDocument',
  title: '更新界面文档资产',
  description: '更新已有 UiDocument 界面资产的节点树结构或名称',
  risk: 'safe',
  params: {
    type: 'object',
    fields: {
      assetId: { type: 'ref', target: 'asset', kinds: ['ui'], required: true, label: '界面资产 ID' },
      name: { type: 'string', default: '', optional: true, label: '新名称（可选）' },
      document: { type: 'object', fields: {}, label: '更新后的 UiDocument 数据' },
    },
  },
  run(_ctx, p) {
    const store = useAssetStore.getState()
    const asset = store.assets[p.assetId]
    if (!asset || asset.kind !== 'ui') {
      return { ok: false, code: 'asset.notFound', message: `界面资产 "${p.assetId}" 不存在` }
    }
    const nextDoc = normalizeUiDocument(p.document)
    const nextName = p.name && p.name.trim() ? p.name.trim() : asset.name
    store.updateUi(p.assetId, nextDoc)
    if (nextName !== asset.name) {
      store.rename(p.assetId, nextName)
    }
    return {
      ok: true,
      value: { assetId: p.assetId, name: nextName },
      changed: { assetsChanged: [p.assetId], summary: `更新界面文档 ${nextName}` },
    }
  },
}

interface MountScreenParams {
  assetId: string
  point?: Vec3
  layer?: UiLayer
  visibleOnPlay?: boolean
  name?: string
}

const mountScreenCmd: CommandDef<MountScreenParams, { assetId: string; nodeId?: string }> = {
  id: 'ui.mountScreen',
  title: '挂载界面屏幕到场景',
  risk: 'safe',
  params: {
    type: 'object',
    fields: {
      assetId: { type: 'ref', target: 'asset', kinds: ['ui'], required: true, label: '界面资产 ID' },
      point: { type: 'vec3', default: [0, 0, 0], optional: true, label: '放置位置' },
      layer: {
        type: 'enum',
        options: UI_LAYERS.map((l) => ({ value: l, label: l })),
        default: 'hud',
        optional: true,
        label: 'UI 层级',
      },
      visibleOnPlay: { type: 'boolean', default: true, optional: true, label: '试玩时默认显示' },
      name: { type: 'string', default: '', optional: true, label: '屏幕节点名称（可选）' },
    },
  },
  run(_ctx, p) {
    const asset = useAssetStore.getState().assets[p.assetId]
    if (!asset || asset.kind !== 'ui') {
      return { ok: false, code: 'asset.notFound', message: `界面资产 "${p.assetId}" 不存在` }
    }
    const editor = useEditorStore.getState()
    const beforeIds = new Set(Object.keys(editor.nodes))
    editor.mountScreen(p.assetId, p.point ?? [0, 0, 0])
    const afterNodes = useEditorStore.getState().nodes
    const created = Object.values(afterNodes).find((n) => !beforeIds.has(n.id) && n.kind === 'screen')
    if (created && created.screen) {
      useEditorStore.getState().updateNode(created.id, {
        ...(p.name && p.name.trim() ? { name: p.name.trim() } : {}),
        screen: {
          ...created.screen,
          ...(p.layer ? { layer: p.layer } : {}),
          ...(typeof p.visibleOnPlay === 'boolean' ? { visibleOnPlay: p.visibleOnPlay } : {}),
        },
      })
    }
    return {
      ok: true,
      value: { assetId: p.assetId, nodeId: created?.id },
      changed: {
        ...(created ? { nodeIds: [created.id] } : {}),
        summary: `挂载界面 ${asset.name}`,
      },
    }
  },
}

function ensureAssetFolderPath(rawPath: string): string {
  const normalized = normalizeDir(rawPath)
  if (normalized === ASSETS_ROOT) return ASSETS_ROOT
  const parts = normalized.split('/')
  const toAdd: string[] = []
  let cur = parts[0] || ASSETS_ROOT
  for (let i = 1; i < parts.length; i += 1) {
    cur = `${cur}/${parts[i]}`
    toAdd.push(cur)
  }
  const store = useAssetStore.getState()
  const merged = [...new Set([...store.folders.map(normalizeDir), ...toAdd])].filter((f) => f !== ASSETS_ROOT)
  if (merged.length !== store.folders.length) {
    useAssetStore.setState((s) => ({ folders: merged, revision: s.revision + 1 }))
  }
  return normalized
}

interface CreateFolderParams {
  path: string
}

const createFolderCmd: CommandDef<CreateFolderParams, { path: string }> = {
  id: 'asset.createFolder',
  title: '创建资源目录',
  description: '在工程资源库中创建指定路径的目录（自动补全多级父目录，如 Assets/Materials/Enemies）',
  risk: 'safe',
  params: {
    type: 'object',
    fields: {
      path: { type: 'string', minLength: 1, default: 'Assets/Props', label: '目录路径' },
    },
  },
  run(_ctx, p) {
    const dir = ensureAssetFolderPath(p.path)
    return {
      ok: true,
      value: { path: dir },
      changed: { summary: `创建资源目录 ${dir}` },
    }
  },
}

interface MoveToFolderParams {
  assetIds: string[]
  folder: string
}

const moveToFolderCmd: CommandDef<MoveToFolderParams, { folder: string; movedIds: string[] }> = {
  id: 'asset.moveToFolder',
  title: '移动资产到目录',
  description: '将指定的资产批量归类移动到指定资源目录（目录不存在时自动创建）',
  risk: 'safe',
  params: {
    type: 'object',
    fields: {
      assetIds: {
        type: 'list',
        item: { type: 'ref', target: 'asset', label: '资产 ID' },
        label: '资产 ID 列表',
      },
      folder: { type: 'string', minLength: 1, default: 'Assets', label: '目标目录路径' },
    },
  },
  run(_ctx, p) {
    const targetDir = ensureAssetFolderPath(p.folder)
    const store = useAssetStore.getState()
    const movedIds: string[] = []
    for (const id of p.assetIds ?? []) {
      if (store.assets[id]) {
        store.place(id, targetDir)
        movedIds.push(id)
      }
    }
    if (movedIds.length === 0) {
      return { ok: false, code: 'asset.notFound', message: '未找到任何可移动的有效资产 ID' }
    }
    return {
      ok: true,
      value: { folder: targetDir, movedIds },
      changed: { assetsChanged: movedIds, summary: `将 ${movedIds.length} 个资产移入 ${targetDir}` },
    }
  },
}

interface CreatePrefabParams {
  nodeId: string
  name?: string
  folder?: string
}

const createPrefabCmd: CommandDef<CreatePrefabParams, { assetId: string; name: string; folder: string }> = {
  id: 'asset.createPrefab',
  title: '将节点制作成预制体',
  description: '把指定场景节点及其完整子树打包为可复用预制体（Prefab）资产，供运行时 spawnPrefab / pool.acquire 动态实例化',
  risk: 'safe',
  params: {
    type: 'object',
    fields: {
      nodeId: { type: 'ref', target: 'node', required: true, label: '源节点 ID' },
      name: { type: 'string', default: '', label: '预制体名称（可选，默认取节点名）', optional: true },
      folder: { type: 'string', default: 'Assets/Prefabs', label: '存放目录（如 Assets/Prefabs/Enemies）', optional: true },
    },
  },
  run(_ctx, p) {
    const editor = useEditorStore.getState()
    const node = editor.nodes[p.nodeId]
    if (!node) {
      return { ok: false, code: 'node.notFound', message: `节点 "${p.nodeId}" 不存在` }
    }
    if (node.prefabInstanceId === node.id && node.prefabAssetId) {
      const existing = useAssetStore.getState().assets[node.prefabAssetId]
      if (existing) {
        return {
          ok: true,
          value: { assetId: existing.id, name: existing.name, folder: ASSETS_ROOT },
          changed: { summary: `节点已是预制体 "${existing.name}" 的实例` },
        }
      }
    }
    const targetDir = p.folder?.trim() ? ensureAssetFolderPath(p.folder) : ensureAssetFolderPath('Assets/Prefabs')
    const beforeIds = new Set(Object.keys(useAssetStore.getState().assets))
    editor.createPrefabFromSelection(p.name?.trim() || undefined, p.nodeId, targetDir)
    const afterAssets = useAssetStore.getState().assets
    const created = Object.values(afterAssets).find((a) => a.kind === 'prefab' && !beforeIds.has(a.id))
    if (!created) {
      return { ok: false, code: 'prefab.createFailed', message: '创建预制体失败，请确认当前未处于试玩或预制体编辑状态' }
    }
    return {
      ok: true,
      value: { assetId: created.id, name: created.name, folder: targetDir },
      changed: {
        assetsChanged: [created.id],
        nodesChanged: [p.nodeId],
        summary: `已将 "${node.name}" 打包为预制体 "${created.name}"（${targetDir}）`,
      },
    }
  },
}

export function registerAssetAndUiCommands(): () => void {
  const unsubs = [
    commandBus.register(createMaterialCmd),
    commandBus.register(assignMaterialCmd),
    commandBus.register(renameAssetCmd),
    commandBus.register(createFolderCmd),
    commandBus.register(moveToFolderCmd),
    commandBus.register(createPrefabCmd),
    commandBus.register(createUiDocCmd),
    commandBus.register(updateUiDocCmd),
    commandBus.register(mountScreenCmd),
  ]
  return () => unsubs.forEach((fn) => fn())
}
