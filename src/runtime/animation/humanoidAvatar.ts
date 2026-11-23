/**
 * 导入时记下的人形槽位。手改槽位盖过自动结果，并进入模型缓存版本。
 */

import { Quaternion, Vector3 } from 'three'
import {
  CORE_HUMANOID_SLOTS,
  buildHumanoidBoneMapFromNames,
  inferHumanoidBoneMapFromTopology,
  normHumanoidBoneName,
  scoreHumanoidBoneMap,
  type HumanoidBoneSlot,
} from './humanoidSlots'

export const HUMANOID_AVATAR_SCHEMA_VERSION = 1 as const

export type HumanoidRootMotionKind = 'inPlace' | 'rootMotion' | 'unknown'

export interface ModelHumanoidAvatar {
  schemaVersion: typeof HUMANOID_AVATAR_SCHEMA_VERSION
  slots: Partial<Record<HumanoidBoneSlot, string>>
  overrides?: Partial<Record<HumanoidBoneSlot, string>>
  missingCoreSlots: HumanoidBoneSlot[]
  skinCount: number
  hasTrueBindPose: boolean
  restConflictBones: string[]
  rootMotion: HumanoidRootMotionKind
  rootBoneName?: string
}

export interface HumanoidAvatarBoneInput {
  index: number
  name: string
  parentIndex?: number
  restMatrix?: number[]
}

export interface HumanoidAvatarSkeletonInput {
  bones: readonly HumanoidAvatarBoneInput[]
}

export interface HumanoidAvatarTrackInput {
  targetName?: string
  targetProperty: string
  keys: readonly { frame?: number; value: unknown }[]
}

const LEG_SLOTS: readonly HumanoidBoneSlot[] = [
  'LeftUpperLeg', 'LeftLowerLeg', 'LeftFoot', 'LeftToes',
  'RightUpperLeg', 'RightLowerLeg', 'RightFoot', 'RightToes',
]

function legCompleteness(map: ReadonlyMap<HumanoidBoneSlot, string>): number {
  let count = 0
  for (const slot of LEG_SLOTS) if (map.has(slot)) count += 1
  return count
}

function matrixTranslation(matrix: number[] | undefined): [number, number, number] | null {
  if (!matrix || matrix.length < 16) return null
  const x = Number(matrix[12])
  const y = Number(matrix[13])
  const z = Number(matrix[14])
  if (![x, y, z].every(Number.isFinite)) return null
  return [x, y, z]
}

function matrixQuaternion(matrix: number[] | undefined): [number, number, number, number] | null {
  if (!matrix || matrix.length < 16) return null
  const m00 = matrix[0] ?? 0
  const m01 = matrix[4] ?? 0
  const m02 = matrix[8] ?? 0
  const m10 = matrix[1] ?? 0
  const m11 = matrix[5] ?? 0
  const m12 = matrix[9] ?? 0
  const m20 = matrix[2] ?? 0
  const m21 = matrix[6] ?? 0
  const m22 = matrix[10] ?? 0
  const trace = m00 + m11 + m22
  let x = 0
  let y = 0
  let z = 0
  let w = 1
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2
    w = 0.25 * s
    x = (m21 - m12) / s
    y = (m02 - m20) / s
    z = (m10 - m01) / s
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2
    w = (m21 - m12) / s
    x = 0.25 * s
    y = (m01 + m10) / s
    z = (m02 + m20) / s
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2
    w = (m02 - m20) / s
    x = (m01 + m10) / s
    y = 0.25 * s
    z = (m12 + m21) / s
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2
    w = (m10 - m01) / s
    x = (m02 + m20) / s
    y = (m12 + m21) / s
    z = 0.25 * s
  }
  const len = Math.hypot(x, y, z, w) || 1
  return [x / len, y / len, z / len, w / len]
}

function restQuaternion(bone: HumanoidAvatarBoneInput): [number, number, number, number] | null {
  return matrixQuaternion(bone.restMatrix)
}

function collectRestConflicts(skeletons: readonly HumanoidAvatarSkeletonInput[], usedNames: ReadonlySet<string>): string[] {
  const byName = new Map<string, { label: string; quat: [number, number, number, number] }>()
  const conflicts: string[] = []
  for (const skeleton of skeletons) {
    for (const bone of skeleton.bones) {
      const key = normHumanoidBoneName(bone.name)
      if (!key || !usedNames.has(key)) continue
      const quat = restQuaternion(bone)
      if (!quat) continue
      const previous = byName.get(key)
      if (!previous) {
        byName.set(key, { label: bone.name, quat })
        continue
      }
      const dot = Math.abs(previous.quat[0] * quat[0] + previous.quat[1] * quat[1] + previous.quat[2] * quat[2] + previous.quat[3] * quat[3])
      const angle = Math.acos(Math.min(1, dot)) * 2 * 180 / Math.PI
      if (angle > 20 && !conflicts.includes(previous.label)) conflicts.push(previous.label)
    }
  }
  return conflicts
}

function positionKeys(track: HumanoidAvatarTrackInput | undefined): Array<[number, number, number]> {
  if (!track || track.targetProperty !== 'position') return []
  const out: Array<[number, number, number]> = []
  for (const key of track.keys) {
    if (!Array.isArray(key.value) || key.value.length < 3) continue
    const x = Number(key.value[0])
    const y = Number(key.value[1])
    const z = Number(key.value[2])
    if ([x, y, z].every(Number.isFinite)) out.push([x, y, z])
  }
  return out
}

function xzSpan(keys: ReadonlyArray<[number, number, number]>): number {
  if (keys.length === 0) return 0
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const [x, , z] of keys) {
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minZ = Math.min(minZ, z)
    maxZ = Math.max(maxZ, z)
  }
  return Math.hypot(maxX - minX, maxZ - minZ)
}

function findTrack(tracks: readonly HumanoidAvatarTrackInput[], boneName: string, property: string) {
  const key = normHumanoidBoneName(boneName)
  return tracks.find(track => track.targetProperty === property && track.targetName && normHumanoidBoneName(track.targetName) === key)
}

function parentOf(skeletons: readonly HumanoidAvatarSkeletonInput[], boneName: string) {
  const key = normHumanoidBoneName(boneName)
  for (const skeleton of skeletons) {
    const bone = skeleton.bones.find(item => normHumanoidBoneName(item.name) === key)
    if (!bone || bone.parentIndex === undefined) continue
    return skeleton.bones.find(item => item.index === bone.parentIndex)
  }
  return undefined
}

function classifyRootMotion(
  skeletons: readonly HumanoidAvatarSkeletonInput[],
  tracks: readonly HumanoidAvatarTrackInput[],
  hipsName: string | undefined,
  legLength: number,
): { rootMotion: HumanoidRootMotionKind; rootBoneName?: string } {
  if (!hipsName) return { rootMotion: 'unknown' }
  const parent = parentOf(skeletons, hipsName)
  const hipsSpan = xzSpan(positionKeys(findTrack(tracks, hipsName, 'position')))
  const rootSpan = parent ? xzSpan(positionKeys(findTrack(tracks, parent.name, 'position'))) : 0
  const scale = legLength > 1e-3 ? legLength : 1
  const tiny = 0.04 * scale
  if (parent && rootSpan > tiny && rootSpan > hipsSpan * 1.5) return { rootMotion: 'rootMotion', rootBoneName: parent.name }
  if (hipsSpan > tiny || rootSpan > tiny) return { rootMotion: 'rootMotion' }
  if (tracks.some(track => track.targetProperty === 'position')) return { rootMotion: 'inPlace' }
  return { rootMotion: 'unknown' }
}

function legLengthOf(map: ReadonlyMap<HumanoidBoneSlot, string>, skeletons: readonly HumanoidAvatarSkeletonInput[]): number {
  const names = ['LeftLowerLeg', 'LeftFoot', 'RightLowerLeg', 'RightFoot']
    .map(slot => map.get(slot as HumanoidBoneSlot))
    .filter((name): name is string => Boolean(name))
  let length = 0
  for (const skeleton of skeletons) {
    for (const bone of skeleton.bones) {
      if (!names.some(name => normHumanoidBoneName(name) === normHumanoidBoneName(bone.name))) continue
      const translation = matrixTranslation(bone.restMatrix)
      if (translation) length = Math.max(length, Math.hypot(...translation))
    }
  }
  return length
}

export function buildModelHumanoidAvatar(input: {
  skeletons: readonly HumanoidAvatarSkeletonInput[]
  tracks?: readonly HumanoidAvatarTrackInput[]
  hasTrueBindPose?: boolean
  overrides?: Partial<Record<HumanoidBoneSlot, string>>
}): ModelHumanoidAvatar | null {
  const skeletons = input.skeletons.filter(skeleton => skeleton.bones.length > 0)
  if (skeletons.length === 0) return null
  const ranked = skeletons.map((skeleton, index) => {
    const inputs = skeleton.bones.map(bone => ({ index: bone.index, name: bone.name, parentIndex: bone.parentIndex }))
    const map = inputs.length >= 9
      ? inferHumanoidBoneMapFromTopology(inputs)
      : buildHumanoidBoneMapFromNames(inputs.map(bone => bone.name))
    return { map, score: scoreHumanoidBoneMap(map), legs: legCompleteness(map), index }
  })
  const slots: Partial<Record<HumanoidBoneSlot, string>> = {}
  const slotNames = new Set<HumanoidBoneSlot>()
  for (const candidate of ranked) for (const slot of candidate.map.keys()) slotNames.add(slot)
  for (const slot of slotNames) {
    const owners = ranked.filter(candidate => candidate.map.has(slot))
    owners.sort((a, b) => {
      if (LEG_SLOTS.includes(slot)) {
        const aComplete = a.legs >= 3 ? 1 : 0
        const bComplete = b.legs >= 3 ? 1 : 0
        if (aComplete !== bComplete) return bComplete - aComplete
      }
      if (a.score !== b.score) return b.score - a.score
      if (a.legs !== b.legs) return b.legs - a.legs
      return a.index - b.index
    })
    const name = owners[0]?.map.get(slot)
    if (name) slots[slot] = name
  }
  const overrides = input.overrides
  if (overrides) {
    for (const [slot, name] of Object.entries(overrides)) {
      if (typeof name === 'string' && name) slots[slot as HumanoidBoneSlot] = name
    }
  }
  if (!slots.Hips) return null
  const chosen = new Map(Object.entries(slots) as Array<[HumanoidBoneSlot, string]>)
  const motion = classifyRootMotion(skeletons, input.tracks ?? [], slots.Hips, legLengthOf(chosen, skeletons))
  return {
    schemaVersion: HUMANOID_AVATAR_SCHEMA_VERSION,
    slots,
    ...(overrides && Object.keys(overrides).length > 0 ? { overrides: { ...overrides } } : {}),
    missingCoreSlots: CORE_HUMANOID_SLOTS.filter(slot => !slots[slot]),
    skinCount: skeletons.length,
    hasTrueBindPose: input.hasTrueBindPose !== false,
    restConflictBones: collectRestConflicts(skeletons, new Set([...chosen.values()].map(normHumanoidBoneName))),
    rootMotion: motion.rootMotion,
    ...(motion.rootBoneName ? { rootBoneName: motion.rootBoneName } : {}),
  }
}

export function preserveHumanoidAvatarOverrides(
  avatar: ModelHumanoidAvatar | null | undefined,
  previous: ModelHumanoidAvatar | null | undefined,
): ModelHumanoidAvatar | null | undefined {
  const overrides = previous?.overrides
  if (!avatar || !overrides || Object.keys(overrides).length === 0) return avatar
  const slots = { ...avatar.slots }
  for (const [slot, name] of Object.entries(overrides)) {
    if (typeof name === 'string' && name) slots[slot as HumanoidBoneSlot] = name
  }
  return {
    ...avatar,
    slots,
    overrides: { ...overrides },
    missingCoreSlots: CORE_HUMANOID_SLOTS.filter(slot => !slots[slot]),
  }
}

export function humanoidAvatarCacheKey(avatar: ModelHumanoidAvatar | null | undefined): string {
  const overrides = avatar?.overrides
  if (!overrides) return ''
  return Object.entries(overrides)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([slot, name]) => `${slot}=${name}`)
    .join('|')
}

export function mergedHumanoidSlots(avatar: ModelHumanoidAvatar | null | undefined): Map<HumanoidBoneSlot, string> {
  const map = new Map<HumanoidBoneSlot, string>()
  if (!avatar?.slots) return map
  const merged = { ...avatar.slots, ...avatar.overrides }
  for (const [slot, name] of Object.entries(merged)) {
    if (typeof name === 'string' && name) map.set(slot as HumanoidBoneSlot, name)
  }
  return map
}

type Vec3 = [number, number, number]

function asVec3(value: unknown): Vec3 | null {
  if (!Array.isArray(value) || value.length < 3) return null
  const x = Number(value[0])
  const y = Number(value[1])
  const z = Number(value[2])
  if (![x, y, z].every(Number.isFinite)) return null
  return [x, y, z]
}

function translationOf(bone: HumanoidAvatarBoneInput | undefined): Vec3 {
  return matrixTranslation(bone?.restMatrix) ?? [0, 0, 0]
}

function spanOf(keys: readonly { value: unknown }[]): number {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  let count = 0
  for (const key of keys) {
    const value = asVec3(key.value)
    if (!value) continue
    count += 1
    minX = Math.min(minX, value[0])
    maxX = Math.max(maxX, value[0])
    minZ = Math.min(minZ, value[2])
    maxZ = Math.max(maxZ, value[2])
  }
  if (count === 0) return 0
  return Math.hypot(maxX - minX, maxZ - minZ)
}

function lerpVec(keys: readonly { frame?: number; value: unknown }[], frame: number, fallback: Vec3): Vec3 {
  const valid: Array<{ t: number; v: Vec3 }> = []
  for (const key of keys) {
    const v = asVec3(key.value)
    if (v) valid.push({ t: key.frame ?? 0, v })
  }
  if (valid.length === 0) return fallback
  if (frame <= valid[0]!.t) return valid[0]!.v
  for (let i = 1; i < valid.length; i += 1) {
    const a = valid[i - 1]!
    const b = valid[i]!
    if (frame <= b.t) {
      const span = b.t - a.t
      const alpha = span > 1e-6 ? (frame - a.t) / span : 0
      return [
        a.v[0] + (b.v[0] - a.v[0]) * alpha,
        a.v[1] + (b.v[1] - a.v[1]) * alpha,
        a.v[2] + (b.v[2] - a.v[2]) * alpha,
      ]
    }
  }
  return valid[valid.length - 1]!.v
}

function asQuat4(value: unknown): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length < 4) return null
  const x = Number(value[0])
  const y = Number(value[1])
  const z = Number(value[2])
  const w = Number(value[3])
  if (![x, y, z, w].every(Number.isFinite)) return null
  const len = Math.hypot(x, y, z, w) || 1
  return [x / len, y / len, z / len, w / len]
}

function slerpQuat(keys: readonly { frame?: number; value: unknown }[], frame: number, fallback: Quaternion): Quaternion {
  const valid: Array<{ t: number; q: Quaternion }> = []
  for (const key of keys) {
    const arr = asQuat4(key.value)
    if (arr) valid.push({ t: key.frame ?? 0, q: new Quaternion(...arr) })
  }
  if (valid.length === 0) return fallback.clone()
  if (frame <= valid[0]!.t) return valid[0]!.q.clone()
  for (let i = 1; i < valid.length; i += 1) {
    const a = valid[i - 1]!
    const b = valid[i]!
    if (frame <= b.t) {
      const span = b.t - a.t
      const alpha = span > 1e-6 ? (frame - a.t) / span : 0
      return a.q.clone().slerp(b.q, alpha).normalize()
    }
  }
  return valid[valid.length - 1]!.q.clone()
}

function mergeFrames(a: readonly { frame?: number }[] | undefined, b: readonly { frame?: number }[] | undefined): number[] {
  const raw = [...(a ?? []), ...(b ?? [])].map(k => k.frame ?? 0).sort((x, y) => x - y)
  const out: number[] = []
  for (const t of raw) {
    if (out.length === 0 || Math.abs(t - out[out.length - 1]!) > 1e-4) out.push(t)
  }
  return out
}

/** 盆骨几乎不动、父节点在走时，把父节点位移与旋转收进盆骨。按这一条片段判断。 */
export function foldRootMotionTracks<T extends HumanoidAvatarTrackInput>(
  tracks: readonly T[],
  skeletons: readonly HumanoidAvatarSkeletonInput[],
  slotByNormName: ReadonlyMap<string, HumanoidBoneSlot>,
  avatar?: ModelHumanoidAvatar | null,
): readonly T[] {
  let hipsName: string | undefined
  for (const track of tracks) {
    if (track.targetName && slotByNormName.get(normHumanoidBoneName(track.targetName)) === 'Hips') {
      hipsName = track.targetName
      break
    }
  }
  hipsName ??= avatar?.slots?.Hips
  if (!hipsName) return tracks
  const hipsBone = findBone(skeletons, hipsName)
  const parent = hipsBone && hipsBone.bone.parentIndex !== undefined
    ? hipsBone.skeleton.bones.find(item => item.index === hipsBone.bone.parentIndex)
    : undefined
  const rootName = avatar?.rootBoneName && normHumanoidBoneName(avatar.rootBoneName) !== normHumanoidBoneName(hipsName)
    ? avatar.rootBoneName
    : parent?.name
  if (!rootName || normHumanoidBoneName(rootName) === normHumanoidBoneName(hipsName)) return tracks
  const rootNorm = normHumanoidBoneName(rootName)
  const hipsNorm = normHumanoidBoneName(hipsName)
  const rootTrack = tracks.find(track => track.targetProperty === 'position' && track.targetName && normHumanoidBoneName(track.targetName) === rootNorm)
  if (!rootTrack || rootTrack.keys.length === 0) return tracks
  const hipsTrack = tracks.find(track => track.targetProperty === 'position' && track.targetName && normHumanoidBoneName(track.targetName) === hipsNorm)
  if (!(spanOf(rootTrack.keys) > 1e-3 && spanOf(rootTrack.keys) > spanOf(hipsTrack?.keys ?? []) * 1.5)) return tracks
  const rootBone = findBone(skeletons, rootName)?.bone
  const rootRest = translationOf(rootBone)
  const rootRestQuatArr = matrixQuaternion(rootBone?.restMatrix) ?? [0, 0, 0, 1]
  const rootRestQuat = new Quaternion(...rootRestQuatArr)
  const invRootRestQuat = rootRestQuat.clone().invert()
  const hipsRest = translationOf(hipsBone?.bone)
  const rootRotTrack = tracks.find(track => track.targetProperty === 'rotationQuaternion' && track.targetName && normHumanoidBoneName(track.targetName) === rootNorm)
  const hipsRotTrack = tracks.find(track => track.targetProperty === 'rotationQuaternion' && track.targetName && normHumanoidBoneName(track.targetName) === hipsNorm)
  const posFrames = mergeFrames(hipsTrack?.keys, rootTrack.keys)
  const posKeys = posFrames.map(frame => {
    const hips = lerpVec(hipsTrack?.keys ?? [], frame, hipsRest)
    const root = lerpVec(rootTrack.keys, frame, rootRest)
    const rootQ = rootRotTrack ? slerpQuat(rootRotTrack.keys, frame, rootRestQuat) : rootRestQuat
    const rotatedHips = new Vector3(...hips).applyQuaternion(rootQ)
    const combined = new Vector3(
      root[0] - rootRest[0] + rotatedHips.x,
      root[1] - rootRest[1] + rotatedHips.y,
      root[2] - rootRest[2] + rotatedHips.z,
    ).applyQuaternion(invRootRestQuat)
    return { frame, value: [combined.x, combined.y, combined.z] }
  })
  let result: T[] = hipsTrack
    ? tracks.map(track => track === hipsTrack ? { ...track, keys: posKeys } : track)
    : [...tracks, { ...rootTrack, targetName: hipsName, targetProperty: 'position', keys: posKeys } as T]

  if (rootRotTrack && rootRotTrack.keys.length > 0 && hipsRotTrack) {
    const hipsRestQuatArr = matrixQuaternion(hipsBone?.bone?.restMatrix) ?? [0, 0, 0, 1]
    const hipsRestQuat = new Quaternion(...hipsRestQuatArr)
    const rotFrames = mergeFrames(hipsRotTrack.keys, rootRotTrack.keys)
    let prev: Quaternion | null = null
    const rotKeys = rotFrames.map(frame => {
      const rootQ = slerpQuat(rootRotTrack.keys, frame, rootRestQuat)
      const hipsQ = slerpQuat(hipsRotTrack.keys, frame, hipsRestQuat)
      const combined = invRootRestQuat.clone().multiply(rootQ).multiply(hipsQ).normalize()
      if (prev && combined.dot(prev) < 0) combined.set(-combined.x, -combined.y, -combined.z, -combined.w)
      prev = combined.clone()
      return { frame, value: [combined.x, combined.y, combined.z, combined.w] }
    })
    result = result.map(track => track === hipsRotTrack ? { ...track, keys: rotKeys } : track)
  }
  return result
}

function findBone(skeletons: readonly HumanoidAvatarSkeletonInput[], name: string) {
  const key = normHumanoidBoneName(name)
  for (const skeleton of skeletons) {
    const bone = skeleton.bones.find(item => normHumanoidBoneName(item.name) === key)
    if (bone) return { skeleton, bone }
  }
  return undefined
}
