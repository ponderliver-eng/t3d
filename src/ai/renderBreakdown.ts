import type { BufferGeometry, Object3D } from 'three'
import { getViewportBridge } from '../core/preview/offscreenPreview'
import { useEditorStore } from '../editor/scene/store'

export interface RenderBreakdownEntry {
  id: string
  name: string
  kind: string
  triangles: number
  /** 估算的绘制批次：可见网格数 × 材质槽数（阴影、描边等额外通道不计） */
  meshDraws: number
}

function geometryTriangles(geometry: BufferGeometry | undefined): number {
  if (!geometry) return 0
  const count = geometry.index ? geometry.index.count : geometry.getAttribute('position')?.count ?? 0
  return Math.floor(count / 3)
}

/**
 * 按节点统计三角面与网格批次，定位「谁最重」。只读已有的场景对象，不触发渲染。
 * 子节点各自单独统计，不重复计入父节点。
 */
export function measureRenderBreakdown(top = 8): { top: RenderBreakdownEntry[]; totalTriangles: number; totalMeshDraws: number } | null {
  const bridge = getViewportBridge()
  if (!bridge) return null
  const nodes = useEditorStore.getState().nodes
  const entries: RenderBreakdownEntry[] = []
  for (const node of Object.values(nodes)) {
    const rootObj = bridge.resolveObject(node.id)
    if (!rootObj) continue
    let triangles = 0
    let meshDraws = 0
    const walk = (obj: Object3D) => {
      if (!obj.visible) return
      const owner = obj.userData?.nodeId
      if (obj !== rootObj && typeof owner === 'string' && owner !== node.id) return
      const mesh = obj as Object3D & {
        isMesh?: boolean
        isInstancedMesh?: boolean
        count?: number
        geometry?: BufferGeometry
        material?: unknown
      }
      if (mesh.isMesh) {
        const instances = mesh.isInstancedMesh ? Math.max(0, mesh.count ?? 1) : 1
        triangles += geometryTriangles(mesh.geometry) * instances
        meshDraws += Array.isArray(mesh.material) ? Math.max(1, mesh.material.length) : 1
      }
      for (const child of obj.children) walk(child)
    }
    walk(rootObj)
    if (triangles > 0 || meshDraws > 0) {
      entries.push({ id: node.id, name: node.name, kind: node.kind, triangles, meshDraws })
    }
  }
  entries.sort((a, b) => b.triangles - a.triangles)
  return {
    top: entries.slice(0, top),
    totalTriangles: entries.reduce((sum, item) => sum + item.triangles, 0),
    totalMeshDraws: entries.reduce((sum, item) => sum + item.meshDraws, 0),
  }
}
