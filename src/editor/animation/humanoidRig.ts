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

function canonicalBone(bone: Bone): Bone {
  let current = bone
  while (current.parent && (current.parent as Bone).isBone && current.parent.name === current.name) {
    current = current.parent as Bone
  }
  return current
}

export function captureHumanoidSkeletons(root: Object3D): HumanoidSkeletonRecord[] {
  const meshes: SkinnedMesh[] = []
  root.traverse(child => {
    const mesh = child as SkinnedMesh
    if (mesh.isSkinnedMesh && mesh.skeleton?.bones?.length) meshes.push(mesh)
  })
  const seen = new Set<Object3D>()
  const records: HumanoidSkeletonRecord[] = []
  for (const mesh of meshes) {
    const bones: Object3D[] = []
    const addBone = (node: Object3D) => {
      const target = (node as Bone).isBone ? canonicalBone(node as Bone) : node
      if (!bones.includes(target)) bones.push(target)
    }
    for (const raw of mesh.skeleton.bones) addBone(raw)
    if (bones.every(bone => seen.has(bone))) continue
    const hips = bones.find(bone => classifyHumanoidBoneSlot(bone.name) === 'Hips') ?? bones[0]
    for (const bone of [...bones]) {
      let cur = bone.parent
      const chain: Object3D[] = []
      let reachesHips = false
      while (cur && cur !== root && !isSynthetic(cur)) {
        const target = (cur as Bone).isBone ? canonicalBone(cur as Bone) : cur
        if (target !== bone) chain.unshift(target)
        if (target === hips || bones.includes(target)) {
          reachesHips = true
          break
        }
        cur = cur.parent
      }
      if (reachesHips) {
        for (const item of chain) addBone(item)
      }
    }
    for (const bone of [...bones]) {
      bone.traverse(child => {
        if (child === bone || (child as SkinnedMesh).isMesh || isSynthetic(child)) return
        if ((child as Bone).isBone || classifyHumanoidBoneSlot(child.name) !== null) addBone(child)
      })
    }
    bones.forEach(bone => seen.add(bone))
    const boneSet = new Set<Object3D>(bones)
    const listed = bones.map((bone, index) => {
      let parentObj = bone.parent
      while (parentObj && (parentObj as Bone).isBone && parentObj.name === bone.name) {
        parentObj = parentObj.parent
      }
      const parent = parentObj && (parentObj as Bone).isBone ? canonicalBone(parentObj as Bone) : parentObj
      const parentIndex = parent && bones.includes(parent) ? bones.indexOf(parent) : undefined
      const matrix = new Matrix4().compose(bone.position, bone.quaternion, bone.scale)
      return {
        index,
        name: bone.name,
        ...(parentIndex !== undefined && parentIndex >= 0 ? { parentIndex } : {}),
        restMatrix: Array.from(matrix.elements),
      }
    })
    const frame = hips ? externalOf(hips, root, boneSet) : { rotation: new Quaternion(), scale: 1 }
    records.push({
      bones: listed,
      externalRotation: [frame.rotation.x, frame.rotation.y, frame.rotation.z, frame.rotation.w],
      externalScale: frame.scale,
    })
  }
  return records
}

function restFromQuat(position: [number, number, number], quaternion: [number, number, number, number]): number[] {
  const matrix = new Matrix4().compose(new Vector3(...position), new Quaternion(...quaternion).normalize(), new Vector3(1, 1, 1))
  return Array.from(matrix.elements)
}

/** 没有网格的 Unreal 标准骨骼片段，用内置 Mannequin 静息，而不是把第一帧当成 T 字。自动兼容米与厘米单位。 */
export function unrealMannequinSkeleton(names: readonly string[], unitScale = 1): HumanoidSkeletonRecord | null {
  const lower = new Set(names.map(normHumanoidBoneName))
  if (!lower.has('pelvis') || !(lower.has('upperarm l') || lower.has('upperarm r') || lower.has('thigh l') || lower.has('spine 01'))) return null
  const s = Number.isFinite(unitScale) && unitScale > 1e-4 ? unitScale : 1
  const bones: Array<{ index: number; name: string; parentIndex?: number; restMatrix: number[] }> = []
  const indexOf = new Map<string, number>()
  const add = (name: string, parentName: string | null, pos: [number, number, number], quat: [number, number, number, number]) => {
    const parentIndex = parentName != null ? indexOf.get(parentName) : undefined
    indexOf.set(name, bones.length)
    const scaled: [number, number, number] = [pos[0] * s, pos[1] * s, pos[2] * s]
    bones.push({ index: bones.length, name, ...(parentIndex !== undefined ? { parentIndex } : {}), restMatrix: restFromQuat(scaled, quat) })
  }
  add('pelvis', null, [0, 0.986864, 0], [0.5, 0.5, 0.5, 0.5])
  add('spine_01', 'pelvis', [0.061102, 0.015401, -0.000277], [0, 0, 0.020992, 0.99978])
  add('spine_02', 'spine_01', [0.091812, -0.000079, 0], [0, 0, -0.019446, 0.999811])
  add('spine_03', 'spine_02', [0.099476, -0.000132, 0], [0, 0, 0.000899, 1])
  add('neck_01', 'spine_03', [0.169179, -0.022027, 0], [0, 0, 0.116905, 0.993143])
  add('head', 'neck_01', [0.097081, 0, 0], [0, 0, -0.119334, 0.992854])
  add('clavicle_l', 'spine_03', [0.143519, -0.034011, 0.030765], [0.577778, -0.042132, 0.814575, -0.029398])
  add('upperarm_l', 'clavicle_l', [0.099309, 0, 0], [0, 0.196553, -0.024553, 0.980186])
  add('lowerarm_l', 'upperarm_l', [0.224754, 0, 0], [-0.052733, -0.001395, -0.025479, 0.998283])
  add('hand_l', 'lowerarm_l', [0.238808, 0, 0], [-0.705752, 0.001615, 0.04972, 0.70671])
  add('clavicle_r', 'spine_03', [0.143519, -0.034011, -0.030765], [-0.577778, 0.042129, 0.814575, -0.029396])
  add('upperarm_r', 'clavicle_r', [0.099309, 0, 0], [0, -0.196553, -0.024553, 0.980186])
  add('lowerarm_r', 'upperarm_r', [0.224754, 0, 0], [0.052732, 0.001395, -0.02548, 0.998283])
  add('hand_r', 'lowerarm_r', [0.238808, 0, 0], [0.705752, -0.001615, 0.04972, 0.70671])
  add('thigh_l', 'pelvis', [0, 0, 0.07835], [-0.001313, 0.999917, 0.000676, 0.012762])
  add('calf_l', 'thigh_l', [0.449571, 0, 0], [-0.00592, 0.000292, -0.049178, 0.998772])
  add('foot_l', 'calf_l', [0.432741, 0, 0], [-0.011277, 0.011604, 0.050768, 0.998579])
  add('ball_l', 'foot_l', [0.104224, 0.082972, 0], [0, 0, 0.707107, 0.707107])
  add('thigh_r', 'pelvis', [0, 0, -0.07835], [-0.001313, 0.999917, -0.000678, -0.01276])
  add('calf_r', 'thigh_r', [0.449572, 0, 0], [0.00592, -0.000291, -0.049178, 0.998772])
  add('foot_r', 'calf_r', [0.432741, 0, 0], [0.011277, -0.011605, 0.050768, 0.998579])
  add('ball_r', 'foot_r', [0.104224, 0.082972, 0], [0, 0, 0.707107, 0.707107])
  const fingers: Array<[string, string, [number, number, number], [number, number, number, number]]> = [
    ['thumb_01_l', 'hand_l', [0.013178, 0.01326, -0.02113], [0.543434, 0.282058, 0.019495, 0.790407]],
    ['thumb_02_l', 'thumb_01_l', [0.035566, 0, 0], [0, 0, 0.04032, 0.999187]],
    ['thumb_03_l', 'thumb_02_l', [0.023907, 0, 0], [0, 0, -0.009272, 0.999957]],
    ['index_01_l', 'hand_l', [0.067784, 0.003309, -0.025599], [0.220276, 0.016955, 0.000238, 0.97529]],
    ['index_02_l', 'index_01_l', [0.029494, 0, 0], [0, 0, 0.001176, 0.999999]],
    ['index_03_l', 'index_02_l', [0.021127, 0, 0], [0, 0, 0, 1]],
    ['middle_01_l', 'hand_l', [0.066945, -0.006547, -0.010363], [0.155147, 0.001076, 0.006813, 0.987867]],
    ['middle_02_l', 'middle_01_l', [0.036094, 0, 0], [0, 0, -0.002933, 0.999996]],
    ['middle_03_l', 'middle_02_l', [0.025555, 0, 0], [0, 0, -0.002933, 0.999996]],
    ['ring_01_l', 'hand_l', [0.067833, -0.008452, 0.006266], [0.024813, -0.052414, -0.009945, 0.998268]],
    ['ring_02_l', 'ring_01_l', [0.030027, 0, 0], [0, 0, 0.001837, 0.999998]],
    ['ring_03_l', 'ring_02_l', [0.022237, 0, 0], [0, 0, 0.001837, 0.999998]],
    ['pinky_01_l', 'hand_l', [0.065029, -0.008816, 0.022662], [-0.005699, -0.060011, -0.024941, 0.99787]],
    ['pinky_02_l', 'pinky_01_l', [0.020732, 0, 0], [0, 0, 0.001651, 0.999999]],
    ['pinky_03_l', 'pinky_02_l', [0.018775, 0, 0], [0, 0, 0.001651, 0.999999]],
    ['thumb_01_r', 'hand_r', [0.013178, 0.01326, 0.02113], [-0.543434, -0.282058, 0.019495, 0.790407]],
    ['thumb_02_r', 'thumb_01_r', [0.035566, 0, 0], [0, 0, 0.040321, 0.999187]],
    ['thumb_03_r', 'thumb_02_r', [0.023906, 0, 0], [0, 0, -0.009272, 0.999957]],
    ['index_01_r', 'hand_r', [0.067784, 0.003309, 0.025599], [-0.220276, -0.016955, 0.000238, 0.97529]],
    ['index_02_r', 'index_01_r', [0.029494, 0, 0], [0, 0, 0.001177, 0.999999]],
    ['index_03_r', 'index_02_r', [0.021127, 0, 0], [0, 0, 0, 1]],
    ['middle_01_r', 'hand_r', [0.066945, -0.006547, 0.010363], [-0.155147, -0.001076, 0.006814, 0.987867]],
    ['middle_02_r', 'middle_01_r', [0.036094, 0, 0], [0, 0, -0.002933, 0.999996]],
    ['middle_03_r', 'middle_02_r', [0.025555, 0, 0], [0, 0, -0.002933, 0.999996]],
    ['ring_01_r', 'hand_r', [0.067834, -0.008452, -0.006266], [-0.024813, 0.052414, -0.009945, 0.998268]],
    ['ring_02_r', 'ring_01_r', [0.030028, 0, 0], [0, 0, 0.001837, 0.999998]],
    ['ring_03_r', 'ring_02_r', [0.022237, 0, 0], [0, 0, 0.001836, 0.999998]],
    ['pinky_01_r', 'hand_r', [0.065029, -0.008816, -0.022662], [0.005699, 0.060011, -0.024941, 0.99787]],
    ['pinky_02_r', 'pinky_01_r', [0.020732, 0, 0], [0, 0, 0.001651, 0.999999]],
    ['pinky_03_r', 'pinky_02_r', [0.018775, 0, 0], [0, 0, 0.001651, 0.999999]],
  ]
  for (const [name, parent, pos, quaternion] of fingers) add(name, parent, pos, quaternion)
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
