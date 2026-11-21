import { projectDirectoryPath, useProjectDirectory } from '../editor/project/disk'
import { electronBridge, joinProjectPath } from '../editor/project/electronBridge'
import type { AiTurnItem } from './agentLoop'

const DRAFT_STORAGE_KEY = 't3d:ai-history-draft'
const HISTORY_REL_PATH = '.t3d/ai-history.json'

interface SerializedAiHistory {
  version: 1
  updatedAt: string
  turns: AiTurnItem[]
}

function sanitizeTurnsForDraft(turns: AiTurnItem[]): AiTurnItem[] {
  // 草稿存入 localStorage 时限制条数并剥离过大的 base64 截图，防止超出存储配额
  return turns.slice(-50).map((turn) => {
    if (turn.imageDataUrl && turn.imageDataUrl.length > 60_000) {
      const { imageDataUrl: _omit, ...rest } = turn
      return rest
    }
    return turn
  })
}

export async function saveAiHistory(turns: AiTurnItem[]): Promise<void> {
  const payload: SerializedAiHistory = {
    version: 1,
    updatedAt: new Date().toISOString(),
    turns,
  }
  const dir = projectDirectoryPath()
  const bridge = electronBridge()
  if (dir && bridge?.fs?.writeTextFile) {
    try {
      await bridge.fs.writeTextFile(joinProjectPath(dir, HISTORY_REL_PATH), JSON.stringify(payload, null, 2))
    } catch {
      // 忽略写入异常
    }
    return
  }

  if (typeof localStorage !== 'undefined') {
    try {
      const draftPayload: SerializedAiHistory = {
        ...payload,
        turns: sanitizeTurnsForDraft(turns),
      }
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draftPayload))
    } catch {
      // 忽略存储配额错误
    }
  }
}

export function loadDraftAiHistory(): AiTurnItem[] {
  if (typeof localStorage === 'undefined') return []
  const raw = localStorage.getItem(DRAFT_STORAGE_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as Partial<SerializedAiHistory> | AiTurnItem[]
    const list = Array.isArray(parsed) ? parsed : parsed.turns
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

export async function loadProjectAiHistory(dir: string): Promise<AiTurnItem[] | null> {
  const bridge = electronBridge()
  if (!dir || !bridge?.fs?.exists || !bridge?.fs?.readTextFile) return null
  const filePath = joinProjectPath(dir, HISTORY_REL_PATH)
  try {
    const exists = await bridge.fs.exists(filePath)
    if (!exists) return null
    const raw = await bridge.fs.readTextFile(filePath)
    const parsed = JSON.parse(raw) as Partial<SerializedAiHistory> | AiTurnItem[]
    const list = Array.isArray(parsed) ? parsed : parsed.turns
    return Array.isArray(list) ? list : []
  } catch {
    return null
  }
}

export function serializeAiHistoryForExport(turns: AiTurnItem[]): string {
  const payload: SerializedAiHistory = {
    version: 1,
    updatedAt: new Date().toISOString(),
    turns,
  }
  return JSON.stringify(payload, null, 2)
}

export function parseImportedAiHistory(rawText: string): AiTurnItem[] {
  const parsed = JSON.parse(rawText) as Partial<SerializedAiHistory> | AiTurnItem[]
  const list = Array.isArray(parsed) ? parsed : parsed.turns
  if (!Array.isArray(list)) {
    throw new Error('无效的对话记录格式：缺少 turns 数组')
  }
  return list.filter(
    (item): item is AiTurnItem =>
      Boolean(item) && typeof item === 'object' && typeof item.id === 'string' && (item.role === 'user' || item.role === 'assistant'),
  )
}

let watcherStarted = false

export function initAiHistorySync(
  getTurns: () => AiTurnItem[],
  setTurns: (turns: AiTurnItem[]) => void,
): void {
  if (watcherStarted) return
  watcherStarted = true

  let lastDir: string | null = projectDirectoryPath()

  const syncForDirectory = async (dir: string | null, wasDraft: boolean) => {
    if (!dir) {
      setTurns(loadDraftAiHistory())
      return
    }
    const existing = await loadProjectAiHistory(dir)
    if (existing !== null) {
      setTurns(existing)
      return
    }
    // 新目录工程还没有对话记录：如果是从草稿另存为目录工程，自动把草稿对话迁移过去
    const current = getTurns()
    if (wasDraft && current.length > 0) {
      await saveAiHistory(current)
      return
    }
    setTurns([])
  }

  useProjectDirectory.subscribe((state, prev) => {
    const nextDir = projectDirectoryPath()
    if (nextDir !== lastDir || (state.active && !prev.active)) {
      const wasDraft = lastDir === null
      lastDir = nextDir
      void syncForDirectory(nextDir, wasDraft)
    }
  })

  if (lastDir) {
    void syncForDirectory(lastDir, false)
  } else {
    setTurns(loadDraftAiHistory())
  }
}
