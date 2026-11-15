// @ts-nocheck
// TSL 的节点泛型和这里的实例属性图对不上，图的正确性由两个后端的样例看。
import {
  AdditiveBlending,
  Color,
  CustomBlending,
  MultiplyBlending,
  NormalBlending,
  OneFactor,
  OneMinusSrcAlphaFactor,
  Vector2,
  type Material,
  type Texture,
} from 'three'
import {
  attribute,
  cameraPosition,
  cameraProjectionMatrix,
  cameraViewMatrix,
  cross,
  float,
  floor,
  fract,
  length,
  max,
  mix,
  mod,
  modelWorldMatrix,
  normalize,
  positionGeometry,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import {
  BatchedRenderer,
  RenderMode,
  SpriteBatch,
  TrailBatch,
  type IParticleSystem,
  type ParticleSystem,
  type VFXBatchSettings,
} from 'three.quarks'

/** 上游 SpriteBatch / TrailBatch 写入的实例属性。升级 quarks 时只改这里和下面的读取。 */
export const PARTICLE_ATTR = {
  offset: 'offset',
  rotation: 'rotation',
  size: 'size',
  color: 'color',
  uvTile: 'uvTile',
  velocity: 'velocity',
  previous: 'previous',
  next: 'next',
  side: 'side',
  width: 'width',
} as const

export class TslSpriteBatch extends SpriteBatch {
  override rebuildMaterial() {
    this.layers.mask = this.settings.layers.mask
    this.frustumCulled = false
    this.renderOrder = this.settings.renderOrder
    this.material = createSpriteMaterial(this.settings)
  }

  override applyDepthTexture() {}
}

export class TslTrailBatch extends TrailBatch {
  override rebuildMaterial() {
    this.layers.mask = this.settings.layers.mask
    this.frustumCulled = false
    this.renderOrder = this.settings.renderOrder
    this.material = createTrailMaterial(this.settings.material)
  }

  override applyDepthTexture() {}
}

/** 上游 addSystem 写死了 SpriteBatch / TrailBatch，所以换这两处构造。 */
export class TslBatchedRenderer extends BatchedRenderer {
  override addSystem(system: IParticleSystem) {
    const particle = system as ParticleSystem
    particle._renderer = this
    const settings = particle.getRendererSettings()
    for (let i = 0; i < this.batches.length; i += 1) {
      if (sameBatch(this.batches[i].settings, settings)) {
        this.batches[i].addSystem(system)
        this.systemToBatchIndex.set(system, i)
        return
      }
    }
    const batch = settings.renderMode === RenderMode.Trail ? new TslTrailBatch(settings) : new TslSpriteBatch(settings)
    batch.addSystem(system)
    this.batches.push(batch)
    this.systemToBatchIndex.set(system, this.batches.length - 1)
    this.add(batch)
  }
}

function sameColor(a: Material, b: Material) {
  const left = (a as { color?: { r: number, g: number, b: number } }).color
  const right = (b as { color?: { r: number, g: number, b: number } }).color
  if (!left || !right) return left === right
  return left.r === right.r && left.g === right.g && left.b === right.b
}

function sameBatch(a: VFXBatchSettings, b: VFXBatchSettings) {
  // 颜色、不透明度和深度写入在创建绘制材质时烤进节点，不能只按混合方式复用旧批次。
  return a.material.side === b.material.side
    && a.material.blending === b.material.blending
    && a.material.blendSrc === b.material.blendSrc
    && a.material.blendDst === b.material.blendDst
    && a.material.blendEquation === b.material.blendEquation
    && a.material.premultipliedAlpha === b.material.premultipliedAlpha
    && a.material.transparent === b.material.transparent
    && a.material.depthTest === b.material.depthTest
    && a.material.depthWrite === b.material.depthWrite
    && a.material.opacity === b.material.opacity
    && sameColor(a.material, b.material)
    && a.material.type === b.material.type
    && a.material.alphaTest === b.material.alphaTest
    && (a.material as { map?: Texture | null }).map === (b.material as { map?: Texture | null }).map
    && a.renderMode === b.renderMode
    && a.blendTiles === b.blendTiles
    && a.softParticles === b.softParticles
    && a.softFarFade === b.softFarFade
    && a.softNearFade === b.softNearFade
    && a.uTileCount === b.uTileCount
    && a.vTileCount === b.vTileCount
    && a.instancingGeometry === b.instancingGeometry
    && a.renderOrder === b.renderOrder
    && a.layers.mask === b.layers.mask
}

function createSpriteMaterial(settings: VFXBatchSettings) {
  const source = settings.material as Material & { map?: Texture | null, color?: { r: number, g: number, b: number }, opacity: number }
  const material = new MeshBasicNodeMaterial()
  copySurface(material, source)
  const particleColor = attr(PARTICLE_ATTR.color, 'vec4')
  const uvTile = attr(PARTICLE_ATTR.uvTile, 'float')
  const tiles = uni(new Vector2(settings.uTileCount, settings.vTileCount))
  const tint = uni(new Color(source.color?.r ?? 1, source.color?.g ?? 1, source.color?.b ?? 1))
  const tintOpacity = uni(source.opacity ?? 1)
  const baseUv = tiledUv(uv(), uvTile, tiles)
  let sampled = vec4(1, 1, 1, 1)
  if (source.map) {
    const current = texture(source.map, baseUv)
    if (settings.blendTiles) {
      const nextUv = tiledUv(uv(), floor(uvTile).add(1), tiles)
      sampled = mix(current, texture(source.map, nextUv), fract(uvTile))
    } else {
      sampled = current
    }
  }
  material.colorNode = sampled.rgb.mul(particleColor.rgb).mul(tint)
  material.opacityNode = sampled.a.mul(particleColor.a).mul(tintOpacity)
  material.vertexNode = spriteClip(settings.renderMode)
  material.alphaTest = source.alphaTest
  return material
}

function createTrailMaterial(source: Material) {
  const material = new MeshBasicNodeMaterial()
  copySurface(material, source)
  const particleColor = attr(PARTICLE_ATTR.color, 'vec4')
  const map = (source as { map?: Texture | null }).map
  const sampled = map ? texture(map, uv()) : vec4(1, 1, 1, 1)
  const color = (source as { color?: { r: number, g: number, b: number } }).color
  const tint = uni(new Color(color?.r ?? 1, color?.g ?? 1, color?.b ?? 1))
  material.colorNode = sampled.rgb.mul(particleColor.rgb).mul(tint)
  material.opacityNode = sampled.a.mul(particleColor.a)
  material.vertexNode = trailClip()
  material.side = 2
  return material
}

function copySurface(material: MeshBasicNodeMaterial, source: Material) {
  material.transparent = source.transparent
  material.opacity = source.opacity
  material.depthWrite = source.depthWrite
  material.depthTest = source.depthTest
  material.blending = source.blending
  material.blendSrc = source.blendSrc
  material.blendDst = source.blendDst
  material.blendEquation = source.blendEquation
  material.premultipliedAlpha = source.premultipliedAlpha
  material.side = source.side
  material.toneMapped = true
  material.vertexColors = false
}

function tiledUv(base: TslNode, tileIndex: TslNode, tiles: TslNode) {
  const index = floor(tileIndex)
  const col = mod(index, tiles.x)
  const row = tiles.y.sub(floor(index.div(tiles.x))).sub(1)
  return base.div(tiles).add(vec2(col.div(tiles.x), row.div(tiles.y)))
}

type TslNode = any

function attr(name: string, type: string): TslNode {
  return attribute(name, type)
}

function uni(value: unknown): TslNode {
  return uniform(value as never)
}

function spriteClip(mode: RenderMode) {
  const offset = attr(PARTICLE_ATTR.offset, 'vec3')
  const size = attr(PARTICLE_ATTR.size, 'vec3')
  const world = modelWorldMatrix.mul(vec4(offset, 1))
  if (mode === RenderMode.Mesh) return meshClip(offset, size)
  if (mode === RenderMode.Trail) return trailClip()
  const rotation = attr(PARTICLE_ATTR.rotation, 'float')
  const aligned = vec2(positionGeometry.x.mul(size.x), positionGeometry.y.mul(size.y))
  const c = rotation.cos()
  const s = rotation.sin()
  const rotated = vec2(c.mul(aligned.x).sub(s.mul(aligned.y)), s.mul(aligned.x).add(c.mul(aligned.y)))
  if (mode === RenderMode.HorizontalBillBoard) {
    const shifted = vec4(world.x.add(rotated.x), world.y, world.z.sub(rotated.y), world.w)
    return cameraProjectionMatrix.mul(cameraViewMatrix.mul(shifted))
  }
  if (mode === RenderMode.VerticalBillBoard) {
    const raised = vec4(world.x, world.y.add(rotated.y), world.z, world.w)
    const view = cameraViewMatrix.mul(raised)
    return cameraProjectionMatrix.mul(vec4(view.x.add(rotated.x), view.y, view.z, view.w))
  }
  if (mode === RenderMode.StretchedBillBoard) return stretchedClip(world, size)
  const view = cameraViewMatrix.mul(world)
  return cameraProjectionMatrix.mul(vec4(view.x.add(rotated.x), view.y.add(rotated.y), view.z, view.w))
}

function stretchedClip(world: TslNode, size: TslNode) {
  const velocity = attr(PARTICLE_ATTR.velocity, 'vec4')
  const view = cameraViewMatrix.mul(world)
  const viewVelocity = cameraViewMatrix.mul(vec4(velocity.x, velocity.y, velocity.z, 0)).xyz
  const vlength = max(length(viewVelocity), float(0.0001))
  const avg = size.x.add(size.y).mul(0.5)
  const side = normalize(cross(view.xyz, viewVelocity))
  const stretched = view.xyz
    .add(side.mul(positionGeometry.y).mul(avg))
    .sub(viewVelocity.mul(positionGeometry.x.add(0.5)).mul(float(1).add(velocity.w.div(vlength))).mul(avg))
  return cameraProjectionMatrix.mul(vec4(stretched, view.w))
}

function meshClip(offset: TslNode, size: TslNode) {
  const rotation = attr(PARTICLE_ATTR.rotation, 'vec4')
  const scaled = vec3(positionGeometry.x.mul(size.x), positionGeometry.y.mul(size.y), positionGeometry.z.mul(size.z))
  const spun = rotateByQuat(rotation, scaled)
  const local = vec4(spun.x.add(offset.x), spun.y.add(offset.y), spun.z.add(offset.z), 1)
  return cameraProjectionMatrix.mul(cameraViewMatrix.mul(modelWorldMatrix.mul(local)))
}

function trailClip() {
  const previous = attr(PARTICLE_ATTR.previous, 'vec3')
  const next = attr(PARTICLE_ATTR.next, 'vec3')
  const side = attr(PARTICLE_ATTR.side, 'float')
  const width = attr(PARTICLE_ATTR.width, 'float')
  const world = modelWorldMatrix.mul(vec4(positionGeometry, 1)).xyz
  const worldPrev = modelWorldMatrix.mul(vec4(previous, 1)).xyz
  const worldNext = modelWorldMatrix.mul(vec4(next, 1)).xyz
  const tangent = normalize(worldNext.sub(worldPrev).add(vec3(0, 0.0001, 0)))
  const toCamera = normalize(cameraPosition.sub(world))
  const binormal = normalize(cross(tangent, toCamera))
  const placed = world.add(binormal.mul(side).mul(width))
  return cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(placed, 1)))
}

function rotateByQuat(q: TslNode, v: TslNode) {
  const t = cross(q.xyz, v).mul(2)
  return v.add(t.mul(q.w)).add(cross(q.xyz, t))
}

export function surfaceBlending(blend: 'alpha' | 'premultiply' | 'additive' | 'multiply') {
  if (blend === 'alpha') return { blending: NormalBlending, premultipliedAlpha: false }
  if (blend === 'multiply') return { blending: MultiplyBlending, premultipliedAlpha: false }
  if (blend === 'premultiply') {
    return {
      blending: CustomBlending,
      premultipliedAlpha: true,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
    }
  }
  return { blending: AdditiveBlending, premultipliedAlpha: false }
}
