import { validateBySchema } from '../schema/fieldSchema'
import type {
  ChangeSummary,
  CommandContext,
  CommandDef,
  CommandDescriptor,
  CommandLogEntry,
  CommandResult,
  FileBackupEntry,
  TransactionAdapter,
} from './types'

interface ActiveTransaction {
  id: string
  label: string
  beforeSnapshot: unknown
  fileBackups: Map<string, string | null>
  changes: ChangeSummary[]
}

const DEFAULT_ADAPTER: TransactionAdapter = {
  isPlaying: () => false,
  captureSnapshot: () => null,
  restoreSnapshot: () => {},
}

export class CommandBus {
  private readonly commands = new Map<string, CommandDef<any, any>>()
  private readonly txStack: ActiveTransaction[] = []
  private readonly logs: CommandLogEntry[] = []
  private adapter: TransactionAdapter = DEFAULT_ADAPTER
  private seq = 0

  setAdapter(adapter: TransactionAdapter): void {
    this.adapter = adapter
  }

  register<P, R>(def: CommandDef<P, R>): () => void {
    this.commands.set(def.id, def)
    return () => {
      if (this.commands.get(def.id) === def) {
        this.commands.delete(def.id)
      }
    }
  }

  unregister(id: string): void {
    this.commands.delete(id)
  }

  get(id: string): CommandDef | undefined {
    return this.commands.get(id)
  }

  list(): CommandDescriptor[] {
    return Array.from(this.commands.values()).map((cmd) => ({
      id: cmd.id,
      title: cmd.title,
      description: cmd.description,
      params: cmd.params,
      risk: cmd.risk,
      mutatesDocument: cmd.mutatesDocument ?? true,
    }))
  }

  getLogs(limit = 100): readonly CommandLogEntry[] {
    if (this.logs.length <= limit) return [...this.logs]
    return this.logs.slice(this.logs.length - limit)
  }

  clearLogs(): void {
    this.logs.length = 0
  }

  hasActiveTransaction(): boolean {
    return this.txStack.length > 0
  }

  beginTransaction(label: string): string {
    this.seq += 1
    const tx: ActiveTransaction = {
      id: `tx_${this.seq}`,
      label,
      beforeSnapshot: this.adapter.captureSnapshot(),
      fileBackups: new Map(),
      changes: [],
    }
    this.txStack.push(tx)
    return tx.id
  }

  commitTransaction(): ChangeSummary {
    const tx = this.txStack.pop()
    if (!tx) return {}
    const merged = mergeChanges(tx.changes)
    if (this.txStack.length > 0) {
      const parent = this.txStack[this.txStack.length - 1]
      parent.changes.push(merged)
      for (const [path, content] of tx.fileBackups) {
        if (!parent.fileBackups.has(path)) {
          parent.fileBackups.set(path, content)
        }
      }
    } else if (hasAnyChange(merged)) {
      this.adapter.commitUndoStep?.(tx.label, tx.beforeSnapshot)
    }
    return merged
  }

  async rollbackTransaction(): Promise<void> {
    const tx = this.txStack.pop()
    if (!tx) return
    this.adapter.restoreSnapshot(tx.beforeSnapshot)
    if (tx.fileBackups.size > 0 && this.adapter.restoreFiles) {
      const entries: FileBackupEntry[] = []
      for (const [relativePath, previousContent] of tx.fileBackups) {
        entries.push({ relativePath, previousContent })
      }
      await this.adapter.restoreFiles(entries)
    }
  }

  async dispatch<R = unknown>(commandId: string, rawParams: unknown = {}): Promise<CommandResult<R>> {
    const started = performance.now()
    const cmd = this.commands.get(commandId)
    if (!cmd) {
      return this.recordLog(commandId, rawParams, started, {
        ok: false,
        code: 'command.notFound',
        message: `未找到指令 "${commandId}"`,
        hint: '请先调用工具清单确认可用的指令 ID',
      })
    }

    const mutates = cmd.mutatesDocument ?? true
    if (mutates && this.adapter.isPlaying()) {
      return this.recordLog(commandId, rawParams, started, {
        ok: false,
        code: 'play.locked',
        message: `试玩进行中，禁止执行修改工程的指令 "${commandId}"`,
        hint: '请先停止试玩，或只调用只读查询/试玩探针接口',
      })
    }

    const validated = validateBySchema(cmd.params, rawParams)
    if (!validated.ok) {
      const first = validated.issues[0]
      const detail = validated.issues
        .map((i) => `${i.path}: ${i.message}`)
        .join('；')
      return this.recordLog(commandId, rawParams, started, {
        ok: false,
        code: 'params.invalid',
        message: `指令 "${commandId}" 参数校验失败：${detail}`,
        hint: first?.hint ?? '请按指令的 FieldSchema 修正参数类型与范围',
      })
    }

    const autoTx = mutates && this.txStack.length === 0
    if (autoTx) {
      this.beginTransaction(cmd.title)
    }

    const ctx: CommandContext = {
      transactionLabel: this.txStack[this.txStack.length - 1]?.label ?? null,
      isPlaying: () => this.adapter.isPlaying(),
      recordFileBeforeChange: (relativePath, previousContent) => {
        const top = this.txStack[this.txStack.length - 1]
        if (top && !top.fileBackups.has(relativePath)) {
          top.fileBackups.set(relativePath, previousContent)
        }
      },
    }

    let result: CommandResult<R>
    try {
      result = (await cmd.run(ctx, validated.value)) as CommandResult<R>
    } catch (error) {
      console.error('[CommandBus]', commandId, rawParams, error)
      result = {
        ok: false,
        code: 'command.exception',
        message: error instanceof Error ? error.message : String(error),
        hint: '请检查参数或工程当前状态后重试',
      }
    }

    if (result.ok) {
      const top = this.txStack[this.txStack.length - 1]
      if (top) {
        top.changes.push(result.changed)
      }
      if (autoTx) {
        this.commitTransaction()
      }
    } else if (autoTx) {
      await this.rollbackTransaction()
    }

    return this.recordLog(commandId, validated.value, started, result)
  }

  private recordLog<R>(
    commandId: string,
    params: unknown,
    started: number,
    result: CommandResult<R>,
  ): CommandResult<R> {
    this.seq += 1
    this.logs.push({
      id: `log_${this.seq}`,
      commandId,
      params,
      ok: result.ok,
      ...(result.ok
        ? { changed: result.changed }
        : { code: result.code, message: result.message }),
      durationMs: Math.round((performance.now() - started) * 100) / 100,
      timestamp: Date.now(),
    })
    if (this.logs.length > 500) {
      this.logs.splice(0, this.logs.length - 500)
    }
    return result
  }
}

export const commandBus = new CommandBus()

function mergeChanges(items: ChangeSummary[]): ChangeSummary {
  const nodesAdded = new Set<string>()
  const nodesUpdated = new Set<string>()
  const nodesRemoved = new Set<string>()
  const assetsChanged = new Set<string>()
  const tablesChanged = new Set<string>()
  const filesChanged = new Set<string>()
  let pictureChanged = false
  let projectChanged = false
  const summaries: string[] = []

  for (const item of items) {
    item.nodesAdded?.forEach((id) => nodesAdded.add(id))
    item.nodesUpdated?.forEach((id) => nodesUpdated.add(id))
    item.nodesRemoved?.forEach((id) => nodesRemoved.add(id))
    item.assetsChanged?.forEach((id) => assetsChanged.add(id))
    item.tablesChanged?.forEach((id) => tablesChanged.add(id))
    item.filesChanged?.forEach((id) => filesChanged.add(id))
    if (item.pictureChanged) pictureChanged = true
    if (item.projectChanged) projectChanged = true
    if (item.summary) summaries.push(item.summary)
  }

  return {
    ...(nodesAdded.size > 0 ? { nodesAdded: Array.from(nodesAdded) } : {}),
    ...(nodesUpdated.size > 0 ? { nodesUpdated: Array.from(nodesUpdated) } : {}),
    ...(nodesRemoved.size > 0 ? { nodesRemoved: Array.from(nodesRemoved) } : {}),
    ...(assetsChanged.size > 0 ? { assetsChanged: Array.from(assetsChanged) } : {}),
    ...(tablesChanged.size > 0 ? { tablesChanged: Array.from(tablesChanged) } : {}),
    ...(filesChanged.size > 0 ? { filesChanged: Array.from(filesChanged) } : {}),
    ...(pictureChanged ? { pictureChanged: true } : {}),
    ...(projectChanged ? { projectChanged: true } : {}),
    ...(summaries.length > 0 ? { summary: summaries.join('；') } : {}),
  }
}

function hasAnyChange(c: ChangeSummary): boolean {
  return Boolean(
    (c.nodesAdded && c.nodesAdded.length > 0) ||
    (c.nodesUpdated && c.nodesUpdated.length > 0) ||
    (c.nodesRemoved && c.nodesRemoved.length > 0) ||
    (c.assetsChanged && c.assetsChanged.length > 0) ||
    (c.tablesChanged && c.tablesChanged.length > 0) ||
    (c.filesChanged && c.filesChanged.length > 0) ||
    c.pictureChanged ||
    c.projectChanged,
  )
}
