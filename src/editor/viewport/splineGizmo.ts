import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  LineDashedMaterial,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  SphereGeometry,
  Vector3,
} from 'three'
import { normalizeSplinePath, SPLINE_PATH_CAPABILITY_ID, type SplinePathData } from '../../capabilities/spline/schema'
import { createSplinePath } from '../../runtime/motion'
import type { SceneNode } from '../scene/types'
import { EDITOR_HELPER_LAYER } from '../project/taxonomy'

export interface SplinePointRef {
  id: string
  index: number
}

export interface SplineGizmoState {
  group: Group
  curveLine: Line
  hullLine: Line
  handles: Mesh[]
  pickTargets: Object3D[]
  signature: string
  selected: boolean
  activeIndices: number[]
}

const HANDLE_RADIUS = 0.16
let activeSplinePoints: SplinePointRef[] = []
const activeSplineListeners = new Set<() => void>()

export function getActiveSplinePoints(): readonly SplinePointRef[] {
  return activeSplinePoints
}

export function getActiveSplinePoint(): SplinePointRef | null {
  return activeSplinePoints[0] ?? null
}

export function setActiveSplinePoints(next: readonly SplinePointRef[]) {
  if (next.length === activeSplinePoints.length && next.every((point, index) => point.id === activeSplinePoints[index]?.id && point.index === activeSplinePoints[index]?.index)) return
  activeSplinePoints = next.slice()
  for (const listener of activeSplineListeners) listener()
}

export function setActiveSplinePoint(next: SplinePointRef | null) {
  setActiveSplinePoints(next ? [next] : [])
}

export function subscribeActiveSplinePoint(listener: () => void) {
  activeSplineListeners.add(listener)
  return () => { activeSplineListeners.delete(listener) }
}

function markSplineHelper(obj: Object3D, nodeId: string, pointIndex?: number) {
  obj.layers.set(EDITOR_HELPER_LAYER)
  obj.userData.nodeId = nodeId
  if (typeof pointIndex === 'number') {
    obj.userData.splineNodeId = nodeId
    obj.userData.splinePointIndex = pointIndex
  }
}

function buildSignature(data: SplinePathData, selected: boolean, activeIndices: number[]): string {
  const pts = data.points.map((p) => `${p[0].toFixed(3)},${p[1].toFixed(3)},${p[2].toFixed(3)}`).join(';')
  return `${selected ? '1' : '0'}|${activeIndices.join(',')}|${data.closed ? '1' : '0'}|${data.tension.toFixed(3)}|${data.color}|${pts}`
}

const SHARED_HANDLE_GEO = new SphereGeometry(HANDLE_RADIUS, 16, 12)

export function createSplineGizmo(node: SceneNode): SplineGizmoState {
  const group = new Group()
  group.name = '__spline_gizmo__'
  markSplineHelper(group, node.id)

  const curveLine = new Line(
    new BufferGeometry(),
    new LineBasicMaterial({ color: '#34d399', transparent: true, opacity: 0.95, depthTest: false }),
  )
  curveLine.renderOrder = 25
  markSplineHelper(curveLine, node.id)
  group.add(curveLine)

  const hullLine = new Line(
    new BufferGeometry(),
    new LineDashedMaterial({
      color: '#94a3b8',
      dashSize: 0.25,
      gapSize: 0.16,
      transparent: true,
      opacity: 0.65,
      depthTest: false,
    }),
  )
  hullLine.renderOrder = 24
  markSplineHelper(hullLine, node.id)
  group.add(hullLine)

  const state: SplineGizmoState = {
    group,
    curveLine,
    hullLine,
    handles: [],
    pickTargets: [curveLine],
    signature: '',
    selected: false,
    activeIndices: [],
  }
  syncSplineGizmo(state, node, false)
  return state
}

export function syncSplineGizmo(state: SplineGizmoState, node: SceneNode, selected: boolean, activeIndices: readonly number[] = []) {
  const data = normalizeSplinePath(node.capabilities?.[SPLINE_PATH_CAPABILITY_ID])
  const picked = [...new Set(activeIndices.filter(index => index >= 0 && index < data.points.length))].sort((a, b) => a - b)
  const sig = buildSignature(data, selected, picked)
  if (state.signature === sig) return
  state.signature = sig
  state.selected = selected
  state.activeIndices = picked

  const curveMat = state.curveLine.material as LineBasicMaterial
  curveMat.color.set(data.color || '#34d399')
  curveMat.opacity = selected ? 1 : 0.78

  // 1. 采样 Catmull-Rom 平滑曲线
  const motionPts = data.points.map((p) => ({ x: p[0], y: p[1], z: p[2] }))
  const path = createSplinePath(motionPts, { closed: data.closed, tension: data.tension })
  const segCount = Math.max(24, data.points.length * 18)
  const curvePositions: number[] = []
  for (let i = 0; i <= segCount; i += 1) {
    const t = i / segCount
    const pt = path.pointAt(t)
    curvePositions.push(pt.x, pt.y, pt.z)
  }
  state.curveLine.geometry.dispose()
  const curveGeo = new BufferGeometry()
  curveGeo.setAttribute('position', new Float32BufferAttribute(curvePositions, 3))
  curveGeo.computeBoundingSphere()
  state.curveLine.geometry = curveGeo

  // 2. 控制多边形虚线（选中时显示）
  state.hullLine.visible = selected
  if (selected) {
    const hullPositions: number[] = []
    for (const p of data.points) hullPositions.push(p[0], p[1], p[2])
    if (data.closed && data.points.length > 0) {
      hullPositions.push(data.points[0][0], data.points[0][1], data.points[0][2])
    }
    state.hullLine.geometry.dispose()
    const hullGeo = new BufferGeometry()
    hullGeo.setAttribute('position', new Float32BufferAttribute(hullPositions, 3))
    state.hullLine.geometry = hullGeo
    state.hullLine.computeLineDistances()
  }

  // 3. 每个控制点一个可拾取球体。未选中时也保留，方便直接点中。
  const needCount = data.points.length
  while (state.handles.length < needCount) {
    const idx = state.handles.length
    const mat = new MeshBasicMaterial({
      color: '#34d399',
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.95,
      toneMapped: false,
      fog: false,
    })
    const mesh = new Mesh(SHARED_HANDLE_GEO, mat)
    mesh.renderOrder = 30
    mesh.frustumCulled = false
    markSplineHelper(mesh, node.id, idx)
    state.group.add(mesh)
    state.handles.push(mesh)
  }
  while (state.handles.length > needCount) {
    const removed = state.handles.pop()!
    ;(removed.material as MeshBasicMaterial).dispose()
    state.group.remove(removed)
  }

  state.pickTargets = [state.curveLine]
  for (let i = 0; i < needCount; i += 1) {
    const p = data.points[i]
    const handle = state.handles[i]
    handle.visible = true
    handle.position.set(p[0], p[1], p[2])
    const mat = handle.material as MeshBasicMaterial
    const active = picked.includes(i)
    mat.color.set(active ? '#f8fafc' : i === 0 ? '#fbbf24' : data.color || '#34d399')
    mat.opacity = selected ? 1 : 0.82
    markSplineHelper(handle, node.id, i)
    state.pickTargets.push(handle)
  }
}

const handleWorld = new Vector3()
const handleScale = new Vector3()

/** 按屏幕像素保持手柄大小，远近都能点中。 */
export function layoutSplineHandles(state: SplineGizmoState, camera: PerspectiveCamera | OrthographicCamera, viewportHeight: number) {
  const pixels = 5.5
  for (const handle of state.handles) {
    if (!handle.visible) continue
    handle.getWorldPosition(handleWorld)
    const distance = Math.max(camera.position.distanceTo(handleWorld), 0.25)
    let radius: number
    if (camera instanceof PerspectiveCamera) {
      const fov = camera.fov * Math.PI / 180
      radius = (2 * Math.tan(fov / 2) * distance * pixels) / Math.max(viewportHeight, 1)
    } else {
      const span = (camera.top - camera.bottom) / Math.max(camera.zoom, 0.0001)
      radius = (span * pixels) / Math.max(viewportHeight, 1)
    }
    const parentScale = handle.parent?.getWorldScale(handleScale).x || 1
    const active = state.activeIndices.includes(handle.userData.splinePointIndex as number)
    const next = Math.max(radius, 0.02) / (HANDLE_RADIUS * parentScale) * (active ? 1.28 : 1)
    handle.scale.setScalar(next)
  }
}

export function restoreSplineHelperLayers(state: SplineGizmoState) {
  state.group.traverse(obj => {
    obj.layers.set(EDITOR_HELPER_LAYER)
  })
}

export function disposeSplineGizmo(state: SplineGizmoState) {
  state.curveLine.geometry.dispose()
  ;(state.curveLine.material as LineBasicMaterial).dispose()
  state.hullLine.geometry.dispose()
  ;(state.hullLine.material as LineDashedMaterial).dispose()
  for (const h of state.handles) {
    ;(h.material as MeshBasicMaterial).dispose()
  }
  state.handles.length = 0
}

export function splinePointWorldPosition(group: Object3D, node: SceneNode, pointIndex: number): Vector3 | null {
  const data = normalizeSplinePath(node.capabilities?.[SPLINE_PATH_CAPABILITY_ID])
  const pt = data.points[pointIndex]
  if (!pt) return null
  group.updateMatrixWorld()
  return new Vector3(pt[0], pt[1], pt[2]).applyMatrix4(group.matrixWorld)
}
