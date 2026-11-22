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
import { captureViewportComposite } from '../core/preview/offscreenPreview'
import { projectDirectoryPath } from '../editor/project/disk'
import { useEditorStore } from '../editor/scene/store'
import { exportWebPlayerBundle } from '../player/exporter'
import { useAssetStore } from '../editor/assets/library'
import { PlaytestSession, type SmokeStep } from '../playtest/session'

export type AiToolDomain = 'core' | 'script' | 'shader' | 'ui' | 'capability' | 'playtest'

export const AI_TOOL_DOMAIN_META: Record<Exclude<AiToolDomain, 'core'>, { label: string; summary: string }> = {
  script: { label: '脚本与逻辑', summary: '编写/更新/检查/挂载 TypeScript 行为脚本（t3d/runtime）、查询代码资产' },
  shader: { label: '着色器与材质', summary: '编写/绑定 TSL 着色器（t3d/shader）、创建/分配材质、资产目录整理' },
  ui: { label: 'UI 与输入', summary: '创建/更新/挂载 UI HUD 界面、查询 UI 文档、配置键鼠输入映射' },
  capability: { label: '能力包与数据', summary: '物理/粒子/水面/天空/导航能力包、玩法包、数据表行、环境渲染参数' },
  playtest: { label: '试玩与交付', summary: '自动试玩冒烟、视口截图、新建/切换场景、实验分支、导出 Web 播放包' },
}

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
  enabledDomains?: AiToolDomain[]
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
    name: 'tools__enable_domain',
    description:
      '按需开启专业工具域以节省上下文并解锁对应工具：script（行为脚本）/ shader（着色器与材质）/ ui（UI界面与输入）/ capability（物理/粒子/水面/天空/导航/玩法包/数据表）/ playtest（自动试玩/截图/分支/多场景/导出）。可一次开启多个域。',
    parameters: {
      type: 'object',
      properties: {
        domains: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['script', 'shader', 'ui', 'capability', 'playtest'],
          },
          description: '需要开启的工具域列表',
        },
      },
      required: ['domains'],
      additionalProperties: false,
    },
  },
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
          description: '冒烟测试步骤列表：支持 {action:"input",events:[...]}、{action:"uiClick",target:"按钮名/文本/消息名"}、{action:"step",seconds:1}、{action:"waitFor",condition:...}、{action:"assert",condition:...}、{action:"capture"}',
          items: { type: 'object' },
        },
        autoStop: { type: 'boolean', description: '完成后是否自动退出试玩，默认 true' },
      },
      required: ['steps'],
      additionalProperties: false,
    },
  },
  {
    name: 'viewport__capture',
    description: '抓取当前视口截图（含 3D 场景与叠加 UI 界面）。若传入 playSeconds（如 0.8），会自动启动试玩运行指定秒数后截图，默认截完自动退出试玩，非常适合检查游戏内真实相机、动态效果与 UI 排版。',
    parameters: {
      type: 'object',
      properties: {
        width: { type: 'number', description: '可选最大宽度（默认 960）' },
        height: { type: 'number', description: '可选缩放高度' },
        playSeconds: { type: 'number', description: '可选：自动开启试玩并运行指定秒数（如 0.5~2.0）后再截图' },
        keepPlaying: { type: 'boolean', description: '可选：截图后是否保持试玩状态（默认 false，自动恢复编辑态以便继续修改工程）' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'playtest__control',
    description: '控制编辑器实时试玩状态（开始试玩 play / 暂停 pause / 停止并还原 stop），可配合 waitSeconds 等待几帧再观察或截图',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['play', 'pause', 'stop'], description: '控制动作' },
        waitSeconds: { type: 'number', description: '可选：执行后等待的真实秒数（如 0.5）' },
      },
      required: ['action'],
      additionalProperties: false,
    },
  },
  {
    name: 'playtest__capture',
    description: '抓取当前视口截图（含 3D 场景与 UI 界面，PNG/JPEG DataURL）',
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

export function toolDomainFor(toolName: string): AiToolDomain {
  if (
    toolName === 'tools__enable_domain' ||
    toolName === 'plan__set_tasks' ||
    toolName === 'query__project_overview' ||
    toolName === 'query__scene_outline' ||
    toolName === 'query__node_inspect' ||
    toolName === 'query__asset_search' ||
    toolName === 'query__project_diagnose' ||
    toolName === 'scene__createNode' ||
    toolName === 'scene__deleteNodes' ||
    toolName === 'scene__setTransform' ||
    toolName === 'scene__renameNode' ||
    toolName === 'scene__reparentNode' ||
    toolName === 'project__design__get' ||
    toolName === 'project__design__update' ||
    toolName === 'project__createCheckpoint' ||
    toolName === 'asset__createPrefab' ||
    toolName === 'viewport__capture' ||
    toolName === 'playtest__control'
  ) {
    return 'core'
  }
  if (toolName.startsWith('script__')) return 'script'
  if (toolName.startsWith('shader__') || toolName.startsWith('asset__')) return 'shader'
  if (toolName === 'query__code_assets') return 'script'
  if (toolName.startsWith('ui__') || toolName === 'query__ui_inspect' || toolName.startsWith('input__')) return 'ui'
  if (
    toolName.startsWith('capability__') ||
    toolName.startsWith('pack__') ||
    toolName.startsWith('gameplay__') ||
    toolName === 'query__registry_describe' ||
    toolName === 'query__db_rows' ||
    toolName === 'picture__update'
  ) {
    return 'capability'
  }
  if (
    toolName.startsWith('playtest__') ||
    toolName.startsWith('branch__') ||
    toolName === 'scene__create' ||
    toolName === 'scene__open' ||
    toolName === 'project__export_web' ||
    toolName === 'project__restoreCheckpoint' ||
    toolName === 'codeAsset__openExternal'
  ) {
    return 'playtest'
  }
  return 'core'
}

export function inferInitialToolDomains(
  prompt: string,
  refKinds: ReadonlyArray<'node' | 'asset' | 'script' | 'shader'> = [],
): Set<AiToolDomain> {
  const domains = new Set<AiToolDomain>(['core'])
  const p = prompt.toLowerCase()

  if (refKinds.includes('script')) domains.add('script')
  if (refKinds.includes('shader') || refKinds.includes('asset')) domains.add('shader')

  const isGameBuild = /(做个|制作|新建|搭建|开发).*(游戏|demo|原型|关卡|塔防|射击|跳跃|跑酷|rpg|fps)/.test(p)
  if (
    isGameBuild ||
    /(脚本|代码|逻辑|行为|移动|控制|旋转|发射|子弹|炮塔|敌人|怪物|波次|生成|碰撞|伤害|血量|ai|script|behavior)/.test(p)
  ) {
    domains.add('script')
  }
  if (
    isGameBuild ||
    /(着色器|材质|发光|描边|轮廓|透明|金属|粗糙|贴图|颜色|目录|整理|文件夹|shader|material|tsl|rim|glow)/.test(p)
  ) {
    domains.add('shader')
  }
  if (
    isGameBuild ||
    /(ui|界面|hud|血条|按钮|菜单|弹窗|分数|金币|文本|面板|按键|键位|输入|手柄|鼠标|键盘|screen|button|input)/.test(p)
  ) {
    domains.add('ui')
  }
  if (
    isGameBuild ||
    /(物理|刚体|碰撞体|重力|粒子|特效|水面|海洋|天空|雾|后处理|光照|导航|寻路|能力包|玩法包|数据表|样条|曲线|补间|缓动|群体|避让|编队|弹道|physics|particle|effect|water|sky|nav|pack|capability|spline|tween|crowd|projectile)/.test(p)
  ) {
    domains.add('capability')
  }
  if (
    isGameBuild ||
    /(试玩|冒烟|测试|验证|截图|分支|导出|多场景|切换场景|playtest|smoke|capture|export|branch)/.test(p)
  ) {
    domains.add('playtest')
  }

  return domains
}

export function buildAiToolSpecs(activeDomains?: Iterable<AiToolDomain>): AiToolSpec[] {
  const commandTools: AiToolSpec[] = commandBus.list().map((cmd) => ({
    name: toToolName(cmd.id),
    description: `${cmd.title}${cmd.description ? `：${cmd.description}` : ''}${cmd.risk === 'confirm' ? '（高风险操作，需谨慎）' : ''}`,
    parameters: fieldSchemaToJsonSchema(cmd.params),
  }))
  const all = [...QUERY_TOOLS, ...commandTools]
  if (!activeDomains) return all
  const allowed = new Set<AiToolDomain>(['core', ...activeDomains])
  // shader 域与 script 域共享 query__code_assets
  if (allowed.has('shader')) {
    return all.filter((t) => allowed.has(toolDomainFor(t.name)) || t.name === 'query__code_assets')
  }
  return all.filter((t) => allowed.has(toolDomainFor(t.name)))
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
    case 'tools__enable_domain': {
      const raw = Array.isArray(resolvedArgs.domains) ? resolvedArgs.domains : []
      const valid = raw.filter(
        (d): d is Exclude<AiToolDomain, 'core'> =>
          typeof d === 'string' && d in AI_TOOL_DOMAIN_META,
      )
      const labels = valid.map((d) => AI_TOOL_DOMAIN_META[d].label)
      return {
        ok: valid.length > 0,
        toolName,
        enabledDomains: valid,
        displayLabel: valid.length > 0 ? `开启工具域：${labels.join('、')}` : '未指定有效工具域',
        data: {
          ok: valid.length > 0,
          enabled: valid,
          message: valid.length > 0
            ? `已开启工具域 [${valid.join(', ')}]，下一轮起可直接调用对应工具。`
            : '请传入有效的 domains 数组：script / shader / ui / capability / playtest',
        },
      }
    }
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
      const failedAssertion = report.assertions.find((a) => !a.passed)
      const briefReason = report.errors[0]
        || (failedAssertion ? `断言失败: ${failedAssertion.message}` : '')
        || (!report.metrics.budgetPassed ? (report.metrics.budgetNotes[0] || '性能预算超标') : '')
      return {
        ok: report.ok,
        toolName,
        displayLabel: report.ok
          ? `试玩冒烟：通过（${report.stepsSimulated} 步 / ${report.elapsedSec}s）`
          : `试玩冒烟：${briefReason ? `${briefReason.slice(0, 42)}${briefReason.length > 42 ? '…' : ''}` : `发现 ${report.errorCount} 项问题`}（${report.stepsSimulated} 步 / ${report.elapsedSec}s）`,
        data: report,
      }
    }
    case 'playtest__control': {
      const action = String(args.action ?? '').trim()
      const store = useEditorStore.getState()
      if (action === 'play') {
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
      return {
        ok: true,
        toolName,
        displayLabel: nextState === 'playing' ? '已进入试玩状态' : nextState === 'paused' ? '已暂停试玩' : '已退出试玩',
        data: { playState: nextState },
      }
    }
    case 'viewport__capture':
    case 'playtest__capture': {
      const playSec = typeof args.playSeconds === 'number' && args.playSeconds > 0 ? args.playSeconds : 0
      const keepPlaying = args.keepPlaying === true
      const store = useEditorStore.getState()
      const startedHere = playSec > 0 && store.playState === 'stopped'
      if (startedHere) {
        store.play()
      }
      if (playSec > 0 || store.playState === 'playing') {
        await waitRealFrames(playSec)
      }
      let dataUrl: string | null = null
      try {
        dataUrl = await captureViewportComposite({
          width: typeof args.width === 'number' ? args.width : undefined,
          height: typeof args.height === 'number' ? args.height : undefined,
        })
      } finally {
        if (startedHere && !keepPlaying && useEditorStore.getState().playState !== 'stopped') {
          useEditorStore.getState().stop()
        }
      }
      return {
        ok: Boolean(dataUrl),
        toolName,
        displayLabel: dataUrl ? (startedHere ? '试玩实景截图成功' : '视口截图成功') : '视口未就绪，无法截图',
        data: dataUrl
          ? { dataUrl, playState: useEditorStore.getState().playState }
          : { error: 'viewport not ready' },
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

async function waitRealFrames(seconds: number): Promise<void> {
  const ms = Math.max(0, Math.min(10000, seconds * 1000))
  if (ms > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, ms))
  }
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
}

function resolveAiNodeArgs(toolName: string, args: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...args }

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
