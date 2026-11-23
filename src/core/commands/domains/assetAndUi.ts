import { ASSETS_ROOT, normalizeDir } from '../../../editor/assets/folders'
import { createDocumentAsset, readDocumentText, saveDocumentText } from '../../../editor/assets/import'
import { useAssetStore } from '../../../editor/assets/library'
import { useEditorStore } from '../../../editor/scene/store'
import { codeAssetDirKey, useCodeAssetStore } from '../../codeAssets/workspace'
import type { PbrSlot, Vec3 } from '../../../editor/scene/types'
import {
  createUiTemplateDocument,
  UI_LAYERS,
  UI_NODE_TYPES,
  validateUiDocument,
  type UiDocument,
  type UiLayer,
  type UiNode,
  type UiTemplateId,
} from '../../../runtime/ui/spec'
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
    const warnings = validateUiDocument(doc)
    return {
      ok: true,
      value: {
        assetId,
        name: p.name,
        mounted: Boolean(p.mountToScene),
        folder: targetDir,
        ...(warnings.length > 0 ? { warnings } : {}),
      },
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
    const warnings = validateUiDocument(nextDoc)
    return {
      ok: true,
      value: { assetId: p.assetId, name: nextName, ...(warnings.length > 0 ? { warnings } : {}) },
      changed: { assetsChanged: [p.assetId], summary: `更新界面文档 ${nextName}` },
    }
  },
}

interface PatchUiNodeParams {
  assetId: string
  nodeId: string
  patch?: Record<string, unknown>
  appendChildren?: Record<string, unknown>[]
  remove?: boolean
}

function collectUiNodeMatches(node: UiNode, key: string, matches: UiNode[]): void {
  if (node.id === key || node.name === key) matches.push(node)
  if (Array.isArray(node.children)) {
    for (const child of node.children) collectUiNodeMatches(child, key, matches)
  }
}

function cloneAndPatchUiTree(
  node: UiNode,
  targetId: string,
  opts: { patch?: Record<string, unknown>; appendChildren?: UiNode[]; remove?: boolean },
): { node: UiNode | null; changed: boolean } {
  if (node.id === targetId) {
    if (opts.remove) return { node: null, changed: true }
    const p = opts.patch ?? {}
    const next: UiNode = { ...node }
    if (typeof p.name === 'string') next.name = p.name
    if (typeof p.text === 'string') next.text = p.text
    if (typeof p.imageId === 'string') next.imageId = p.imageId
    if (typeof p.visible === 'boolean') next.visible = p.visible
    if (typeof p.enabled === 'boolean') next.enabled = p.enabled
    if (p.style && typeof p.style === 'object') {
      next.style = { ...(node.style ?? {}), ...(p.style as UiNode['style']) }
    }
    if (p.layout && typeof p.layout === 'object') {
      const incoming = p.layout as Partial<NonNullable<UiNode['layout']>>
      next.layout = {
        ...(node.layout ?? {}),
        ...incoming,
        mode: incoming.mode ?? node.layout?.mode ?? 'anchor',
      }
    }
    if (p.stateStyles && typeof p.stateStyles === 'object') {
      next.stateStyles = { ...(node.stateStyles ?? {}), ...(p.stateStyles as UiNode['stateStyles']) }
    }
    if (p.progress && typeof p.progress === 'object') {
      next.progress = { ...(node.progress ?? { min: 0, max: 100, value: 100 }), ...(p.progress as UiNode['progress']) }
    }
    if (Array.isArray(p.bindings)) next.bindings = p.bindings as UiNode['bindings']
    if (p.click !== undefined) next.click = p.click as UiNode['click']
    if (opts.appendChildren && opts.appendChildren.length > 0) {
      next.children = [...(node.children ?? []), ...opts.appendChildren]
    }
    return { node: next, changed: true }
  }

  if (!Array.isArray(node.children) || node.children.length === 0) {
    return { node, changed: false }
  }
  let anyChanged = false
  const nextChildren: UiNode[] = []
  for (const child of node.children) {
    const res = cloneAndPatchUiTree(child, targetId, opts)
    if (res.changed) anyChanged = true
    if (res.node) nextChildren.push(res.node)
  }
  return anyChanged ? { node: { ...node, children: nextChildren }, changed: true } : { node, changed: false }
}

const patchUiNodeCmd: CommandDef<PatchUiNodeParams, { assetId: string; nodeId: string; warnings?: string[] }> = {
  id: 'ui.patchNode',
  title: '局部修改界面节点',
  description: '按 UI 节点 ID（或唯一名称）局部修改文本、样式、布局、绑定、点击事件，或追加/删除子节点，无需整棵重写 UiDocument',
  risk: 'safe',
  params: {
    type: 'object',
    fields: {
      assetId: { type: 'ref', target: 'asset', kinds: ['ui'], required: true, label: '界面资产 ID' },
      nodeId: { type: 'string', default: '', label: '目标 UI 节点 ID 或唯一名称（如 root）' },
      patch: { type: 'object', fields: {}, optional: true, label: '要合并修改的字段（text/style/layout/visible/enabled/bindings/click/progress）' },
      appendChildren: {
        type: 'list',
        item: { type: 'object', fields: {}, label: 'UI 子节点' },
        default: [],
        label: '要追加的子节点列表',
      },
      remove: { type: 'boolean', default: false, optional: true, label: '是否删除该节点（不可删除 root）' },
    },
  },
  run(_ctx, p) {
    const store = useAssetStore.getState()
    const asset = store.assets[p.assetId]
    if (!asset || asset.kind !== 'ui') {
      return { ok: false, code: 'asset.notFound', message: `界面资产 "${p.assetId}" 不存在` }
    }
    const key = String(p.nodeId || '').trim()
    if (!key) {
      return { ok: false, code: 'INVALID_ARGS', message: 'nodeId 不能为空' }
    }
    const matches: UiNode[] = []
    collectUiNodeMatches(asset.document.root, key, matches)
    const exactIdMatch = matches.find((m) => m.id === key)
    const target = exactIdMatch ?? (matches.length === 1 ? matches[0] : null)
    if (!target) {
      return {
        ok: false,
        code: 'NOT_FOUND',
        message: matches.length > 1
          ? `UI 节点名称 "${key}" 匹配到 ${matches.length} 个节点，请改用精确 id`
          : `在界面 "${asset.name}" 中未找到 UI 节点 "${key}"`,
      }
    }
    if (p.remove && target.id === asset.document.root.id) {
      return { ok: false, code: 'INVALID_ARGS', message: '不允许删除 UI 根节点 root' }
    }
    const appended = Array.isArray(p.appendChildren)
      ? p.appendChildren.map((raw) => normalizeUiNode(raw))
      : undefined
    const patched = cloneAndPatchUiTree(asset.document.root, target.id, {
      patch: p.patch,
      appendChildren: appended,
      remove: p.remove,
    })
    if (!patched.changed || !patched.node) {
      return { ok: false, code: 'NOT_FOUND', message: `未能更新 UI 节点 "${key}"` }
    }
    const nextDoc: UiDocument = { schemaVersion: 1, root: patched.node }
    store.updateUi(p.assetId, nextDoc)
    const warnings = validateUiDocument(nextDoc)
    return {
      ok: true,
      value: { assetId: p.assetId, nodeId: target.id, ...(warnings.length > 0 ? { warnings } : {}) },
      changed: { assetsChanged: [p.assetId], summary: `局部修改界面 ${asset.name} 节点 ${target.name ?? target.id}` },
    }
  },
}

interface CreateUiFromTemplateParams {
  template: UiTemplateId
  name?: string
  title?: string
  subtitle?: string
  primaryText?: string
  secondaryText?: string
  primaryMessage?: string
  secondaryMessage?: string
  varKey?: string
  scoreVarKey?: string
  accentColor?: string
  mountToScene?: boolean
  layer?: UiLayer
  folder?: string
}

const createUiFromTemplateCmd: CommandDef<CreateUiFromTemplateParams, { assetId: string; name: string; mounted: boolean; folder: string; document: UiDocument }> = {
  id: 'ui.createFromTemplate',
  title: '从标准模板创建界面',
  description: '基于内置高可读性排版模板（hud / menu / dialog / result）快速创建 UI 界面资产，自动做好安全边距、Flex 对齐、半透明卡片与响应式锚点。推荐优先使用此工具再用 ui.updateDocument 微调。',
  risk: 'safe',
  params: {
    type: 'object',
    fields: {
      template: {
        type: 'enum',
        options: [
          { value: 'hud', label: '游戏内 HUD（血条+计分+底部提示）' },
          { value: 'menu', label: '居中主菜单/暂停菜单' },
          { value: 'dialog', label: '居中弹窗/对话框' },
          { value: 'result', label: '居中结算面板' },
        ],
        default: 'hud',
        label: '模板类型',
      },
      name: { type: 'string', default: '', optional: true, label: '界面名称' },
      title: { type: 'string', default: '', optional: true, label: '主标题' },
      subtitle: { type: 'string', default: '', optional: true, label: '副标题/正文/操作提示' },
      primaryText: { type: 'string', default: '', optional: true, label: '主按钮文字' },
      secondaryText: { type: 'string', default: '', optional: true, label: '次按钮文字' },
      primaryMessage: { type: 'string', default: '', optional: true, label: '主按钮发送消息名' },
      secondaryMessage: { type: 'string', default: '', optional: true, label: '次按钮发送消息名' },
      varKey: { type: 'string', default: 'hp', optional: true, label: 'HUD 进度条绑定变量名' },
      scoreVarKey: { type: 'string', default: 'score', optional: true, label: 'HUD/结算分数绑定变量名' },
      accentColor: { type: 'color', default: '#3b82f6', optional: true, label: '主题强调色' },
      mountToScene: { type: 'boolean', default: true, optional: true, label: '立即挂载到场景' },
      layer: {
        type: 'enum',
        options: UI_LAYERS.map((l) => ({ value: l, label: l })),
        default: 'hud',
        optional: true,
        label: '挂载层级',
      },
      folder: { type: 'string', default: 'Assets/UI', optional: true, label: '存放目录' },
    },
  },
  run(_ctx, p) {
    const assetId = crypto.randomUUID()
    const doc = createUiTemplateDocument(p.template, {
      title: p.title,
      subtitle: p.subtitle,
      primaryText: p.primaryText,
      secondaryText: p.secondaryText,
      primaryMessage: p.primaryMessage,
      secondaryMessage: p.secondaryMessage,
      varKey: p.varKey,
      scoreVarKey: p.scoreVarKey,
      accentColor: p.accentColor,
    })
    const defaultNames: Record<UiTemplateId, string> = {
      hud: '游戏HUD',
      menu: '主菜单',
      dialog: '提示弹窗',
      result: '结算界面',
    }
    const name = p.name?.trim() || defaultNames[p.template] || '新界面'
    const targetDir = normalizeDir(p.folder?.trim() || 'Assets/UI')
    const store = useAssetStore.getState()
    ensureAssetFolderPath(targetDir)
    store.add({
      id: assetId,
      name,
      kind: 'ui',
      document: doc,
    })
    store.place(assetId, targetDir)
    const shouldMount = p.mountToScene ?? true
    if (shouldMount) {
      useEditorStore.getState().mountScreen(assetId, [0, 0, 0])
      const layer = p.layer ?? (p.template === 'hud' ? 'hud' : p.template === 'dialog' ? 'popup' : 'menu')
      const nodes = useEditorStore.getState().nodes
      const screenNode = Object.values(nodes).find((n) => n.kind === 'screen' && n.screen?.documentId === assetId)
      if (screenNode && screenNode.screen) {
        useEditorStore.getState().updateNode(screenNode.id, {
          name,
          screen: { ...screenNode.screen, layer },
        })
      }
    }
    return {
      ok: true,
      value: { assetId, name, mounted: shouldMount, folder: targetDir, document: doc },
      changed: {
        assetsChanged: [assetId],
        summary: `从模板(${p.template})创建界面 ${name}${shouldMount ? ' 并挂载到场景' : ''}`,
      },
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
    const codeAssets = useCodeAssetStore.getState().assets
    const movedIds: string[] = []
    for (const id of p.assetIds ?? []) {
      if (store.assets[id]) {
        store.place(id, targetDir)
        movedIds.push(id)
        continue
      }
      if (id.startsWith('code:script:') || id.startsWith('code:shader:')) {
        const codeId = id.slice(id.lastIndexOf(':') + 1)
        const rec = codeAssets[codeId]
        if (rec) {
          store.place(codeAssetDirKey(rec.kind, rec.id), targetDir)
          movedIds.push(id)
          continue
        }
      }
      if (codeAssets[id]) {
        const rec = codeAssets[id]
        store.place(codeAssetDirKey(rec.kind, rec.id), targetDir)
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

interface CreateDocumentParams {
  fileName: string
  content?: string
  folder?: string
}

const createDocumentCmd: CommandDef<CreateDocumentParams, { assetId: string; name: string; fileName: string; folder: string }> = {
  id: 'asset.createDocument',
  title: '新建文档资产',
  description: '在指定工程目录（folder，默认 Assets/Documents，支持任意子目录）创建可编辑的文本文档（如 .md、.txt、.json、.yaml 等，适合游戏策划案、需求文档、配置说明）',
  risk: 'safe',
  params: {
    type: 'object',
    fields: {
      fileName: { type: 'string', minLength: 1, default: '设计文档.md', label: '文件名（含后缀如 .md / .txt，缺省默认 .md）' },
      content: { type: 'string', default: '', label: '文档正文内容', optional: true },
      folder: { type: 'string', default: 'Assets/Documents', label: '存放目录（如 Assets/Docs/Design）', optional: true },
    },
  },
  async run(_ctx, p) {
    const targetDir = normalizeDir(p.folder?.trim() || 'Assets/Documents')
    ensureAssetFolderPath(targetDir)
    const created = await createDocumentAsset({
      fileName: p.fileName,
      content: typeof p.content === 'string' ? p.content : '',
      dir: targetDir,
    })
    if (!created) {
      return { ok: false, code: 'document.createFailed', message: `创建文档 "${p.fileName}" 失败` }
    }
    return {
      ok: true,
      value: { assetId: created.id, name: created.name, fileName: created.fileName, folder: targetDir },
      changed: {
        assetsChanged: [created.id],
        summary: `在 ${targetDir} 创建文档 ${created.fileName}`,
      },
    }
  },
}

interface UpdateDocumentParams {
  assetId: string
  content: string
}

const updateDocumentCmd: CommandDef<UpdateDocumentParams, { assetId: string; fileName: string }> = {
  id: 'asset.updateDocument',
  title: '更新文档内容',
  description: '覆盖保存工程中已有文本文档资产的内容',
  risk: 'safe',
  params: {
    type: 'object',
    fields: {
      assetId: { type: 'ref', target: 'asset', kinds: ['document'], required: true, label: '文档资产 ID' },
      content: { type: 'string', default: '', label: '新的文档全文内容' },
    },
  },
  async run(_ctx, p) {
    const asset = useAssetStore.getState().assets[p.assetId]
    if (!asset || asset.kind !== 'document') {
      return { ok: false, code: 'asset.notFound', message: `文档资产 "${p.assetId}" 不存在` }
    }
    const ok = await saveDocumentText(p.assetId, p.content)
    if (!ok) {
      return { ok: false, code: 'document.saveFailed', message: `保存文档 "${asset.fileName}" 失败` }
    }
    return {
      ok: true,
      value: { assetId: asset.id, fileName: asset.fileName },
      changed: { assetsChanged: [asset.id], summary: `更新文档 ${asset.fileName}` },
    }
  },
}

interface ReadDocumentParams {
  assetId: string
}

const readDocumentCmd: CommandDef<ReadDocumentParams, { assetId: string; name: string; fileName: string; content: string }> = {
  id: 'asset.readDocument',
  title: '读取文档内容',
  description: '读取工程中已有文本文档资产（.md / .txt / .json 等）的正文内容',
  risk: 'safe',
  mutatesDocument: false,
  params: {
    type: 'object',
    fields: {
      assetId: { type: 'ref', target: 'asset', kinds: ['document'], required: true, label: '文档资产 ID' },
    },
  },
  async run(_ctx, p) {
    const asset = useAssetStore.getState().assets[p.assetId]
    if (!asset || asset.kind !== 'document') {
      return { ok: false, code: 'asset.notFound', message: `文档资产 "${p.assetId}" 不存在` }
    }
    try {
      const content = await readDocumentText(p.assetId)
      return {
        ok: true,
        value: { assetId: asset.id, name: asset.name, fileName: asset.fileName, content },
        changed: { summary: `读取文档 ${asset.fileName}` },
      }
    } catch (err) {
      return {
        ok: false,
        code: 'document.readFailed',
        message: err instanceof Error ? err.message : String(err),
      }
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
    commandBus.register(createDocumentCmd),
    commandBus.register(updateDocumentCmd),
    commandBus.register(readDocumentCmd),
    commandBus.register(createUiDocCmd),
    commandBus.register(createUiFromTemplateCmd),
    commandBus.register(updateUiDocCmd),
    commandBus.register(patchUiNodeCmd),
    commandBus.register(mountScreenCmd),
  ]
  return () => unsubs.forEach((fn) => fn())
}
