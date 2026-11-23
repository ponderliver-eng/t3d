import { AnimationClip, type KeyframeTrack } from 'three'
import { classifyHumanoidBoneSlot, stripRigBonePrefix, type HumanoidBoneSlot } from './humanoidSlots'

export const CLIP_MIME = 'application/x-t3d-clip'

export interface ClipCatalogEntry {
  name: string
  duration: number
}

export interface ClipDrag {
  assetId: string
  clip: string
}

const UPPER = new Set<HumanoidBoneSlot>([
  'Spine', 'Chest', 'UpperChest', 'Neck', 'Head', 'Jaw', 'LeftEye', 'RightEye',
  'LeftShoulder', 'LeftUpperArm', 'LeftLowerArm', 'LeftHand',
  'RightShoulder', 'RightUpperArm', 'RightLowerArm', 'RightHand',
  'LeftThumbProximal', 'LeftThumbIntermediate', 'LeftThumbDistal',
  'LeftIndexProximal', 'LeftIndexIntermediate', 'LeftIndexDistal',
  'LeftMiddleProximal', 'LeftMiddleIntermediate', 'LeftMiddleDistal',
  'LeftRingProximal', 'LeftRingIntermediate', 'LeftRingDistal',
  'LeftLittleProximal', 'LeftLittleIntermediate', 'LeftLittleDistal',
  'RightThumbProximal', 'RightThumbIntermediate', 'RightThumbDistal',
  'RightIndexProximal', 'RightIndexIntermediate', 'RightIndexDistal',
  'RightMiddleProximal', 'RightMiddleIntermediate', 'RightMiddleDistal',
  'RightRingProximal', 'RightRingIntermediate', 'RightRingDistal',
  'RightLittleProximal', 'RightLittleIntermediate', 'RightLittleDistal',
])

const LOWER = new Set<HumanoidBoneSlot>([
  'Hips',
  'LeftUpperLeg', 'LeftLowerLeg', 'LeftFoot', 'LeftToes',
  'RightUpperLeg', 'RightLowerLeg', 'RightFoot', 'RightToes',
])

function boneOf(trackName: string): string {
  const dot = trackName.lastIndexOf('.')
  return dot > 0 ? trackName.slice(0, dot) : trackName
}

function upperName(bone: string): boolean {
  const slot = classifyHumanoidBoneSlot(bone)
  if (slot) return UPPER.has(slot)
  return /spine|chest|neck|head|clavicle|shoulder|arm|hand|thumb|index|middle|ring|pinky|finger/.test(bone.toLowerCase())
}

function lowerName(bone: string): boolean {
  const slot = classifyHumanoidBoneSlot(bone)
  if (slot) return LOWER.has(slot)
  return /leg|foot|toe|hips|pelvis/.test(bone.toLowerCase())
}

export function maskClip(clip: AnimationClip, preset: 'upperBody' | 'lowerBody'): AnimationClip {
  const tracks = clip.tracks.filter(track => {
    const bone = boneOf(track.name)
    return preset === 'upperBody' ? upperName(bone) : lowerName(bone)
  }).map(track => track.clone())
  return new AnimationClip(clip.name, clip.duration, tracks)
}

function isHips(bone: string): boolean {
  if (classifyHumanoidBoneSlot(bone) === 'Hips') return true
  const stripped = stripRigBonePrefix(bone).toLowerCase()
  return stripped === 'root' || stripped === 'rootmotion' || stripped === 'hips' || stripped === 'pelvis'
}

/** 把盆骨水平位移钉在第一帧，只留上下起伏。 */
export function lockClipInPlace(clip: AnimationClip): AnimationClip {
  const tracks = clip.tracks.map(track => lockTrack(track))
  return new AnimationClip(clip.name, clip.duration, tracks)
}

function lockTrack(track: KeyframeTrack): KeyframeTrack {
  const cloned = track.clone()
  const dot = cloned.name.lastIndexOf('.')
  const property = dot > 0 ? cloned.name.slice(dot + 1) : ''
  if (property !== 'position' || !isHips(boneOf(cloned.name))) return cloned
  const size = cloned.getValueSize()
  if (size < 3 || cloned.times.length === 0) return cloned
  const x0 = cloned.values[0] ?? 0
  const z0 = cloned.values[2] ?? 0
  for (let i = 0; i < cloned.times.length; i += 1) {
    cloned.values[i * size] = x0
    cloned.values[i * size + 2] = z0
  }
  return cloned
}

export function readClipDrag(raw: string): ClipDrag | null {
  try {
    const parsed = JSON.parse(raw) as Partial<ClipDrag>
    if (!parsed.assetId || !parsed.clip) return null
    return { assetId: parsed.assetId, clip: parsed.clip }
  } catch {
    return null
  }
}
