import { create } from 'zustand'
import { capabilityEnabled } from '../registry'
import { worldPose } from '../../editor/scene/transform'
import { useEditorStore } from '../../editor/scene/store'
import { translate } from '../../editor/i18n'
import type { NavSettings, SceneNode, Vec3 } from '../../editor/scene/types'
import {
  decodeBytes,
  encodeBytes,
  hydrateNavMeshes,
  navEpoch,
  navRecord,
  forgetNavMesh,
  rememberNavMesh,
} from './archive'
import { navSettingsOf, navSignature, recastBakeConfig } from './defaults'
import type { NavDebugMesh, NavObstacleDesc, NavigationWorld } from './world'

interface NavUiState {
  phase: 'idle' | 'baking' | 'ready' | 'error'
  text: string
  sceneId: string
  signature: string
  triangles: number
}

export const useNavUi = create<NavUiState>(() => ({
  phase: 'idle',
  text: '',
  sceneId: '',
  signature: '',
  triangles: 0,
}))

interface NavBakeJob {
  surfaceIds: string[]
  finish: (surfaces: { positions: Float32Array, indices: Uint32Array }) => void
}

let instance: NavigationWorld | null = null
let opening: Promise<NavigationWorld> | null = null
let life = 0
let loadedScene = ''
let seenEpoch = -1
let activating = false
let controller: AbortController | null = null
let pending: NavBakeJob | null = null
let obstacleKey = ''
let debugMesh: NavDebugMesh | null = null

export function hydrateNavigation(value: unknown) {
  hydrateNavMeshes(value)
  loadedScene = ''
}

export function requestNavBake() {
  const state = useEditorStore.getState()
  if (!capabilityEnabled(state.capabilities, 'navigation') || state.playState !== 'stopped') return
  controller?.abort()
  controller = new AbortController()
  const signal = controller.signal
  const sceneId = state.activeSceneId
  const settings = navSettingsOf(state.picture.navigation)
  const surfaceIds = Object.values(state.nodes)
    .filter(node => node.visible && node.navigation?.role === 'surface')
    .map(node => node.id)
  pending = {
    surfaceIds,
    finish: surfaces => { void runBake(sceneId, settings, surfaces, signal) },
  }
  useNavUi.setState({ phase: 'baking', text: translate('navigation.baking'), sceneId, signature: '', triangles: 0 })
}

export function cancelNavBake() {
  controller?.abort()
  controller = null
  pending = null
  if (useNavUi.getState().phase === 'baking') {
    useNavUi.setState({ phase: 'idle', text: '' })
  }
}

export function clearNavMesh() {
  const state = useEditorStore.getState()
  if (!capabilityEnabled(state.capabilities, 'navigation') || state.playState !== 'stopped') return
  const sceneId = state.activeSceneId
  controller?.abort()
  controller = null
  pending = null
  forgetNavMesh(sceneId)
  instance?.clear()
  debugMesh = null
  obstacleKey = ''
  loadedScene = sceneId
  seenEpoch = navEpoch()
  useNavUi.setState({ phase: 'idle', text: '', sceneId, signature: '', triangles: 0 })
  state.log('info', translate('navigation.cleared'))
}

export function consumeNavBake(): NavBakeJob | null {
  const job = pending
  pending = null
  return job
}

export function navDebugGeometry(): NavDebugMesh | null {
  return debugMesh
}

export function findNavigationPath(start: Vec3, end: Vec3): Vec3[] | null {
  const state = useEditorStore.getState()
  if (!capabilityEnabled(state.capabilities, 'navigation')) return null
  return instance?.findPath(start, end) ?? null
}

export function tickNavigation() {
  const state = useEditorStore.getState()
  if (!capabilityEnabled(state.capabilities, 'navigation')) {
    if (instance || controller || debugMesh || loadedScene) disposeWorld()
    return
  }
  const sceneId = state.activeSceneId
  const ui = useNavUi.getState()
  if (ui.phase === 'baking' && ui.sceneId !== sceneId) cancelNavBake()
  if (!activating && (loadedScene !== sceneId || seenEpoch !== navEpoch())) {
    activating = true
    void activate(sceneId).finally(() => { activating = false })
  }
  if (!instance || loadedScene !== sceneId) return
  applyObstacles(state.playState === 'playing' ? collectObstacles(state.nodes) : [])
}

async function runBake(
  sceneId: string,
  settings: NavSettings,
  surfaces: { positions: Float32Array, indices: Uint32Array },
  signal: AbortSignal,
) {
  if (signal.aborted || useEditorStore.getState().activeSceneId !== sceneId) return
  if (surfaces.indices.length < 3) {
    const text = translate('navigation.noSurface')
    useNavUi.setState({ phase: 'error', text, sceneId })
    useEditorStore.getState().log('warn', text)
    return
  }
  loadedScene = sceneId
  seenEpoch = navEpoch()
  try {
    const nav = await world()
    if (signal.aborted || useEditorStore.getState().activeSceneId !== sceneId) return
    await nav.bake(surfaces.positions, surfaces.indices, recastBakeConfig(settings), signal)
    if (signal.aborted || useEditorStore.getState().activeSceneId !== sceneId) return
    const exported = nav.exportRecord()
    const signature = navSignature(settings)
    const triangles = Math.floor(surfaces.indices.length / 3)
    if (exported) {
      rememberNavMesh(sceneId, {
        bytes: encodeBytes(exported.bytes),
        mode: exported.mode,
        signature,
        triangles,
      })
    }
    obstacleKey = ''
    pullDebug()
    useNavUi.setState({ phase: 'ready', text: translate('navigation.ready'), sceneId, signature, triangles })
  } catch (error) {
    if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) return
    const text = error instanceof Error ? error.message : String(error)
    useNavUi.setState({ phase: 'error', text, sceneId })
    useEditorStore.getState().log('error', text)
  }
}

async function activate(sceneId: string) {
  const ticket = life
  const record = navRecord(sceneId)
  seenEpoch = navEpoch()
  if (useNavUi.getState().phase === 'baking' && useNavUi.getState().sceneId === sceneId) {
    loadedScene = sceneId
    return
  }
  if (!record) {
    instance?.clear()
    loadedScene = sceneId
    obstacleKey = ''
    pullDebug()
    if (useNavUi.getState().phase !== 'baking') {
      useNavUi.setState({ phase: 'idle', text: '', sceneId, signature: '', triangles: 0 })
    }
    return
  }
  try {
    const nav = await world()
    if (ticket !== life || useEditorStore.getState().activeSceneId !== sceneId) return
    await nav.restore({ bytes: decodeBytes(record.bytes), mode: record.mode })
    if (ticket !== life || useEditorStore.getState().activeSceneId !== sceneId) return
    loadedScene = sceneId
    obstacleKey = ''
    pullDebug()
    useNavUi.setState({
      phase: 'ready',
      text: translate('navigation.ready'),
      sceneId,
      signature: record.signature,
      triangles: record.triangles,
    })
  } catch (error) {
    if (ticket !== life) return
    const text = error instanceof Error ? error.message : String(error)
    useNavUi.setState({ phase: 'error', text, sceneId })
  }
}

async function world(): Promise<NavigationWorld> {
  if (instance) return instance
  const ticket = life
  if (!opening) opening = import('./recastNav').then(module => module.createRecastNavigation())
  const created = await opening
  opening = null
  if (ticket !== life || !capabilityEnabled(useEditorStore.getState().capabilities, 'navigation')) {
    created.dispose()
    throw abortError()
  }
  if (instance && instance !== created) created.dispose()
  instance ??= created
  return instance
}

function applyObstacles(items: NavObstacleDesc[]) {
  const key = items.map(item => [
    item.id,
    item.position.map(value => value.toFixed(2)).join(','),
    item.radius.toFixed(2),
    item.height.toFixed(2),
  ].join(':')).join('|')
  if (key === obstacleKey) return
  obstacleKey = key
  instance?.obstacles(items)
  pullDebug()
}

function collectObstacles(nodes: Record<string, SceneNode>): NavObstacleDesc[] {
  const items: NavObstacleDesc[] = []
  for (const node of Object.values(nodes)) {
    if (!node.visible || node.navigation?.role !== 'obstacle') continue
    const pose = worldPose(nodes, node.id)
    const radius = Math.max(0.05, node.navigation.radius) * Math.max(Math.abs(pose.scale.x), Math.abs(pose.scale.z))
    const height = Math.max(0.05, node.navigation.height) * Math.abs(pose.scale.y)
    items.push({
      id: node.id,
      position: [pose.position.x, pose.position.y - height / 2, pose.position.z],
      radius,
      height,
    })
  }
  return items
}

function pullDebug() {
  debugMesh = instance?.debug() ?? null
}

function disposeWorld() {
  life += 1
  controller?.abort()
  controller = null
  pending = null
  instance?.dispose()
  instance = null
  opening = null
  loadedScene = ''
  obstacleKey = ''
  debugMesh = null
  if (useNavUi.getState().phase === 'baking') useNavUi.setState({ phase: 'idle', text: '' })
}

function abortError(): Error {
  const error = new Error('aborted')
  error.name = 'AbortError'
  return error
}

/**
 * 为多单位同时移动生成方阵散开目标点，避免群体寻路聚拢在同一坐标点。
 * 供策略/RTS/小队跟随等玩法包或律令遍历使用。
 */
export function computeFormationTargets(center: Vec3, count: number, spacing = 1.6): Vec3[] {
  if (count <= 0) return []
  if (count === 1) return [[center[0], center[1], center[2]]]
  const cols = Math.ceil(Math.sqrt(count))
  const rows = Math.ceil(count / cols)
  const out: Vec3[] = []
  for (let i = 0; i < count; i += 1) {
    const col = i % cols
    const row = Math.floor(i / cols)
    const ox = (col - (cols - 1) * 0.5) * spacing
    const oz = (row - (rows - 1) * 0.5) * spacing
    out.push([center[0] + ox, center[1], center[2] + oz])
  }
  return out
}
