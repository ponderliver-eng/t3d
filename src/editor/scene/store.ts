import { Quaternion, Vector3 } from 'three'
import { create } from 'zustand'
import { getSpawn } from './spawn'
import { createFreshScene, createSeed } from './seed'
import { useAssetStore } from '../assets/library'
import {
  applyInstance,
  captureTemplate,
  detachIfReparented,
  instantiatePrefab,
  markOverrides,
  readPrefab,
  reconcilePrefab,
  rememberRemoval,
  retargetInstance,
  revertInstance,
  tagAddedChild,
  unpackInstance,
} from '../assets/prefab'
import { translate, type MessageKey } from '../i18n'
import {
  childrenOf,
  makeNode,
  nextOrder,
  spawnPosition,
  subtreeIds,
  uniqueName,
} from './kinds'
import { defaultCapabilities, normalizeCapabilities } from '../../capabilities/registry'
import { resetUiValues } from '../../runtime/ui/values'
import {
  ALL_LAYERS_VISIBLE_MASK,
  LAYER_ID_DEFAULT,
  defaultLayers,
  defaultTags,
  ensureLayers,
  ensureTags,
} from '../project/taxonomy'
import { isUnder, localPoseFromWorld, poseComponents, worldPointToLocal, worldPose, writePose } from './transform'
import { placeViewportAt, readEditorViewPose, readViewportPose } from './viewportBridge'
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
  EditorView,
  SidePanel,
  Vec3,
} from './types'
import type { ProjectDocument } from './document'
import { DEFAULT_PICTURE, normalizeEditorView, normalizePicture } from './types'
import { forgetNavMesh } from '../../capabilities/navigation/archive'
import { hydrateNavigation } from '../../capabilities/navigation/session'

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
  editorView: EditorView | null
  editorViewNonce: number
  activeSceneId: string
  inspectedAssetId: string | null
  pendingRenameId: string | null
  renderBackend: string
  helpersVisible: boolean
  snapStep: number
  viewportStats: {
    objects: number
    triangles: number
    vertices: number
    materials: number
    textures: number
    calls: number
    fps: number
    frameMs: number
    camera: [number, number, number]
    orbit: number
  }
  playPicture: ScenePicture | null
  prefabSession: {
    assetId: string
    sceneNodes: Record<string, SceneNode>
    sceneSelection: string[]
    scenePast: HistoryEntry[]
    sceneFuture: HistoryEntry[]
    sceneView: EditorView | null
  } | null

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
  alignCameraToView: () => void
  alignViewToCamera: () => void
  beginGesture: (label: string) => void
  endGesture: () => void
  updateNode: (id: string, patch: Partial<SceneNode>) => void
  createNode: (kind: NodeKind, parentId?: string | null) => void
  spawnEffect: (assetId: string, point: Vec3) => void
  mountScreen: (assetId: string, point: Vec3) => void
  deleteSelection: () => void
  duplicateSelection: () => void
  copySelection: () => void
  pasteClipboard: (parentId?: string | null) => void
  groupSelection: () => void
  snapSelectionToGround: () => void
  canPaste: boolean
  reparent: (id: string, parentId: string | null) => void
  placeNodes: (ids: string[], parentId: string | null, zone: 'before' | 'into' | 'after' | 'end', anchorId?: string | null) => void
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
  rememberEditorView: (view: EditorView) => void
  setRenderBackend: (label: string) => void
  setHelpersVisible: (visible: boolean) => void
  setSnapStep: (step: number) => void
  setViewportStats: (stats: EditorState['viewportStats']) => void
  spawnModel: (assetId: string, name: string, slots: PbrSlot[], point: Vec3) => void
  spawnPrefab: (assetId: string, point: Vec3, parentId?: string | null) => void
  createPrefabFromSelection: (name?: string, nodeId?: string, dir?: string) => void
  rebindPrefab: (fromId: string, toId: string) => void
  openPrefab: (assetId: string) => void
  closePrefab: (save: boolean) => void
  applyPrefabInstance: (id: string) => void
  revertPrefabInstance: (id: string) => void
  unpackPrefabInstance: (id: string) => void
  assignMap: (id: string, assetId: string) => void
  assignMaterial: (id: string, materialId: string) => void
  capabilities: Record<string, boolean>
  tags: import('../project/taxonomy').TagDefinition[]
  layers: import('../project/taxonomy').LayerDefinition[]
  editorCullingMask: number
  physicsCollisionMatrixEnabled: boolean
  physicsCollisionRowMasks: Record<string, number>
  setCapability: (id: string, enabled: boolean) => void
  setTags: (tags: import('../project/taxonomy').TagDefinition[]) => void
  setLayers: (layers: import('../project/taxonomy').LayerDefinition[]) => void
  setEditorCullingMask: (mask: number) => void
  setPhysicsCollisionMatrix: (enabled: boolean, rows: Record<string, number>) => void
  applySimulation: (poses: Array<{ id: string, position: Vec3, rotation: [number, number, number, number] }>) => void
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
  editorView: null,
  editorViewNonce: 0,
  capabilities: defaultCapabilities(),
  tags: defaultTags(),
  layers: defaultLayers(),
  editorCullingMask: ALL_LAYERS_VISIBLE_MASK,
  physicsCollisionMatrixEnabled: false,
  physicsCollisionRowMasks: {},
  activeSceneId: '',
  inspectedAssetId: null,
  pendingRenameId: null,
  renderBackend: '正在初始化',
  helpersVisible: true,
  snapStep: 1,
  canPaste: false,
  viewportStats: { objects: 0, triangles: 0, vertices: 0, materials: 0, textures: 0, calls: 0, fps: 0, frameMs: 0, camera: [0, 0, 0], orbit: 0 },
  playPicture: null,
  prefabSession: null,

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

  alignCameraToView: () => {
    if (get().playState !== 'stopped') return
    const id = selectedCameraId(get(), true)
    const view = readViewportPose()
    if (!id || !view) return
    const nodes = get().nodes
    const node = nodes[id]
    const parent = node.parentId ? worldPose(nodes, node.parentId) : null
    const current = worldPose(nodes, id)
    const local = poseComponents(localPoseFromWorld(parent, {
      position: new Vector3(view.position[0], view.position[1], view.position[2]),
      quaternion: new Quaternion(view.quaternion[0], view.quaternion[1], view.quaternion[2], view.quaternion[3]),
      scale: current.scale,
    }))
    get().beginGesture(translate('gesture.alignCamera'))
    get().updateNode(id, { position: local.position, rotation: local.rotation })
    get().endGesture()
  },

  alignViewToCamera: () => {
    if (get().playState !== 'stopped') return
    const id = selectedCameraId(get(), false)
    if (!id) return
    const pose = worldPose(get().nodes, id)
    placeViewportAt(
      [pose.position.x, pose.position.y, pose.position.z],
      [pose.quaternion.x, pose.quaternion.y, pose.quaternion.z, pose.quaternion.w],
    )
  },

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
    if (get().prefabSession && !node.parentId && touchesTransform) return
    const next: SceneNode = { ...node, ...patch, id: node.id, kind: node.kind }
    if (!get().prefabSession) markOverrides(next, patch)
    set(state => ({ nodes: { ...state.nodes, [id]: next } }))
  },

  createNode: (kind, parentId = null) => {
    let created = ''
    const label = translate(`kind.${kind}` as MessageKey)
    const ok = mutate(set, get, translate('gesture.create', { name: label }), draft => {
      let parent = parentId && draft.nodes[parentId] ? parentId : null
      if (get().prefabSession && !parent) parent = Object.values(draft.nodes).find(node => !node.parentId)?.id ?? null
      const id = crypto.randomUUID()
      const name = uniqueName(draft.nodes, label)
      draft.nodes[id] = makeNode({
        id,
        name,
        kind,
        parentId: parent,
        order: nextOrder(draft.nodes, parent),
        position: spawnPosition(kind, parent, getSpawn()),
        rotation: kind === 'plane' ? [-90, 0, 0] : [0, 0, 0],
      })
      tagAddedChild(draft.nodes, id)
      draft.selection = [id]
      created = name
    })
    if (ok && created) get().log('info', translate('log.created', { name: created }))
  },

  spawnEffect: (assetId, point) => {
    const asset = useAssetStore.getState().assets[assetId]
    if (!asset || asset.kind !== 'effect') return
    let created = ''
    const ok = mutate(set, get, translate('gesture.create', { name: asset.name }), draft => {
      const id = crypto.randomUUID()
      const name = uniqueName(draft.nodes, asset.name)
      draft.nodes[id] = makeNode({
        id,
        name,
        kind: 'effect',
        parentId: null,
        order: nextOrder(draft.nodes, null),
        position: point,
        effect: {
          assetId: asset.id,
          quarksVersion: asset.quarksVersion,
          simulation: null,
          materialAssetId: null,
          playing: true,
        },
      })
      tagAddedChild(draft.nodes, id)
      draft.selection = [id]
      created = name
    })
    if (ok && created) get().log('info', translate('log.created', { name: created }))
  },

  mountScreen: (assetId, point) => {
    const asset = useAssetStore.getState().assets[assetId]
    if (!asset || asset.kind !== 'ui') return
    let created = ''
    const ok = mutate(set, get, translate('gesture.create', { name: asset.name }), draft => {
      const id = crypto.randomUUID()
      const name = uniqueName(draft.nodes, asset.name)
      draft.nodes[id] = makeNode({
        id,
        name,
        kind: 'screen',
        parentId: null,
        order: nextOrder(draft.nodes, null),
        position: point,
        screen: { documentId: asset.id, layer: 'hud', visibleOnPlay: true },
      })
      tagAddedChild(draft.nodes, id)
      draft.selection = [id]
      created = name
    })
    if (ok && created) get().log('info', translate('log.created', { name: created }))
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
    if (get().prefabSession) {
      const root = Object.values(state.nodes).find(node => !node.parentId)
      if (root && remove.has(root.id)) {
        remove.delete(root.id)
        get().log('warn', translate('prefab.keepRoot'))
      }
    }
    if (blocked.length) get().log('warn', translate('log.skippedLocked', { names: blocked.join('、') }))
    if (remove.size === 0) return
    const ok = mutate(set, get, '删除', draft => {
      for (const id of remove) rememberRemoval(draft.nodes, id)
      for (const id of remove) delete draft.nodes[id]
      draft.selection = []
    })
    if (ok) get().log('info', translate('log.deleted', { count: remove.size }))
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
      for (const id of roots) {
        const createdId = cloneSubtree(id, draft.nodes[id].parentId, true)
        if (draft.nodes[id]?.prefabInstanceId === id) retargetInstance(draft.nodes, id, createdId)
        created.push(createdId)
      }
      draft.selection = created
      count = created.length
    })
    if (ok && count) get().log('info', translate('log.duplicated', { count }))
  },

  copySelection: () => {
    const state = get()
    const roots = selectionRoots(state.nodes, state.selection)
    if (roots.length === 0) {
      state.log('warn', translate('log.nothingCopy'))
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
    state.log('info', translate('log.copied', { count: roots.length }))
  },

  pasteClipboard: (parentId = null) => {
    if (!clipboard || clipboard.length === 0) {
      get().log('warn', translate('log.clipboardEmpty'))
      return
    }
    let count = 0
    const ok = mutate(set, get, '粘贴', draft => {
      const created = pasteNodes(draft, parentId)
      draft.selection = created
      count = created.length
    })
    if (ok && count) get().log('info', translate('log.pasted', { count }))
  },

  groupSelection: () => {
    const roots = selectionRoots(get().nodes, get().selection)
    if (roots.length < 2) {
      get().log('warn', translate('log.groupNeedTwo'))
      return
    }
    const ok = mutate(set, get, '成组', draft => {
      const live = selectionRoots(draft.nodes, draft.selection)
      if (live.length < 2) return
      const sharedParent = draft.nodes[live[0]].parentId
      const parentId = live.every(id => draft.nodes[id].parentId === sharedParent) ? sharedParent : null
      const worlds = new Map(live.map(id => [id, worldPose(draft.nodes, id)]))
      const center = new Vector3()
      for (const id of live) center.add(worlds.get(id)!.position)
      center.multiplyScalar(1 / live.length)
      const parentPose = parentId ? worldPose(draft.nodes, parentId) : null
      const localCenter = parentPose ? worldPointToLocal(parentPose, center) : center
      const group = makeNode({
        id: crypto.randomUUID(),
        name: uniqueName(draft.nodes, '组'),
        kind: 'empty',
        parentId,
        order: nextOrder(draft.nodes, parentId),
        position: [localCenter.x, localCenter.y, localCenter.z],
      })
      draft.nodes[group.id] = group
      const groupPose = worldPose(draft.nodes, group.id)
      for (const id of live) {
        const world = worlds.get(id)
        if (!world) continue
        draft.nodes[id].parentId = group.id
        draft.nodes[id].order = nextOrder(draft.nodes, group.id, id)
        writePose(draft.nodes[id], localPoseFromWorld(groupPose, world))
      }
      draft.selection = [group.id]
    })
    if (ok) get().log('info', translate('log.grouped'))
  },

  snapSelectionToGround: () => {
    const state = get()
    const ids = selectionRoots(state.nodes, state.selection).filter(id => !state.nodes[id]?.locked)
    if (ids.length === 0) {
      state.log('warn', translate('log.needGround'))
      return
    }
    const moves = measureGroundSnap(ids)
    if (moves.length === 0) {
      state.log('info', translate('log.alreadyGround'))
      return
    }
    const ok = mutate(set, get, '贴地', draft => {
      for (const move of moves) {
        const node = draft.nodes[move.id]
        if (node) node.position = move.position
      }
    })
    if (ok) get().log('info', translate('log.grounded', { count: moves.length }))
  },

  reparent: (id, parentId) => {
    get().placeNodes([id], parentId, 'end')
  },

  placeNodes: (ids, parentId, zone, anchorId = null) => {
    const nodes = get().nodes
    const moving = selectionRoots(nodes, ids).filter(id => nodes[id] && !nodes[id].locked)
    if (moving.length === 0) return
    if (parentId && moving.some(id => id === parentId || isUnder(nodes, parentId, id))) {
      get().log('warn', translate('log.cycle'))
      return
    }
    const anchor = anchorId ? nodes[anchorId] : null
    const nextParent = zone === 'into' || zone === 'end' ? parentId : anchor?.parentId ?? parentId
    if (nextParent && moving.some(id => id === nextParent || isUnder(nodes, nextParent, id))) {
      get().log('warn', translate('log.cycle'))
      return
    }
    mutate(set, get, '更改父子', draft => {
      const worlds = new Map(moving.map(id => [id, worldPose(draft.nodes, id)]))
      const parentPose = nextParent ? worldPose(draft.nodes, nextParent) : null
      for (const id of moving) {
        const current = draft.nodes[id]
        if (!current || current.parentId === nextParent) continue
        const world = worlds.get(id)
        if (!world) continue
        current.parentId = nextParent
        writePose(current, localPoseFromWorld(parentPose, world))
        detachIfReparented(draft.nodes, id)
      }
      const siblings = childrenOf(draft.nodes, nextParent).filter(node => !moving.includes(node.id))
      let index = siblings.length
      if (anchor && (zone === 'before' || zone === 'after')) {
        const at = siblings.findIndex(node => node.id === anchor.id)
        index = at < 0 ? siblings.length : zone === 'before' ? at : at + 1
      }
      const ordered = [...siblings]
      ordered.splice(index, 0, ...moving.map(id => draft.nodes[id]).filter(Boolean))
      ordered.forEach((node, order) => { node.order = order })
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
      get().log('warn', translate('log.noUndoPlay'))
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
      get().log('warn', translate('log.noRedoPlay'))
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
    if (get().prefabSession) {
      get().log('warn', translate('prefab.noPlay'))
      return
    }
    if (get().gesture) get().endGesture()
    const state = get().playState
    if (state === 'paused') {
      set({ playState: 'playing' })
      get().log('info', translate('log.resumePlay'))
      return
    }
    if (state === 'playing') return
    resetUiValues()
    set({
      playState: 'playing',
      playSnapshot: cloneNodes(get().nodes),
      playSelection: get().selection.slice(),
      playPicture: structuredClone(get().picture),
    })
    get().log('info', translate('log.startPlay'))
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
    resetUiValues()
    get().log('info', translate('log.stopPlay'))
  },

  newScene: () => {
    get().createScene()
  },

  createScene: () => {
    if (get().playState !== 'stopped') {
      get().log('warn', translate('log.stopBeforeNew'))
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
    useAssetStore.getState().place(fresh.id)
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
    get().log('info', translate('log.createdScene', { name: fresh.name }))
  },

  openScene: id => {
    const asset = useAssetStore.getState().assets[id]
    if (!asset || asset.kind !== 'scene') return
    if (get().playState !== 'stopped') {
      get().log('warn', translate('log.stopBeforeOpen'))
      return
    }
    if (get().activeSceneId === id && !get().prefabSession) return
    if (get().prefabSession) get().closePrefab(true)
    if (get().activeSceneId === id) return
    if (get().gesture) get().endGesture()
    get().flushActiveScene()
    set({
      activeSceneId: id,
      nodes: structuredClone(asset.nodes),
      picture: normalizePicture(asset.picture),
      editorView: normalizeEditorView(asset.editorView),
      editorViewNonce: get().editorViewNonce + 1,
      selection: [],
      past: [],
      future: [],
      gesture: null,
      playSnapshot: null,
      playPicture: null,
    })
    get().log('info', translate('log.openedScene', { name: asset.name }))
  },

  deleteScene: id => {
    const scenes = Object.values(useAssetStore.getState().assets).filter(asset => asset.kind === 'scene')
    if (!scenes.some(scene => scene.id === id)) return
    if (scenes.length <= 1) {
      get().log('warn', translate('log.keepScene'))
      return
    }
    if (get().playState !== 'stopped') {
      get().log('warn', translate('log.stopBeforeDelete'))
      return
    }
    if (get().activeSceneId === id) {
      const next = scenes.find(scene => scene.id !== id)
      if (!next) return
      set({
        activeSceneId: next.id,
        nodes: structuredClone(next.nodes),
        picture: normalizePicture(next.picture),
        editorView: normalizeEditorView(next.editorView),
        editorViewNonce: get().editorViewNonce + 1,
        selection: [],
        past: [],
        future: [],
        gesture: null,
        playSnapshot: null,
        playPicture: null,
      })
    }
    useAssetStore.getState().remove(id)
    forgetNavMesh(id)
    get().log('info', translate('log.deletedScene'))
  },

  flushActiveScene: () => {
    const id = get().activeSceneId
    if (!id) return
    const session = get().prefabSession
    if (session) {
      const editing = structuredClone(get().nodes)
      const root = Object.values(editing).find(node => !node.parentId)
      if (root) {
        root.position = [0, 0, 0]
        root.rotation = [0, 0, 0]
        root.scale = [1, 1, 1]
      }
      useAssetStore.getState().writePrefab(session.assetId, root?.id ?? '', editing)
      reconcilePrefab(session.sceneNodes, session.assetId, readPrefab({ rootId: root?.id ?? '', nodes: editing }), lookupPrefab)
    }
    const nodes = session ? session.sceneNodes : get().nodes
    const liveView = get().prefabSession ? get().editorView : readEditorViewPose()
    useAssetStore.getState().writeScene(id, structuredClone(nodes), structuredClone(get().picture), liveView ?? undefined)
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
      useAssetStore.getState().place(id, 'Assets')
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
      picture: normalizePicture(document.picture),
      editorView: savedEditorView(document),
      editorViewNonce: get().editorViewNonce + 1,
      capabilities: normalizeCapabilities(document.capabilities),
      tags: ensureTags(document.tags),
      layers: ensureLayers(document.layers),
      editorCullingMask: typeof document.editorCullingMask === 'number' ? document.editorCullingMask >>> 0 : ALL_LAYERS_VISIBLE_MASK,
      physicsCollisionMatrixEnabled: document.physicsCollisionMatrixEnabled === true,
      physicsCollisionRowMasks: document.physicsCollisionRowMasks ?? {},
      activeSceneId: document.activeSceneId,
      prefabSession: null,
    })
    hydrateNavigation(document.navMeshes)
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

  setPicture: patch => set({ picture: normalizePicture({ ...get().picture, ...patch }) }),

  rememberEditorView: view => {
    if (get().prefabSession || get().playState !== 'stopped') return
    if (JSON.stringify(get().editorView) === JSON.stringify(view)) return
    set({ editorView: view })
  },

  setCapability: (id, enabled) => set(state => ({
    capabilities: { ...state.capabilities, [id]: enabled },
  })),

  setTags: tags => {
    const next = ensureTags(tags)
    const ids = new Set(next.map(tag => tag.id))
    set(state => {
      const nodes = { ...state.nodes }
      for (const [id, node] of Object.entries(nodes)) {
        const tagId = node.tagId && ids.has(node.tagId) ? node.tagId : null
        const tagIds = (node.tagIds ?? []).filter(tag => ids.has(tag))
        const samePrimary = (node.tagId ?? null) === tagId
        const sameExtra = (node.tagIds ?? []).join('|') === tagIds.join('|')
        if (!samePrimary || !sameExtra) nodes[id] = { ...node, tagId, tagIds }
      }
      return { tags: next, nodes }
    })
  },

  setLayers: layers => {
    const next = ensureLayers(layers)
    const ids = new Set(next.map(layer => layer.id))
    set(state => {
      const nodes = { ...state.nodes }
      for (const [id, node] of Object.entries(nodes)) {
        if (node.renderLayerId && !ids.has(node.renderLayerId)) {
          nodes[id] = { ...node, renderLayerId: LAYER_ID_DEFAULT }
        }
      }
      return { layers: next, nodes }
    })
  },

  setEditorCullingMask: mask => set({ editorCullingMask: mask >>> 0 }),

  setPhysicsCollisionMatrix: (enabled, rows) => set({
    physicsCollisionMatrixEnabled: enabled,
    physicsCollisionRowMasks: rows,
  }),

  applySimulation: poses => {
    if (get().playState !== 'playing' || poses.length === 0) return
    const depthOf = (id: string) => {
      let depth = 0
      let parent = get().nodes[id]?.parentId
      const seen = new Set<string>()
      while (parent && !seen.has(parent)) {
        seen.add(parent)
        depth += 1
        parent = get().nodes[parent]?.parentId
      }
      return depth
    }
    const ordered = [...poses].sort((a, b) => depthOf(a.id) - depthOf(b.id))
    set(state => {
      const nodes = { ...state.nodes }
      for (const pose of ordered) {
        const node = nodes[pose.id]
        if (!node) continue
        const parent = node.parentId ? worldPose(nodes, node.parentId) : null
        const local = localPoseFromWorld(parent, {
          position: new Vector3(pose.position[0], pose.position[1], pose.position[2]),
          quaternion: new Quaternion(pose.rotation[0], pose.rotation[1], pose.rotation[2], pose.rotation[3]),
          scale: new Vector3(node.scale[0], node.scale[1], node.scale[2]),
        })
        const parts = poseComponents(local)
        nodes[pose.id] = { ...node, position: parts.position, rotation: parts.rotation }
      }
      return { nodes }
    })
  },
  setRenderBackend: label => {
    if (get().renderBackend !== label) set({ renderBackend: label })
  },
  setHelpersVisible: visible => set({ helpersVisible: visible }),
  setSnapStep: step => set({ snapStep: Math.max(0.01, step) }),
  setViewportStats: stats => {
    set({ viewportStats: stats })
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
    if (ok && created) get().log('info', translate('log.placed', { name: created }))
  },

  spawnPrefab: (assetId, point, parentId = null) => {
    if (get().prefabSession) {
      get().log('warn', translate('prefab.exitFirst'))
      return
    }
    const asset = useAssetStore.getState().assets[assetId]
    const doc = asset?.kind === 'prefab' ? readPrefab(asset) : null
    if (!doc?.rootId) return
    let created = ''
    const ok = mutate(set, get, translate('prefab.place', { name: asset?.name ?? '' }), draft => {
      const id = instantiatePrefab(draft.nodes, doc, assetId, parentId, parentId ? null : point, lookupPrefab)
      if (!id) return
      created = draft.nodes[id]?.name ?? ''
      draft.selection = [id]
    })
    if (ok && created) get().log('info', translate('log.placed', { name: created }))
  },

  createPrefabFromSelection: (name, nodeId, dir) => {
    if (get().playState !== 'stopped') return
    if (get().prefabSession) {
      get().log('warn', translate('prefab.exitFirst'))
      return
    }
    const roots = nodeId ? [nodeId] : selectionRoots(get().nodes, get().selection)
    if (roots.length !== 1 || !get().nodes[roots[0]]) {
      get().log('warn', translate('prefab.needOne'))
      return
    }
    if (get().nodes[roots[0]].prefabInstanceId === roots[0]) {
      get().log('warn', translate('prefab.alreadyInstance'))
      return
    }
    const source = get().nodes[roots[0]]
    const doc = captureTemplate(get().nodes, roots[0])
    if (!doc.rootId) return
    const id = crypto.randomUUID()
    const assetName = uniqueAssetName(name?.trim() || source.name)
    useAssetStore.getState().add({ id, name: assetName, kind: 'prefab', rootId: doc.rootId, nodes: doc.nodes })
    useAssetStore.getState().place(id, dir)
    const ok = mutate(set, get, translate('prefab.create', { name: assetName }), draft => {
      const current = draft.nodes[roots[0]]
      if (!current) return
      const parentId = current.parentId
      const position = current.position
      const rotation = current.rotation
      const scale = current.scale
      const order = current.order
      const name = current.name
      deleteSubtree(draft.nodes, roots[0])
      const instanceId = instantiatePrefab(draft.nodes, doc, id, parentId, position, lookupPrefab)
      const instance = instanceId ? draft.nodes[instanceId] : undefined
      if (!instance) return
      instance.name = name
      instance.rotation = rotation
      instance.scale = scale
      instance.order = order
      instance.prefabOverrides = ['position', 'rotation', 'scale']
      draft.selection = [instance.id]
    })
    if (ok) get().log('info', translate('log.savedPrefab', { name: assetName }))
  },

  rebindPrefab: (fromId, toId) => {
    const doc = lookupPrefab(toId)
    if (!doc?.rootId || fromId === toId) return
    const ok = mutate(set, get, translate('prefab.rebind'), draft => {
      const roots = Object.values(draft.nodes).filter(node => node.prefabAssetId === fromId && node.prefabInstanceId === node.id)
      for (const root of roots) {
        for (const node of Object.values(draft.nodes)) {
          if (node.prefabInstanceId === root.id && node.id !== root.id) delete draft.nodes[node.id]
        }
        root.prefabAssetId = toId
        root.prefabTemplateId = doc.rootId
        root.prefabRemoved = []
        root.prefabOverrides = ['position', 'rotation', 'scale']
      }
      reconcilePrefab(draft.nodes, toId, doc, lookupPrefab)
    })
    if (ok) get().log('info', translate('prefab.rebound'))
  },

  openPrefab: assetId => {
    if (get().playState !== 'stopped') {
      get().log('warn', translate('prefab.noPlay'))
      return
    }
    if (get().prefabSession?.assetId === assetId) return
    if (get().prefabSession) get().closePrefab(true)
    const asset = useAssetStore.getState().assets[assetId]
    const doc = asset?.kind === 'prefab' ? readPrefab(asset) : null
    if (!doc?.rootId) return
    if (get().gesture) get().endGesture()
    set({
      prefabSession: {
        assetId,
        sceneNodes: structuredClone(get().nodes),
        sceneSelection: get().selection.slice(),
        scenePast: get().past,
        sceneFuture: get().future,
        sceneView: readEditorViewPose() ?? get().editorView,
      },
      nodes: structuredClone(doc.nodes),
      selection: [doc.rootId],
      past: [],
      future: [],
      inspectedAssetId: null,
    })
    get().log('info', translate('prefab.editing', { name: asset?.name ?? '' }))
  },

  closePrefab: save => {
    const session = get().prefabSession
    if (!session) return
    if (get().gesture) get().endGesture()
    const sceneNodes = session.sceneNodes
    if (save) {
      const nodes = structuredClone(get().nodes)
      const root = Object.values(nodes).find(node => !node.parentId)
      if (root) {
        root.position = [0, 0, 0]
        root.rotation = [0, 0, 0]
        root.scale = [1, 1, 1]
      }
      useAssetStore.getState().writePrefab(session.assetId, root?.id ?? '', nodes)
      const doc = readPrefab({ rootId: root?.id ?? '', nodes })
      reconcilePrefab(sceneNodes, session.assetId, doc, lookupPrefab)
    }
    set({
      prefabSession: null,
      nodes: sceneNodes,
      selection: session.sceneSelection.filter(id => sceneNodes[id]),
      past: session.scenePast,
      future: session.sceneFuture,
      editorView: session.sceneView,
      editorViewNonce: session.sceneView ? get().editorViewNonce + 1 : get().editorViewNonce,
    })
    get().log('info', translate(save ? 'prefab.saved' : 'prefab.closed'))
  },

  applyPrefabInstance: id => {
    const root = get().nodes[id]
    const asset = root?.prefabAssetId ? useAssetStore.getState().assets[root.prefabAssetId] : undefined
    if (!root || root.prefabInstanceId !== root.id || asset?.kind !== 'prefab') return
    const ok = mutate(set, get, translate('prefab.apply'), draft => {
      const doc = applyInstance(draft.nodes, id, readPrefab(asset))
      useAssetStore.getState().writePrefab(asset.id, doc.rootId, doc.nodes)
      reconcilePrefab(draft.nodes, asset.id, doc, lookupPrefab)
    })
    if (ok) get().log('info', translate('prefab.applied'))
  },

  revertPrefabInstance: id => {
    const root = get().nodes[id]
    const asset = root?.prefabAssetId ? useAssetStore.getState().assets[root.prefabAssetId] : undefined
    if (!root || root.prefabInstanceId !== root.id || asset?.kind !== 'prefab') return
    const ok = mutate(set, get, translate('prefab.revert'), draft => {
      revertInstance(draft.nodes, id, readPrefab(asset), asset.id, lookupPrefab)
    })
    if (ok) get().log('info', translate('prefab.reverted'))
  },

  unpackPrefabInstance: id => {
    if (!get().nodes[id] || get().nodes[id].prefabInstanceId !== id) return
    const ok = mutate(set, get, translate('prefab.unpack'), draft => {
      unpackInstance(draft.nodes, id)
    })
    if (ok) get().log('info', translate('prefab.unpacked'))
  },

  assignMap: (id, assetId) => {
    const node = get().nodes[id]
    if (!node) return
    get().beginGesture('指定贴图')
    if (node.kind === 'model' && node.slots.length > 0) {
      const linked = node.slots[0].materialAssetId
      if (linked) useAssetStore.getState().updateMaterial(linked, { mapAssetId: assetId })
      else {
        get().updateNode(id, {
          slots: node.slots.map((slot, index) => index === 0 ? { ...slot, mapAssetId: assetId } : slot),
        })
      }
    } else if (node.materialAssetId) {
      useAssetStore.getState().updateMaterial(node.materialAssetId, { mapAssetId: assetId })
    } else {
      get().updateNode(id, { mapAssetId: assetId })
    }
    get().endGesture()
  },

  assignMaterial: (id, materialId) => {
    const asset = useAssetStore.getState().assets[materialId]
    const node = get().nodes[id]
    if (!node || asset?.kind !== 'material') return
    get().beginGesture('指定材质')
    if (node.kind === 'model' && node.slots.length > 0) {
      get().updateNode(id, {
        slots: node.slots.map(item => ({ ...item, materialAssetId: materialId })),
      })
    } else {
      get().updateNode(id, { materialAssetId: materialId })
    }
    get().endGesture()
    get().log('info', translate('log.assignedMaterial', { name: asset.name }))
  },
}))

function savedEditorView(document: { activeSceneId: string, library: Array<{ kind: string, id: string, editorView?: unknown }> }) {
  const scene = document.library.find(item => item.kind === 'scene' && item.id === document.activeSceneId)
  return normalizeEditorView(scene?.editorView)
}

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
    get().log('warn', translate('log.noStructure'))
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

function lookupPrefab(assetId: string) {
  const asset = useAssetStore.getState().assets[assetId]
  return asset?.kind === 'prefab' ? readPrefab(asset) : null
}

function deleteSubtree(nodes: Record<string, SceneNode>, id: string) {
  for (const child of childrenOf(nodes, id)) deleteSubtree(nodes, child.id)
  delete nodes[id]
}

function uniqueAssetName(base: string): string {
  const names = new Set(Object.values(useAssetStore.getState().assets).map(asset => asset.name))
  if (!names.has(base)) return base
  let index = 2
  while (names.has(`${base} ${index}`)) index += 1
  return `${base} ${index}`
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

function selectedCameraId(state: { nodes: Record<string, SceneNode>, selection: string[] }, editable: boolean): string | null {
  const id = primaryId(state)
  const node = id ? state.nodes[id] : undefined
  if (!node || node.kind !== 'camera') return null
  if (editable && node.locked) return null
  return id
}
