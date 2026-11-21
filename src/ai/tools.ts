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
import { useCodeAssetStore } from '../core/codeAssets/workspace'
import { createBranch, listBranches, switchBranch } from '../core/project/checkpoints'
import { getInputActionMap, saveProjectInputMap, setInputActionMap, type ActionBinding } from '../core/input/actionMap'
import { captureMainViewport } from '../core/preview/offscreenPreview'
import { projectDirectoryPath } from '../editor/project/disk'
import { useEditorStore } from '../editor/scene/store'
import { exportWebPlayerBundle } from '../player/exporter'
import { useAssetStore } from '../editor/assets/library'
import { PlaytestSession, type SmokeStep } from '../playtest/session'

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
    description: '对当前工程做引用完整性、可玩性、能力包与性能预算体检',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'query__code_assets',
    description: '列出当前工程已编译的脚本与着色器资产（含编译状态与诊断信息）',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'query__ui_inspect',
    description: '读取指定 UI 资产的完整 UiDocument 节点树与绑定/点击事件详情（不传 assetId 则列出全部 UI 资产）',
    parameters: {
      type: 'object',
      properties: {
        assetId: { type: 'string', description: 'UI 资产 ID（可选）' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'playtest__run_smoke',
    description: '启动自动试玩探针，按定步长推进并注入虚拟输入、断言节点/日志状态，输出报错与性能预算报告',
    parameters: {
      type: 'object',
      properties: {
        steps: {
          type: 'array',
          description: '冒烟测试步骤列表（input/step/waitFor/assert/capture）',
          items: { type: 'object' },
        },
        autoStop: { type: 'boolean', description: '完成后是否自动退出试玩，默认 true' },
      },
      required: ['steps'],
      additionalProperties: false,
    },
  },
  {
    name: 'playtest__capture',
    description: '复用主渲染器抓取当前视口截图（PNG DataURL）',
    parameters: {
      type: 'object',
      properties: {
        width: { type: 'number', description: '可选缩放宽度' },
        height: { type: 'number', description: '可选缩放高度' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'input__get_map',
    description: '读取当前工程的动作输入映射表（input.json）',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'input__set_action',
    description: '新增或更新动作输入映射表（input.json）中的动作绑定并落盘',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', description: '动作名，如 Move/Jump/Interact' },
        binding: { type: 'object', description: '动作绑定配置' },
      },
      required: ['action', 'binding'],
      additionalProperties: false,
    },
  },
  {
    name: 'project__export_web',
    description: '将当前工程导出为独立 Web 播放包数据目录（含 project.t3d.json 与 input.json）',
    parameters: {
      type: 'object',
      properties: {
        outputDir: { type: 'string', description: '目标导出目录路径' },
      },
      required: ['outputDir'],
      additionalProperties: false,
    },
  },
  {
    name: 'branch__list',
    description: '列出当前工程的所有实验分支与激活状态',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'branch__create',
    description: '从当前状态或指定快照拉出一条轻量实验分支，用于 A/B 方案试玩对比',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '分支名称，如 方案B-高机动手感' },
        fromCheckpointId: { type: 'string', description: '可选基线快照 ID' },
      },
      required: ['name'],
    },
  },
  {
    name: 'branch__switch',
    description: '切换到指定实验分支以对比或继续编辑',
    parameters: {
      type: 'object',
      properties: {
        branchId: { type: 'string', description: '目标分支 ID（如 main 或 exp_...）' },
      },
      required: ['branchId'],
    },
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
  const resolvedArgs = resolveAiNodeArgs(toolName, args)
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
          typeof resolvedArgs.parentId === 'string' ? resolvedArgs.parentId : null,
          typeof resolvedArgs.depth === 'number' ? resolvedArgs.depth : 3,
        ),
      }
    case 'query__node_inspect': {
      const nodeId = String(resolvedArgs.nodeId ?? '')
      const node = queryNodeInspect(nodeId)
      return {
        ok: Boolean(node),
        toolName,
        displayLabel: `检查节点 ${node?.name ?? nodeId}`,
        targetNodeId: node ? nodeId : undefined,
        data: node ?? {
          ok: false,
          message: `节点 "${nodeId}" 不存在`,
          availableNodes: listCompactNodes(),
        },
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
    case 'query__code_assets': {
      const items = Object.values(useCodeAssetStore.getState().assets).map((item) => ({
        id: item.id,
        kind: item.kind,
        name: item.name,
        relativePath: item.relativePath,
        ok: item.ok,
        diagnostics: item.diagnostics,
      }))
      return {
        ok: true,
        toolName,
        displayLabel: `代码资产列表（${items.length} 个）`,
        data: items,
      }
    }
    case 'query__ui_inspect': {
      const assets = useAssetStore.getState().assets
      const id = typeof resolvedArgs.assetId === 'string' ? resolvedArgs.assetId.trim() : ''
      if (id) {
        const hit = assets[id]
        if (!hit || hit.kind !== 'ui') {
          return {
            ok: false,
            toolName,
            displayLabel: `读取 UI 失败：${id} 不存在`,
            data: { ok: false, message: `UI 资产 "${id}" 不存在` },
          }
        }
        return {
          ok: true,
          toolName,
          displayLabel: `读取 UI 文档 ${hit.name}`,
          data: { id: hit.id, name: hit.name, document: hit.document },
        }
      }
      const list = Object.values(assets)
        .filter((a) => a.kind === 'ui')
        .map((a) => ({ id: a.id, name: a.name }))
      return {
        ok: true,
        toolName,
        displayLabel: `UI 资产列表（${list.length} 个）`,
        data: list,
      }
    }
    case 'playtest__run_smoke': {
      const steps = Array.isArray(args.steps) ? (args.steps as SmokeStep[]) : []
      const session = new PlaytestSession()
      const report = session.runSmoke(steps, {
        autoStop: typeof args.autoStop === 'boolean' ? args.autoStop : true,
      })
      return {
        ok: report.ok,
        toolName,
        displayLabel: `试玩冒烟：${report.ok ? '通过' : '发现问题'}（${report.stepsSimulated} 步 / ${report.elapsedSec}s）`,
        data: report,
      }
    }
    case 'playtest__capture': {
      const dataUrl = captureMainViewport({
        width: typeof args.width === 'number' ? args.width : undefined,
        height: typeof args.height === 'number' ? args.height : undefined,
      })
      return {
        ok: Boolean(dataUrl),
        toolName,
        displayLabel: dataUrl ? '视口截图成功' : '视口未就绪，无法截图',
        data: dataUrl ? { dataUrl } : { error: 'viewport not ready' },
      }
    }
    case 'input__get_map': {
      const map = getInputActionMap()
      return {
        ok: true,
        toolName,
        displayLabel: `读取输入映射（${Object.keys(map.actions).length} 个动作）`,
        data: map,
      }
    }
    case 'input__set_action': {
      const action = String(args.action ?? '').trim()
      if (!action) {
        return { ok: false, toolName, displayLabel: '动作名称不能为空', data: { error: 'empty action' } }
      }
      const prev = getInputActionMap()
      const next = {
        ...prev,
        actions: {
          ...prev.actions,
          [action]: args.binding as ActionBinding,
        },
      }
      setInputActionMap(next)
      const projectPath = projectDirectoryPath()
      if (projectPath) {
        await saveProjectInputMap(projectPath, next)
      }
      return {
        ok: true,
        toolName,
        displayLabel: `更新输入动作：${action}`,
        data: getInputActionMap(),
      }
    }
    case 'project__export_web': {
      const outputDir = String(args.outputDir ?? '').trim()
      const res = await exportWebPlayerBundle(outputDir)
      return {
        ok: res.ok,
        toolName,
        displayLabel: res.message,
        data: res,
      }
    }
    case 'branch__list': {
      const list = listBranches()
      return {
        ok: true,
        toolName,
        displayLabel: `实验分支列表（${list.length} 个）`,
        data: list,
      }
    }
    case 'branch__create': {
      const res = createBranch(String(args.name ?? ''), typeof args.fromCheckpointId === 'string' ? args.fromCheckpointId : undefined)
      return {
        ok: res.ok,
        toolName,
        displayLabel: res.ok ? `已创建分支 ${res.branch?.name}` : `创建分支失败：${res.error}`,
        data: res,
      }
    }
    case 'branch__switch': {
      const res = switchBranch(String(args.branchId ?? ''))
      return {
        ok: res.ok,
        toolName,
        displayLabel: res.ok ? `已切换至分支 ${res.branch?.name}` : `切换分支失败：${res.error}`,
        data: res,
      }
    }
  }

  const commandId = fromToolName(toolName)
  const cmd = commandBus.get(commandId)
  const res = await commandBus.dispatch(commandId, resolvedArgs)
  const targetNodeId = extractTargetNodeId(resolvedArgs, res.ok ? res.value : undefined)
  const summary = res.ok
    ? (res.changed.summary || cmd?.title || commandId)
    : `${cmd?.title ?? commandId} 失败：${res.message}`

  const data = !res.ok && (res.code === 'NOT_FOUND' || res.code === 'node.notFound' || res.message.includes('不存在'))
    ? { ...res, availableNodes: listCompactNodes() }
    : res

  return {
    ok: res.ok,
    toolName,
    displayLabel: summary,
    targetNodeId,
    data,
  }
}

function resolveNodeIdFuzzy(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return raw
  const nodes = useEditorStore.getState().nodes
  if (nodes[trimmed]) return trimmed

  const all = Object.values(nodes)
  // 1. 按节点名称精确匹配（仅当唯一匹配时自动转换）
  const byExactName = all.filter((n) => n.name === trimmed)
  if (byExactName.length === 1) return byExactName[0].id

  // 2. 按 ID 前缀唯一匹配（防止大模型漏写/截断 UUID 尾部）
  if (trimmed.length >= 6) {
    const cleanPrefix = trimmed.replace(/\?+$/g, '').replace(/\.\.\.$/g, '')
    if (cleanPrefix.length >= 6) {
      const byPrefix = all.filter((n) => n.id.startsWith(cleanPrefix))
      if (byPrefix.length === 1) return byPrefix[0].id
    }
  }

  // 3. UUID 局部容错：大模型常在抄写 36 位 UUID 时漏写/错写中间某几位，若首段(前8位)或末段(后12位)唯一匹配则自动纠偏
  const uuidHead = trimmed.match(/^([0-9a-fA-F]{8})-[0-9a-fA-F-]*/)?.[1]
  if (uuidHead) {
    const byHead = all.filter((n) => n.id.toLowerCase().startsWith(uuidHead.toLowerCase() + '-'))
    if (byHead.length === 1) return byHead[0].id
  }
  const uuidTail = trimmed.match(/([0-9a-fA-F]{12})$/)?.[1]
  if (uuidTail) {
    const byTail = all.filter((n) => n.id.toLowerCase().endsWith('-' + uuidTail.toLowerCase()))
    if (byTail.length === 1) return byTail[0].id
  }

  return raw
}

function resolveAiNodeArgs(toolName: string, args: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...args }
  const nodeRefKeys = ['nodeId', 'parentId', 'targetNodeId', 'sourceNodeId']
  for (const key of nodeRefKeys) {
    if (typeof next[key] === 'string' && next[key]) {
      next[key] = resolveNodeIdFuzzy(next[key] as string)
    }
  }
  if (Array.isArray(next.nodeIds)) {
    next.nodeIds = next.nodeIds.map((id) => (typeof id === 'string' ? resolveNodeIdFuzzy(id) : id))
  }

  // 若是挂载脚本，顺便把脚本 params 里声明为 ref(node) 的字段也做名称/前缀容错解析
  if (toolName === 'script__attach' && typeof next.scriptId === 'string' && next.params && typeof next.params === 'object') {
    const scriptId = next.scriptId.replace(/^scripts\//, '').replace(/\.ts$/, '')
    const behavior = useCodeAssetStore.getState().assets[scriptId]?.compiledScript?.behavior
    if (behavior?.params) {
      const resolvedParams = { ...(next.params as Record<string, unknown>) }
      for (const [k, schema] of Object.entries(behavior.params)) {
        if (schema.type === 'ref' && schema.target === 'node' && typeof resolvedParams[k] === 'string') {
          resolvedParams[k] = resolveNodeIdFuzzy(resolvedParams[k] as string)
        }
      }
      next.params = resolvedParams
    }
  }
  return next
}

function listCompactNodes() {
  return Object.values(useEditorStore.getState().nodes)
    .slice(0, 40)
    .map((n) => ({ id: n.id, name: n.name, kind: n.kind }))
}

function extractTargetNodeId(args: Record<string, unknown>, value: unknown): string | undefined {
  if (typeof args.nodeId === 'string' && args.nodeId) return args.nodeId
  if (value && typeof value === 'object' && 'nodeId' in value && typeof (value as { nodeId?: unknown }).nodeId === 'string') {
    return (value as { nodeId: string }).nodeId
  }
  return undefined
}
