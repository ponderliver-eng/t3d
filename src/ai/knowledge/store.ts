/**
 * 扩展层状态：把加载器接到 Electron 文件系统与当前工程目录，并保存最近一次扫描结果供面板与工具读取。
 */

import { create } from 'zustand'
import { projectDirectoryPath } from '../../editor/project/disk'
import { electronBridge } from '../../editor/project/electronBridge'
import {
  findKnowledgeEntry,
  joinPath,
  loadKnowledgeSnapshot,
  type KnowledgeInjection,
} from './loader'
import { builtinKnowledgeEntries } from './recipes'
import type { KnowledgeEntry, KnowledgeFs, KnowledgeSnapshot } from './types'

const STORAGE_DISABLED = 't3d.ai.knowledge.disabled'

function loadDisabledIds(): string[] {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_DISABLED) : null
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function emptySnapshot(): KnowledgeSnapshot {
  return {
    entries: builtinKnowledgeEntries(),
    shadowed: [],
    rules: [],
    requirements: null,
    projectRoot: null,
    userRoot: null,
    scannedAt: 0,
  }
}

export function knowledgeFs(): KnowledgeFs | null {
  const fs = electronBridge()?.fs
  if (!fs?.list || !fs.readTextFile || !fs.exists) return null
  return { list: fs.list, readTextFile: fs.readTextFile, exists: fs.exists }
}

let cachedUserRoot: string | null | undefined

/** 用户全局扩展目录：`<userData>/T3D/ai`（主进程路径白名单内） */
export async function userKnowledgeRoot(): Promise<string | null> {
  if (cachedUserRoot !== undefined) return cachedUserRoot
  try {
    const root = await electronBridge()?.app?.userLibraryRoot?.()
    cachedUserRoot = root ? joinPath(root, 'ai') : null
  } catch {
    cachedUserRoot = null
  }
  return cachedUserRoot
}

interface KnowledgeState {
  snapshot: KnowledgeSnapshot
  /** 用户关闭的扩展条目 ID（内置条目不可关闭：其目录位于静态系统提示中） */
  disabledIds: string[]
  /** 最近一轮对话实际注入的扩展内容 */
  lastInjection: KnowledgeInjection | null
  loading: boolean
  refresh: () => Promise<KnowledgeSnapshot>
  setEnabled: (id: string, enabled: boolean) => void
  setLastInjection: (injection: KnowledgeInjection | null) => void
}

export const useKnowledgeStore = create<KnowledgeState>((set, get) => ({
  snapshot: emptySnapshot(),
  disabledIds: loadDisabledIds(),
  lastInjection: null,
  loading: false,
  refresh: async () => {
    set({ loading: true })
    try {
      const snapshot = await loadKnowledgeSnapshot({
        fs: knowledgeFs(),
        builtin: builtinKnowledgeEntries(),
        projectRoot: projectDirectoryPath(),
        userRoot: await userKnowledgeRoot(),
      })
      set({ snapshot, loading: false })
      return snapshot
    } catch (error) {
      console.warn('[AI] 刷新扩展层失败：', error)
      set({ loading: false })
      return get().snapshot
    }
  },
  setEnabled: (id, enabled) => {
    const next = enabled ? get().disabledIds.filter((item) => item !== id) : Array.from(new Set([...get().disabledIds, id]))
    try {
      localStorage.setItem(STORAGE_DISABLED, JSON.stringify(next))
    } catch {
      // 忽略存储配额错误
    }
    set({ disabledIds: next })
  },
  setLastInjection: (injection) => set({ lastInjection: injection }),
}))

export function disabledKnowledgeIds(): ReadonlySet<string> {
  return new Set(useKnowledgeStore.getState().disabledIds)
}

export function lookupKnowledgeEntry(id: string): KnowledgeEntry | null {
  return findKnowledgeEntry(useKnowledgeStore.getState().snapshot, id, disabledKnowledgeIds())
}

export function listUsableKnowledge(): Array<{ id: string; kind: string; source: string; title: string; summary: string }> {
  const disabled = disabledKnowledgeIds()
  return useKnowledgeStore
    .getState()
    .snapshot.entries.filter((entry) => entry.source === 'builtin' || !disabled.has(entry.id))
    .map((entry) => ({ id: entry.id, kind: entry.kind, source: entry.source, title: entry.name, summary: entry.description }))
}
