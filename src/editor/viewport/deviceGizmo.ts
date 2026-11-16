import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Vector3,
} from 'three'
import type { SceneNode } from '../scene/types'
import type { NodeGameplay } from '../../runtime/sceneRuntime'

export type DeviceHandleRole =
  | 'interact-radius'
  | 'trigger-radius'
  | 'checkpoint-radius'
  | 'checkpoint-abyss'
  | 'mover-end'
  | 'mover-carry'

const HANDLE_GEOMETRY = new SphereGeometry(0.16, 12, 8)

export interface DeviceGuide {
  root: Group
  handles: Mesh[]
  refresh: (node: SceneNode, origin: Vector3, show: boolean, selected: boolean) => void
  dispose: () => void
}

export function hasDeviceShape(node: SceneNode): boolean {
  const play = node.gameplay
  return Boolean(play?.interact || play?.trigger || play?.checkpoint || play?.mover)
}

export function createDeviceGuide(): DeviceGuide {
  const root = new Group()
  root.name = 'device-gizmo'
  const handles: Mesh[] = []
  const lines = {
    interact: wire(0x4cc8ff),
    trigger: wire(0xffb25a),
    checkpoint: wire(0x7dffa1),
    abyss: wire(0xff6b6b),
    mover: wire(0xffd94d),
    carry: wire(0xfff1a8),
  }
  for (const line of Object.values(lines)) root.add(line)
  const handleOf = (role: DeviceHandleRole, color: number) => {
    const mesh = new Mesh(HANDLE_GEOMETRY, new MeshBasicMaterial({
      color,
      depthTest: false,
      side: DoubleSide,
      depthWrite: false,
      transparent: true,
      opacity: 0.95,
      toneMapped: false,
      fog: false,
    }))
    mesh.name = role
    mesh.userData.deviceRole = role
    mesh.renderOrder = 14
    mesh.frustumCulled = false
    root.add(mesh)
    handles.push(mesh)
    return mesh
  }
  const knobs = {
    interact: handleOf('interact-radius', 0x4cc8ff),
    trigger: handleOf('trigger-radius', 0xffb25a),
    checkpoint: handleOf('checkpoint-radius', 0x7dffa1),
    abyss: handleOf('checkpoint-abyss', 0xff6b6b),
    mover: handleOf('mover-end', 0xffd94d),
    carry: handleOf('mover-carry', 0xfff1a8),
  }
  let key = ''
  return {
    root,
    handles,
    refresh(node, origin, show, selected) {
      root.position.copy(origin)
      root.visible = show
      const play = node.gameplay
      const next = signature(play, selected)
      const changed = next !== key
      key = next
      paintRadius(lines.interact, knobs.interact, play?.interact?.radius, show && Boolean(play?.interact), selected, changed)
      paintRadius(lines.trigger, knobs.trigger, play?.trigger?.radius, show && Boolean(play?.trigger), selected, changed)
      paintRadius(lines.checkpoint, knobs.checkpoint, play?.checkpoint?.radius, show && Boolean(play?.checkpoint), selected, changed)
      paintAbyss(lines.abyss, knobs.abyss, play?.checkpoint, origin.y, show && Boolean(play?.checkpoint), selected, changed)
      paintMover(lines.mover, lines.carry, knobs.mover, knobs.carry, play?.mover, show && Boolean(play?.mover), selected, changed)
      for (const mesh of handles) mesh.userData.nodeId = node.id
    },
    dispose() {
      root.removeFromParent()
      for (const line of Object.values(lines)) {
        line.geometry.dispose()
        ;(line.material as LineBasicMaterial).dispose()
      }
      for (const mesh of handles) (mesh.material as MeshBasicMaterial).dispose()
    },
  }
}

export function deviceHandlePatch(node: SceneNode, role: DeviceHandleRole, hit: Vector3, origin: Vector3): Partial<SceneNode> | null {
  const gameplay: NodeGameplay = { ...(node.gameplay ?? {}) }
  if (role === 'interact-radius' && gameplay.interact) {
    gameplay.interact = { ...gameplay.interact, radius: Math.max(0.2, hit.distanceTo(origin)) }
    return { gameplay }
  }
  if (role === 'trigger-radius' && gameplay.trigger) {
    gameplay.trigger = { ...gameplay.trigger, radius: Math.max(0.2, hit.distanceTo(origin)) }
    return { gameplay }
  }
  if (role === 'checkpoint-radius' && gameplay.checkpoint) {
    gameplay.checkpoint = { ...gameplay.checkpoint, radius: Math.max(0.2, hit.distanceTo(origin)) }
    return { gameplay }
  }
  if (role === 'checkpoint-abyss' && gameplay.checkpoint) {
    gameplay.checkpoint = { ...gameplay.checkpoint, abyssY: hit.y }
    return { gameplay }
  }
  if (role === 'mover-end' && gameplay.mover) {
    gameplay.mover = {
      ...gameplay.mover,
      offset: [hit.x - origin.x, hit.y - origin.y, hit.z - origin.z],
    }
    return { gameplay }
  }
  if (role === 'mover-carry' && gameplay.mover) {
    const flat = Math.hypot(hit.x - origin.x, hit.z - origin.z)
    gameplay.mover = { ...gameplay.mover, carryRadius: Math.max(0.4, flat) }
    return { gameplay }
  }
  return null
}

function wire(color: number) {
  const line = new LineSegments(
    new BufferGeometry(),
    new LineBasicMaterial({ color, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false, toneMapped: false, fog: false }),
  )
  line.frustumCulled = false
  line.renderOrder = 12
  line.raycast = () => {}
  return line
}

function signature(play: SceneNode['gameplay'], selected: boolean): string {
  const interact = play?.interact
  const trigger = play?.trigger
  const checkpoint = play?.checkpoint
  const mover = play?.mover
  return [
    selected ? 1 : 0,
    interact ? interact.radius.toFixed(2) : '-',
    trigger ? trigger.radius.toFixed(2) : '-',
    checkpoint ? `${checkpoint.radius.toFixed(2)}:${checkpoint.abyssY.toFixed(2)}` : '-',
    mover ? `${mover.offset.map(value => value.toFixed(2)).join(',')}:${mover.carryRadius.toFixed(2)}` : '-',
  ].join('|')
}

function paintRadius(line: LineSegments, knob: Mesh, radius: number | undefined, show: boolean, selected: boolean, changed: boolean) {
  line.visible = show
  knob.visible = show && selected
  if (!show || radius === undefined) return
  const size = Math.max(0.2, radius)
  knob.position.set(size, 0, 0)
  if (!changed) return
  replaceGeometry(line, sphereRings(size))
}

function paintAbyss(
  line: LineSegments,
  knob: Mesh,
  checkpoint: { radius: number, abyssY: number } | null | undefined,
  originY: number,
  show: boolean,
  selected: boolean,
  changed: boolean,
) {
  line.visible = show
  knob.visible = show && selected
  if (!show || !checkpoint) return
  const y = checkpoint.abyssY - originY
  const radius = Math.max(0.2, checkpoint.radius)
  knob.position.set(0, y, 0)
  if (!changed) return
  const positions = ring('y', radius, y)
  positions.push(0, 0, 0, 0, y, 0)
  replaceGeometry(line, positions)
}

function paintMover(
  path: LineSegments,
  carry: LineSegments,
  end: Mesh,
  carryKnob: Mesh,
  mover: { offset: [number, number, number], carryRadius: number } | null | undefined,
  show: boolean,
  selected: boolean,
  changed: boolean,
) {
  path.visible = show
  carry.visible = show
  end.visible = show && selected
  carryKnob.visible = show && selected
  if (!show || !mover) return
  const [x, y, z] = mover.offset
  const flat = Math.max(0.4, mover.carryRadius)
  end.position.set(x, y, z)
  carryKnob.position.set(flat, 0, 0)
  if (!changed) return
  replaceGeometry(path, [0, 0, 0, x, y, z])
  replaceGeometry(carry, ring('y', flat, 0))
}

function replaceGeometry(line: LineSegments, positions: number[]) {
  line.geometry.dispose()
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  line.geometry = geometry
}

function sphereRings(radius: number): number[] {
  return [...ring('x', radius, 0), ...ring('y', radius, 0), ...ring('z', radius, 0)]
}

function ring(axis: 'x' | 'y' | 'z', radius: number, along: number): number[] {
  const positions: number[] = []
  const segments = 40
  let previous: [number, number, number] | null = null
  for (let index = 0; index <= segments; index += 1) {
    const angle = (index / segments) * Math.PI * 2
    const cos = Math.cos(angle) * radius
    const sin = Math.sin(angle) * radius
    const point: [number, number, number] = axis === 'x'
      ? [along, cos, sin]
      : axis === 'y'
        ? [cos, along, sin]
        : [cos, sin, along]
    if (previous) positions.push(...previous, ...point)
    previous = point
  }
  return positions
}
