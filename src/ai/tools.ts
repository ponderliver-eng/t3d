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
import { normalizeCodeAssetId, useCodeAssetStore, type CodeAssetKind } from '../core/codeAssets/workspace'
import { createBranch, listBranches, switchBranch } from '../core/project/checkpoints'
import { getInputActionMap, saveProjectInputMap, setInputActionMap, type ActionBinding } from '../core/input/actionMap'
import { captureViewportComposite } from '../core/preview/offscreenPreview'
import { projectDirectoryPath } from '../editor/project/disk'
import { useEditorStore } from '../editor/scene/store'
import { exportWebPlayerBundle } from '../player/exporter'
import { useAssetStore } from '../editor/assets/library'
import {
  PlaytestSession,
  captureLogCursor,
  readLogsSince,
  summarizeInfoLogs,
  summarizeRuntimeLogs,
  type PlaytestNodePose,
  type SmokeStep,
} from '../playtest/session'
import { readScriptStateSnapshot } from '../core/codeAssets/scriptRuntime'
import { measureRenderBreakdown } from './renderBreakdown'
import { measureUiLayout, type UiLayoutEntry } from './uiLayout'
import { findRecipe, listRecipeIndex } from './knowledge/recipes'

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
  targetAssetId?: string
  data: unknown
}

export interface AiTaskPlanItem {
  id: string
  title: string
  status: 'pending' | 'in_progress' | 'done'
}

let taskPlanUpdater: ((tasks: AiTaskPlanItem[]) => void) | null = null

export function registerTaskPlanUpdater(fn: (tasks: AiTaskPlanItem[]) => void): void {
  taskPlanUpdater = fn
}

function toToolName(id: string): string {
  return id.replace(/\./g, '__')
}

function fromToolName(name: string): string {
  return name.replace(/__/g, '.')
}

const QUERY_TOOLS: AiToolSpec[] = [
  {
    name: 'plan__set_tasks',
    description: '为多步骤长任务规划或更新阶段性子任务清单（最多 8 项），每完成一阶段调用此工具更新状态，界面会同步显示进度',
    parameters: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: '简短唯一标识，如 t1' },
              title: { type: 'string', description: '子任务标题（简短中文）' },
              status: { type: 'string', enum: ['pending', 'in_progress', 'done'], description: '当前状态' },
            },
            required: ['id', 'title', 'status'],
            additionalProperties: false,
          },
          description: '完整任务列表',
        },
      },
      required: ['tasks'],
      additionalProperties: false,
    },
  },
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
    description: '查看单个节点的完整数据（变换、能力包、内置组件、脚本挂载、动画槽位）。drivers 字段标明每个数据槽在试玩中是否真的被运行时驱动；试玩/暂停期间额外返回 runtime（实时位置、朝向、可见性与各脚本的 self.state 快照）',
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
    description: '按关键词、种类（model/texture/material/ui/prefab/scene/effect/audio/script/shader）与所在目录搜索工程资产',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词，空字符串表示列出全部' },
        kind: { type: 'string', description: '可选资产种类过滤（含 script / shader）' },
        folder: { type: 'string', description: '可选目录过滤（如 Assets/Scripts 或 Assets/Materials）' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'query__registry_describe',
    description: '查询已登记的能力包、玩法包组件、引擎内置组件（coreComponents：character 角色控制器 / cameraFollow / interact / trigger / mover / checkpoint / score / soundSource 的字段、默认值与说明，以及节点动画槽位说明）及可用指令说明',
    parameters: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['capabilities', 'gameplayPacks', 'coreComponents', 'commands', 'all'],
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
    description: '对当前工程做引用完整性、可玩性、能力包与性能预算体检；renderBreakdown 按节点列出三角面与网格批次最多的前几名，用于定位性能超标的来源',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'query__code_assets',
    description: '列出当前工程的脚本与着色器资产（编译状态、诊断信息），并反查每个脚本挂在哪些节点上（attachedTo）；没有任何节点挂载的行为脚本标记 orphan: true',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'script__read',
    description: '读取指定脚本资产的当前完整源码与编译诊断。修改已有脚本前必须先读取，script__patch 的 find 片段要与这里返回的源码逐字一致',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '脚本 ID（即文件名，不含 .ts）' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'shader__read',
    description: '读取指定着色器资产的当前完整源码与编译诊断',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '着色器 ID（即文件名，不含 .shader.ts）' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'kb__read',
    description: '读取一份经过验证的范例（可运行的完整脚本源码 + 场景搭建与挂载说明）。范例目录见系统提示的「范例库」。实现同类玩法时先读范例再改写，不要从零摸索',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '范例 ID，如 third-person-controller' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'query__ui_inspect',
    description: '读取指定 UI 资产的完整 UiDocument 节点树与绑定/点击事件详情（不传 assetId 则列出全部 UI 资产）。界面正在渲染时（试玩中或在 UI 编辑器打开）额外返回 layout：每个节点计算后的实际矩形，以及超出父容器/界面边界、文字溢出等问题',
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
    description:
      '确定性自动试玩：按固定步长推进游戏、注入虚拟输入、断言节点/变量/日志状态，返回运行时报错（已去重）、脚本 self.log 输出的日志（logs）、断言结果与性能预算。验收玩法逻辑的首选方式（比截图更可靠也更快），结束后自动退出试玩。需要观察过程而不只是结果时，用 watchNodes + sampleEvery 拿运动轨迹，或在脚本里临时 self.log 关键变量后从 logs 读回，不要新建探测脚本。',
    parameters: {
      type: 'object',
      properties: {
        steps: {
          type: 'array',
          description:
            '按顺序执行的步骤。示例：[{"action":"input","events":[{"type":"axis","action":"Move","x":0,"y":1}]},{"action":"step","seconds":1},{"action":"assert","condition":{"kind":"nodeMoved","nodeIdOrName":"Player","from":[0,0,0],"minDistance":0.5}}]',
          items: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: ['input', 'uiClick', 'step', 'waitFor', 'assert', 'capture'],
                description: 'input 注入输入 / uiClick 点击按钮 / step 推进时间 / waitFor 等待条件成立 / assert 立即断言 / capture 截图',
              },
              events: {
                type: 'array',
                description:
                  'action=input 时：虚拟输入事件，持续生效直到被覆盖或 clear。{type:"axis",action:"Move",x,y} / {type:"actionDown"|"actionUp",action:"Jump"} / {type:"keyDown"|"keyUp",code:"KeyW"} / {type:"clear"}',
                items: { type: 'object' },
              },
              target: { type: 'string', description: 'action=uiClick 时：按钮名称 / 文本 / 发送的消息名' },
              seconds: { type: 'number', description: 'action=step 时：推进的游戏秒数' },
              timeoutSec: { type: 'number', description: 'action=waitFor 时：最长等待的游戏秒数，默认 5' },
              condition: {
                type: 'object',
                description:
                  'action=waitFor/assert 时的条件：{kind:"nodeMoved",nodeIdOrName,from:[x,y,z],minDistance} / {kind:"nodeExists"|"nodeMissing",nodeIdOrName} / {kind:"uiVarEquals",name,value} / {kind:"logContains",text} / {kind:"nodeCountAtLeast",min} / {kind:"elapsed",seconds}',
              },
              message: { type: 'string', description: 'action=assert 时：断言说明' },
            },
            required: ['action'],
          },
        },
        watchNodes: {
          type: 'array',
          items: { type: 'string' },
          description: '可选：结束时回报这些节点（名称或 ID）的实时位置、朝向（rotation 度，[1] 为 yaw）、可见性，以及其上各脚本的 self.state 快照（scriptState），用于确认角色/敌人是否按预期运动、内部变量是否正确',
        },
        sampleEvery: { type: 'number', description: '可选：配合 watchNodes，每隔这么多游戏秒采样一次位置与 yaw，返回 trajectory 轨迹数组（如 0.25；最多保留 60 个采样点）' },
        autoStop: { type: 'boolean', description: '完成后是否自动退出试玩，默认 true' },
      },
      required: ['steps'],
      additionalProperties: false,
    },
  },
  {
    name: 'viewport__capture',
    description: '抓取当前视口截图（含 3D 场景与叠加 UI 界面），用于检查构图、朝向与 UI 排版。若传入 playSeconds（如 0.8），会自动启动试玩运行指定秒数后截图并自动退出试玩，同时返回这段时间内的运行时报错、警告、脚本日志，以及已挂载界面的布局问题（uiLayoutIssues：超出父容器/屏幕、文字溢出）。',
    parameters: {
      type: 'object',
      properties: {
        width: { type: 'number', description: '可选最大宽度（默认 960）' },
        height: { type: 'number', description: '可选缩放高度' },
        playSeconds: { type: 'number', description: '可选：自动开启试玩并运行指定秒数（如 0.5~2.0）后再截图' },
        keepPlaying: { type: 'boolean', description: '可选：截图后是否保持试玩状态（默认 false，自动恢复编辑态以便继续修改工程）' },
        watchNodes: { type: 'array', items: { type: 'string' }, description: '可选：同时回报这些节点（名称或 ID）的实时位置、朝向、可见性与脚本 self.state 快照' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'playtest__control',
    description: '控制编辑器实时试玩状态（开始试玩 play / 暂停 pause / 停止并还原 stop），可配合 waitSeconds 等待；返回自开始试玩以来的运行时报错、警告与脚本日志。试玩与暂停期间工程都是锁定的，修改脚本/节点前必须先 stop。一般验收请直接用 playtest__run_smoke 或 viewport__capture({ playSeconds })，无需手动控制',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['play', 'pause', 'stop'], description: '控制动作' },
        waitSeconds: { type: 'number', description: '可选：执行后等待的真实秒数（如 0.5）' },
        watchNodes: { type: 'array', items: { type: 'string' }, description: '可选：回报这些节点（名称或 ID）此刻的实时位置、朝向与脚本 self.state 快照' },
      },
      required: ['action'],
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
  // 工具全集常驻且顺序稳定：工具定义位于提示缓存前缀内，中途增删会让整段缓存失效
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
  try {
    return await executeAiToolInner(toolName, args)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`[AI Tool] ${toolName} threw:`, error)
    return {
      ok: false,
      toolName,
      displayLabel: `${toolName} 执行异常：${msg}`,
      data: { ok: false, error: msg },
    }
  }
}

async function executeAiToolInner(
  toolName: string,
  args: Record<string, unknown>,
): Promise<AiToolExecutionResult> {
  const resolvedArgs = resolveAiNodeArgs(toolName, args)
  switch (toolName) {
    case 'plan__set_tasks': {
      const raw = Array.isArray(resolvedArgs.tasks) ? resolvedArgs.tasks : []
      const normalized: AiTaskPlanItem[] = raw
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
        .slice(0, 12)
        .map((item, idx) => ({
          id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `t${idx + 1}`,
          title: typeof item.title === 'string' && item.title.trim() ? item.title.trim() : `步骤 ${idx + 1}`,
          status: item.status === 'done' || item.status === 'in_progress' ? item.status : 'pending',
        }))
      taskPlanUpdater?.(normalized)
      const doneCount = normalized.filter((t) => t.status === 'done').length
      return {
        ok: true,
        toolName,
        displayLabel: `更新任务进度 (${doneCount}/${normalized.length})`,
        data: { ok: true, tasks: normalized, doneCount, total: normalized.length },
      }
    }
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
      const playState = useEditorStore.getState().playState
      const runtime = node && playState !== 'stopped' ? readWatchedNodes(new PlaytestSession(), [nodeId])?.[0] : null
      return {
        ok: Boolean(node),
        toolName,
        displayLabel: `检查节点 ${node?.name ?? nodeId}`,
        targetNodeId: node ? nodeId : undefined,
        data: node
          ? runtime?.found
            ? {
                ...node,
                runtime: {
                  playState,
                  note: 'transform 是编辑态数据；试玩中的实时状态以 runtime 为准',
                  position: runtime.position,
                  rotation: runtime.rotation,
                  visible: runtime.visible,
                  ...(runtime.scriptState ? { scriptState: runtime.scriptState } : {}),
                },
              }
            : node
          : {
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
          typeof args.folder === 'string' ? args.folder : undefined,
        ),
      }
    case 'query__registry_describe':
      return {
        ok: true,
        toolName,
        displayLabel: `读取登记清单 (${String(args.category ?? 'all')})`,
        data: queryRegistryDescribe(
          (args.category as 'capabilities' | 'gameplayPacks' | 'coreComponents' | 'commands' | 'all') ?? 'all',
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
      const breakdown = measureRenderBreakdown(8)
      return {
        ok: true,
        toolName,
        displayLabel: `工程体检（${report.errorCount} 错误，${report.warningCount} 警告）`,
        data: breakdown && breakdown.top.length > 0
          ? {
              ...report,
              renderBreakdown: {
                note: '按节点统计的三角面与网格批次（子节点单独计）；总 DrawCall 还包含阴影等额外通道',
                totalTriangles: breakdown.totalTriangles,
                totalMeshDraws: breakdown.totalMeshDraws,
                topNodes: breakdown.top,
              },
            }
          : report,
      }
    }
    case 'query__code_assets': {
      const assetDirs = useAssetStore.getState().assetDirs
      const usage = new Map<string, Array<{ id: string; name: string; enabled: boolean }>>()
      for (const node of Object.values(useEditorStore.getState().nodes)) {
        const bag = node.gameplay?.packs?.__project__ as Record<string, unknown> | undefined
        if (!bag || typeof bag !== 'object') continue
        for (const [scriptId, params] of Object.entries(bag)) {
          const enabled = !(params && typeof params === 'object' && (params as Record<string, unknown>).__enabled === false)
          const list = usage.get(scriptId) ?? []
          list.push({ id: node.id, name: node.name, enabled })
          usage.set(scriptId, list)
        }
      }
      const items = Object.values(useCodeAssetStore.getState().assets).map((item) => {
        const attached = usage.get(item.id) ?? []
        const isSystem = item.kind === 'script' && item.compiledScript?.kind === 'system'
        const dirKey = `code:${item.kind}:${item.id}`
        const folder = assetDirs[dirKey]
          ?? (item.relativePath.startsWith('Assets/') && item.relativePath.includes('/')
            ? item.relativePath.slice(0, item.relativePath.lastIndexOf('/'))
            : item.kind === 'shader' ? 'Assets/Shaders' : 'Assets/Scripts')
        return {
          id: item.id,
          kind: item.kind,
          name: item.name,
          folder,
          relativePath: item.relativePath,
          ok: item.ok,
          diagnostics: item.diagnostics,
          ...(item.kind === 'script'
            ? isSystem
              ? { scriptKind: 'system', note: '全局系统脚本，无需挂载到节点' }
              : {
                  scriptKind: 'behavior',
                  attachedTo: attached.slice(0, 20),
                  ...(attached.length > 20 ? { attachedCount: attached.length } : {}),
                  ...(attached.length === 0 ? { orphan: true } : {}),
                }
            : {}),
        }
      })
      const orphanCount = items.filter((item) => 'orphan' in item && item.orphan).length
      return {
        ok: true,
        toolName,
        displayLabel: `代码资产列表（${items.length} 个${orphanCount > 0 ? `，${orphanCount} 个未挂载` : ''}）`,
        data: items,
      }
    }
    case 'query__ui_inspect': {
      const assets = useAssetStore.getState().assets
      const id = typeof resolvedArgs.assetId === 'string' ? resolvedArgs.assetId.trim() : ''
      if (id) {
        const hit = assets[id]
        if (!hit || hit.kind !== 'ui') {
          const availableUiAssets = Object.values(assets)
            .filter((a) => a.kind === 'ui')
            .map((a) => ({ id: a.id, name: a.name }))
          return {
            ok: false,
            toolName,
            displayLabel: `读取 UI 失败：${id} 不存在`,
            data: {
              ok: false,
              message: `UI 资产 "${id}" 不存在（注意：screen 节点 ID 不是 UI 资产 ID，请使用 availableUiAssets 中的 id 或不传 assetId 列出全部）`,
              availableUiAssets,
            },
          }
        }
        return {
          ok: true,
          toolName,
          displayLabel: `读取 UI 文档 ${hit.name}`,
          data: {
            id: hit.id,
            name: hit.name,
            document: hit.document,
            layout: hit.document?.root ? measureUiLayout(hit.document.root) : { rendered: false },
          },
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
    case 'script__read':
    case 'shader__read': {
      const kind: CodeAssetKind = toolName === 'shader__read' ? 'shader' : 'script'
      const rawId = typeof resolvedArgs.id === 'string' ? resolvedArgs.id.trim() : ''
      const all = useCodeAssetStore.getState().assets
      const record = rawId
        ? all[rawId] ?? all[normalizeCodeAssetId(kind, rawId)] ?? Object.values(all).find((a) => a.kind === kind && a.name === rawId)
        : undefined
      if (!record || record.kind !== kind) {
        return {
          ok: false,
          toolName,
          displayLabel: `读取${kind === 'shader' ? '着色器' : '脚本'}失败：${rawId || '(空)'} 不存在`,
          data: {
            ok: false,
            message: `${kind === 'shader' ? '着色器' : '脚本'} "${rawId}" 不存在`,
            available: Object.values(all).filter((a) => a.kind === kind).map((a) => ({ id: a.id, name: a.name })),
          },
        }
      }
      return {
        ok: true,
        toolName,
        displayLabel: `读取${kind === 'shader' ? '着色器' : '脚本'} ${record.relativePath}`,
        targetAssetId: `code:${kind}:${record.id}`,
        data: {
          id: record.id,
          name: record.name,
          relativePath: record.relativePath,
          compiled: record.ok,
          diagnostics: record.diagnostics,
          lineCount: record.source.split('\n').length,
          source: record.source,
        },
      }
    }
    case 'kb__read': {
      const id = typeof args.id === 'string' ? args.id.trim() : ''
      const recipe = findRecipe(id)
      if (!recipe) {
        return {
          ok: false,
          toolName,
          displayLabel: `范例 ${id || '(空)'} 不存在`,
          data: { ok: false, message: `范例 "${id}" 不存在`, available: listRecipeIndex() },
        }
      }
      return {
        ok: true,
        toolName,
        displayLabel: `查阅范例：${recipe.title}`,
        data: recipe,
      }
    }
    case 'playtest__run_smoke': {
      const steps = Array.isArray(args.steps) ? (args.steps as SmokeStep[]) : []
      const session = new PlaytestSession()
      const autoStop = typeof args.autoStop === 'boolean' ? args.autoStop : true
      // 先不自动停止：需要在仍处于试玩态时读取被观察节点的实时位置
      const watchList = Array.isArray(args.watchNodes)
        ? args.watchNodes.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).slice(0, 12)
        : []
      const sampleEvery = typeof args.sampleEvery === 'number' && args.sampleEvery > 0 ? Math.max(0.05, args.sampleEvery) : 0
      const trajectory: Array<{ t: number; nodes: Record<string, { pos: [number, number, number]; yaw: number } | null> }> = []
      if (sampleEvery > 0 && watchList.length > 0) {
        session.setSampler(sampleEvery, (t) => {
          const nodes: Record<string, { pos: [number, number, number]; yaw: number } | null> = {}
          for (const query of watchList) {
            const pose = session.read({ kind: 'nodePose', nodeIdOrName: query.trim() }) as PlaytestNodePose | null
            nodes[query] = pose
              ? {
                  pos: pose.position.map((v) => Number(v.toFixed(2))) as [number, number, number],
                  yaw: Number(pose.rotation[1].toFixed(1)),
                }
              : null
          }
          trajectory.push({ t, nodes })
        })
      }
      const report = session.runSmoke(steps, { autoStop: false })
      const watched = readWatchedNodes(session, watchList)
      if (autoStop) session.stop()
      // 采样点过多时等间隔抽稀，始终保留首尾
      const MAX_SAMPLES = 60
      const thinned = trajectory.length > MAX_SAMPLES
        ? Array.from({ length: MAX_SAMPLES }, (_, i) => trajectory[Math.round((i * (trajectory.length - 1)) / (MAX_SAMPLES - 1))])
        : trajectory
      const logSummary = summarizeRuntimeLogs([
        ...report.errors.map((message) => ({ level: 'error', message })),
        ...report.warnings.map((message) => ({ level: 'warn', message })),
      ])
      const failedAssertion = report.assertions.find((a) => !a.passed)
      const briefReason = logSummary.errors[0]
        || (failedAssertion ? `断言失败: ${failedAssertion.message}` : '')
        || (!report.metrics.budgetPassed ? (report.metrics.budgetNotes[0] || '性能预算超标') : '')
      const lastShot = report.screenshots[report.screenshots.length - 1]
      return {
        ok: report.ok,
        toolName,
        displayLabel: report.ok
          ? `试玩冒烟：通过（${report.stepsSimulated} 步 / ${report.elapsedSec}s）`
          : `试玩冒烟：${briefReason ? `${briefReason.slice(0, 42)}${briefReason.length > 42 ? '…' : ''}` : `发现 ${report.errorCount} 项问题`}（${report.stepsSimulated} 步 / ${report.elapsedSec}s）`,
        data: {
          ok: report.ok,
          elapsedSec: report.elapsedSec,
          stepsSimulated: report.stepsSimulated,
          runtimeErrorCount: logSummary.errorCount,
          runtimeErrors: logSummary.errors,
          runtimeWarnings: logSummary.warnings,
          logs: report.logs,
          assertions: report.assertions,
          metrics: report.metrics,
          ...(watched ? { watchedNodes: watched } : {}),
          ...(thinned.length > 0 ? { trajectory: thinned } : {}),
          ...(sampleEvery > 0 && watchList.length === 0 ? { trajectoryNote: 'sampleEvery 需要配合 watchNodes 才会采样' } : {}),
          ...(lastShot ? { dataUrl: lastShot } : {}),
        },
      }
    }
    case 'playtest__control': {
      const action = String(args.action ?? '').trim()
      const store = useEditorStore.getState()
      if (action === 'play') {
        if (store.playState === 'stopped') manualPlayLogCursor = captureLogCursor()
        if (store.playState === 'stopped' || store.playState === 'paused') store.play()
      } else if (action === 'pause') {
        if (store.playState === 'playing') store.pause()
      } else if (action === 'stop') {
        if (store.playState !== 'stopped') store.stop()
      } else {
        return { ok: false, toolName, displayLabel: `未知试玩动作：${action}`, data: { error: 'invalid action' } }
      }
      const waitSec = typeof args.waitSeconds === 'number' && args.waitSeconds > 0 ? args.waitSeconds : 0.05
      await waitRealFrames(waitSec)
      const nextState = useEditorStore.getState().playState
      const sinceLogs = readLogsSince(manualPlayLogCursor)
      const logSummary = summarizeRuntimeLogs(sinceLogs)
      // stop 之后对象已还原为编辑态，实时状态没有意义
      const watched = nextState !== 'stopped' ? readWatchedNodes(new PlaytestSession(), args.watchNodes) : null
      return {
        ok: true,
        toolName,
        displayLabel: nextState === 'playing' ? '已进入试玩状态' : nextState === 'paused' ? '已暂停试玩' : '已退出试玩',
        data: {
          playState: nextState,
          runtimeErrorCount: logSummary.errorCount,
          runtimeErrors: logSummary.errors,
          runtimeWarnings: logSummary.warnings,
          logs: summarizeInfoLogs(sinceLogs),
          ...(watched ? { watchedNodes: watched } : {}),
          ...(nextState !== 'stopped' ? { note: '试玩/暂停期间工程处于锁定状态；要修改脚本或节点请先 stop' } : {}),
        },
      }
    }
    case 'viewport__capture':
    case 'playtest__capture': {
      const playSec = typeof args.playSeconds === 'number' && args.playSeconds > 0 ? args.playSeconds : 0
      const keepPlaying = args.keepPlaying === true
      const store = useEditorStore.getState()
      const startedHere = playSec > 0 && store.playState === 'stopped'
      const logCursor = captureLogCursor()
      if (startedHere) {
        store.play()
      }
      if (playSec > 0 || store.playState === 'playing') {
        await waitRealFrames(playSec)
      }
      let dataUrl: string | null = null
      let watched: ReturnType<typeof readWatchedNodes> = null
      let uiLayoutIssues: Array<{ screen: string; nodes: UiLayoutEntry[] }> | null = null
      try {
        dataUrl = await captureViewportComposite({
          width: typeof args.width === 'number' ? args.width : undefined,
          height: typeof args.height === 'number' ? args.height : undefined,
        })
        watched = readWatchedNodes(new PlaytestSession(), args.watchNodes)
        if (useEditorStore.getState().playState !== 'stopped') uiLayoutIssues = collectMountedUiIssues()
      } finally {
        if (startedHere && !keepPlaying && useEditorStore.getState().playState !== 'stopped') {
          useEditorStore.getState().stop()
        }
      }
      const played = startedHere || store.playState !== 'stopped'
      const playedLogs = played ? readLogsSince(logCursor) : null
      const logSummary = playedLogs ? summarizeRuntimeLogs(playedLogs) : null
      return {
        ok: Boolean(dataUrl),
        toolName,
        displayLabel: dataUrl
          ? `${startedHere ? '试玩实景截图成功' : '视口截图成功'}${logSummary && logSummary.errorCount > 0 ? `（运行时报错 ${logSummary.errorCount} 条）` : ''}`
          : '视口未就绪，无法截图',
        data: {
          ...(dataUrl ? { dataUrl } : { error: 'viewport not ready' }),
          playState: useEditorStore.getState().playState,
          ...(logSummary
            ? {
                runtimeErrorCount: logSummary.errorCount,
                runtimeErrors: logSummary.errors,
                runtimeWarnings: logSummary.warnings,
                logs: summarizeInfoLogs(playedLogs ?? []),
              }
            : {}),
          ...(watched ? { watchedNodes: watched } : {}),
          ...(uiLayoutIssues && uiLayoutIssues.length > 0 ? { uiLayoutIssues } : {}),
        },
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
  const targetAssetId = res.ok ? extractTargetAssetId(toolName, resolvedArgs, res.value) : undefined
  const summary = res.ok
    ? (res.changed.summary || cmd?.title || commandId)
    : `${cmd?.title ?? commandId} 失败：${res.message}`

  const data = !res.ok && (
    res.code === 'NOT_FOUND' ||
    res.code === 'node.notFound' ||
    res.code === 'asset.notFound' ||
    res.message.includes('不存在') ||
    (toolName.startsWith('ui__') && res.message.includes('校验失败'))
  )
    ? {
        ...res,
        availableNodes: listCompactNodes(),
        ...(res.code === 'asset.notFound' || toolName.startsWith('ui__') || toolName.startsWith('asset__')
          ? {
              availableUiAssets: Object.values(useAssetStore.getState().assets)
                .filter((a) => a.kind === 'ui')
                .map((a) => ({ id: a.id, name: a.name })),
            }
          : {}),
      }
    : res

  return {
    ok: res.ok,
    toolName,
    displayLabel: summary,
    targetNodeId,
    targetAssetId,
    data,
  }
}

function resolveNodeIdFuzzy(raw: string): string {
  if (typeof raw !== 'string') return String(raw ?? '')
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

function resolveAssetIdFuzzy(raw: string): string {
  if (typeof raw !== 'string') return String(raw ?? '')
  const trimmed = raw.trim()
  if (!trimmed) return raw
  const assets = useAssetStore.getState().assets
  if (assets[trimmed]) return trimmed

  // 若 AI 误把场景里的 screen 节点 ID（或节点名）当成了 UI 资产 ID，自动解包成其绑定的 documentId
  const nodes = useEditorStore.getState().nodes
  const maybeNode = nodes[trimmed] ?? Object.values(nodes).find((n) => n.kind === 'screen' && n.name === trimmed)
  if (maybeNode?.kind === 'screen' && maybeNode.screen?.documentId && assets[maybeNode.screen.documentId]) {
    return maybeNode.screen.documentId
  }

  const all = Object.values(assets)
  const byName = all.filter((a) => a.name === trimmed)
  if (byName.length === 1) return byName[0].id

  if (trimmed.length >= 6) {
    const cleanPrefix = trimmed.replace(/\?+$/g, '').replace(/\.\.\.$/g, '')
    if (cleanPrefix.length >= 6) {
      const byPrefix = all.filter((a) => a.id.startsWith(cleanPrefix))
      if (byPrefix.length === 1) return byPrefix[0].id
    }
  }

  const uuidHead = trimmed.match(/^([0-9a-fA-F]{8})-[0-9a-fA-F-]*/)?.[1]
  if (uuidHead) {
    const byHead = all.filter((a) => a.id.toLowerCase().startsWith(uuidHead.toLowerCase() + '-'))
    if (byHead.length === 1) return byHead[0].id
  }
  const uuidTail = trimmed.match(/([0-9a-fA-F]{12})$/)?.[1]
  if (uuidTail) {
    const byTail = all.filter((a) => a.id.toLowerCase().endsWith('-' + uuidTail.toLowerCase()))
    if (byTail.length === 1) return byTail[0].id
  }

  return raw
}

/** playtest__control 手动开始试玩时记录的日志游标，用于停止/暂停时回报这段时间的运行时报错 */
let manualPlayLogCursor: string | null = null

interface WatchedNode {
  query: string
  found: boolean
  id?: string
  name?: string
  position?: [number, number, number]
  /** 欧拉角（度），[1] 为 yaw */
  rotation?: [number, number, number]
  visible?: boolean
  /** 该节点上各行为脚本的 self.state 只读快照 */
  scriptState?: Record<string, Record<string, unknown>>
}

function readWatchedNodes(session: PlaytestSession, raw: unknown): WatchedNode[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  return raw
    .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    .slice(0, 12)
    .map((query): WatchedNode => {
      const pose = session.read({ kind: 'nodePose', nodeIdOrName: query.trim() }) as PlaytestNodePose | null
      if (!pose) return { query, found: false }
      const scriptState = readScriptStateSnapshot(pose.id)
      return {
        query,
        found: true,
        id: pose.id,
        name: pose.name,
        position: pose.position.map((v) => Number(v.toFixed(3))) as [number, number, number],
        rotation: pose.rotation.map((v) => Number(v.toFixed(1))) as [number, number, number],
        visible: pose.visible,
        ...(scriptState ? { scriptState } : {}),
      }
    })
}

/** 试玩中已挂载界面的布局问题（只列有问题的节点） */
function collectMountedUiIssues(): Array<{ screen: string; nodes: UiLayoutEntry[] }> {
  const assets = useAssetStore.getState().assets
  const out: Array<{ screen: string; nodes: UiLayoutEntry[] }> = []
  for (const node of Object.values(useEditorStore.getState().nodes)) {
    if (node.kind !== 'screen' || !node.screen?.documentId) continue
    const asset = assets[node.screen.documentId]
    if (asset?.kind !== 'ui' || !asset.document?.root) continue
    const report = measureUiLayout(asset.document.root, { issuesOnly: true })
    if (report.rendered && report.nodes && report.nodes.length > 0) {
      out.push({ screen: node.name, nodes: report.nodes.slice(0, 12) })
    }
  }
  return out
}

async function waitRealFrames(seconds: number): Promise<void> {
  const ms = Math.max(0, Math.min(10000, seconds * 1000))
  if (ms > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, ms))
  }
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
}

function resolveAiNodeArgs(toolName: string, args: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...args }

  // 代码资产工具常见别名兜底：大模型常把 id 写成 scriptId / shaderId / name / fileName / path
  if (
    toolName === 'script__create' ||
    toolName === 'script__update' ||
    toolName === 'script__patch' ||
    toolName === 'script__check' ||
    toolName === 'script__read' ||
    toolName === 'shader__read' ||
    toolName === 'shader__create' ||
    toolName === 'shader__update' ||
    toolName === 'shader__check'
  ) {
    const rawId = typeof next.id === 'string' ? next.id.trim() : ''
    if (!rawId) {
      const alias = next.scriptId ?? next.shaderId ?? next.name ?? next.fileName ?? next.path
      if (typeof alias === 'string' && alias.trim()) {
        next.id = alias
          .trim()
          .replace(/\\/g, '/')
          .replace(/^(?:Assets\/(?:Scripts|Shaders)\/|scripts\/|shaders\/)/i, '')
          .split('/')
          .pop()!
      }
    }
  }

  // 对象类参数（patch / row / params / document）常见别名与 JSON 字符串兜底
  for (const objKey of ['patch', 'row', 'params', 'document']) {
    const rawVal = next[objKey]
    if (typeof rawVal === 'string' && rawVal.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(rawVal) as unknown
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          next[objKey] = parsed
        }
      } catch {
        // ignore invalid json
      }
    }
  }
  if (
    toolName === 'gameplay__setComponentData' ||
    toolName === 'capability__setNode' ||
    toolName === 'capability__setPicture'
  ) {
    if (!next.patch || typeof next.patch !== 'object' || Array.isArray(next.patch)) {
      const alias = next.data ?? next.value ?? next.values ?? next.fields ?? next.config ?? next.componentData
      if (typeof alias === 'string' && alias.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(alias) as unknown
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            next.patch = parsed
          }
        } catch {
          // ignore
        }
      } else if (alias && typeof alias === 'object' && !Array.isArray(alias)) {
        next.patch = alias
      } else {
        const reserved = new Set(['nodeId', 'packId', 'componentId', 'capabilityId', 'patch'])
        const collected: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(next)) {
          if (!reserved.has(k) && v !== undefined) collected[k] = v
        }
        next.patch = collected
      }
    }
  }

  // UI 工具常见别名兜底：大模型常把 assetId 写成 uiAssetId / documentId / id / screenNodeId
  if (toolName === 'ui__updateDocument' || toolName === 'ui__mountScreen' || toolName === 'ui__patchNode') {
    const rawAssetId = typeof next.assetId === 'string' ? next.assetId.trim() : ''
    if (!rawAssetId) {
      const alias =
        toolName === 'ui__patchNode'
          ? next.uiAssetId ?? next.documentId ?? next.id ?? next.screenNodeId
          : next.uiAssetId ?? next.documentId ?? next.id ?? next.screenNodeId ?? next.nodeId
      if (typeof alias === 'string' && alias.trim()) {
        next.assetId = alias.trim()
      } else if (toolName === 'ui__updateDocument' || toolName === 'ui__patchNode') {
        const uiAssets = Object.values(useAssetStore.getState().assets).filter((a) => a.kind === 'ui')
        if (typeof next.name === 'string' && next.name.trim()) {
          const byName = uiAssets.filter((a) => a.name === next.name!.toString().trim())
          if (byName.length === 1) next.assetId = byName[0].id
        }
        if ((!next.assetId || !String(next.assetId).trim()) && uiAssets.length === 1) {
          next.assetId = uiAssets[0].id
        }
      }
    }
  }

  const nodeRefKeys = toolName === 'ui__patchNode'
    ? ['parentId', 'targetNodeId', 'sourceNodeId']
    : ['nodeId', 'parentId', 'targetNodeId', 'sourceNodeId']
  for (const key of nodeRefKeys) {
    if (typeof next[key] === 'string' && next[key]) {
      next[key] = resolveNodeIdFuzzy(next[key] as string)
    }
  }
  const assetRefKeys = ['assetId', 'materialId']
  for (const key of assetRefKeys) {
    if (typeof next[key] === 'string' && next[key]) {
      next[key] = resolveAssetIdFuzzy(next[key] as string)
    }
  }
  if (Array.isArray(next.nodeIds)) {
    next.nodeIds = next.nodeIds.map((id) => (typeof id === 'string' ? resolveNodeIdFuzzy(id) : id))
  }

  // 若是挂载脚本，顺便把脚本 params 里声明为 ref(node/asset) 或 texture 的字段也做名称/前缀容错解析
  if (toolName === 'script__attach' && typeof next.scriptId === 'string' && next.params && typeof next.params === 'object') {
    const scriptId = next.scriptId.replace(/^(?:Assets\/Scripts\/|scripts\/)/i, '').replace(/\.ts$/, '')
    const behavior = useCodeAssetStore.getState().assets[scriptId]?.compiledScript?.behavior
    if (behavior?.params) {
      const resolvedParams = { ...(next.params as Record<string, unknown>) }
      for (const [k, schema] of Object.entries(behavior.params)) {
        if (typeof resolvedParams[k] !== 'string' || !resolvedParams[k]) continue
        if (schema.type === 'ref' && schema.target === 'node') {
          resolvedParams[k] = resolveNodeIdFuzzy(resolvedParams[k] as string)
        } else if ((schema.type === 'ref' && schema.target === 'asset') || schema.type === 'texture') {
          resolvedParams[k] = resolveAssetIdFuzzy(resolvedParams[k] as string)
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

function extractTargetAssetId(toolName: string, args: Record<string, unknown>, value: unknown): string | undefined {
  const valObj = value && typeof value === 'object' ? (value as Record<string, unknown>) : null
  if (toolName.startsWith('script__') && toolName !== 'script__attach' && toolName !== 'script__check' && toolName !== 'script__read') {
    const id = typeof valObj?.id === 'string' ? valObj.id : typeof args.id === 'string' ? args.id : ''
    if (id) return `code:script:${id}`
  }
  if (toolName.startsWith('shader__') && toolName !== 'shader__check') {
    const id = typeof valObj?.id === 'string' ? valObj.id : typeof valObj?.shaderId === 'string' ? valObj.shaderId : typeof args.shaderId === 'string' ? args.shaderId : typeof args.id === 'string' ? args.id : ''
    if (id) return `code:shader:${id}`
  }
  if (valObj && typeof valObj.assetId === 'string' && valObj.assetId) {
    return valObj.assetId
  }
  if (typeof args.assetId === 'string' && args.assetId) {
    return args.assetId
  }
  if (typeof args.materialId === 'string' && args.materialId) {
    return args.materialId
  }
  if (toolName === 'scene__createScene' && valObj && typeof valObj.sceneId === 'string' && valObj.sceneId) {
    return valObj.sceneId
  }
  return undefined
}
