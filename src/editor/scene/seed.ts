import { Euler, Quaternion, Vector3 } from 'three'
import { makeNode } from './kinds'
import type { SceneNode, ScenePicture } from './types'
import { DEFAULT_PICTURE } from './types'

function aimDownY(from: Vector3, to: Vector3): [number, number, number] {
  const direction = to.clone().sub(from).normalize()
  const quaternion = new Quaternion().setFromUnitVectors(new Vector3(0, -1, 0), direction)
  const euler = new Euler().setFromQuaternion(quaternion, 'XYZ')
  return [euler.x * 180 / Math.PI, euler.y * 180 / Math.PI, euler.z * 180 / Math.PI]
}

export interface SeedScene {
  nodes: Record<string, SceneNode>
  selectedId: string
}

export function createSeed(): SeedScene {
  const sunPosition: [number, number, number] = [6, 10, 5]
  const nodes: Record<string, SceneNode> = {
    'seed-sun': makeNode({
      id: 'seed-sun',
      name: '方向光',
      kind: 'directional-light',
      order: 0,
      position: sunPosition,
      rotation: aimDownY(new Vector3(...sunPosition), new Vector3(0, 0.5, 0)),
    }),
    'seed-sky': makeNode({
      id: 'seed-sky',
      name: '环境光',
      kind: 'hemisphere-light',
      order: 1,
      position: [-5, 3, -4],
    }),
    'seed-ground': makeNode({
      id: 'seed-ground',
      name: '地面',
      kind: 'plane',
      order: 2,
      position: [0, 0, 0],
      rotation: [-90, 0, 0],
      scale: [40, 40, 1],
    }),
    'seed-cube': makeNode({
      id: 'seed-cube',
      name: '方块',
      kind: 'box',
      order: 3,
      position: [0, 0.5, 0],
    }),
  }
  return { nodes, selectedId: 'seed-cube' }
}

export function createFreshScene(name: string): { id: string, name: string, nodes: Record<string, SceneNode>, picture: ScenePicture, selectedId: string } {
  const seed = createSeed()
  const map = new Map<string, string>()
  for (const id of Object.keys(seed.nodes)) map.set(id, crypto.randomUUID())
  const nodes: Record<string, SceneNode> = {}
  for (const node of Object.values(seed.nodes)) {
    const copy = structuredClone(node)
    copy.id = map.get(node.id) ?? copy.id
    copy.parentId = node.parentId ? map.get(node.parentId) ?? null : null
    nodes[copy.id] = copy
  }
  return {
    id: crypto.randomUUID(),
    name,
    nodes,
    picture: structuredClone(DEFAULT_PICTURE),
    selectedId: map.get(seed.selectedId) ?? Object.keys(nodes)[0],
  }
}
