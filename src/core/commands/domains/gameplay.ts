import { useEditorStore } from '../../../editor/scene/store'
import type { SceneNode } from '../../../editor/scene/types'
import {
  ensureGameDatabase,
  listGameplayPacks,
  resolveEnabledPackIds,
} from '../../../gameplay/registry'
import type { GameDatabaseRow } from '../../../gameplay/types'
import { commandBus } from '../bus'
import type { CommandDef } from '../types'

interface SetPackEnabledParams {
  packId: string
  enabled: boolean
}

const setPackEnabledCmd: CommandDef<SetPackEnabledParams, { enabledPacks: string[] }> = {
  id: 'gameplay.setPackEnabled',
  title: '开关玩法包',
  description: '启用或关闭指定 ID 的领域/专项玩法包',
  risk: 'safe',
  params: {
    type: 'object',
    fields: {
      packId: { type: 'string', minLength: 1, default: '', label: '玩法包 ID' },
      enabled: { type: 'boolean', default: true, label: '是否启用' },
    },
  },
  run(_ctx, p) {
    const known = listGameplayPacks().some((pack) => pack.id === p.packId)
    if (!known) {
      return {
        ok: false,
        code: 'gameplay.packNotFound',
        message: `未找到玩法包 "${p.packId}"`,
        hint: '请调用 registry.describe 查询已注册的玩法包 ID',
      }
    }
    const state = useEditorStore.getState()
    const nextSet = new Set(state.gameplayPacks)
    if (p.enabled) nextSet.add(p.packId)
    else nextSet.delete(p.packId)
    const nextPacks = Array.from(resolveEnabledPackIds(Array.from(nextSet)))
    const nextDb = ensureGameDatabase(state.gameDatabase, nextPacks)
    useEditorStore.setState({ gameplayPacks: nextPacks, gameDatabase: nextDb })
    return {
      ok: true,
      value: { enabledPacks: nextPacks },
      changed: { projectChanged: true, summary: `${p.enabled ? '启用' : '关闭'}玩法包 ${p.packId}` },
    }
  },
}

interface SetComponentDataParams {
  nodeId: string
  packId: string
  componentId: string
  patch: Record<string, unknown>
}

const setComponentDataCmd: CommandDef<SetComponentDataParams, { nodeId: string; packId: string; componentId: string }> = {
  id: 'gameplay.setComponentData',
  title: '设置节点玩法组件数据',
  description: '挂载或更新节点上的玩法包组件数据（如 node.gameplay.packs[packId][componentId]）',
  risk: 'safe',
  params: {
    type: 'object',
    fields: {
      nodeId: { type: 'ref', target: 'node', required: true, label: '节点 ID' },
      packId: { type: 'string', minLength: 1, default: 'core', label: '玩法包 ID' },
      componentId: { type: 'string', minLength: 1, default: '', label: '组件 ID' },
      patch: { type: 'object', fields: {}, optional: true, label: '组件字段补丁（留空则仅挂载默认组件）' },
    },
  },
  run(_ctx, p) {
    const state = useEditorStore.getState()
    const node = state.nodes[p.nodeId]
    if (!node) {
      return { ok: false, code: 'node.notFound', message: `节点 "${p.nodeId}" 不存在` }
    }
    const prevGameplay = node.gameplay ?? {}
    const prevPacks = prevGameplay.packs ?? {}
    const prevPackData = (prevPacks[p.packId] ?? {}) as Record<string, Record<string, unknown> | undefined>
    const prevComp = prevPackData[p.componentId] ?? {}
    const patchObj = p.patch && typeof p.patch === 'object' ? p.patch : {}

    const nextNode: SceneNode = {
      ...node,
      gameplay: {
        ...prevGameplay,
        packs: {
          ...prevPacks,
          [p.packId]: {
            ...prevPackData,
            [p.componentId]: {
              ...prevComp,
              ...patchObj,
            },
          },
        },
      },
    }
    useEditorStore.setState({
      nodes: { ...state.nodes, [p.nodeId]: nextNode },
    })
    return {
      ok: true,
      value: { nodeId: p.nodeId, packId: p.packId, componentId: p.componentId },
      changed: {
        nodesUpdated: [p.nodeId],
        summary: `更新节点 ${node.name} 的玩法组件 ${p.packId}.${p.componentId}`,
      },
    }
  },
}

interface UpsertRowParams {
  tableId: string
  row: Record<string, unknown>
}

const upsertRowCmd: CommandDef<UpsertRowParams, { tableId: string; rowId: string }> = {
  id: 'gameplay.upsertRow',
  title: '新增或更新数据表行',
  description: '向游戏数据表插入或更新一行记录（row 须包含 string 类型的 id）',
  risk: 'safe',
  params: {
    type: 'object',
    fields: {
      tableId: { type: 'string', minLength: 1, default: '', label: '数据表 ID' },
      row: { type: 'object', fields: {}, label: '行数据' },
    },
  },
  run(_ctx, p) {
    const rowId = typeof p.row.id === 'string' && p.row.id.trim() ? p.row.id.trim() : crypto.randomUUID()
    const rowName = typeof p.row.name === 'string' && p.row.name.trim() ? p.row.name.trim() : rowId
    const rowData: GameDatabaseRow = { ...(p.row as unknown as GameDatabaseRow), id: rowId, name: rowName }
    const state = useEditorStore.getState()
    const prevTables = state.gameDatabase.tables ?? {}
    const prevRows = prevTables[p.tableId] ?? []
    const idx = prevRows.findIndex((r) => r.id === rowId)
    const nextRows = idx >= 0
      ? prevRows.map((r, i) => (i === idx ? rowData : r))
      : [...prevRows, rowData]
    useEditorStore.setState({
      gameDatabase: {
        tables: {
          ...prevTables,
          [p.tableId]: nextRows,
        },
      },
    })
    return {
      ok: true,
      value: { tableId: p.tableId, rowId },
      changed: { tablesChanged: [p.tableId], summary: `更新数据表 ${p.tableId} 行 ${rowId}` },
    }
  },
}

interface DeleteRowParams {
  tableId: string
  rowId: string
}

const deleteRowCmd: CommandDef<DeleteRowParams, { tableId: string; rowId: string }> = {
  id: 'gameplay.deleteRow',
  title: '删除数据表行',
  risk: 'confirm',
  params: {
    type: 'object',
    fields: {
      tableId: { type: 'string', minLength: 1, default: '', label: '数据表 ID' },
      rowId: { type: 'string', minLength: 1, default: '', label: '行 ID' },
    },
  },
  run(_ctx, p) {
    const state = useEditorStore.getState()
    const prevRows = state.gameDatabase.tables?.[p.tableId] ?? []
    const nextRows = prevRows.filter((r) => r.id !== p.rowId)
    if (nextRows.length === prevRows.length) {
      return {
        ok: false,
        code: 'db.rowNotFound',
        message: `数据表 "${p.tableId}" 中未找到行 "${p.rowId}"`,
      }
    }
    useEditorStore.setState({
      gameDatabase: {
        tables: {
          ...state.gameDatabase.tables,
          [p.tableId]: nextRows,
        },
      },
    })
    return {
      ok: true,
      value: { tableId: p.tableId, rowId: p.rowId },
      changed: { tablesChanged: [p.tableId], summary: `删除数据表 ${p.tableId} 行 ${p.rowId}` },
    }
  },
}

export function registerGameplayCommands(): () => void {
  const unsubs = [
    commandBus.register(setPackEnabledCmd),
    commandBus.register(setComponentDataCmd),
    commandBus.register(upsertRowCmd),
    commandBus.register(deleteRowCmd),
  ]
  return () => unsubs.forEach((fn) => fn())
}
