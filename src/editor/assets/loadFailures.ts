/**
 * 资源自动加载的失败闸门。
 *
 * 视口每次同步都会来要贴图/模型；文件坏了的话，不加限制就会每次同步都重新读盘、重新解析。
 * 这里按「资源 + 内容哈希」记失败次数：前几次隔一段时间再试（应对渲染器还没就绪这类临时失败），
 * 连续失败到上限后不再自动重试，并报告一次。用户主动触发的加载（重新导入、双击打开）不受限制。
 */

const MAX_ATTEMPTS = 3
const BASE_DELAY_MS = 2000

interface FailureRecord {
  hash: string
  count: number
  retryAt: number
  message: string
}

export interface LoadFailureInfo {
  assetId: string
  kind: string
  name: string
  message: string
}

let reporter: ((info: LoadFailureInfo) => void) | null = null
const gates: LoadFailureGate[] = []

/** 连续失败到上限时的通知出口（编辑器启动时接到日志面板）。 */
export function setLoadFailureReporter(next: ((info: LoadFailureInfo) => void) | null) {
  reporter = next
}

export interface LoadFailureGate {
  /** 现在该不该自动加载这个资源。 */
  shouldTry: (assetId: string, hash: string) => boolean
  fail: (assetId: string, hash: string, name: string, error: unknown) => void
  clear: (assetId: string) => void
  /** 已经放弃自动重试的资源及原因。 */
  failed: () => Array<{ assetId: string, message: string }>
}

export function createLoadFailureGate(kind: string, now: () => number = () => Date.now()): LoadFailureGate {
  const records = new Map<string, FailureRecord>()
  const gate: LoadFailureGate = {
    shouldTry(assetId, hash) {
      const record = records.get(assetId)
      if (!record) return true
      // 内容变了（重新导入、外部改了文件）就重新来
      if (record.hash !== hash) {
        records.delete(assetId)
        return true
      }
      if (record.count >= MAX_ATTEMPTS) return false
      return now() >= record.retryAt
    },
    fail(assetId, hash, name, error) {
      const previous = records.get(assetId)
      const count = previous && previous.hash === hash ? previous.count + 1 : 1
      const message = error instanceof Error ? error.message : String(error)
      records.set(assetId, { hash, count, retryAt: now() + BASE_DELAY_MS * 4 ** (count - 1), message })
      if (count === MAX_ATTEMPTS) reporter?.({ assetId, kind, name, message })
    },
    clear(assetId) {
      records.delete(assetId)
    },
    failed() {
      const out: Array<{ assetId: string, message: string }> = []
      for (const [assetId, record] of records) {
        if (record.count >= MAX_ATTEMPTS) out.push({ assetId, message: record.message })
      }
      return out
    },
  }
  gates.push(gate)
  return gate
}

/** 所有已放弃自动重试的资源。 */
export function failedAssetLoads(): Array<{ assetId: string, message: string }> {
  return gates.flatMap(gate => gate.failed())
}
