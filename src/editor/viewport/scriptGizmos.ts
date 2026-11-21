import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Vector3,
  type Scene,
} from 'three'
import { collectScriptGizmos, type ScriptGizmoCommand, type Vec3Obj } from '../../core/codeAssets/scriptRuntime'
import { useCodeAssetStore } from '../../core/codeAssets/workspace'
import { EDITOR_HELPER_LAYER } from '../project/taxonomy'
import type { SceneNode } from '../scene/types'

function markHelperLayer(obj: { layers: { set: (layer: number) => void } }) {
  obj.layers.set(EDITOR_HELPER_LAYER)
}

const HANDLE_GEOMETRY = new SphereGeometry(0.14, 12, 8)
const DISC_SEGMENTS = 32

export interface ScriptGizmoHandleMeta {
  kind: 'radiusHandle' | 'positionHandle'
  nodeId: string
  scriptId: string
  paramKey: string
  center: Vec3Obj
  axis: 'x' | 'y' | 'z'
  min?: number
  max?: number
}

export interface ScriptGizmoManager {
  handles: Mesh[]
  refresh: (nodes: Record<string, SceneNode>, show: boolean, selection: string[]) => void
  dispose: () => void
}

export function createScriptGizmoManager(scene: Scene): ScriptGizmoManager {
  const root = new Group()
  root.name = 'script-gizmos'
  markHelperLayer(root)
  scene.add(root)

  const manager: ScriptGizmoManager = {
    handles: [],
    refresh: () => {},
    dispose: () => {},
  }

  let lastSignature = ''

  const clearChildren = () => {
    for (const child of [...root.children]) {
      child.removeFromParent()
      if (child instanceof LineSegments) {
        child.geometry.dispose()
        ;(child.material as LineBasicMaterial).dispose()
      } else if (child instanceof Mesh) {
        ;(child.material as MeshBasicMaterial).dispose()
      }
    }
    manager.handles = []
  }

  manager.refresh = (nodes, show, selection) => {
    if (!show) {
      if (root.visible) {
        root.visible = false
      }
      return
    }
    root.visible = true

    const codeRev = useCodeAssetStore.getState().revision
    const selectedSet = new Set(selection)
    const entries: Array<{ node: SceneNode; scriptId: string; rawParams: unknown; selected: boolean }> = []
    const sigParts: string[] = [`rev:${codeRev}`]

    for (const node of Object.values(nodes)) {
      const projectBag = node.gameplay?.packs?.__project__
      if (!projectBag || typeof projectBag !== 'object') continue
      const isSelected = selectedSet.has(node.id)
      for (const [scriptId, rawParams] of Object.entries(projectBag as Record<string, unknown>)) {
        if (rawParams && typeof rawParams === 'object' && (rawParams as Record<string, unknown>).__enabled === false) {
          continue
        }
        entries.push({ node, scriptId, rawParams, selected: isSelected })
        sigParts.push(
          `${node.id}:${scriptId}:${isSelected ? 1 : 0}:${node.position.join(',')}:${JSON.stringify(rawParams ?? {})}`,
        )
      }
    }

    const nextSig = sigParts.join('|')
    if (nextSig === lastSignature) return
    lastSignature = nextSig

    clearChildren()
    if (entries.length === 0) return

    const lineBuckets = new Map<string, number[]>()
    const addSeg = (color: string, ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
      let arr = lineBuckets.get(color)
      if (!arr) {
        arr = []
        lineBuckets.set(color, arr)
      }
      arr.push(ax, ay, az, bx, by, bz)
    }

    for (const entry of entries) {
      const cmds = collectScriptGizmos(entry.node, entry.scriptId, entry.rawParams, entry.selected, nodes)
      for (const cmd of cmds) {
        emitCommand(cmd, entry.node.id, entry.scriptId, addSeg, (meta, pos, color) => {
          const mat = new MeshBasicMaterial({
            color: new Color(color),
            depthTest: false,
            depthWrite: false,
            side: DoubleSide,
            transparent: true,
            opacity: 0.95,
            toneMapped: false,
            fog: false,
          })
          const mesh = new Mesh(HANDLE_GEOMETRY, mat)
          mesh.name = `script-handle:${meta.scriptId}:${meta.paramKey}`
          mesh.position.set(pos.x, pos.y, pos.z)
          mesh.renderOrder = 15
          mesh.frustumCulled = false
          mesh.userData.scriptGizmo = meta
          markHelperLayer(mesh)
          root.add(mesh)
          manager.handles.push(mesh)
        })
      }
    }

    for (const [color, positions] of lineBuckets.entries()) {
      if (positions.length === 0) continue
      const geo = new BufferGeometry()
      geo.setAttribute('position', new Float32BufferAttribute(positions, 3))
      const mat = new LineBasicMaterial({
        color: new Color(color),
        transparent: true,
        opacity: 0.92,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        fog: false,
      })
      const lines = new LineSegments(geo, mat)
      lines.renderOrder = 14
      lines.frustumCulled = false
      markHelperLayer(lines)
      root.add(lines)
    }
  }

  manager.dispose = () => {
    clearChildren()
    root.removeFromParent()
  }

  return manager
}

function emitCommand(
  cmd: ScriptGizmoCommand,
  nodeId: string,
  scriptId: string,
  addSeg: (color: string, ax: number, ay: number, az: number, bx: number, by: number, bz: number) => void,
  addHandle: (meta: ScriptGizmoHandleMeta, pos: Vec3Obj, color: string) => void,
) {
  switch (cmd.kind) {
    case 'line':
      addSeg(cmd.color, cmd.from.x, cmd.from.y, cmd.from.z, cmd.to.x, cmd.to.y, cmd.to.z)
      return
    case 'arrow': {
      const dLen = Math.hypot(cmd.dir.x, cmd.dir.y, cmd.dir.z) || 1
      const dx = (cmd.dir.x / dLen) * cmd.length
      const dy = (cmd.dir.y / dLen) * cmd.length
      const dz = (cmd.dir.z / dLen) * cmd.length
      const tip = { x: cmd.from.x + dx, y: cmd.from.y + dy, z: cmd.from.z + dz }
      addSeg(cmd.color, cmd.from.x, cmd.from.y, cmd.from.z, tip.x, tip.y, tip.z)
      const head = Math.min(0.32, cmd.length * 0.25)
      const sideX = Math.abs(dx / cmd.length) > 0.9 ? 0 : 1
      const sideY = Math.abs(dx / cmd.length) > 0.9 ? 1 : 0
      const px = dy * 0 - dz * sideY
      const py = dz * sideX - dx * 0
      const pz = dx * sideY - dy * sideX
      const pLen = Math.hypot(px, py, pz) || 1
      const sx = (px / pLen) * head * 0.5
      const sy = (py / pLen) * head * 0.5
      const sz = (pz / pLen) * head * 0.5
      const bx = tip.x - (dx / cmd.length) * head
      const by = tip.y - (dy / cmd.length) * head
      const bz = tip.z - (dz / cmd.length) * head
      addSeg(cmd.color, tip.x, tip.y, tip.z, bx + sx, by + sy, bz + sz)
      addSeg(cmd.color, tip.x, tip.y, tip.z, bx - sx, by - sy, bz - sz)
      return
    }
    case 'wireSphere': {
      addCircle(cmd.center, { x: 0, y: 1, z: 0 }, cmd.radius, cmd.color, addSeg)
      addCircle(cmd.center, { x: 1, y: 0, z: 0 }, cmd.radius, cmd.color, addSeg)
      addCircle(cmd.center, { x: 0, y: 0, z: 1 }, cmd.radius, cmd.color, addSeg)
      return
    }
    case 'disc': {
      addCircle(cmd.center, cmd.normal, cmd.radius, cmd.color, addSeg)
      return
    }
    case 'wireBox': {
      const hx = Math.abs(cmd.size.x) * 0.5
      const hy = Math.abs(cmd.size.y) * 0.5
      const hz = Math.abs(cmd.size.z) * 0.5
      const cx = cmd.center.x
      const cy = cmd.center.y
      const cz = cmd.center.z
      const corners = [
        [cx - hx, cy - hy, cz - hz],
        [cx + hx, cy - hy, cz - hz],
        [cx + hx, cy + hy, cz - hz],
        [cx - hx, cy + hy, cz - hz],
        [cx - hx, cy - hy, cz + hz],
        [cx + hx, cy - hy, cz + hz],
        [cx + hx, cy + hy, cz + hz],
        [cx - hx, cy + hy, cz + hz],
      ]
      const edges = [
        [0, 1], [1, 2], [2, 3], [3, 0],
        [4, 5], [5, 6], [6, 7], [7, 4],
        [0, 4], [1, 5], [2, 6], [3, 7],
      ]
      for (const [a, b] of edges) {
        const pa = corners[a]
        const pb = corners[b]
        addSeg(cmd.color, pa[0], pa[1], pa[2], pb[0], pb[1], pb[2])
      }
      return
    }
    case 'radiusHandle': {
      const pos: Vec3Obj = {
        x: cmd.center.x + (cmd.axis === 'x' ? cmd.radius : 0),
        y: cmd.center.y + (cmd.axis === 'y' ? cmd.radius : 0),
        z: cmd.center.z + (cmd.axis === 'z' ? cmd.radius : 0),
      }
      addSeg(cmd.color, cmd.center.x, cmd.center.y, cmd.center.z, pos.x, pos.y, pos.z)
      addHandle(
        {
          kind: 'radiusHandle',
          nodeId,
          scriptId,
          paramKey: cmd.paramKey,
          center: cmd.center,
          axis: cmd.axis,
          min: cmd.min,
          max: cmd.max,
        },
        pos,
        cmd.color,
      )
      return
    }
    case 'positionHandle': {
      addHandle(
        {
          kind: 'positionHandle',
          nodeId,
          scriptId,
          paramKey: cmd.paramKey,
          center: cmd.position,
          axis: 'x',
        },
        cmd.position,
        cmd.color,
      )
      return
    }
  }
}

function addCircle(
  center: Vec3Obj,
  normal: Vec3Obj,
  radius: number,
  color: string,
  addSeg: (color: string, ax: number, ay: number, az: number, bx: number, by: number, bz: number) => void,
) {
  const n = new Vector3(normal.x, normal.y, normal.z)
  if (n.lengthSq() < 1e-6) n.set(0, 1, 0)
  n.normalize()
  const ref = Math.abs(n.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0)
  const u = new Vector3().crossVectors(ref, n).normalize()
  const v = new Vector3().crossVectors(n, u).normalize()

  let prevX = center.x + u.x * radius
  let prevY = center.y + u.y * radius
  let prevZ = center.z + u.z * radius
  for (let i = 1; i <= DISC_SEGMENTS; i += 1) {
    const a = (i / DISC_SEGMENTS) * Math.PI * 2
    const cos = Math.cos(a) * radius
    const sin = Math.sin(a) * radius
    const nx = center.x + u.x * cos + v.x * sin
    const ny = center.y + u.y * cos + v.y * sin
    const nz = center.z + u.z * cos + v.z * sin
    addSeg(color, prevX, prevY, prevZ, nx, ny, nz)
    prevX = nx
    prevY = ny
    prevZ = nz
  }
}

export function scriptGizmoHandlePatch(
  node: SceneNode,
  meta: ScriptGizmoHandleMeta,
  hit: Vector3,
): Partial<SceneNode> | null {
  const prevPacks = node.gameplay?.packs ?? {}
  const prevProject = (prevPacks.__project__ ?? {}) as Record<string, Record<string, unknown>>
  const curScriptParams = { ...(prevProject[meta.scriptId] ?? {}) }

  if (meta.kind === 'radiusHandle') {
    const c = new Vector3(meta.center.x, meta.center.y, meta.center.z)
    let nextRadius = hit.distanceTo(c)
    if (meta.min !== undefined) nextRadius = Math.max(meta.min, nextRadius)
    if (meta.max !== undefined) nextRadius = Math.min(meta.max, nextRadius)
    nextRadius = Math.max(0.05, Number(nextRadius.toFixed(3)))
    curScriptParams[meta.paramKey] = nextRadius
  } else if (meta.kind === 'positionHandle') {
    curScriptParams[meta.paramKey] = [
      Number(hit.x.toFixed(3)),
      Number(hit.y.toFixed(3)),
      Number(hit.z.toFixed(3)),
    ]
  } else {
    return null
  }

  return {
    gameplay: {
      ...node.gameplay,
      packs: {
        ...prevPacks,
        __project__: {
          ...prevProject,
          [meta.scriptId]: curScriptParams,
        },
      },
    },
  }
}
