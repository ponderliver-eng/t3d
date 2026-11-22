import { createCheckpoint, restoreCheckpoint } from '../../core/project'
import { projectDirectoryPath } from '../../editor/project/disk'
import { electronBridge, joinProjectPath } from '../../editor/project/electronBridge'
import { useEditorStore } from '../../editor/scene/store'
import { PlaytestSession, summarizeRuntimeLogs } from '../../playtest/session'
import { useAgentStore } from '../agentLoop'
import { saveAiHistory } from '../historyStorage'
import { getRecentAiTraces, type AiTraceRecord } from '../trace'
import { EVAL_TASKS, type EvalCheckResult, type EvalTask } from './tasks'

/**
 * AI 评测运行器（开发用）。在 Electron 桌面端打开一个【空白测试工程】，于开发者工具控制台执行：
 *
 *   await __t3dAiEval.run()                       // 跑全部任务
 *   await __t3dAiEval.run({ ids: ['small-edit-param'] })
 *   await __t3dAiEval.run({ sizes: ['small'] })
 *   __t3dAiEval.list()
 *
 * 每个任务：建快照 -> 准备 -> 发送提示并等待 agent 结束 -> 静态检查 + 试玩断言 -> 回滚快照。
 * 结果写入 <工程>/.t3d/ai-eval-<时间戳>.json 并在控制台打印汇总表。
 *
 * 注意：评测会真实调用当前选中的模型（产生费用），并在工程里创建脚本文件
 * （快照回滚不会删除磁盘上的脚本文件），所以请只在测试工程里运行。
 */

export interface EvalResult {
  id: string
  size: EvalTask['size']
  pass: boolean
  withinStepBudget: boolean
  checks: EvalCheckResult[]
  steps: number
  stepBudget: number
  durationSec: number
  inputTokens: number
  outputTokens: number
  cacheHitRate: number
  toolCalls: number
  toolFailures: number
  truncations: number
  autoVerifyRounds: number
  stopReason: string
  model: string
  error?: string
}

export interface EvalRunOptions {
  ids?: string[]
  sizes?: Array<EvalTask['size']>
  /** 保留每个任务的改动不回滚（用于人工查看产出），默认 false */
  keepChanges?: boolean
}

function runSmokeChecks(task: EvalTask): EvalCheckResult[] {
  if (!task.smoke) return []
  if (useEditorStore.getState().playState !== 'stopped') useEditorStore.getState().stop()
  try {
    const report = new PlaytestSession().runSmoke(task.smoke())
    const logs = summarizeRuntimeLogs(report.errors.map((message) => ({ level: 'error', message })))
    return [
      { name: '试玩无运行时报错', pass: logs.errorCount === 0, note: logs.errors.slice(0, 3).join('；') || undefined },
      ...report.assertions.map((a) => ({ name: a.message, pass: a.passed })),
    ]
  } catch (error) {
    return [{ name: '试玩可执行', pass: false, note: error instanceof Error ? error.message : String(error) }]
  }
}

async function runOne(task: EvalTask, keepChanges: boolean): Promise<EvalResult> {
  const agent = useAgentStore.getState()
  const baseline = await createCheckpoint(`评测基线：${task.id}`)
  // 每个任务都从干净的对话与任务清单开始，避免上一个任务的历史污染上下文
  useAgentStore.setState({ turns: [], taskPlan: [], pendingRefs: [], pendingAttachmentImage: null })
  useEditorStore.getState().setSelection([])

  let error: string | undefined
  let trace: AiTraceRecord | undefined
  let checks: EvalCheckResult[] = []
  try {
    await task.setup?.()
    const traceBefore = getRecentAiTraces().at(-1)
    await agent.sendPrompt(task.prompt)
    const traceAfter = getRecentAiTraces().at(-1)
    trace = traceAfter && traceAfter !== traceBefore ? traceAfter : undefined
    const lastTurn = useAgentStore.getState().turns.at(-1)
    if (lastTurn?.error) error = lastTurn.error
    checks = [...(task.staticChecks?.() ?? []), ...runSmokeChecks(task)]
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  } finally {
    if (useEditorStore.getState().playState !== 'stopped') useEditorStore.getState().stop()
    if (!keepChanges) restoreCheckpoint(baseline.id)
  }

  const steps = trace?.steps.length ?? 0
  return {
    id: task.id,
    size: task.size,
    pass: !error && checks.length > 0 && checks.every((c) => c.pass),
    withinStepBudget: steps > 0 && steps <= task.stepBudget,
    checks,
    steps,
    stepBudget: task.stepBudget,
    durationSec: Number(((trace?.durationMs ?? 0) / 1000).toFixed(1)),
    inputTokens: trace?.inputTokens ?? 0,
    outputTokens: trace?.outputTokens ?? 0,
    cacheHitRate: trace?.cacheHitRate ?? 0,
    toolCalls: trace?.toolCalls ?? 0,
    toolFailures: trace?.toolFailures ?? 0,
    truncations: trace?.truncations ?? 0,
    autoVerifyRounds: trace?.autoVerifyRounds ?? 0,
    stopReason: trace?.stopReason ?? 'unknown',
    model: trace?.model ?? '',
    ...(error ? { error } : {}),
  }
}

export async function runAiEval(options: EvalRunOptions = {}): Promise<EvalResult[]> {
  if (useAgentStore.getState().status !== 'idle') {
    throw new Error('AI 正在运行，请等待当前对话结束后再启动评测')
  }
  const tasks = EVAL_TASKS.filter(
    (t) => (!options.ids || options.ids.includes(t.id)) && (!options.sizes || options.sizes.includes(t.size)),
  )
  const savedTurns = useAgentStore.getState().turns
  const savedPlan = useAgentStore.getState().taskPlan
  const results: EvalResult[] = []
  try {
    for (const task of tasks) {
      console.info(`[AI 评测] 开始 ${task.id}（${task.size}）`)
      const result = await runOne(task, options.keepChanges === true)
      results.push(result)
      console.info(
        `[AI 评测] ${result.pass ? '通过' : '未通过'} ${task.id}：${result.steps}/${result.stepBudget} 步，${result.durationSec}s`,
        result.checks.filter((c) => !c.pass),
      )
    }
  } finally {
    useAgentStore.setState({ turns: savedTurns, taskPlan: savedPlan })
    void saveAiHistory(savedTurns)
  }

  console.table(
    results.map((r) => ({
      任务: r.id,
      规模: r.size,
      通过: r.pass,
      步数: `${r.steps}/${r.stepBudget}`,
      耗时秒: r.durationSec,
      输入tok: r.inputTokens,
      输出tok: r.outputTokens,
      缓存命中: `${Math.round(r.cacheHitRate * 100)}%`,
      工具失败: r.toolFailures,
      截断: r.truncations,
      自动返修: r.autoVerifyRounds,
    })),
  )
  const passed = results.filter((r) => r.pass).length
  console.info(`[AI 评测] 通过 ${passed}/${results.length}，步数达标 ${results.filter((r) => r.withinStepBudget).length}/${results.length}`)

  const dir = projectDirectoryPath()
  const fs = electronBridge()?.fs
  if (dir && fs?.writeTextFile) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const file = joinProjectPath(dir, `.t3d/ai-eval-${stamp}.json`)
    await fs
      .writeTextFile(file, JSON.stringify({ ranAt: new Date().toISOString(), passed, total: results.length, results }, null, 2))
      .then(() => console.info(`[AI 评测] 结果已写入 ${file}`))
      .catch((e) => console.warn('[AI 评测] 写入结果失败：', e))
  }
  return results
}

if (typeof window !== 'undefined') {
  ;(window as Window & { __t3dAiEval?: unknown }).__t3dAiEval = {
    run: runAiEval,
    list: () => EVAL_TASKS.map((t) => ({ id: t.id, size: t.size, stepBudget: t.stepBudget, prompt: t.prompt })),
    traces: () => getRecentAiTraces(),
  }
}
