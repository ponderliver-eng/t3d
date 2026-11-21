import { commandBus } from '../core/commands/bus'
import {
  diagnoseProject,
  queryAssetSearch,
  queryDbRows,
  queryNodeInspect,
  queryProjectOverview,
  queryRegistryDescribe,
  querySceneOutline,
} from '../core/query'
import { fieldSchemaToJsonSchema } from '../core/schema/fieldSchema'

export interface AiToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface AiToolExecutionResult {
  ok: boolean
  toolName: string
  displayLabel: string
  targetNodeId?: string
  data: unknown
}

function toToolName(id: string): string {
  return id.replace(/\./g, '__')
}

function fromToolName(name: string): string {
  return name.replace(/__/g, '.')
}

const QUERY_TOOLS: AiToolSpec[] = [
  {
    name: 'query__project_overview',
    description: '获取当前工程概览：场景列表、开启的能力包与玩法包、顶层节点大纲、资产统计与视口性能',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'query__scene_outline',
    description: '查询指定父节点下的场景节点层级树',
    parameters: {
      type: 'object',
      properties: {
        parentId: { type: ['string', 'null'], description: '父节点 ID，null 表示从根级开始' },
        depth: { type: 'number', description: '最大展开深度，默认 3' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'query__node_inspect',
    description: '查看单个节点的完整数据（变换、能力包、玩法组件、只读律令提示）',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: '节点 ID' },
      },
      required: ['nodeId'],
      additionalProperties: false,
    },
  },
  {
    name: 'query__asset_search',
    description: '按关键词与种类搜索工程资产（model/texture/material/ui/prefab/scene/effect/audio）',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词，空字符串表示列出全部' },
        kind: { type: 'string', description: '可选资产种类过滤' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'query__registry_describe',
    description: '查询已登记的能力包、玩法包、组件默认值及可用指令说明',
    parameters: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['capabilities', 'gameplayPacks', 'commands', 'all'],
          description: '查询类别',
        },
        id: { type: 'string', description: '可选：只看指定 ID' },
      },
      required: ['category'],
      additionalProperties: false,
    },
  },
  {
    name: 'query__db_rows',
    description: '查询游戏数据表的行数据',
    parameters: {
      type: 'object',
      properties: {
        tableId: { type: 'string', description: '数据表 ID' },
        limit: { type: 'number', description: '最多返回行数，默认 50' },
      },
      required: ['tableId'],
      additionalProperties: false,
    },
  },
  {
    name: 'query__project_diagnose',
    description: '运行工程体检，检查丢失引用、未启用包、缺少相机/灯光/主角等问题',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
]

export function buildAiToolSpecs(): AiToolSpec[] {
  const commandTools: AiToolSpec[] = commandBus.list().map((cmd) => ({
    name: toToolName(cmd.id),
    description: `${cmd.title}${cmd.description ? `：${cmd.description}` : ''}${cmd.risk === 'confirm' ? '（高风险操作，需谨慎）' : ''}`,
    parameters: fieldSchemaToJsonSchema(cmd.params),
  }))
  return [...QUERY_TOOLS, ...commandTools]
}

export function isConfirmRequiredTool(toolName: string): boolean {
  if (toolName.startsWith('query__')) return false
  const cmd = commandBus.get(fromToolName(toolName))
  return cmd?.risk === 'confirm'
}

export async function executeAiTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<AiToolExecutionResult> {
  switch (toolName) {
    case 'query__project_overview':
      return {
        ok: true,
        toolName,
        displayLabel: '读取工程概览',
        data: queryProjectOverview(),
      }
    case 'query__scene_outline':
      return {
        ok: true,
        toolName,
        displayLabel: '查询场景层级',
        data: querySceneOutline(
          typeof args.parentId === 'string' ? args.parentId : null,
          typeof args.depth === 'number' ? args.depth : 3,
        ),
      }
    case 'query__node_inspect': {
      const nodeId = String(args.nodeId ?? '')
      const node = queryNodeInspect(nodeId)
      return {
        ok: Boolean(node),
        toolName,
        displayLabel: `检查节点 ${node?.name ?? nodeId}`,
        targetNodeId: node ? nodeId : undefined,
        data: node ?? { ok: false, message: `节点 "${nodeId}" 不存在` },
      }
    }
    case 'query__asset_search':
      return {
        ok: true,
        toolName,
        displayLabel: `搜索资产 ${String(args.query ?? '') || '全部'}`,
        data: queryAssetSearch(
          typeof args.query === 'string' ? args.query : '',
          typeof args.kind === 'string' ? args.kind : undefined,
        ),
      }
    case 'query__registry_describe':
      return {
        ok: true,
        toolName,
        displayLabel: `读取登记清单 (${String(args.category ?? 'all')})`,
        data: queryRegistryDescribe(
          (args.category as 'capabilities' | 'gameplayPacks' | 'commands' | 'all') ?? 'all',
          typeof args.id === 'string' ? args.id : undefined,
        ),
      }
    case 'query__db_rows':
      return {
        ok: true,
        toolName,
        displayLabel: `读取数据表 ${String(args.tableId ?? '')}`,
        data: queryDbRows(
          String(args.tableId ?? ''),
          typeof args.limit === 'number' ? args.limit : 50,
        ),
      }
    case 'query__project_diagnose': {
      const report = diagnoseProject()
      return {
        ok: true,
        toolName,
        displayLabel: `工程体检（${report.errorCount} 错误，${report.warningCount} 警告）`,
        data: report,
      }
    }
  }

  const commandId = fromToolName(toolName)
  const cmd = commandBus.get(commandId)
  const res = await commandBus.dispatch(commandId, args)
  const targetNodeId = extractTargetNodeId(args, res.ok ? res.value : undefined)
  const summary = res.ok
    ? (res.changed.summary || cmd?.title || commandId)
    : `${cmd?.title ?? commandId} 失败：${res.message}`

  return {
    ok: res.ok,
    toolName,
    displayLabel: summary,
    targetNodeId,
    data: res,
  }
}

function extractTargetNodeId(args: Record<string, unknown>, value: unknown): string | undefined {
  if (typeof args.nodeId === 'string' && args.nodeId) return args.nodeId
  if (value && typeof value === 'object' && 'nodeId' in value && typeof (value as { nodeId?: unknown }).nodeId === 'string') {
    return (value as { nodeId: string }).nodeId
  }
  return undefined
}
