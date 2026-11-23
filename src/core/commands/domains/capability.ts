import {
  CAPABILITIES,
  capabilityEnabled,
  isKnownCapabilityDataKey,
  knownCapabilityDataKeys,
  syncCapabilityRuntimes,
} from '../../../capabilities/registry'
import { useEditorStore } from '../../../editor/scene/store'
import type { SceneNode } from '../../../editor/scene/types'
import { commandBus } from '../bus'
import type { CommandDef } from '../types'

interface SetCapabilityEnabledParams {
  capabilityId: string
  enabled: boolean
}

const setCapabilityEnabledCmd: CommandDef<SetCapabilityEnabledParams, { capabilityId: string; enabled: boolean }> = {
  id: 'capability.setEnabled',
  title: '开关工程级能力包',
  description: '启用或关闭工程级能力包（如 physics、navigation、water、sky、particles、buoyancy）',
  risk: 'safe',
  params: {
    type: 'object',
    fields: {
      capabilityId: {
        type: 'enum',
        options: CAPABILITIES.map((c) => ({ value: c.id, label: c.id })),
        default: 'water',
        label: '能力包 ID',
      },
      enabled: { type: 'boolean', default: true, label: '是否启用' },
    },
  },
  run(_ctx, p) {
    const state = useEditorStore.getState()
    const nextCaps = { ...state.capabilities, [p.capabilityId]: p.enabled }
    useEditorStore.setState({ capabilities: nextCaps })
    syncCapabilityRuntimes(nextCaps)
    return {
      ok: true,
      value: { capabilityId: p.capabilityId, enabled: capabilityEnabled(nextCaps, p.capabilityId) },
      changed: { projectChanged: true, summary: `${p.enabled ? '启用' : '关闭'}能力包 ${p.capabilityId}` },
    }
  },
}

interface SetNodeCapabilityParams {
  nodeId: string
  capabilityId: string
  patch: Record<string, unknown>
}

const setNodeCapabilityCmd: CommandDef<SetNodeCapabilityParams, { nodeId: string; capabilityId: string }> = {
  id: 'capability.setNodeData',
  title: '设置节点能力包数据',
  description: '修改节点上指定能力包（如 node.capabilities.water）的数据字段',
  risk: 'safe',
  params: {
    type: 'object',
    fields: {
      nodeId: { type: 'ref', target: 'node', required: true, label: '节点 ID' },
      capabilityId: { type: 'string', minLength: 1, default: 'water', label: '能力包 ID' },
      patch: { type: 'object', fields: {}, label: '字段补丁' },
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
    if (!isKnownCapabilityDataKey(p.capabilityId)) {
      return {
        ok: false,
        code: 'capability.unknown',
        message: `"${p.capabilityId}" 不是已登记的能力包，运行时不会读取这份数据`,
        hint: `可用的能力数据槽：${knownCapabilityDataKeys().join(', ')}。角色移动与动画切换不是能力包：用 gameplay.setCoreComponent 挂 character（玩家）或 locomotion（按速度切动画），字段见 registry.describe 的 coreComponents`,
      }
    }
    const prevCaps = (node.capabilities ?? {}) as Record<string, Record<string, unknown> | undefined>
    const prevData = prevCaps[p.capabilityId] ?? {}
    const nextNode: SceneNode = {
      ...node,
      capabilities: {
        ...prevCaps,
        [p.capabilityId]: {
          ...prevData,
          ...p.patch,
        },
      },
    }
    useEditorStore.setState({
      nodes: { ...state.nodes, [p.nodeId]: nextNode },
    })
    return {
      ok: true,
      value: { nodeId: p.nodeId, capabilityId: p.capabilityId },
      changed: { nodesUpdated: [p.nodeId], summary: `更新节点 ${node.name} 的 ${p.capabilityId} 能力` },
    }
  },
}

interface SetPictureCapabilityParams {
  capabilityId: string
  patch: Record<string, unknown>
}

const setPictureCapabilityCmd: CommandDef<SetPictureCapabilityParams, { capabilityId: string }> = {
  id: 'capability.setPictureData',
  title: '设置场景级能力包数据',
  description: '修改场景环境级能力包（如 picture.capabilities.sky）的数据字段',
  risk: 'safe',
  params: {
    type: 'object',
    fields: {
      capabilityId: { type: 'string', minLength: 1, default: 'sky', label: '能力包 ID' },
      patch: { type: 'object', fields: {}, label: '字段补丁' },
    },
  },
  run(_ctx, p) {
    if (!isKnownCapabilityDataKey(p.capabilityId)) {
      return {
        ok: false,
        code: 'capability.unknown',
        message: `"${p.capabilityId}" 不是已登记的能力包，运行时不会读取这份数据`,
        hint: `可用的能力数据槽：${knownCapabilityDataKeys().join(', ')}。角色移动与动画切换不是能力包：用 gameplay.setCoreComponent 挂 character（玩家）或 locomotion（按速度切动画），字段见 registry.describe 的 coreComponents`,
      }
    }
    const state = useEditorStore.getState()
    const prevCaps = (state.picture.capabilities ?? {}) as Record<string, Record<string, unknown> | undefined>
    const prevData = prevCaps[p.capabilityId] ?? {}
    useEditorStore.setState({
      picture: {
        ...state.picture,
        capabilities: {
          ...prevCaps,
          [p.capabilityId]: {
            ...prevData,
            ...p.patch,
          },
        },
      },
    })
    return {
      ok: true,
      value: { capabilityId: p.capabilityId },
      changed: { pictureChanged: true, summary: `更新场景能力 ${p.capabilityId}` },
    }
  },
}

export function registerCapabilityCommands(): () => void {
  const unsubs = [
    commandBus.register(setCapabilityEnabledCmd),
    commandBus.register(setNodeCapabilityCmd),
    commandBus.register(setPictureCapabilityCmd),
  ]
  return () => unsubs.forEach((fn) => fn())
}
