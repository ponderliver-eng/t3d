import { defaultNodeEffect } from '../../capabilities/particles/defaults'
import type { NodeKind, SceneNode, Vec3 } from './types'

export const MESH_KINDS: NodeKind[] = ['box', 'sphere', 'plane', 'capsule', 'cylinder', 'cone']
export const LIGHT_KINDS: NodeKind[] = ['directional-light', 'point-light', 'spot-light', 'hemisphere-light']

export function isMesh(kind: NodeKind): boolean {
  return MESH_KINDS.includes(kind)
}

export function isLight(kind: NodeKind): boolean {
  return LIGHT_KINDS.includes(kind)
}

export function defaultColor(kind: NodeKind): string {
  switch (kind) {
    case 'plane': return '#6c757e'
    case 'directional-light': return '#fff4d6'
    case 'point-light': return '#ffd2a8'
    case 'spot-light': return '#ffffff'
    case 'hemisphere-light': return '#d7e4f5'
    case 'camera': return '#9ecbff'
    case 'empty': return '#b0b0b0'
    default: return '#d5dde6'
  }
}

export function defaultIntensity(kind: NodeKind): number {
  switch (kind) {
    case 'directional-light': return 3.2
    case 'point-light': return 24
    case 'spot-light': return 30
    case 'hemisphere-light': return 0.7
    default: return 1
  }
}

export function restHeight(kind: NodeKind): number {
  switch (kind) {
    case 'box':
    case 'sphere':
    case 'cylinder':
    case 'cone':
      return 0.5
    case 'capsule':
      return 0.55
    case 'camera':
      return 1.5
    case 'model':
    case 'plane':
    case 'empty':
      return 0
    case 'effect':
      return 1
    default:
      return 2
  }
}

export function makeNode(partial: Pick<SceneNode, 'id' | 'name' | 'kind'> & Partial<SceneNode>): SceneNode {
  const kind = partial.kind
  return {
    parentId: null,
    order: 0,
    visible: true,
    locked: false,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    color: defaultColor(kind),
    intensity: defaultIntensity(kind),
    fov: 50,
    spotAngle: 32,
    assetId: null,
    clip: '',
    clipAssetId: null,
    clipTime: 0,
    clipPlaying: false,
    clipLoop: true,
    clipEnd: 'hold',
    clipSpeed: 1,
    clipFade: 0.15,
    clipInPlace: false,
    clipMask: 'full',
    animator: null,
    metalness: kind === 'plane' ? 0 : 0.04,
    roughness: kind === 'plane' ? 0.92 : 0.58,
    emissive: '#000000',
    emissiveIntensity: 1,
    opacity: 1,
    ao: 1,
    mapAssetId: null,
    normalAssetId: null,
    metallicRoughnessAssetId: null,
    emissiveAssetId: null,
    aoAssetId: null,
    materialAssetId: null,
    shader: 'lit',
    normalScale: 1,
    alphaMode: 'opaque',
    alphaCutoff: 0.5,
    cull: 'back',
    depthWrite: true,
    wireframe: false,
    effect: kind === 'effect' ? defaultNodeEffect() : null,
    slots: [],
    castShadow: kind === 'directional-light' || kind === 'spot-light' || ((isMesh(kind) || kind === 'model') && kind !== 'plane'),
    receiveShadow: isMesh(kind) || kind === 'model',
    shadowBias: kind === 'directional-light' ? -0.0002 : 0.0005,
    shadowNormalBias: 0.02,
    range: kind === 'spot-light' ? 40 : 12,
    decay: 2,
    penumbra: 0.15,
    groundColor: '#2c261f',
    near: 0.1,
    far: kind === 'camera' ? 200 : 40,
    ...partial,
  }
}

export function childrenOf(nodes: Record<string, SceneNode>, parentId: string | null): SceneNode[] {
  return Object.values(nodes)
    .filter(node => node.parentId === parentId)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'zh'))
}

export function nextOrder(nodes: Record<string, SceneNode>, parentId: string | null, exceptId?: string): number {
  let max = 0
  for (const node of Object.values(nodes)) {
    if (node.id === exceptId || node.parentId !== parentId) continue
    if (node.order >= max) max = node.order + 1
  }
  return max
}

export function uniqueName(nodes: Record<string, SceneNode>, base: string): string {
  const names = new Set(Object.values(nodes).map(node => node.name))
  const stripped = base.replace(/ \d+$/, '')
  if (!names.has(stripped)) return stripped
  let index = 2
  while (names.has(`${stripped} ${index}`)) index += 1
  return `${stripped} ${index}`
}

export function subtreeIds(nodes: Record<string, SceneNode>, rootId: string): string[] {
  const out: string[] = []
  const walk = (id: string) => {
    out.push(id)
    for (const child of childrenOf(nodes, id)) walk(child.id)
  }
  if (nodes[rootId]) walk(rootId)
  return out
}

export function spawnPosition(kind: NodeKind, parentId: string | null, spawn: Vec3): Vec3 {
  if (parentId) return [0, restHeight(kind), 0]
  return [spawn[0], restHeight(kind), spawn[2]]
}
