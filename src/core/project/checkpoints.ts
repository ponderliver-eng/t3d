/**
 * 轻量工程快照（Checkpoint）：
 * 每轮 AI 执行前或用户手动打点时记录一份工程状态（支持星标里程碑）；
 * 目录工程同时将快照写入 `.t3d/checkpoints/` 以便跨会话追溯。
 */

import { create } from 'zustand'
import { electronBridge, joinProjectPath } from '../../editor/project/electronBridge'
import { projectDirectoryPath } from '../../editor/project/disk'
import { useEditorStore } from '../../editor/scene/store'
import type { SceneNode, ScenePicture } from '../../editor/scene/types'
import type { GameDatabase } from '../../gameplay/types'

export interface ProjectSnapshotData {
  nodes: Record<string, SceneNode>
  selection: string[]
  picture: ScenePicture
  capabilities: Record<string, boolean>
  gameplayPacks: string[]
  gameDatabase: GameDatabase
}

export interface ProjectCheckpoint {
  id: string
  label: string
  starred: boolean
  createdAt: number
  nodeCount: number
  activeSceneId: string
  snapshot: ProjectSnapshotData
}

export interface CheckpointSummary {
  id: string
  label: string
  starred: boolean
  createdAt: number
  nodeCount: number
  activeSceneId: string
}

export interface ExperimentBranch {
  id: string
  name: string
  baseCheckpointId?: string
  createdAt: number
  nodeCount: number
  snapshot: ProjectSnapshotData
}

export interface BranchSummary {
  id: string
  name: string
  baseCheckpointId?: string
  createdAt: number
  nodeCount: number
  isActive: boolean
}

export const useCheckpointUiStore = create<{ revision: number; bump: () => void }>((set) => ({
  revision: 0,
  bump: () => set((state) => ({ revision: state.revision + 1 })),
}))

const MAX_CHECKPOINTS = 40
const checkpoints: ProjectCheckpoint[] = []
const branches = new Map<string, ExperimentBranch>()
let currentBranchId = 'main'
let seq = 0

function captureSnapshot(): { nodeCount: number; activeSceneId: string; snapshot: ProjectSnapshotData } {
  const s = useEditorStore.getState()
  return {
    nodeCount: Object.keys(s.nodes).length,
    activeSceneId: s.activeSceneId,
    snapshot: {
      nodes: structuredClone(s.nodes),
      selection: [...s.selection],
      picture: structuredClone(s.picture),
      capabilities: { ...s.capabilities },
      gameplayPacks: [...s.gameplayPacks],
      gameDatabase: structuredClone(s.gameDatabase),
    },
  }
}

function applySnapshot(snapshot: ProjectSnapshotData) {
  useEditorStore.setState({
    nodes: structuredClone(snapshot.nodes),
    selection: [...snapshot.selection],
    picture: structuredClone(snapshot.picture),
    capabilities: { ...snapshot.capabilities },
    gameplayPacks: [...snapshot.gameplayPacks],
    gameDatabase: structuredClone(snapshot.gameDatabase),
  })
}

function ensureMainBranch() {
  if (!branches.has('main')) {
    const cap = captureSnapshot()
    branches.set('main', {
      id: 'main',
      name: '主线 (main)',
      createdAt: Date.now(),
      nodeCount: cap.nodeCount,
      snapshot: cap.snapshot,
    })
  }
}

export async function createCheckpoint(label: string, starred = false): Promise<CheckpointSummary> {
  const s = useEditorStore.getState()
  seq += 1
  const id = `cp_${Date.now().toString(36)}_${seq}`
  const cp: ProjectCheckpoint = {
    id,
    label: label.trim() || `快照 #${seq}`,
    starred,
    createdAt: Date.now(),
    nodeCount: Object.keys(s.nodes).length,
    activeSceneId: s.activeSceneId,
    snapshot: {
      nodes: structuredClone(s.nodes),
      selection: [...s.selection],
      picture: structuredClone(s.picture),
      capabilities: { ...s.capabilities },
      gameplayPacks: [...s.gameplayPacks],
      gameDatabase: structuredClone(s.gameDatabase),
    },
  }
  checkpoints.push(cp)
  trimCheckpoints()

  const dir = projectDirectoryPath()
  const bridge = electronBridge()
  if (dir && bridge) {
    const target = joinProjectPath(dir, `.t3d/checkpoints/${id}.json`)
    await bridge.fs.writeTextFile(target, JSON.stringify(cp)).catch(() => undefined)
  }

  useCheckpointUiStore.getState().bump()
  return toSummary(cp)
}

export function listCheckpoints(): CheckpointSummary[] {
  return [...checkpoints].reverse().map(toSummary)
}

export function toggleCheckpointStar(id: string): CheckpointSummary | null {
  const found = checkpoints.find((c) => c.id === id)
  if (!found) return null
  found.starred = !found.starred
  useCheckpointUiStore.getState().bump()
  return toSummary(found)
}

export function restoreCheckpoint(id: string): { ok: boolean; summary?: CheckpointSummary; error?: string } {
  const s = useEditorStore.getState()
  if (s.playState !== 'stopped') {
    return { ok: false, error: '试玩进行中，请先停止试玩再恢复快照' }
  }
  const found = checkpoints.find((c) => c.id === id)
  if (!found) {
    return { ok: false, error: `未找到快照 "${id}"` }
  }
  applySnapshot(found.snapshot)
  useCheckpointUiStore.getState().bump()
  return { ok: true, summary: toSummary(found) }
}

export function createBranch(name: string, fromCheckpointId?: string): { ok: boolean; branch?: BranchSummary; error?: string } {
  const s = useEditorStore.getState()
  if (s.playState !== 'stopped') {
    return { ok: false, error: '试玩进行中，请先停止试玩再创建分支' }
  }
  ensureMainBranch()
  // 保存当前分支的最新工作状态
  const cur = branches.get(currentBranchId)
  if (cur) {
    const cap = captureSnapshot()
    cur.snapshot = cap.snapshot
    cur.nodeCount = cap.nodeCount
  }

  let baseSnapshot: ProjectSnapshotData
  let baseNodeCount: number
  if (fromCheckpointId) {
    const cp = checkpoints.find(c => c.id === fromCheckpointId)
    if (!cp) return { ok: false, error: `未找到基线快照 "${fromCheckpointId}"` }
    baseSnapshot = structuredClone(cp.snapshot)
    baseNodeCount = cp.nodeCount
  } else {
    const cap = captureSnapshot()
    baseSnapshot = cap.snapshot
    baseNodeCount = cap.nodeCount
  }

  seq += 1
  const id = `exp_${Date.now().toString(36)}_${seq}`
  const branch: ExperimentBranch = {
    id,
    name: name.trim() || `实验分支 #${seq}`,
    baseCheckpointId: fromCheckpointId,
    createdAt: Date.now(),
    nodeCount: baseNodeCount,
    snapshot: baseSnapshot,
  }
  branches.set(id, branch)
  currentBranchId = id
  applySnapshot(branch.snapshot)
  useCheckpointUiStore.getState().bump()
  return { ok: true, branch: toBranchSummary(branch) }
}

export function switchBranch(branchId: string): { ok: boolean; branch?: BranchSummary; error?: string } {
  const s = useEditorStore.getState()
  if (s.playState !== 'stopped') {
    return { ok: false, error: '试玩进行中，请先停止试玩再切换分支' }
  }
  ensureMainBranch()
  const target = branches.get(branchId)
  if (!target) return { ok: false, error: `未找到分支 "${branchId}"` }
  if (currentBranchId === branchId) return { ok: true, branch: toBranchSummary(target) }

  const cur = branches.get(currentBranchId)
  if (cur) {
    const cap = captureSnapshot()
    cur.snapshot = cap.snapshot
    cur.nodeCount = cap.nodeCount
  }
  currentBranchId = branchId
  applySnapshot(target.snapshot)
  useCheckpointUiStore.getState().bump()
  return { ok: true, branch: toBranchSummary(target) }
}

export function promoteBranchToMain(branchId: string): { ok: boolean; error?: string } {
  const s = useEditorStore.getState()
  if (s.playState !== 'stopped') return { ok: false, error: '试玩进行中，无法设为主线' }
  ensureMainBranch()
  const target = branches.get(branchId)
  if (!target) return { ok: false, error: `未找到分支 "${branchId}"` }
  const cap = currentBranchId === branchId ? captureSnapshot() : { nodeCount: target.nodeCount, snapshot: target.snapshot }
  const main = branches.get('main')!
  main.snapshot = structuredClone(cap.snapshot)
  main.nodeCount = cap.nodeCount
  currentBranchId = 'main'
  applySnapshot(main.snapshot)
  useCheckpointUiStore.getState().bump()
  return { ok: true }
}

export function deleteBranch(branchId: string): boolean {
  if (branchId === 'main' || branchId === currentBranchId) return false
  const ok = branches.delete(branchId)
  if (ok) useCheckpointUiStore.getState().bump()
  return ok
}

export function listBranches(): BranchSummary[] {
  ensureMainBranch()
  return [...branches.values()].map(toBranchSummary)
}

export function activeBranchId(): string {
  return currentBranchId
}

function toBranchSummary(branch: ExperimentBranch): BranchSummary {
  return {
    id: branch.id,
    name: branch.name,
    baseCheckpointId: branch.baseCheckpointId,
    createdAt: branch.createdAt,
    nodeCount: branch.nodeCount,
    isActive: branch.id === currentBranchId,
  }
}

function toSummary(cp: ProjectCheckpoint): CheckpointSummary {
  return {
    id: cp.id,
    label: cp.label,
    starred: cp.starred,
    createdAt: cp.createdAt,
    nodeCount: cp.nodeCount,
    activeSceneId: cp.activeSceneId,
  }
}

function trimCheckpoints(): void {
  if (checkpoints.length <= MAX_CHECKPOINTS) return
  for (let i = 0; i < checkpoints.length && checkpoints.length > MAX_CHECKPOINTS; i += 1) {
    if (!checkpoints[i].starred) {
      checkpoints.splice(i, 1)
      i -= 1
    }
  }
}
