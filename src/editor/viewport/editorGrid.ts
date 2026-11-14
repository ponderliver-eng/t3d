import { DoubleSide, Mesh, PlaneGeometry } from 'three'
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
  vec2,
  vec3,
} from 'three/tsl'

const MINOR = vec3(0.42, 0.42, 0.46)
const MAJOR = vec3(0.62, 0.62, 0.66)
const AXIS_X = vec3(0.85, 0.35, 0.32)
const AXIS_Z = vec3(0.35, 0.52, 0.88)

export function createEditorGrid(): Mesh {
  const material = new MeshBasicNodeMaterial()
  material.lights = false
  material.transparent = true
  material.depthWrite = false
  material.depthTest = true
  material.fog = false
  material.toneMapped = false
  material.side = DoubleSide
  material.polygonOffset = true
  material.polygonOffsetFactor = -2
  material.polygonOffsetUnits = -2

  const x = positionWorld.x
  const z = positionWorld.z
  const distance = length(vec2(cameraPosition.x.sub(x), cameraPosition.z.sub(z)))
  const minor = lineMask(x, z, 1)
  const major = lineMask(x, z, 10)
  const onX = float(1).sub(min(abs(z).div(fwidth(z)), float(1)))
  const onZ = float(1).sub(min(abs(x).div(fwidth(x)), float(1)))
  const minorFade = float(1).sub(smoothstep(float(18), float(36), distance))
  const majorFade = float(1).sub(smoothstep(float(24), float(48), distance))
  const axisFade = float(1).sub(smoothstep(float(28), float(56), distance))
  const falloff = float(1).sub(smoothstep(float(16), float(52), distance))

  const color = mix(mix(mix(MINOR, MAJOR, major), AXIS_Z, onZ), AXIS_X, onX)
  const alpha = max(
    minor.mul(0.55).mul(minorFade),
    max(major.mul(0.75).mul(majorFade), max(onX, onZ).mul(0.9).mul(axisFade)),
  ).mul(falloff)

  material.colorNode = color
  material.opacityNode = alpha

  const mesh = new Mesh(new PlaneGeometry(120, 120), material)
  mesh.name = 'editor-grid'
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = 0.001
  mesh.frustumCulled = false
  mesh.raycast = () => {}
  mesh.receiveShadow = false
  mesh.castShadow = false
  mesh.renderOrder = -1
  return mesh
}

function lineMask(x: typeof positionWorld.x, z: typeof positionWorld.z, step: number) {
  const sx = x.div(float(step))
  const sz = z.div(float(step))
  const gx = abs(fract(sx.sub(0.5)).sub(0.5)).div(fwidth(sx))
  const gz = abs(fract(sz.sub(0.5)).sub(0.5)).div(fwidth(sz))
  return float(1).sub(min(min(gx, gz), float(1)))
}
