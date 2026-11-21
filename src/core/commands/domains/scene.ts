import { makeNode, nextOrder, uniqueName } from '../../../editor/scene/kinds'
import { useEditorStore } from '../../../editor/scene/store'
import { isUnder } from '../../../editor/scene/transform'
import type { NodeKind, SceneNode, Vec3 } from '../../../editor/scene/types'
import { measureGroundSnap } from '../../../editor/scene/viewportBridge'
import { commandBus } from '../bus'
import type { CommandDef } from '../types'

const VALID_KINDS: ReadonlyArray<{ value: NodeKind; label: string }> = [
  { value: 'empty', label: '空节点' },
  { value: 'box', label: '立方体' },
  { value: 'sphere', label: '球体' },
  { value: 'plane', label: '平面' },
  { value: 'cylinder', label: '圆柱' },
  { value: 'capsule', label: '胶囊' },
  { value: 'cone', label: '圆锥' },
  { value: 'model', label: '模型' },
  { value: 'directional-light', label: '方向光' },
  { value: 'point-light', label: '点光源' },
  { value: 'spot-light', label: '聚光灯' },
  { value: 'hemisphere-light', label: '半球光' },
  { value: 'camera', label: '相机' },
  { value: 'effect', label: '特效' },
  { value: 'screen', label: '界面屏幕' },
]

interface CreateNodeParams {
  kind: NodeKind
  name: string
  parentId: string | null
  position: Vec3
  rotation: Vec3
  scale: Vec3
  snapToGround: boolean
}

const createNodeCmd: CommandDef<CreateNodeParams, { nodeId: string; name: string; position: Vec3 }> = {
  id: 'scene.createNode',
  title: '创建场景节点',
  description: '在当前场景中创建一个指定种类的节点，可指定名称、父节点、变换与是否贴地',
  risk: 'safe',
  params: {
    type: 'object',
    fields: {
      kind: { type: 'enum', options: VALID_KINDS, default: 'empty', label: '节点种类' },
      name: { type: 'string', default: '', label: '名称' },
      parentId: { type: 'ref', target: 'node', default: null, label: '父节点 ID' },
      position: { type: 'vec3', default: [0, 0, 0], label: '位置' },
      rotation: { type: 'vec3', default: [0, 0, 0], label: '旋转（弧度）' },
      scale: { type: 'vec3', default: [1, 1, 1], label: '缩放' },
      snapToGround: { type: 'boolean', default: false, label: '创建后贴地放置' },
    },
  },
  run(_ctx, p) {
    const state = useEditorStore.getState()
    if (p.parentId && !state.nodes[p.parentId]) {
      return {
        ok: false,
        code: 'node.notFound',
        message: `父节点 "${p.parentId}" 不存在`,
        hint: '请先查询 scene.outline 获取有效的节点 ID，或传 null 放到场景根级',
      }
    }

    const nextNodes: Record<string, SceneNode> = { ...state.nodes }
    const defaultLabel = VALID_KINDS.find((k) => k.value === p.kind)?.label ?? p.kind
    const baseName = p.name.trim() || defaultLabel
    const baseNode = makeNode({
      id: crypto.randomUUID(),
      kind: p.kind,
      name: uniqueName(nextNodes, baseName),
      parentId: p.parentId,
      order: nextOrder(nextNodes, p.parentId),
      position: [...p.position],
      rotation: [...p.rotation],
      scale: [...p.scale],
    })

    nextNodes[baseNode.id] = baseNode
    useEditorStore.setState({ nodes: nextNodes, selection: [baseNode.id] })

    if (p.snapToGround) {
      const snapped = measureGroundSnap([baseNode.id]).find((item) => item.id === baseNode.id)
      if (snapped) {
        const nextPos: Vec3 = [...snapped.position]
        const afterSnap: Record<string, SceneNode> = {
          ...useEditorStore.getState().nodes,
          [baseNode.id]: {
            ...baseNode,
            position: nextPos,
          },
        }
        useEditorStore.setState({ nodes: afterSnap })
        baseNode.position = nextPos
      }
    }

    return {
      ok: true,
      value: { nodeId: baseNode.id, name: baseNode.name, position: baseNode.position },
      changed: { nodesAdded: [baseNode.id], summary: `创建节点 ${baseNode.name}` },
    }
  },
}

interface DeleteNodesParams {
  nodeIds: string[]
}

const deleteNodesCmd: CommandDef<DeleteNodesParams, { deletedIds: string[] }> = {
  id: 'scene.deleteNodes',
  title: '删除场景节点',
  description: '删除指定节点及其全部子节点',
  risk: 'confirm',
  params: {
    type: 'object',
    fields: {
      nodeIds: {
        type: 'list',
        minItems: 1,
        item: { type: 'ref', target: 'node', required: true, label: '节点 ID' },
        label: '待删除节点 ID 列表',
      },
    },
  },
  run(_ctx, p) {
    const state = useEditorStore.getState()
    const missing = p.nodeIds.filter((id) => !state.nodes[id])
    if (missing.length > 0) {
      return {
        ok: false,
        code: 'node.notFound',
        message: `找不到要删除的节点：${missing.join(', ')}`,
        hint: '请用 scene.outline 核对当前场景中的节点 ID',
      }
    }
    const nextNodes: Record<string, SceneNode> = { ...state.nodes }
    const deleted = new Set<string>()
    const removeSubtree = (id: string) => {
      if (deleted.has(id) || !nextNodes[id]) return
      for (const n of Object.values(nextNodes)) {
        if (n.parentId === id) removeSubtree(n.id)
      }
      deleted.add(id)
      delete nextNodes[id]
    }
    for (const id of p.nodeIds) removeSubtree(id)
    const deletedIds = Array.from(deleted)
    const nextSelection = state.selection.filter((id) => !deleted.has(id))
    useEditorStore.setState({ nodes: nextNodes, selection: nextSelection })
    return {
      ok: true,
      value: { deletedIds },
      changed: { nodesRemoved: deletedIds, summary: `删除 ${deletedIds.length} 个节点` },
    }
  },
}

interface SetTransformParams {
  nodeId: string
  position?: Vec3
  rotation?: Vec3
  scale?: Vec3
  snapToGround?: boolean
}

const setTransformCmd: CommandDef<SetTransformParams, { nodeId: string; position: Vec3; rotation: Vec3; scale: Vec3 }> = {
  id: 'scene.setTransform',
  title: '修改节点变换',
  description: '修改节点的位置、旋转（弧度）或缩放，支持贴地放置',
  risk: 'safe',
  params: {
    type: 'object',
    fields: {
      nodeId: { type: 'ref', target: 'node', required: true, label: '节点 ID' },
      position: { type: 'vec3', default: [0, 0, 0], optional: true, label: '位置' },
      rotation: { type: 'vec3', default: [0, 0, 0], optional: true, label: '旋转（弧度）' },
      scale: { type: 'vec3', default: [1, 1, 1], optional: true, label: '缩放' },
      snapToGround: { type: 'boolean', default: false, optional: true, label: '贴地放置' },
    },
  },
  run(_ctx, p) {
    const state = useEditorStore.getState()
    const node = state.nodes[p.nodeId]
    if (!node) {
      return {
        ok: false,
        code: 'node.notFound',
        message: `节点 "${p.nodeId}" 不存在`,
        hint: '请通过 scene.outline 获取有效的节点 ID',
      }
    }
    const nextNode: SceneNode = {
      ...node,
      position: p.position ? [...p.position] : [...node.position],
      rotation: p.rotation ? [...p.rotation] : [...node.rotation],
      scale: p.scale ? [...p.scale] : [...node.scale],
    }
    useEditorStore.setState({
      nodes: { ...state.nodes, [p.nodeId]: nextNode },
    })

    if (p.snapToGround) {
      const snapped = measureGroundSnap([p.nodeId]).find((item) => item.id === p.nodeId)
      if (snapped) {
        nextNode.position = [...snapped.position]
        useEditorStore.setState({
          nodes: { ...useEditorStore.getState().nodes, [p.nodeId]: { ...nextNode } },
        })
      }
    }

    return {
      ok: true,
      value: {
        nodeId: p.nodeId,
        position: nextNode.position,
        rotation: nextNode.rotation,
        scale: nextNode.scale,
      },
      changed: { nodesUpdated: [p.nodeId], summary: `更新变换 ${nextNode.name}` },
    }
  },
}

interface RenameNodeParams {
  nodeId: string
  name: string
}

const renameNodeCmd: CommandDef<RenameNodeParams, { nodeId: string; name: string }> = {
  id: 'scene.renameNode',
  title: '重命名节点',
  risk: 'safe',
  params: {
    type: 'object',
    fields: {
      nodeId: { type: 'ref', target: 'node', required: true, label: '节点 ID' },
      name: { type: 'string', default: '', minLength: 1, label: '新名称' },
    },
  },
  run(_ctx, p) {
    const state = useEditorStore.getState()
    const node = state.nodes[p.nodeId]
    if (!node) {
      return { ok: false, code: 'node.notFound', message: `节点 "${p.nodeId}" 不存在` }
    }
    const nextName = p.name.trim()
    if (!nextName) {
      return { ok: false, code: 'params.invalid', message: '节点名称不能为空白' }
    }
    useEditorStore.setState({
      nodes: { ...state.nodes, [p.nodeId]: { ...node, name: nextName } },
    })
    return {
      ok: true,
      value: { nodeId: p.nodeId, name: nextName },
      changed: { nodesUpdated: [p.nodeId], summary: `重命名节点为 ${nextName}` },
    }
  },
}

interface ReparentNodeParams {
  nodeId: string
  parentId: string | null
}

const reparentNodeCmd: CommandDef<ReparentNodeParams, { nodeId: string; parentId: string | null }> = {
  id: 'scene.reparentNode',
  title: '调整节点父子关系',
  risk: 'safe',
  params: {
    type: 'object',
    fields: {
      nodeId: { type: 'ref', target: 'node', required: true, label: '节点 ID' },
      parentId: { type: 'ref', target: 'node', default: null, label: '新父节点 ID（null 表示根级）' },
    },
  },
  run(_ctx, p) {
    const state = useEditorStore.getState()
    const node = state.nodes[p.nodeId]
    if (!node) {
      return { ok: false, code: 'node.notFound', message: `节点 "${p.nodeId}" 不存在` }
    }
    if (p.parentId && !state.nodes[p.parentId]) {
      return { ok: false, code: 'node.notFound', message: `目标父节点 "${p.parentId}" 不存在` }
    }
    if (p.parentId && (p.parentId === p.nodeId || isUnder(state.nodes, p.parentId, p.nodeId))) {
      return {
        ok: false,
        code: 'scene.cycleParent',
        message: '不能将节点设为自身或其子节点的子节点',
        hint: '请选择其它父节点或传 null 放到场景根级',
      }
    }
    const order = nextOrder(state.nodes, p.parentId)
    useEditorStore.setState({
      nodes: {
        ...state.nodes,
        [p.nodeId]: { ...node, parentId: p.parentId, order },
      },
    })
    return {
      ok: true,
      value: { nodeId: p.nodeId, parentId: p.parentId },
      changed: { nodesUpdated: [p.nodeId], summary: `移动节点 ${node.name} 的父节点` },
    }
  },
}

export function registerSceneCommands(): () => void {
  const unsubs = [
    commandBus.register(createNodeCmd),
    commandBus.register(deleteNodesCmd),
    commandBus.register(setTransformCmd),
    commandBus.register(renameNodeCmd),
    commandBus.register(reparentNodeCmd),
  ]
  return () => unsubs.forEach((fn) => fn())
}
