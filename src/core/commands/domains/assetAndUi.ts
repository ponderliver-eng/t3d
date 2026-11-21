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
}

const createMaterialCmd: CommandDef<CreateMaterialParams, { assetId: string; name: string }> = {
  id: 'asset.createMaterial',
  title: '新建材质资产',
  description: '创建一个新的 PBR 材质资产并加入资产库（可选直接绑定自定义着色器 shaderId）',
  risk: 'safe',
  params: {
    type: 'object',
    fields: {
      name: { type: 'string', minLength: 1, default: '新材质', label: '材质名称' },
      color: { type: 'color', default: '#cccccc', label: '基础颜色' },
      roughness: { type: 'number', default: 0.65, min: 0, max: 1, label: '粗糙度' },
      metalness: { type: 'number', default: 0.04, min: 0, max: 1, label: '金属度' },
      shaderId: { type: 'string', default: '', label: '自定义着色器 ID（可选）', optional: true },
    },
  },
  run(_ctx, p) {
    const assetId = crypto.randomUUID()
    const cleanShaderId = typeof p.shaderId === 'string' ? p.shaderId.trim() : ''
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
    useAssetStore.getState().add({
      id: assetId,
      name: p.name,
      kind: 'material',
      slot,
    })
    return {
      ok: true,
      value: { assetId, name: p.name },
      changed: { assetsChanged: [assetId], summary: `新建材质资产 ${p.name}` },
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
}

const createUiDocCmd: CommandDef<CreateUiDocParams, { assetId: string; name: string; mounted?: boolean }> = {
  id: 'ui.createDocument',
  title: '新建界面文档资产',
  description: '创建一个 UiDocument 界面资产（支持可选 mountToScene 直接挂载到当前场景）',
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
    },
  },
  run(_ctx, p) {
    const assetId = crypto.randomUUID()
    const doc = normalizeUiDocument(p.document)
    useAssetStore.getState().add({
      id: assetId,
      name: p.name,
      kind: 'ui',
      document: doc,
    })
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
      value: { assetId, name: p.name, mounted: Boolean(p.mountToScene) },
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

export function registerAssetAndUiCommands(): () => void {
  const unsubs = [
    commandBus.register(createMaterialCmd),
    commandBus.register(assignMaterialCmd),
    commandBus.register(renameAssetCmd),
    commandBus.register(createUiDocCmd),
    commandBus.register(updateUiDocCmd),
    commandBus.register(mountScreenCmd),
  ]
  return () => unsubs.forEach((fn) => fn())
}
