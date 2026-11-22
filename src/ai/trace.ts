import { projectDirectoryPath } from '../editor/project/disk'
import { electronBridge, joinProjectPath } from '../editor/project/electronBridge'

/**
 * AI 轮次运行轨迹：每轮对话记录一条，用于回答「到底慢在哪、缓存命中没有、失败了几次」。
 * 评测脚本（src/ai/evals/runner.ts）与日常排查都读这份数据，调优不再凭感觉。
 */

export interface AiTraceStep {
  /** 该步模型请求耗时（毫秒） */
  ms: number
  inputTokens: number
  outputTokens: number
  /** 输入中命中提示缓存的 token 数 */
  cachedTokens: number
  tools: string[]
  stopReason: string
}

export interface AiTraceDraft {
  prompt: string
  startedAt: number
  steps: AiTraceStep[]
  toolCalls: number
  toolFailures: number
  /** 输出被长度上限截断的次数（文本或工具参数） */
  truncations: number
  /** 收尾自动验收发现问题并回灌给模型的轮数 */
  autoVerifyRounds: number
  /** 上下文折叠触发次数 */
  compactions: number
}

export interface AiTraceRecord extends AiTraceDraft {
  model: string
  durationMs: number
  /** 其中等待模型响应的总耗时 */
  modelMs: number
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  /** 缓存命中率 = cachedTokens / inputTokens */
  cacheHitRate: number
  stopReason: string
  error?: string
}

const TRACE_REL_PATH = '.t3d/ai-traces.jsonl'
const MAX_MEMORY_TRACES = 50
const MAX_FILE_TRACES = 300

const recentTraces: AiTraceRecord[] = []
let writeChain: Promise<void> = Promise.resolve()

export function finalizeAiTrace(
  draft: AiTraceDraft,
  extra: { model: string; stopReason: string; error?: string },
): AiTraceRecord {
  const inputTokens = draft.steps.reduce((sum, s) => sum + s.inputTokens, 0)
  const outputTokens = draft.steps.reduce((sum, s) => sum + s.outputTokens, 0)
  const cachedTokens = draft.steps.reduce((sum, s) => sum + s.cachedTokens, 0)
  return {
    ...draft,
    model: extra.model,
    durationMs: Date.now() - draft.startedAt,
    modelMs: draft.steps.reduce((sum, s) => sum + s.ms, 0),
    inputTokens,
    outputTokens,
    cachedTokens,
    cacheHitRate: inputTokens > 0 ? Number((cachedTokens / inputTokens).toFixed(3)) : 0,
    stopReason: extra.stopReason,
    ...(extra.error ? { error: extra.error } : {}),
  }
}

export function recordAiTrace(record: AiTraceRecord): void {
  recentTraces.push(record)
  if (recentTraces.length > MAX_MEMORY_TRACES) recentTraces.splice(0, recentTraces.length - MAX_MEMORY_TRACES)

  const dir = projectDirectoryPath()
  const fs = electronBridge()?.fs
  if (!dir || !fs?.writeTextFile || !fs.readTextFile || !fs.exists) return
  const filePath = joinProjectPath(dir, TRACE_REL_PATH)
  // 串行追加，避免连续两轮同时读写同一个文件
  writeChain = writeChain
    .then(async () => {
      let lines: string[] = []
      if (await fs.exists(filePath)) {
        const raw = await fs.readTextFile(filePath)
        lines = raw.split('\n').filter((line) => line.trim())
      }
      lines.push(JSON.stringify(record))
      if (lines.length > MAX_FILE_TRACES) lines = lines.slice(lines.length - MAX_FILE_TRACES)
      await fs.writeTextFile(filePath, `${lines.join('\n')}\n`)
    })
    .catch((error) => {
      console.warn('[AI] 写入运行轨迹失败：', error)
    })
}

export function getRecentAiTraces(): readonly AiTraceRecord[] {
  return recentTraces
}

/** 控制台友好的一行摘要 */
export function summarizeAiTrace(record: AiTraceRecord): string {
  return [
    `${record.steps.length} 步`,
    `${(record.durationMs / 1000).toFixed(1)}s（模型 ${(record.modelMs / 1000).toFixed(1)}s）`,
    `输入 ${record.inputTokens} / 输出 ${record.outputTokens} tok`,
    `缓存命中 ${(record.cacheHitRate * 100).toFixed(0)}%`,
    `工具 ${record.toolCalls} 次（失败 ${record.toolFailures}）`,
    record.truncations > 0 ? `截断 ${record.truncations}` : '',
    record.autoVerifyRounds > 0 ? `自动返修 ${record.autoVerifyRounds}` : '',
    record.stopReason,
  ]
    .filter(Boolean)
    .join(' · ')
}
