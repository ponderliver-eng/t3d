import { useAssetStore } from '../../../editor/assets/library'
import { useEditorStore } from '../../../editor/scene/store'
import type { PbrSlot, Vec3 } from '../../../editor/scene/types'
import type { UiDocument } from '../../../runtime/ui/spec'
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

interface CreateUiDocParams {
  name: string
  document: Record<string, unknown>
}

const createUiDocCmd: CommandDef<CreateUiDocParams, { assetId: string; name: string }> = {
  id: 'ui.createDocument',
  title: '新建界面文档资产',
  description: '创建一个 UiDocument 界面资产',
  risk: 'safe',
  params: {
    type: 'object',
    fields: {
      name: { type: 'string', minLength: 1, default: '新界面', label: '界面名称' },
      document: { type: 'object', fields: {}, label: 'UiDocument 数据' },
    },
  },
  run(_ctx, p) {
    const assetId = crypto.randomUUID()
    useAssetStore.getState().add({
      id: assetId,
      name: p.name,
      kind: 'ui',
      document: p.document as unknown as UiDocument,
    })
    return {
      ok: true,
      value: { assetId, name: p.name },
      changed: { assetsChanged: [assetId], summary: `新建界面文档 ${p.name}` },
    }
  },
}

interface MountScreenParams {
  assetId: string
  point: Vec3
}

const mountScreenCmd: CommandDef<MountScreenParams, { assetId: string }> = {
  id: 'ui.mountScreen',
  title: '挂载界面屏幕到场景',
  risk: 'safe',
  params: {
    type: 'object',
    fields: {
      assetId: { type: 'ref', target: 'asset', kinds: ['ui'], required: true, label: '界面资产 ID' },
      point: { type: 'vec3', default: [0, 0, 0], optional: true, label: '放置位置' },
    },
  },
  run(_ctx, p) {
    const asset = useAssetStore.getState().assets[p.assetId]
    if (!asset || asset.kind !== 'ui') {
      return { ok: false, code: 'asset.notFound', message: `界面资产 "${p.assetId}" 不存在` }
    }
    useEditorStore.getState().mountScreen(p.assetId, p.point ?? [0, 0, 0])
    return {
      ok: true,
      value: { assetId: p.assetId },
      changed: { summary: `挂载界面 ${asset.name}` },
    }
  },
}

export function registerAssetAndUiCommands(): () => void {
  const unsubs = [
    commandBus.register(createMaterialCmd),
    commandBus.register(assignMaterialCmd),
    commandBus.register(renameAssetCmd),
    commandBus.register(createUiDocCmd),
    commandBus.register(mountScreenCmd),
  ]
  return () => unsubs.forEach((fn) => fn())
}
