import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  EdgesGeometry,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  SphereGeometry,
  Vector3,
  type Object3D,
} from 'three'
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js'
import { collectMeshCollider, meshColliderKey } from '../../capabilities/physics/meshCollect'
import type { SceneNode } from '../scene/types'

export interface ColliderGuide {
  root: LineSegments
  sync(node: SceneNode, object: Object3D, physics: boolean, character: boolean): void
  dispose(): void
}

export function createColliderGuide(): ColliderGuide {
  const root = new LineSegments(new BufferGeometry(), new LineBasicMaterial({
    color: 0x8bc34a,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    fog: false,
  }))
  root.frustumCulled = false
  root.renderOrder = 14
  root.raycast = () => {}
  root.visible = false
  let key = ''
  return {
    root,
    sync(node, object, physicsOn, characterOn) {
      const physics = node.physics
      const character = node.gameplay?.character
      const characterCapsule = Boolean(characterOn && character?.enabled && character.driver !== 'nav')
      const physicsShape = Boolean(physicsOn && physics)
      if (!physicsShape && !characterCapsule) {
        root.visible = false
        return
      }
      const meshKey = physicsShape && (physics?.shape === 'convex' || physics?.shape === 'trimesh') ? meshColliderKey(object) : ''
      const offset = character?.capsuleOffset ?? [0, 0, 0]
      const next = `${physicsShape ? physics?.shape : ''}|${physicsShape ? physics?.size.join(',') : ''}|${meshKey}|${characterCapsule ? 1 : 0}|${character?.radius ?? 0}|${character?.height ?? 0}|${offset.join(',')}`
      if (next !== key) {
        key = next
        const geometry = guideGeometry(node, object, physicsShape, characterCapsule)
        root.geometry.dispose()
        root.geometry = geometry
      }
      root.visible = (root.geometry.getAttribute('position')?.count ?? 0) > 0
    },
    dispose() {
      root.geometry.dispose()
      ;(root.material as LineBasicMaterial).dispose()
      root.removeFromParent()
    },
  }
}

function edged(source: BufferGeometry): BufferGeometry {
  const edges = new EdgesGeometry(source)
  source.dispose()
  return edges
}

function guideGeometry(node: SceneNode, object: Object3D, physicsOn: boolean, characterOn: boolean): BufferGeometry {
  const parts: BufferGeometry[] = []
  if (physicsOn && node.physics) parts.push(edgesFor(node, object))
  const character = node.gameplay?.character
  if (characterOn && character?.enabled && character.driver !== 'nav') {
    const offset = character.capsuleOffset ?? [0, 0, 0]
    parts.push(simpleCapsule(character.radius, character.height, offset[0], offset[1] + character.height * 0.5, offset[2]))
  }
  return mergeLines(parts)
}

function edgesFor(node: SceneNode, object: Object3D): BufferGeometry {
  const physics = node.physics
  if (!physics) return new BufferGeometry()
  const radius = Math.max(0.01, physics.size[0])
  const height = Math.max(0.02, physics.size[1])
  if (physics.shape === 'sphere') return edged(new SphereGeometry(radius, 24, 16))
  if (physics.shape === 'capsule') return simpleCapsule(radius, height, 0, 0, 0)
  if (physics.shape === 'cylinder') return edged(new CylinderGeometry(radius, radius, height, 24))
  if (physics.shape === 'cone') return edged(new ConeGeometry(radius, height, 24))
  if (physics.shape === 'convex' || physics.shape === 'trimesh') return meshEdges(object, physics.shape === 'convex')
  return edged(new BoxGeometry(radius, height, Math.max(0.01, physics.size[2])))
}

/** 上下两圈、四条竖线和两端各一条轮廓弧。 */
function simpleCapsule(radius: number, height: number, cx: number, cy: number, cz: number): BufferGeometry {
  const r = Math.max(0.01, radius)
  const total = Math.max(r * 2 + 0.02, height)
  const half = total * 0.5 - r
  const lines: number[] = []
  const ring = (y: number) => {
    const count = 16
    for (let i = 0; i < count; i += 1) {
      const a0 = (i / count) * Math.PI * 2
      const a1 = ((i + 1) / count) * Math.PI * 2
      lines.push(cx + Math.cos(a0) * r, y, cz + Math.sin(a0) * r, cx + Math.cos(a1) * r, y, cz + Math.sin(a1) * r)
    }
  }
  ring(cy - half)
  ring(cy + half)
  for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    const x = cx + Math.cos(angle) * r
    const z = cz + Math.sin(angle) * r
    lines.push(x, cy - half, z, x, cy + half, z)
  }
  const dome = (base: number, sign: 1 | -1) => {
    const count = 8
    for (let i = 0; i < count; i += 1) {
      const a0 = (i / count) * Math.PI
      const a1 = ((i + 1) / count) * Math.PI
      lines.push(
        cx + Math.cos(a0) * r, base + Math.sin(a0) * r * sign, cz,
        cx + Math.cos(a1) * r, base + Math.sin(a1) * r * sign, cz,
        cx, base + Math.sin(a0) * r * sign, cz + Math.cos(a0) * r,
        cx, base + Math.sin(a1) * r * sign, cz + Math.cos(a1) * r,
      )
    }
  }
  dome(cy + half, 1)
  dome(cy - half, -1)
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(lines, 3))
  return geometry
}

function mergeLines(parts: BufferGeometry[]): BufferGeometry {
  const lists = parts.filter(part => (part.getAttribute('position')?.count ?? 0) > 0)
  if (lists.length === 0) return new BufferGeometry()
  if (lists.length === 1) return lists[0]!
  const chunks: number[] = []
  for (const part of lists) {
    const attr = part.getAttribute('position')
    for (let i = 0; i < attr.count; i += 1) chunks.push(attr.getX(i), attr.getY(i), attr.getZ(i))
    part.dispose()
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(chunks, 3))
  return geometry
}

function meshEdges(object: Object3D, convex: boolean): BufferGeometry {
  const mesh = collectMeshCollider(object)
  if (!mesh) return new BufferGeometry()
  if (convex) {
    const points: Vector3[] = []
    const step = Math.max(1, Math.floor(mesh.positions.length / 3 / 2500))
    for (let i = 0; i < mesh.positions.length; i += 3 * step) {
      points.push(new Vector3(mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]))
    }
    if (points.length >= 4) {
      try {
        return edged(new ConvexGeometry(points))
      } catch {
        // 点共面时凸包会失败，改画三角边。
      }
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(mesh.positions, 3))
  geometry.setIndex(new BufferAttribute(Uint32Array.from(mesh.indices), 1))
  return edged(geometry)
}
