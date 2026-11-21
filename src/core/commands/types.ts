import type { ObjectFieldSchema } from '../schema/fieldSchema'

export interface ChangeSummary {
  nodesAdded?: string[]
  nodesUpdated?: string[]
  nodesRemoved?: string[]
  assetsChanged?: string[]
  tablesChanged?: string[]
  filesChanged?: string[]
  pictureChanged?: boolean
  projectChanged?: boolean
  summary?: string
}

export type CommandResult<R = unknown> =
  | { ok: true; value: R; changed: ChangeSummary }
  | { ok: false; code: string; message: string; hint?: string }

export interface CommandContext {
  readonly transactionLabel: string | null
  /** 试玩状态：playing 时拒绝文档修改指令 */
  isPlaying(): boolean
  /** 记录一条需要随事务回滚的磁盘文件变更（写入前调用） */
  recordFileBeforeChange?(relativePath: string, previousContent: string | null): void
}

export interface CommandDef<P = unknown, R = unknown> {
  id: string
  title: string
  description?: string
  params: ObjectFieldSchema
  risk: 'safe' | 'confirm'
  /** 默认 true。设为 true 时，试玩期间（playState === 'playing'）禁止执行 */
  mutatesDocument?: boolean
  run(ctx: CommandContext, params: P): CommandResult<R> | Promise<CommandResult<R>>
}

export interface CommandDescriptor {
  id: string
  title: string
  description?: string
  params: ObjectFieldSchema
  risk: 'safe' | 'confirm'
  mutatesDocument: boolean
}

export interface CommandLogEntry {
  id: string
  commandId: string
  params: unknown
  ok: boolean
  code?: string
  message?: string
  changed?: ChangeSummary
  durationMs: number
  timestamp: number
}

export interface FileBackupEntry {
  relativePath: string
  previousContent: string | null
}

export interface TransactionAdapter {
  isPlaying(): boolean
  captureSnapshot(): unknown
  restoreSnapshot(snapshot: unknown): void
  commitUndoStep?(label: string, beforeSnapshot: unknown): void
  restoreFiles?(files: FileBackupEntry[]): Promise<void> | void
}
