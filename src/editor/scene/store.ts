import { Matrix4 } from 'three'
import { create } from 'zustand'
import { getSpawn } from './spawn'
import { createSeed } from './seed'
import {
  childrenOf,
  makeNode,
  nextOrder,
  spawnPosition,
  subtreeIds,
  uniqueName,
  KIND_LABEL,
} from './kinds'
import { isUnder, worldMatrix, writeLocalMatrix } from './transform'
import type {
  CameraView,
  GizmoMode,
  GizmoSpace,
  HistoryEntry,
  LogLevel,
  NodeKind,
  PbrSlot,
  PlayState,
  SceneNode,
  ScenePicture,
  SidePanel,
  Vec3,
} from './types'
import { DEFAULT_PICTURE } from './types'

interface Gesture {
  label: string
  before: Record<string, SceneNode>
  beforeSelection: string[]
  beforePicture: ScenePicture
}

interface Draft {
  nodes: Record<string, SceneNode>
  selection: string[]
}

const seed = createSeed()

function cloneNodes(nodes: Record<string, SceneNode>): Record<string, SceneNode> {
  return structuredClone(nodes)
}

function sameNodes(a: Record<string, SceneNode>, b: Record<string, SceneNode>): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function sameSelection(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index])
}

export interface EditorState {
  nodes: Record<string, SceneNode>
  selection: string[]
  gizmoMode: GizmoMode
  gizmoSpace: GizmoSpace
  snap: boolean
  gridVisible: boolean
  playState: PlayState
  playSnapshot: Record<string, SceneNode> | null
  playSelection: string[]
  past: HistoryEntry[]
  future: HistoryEntry[]
  gesture: Gesture | null
  logs: { id: string; level: LogLevel; message: string; time: number }[]
  notice: string | null
  projectionLabel: string
  sidePanel: SidePanel
  cameraNonce: number
  cameraAction: 'focus' | 'focus-all' | 'view'
  cameraView: CameraView
  picture: ScenePicture
  renderBackend: string
  helpersVisible: boolean
  snapStep: number
  viewportStats: { objects: number, triangles: number }
  playPicture: ScenePicture | null

  setSelection: (ids: string[]) => void
  setGizmoMode: (mode: GizmoMode) => void
  setGizmoSpace: (space: GizmoSpace) => void
  toggleSnap: () => void
  toggleGrid: () => void
  setSidePanel: (panel: SidePanel) => void
  setProjectionLabel: (label: string) => void
  requestFocus: () => void
  requestFocusAll: () => void
  requestView: (view: CameraView) => void
  beginGesture: (label: string) => void
  endGesture: () => void
  updateNode: (id: string, patch: Partial<SceneNode>) => void
  createNode: (kind: NodeKind, parentId?: string | null) => void
  deleteSelection: () => void
  duplicateSelection: () => void
  reparent: (id: string, parentId: string | null) => void
  toggleVisible: (id: string) => void
  toggleLocked: (id: string) => void
  selectAll: () => void
  undo: () => void
  redo: () => void
  play: () => void
  pause: () => void
  stop: () => void
  newScene: () => void
  clearLogs: () => void
  log: (level: LogLevel, message: string) => void
  notify: (message: string) => void
  setPicture: (patch: Partial<ScenePicture>) => void
  setRenderBackend: (label: string) => void
  setHelpersVisible: (visible: boolean) => void
  setSnapStep: (step: number) => void
  setViewportStats: (objects: number, triangles: number) => void
  spawnModel: (assetId: string, name: string, slots: PbrSlot[], point: Vec3) => void
  spawnPrefab: (name: string, source: SceneNode[], point: Vec3) => void
  assignMap: (id: string, assetId: string) => void
  assignMaterial: (id: string, slot: PbrSlot) => void
}

function pushHistory(
  set: (partial: Partial<EditorState> | ((state: EditorState) => Partial<EditorState>)) => void,
  entry: HistoryEntry,
) {
  set(state => ({
    past: [...state.past, entry].slice(-80),
    future: [],
  }))
}

export const useEditorStore = create<EditorState>((set, get) => ({
  nodes: seed.nodes,
  selection: [seed.selectedId],
  gizmoMode: 'translate',
  gizmoSpace: 'world',
  snap: false,
  gridVisible: true,
  playState: 'stopped',
  playSnapshot: null,
  playSelection: [],
  past: [],
  future: [],
  gesture: null,
  logs: [
    { id: 'boot', level: 'info', message: '编辑器已就绪', time: Date.now() },
    {
      id: 'boot-help',
      level: 'info',
      message: '视口：右键环顾，按住右键用 WASD 或方向键飞行，中键平移，滚轮缩放，Alt+左键绕目标旋转。',
      time: Date.now(),
    },
  ],
  notice: null,
  projectionLabel: '透视',
  sidePanel: 'inspector',
  cameraNonce: 0,
  cameraAction: 'focus',
  cameraView: 'persp',
  picture: structuredClone(DEFAULT_PICTURE),
  renderBackend: '正在初始化',
  helpersVisible: true,
  snapStep: 1,
  viewportStats: { objects: 0, triangles: 0 },
  playPicture: null,

  setSelection: ids => set({ selection: ids.filter(id => get().nodes[id]) }),
  setGizmoMode: mode => {
    if (get().gizmoMode !== mode) set({ gizmoMode: mode })
  },
  setGizmoSpace: space => {
    if (get().gizmoSpace !== space) set({ gizmoSpace: space })
  },
  toggleSnap: () => set(state => ({ snap: !state.snap })),
  toggleGrid: () => set(state => ({ gridVisible: !state.gridVisible })),
  setSidePanel: panel => {
    if (get().sidePanel !== panel) set({ sidePanel: panel })
  },
  setProjectionLabel: label => {
    if (get().projectionLabel !== label) set({ projectionLabel: label })
  },
  requestFocus: () => set(state => ({ cameraNonce: state.cameraNonce + 1, cameraAction: 'focus' })),
  requestFocusAll: () => set(state => ({ cameraNonce: state.cameraNonce + 1, cameraAction: 'focus-all' })),
  requestView: view => set(state => ({
    cameraNonce: state.cameraNonce + 1,
    cameraAction: 'view',
    cameraView: view,
  })),

  beginGesture: label => {
    if (get().gesture) get().endGesture()
    set({
      gesture: {
        label,
        before: cloneNodes(get().nodes),
        beforeSelection: get().selection.slice(),
        beforePicture: structuredClone(get().picture),
      },
    })
  },

  endGesture: () => {
    const gesture = get().gesture
    if (!gesture) return
    const after = cloneNodes(get().nodes)
    const afterSelection = get().selection.slice()
    set({ gesture: null })
    if (get().playState !== 'stopped') return
    if (sameNodes(gesture.before, after) && sameSelection(gesture.beforeSelection, afterSelection) && sameJson(gesture.beforePicture, get().picture)) return
    pushHistory(set, {
      label: gesture.label,
      before: gesture.before,
      after,
      beforeSelection: gesture.beforeSelection,
      afterSelection,
      beforePicture: gesture.beforePicture,
      afterPicture: structuredClone(get().picture),
    })
  },

  updateNode: (id, patch) => {
    const node = get().nodes[id]
    if (!node) return
    const touchesTransform = patch.position !== undefined || patch.rotation !== undefined || patch.scale !== undefined
    if (node.locked && touchesTransform) return
    const next: SceneNode = { ...node, ...patch, id: node.id, kind: node.kind }
    set(state => ({ nodes: { ...state.nodes, [id]: next } }))
  },

  createNode: (kind, parentId = null) => {
    let created = ''
    const ok = mutate(set, get, `创建${KIND_LABEL[kind]}`, draft => {
      const parent = parentId && draft.nodes[parentId] ? parentId : null
      const id = crypto.randomUUID()
      const name = uniqueName(draft.nodes, KIND_LABEL[kind])
      draft.nodes[id] = makeNode({
        id,
        name,
        kind,
        parentId: parent,
        order: nextOrder(draft.nodes, parent),
        position: spawnPosition(kind, parent, getSpawn()),
        rotation: kind === 'plane' ? [-90, 0, 0] : [0, 0, 0],
      })
      draft.selection = [id]
      created = name
    })
    if (ok && created) get().log('info', `已创建 ${created}`)
  },

  deleteSelection: () => {
    const state = get()
    const selected = new Set(state.selection)
    const roots = state.selection.filter(id => {
      let parent = state.nodes[id]?.parentId
      while (parent) {
        if (selected.has(parent)) return false
        parent = state.nodes[parent]?.parentId ?? null
      }
      return Boolean(state.nodes[id])
    })
    const remove = new Set<string>()
    const blocked: string[] = []
    for (const id of roots) {
      const sub = subtreeIds(state.nodes, id)
      if (sub.some(childId => state.nodes[childId]?.locked)) blocked.push(state.nodes[id].name)
      else sub.forEach(childId => remove.add(childId))
    }
    if (blocked.length) get().log('warn', `已跳过锁定的物体：${blocked.join('、')}`)
    if (remove.size === 0) return
    const ok = mutate(set, get, '删除', draft => {
      for (const id of remove) delete draft.nodes[id]
      draft.selection = []
    })
    if (ok) get().log('info', `已删除 ${remove.size} 个物体`)
  },

  duplicateSelection: () => {
    let count = 0
    const ok = mutate(set, get, '复制', draft => {
      const selected = new Set(draft.selection)
      const roots = draft.selection.filter(id => {
        let parent = draft.nodes[id]?.parentId
        while (parent) {
          if (selected.has(parent)) return false
          parent = draft.nodes[parent]?.parentId ?? null
        }
        return Boolean(draft.nodes[id])
      })
      const created: string[] = []
      const cloneSubtree = (id: string, parentId: string | null, isRoot: boolean): string => {
        const source = draft.nodes[id]
        const childIds = childrenOf(draft.nodes, id).map(child => child.id)
        const nextId = crypto.randomUUID()
        const copy = structuredClone(source)
        copy.id = nextId
        copy.parentId = parentId
        copy.name = uniqueName(draft.nodes, source.name)
        copy.order = nextOrder(draft.nodes, parentId)
        copy.locked = false
        if (isRoot) copy.position = [copy.position[0] + 1, copy.position[1], copy.position[2]]
        draft.nodes[nextId] = copy
        for (const childId of childIds) cloneSubtree(childId, nextId, false)
        return nextId
      }
      for (const id of roots) created.push(cloneSubtree(id, draft.nodes[id].parentId, true))
      draft.selection = created
      count = created.length
    })
    if (ok && count) get().log('info', `已复制 ${count} 个物体`)
  },

  reparent: (id, parentId) => {
    const node = get().nodes[id]
    if (!node) return
    if (node.locked) {
      get().log('warn', `${node.name} 已锁定`)
      return
    }
    if (parentId === id || (parentId && isUnder(get().nodes, parentId, id))) {
      get().log('warn', '不能把物体拖成自己的子级')
      return
    }
    if (node.parentId === parentId) return
    mutate(set, get, '更改父子', draft => {
      const current = draft.nodes[id]
      const world = worldMatrix(draft.nodes, id)
      const parentWorld = parentId ? worldMatrix(draft.nodes, parentId) : null
      const local = parentWorld ? new Matrix4().copy(parentWorld).invert().multiply(world) : world
      current.parentId = parentId
      current.order = nextOrder(draft.nodes, parentId, id)
      writeLocalMatrix(current, local)
    })
  },

  toggleVisible: id => {
    const node = get().nodes[id]
    if (!node) return
    mutate(set, get, node.visible ? '隐藏' : '显示', draft => {
      draft.nodes[id].visible = !draft.nodes[id].visible
    })
  },

  toggleLocked: id => {
    const node = get().nodes[id]
    if (!node) return
    mutate(set, get, node.locked ? '解锁' : '锁定', draft => {
      draft.nodes[id].locked = !draft.nodes[id].locked
    })
  },

  selectAll: () => set({ selection: Object.keys(get().nodes) }),

  undo: () => {
    if (get().playState !== 'stopped') {
      get().log('warn', '试玩中不能撤销')
      return
    }
    if (get().gesture) get().endGesture()
    const past = get().past
    const entry = past[past.length - 1]
    if (!entry) return
    set({
      nodes: cloneNodes(entry.before),
      selection: entry.beforeSelection.filter(id => entry.before[id]),
      past: past.slice(0, -1),
      future: [...get().future, entry],
      picture: structuredClone(entry.beforePicture),
    })
  },

  redo: () => {
    if (get().playState !== 'stopped') {
      get().log('warn', '试玩中不能重做')
      return
    }
    if (get().gesture) {
      get().endGesture()
      return
    }
    const future = get().future
    const entry = future[future.length - 1]
    if (!entry) return
    set({
      nodes: cloneNodes(entry.after),
      selection: entry.afterSelection.filter(id => entry.after[id]),
      future: future.slice(0, -1),
      past: [...get().past, entry],
      picture: structuredClone(entry.afterPicture),
    })
  },

  play: () => {
    if (get().gesture) get().endGesture()
    const state = get().playState
    if (state === 'paused') {
      set({ playState: 'playing' })
      get().log('info', '继续试玩')
      return
    }
    if (state === 'playing') return
    set({
      playState: 'playing',
      playSnapshot: cloneNodes(get().nodes),
      playSelection: get().selection.slice(),
      playPicture: structuredClone(get().picture),
    })
    get().log('info', '开始试玩。停止后场景会回到试玩前。')
  },

  pause: () => {
    const state = get().playState
    if (state === 'playing') set({ playState: 'paused' })
    else if (state === 'paused') set({ playState: 'playing' })
  },

  stop: () => {
    const snapshot = get().playSnapshot
    const picture = get().playPicture
    if (get().playState === 'stopped' || !snapshot) return
    set({
      gesture: null,
      playState: 'stopped',
      nodes: cloneNodes(snapshot),
      selection: get().playSelection.filter(id => snapshot[id]),
      playSnapshot: null,
      picture: picture ? structuredClone(picture) : get().picture,
      playPicture: null,
    })
    get().log('info', '已停止试玩，场景已恢复')
  },

  newScene: () => {
    if (get().playState !== 'stopped') {
      get().log('warn', '先停止试玩，再新建场景')
      return
    }
    if (get().gesture) get().endGesture()
    const next = createSeed()
    set({
      nodes: next.nodes,
      selection: [next.selectedId],
      past: [],
      future: [],
      gesture: null,
      playSnapshot: null,
      playPicture: null,
      picture: structuredClone(DEFAULT_PICTURE),
    })
    get().log('info', '已新建场景')
  },

  clearLogs: () => set({ logs: [] }),

  log: (level, message) => {
    const entry = { id: crypto.randomUUID(), level, message, time: Date.now() }
    set(state => ({ logs: [...state.logs, entry].slice(-300) }))
    if (level !== 'info') get().notify(message)
  },

  notify: message => {
    set({ notice: message })
    window.setTimeout(() => {
      if (get().notice === message) set({ notice: null })
    }, 2600)
  },

  setPicture: patch => set({ picture: { ...get().picture, ...patch } }),
  setRenderBackend: label => {
    if (get().renderBackend !== label) set({ renderBackend: label })
  },
  setHelpersVisible: visible => set({ helpersVisible: visible }),
  setSnapStep: step => set({ snapStep: Math.max(0.01, step) }),
  setViewportStats: (objects, triangles) => {
    const current = get().viewportStats
    if (current.objects === objects && current.triangles === triangles) return
    set({ viewportStats: { objects, triangles } })
  },

  spawnModel: (assetId, name, slots, point) => {
    let created = ''
    const ok = mutate(set, get, `放置${name}`, draft => {
      const id = crypto.randomUUID()
      created = uniqueName(draft.nodes, name)
      draft.nodes[id] = makeNode({
        id,
        name: created,
        kind: 'model',
        assetId,
        slots: structuredClone(slots),
        position: [point[0], point[1], point[2]],
      })
      draft.selection = [id]
    })
    if (ok && created) get().log('info', `已放入场景 ${created}`)
  },

  spawnPrefab: (name, source, point) => {
    const ok = mutate(set, get, `放置${name}`, draft => {
      const map = new Map<string, string>()
      for (const node of source) map.set(node.id, crypto.randomUUID())
      const created: string[] = []
      for (const node of source) {
        const copy = structuredClone(node)
        const nextId = map.get(node.id)
        if (!nextId) continue
        copy.id = nextId
        copy.parentId = node.parentId && map.has(node.parentId) ? map.get(node.parentId) ?? null : null
        copy.locked = false
        if (!copy.parentId) {
          copy.position = [point[0], copy.position[1], point[2]]
          copy.name = uniqueName(draft.nodes, name)
          created.push(copy.id)
        }
        draft.nodes[copy.id] = copy
      }
      draft.selection = created
    })
    if (ok) get().log('info', `已放入场景 ${name}`)
  },

  assignMap: (id, assetId) => {
    const node = get().nodes[id]
    if (!node) return
    get().beginGesture('指定贴图')
    if (node.kind === 'model' && node.slots.length > 0) {
      get().updateNode(id, {
        slots: node.slots.map((slot, index) => index === 0 ? { ...slot, mapAssetId: assetId } : slot),
      })
    } else {
      get().updateNode(id, { mapAssetId: assetId })
    }
    get().endGesture()
  },

  assignMaterial: (id, slot) => {
    const node = get().nodes[id]
    if (!node) return
    get().beginGesture('指定材质')
    if (node.kind === 'model' && node.slots.length > 0) {
      get().updateNode(id, {
        slots: node.slots.map(item => ({ ...slot, name: item.name })),
      })
    } else {
      get().updateNode(id, {
        color: slot.color,
        metalness: slot.metalness,
        roughness: slot.roughness,
        emissive: slot.emissive,
        emissiveIntensity: slot.emissiveIntensity,
        opacity: slot.opacity,
        ao: slot.ao,
        mapAssetId: slot.mapAssetId,
        normalAssetId: slot.normalAssetId,
        roughnessAssetId: slot.roughnessAssetId,
        metalnessAssetId: slot.metalnessAssetId,
        emissiveAssetId: slot.emissiveAssetId,
        aoAssetId: slot.aoAssetId,
      })
    }
    get().endGesture()
  },
}))

function mutate(
  set: (partial: Partial<EditorState> | ((state: EditorState) => Partial<EditorState>)) => void,
  get: () => EditorState,
  label: string,
  fn: (draft: Draft) => void,
): boolean {
  if (get().playState !== 'stopped') {
    get().log('warn', '试玩中不能改场景结构，停止后再编辑')
    return false
  }
  if (get().gesture) get().endGesture()
  const before = cloneNodes(get().nodes)
  const beforeSelection = get().selection.slice()
  const draft: Draft = { nodes: cloneNodes(before), selection: beforeSelection.slice() }
  fn(draft)
  draft.selection = draft.selection.filter(id => draft.nodes[id])
  set({ nodes: draft.nodes, selection: draft.selection })
  if (sameNodes(before, draft.nodes) && sameSelection(beforeSelection, draft.selection)) return true
  const picture = structuredClone(get().picture)
  pushHistory(set, {
    label,
    before,
    after: cloneNodes(draft.nodes),
    beforeSelection,
    afterSelection: draft.selection.slice(),
    beforePicture: picture,
    afterPicture: picture,
  })
  return true
}

export function askNewScene() {
  const state = useEditorStore.getState()
  if (state.playState !== 'stopped') {
    state.log('warn', '先停止试玩，再新建场景')
    return
  }
  const dirty = state.past.length > 0 || state.future.length > 0 || state.gesture !== null
  if (dirty && !window.confirm('新建场景会替换当前场景，并清掉撤销记录。继续？')) return
  state.newScene()
}

export function primaryId(state: Pick<EditorState, 'selection'>): string | null {
  return state.selection[state.selection.length - 1] ?? null
}
