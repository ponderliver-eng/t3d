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
  SphereGeometry,
  Vector3,
} from 'three'
import { normalizeSplinePath, SPLINE_PATH_CAPABILITY_ID, type SplinePathData } from '../../capabilities/spline/schema'
import { createSplinePath } from '../../runtime/motion'
import type { SceneNode } from '../scene/types'
import { EDITOR_HELPER_LAYER } from '../project/taxonomy'

export interface SplineGizmoState {
  group: Group
  curveLine: Line
  hullLine: Line
  handles: Mesh[]
  pickTargets: Object3D[]
  signature: string
  selected: boolean
}

function markSplineHelper(obj: Object3D, nodeId: string, pointIndex?: number) {
  obj.layers.set(EDITOR_HELPER_LAYER)
  obj.userData.nodeId = nodeId
  if (typeof pointIndex === 'number') {
    obj.userData.splineNodeId = nodeId
    obj.userData.splinePointIndex = pointIndex
  }
}

function buildSignature(data: SplinePathData, selected: boolean): string {
  const pts = data.points.map((p) => `${p[0].toFixed(3)},${p[1].toFixed(3)},${p[2].toFixed(3)}`).join(';')
  return `${selected ? '1' : '0'}|${data.closed ? '1' : '0'}|${data.tension.toFixed(3)}|${data.color}|${pts}`
}

const SHARED_HANDLE_GEO = new SphereGeometry(0.14, 14, 10)
const SHARED_START_GEO = new SphereGeometry(0.18, 14, 10)

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
  }
  syncSplineGizmo(state, node, false)
  return state
}

export function syncSplineGizmo(state: SplineGizmoState, node: SceneNode, selected: boolean) {
  const data = normalizeSplinePath(node.capabilities?.[SPLINE_PATH_CAPABILITY_ID])
  const sig = buildSignature(data, selected)
  if (state.signature === sig) return
  state.signature = sig
  state.selected = selected

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

  // 3. 控制点拖拽球体手柄
  const needCount = selected ? data.points.length : Math.min(1, data.points.length)
  while (state.handles.length < needCount) {
    const idx = state.handles.length
    const isStart = idx === 0
    const mat = new MeshBasicMaterial({
      color: isStart ? '#fbbf24' : '#34d399',
      depthTest: false,
      transparent: true,
      opacity: 0.95,
    })
    const mesh = new Mesh(isStart ? SHARED_START_GEO : SHARED_HANDLE_GEO, mat)
    mesh.renderOrder = 30
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
    mat.color.set(i === 0 ? '#fbbf24' : data.color || '#34d399')
    markSplineHelper(handle, node.id, i)
    if (selected) state.pickTargets.push(handle)
  }
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
