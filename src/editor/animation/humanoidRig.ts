import { AnimationClip, Matrix4, Object3D, Quaternion, Vector3, type Bone, type SkinnedMesh } from 'three'
import { buildModelHumanoidAvatar, type HumanoidAvatarSkeletonInput, type HumanoidAvatarTrackInput, type ModelHumanoidAvatar } from './humanoidAvatar'
import {
  classifyHumanoidBoneSlot,
  inferHumanoidBoneMapFromTopology,
  normHumanoidBoneName,
  scoreHumanoidBoneMap,
  type HumanoidBoneSlot,
} from './humanoidSlots'

export interface RestTrs {
  position: Vector3
  rotation: Quaternion
  scaling: Vector3
  worldRotation: Quaternion
  parentWorldRotation: Quaternion
  childBoneLocalDir?: Vector3
  childBoneWorldDir?: Vector3
}

export interface HumanoidRigProfile {
  bySlot: Map<HumanoidBoneSlot, RestTrs>
  byNormName: Map<string, RestTrs>
  slotByNormName: Map<string, HumanoidBoneSlot>
  boneNameBySlot: Map<HumanoidBoneSlot, string>
  originalByNorm: Map<string, string>
  legScaleMetric: number
  hasTrueBindPose: boolean
  externalScale?: number
}

export interface HumanoidSkeletonRecord extends HumanoidAvatarSkeletonInput {
  externalRotation: [number, number, number, number]
  externalScale: number
}

const CHILD_SLOT: Partial<Record<HumanoidBoneSlot, HumanoidBoneSlot>> = {
  Spine: 'Chest', Chest: 'UpperChest', UpperChest: 'Neck', Neck: 'Head',
  LeftShoulder: 'LeftUpperArm', LeftUpperArm: 'LeftLowerArm', LeftLowerArm: 'LeftHand', LeftHand: 'LeftMiddleProximal',
  LeftThumbProximal: 'LeftThumbIntermediate', LeftThumbIntermediate: 'LeftThumbDistal',
  LeftIndexProximal: 'LeftIndexIntermediate', LeftIndexIntermediate: 'LeftIndexDistal',
  LeftMiddleProximal: 'LeftMiddleIntermediate', LeftMiddleIntermediate: 'LeftMiddleDistal',
  LeftRingProximal: 'LeftRingIntermediate', LeftRingIntermediate: 'LeftRingDistal',
  LeftLittleProximal: 'LeftLittleIntermediate', LeftLittleIntermediate: 'LeftLittleDistal',
  RightShoulder: 'RightUpperArm', RightUpperArm: 'RightLowerArm', RightLowerArm: 'RightHand', RightHand: 'RightMiddleProximal',
  RightThumbProximal: 'RightThumbIntermediate', RightThumbIntermediate: 'RightThumbDistal',
  RightIndexProximal: 'RightIndexIntermediate', RightIndexIntermediate: 'RightIndexDistal',
  RightMiddleProximal: 'RightMiddleIntermediate', RightMiddleIntermediate: 'RightMiddleDistal',
  RightRingProximal: 'RightRingIntermediate', RightRingIntermediate: 'RightRingDistal',
  RightLittleProximal: 'RightLittleIntermediate', RightLittleIntermediate: 'RightLittleDistal',
  LeftUpperLeg: 'LeftLowerLeg', LeftLowerLeg: 'LeftFoot', LeftFoot: 'LeftToes',
  RightUpperLeg: 'RightLowerLeg', RightLowerLeg: 'RightFoot', RightFoot: 'RightToes',
}

export function populateChildBoneDirections(bySlot: Map<HumanoidBoneSlot, RestTrs>): void {
  for (const [parentSlot, childSlot] of Object.entries(CHILD_SLOT) as Array<[HumanoidBoneSlot, HumanoidBoneSlot]>) {
    const parent = bySlot.get(parentSlot)
    let child = bySlot.get(childSlot)
    if (!child && parentSlot === 'Chest') child = bySlot.get('Neck') ?? bySlot.get('Head')
    if (!child && parentSlot === 'UpperChest') child = bySlot.get('Head')
    if (!child && parentSlot === 'LeftHand') child = bySlot.get('LeftIndexProximal') ?? bySlot.get('LeftRingProximal')
    if (!child && parentSlot === 'RightHand') child = bySlot.get('RightIndexProximal') ?? bySlot.get('RightRingProximal')
    if (!parent || !child || child.position.lengthSq() <= 1e-12) continue
    const localDir = child.position.clone().normalize()
    parent.childBoneLocalDir = localDir
    parent.childBoneWorldDir = localDir.clone().applyQuaternion(parent.worldRotation).normalize()
  }
}

export function computeLegMetric(bySlot: ReadonlyMap<HumanoidBoneSlot, RestTrs>): number {
  const chain = (bySlot.get('LeftUpperLeg')?.position.length() ?? 0)
    + (bySlot.get('LeftLowerLeg')?.position.length() ?? 0)
    + (bySlot.get('LeftFoot')?.position.length() ?? 0)
  if (chain > 1e-3) return chain
  const hips = bySlot.get('Hips')?.position.length() ?? 0
  return hips > 1e-3 ? hips : 1
}

export function computeHumanoidHipsScaleRatio(
  source: HumanoidRigProfile | null | undefined,
  target: HumanoidRigProfile | null | undefined,
): number {
  if (!source || !target) return 1
  if (source.legScaleMetric <= 1e-4 || target.legScaleMetric <= 1e-4) return 1
  const ratio = target.legScaleMetric / source.legScaleMetric
  if (!Number.isFinite(ratio) || ratio <= 1e-4 || ratio > 1e4) return 1
  return ratio
}

function decompose(matrix: number[] | undefined): RestTrs | null {
  if (!matrix || matrix.length !== 16 || !matrix.every(Number.isFinite)) return null
  const basis = new Matrix4().fromArray(matrix)
  const position = new Vector3()
  const rotation = new Quaternion()
  const scaling = new Vector3()
  basis.decompose(position, rotation, scaling)
  if (!Number.isFinite(position.x) || !Number.isFinite(rotation.w)) return null
  rotation.normalize()
  return {
    position,
    rotation,
    scaling,
    worldRotation: rotation.clone(),
    parentWorldRotation: new Quaternion(),
  }
}

function fillSkeleton(
  skeleton: HumanoidSkeletonRecord,
  bySlot: Map<HumanoidBoneSlot, RestTrs>,
  byNormName: Map<string, RestTrs>,
  slotByNormName: Map<string, HumanoidBoneSlot>,
  boneNameBySlot: Map<HumanoidBoneSlot, string>,
  originalByNorm: Map<string, string>,
  onlyMissing: boolean,
): number {
  const local = new Map<number, RestTrs>()
  for (const bone of skeleton.bones) {
    const trs = decompose(bone.restMatrix)
    if (trs) local.set(bone.index, trs)
  }
  const world = new Map<number, Quaternion>()
  const compute = (index: number, visited = new Set<number>()): Quaternion => {
    const hit = world.get(index)
    if (hit) return hit
    if (visited.has(index)) return new Quaternion()
    visited.add(index)
    const rotation = local.get(index)?.rotation.clone() ?? new Quaternion()
    const bone = skeleton.bones.find(item => item.index === index)
    const parent = bone?.parentIndex
    const result = typeof parent === 'number' && parent >= 0 && parent !== index
      ? compute(parent, visited).clone().multiply(rotation).normalize()
      : rotation
    world.set(index, result)
    return result
  }
  const external = new Quaternion(...skeleton.externalRotation).normalize()
  const hasExternal = Math.abs(external.w) < 0.9995 || Math.abs(external.x) + Math.abs(external.y) + Math.abs(external.z) > 1e-4
  for (const bone of skeleton.bones) {
    const trs = local.get(bone.index)
    if (!trs) continue
    const rawWorld = compute(bone.index)
    const rawParent = typeof bone.parentIndex === 'number' && bone.parentIndex >= 0 && bone.parentIndex !== bone.index
      ? compute(bone.parentIndex)
      : new Quaternion()
    trs.worldRotation = hasExternal ? external.clone().multiply(rawWorld).normalize() : rawWorld
    trs.parentWorldRotation = hasExternal ? external.clone().multiply(rawParent).normalize() : rawParent
  }
  const inferred = inferHumanoidBoneMapFromTopology(skeleton.bones.map(bone => {
    const position = local.get(bone.index)?.position
    return {
      index: bone.index,
      name: bone.name,
      parentIndex: bone.parentIndex,
      ...(position ? { position: { x: position.x, y: position.y, z: position.z } } : {}),
    }
  }))
  for (const [slot, name] of inferred) slotByNormName.set(normHumanoidBoneName(name), slot)
  for (const bone of skeleton.bones) {
    const trs = local.get(bone.index)
    if (!trs || !bone.name) continue
    const key = normHumanoidBoneName(bone.name)
    if (onlyMissing && byNormName.has(key)) continue
    const slot = slotByNormName.get(key) ?? classifyHumanoidBoneSlot(bone.name)
    if (onlyMissing && slot && bySlot.has(slot)) continue
    byNormName.set(key, trs)
    originalByNorm.set(key, bone.name)
    if (!slot) continue
    slotByNormName.set(key, slot)
    if (!bySlot.has(slot) || onlyMissing) {
      bySlot.set(slot, trs)
      boneNameBySlot.set(slot, bone.name)
    }
  }
  return scoreHumanoidBoneMap(inferred)
}

export function buildRigProfile(skeletons: readonly HumanoidSkeletonRecord[], hasTrueBindPose = true): HumanoidRigProfile | null {
  if (skeletons.length === 0) return null
  let best = 0
  let bestScore = -1
  skeletons.forEach((skeleton, index) => {
    const score = scoreHumanoidBoneMap(inferHumanoidBoneMapFromTopology(skeleton.bones.map(bone => ({
      index: bone.index,
      name: bone.name,
      parentIndex: bone.parentIndex,
    }))))
    if (score > bestScore) {
      bestScore = score
      best = index
    }
  })
  const bySlot = new Map<HumanoidBoneSlot, RestTrs>()
  const byNormName = new Map<string, RestTrs>()
  const slotByNormName = new Map<string, HumanoidBoneSlot>()
  const boneNameBySlot = new Map<HumanoidBoneSlot, string>()
  const originalByNorm = new Map<string, string>()
  const primary = skeletons[best]
  if (!primary) return null
  fillSkeleton(primary, bySlot, byNormName, slotByNormName, boneNameBySlot, originalByNorm, false)
  skeletons.forEach((skeleton, index) => {
    if (index !== best) fillSkeleton(skeleton, bySlot, byNormName, slotByNormName, boneNameBySlot, originalByNorm, true)
  })
  populateChildBoneDirections(bySlot)
  if (bySlot.size === 0 && byNormName.size === 0) return null
  return {
    bySlot,
    byNormName,
    slotByNormName,
    boneNameBySlot,
    originalByNorm,
    legScaleMetric: computeLegMetric(bySlot),
    hasTrueBindPose,
    externalScale: primary.externalScale,
  }
}

export function applyAvatarSlots(profile: HumanoidRigProfile, slots: ReadonlyMap<HumanoidBoneSlot, string>): HumanoidRigProfile {
  if (slots.size === 0) return profile
  const bySlot = new Map(profile.bySlot)
  const slotByNormName = new Map(profile.slotByNormName)
  const boneNameBySlot = new Map(profile.boneNameBySlot)
  for (const [slot, boneName] of slots) {
    const key = normHumanoidBoneName(boneName)
    const trs = profile.byNormName.get(key)
    if (!trs) continue
    for (const [name, mapped] of [...slotByNormName]) {
      if (mapped === slot && name !== key) slotByNormName.delete(name)
    }
    slotByNormName.set(key, slot)
    bySlot.set(slot, trs)
    boneNameBySlot.set(slot, boneName)
  }
  const next = { ...profile, bySlot, slotByNormName, boneNameBySlot }
  populateChildBoneDirections(bySlot)
  next.legScaleMetric = computeLegMetric(bySlot)
  return next
}

const registry: Array<{ id: string; names: Set<string>; skeletons: HumanoidSkeletonRecord[] }> = []

export function registerHumanoidSkeletons(id: string, skeletons: readonly HumanoidSkeletonRecord[]): void {
  if (skeletons.length === 0) return
  const names = new Set<string>()
  for (const skeleton of skeletons) for (const bone of skeleton.bones) if (bone.name) names.add(normHumanoidBoneName(bone.name))
  if (names.size < 6) return
  const index = registry.findIndex(entry => entry.id === id)
  const record = { id, names, skeletons: skeletons.map(skeleton => ({ ...skeleton, bones: [...skeleton.bones] })) }
  if (index >= 0) registry[index] = record
  else registry.push(record)
}

export function forgetHumanoidSkeletons(id: string): void {
  const index = registry.findIndex(entry => entry.id === id)
  if (index >= 0) registry.splice(index, 1)
}

export function matchingRegisteredSkeletons(names: Iterable<string>): HumanoidSkeletonRecord[] | null {
  const wanted = new Set<string>()
  for (const name of names) wanted.add(normHumanoidBoneName(name))
  let best: HumanoidSkeletonRecord[] | null = null
  let bestScore = 0
  for (const entry of registry) {
    let hits = 0
    for (const name of wanted) if (entry.names.has(name)) hits += 1
    if (hits > bestScore && hits >= 8) {
      bestScore = hits
      best = entry.skeletons
    }
  }
  return best
}

function isSynthetic(object: Object3D): boolean {
  if (object.name === '__root__' || object.name.startsWith('__template_')) return true
  return object.scale.x * object.scale.y * object.scale.z < -1e-6
}

function externalOf(hips: Object3D, root: Object3D, bones: ReadonlySet<Object3D>): { rotation: Quaternion; scale: number } {
  const chain: Object3D[] = []
  let current = hips.parent
  while (current && current !== root.parent) {
    if (!isSynthetic(current) && !bones.has(current)) chain.unshift(current)
    if (current === root) break
    current = current.parent
  }
  let rotation = new Quaternion()
  let scale = 1
  for (const node of chain) {
    rotation = rotation.multiply(node.quaternion).normalize()
    const uniform = (Math.abs(node.scale.x) + Math.abs(node.scale.y) + Math.abs(node.scale.z)) / 3
    if (uniform > 1e-4) scale *= uniform
  }
  return { rotation, scale }
}

export function captureHumanoidSkeletons(root: Object3D): HumanoidSkeletonRecord[] {
  const meshes: SkinnedMesh[] = []
  root.traverse(child => {
    const mesh = child as SkinnedMesh
    if (mesh.isSkinnedMesh && mesh.skeleton?.bones?.length) meshes.push(mesh)
  })
  const seen = new Set<Bone>()
  const records: HumanoidSkeletonRecord[] = []
  for (const mesh of meshes) {
    const bones = mesh.skeleton.bones
    if (bones.some(bone => seen.has(bone))) continue
    bones.forEach(bone => seen.add(bone))
    const boneSet = new Set<Object3D>(bones)
    const listed = bones.map((bone, index) => {
      const parent = bone.parent
      const parentIndex = parent && bones.includes(parent as Bone) ? bones.indexOf(parent as Bone) : undefined
      const matrix = new Matrix4().compose(bone.position, bone.quaternion, bone.scale)
      return {
        index,
        name: bone.name,
        ...(parentIndex !== undefined && parentIndex >= 0 ? { parentIndex } : {}),
        restMatrix: Array.from(matrix.elements),
      }
    })
    const hips = bones.find(bone => classifyHumanoidBoneSlot(bone.name) === 'Hips') ?? bones[0]
    const frame = hips ? externalOf(hips, root, boneSet) : { rotation: new Quaternion(), scale: 1 }
    records.push({
      bones: listed,
      externalRotation: [frame.rotation.x, frame.rotation.y, frame.rotation.z, frame.rotation.w],
      externalScale: frame.scale,
    })
  }
  return records
}

function restFromRows(
  position: [number, number, number],
  row0: [number, number, number],
  row1: [number, number, number],
  row2: [number, number, number],
): number[] {
  return [
    row0[0], row1[0], row2[0], 0,
    row0[1], row1[1], row2[1], 0,
    row0[2], row1[2], row2[2], 0,
    position[0], position[1], position[2], 1,
  ]
}

function restFromQuat(position: [number, number, number], quaternion: [number, number, number, number]): number[] {
  const matrix = new Matrix4().compose(new Vector3(...position), new Quaternion(...quaternion).normalize(), new Vector3(1, 1, 1))
  return Array.from(matrix.elements)
}

/** 没有网格的 Unreal 标准骨骼片段，用内置 Mannequin 静息，而不是把第一帧当成 T 字。 */
export function unrealMannequinSkeleton(names: readonly string[]): HumanoidSkeletonRecord | null {
  const lower = new Set(names.map(normHumanoidBoneName))
  if (!lower.has('pelvis') || !(lower.has('upperarm l') || lower.has('upperarm r') || lower.has('thigh l') || lower.has('spine 01'))) return null
  const bones: Array<{ index: number; name: string; parentIndex?: number; restMatrix: number[] }> = []
  const indexOf = new Map<string, number>()
  const add = (name: string, parentName: string | null, matrix: number[]) => {
    const parentIndex = parentName != null ? indexOf.get(parentName) : undefined
    indexOf.set(name, bones.length)
    bones.push({ index: bones.length, name, ...(parentIndex !== undefined ? { parentIndex } : {}), restMatrix: matrix })
  }
  add('pelvis', null, restFromRows([0, 0.986864, 0], [0, 1, 0], [0, 0, 1], [1, 0, 0]))
  add('spine_01', 'pelvis', restFromRows([0.0611, 0.0154, -0.0003], [0.9991, 0.042, 0], [-0.042, 0.9991, 0], [0, 0, 1]))
  add('spine_02', 'spine_01', restFromRows([0.0918, 0, 0], [0.9992, -0.0389, 0], [0.0389, 0.9992, 0], [0, 0, 1]))
  add('spine_03', 'spine_02', restFromRows([0.0995, 0, 0], [1, 0.0018, 0], [-0.0018, 1, 0], [0, 0, 1]))
  add('neck_01', 'spine_03', restFromRows([0.132, 0, 0], [0.99, 0.14, 0], [-0.14, 0.99, 0], [0, 0, 1]))
  add('head', 'neck_01', restFromRows([0.09, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]))
  add('clavicle_l', 'spine_03', restFromRows([0.1435, -0.034, 0.0308], [-0.3306, -0.0966, 0.9388], [-0.0008, -0.9947, -0.1026], [0.9438, -0.0347, 0.3288]))
  add('upperarm_l', 'clavicle_l', restFromRows([0.0993, 0, 0], [0.9215, -0.0481, -0.3853], [0.0481, 0.9988, -0.0097], [0.3853, -0.0097, 0.9227]))
  add('lowerarm_l', 'upperarm_l', restFromRows([0.2248, 0, 0], [0.9987, -0.0507, 0.0055], [0.051, 0.9931, -0.1052], [-0.0001, 0.1054, 0.9944]))
  add('hand_l', 'lowerarm_l', restFromRows([0.2388, 0, 0], [0.9951, 0.068, -0.0725], [-0.0726, -0.0011, -0.9974], [-0.0679, 0.9977, 0.0038]))
  add('clavicle_r', 'spine_03', restFromRows([0.1435, -0.034, -0.0308], [-0.3306, -0.0966, -0.9388], [-0.0008, -0.9947, 0.1026], [-0.9438, 0.0347, 0.3288]))
  add('upperarm_r', 'clavicle_r', restFromRows([0.0993, 0, 0], [0.9215, -0.0481, 0.3853], [0.0481, 0.9988, 0.0097], [-0.3853, 0.0097, 0.9227]))
  add('lowerarm_r', 'upperarm_r', restFromRows([0.2248, 0, 0], [0.9987, -0.0507, -0.0055], [0.051, 0.9931, 0.1052], [0.0001, -0.1054, 0.9944]))
  add('hand_r', 'lowerarm_r', restFromRows([0.2388, 0, 0], [0.9951, 0.068, 0.0725], [-0.0726, -0.0011, 0.9974], [0.0679, -0.9977, 0.0038]))
  add('thigh_l', 'pelvis', restFromRows([0, 0, 0.0783], [-0.9997, -0.0026, -0.0255], [-0.0026, 1, 0.0013], [0.0255, 0.0014, -0.9997]))
  add('calf_l', 'thigh_l', restFromRows([0.4496, 0, 0], [0.9952, -0.0982, 0], [0.0982, 0.9951, -0.0119], [0.0012, 0.0118, 0.9999]))
  add('foot_l', 'calf_l', restFromRows([0.4327, 0, 0], [0.9946, 0.1011, -0.0243], [-0.1017, 0.9946, -0.0213], [0.022, 0.0237, 0.9995]))
  add('ball_l', 'foot_l', restFromQuat([0, 0, 0], [0, 0, 0.7071, 0.7071]))
  add('thigh_r', 'pelvis', restFromRows([0, 0, -0.0783], [-0.9997, -0.0026, 0.0255], [-0.0026, 1, -0.0013], [-0.0255, -0.0014, -0.9997]))
  add('calf_r', 'thigh_r', restFromRows([0.4496, 0, 0], [0.9952, -0.0982, 0], [0.0982, 0.9951, 0.0119], [-0.0012, -0.0118, 0.9999]))
  add('foot_r', 'calf_r', restFromRows([0.4327, 0, 0], [0.9946, 0.1011, 0.0243], [-0.1017, 0.9946, 0.0213], [-0.022, -0.0237, 0.9995]))
  add('ball_r', 'foot_r', restFromQuat([0, 0, 0], [0, 0, 0.7071, 0.7071]))
  const fingers: Array<[string, string, [number, number, number, number]]> = [
    ['thumb_01_l', 'hand_l', [0.543, 0.282, 0.019, 0.79]], ['thumb_02_l', 'thumb_01_l', [0, 0, 0.04, 0.999]], ['thumb_03_l', 'thumb_02_l', [0, 0, -0.009, 1]],
    ['index_01_l', 'hand_l', [0.22, 0.017, 0, 0.975]], ['index_02_l', 'index_01_l', [0, 0, 0.001, 1]], ['index_03_l', 'index_02_l', [0, 0, 0, 1]],
    ['middle_01_l', 'hand_l', [0.155, 0.001, 0.007, 0.988]], ['middle_02_l', 'middle_01_l', [0, 0, -0.003, 1]], ['middle_03_l', 'middle_02_l', [0, 0, -0.003, 1]],
    ['ring_01_l', 'hand_l', [0.025, -0.052, -0.01, 0.998]], ['ring_02_l', 'ring_01_l', [0, 0, 0.002, 1]], ['ring_03_l', 'ring_02_l', [0, 0, 0.002, 1]],
    ['pinky_01_l', 'hand_l', [-0.006, -0.06, -0.025, 0.998]], ['pinky_02_l', 'pinky_01_l', [0, 0, 0.002, 1]], ['pinky_03_l', 'pinky_02_l', [0, 0, 0.002, 1]],
    ['thumb_01_r', 'hand_r', [-0.543, -0.282, 0.019, 0.79]], ['thumb_02_r', 'thumb_01_r', [0, 0, 0.04, 0.999]], ['thumb_03_r', 'thumb_02_r', [0, 0, -0.009, 1]],
    ['index_01_r', 'hand_r', [-0.22, -0.017, 0, 0.975]], ['index_02_r', 'index_01_r', [0, 0, 0.001, 1]], ['index_03_r', 'index_02_r', [0, 0, 0, 1]],
    ['middle_01_r', 'hand_r', [-0.155, -0.001, 0.007, 0.988]], ['middle_02_r', 'middle_01_r', [0, 0, -0.003, 1]], ['middle_03_r', 'middle_02_r', [0, 0, -0.003, 1]],
    ['ring_01_r', 'hand_r', [-0.025, 0.052, -0.01, 0.998]], ['ring_02_r', 'ring_01_r', [0, 0, 0.002, 1]], ['ring_03_r', 'ring_02_r', [0, 0, 0.002, 1]],
    ['pinky_01_r', 'hand_r', [0.006, 0.06, -0.025, 0.998]], ['pinky_02_r', 'pinky_01_r', [0, 0, 0.002, 1]], ['pinky_03_r', 'pinky_02_r', [0, 0, 0.002, 1]],
  ]
  for (const [name, parent, quaternion] of fingers) add(name, parent, restFromQuat([0.03, 0, 0], quaternion))
  return { bones, externalRotation: [0, 0, 0, 1], externalScale: 1 }
}

function clipTracks(clips: readonly AnimationClip[]): HumanoidAvatarTrackInput[] {
  const tracks: HumanoidAvatarTrackInput[] = []
  for (const clip of clips) {
    for (const track of clip.tracks) {
      const dot = track.name.lastIndexOf('.')
      if (dot <= 0) continue
      const property = track.name.slice(dot + 1)
      if (property !== 'position' && property !== 'quaternion' && property !== 'scale') continue
      const size = track.getValueSize()
      const keys = []
      for (let i = 0; i < track.times.length; i += 1) {
        keys.push({ frame: track.times[i] ?? 0, value: Array.from(track.values.slice(i * size, (i + 1) * size)) })
      }
      tracks.push({
        targetName: track.name.slice(0, dot),
        targetProperty: property === 'quaternion' ? 'rotationQuaternion' : property,
        keys,
      })
    }
  }
  return tracks
}

export interface ModelHumanoid {
  profile: HumanoidRigProfile | null
  avatar: ModelHumanoidAvatar | null
  skeletons: HumanoidSkeletonRecord[]
}

export function describeHumanoid(root: Object3D, clips: readonly AnimationClip[]): ModelHumanoid {
  const skeletons = captureHumanoidSkeletons(root)
  const profile = buildRigProfile(skeletons, skeletons.length > 0)
  const avatar = buildModelHumanoidAvatar({
    skeletons,
    tracks: clipTracks(clips),
    hasTrueBindPose: skeletons.length > 0,
  })
  return { profile, avatar, skeletons }
}
