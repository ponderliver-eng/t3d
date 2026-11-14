import { Matrix4, Vector3 } from 'three'
import { create } from 'zustand'
import { getSpawn } from './spawn'
import { createFreshScene, createSeed } from './seed'
import { useAssetStore } from '../assets/library'
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
import { measureGroundSnap } from './viewportBridge'
import type {
  CameraView,
  GizmoMode,
  GizmoOrigin,
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
import type { ProjectDocument } from './document'
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
  gizmoOrigin: GizmoOrigin
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
  activeSceneId: string
  inspectedAssetId: string | null
  pendingRenameId: string | null
  renderBackend: string
  helpersVisible: boolean
  snapStep: number
  viewportStats: { objects: number, triangles: number }
  playPicture: ScenePicture | null

  setSelection: (ids: string[]) => void
  inspectAsset: (id: string | null) => void
  setGizmoMode: (mode: GizmoMode) => void
  setGizmoSpace: (space: GizmoSpace) => void
  setGizmoOrigin: (origin: GizmoOrigin) => void
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
  copySelection: () => void
  pasteClipboard: (parentId?: string | null) => void
  groupSelection: () => void
  snapSelectionToGround: () => void
  canPaste: boolean
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
  createScene: () => void
  openScene: (id: string) => void
  deleteScene: (id: string) => void
  flushActiveScene: () => void
  ensureSceneAsset: () => void
  requestRename: (id: string) => void
  loadDocument: (document: ProjectDocument) => void
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
  gizmoOrigin: 'pivot',
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
  activeSceneId: '',
  inspectedAssetId: null,
  pendingRenameId: null,
  renderBackend: '正在初始化',
  helpersVisible: true,
  snapStep: 1,
  canPaste: false,
  viewportStats: { objects: 0, triangles: 0 },
  playPicture: null,

  setSelection: ids => {
    const selection = ids.filter(id => get().nodes[id])
    set({
      selection,
      inspectedAssetId: selection.length > 0 ? null : get().inspectedAssetId,
    })
  },
  inspectAsset: id => set({ inspectedAssetId: id, selection: id ? [] : get().selection }),
  setGizmoMode: mode => {
    if (get().gizmoMode !== mode) set({ gizmoMode: mode })
  },
  setGizmoSpace: space => {
    if (get().gizmoSpace !== space) set({ gizmoSpace: space })
  },
  setGizmoOrigin: origin => {
    if (get().gizmoOrigin !== origin) set({ gizmoOrigin: origin })
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

  copySelection: () => {
    const state = get()
    const roots = selectionRoots(state.nodes, state.selection)
    if (roots.length === 0) {
      state.log('warn', '没有可拷贝的物体')
      return
    }
    const nodes: SceneNode[] = []
    const walk = (id: string, parentId: string | null) => {
      const source = state.nodes[id]
      const copy = structuredClone(source)
      copy.parentId = parentId
      nodes.push(copy)
      for (const child of childrenOf(state.nodes, id)) walk(child.id, id)
    }
    for (const id of roots) walk(id, null)
    clipboard = nodes
    set({ canPaste: true })
    state.log('info', `已拷贝 ${roots.length} 个物体`)
  },

  pasteClipboard: (parentId = null) => {
    if (!clipboard || clipboard.length === 0) {
      get().log('warn', '剪贴板是空的')
      return
    }
    let count = 0
    const ok = mutate(set, get, '粘贴', draft => {
      const created = pasteNodes(draft, parentId)
      draft.selection = created
      count = created.length
    })
    if (ok && count) get().log('info', `已粘贴 ${count} 个物体`)
  },

  groupSelection: () => {
    const roots = selectionRoots(get().nodes, get().selection)
    if (roots.length < 2) {
      get().log('warn', '成组至少要选中两个物体')
      return
    }
    const ok = mutate(set, get, '成组', draft => {
      const live = selectionRoots(draft.nodes, draft.selection)
      if (live.length < 2) return
      const sharedParent = draft.nodes[live[0]].parentId
      const parentId = live.every(id => draft.nodes[id].parentId === sharedParent) ? sharedParent : null
      const center = new Vector3()
      for (const id of live) center.add(new Vector3().setFromMatrixPosition(worldMatrix(draft.nodes, id)))
      center.multiplyScalar(1 / live.length)
      if (parentId) center.applyMatrix4(worldMatrix(draft.nodes, parentId).invert())
      const group = makeNode({
        id: crypto.randomUUID(),
        name: uniqueName(draft.nodes, '组'),
        kind: 'empty',
        parentId,
        order: nextOrder(draft.nodes, parentId),
        position: [center.x, center.y, center.z],
      })
      draft.nodes[group.id] = group
      for (const id of live) {
        const world = worldMatrix(draft.nodes, id)
        const local = new Matrix4().copy(worldMatrix(draft.nodes, group.id)).invert().multiply(world)
        draft.nodes[id].parentId = group.id
        draft.nodes[id].order = nextOrder(draft.nodes, group.id, id)
        writeLocalMatrix(draft.nodes[id], local)
      }
      draft.selection = [group.id]
    })
    if (ok) get().log('info', '已成组')
  },

  snapSelectionToGround: () => {
    const state = get()
    const ids = selectionRoots(state.nodes, state.selection).filter(id => !state.nodes[id]?.locked)
    if (ids.length === 0) {
      state.log('warn', '先选择要贴地的物体')
      return
    }
    const moves = measureGroundSnap(ids)
    if (moves.length === 0) {
      state.log('info', '物体已经贴在地面上')
      return
    }
    const ok = mutate(set, get, '贴地', draft => {
      for (const move of moves) {
        const node = draft.nodes[move.id]
        if (node) node.position = move.position
      }
    })
    if (ok) get().log('info', `已贴地 ${moves.length} 个物体`)
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
    get().createScene()
  },

  createScene: () => {
    if (get().playState !== 'stopped') {
      get().log('warn', '先停止试玩，再新建场景')
      return
    }
    if (get().gesture) get().endGesture()
    get().flushActiveScene()
    const existing = Object.values(useAssetStore.getState().assets).filter(asset => asset.kind === 'scene')
    const fresh = createFreshScene(uniqueSceneName(existing.map(scene => scene.name)))
    useAssetStore.getState().add({
      id: fresh.id,
      name: fresh.name,
      kind: 'scene',
      nodes: fresh.nodes,
      picture: fresh.picture,
    })
    set({
      activeSceneId: fresh.id,
      nodes: fresh.nodes,
      selection: [fresh.selectedId],
      past: [],
      future: [],
      gesture: null,
      playSnapshot: null,
      playPicture: null,
      picture: fresh.picture,
    })
    get().log('info', `已新建并打开场景 ${fresh.name}`)
  },

  openScene: id => {
    const asset = useAssetStore.getState().assets[id]
    if (!asset || asset.kind !== 'scene') return
    if (get().playState !== 'stopped') {
      get().log('warn', '先停止试玩，再打开场景')
      return
    }
    if (get().activeSceneId === id) return
    if (get().gesture) get().endGesture()
    get().flushActiveScene()
    set({
      activeSceneId: id,
      nodes: structuredClone(asset.nodes),
      picture: structuredClone(asset.picture),
      selection: [],
      past: [],
      future: [],
      gesture: null,
      playSnapshot: null,
      playPicture: null,
    })
    get().log('info', `已打开场景 ${asset.name}`)
  },

  deleteScene: id => {
    const scenes = Object.values(useAssetStore.getState().assets).filter(asset => asset.kind === 'scene')
    if (!scenes.some(scene => scene.id === id)) return
    if (scenes.length <= 1) {
      get().log('warn', '至少保留一个场景')
      return
    }
    if (get().playState !== 'stopped') {
      get().log('warn', '先停止试玩，再删除场景')
      return
    }
    if (get().activeSceneId === id) {
      const next = scenes.find(scene => scene.id !== id)
      if (!next) return
      set({
        activeSceneId: next.id,
        nodes: structuredClone(next.nodes),
        picture: structuredClone(next.picture),
        selection: [],
        past: [],
        future: [],
        gesture: null,
        playSnapshot: null,
        playPicture: null,
      })
    }
    useAssetStore.getState().remove(id)
    get().log('info', '已删除场景')
  },

  flushActiveScene: () => {
    const id = get().activeSceneId
    if (!id) return
    useAssetStore.getState().writeScene(id, structuredClone(get().nodes), structuredClone(get().picture))
  },

  ensureSceneAsset: () => {
    const scenes = Object.values(useAssetStore.getState().assets).filter(asset => asset.kind === 'scene')
    if (scenes.length === 0) {
      const id = crypto.randomUUID()
      useAssetStore.getState().add({
        id,
        name: '未命名场景',
        kind: 'scene',
        nodes: structuredClone(get().nodes),
        picture: structuredClone(get().picture),
      })
      set({ activeSceneId: id })
      return
    }
    if (!scenes.some(scene => scene.id === get().activeSceneId)) {
      const first = scenes[0]
      set({
        activeSceneId: first.id,
        nodes: structuredClone(first.nodes),
        picture: structuredClone(first.picture),
        selection: [],
      })
    }
  },

  requestRename: id => {
    if (!get().nodes[id]) return
    set({ pendingRenameId: id, selection: [id] })
  },

  loadDocument: document => {
    if (get().gesture) get().endGesture()
    const nodes = document.nodes
    set({
      nodes,
      selection: document.selection.filter(id => nodes[id]),
      past: [],
      future: [],
      gesture: null,
      playState: 'stopped',
      playSnapshot: null,
      playSelection: [],
      playPicture: null,
      picture: { ...DEFAULT_PICTURE, ...document.picture },
      activeSceneId: document.activeSceneId,
    })
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

function selectionRoots(nodes: Record<string, SceneNode>, selection: string[]): string[] {
  const selected = new Set(selection)
  return selection.filter(id => {
    let parent = nodes[id]?.parentId
    while (parent) {
      if (selected.has(parent)) return false
      parent = nodes[parent]?.parentId ?? null
    }
    return Boolean(nodes[id])
  })
}

let clipboard: SceneNode[] | null = null

function pasteNodes(draft: Draft, parentId: string | null): string[] {
  if (!clipboard) return []
  const map = new Map<string, string>()
  for (const node of clipboard) map.set(node.id, crypto.randomUUID())
  const roots: string[] = []
  for (const source of clipboard) {
    const copy = structuredClone(source)
    const nextId = map.get(source.id)
    if (!nextId) continue
    copy.id = nextId
    copy.locked = false
    const mappedParent = source.parentId ? map.get(source.parentId) ?? null : null
    copy.parentId = mappedParent ?? parentId
    if (!source.parentId) {
      copy.name = uniqueName(draft.nodes, source.name)
      copy.order = nextOrder(draft.nodes, copy.parentId)
      if (!parentId) copy.position = [copy.position[0] + 1, copy.position[1], copy.position[2]]
      roots.push(nextId)
    }
    draft.nodes[nextId] = copy
  }
  return roots
}

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
  useEditorStore.getState().createScene()
}

function uniqueSceneName(names: string[]): string {
  if (!names.includes('新场景')) return '新场景'
  let index = 2
  while (names.includes(`新场景 ${index}`)) index += 1
  return `新场景 ${index}`
}

export function primaryId(state: Pick<EditorState, 'selection'>): string | null {
  return state.selection[state.selection.length - 1] ?? null
}
