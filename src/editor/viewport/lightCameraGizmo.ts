import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  LineBasicMaterial,
  LineSegments,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
  type Texture,
} from 'three'
import type { NodeKind, SceneNode } from '../scene/types'

const ICON = 0.7
const DEG = Math.PI / 180

export interface SceneGuide {
  icon: Sprite
  lines: LineSegments
  refresh: (node: SceneNode, parentScale: Vector3, aspect: number, show: boolean, selected: boolean) => void
}

export function createSceneGuide(kind: NodeKind): SceneGuide | null {
  if (kind !== 'directional-light' && kind !== 'point-light' && kind !== 'spot-light' && kind !== 'hemisphere-light' && kind !== 'camera') {
    return null
  }
  const icon = new Sprite(new SpriteMaterial({
    map: iconTexture(kind),
    transparent: true,
    depthTest: false,
    depthWrite: false,
    sizeAttenuation: true,
    toneMapped: false,
    fog: false,
  }))
  icon.scale.set(ICON, ICON, 1)
  icon.renderOrder = 12
  icon.frustumCulled = false
  const lines = new LineSegments(
    new BufferGeometry(),
    new LineBasicMaterial({
      color: kind === 'camera' ? 0x4cc8ff : 0xffd94d,
      transparent: true,
      opacity: kind === 'camera' ? 0.8 : 0.9,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    }),
  )
  lines.frustumCulled = false
  lines.renderOrder = 11
  lines.raycast = () => {}
  let key = ''
  return {
    icon,
    lines,
    refresh(node, parentScale, aspect, show, selected) {
      const ix = Math.abs(parentScale.x) > 1e-6 ? 1 / parentScale.x : 1
      const iy = Math.abs(parentScale.y) > 1e-6 ? 1 / parentScale.y : 1
      const iz = Math.abs(parentScale.z) > 1e-6 ? 1 / parentScale.z : 1
      icon.scale.set(ICON * ix, ICON * iy, 1)
      lines.scale.set(ix, iy, iz)
      icon.visible = show
      lines.visible = show && selected && node.kind !== 'hemisphere-light'
      const next = signature(node, aspect)
      if (next === key) return
      key = next
      lines.geometry.dispose()
      lines.geometry = lineGeometry(node, aspect)
    },
  }
}

function signature(node: SceneNode, aspect: number): string {
  if (node.kind === 'point-light') return `point:${node.range}`
  if (node.kind === 'spot-light') return `spot:${node.range}:${node.spotAngle}`
  if (node.kind === 'camera') return `cam:${node.fov}:${node.near}:${node.far}:${aspect.toFixed(3)}`
  return node.kind
}

function lineGeometry(node: SceneNode, aspect: number): BufferGeometry {
  const pairs: Array<[Vector3, Vector3]> = []
  if (node.kind === 'directional-light') directional(pairs)
  else if (node.kind === 'point-light') point(pairs, Math.max(node.range, 0.2))
  else if (node.kind === 'spot-light') spot(pairs, Math.max(node.range, 0.2), node.spotAngle * DEG)
  else if (node.kind === 'camera') camera(pairs, node.fov * DEG, Math.max(node.near, 0.05), Math.max(node.far, node.near + 0.2), Math.max(aspect, 0.2))
  return geometryFrom(pairs)
}

function directional(pairs: Array<[Vector3, Vector3]>) {
  const length = 1.5
  const spread = 0.25
  const offsets = [
    [0, 0],
    [spread, spread],
    [-spread, spread],
    [spread, -spread],
    [-spread, -spread],
  ]
  for (const [x, z] of offsets) {
    const start = new Vector3(x, 0, z)
    const end = new Vector3(x, -length, z)
    pairs.push([start, end], [end, new Vector3(x + 0.1, -length + 0.2, z)], [end, new Vector3(x - 0.1, -length + 0.2, z)])
  }
}

function point(pairs: Array<[Vector3, Vector3]>, radius: number) {
  ring(pairs, new Vector3(), radius, new Vector3(0, 1, 0), 40)
  ring(pairs, new Vector3(), radius, new Vector3(1, 0, 0), 40)
}

function spot(pairs: Array<[Vector3, Vector3]>, range: number, angle: number) {
  const radius = range * Math.tan(angle)
  const center = new Vector3(0, -range, 0)
  for (let i = 0; i < 3; i++) {
    const theta = (i * Math.PI * 2) / 3
    pairs.push([new Vector3(), center.clone().add(new Vector3(Math.cos(theta) * radius, 0, Math.sin(theta) * radius))])
  }
  ring(pairs, center, radius, new Vector3(0, 1, 0), 36)
}

function camera(pairs: Array<[Vector3, Vector3]>, fov: number, near: number, far: number, aspect: number) {
  const corners = (distance: number) => {
    const height = Math.tan(fov / 2) * distance
    const width = height * aspect
    return [
      new Vector3(-width, height, -distance),
      new Vector3(width, height, -distance),
      new Vector3(width, -height, -distance),
      new Vector3(-width, -height, -distance),
    ]
  }
  const close = corners(near)
  const distant = corners(far)
  for (let i = 0; i < 4; i++) {
    pairs.push([close[i], distant[i]], [distant[i], distant[(i + 1) % 4]])
  }
}

function ring(pairs: Array<[Vector3, Vector3]>, center: Vector3, radius: number, normal: Vector3, segments: number) {
  const up = Math.abs(normal.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0)
  const tangent = new Vector3().crossVectors(normal, up).normalize()
  const bitangent = new Vector3().crossVectors(normal, tangent).normalize()
  let previous: Vector3 | null = null
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2
    const point = center.clone()
      .addScaledVector(tangent, Math.cos(angle) * radius)
      .addScaledVector(bitangent, Math.sin(angle) * radius)
    if (previous) pairs.push([previous, point])
    previous = point
  }
}

function geometryFrom(pairs: Array<[Vector3, Vector3]>): BufferGeometry {
  const positions = new Float32Array(Math.max(pairs.length, 1) * 6)
  pairs.forEach(([a, b], index) => {
    const offset = index * 6
    positions[offset] = a.x
    positions[offset + 1] = a.y
    positions[offset + 2] = a.z
    positions[offset + 3] = b.x
    positions[offset + 4] = b.y
    positions[offset + 5] = b.z
  })
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  return geometry
}

const textures = new Map<string, Texture>()

function iconTexture(kind: NodeKind): Texture {
  const key = kind === 'hemisphere-light' ? 'hemi' : kind === 'camera' ? 'camera' : 'light'
  const cached = textures.get(key)
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (ctx) {
    if (key === 'light') paintLight(ctx)
    else if (key === 'hemi') paintHemi(ctx)
    else paintCamera(ctx)
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.needsUpdate = true
  textures.set(key, texture)
  return texture
}

function paintLight(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = 'rgba(255, 214, 0, 0.95)'
  ctx.beginPath()
  ctx.arc(32, 32, 12, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#FFD600'
  ctx.lineWidth = 3
  ctx.lineCap = 'round'
  const rays: Array<[number, number, number, number]> = [
    [32, 4, 32, 14], [32, 50, 32, 60], [4, 32, 14, 32], [50, 32, 60, 32],
    [12, 12, 19, 19], [45, 45, 52, 52], [52, 12, 45, 19], [19, 45, 12, 52],
  ]
  for (const [x1, y1, x2, y2] of rays) {
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
  }
}

function paintHemi(ctx: CanvasRenderingContext2D) {
  ctx.strokeStyle = 'rgba(168, 176, 188, 0.9)'
  ctx.fillStyle = 'rgba(142, 150, 162, 0.28)'
  ctx.lineWidth = 4
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.arc(32, 34, 20, Math.PI, Math.PI * 2)
  ctx.stroke()
  ctx.lineTo(12, 34)
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(12, 38)
  ctx.lineTo(52, 38)
  ctx.stroke()
  ctx.strokeStyle = 'rgba(168, 176, 188, 0.5)'
  ctx.lineWidth = 3
  for (const y of [46, 53]) {
    ctx.beginPath()
    ctx.moveTo(18, y)
    ctx.lineTo(46, y)
    ctx.stroke()
  }
}

function paintCamera(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = 'rgba(41, 182, 246, 0.95)'
  roundRect(ctx, 6, 18, 36, 28, 4)
  ctx.fill()
  ctx.fillStyle = 'rgba(2, 136, 209, 0.95)'
  ctx.beginPath()
  ctx.moveTo(42, 24)
  ctx.lineTo(58, 16)
  ctx.lineTo(58, 48)
  ctx.lineTo(42, 40)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = 'rgba(255, 255, 255, 0.35)'
  ctx.beginPath()
  ctx.arc(24, 32, 8, 0, Math.PI * 2)
  ctx.fill()
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}
