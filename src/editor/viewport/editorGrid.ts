import { FrontSide, Mesh, PlaneGeometry } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import {
  abs,
  cameraPosition,
  float,
  fract,
  fwidth,
  length,
  max,
  min,
  mix,
  positionWorld,
  smoothstep,
  uniform,
  vec2,
  vec3,
} from 'three/tsl'

const MINOR = vec3(0.42, 0.42, 0.46)
const MAJOR = vec3(0.62, 0.62, 0.66)
const AXIS_X = vec3(0.85, 0.35, 0.32)
const AXIS_Z = vec3(0.35, 0.52, 0.88)

/** 远处把格子收到 1、2、5 乘十的幂，避免一米一格铺满整块地面。 */
export function gridStepForDistance(distance: number): number {
  const target = Math.max(distance, 0.5) / 10
  const power = 10 ** Math.floor(Math.log10(target))
  const n = target / power
  const mantissa = n < 2 ? 1 : n < 5 ? 2 : 5
  return mantissa * power
}

export function createEditorGrid(): Mesh {
  const material = new MeshBasicNodeMaterial()
  material.lights = false
  material.transparent = true
  material.depthWrite = false
  material.depthTest = true
  material.fog = false
  material.toneMapped = false
  material.side = FrontSide
  material.polygonOffset = true
  material.polygonOffsetFactor = -1
  material.polygonOffsetUnits = -1

  const x = positionWorld.x
  const z = positionWorld.z
  const distance = length(vec2(cameraPosition.x.sub(x), cameraPosition.z.sub(z)))
  const reach = uniform(120)
  const step = uniform(1)
  const minor = lineMask(x, z, step.mul(1))
  const major = lineMask(x, z, step.mul(10))
  const onX = float(1).sub(min(abs(z).div(fwidth(z)), float(1)))
  const onZ = float(1).sub(min(abs(x).div(fwidth(x)), float(1)))
  const minorFade = float(1).sub(smoothstep(reach.mul(0.22), reach.mul(0.55), distance))
  const majorFade = float(1).sub(smoothstep(reach.mul(0.45), reach.mul(0.85), distance))
  const axisFade = float(1).sub(smoothstep(reach.mul(0.55), reach, distance))
  const falloff = float(1).sub(smoothstep(reach.mul(0.35), reach, distance))

  const color = mix(mix(mix(MINOR, MAJOR, major), AXIS_Z, onZ), AXIS_X, onX)
  const alpha = max(
    minor.mul(0.55).mul(minorFade),
    max(major.mul(0.75).mul(majorFade), max(onX, onZ).mul(0.9).mul(axisFade)),
  ).mul(falloff)

  material.colorNode = color
  material.opacityNode = alpha

  const mesh = new Mesh(new PlaneGeometry(4000, 4000), material)
  mesh.name = 'editor-grid'
  mesh.rotation.x = -Math.PI / 2
  mesh.frustumCulled = false
  mesh.raycast = () => {}
  mesh.receiveShadow = false
  mesh.castShadow = false
  mesh.renderOrder = -1
  mesh.userData.setGridLevel = (cell: number, distance: number) => {
    step.value = cell
    reach.value = distance
  }
  return mesh
}

function lineMask(x: typeof positionWorld.x, z: typeof positionWorld.z, cell: typeof positionWorld.x) {
  const sx = x.div(cell)
  const sz = z.div(cell)
  const gx = abs(fract(sx.sub(0.5)).sub(0.5)).div(fwidth(sx))
  const gz = abs(fract(sz.sub(0.5)).sub(0.5)).div(fwidth(sz))
  return float(1).sub(min(min(gx, gz), float(1)))
}
