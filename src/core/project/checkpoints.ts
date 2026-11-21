/**
 * 轻量工程快照（Checkpoint）：
 * 每轮 AI 执行前或用户手动打点时记录一份工程状态（支持星标里程碑）；
 * 目录工程同时将快照写入 `.t3d/checkpoints/` 以便跨会话追溯。
 */

import { electronBridge, joinProjectPath } from '../../editor/project/electronBridge'
import { projectDirectoryPath } from '../../editor/project/disk'
import { useEditorStore } from '../../editor/scene/store'
import type { SceneNode, ScenePicture } from '../../editor/scene/types'
import type { GameDatabase } from '../../gameplay/types'

export interface ProjectCheckpoint {
  id: string
  label: string
  starred: boolean
  createdAt: number
  nodeCount: number
  activeSceneId: string
  snapshot: {
    nodes: Record<string, SceneNode>
    selection: string[]
    picture: ScenePicture
    capabilities: Record<string, boolean>
    gameplayPacks: string[]
    gameDatabase: GameDatabase
  }
}

export interface CheckpointSummary {
  id: string
  label: string
  starred: boolean
  createdAt: number
  nodeCount: number
  activeSceneId: string
}

const MAX_CHECKPOINTS = 40
const checkpoints: ProjectCheckpoint[] = []
let seq = 0

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

  return toSummary(cp)
}

export function listCheckpoints(): CheckpointSummary[] {
  return [...checkpoints].reverse().map(toSummary)
}

export function toggleCheckpointStar(id: string): CheckpointSummary | null {
  const found = checkpoints.find((c) => c.id === id)
  if (!found) return null
  found.starred = !found.starred
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
  useEditorStore.setState({
    nodes: structuredClone(found.snapshot.nodes),
    selection: [...found.snapshot.selection],
    picture: structuredClone(found.snapshot.picture),
    capabilities: { ...found.snapshot.capabilities },
    gameplayPacks: [...found.snapshot.gameplayPacks],
    gameDatabase: structuredClone(found.snapshot.gameDatabase),
  })
  return { ok: true, summary: toSummary(found) }
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
