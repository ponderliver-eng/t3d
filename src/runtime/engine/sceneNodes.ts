import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  BoxGeometry,
  CapsuleGeometry,
  CineonToneMapping,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Euler,
  HemisphereLight,
  LinearToneMapping,
  NeutralToneMapping,
  NoToneMapping,
  PlaneGeometry,
  PointLight,
  Quaternion,
  ReinhardToneMapping,
  SphereGeometry,
  SpotLight,
  Vector3,
  type BufferGeometry,
  type Light,
  type Object3D,
  type ToneMapping,
} from 'three'
import type { SceneNode, ToneMap } from '../../editor/scene/types'

const DEG_TO_RAD = Math.PI / 180

/**
 * 统一的内置基础几何体创建函数：
 * 编辑器（`EditorViewport`）与独立运行时（`src/player/main.ts`）必须使用此唯一实现。
 */
export function createPrimitiveGeometry(kind: SceneNode['kind']): BufferGeometry | null {
  switch (kind) {
    case 'box':
      return new BoxGeometry(1, 1, 1)
    case 'sphere':
      return new SphereGeometry(0.5, 32, 24)
    case 'plane':
      return new PlaneGeometry(1, 1)
    case 'cylinder':
      return new CylinderGeometry(0.5, 0.5, 1, 24)
    case 'capsule':
      return new CapsuleGeometry(0.3, 0.5, 6, 16)
    case 'cone':
      return new ConeGeometry(0.5, 1, 24)
    default:
      return null
  }
}

/**
 * 统一的场景光源构建函数：
 * 负责 `directional-light` / `point-light` / `spot-light` / `hemisphere-light` 的创建与阴影参数配置。
 * 注意：`DirectionalLight` 与 `SpotLight` 的 `light.target` 会自动设置到 `(0, -1, 0)`，调用方需将 `light` 与 `light.target` 一并挂入节点 `Group`。
 */
export function createNodeLight(node: SceneNode): Light {
  const color = node.color || '#ffffff'
  const intensity = node.intensity ?? 2
  const range = node.range ?? 15
  const decay = node.decay ?? 2

  if (node.kind === 'directional-light') {
    const light = new DirectionalLight(color, intensity)
    light.castShadow = Boolean(node.castShadow)
    light.shadow.mapSize.set(2048, 2048)
    const distance = Math.max(range, 4)
    light.shadow.camera.near = 0.5
    light.shadow.camera.far = distance * 4
    light.shadow.camera.left = -range
    light.shadow.camera.right = range
    light.shadow.camera.top = range
    light.shadow.camera.bottom = -range
    if (typeof node.shadowBias === 'number') light.shadow.bias = node.shadowBias
    if (typeof node.shadowNormalBias === 'number') light.shadow.normalBias = node.shadowNormalBias
    light.target.position.set(0, -1, 0)
    return light
  }

  if (node.kind === 'point-light') {
    const light = new PointLight(color, intensity, range, decay)
    light.castShadow = Boolean(node.castShadow)
    if (typeof node.shadowBias === 'number') light.shadow.bias = node.shadowBias
    if (typeof node.shadowNormalBias === 'number') light.shadow.normalBias = node.shadowNormalBias
    return light
  }

  if (node.kind === 'spot-light') {
    const spotAngle = (node.spotAngle ?? 40) * DEG_TO_RAD
    const penumbra = node.penumbra ?? 0.25
    const light = new SpotLight(color, intensity, range, spotAngle, penumbra, decay)
    light.castShadow = Boolean(node.castShadow)
    if (typeof node.shadowBias === 'number') light.shadow.bias = node.shadowBias
    if (typeof node.shadowNormalBias === 'number') light.shadow.normalBias = node.shadowNormalBias
    light.target.position.set(0, -1, 0)
    return light
  }

  return new HemisphereLight(color, node.groundColor || '#334155', intensity)
}

/**
 * 统一的色调映射（ToneMapping）枚举转换。
 */
export function resolveToneMapping(mode: ToneMap | undefined): ToneMapping {
  if (mode === 'none') return NoToneMapping
  if (mode === 'linear') return LinearToneMapping
  if (mode === 'reinhard') return ReinhardToneMapping
  if (mode === 'cineon') return CineonToneMapping
  if (mode === 'agx') return AgXToneMapping
  if (mode === 'neutral') return NeutralToneMapping
  return ACESFilmicToneMapping
}

/**
 * 统一的骨骼节点查找（支持层级路径或骨骼名匹配）。
 */
export function findModelBoneInScene(root: Object3D, key: string): Object3D | null {
  let found: Object3D | null = null
  const walk = (object: Object3D, parentPath: string) => {
    if (found) return
    const label = object.name || object.type
    const path = parentPath ? `${parentPath}/${label}` : label
    const bone = object.type === 'Bone' || (object as { isBone?: boolean }).isBone
    if (bone && (path === key || object.name === key)) {
      found = object
      return
    }
    for (const child of object.children) walk(child, object === root ? '' : path)
  }
  for (const child of root.children) walk(child, '')
  return found
}

/**
 * 统一的父级世界位姿叠加局部变换（用于 `socketBone` 骨骼挂点）。
 */
export function appendSocketLocalPose(
  parent: { position: Vector3; quaternion: Quaternion; scale: Vector3 },
  node: Pick<SceneNode, 'position' | 'rotation' | 'scale'>,
) {
  const position = new Vector3(node.position[0], node.position[1], node.position[2])
    .multiply(parent.scale)
    .applyQuaternion(parent.quaternion)
    .add(parent.position)
  const q = new Quaternion().setFromEuler(
    new Euler(node.rotation[0] * DEG_TO_RAD, node.rotation[1] * DEG_TO_RAD, node.rotation[2] * DEG_TO_RAD, 'XYZ'),
  )
  return {
    position,
    quaternion: parent.quaternion.clone().multiply(q),
    scale: parent.scale.clone().multiply(new Vector3(node.scale[0], node.scale[1], node.scale[2])),
  }
}
