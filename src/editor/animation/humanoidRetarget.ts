import {
  AnimationClip,
  InterpolateLinear,
  Matrix4,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
  VectorKeyframeTrack,
  type KeyframeTrack,
} from 'three'
import {
  foldRootMotionTracks,
  type HumanoidAvatarTrackInput,
  type ModelHumanoidAvatar,
} from './humanoidAvatar'
import {
  humanoidRetargetAdjustIsDefault,
  normalizeHumanoidRetargetAdjust,
  type HumanoidRetargetAdjust,
} from './humanoidAdjust'
import {
  applyAvatarSlots,
  buildRigProfile,
  computeHumanoidHipsScaleRatio,
  matchingRegisteredSkeletons,
  unrealMannequinSkeleton,
  type HumanoidRigProfile,
  type HumanoidSkeletonRecord,
  type RestTrs,
} from './humanoidRig'
import {
  classifyHumanoidBoneSlot,
  getHumanoidSlotFallbackChain,
  normHumanoidBoneName,
  type HumanoidBoneSlot,
} from './humanoidSlots'

interface PoseTrack {
  bone: string
  slot: HumanoidBoneSlot | null
  property: 'position' | 'quaternion'
  times: number[]
  values: number[]
  passthrough: KeyframeTrack | null
}

const ARM_PARENT: Partial<Record<HumanoidBoneSlot, HumanoidBoneSlot>> = {
  LeftLowerArm: 'LeftUpperArm', RightLowerArm: 'RightUpperArm',
  LeftHand: 'LeftLowerArm', RightHand: 'RightLowerArm',
  LeftThumbProximal: 'LeftHand', LeftThumbIntermediate: 'LeftThumbProximal', LeftThumbDistal: 'LeftThumbIntermediate',
  LeftIndexProximal: 'LeftHand', LeftIndexIntermediate: 'LeftIndexProximal', LeftIndexDistal: 'LeftIndexIntermediate',
  LeftMiddleProximal: 'LeftHand', LeftMiddleIntermediate: 'LeftMiddleProximal', LeftMiddleDistal: 'LeftMiddleIntermediate',
  LeftRingProximal: 'LeftHand', LeftRingIntermediate: 'LeftRingProximal', LeftRingDistal: 'LeftRingIntermediate',
  LeftLittleProximal: 'LeftHand', LeftLittleIntermediate: 'LeftLittleProximal', LeftLittleDistal: 'LeftLittleIntermediate',
  RightThumbProximal: 'RightHand', RightThumbIntermediate: 'RightThumbProximal', RightThumbDistal: 'RightThumbIntermediate',
  RightIndexProximal: 'RightHand', RightIndexIntermediate: 'RightIndexProximal', RightIndexDistal: 'RightIndexIntermediate',
  RightMiddleProximal: 'RightHand', RightMiddleIntermediate: 'RightMiddleProximal', RightMiddleDistal: 'RightMiddleIntermediate',
  RightRingProximal: 'RightHand', RightRingIntermediate: 'RightRingProximal', RightRingDistal: 'RightRingIntermediate',
  RightLittleProximal: 'RightHand', RightLittleIntermediate: 'RightLittleProximal', RightLittleDistal: 'RightLittleIntermediate',
}

function splitTrack(name: string): { bone: string; property: string } {
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return { bone: name, property: '' }
  return { bone: name.slice(0, dot), property: name.slice(dot + 1) }
}

type SampleableTrack = KeyframeTrack & {
  createInterpolant: { (result?: Float32Array): { evaluate: (time: number) => ArrayLike<number>; valueSize?: number }; isInterpolantFactoryMethodGLTFCubicSpline?: boolean }
}

function isCubic(track: KeyframeTrack): boolean {
  return Boolean((track as SampleableTrack).createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline)
}

function sampleTimes(track: KeyframeTrack): number[] {
  const keys = Array.from(track.times)
  if (!isCubic(track) || keys.length < 2) return keys
  const end = keys[keys.length - 1] ?? 0
  const grid: number[] = []
  for (let time = 0; time < end && grid.length < 480; time += 1 / 30) grid.push(time)
  grid.push(end)
  return [...new Set([...keys, ...grid])].sort((a, b) => a - b).slice(0, 480)
}

function readSamples(track: KeyframeTrack): { times: number[]; values: number[] } {
  const times = sampleTimes(track)
  const interpolant = (track as SampleableTrack).createInterpolant()
  const values: number[] = []
  for (const time of times) {
    const sample = interpolant.evaluate(time)
    for (let i = 0; i < sample.length; i += 1) values.push(sample[i] ?? 0)
  }
  return { times, values }
}

function quatAt(values: number[], index: number): Quaternion {
  const offset = index * 4
  return new Quaternion(values[offset] ?? 0, values[offset + 1] ?? 0, values[offset + 2] ?? 0, values[offset + 3] ?? 1).normalize()
}

function writeQuat(track: PoseTrack, index: number, quaternion: Quaternion): void {
  track.passthrough = null
  const offset = index * 4
  track.values[offset] = quaternion.x
  track.values[offset + 1] = quaternion.y
  track.values[offset + 2] = quaternion.z
  track.values[offset + 3] = quaternion.w
}

function vecAt(values: number[], index: number): Vector3 {
  const offset = index * 3
  return new Vector3(values[offset] ?? 0, values[offset + 1] ?? 0, values[offset + 2] ?? 0)
}

function writeVec(track: PoseTrack, index: number, vector: Vector3): void {
  track.passthrough = null
  const offset = index * 3
  track.values[offset] = vector.x
  track.values[offset + 1] = vector.y
  track.values[offset + 2] = vector.z
}

function shortestArc(from: Vector3, to: Vector3): Quaternion {
  const start = from.clone().normalize()
  const end = to.clone().normalize()
  const dot = start.dot(end)
  if (dot >= 0.9999) return new Quaternion()
  if (dot <= -0.9999) {
    const ortho = new Vector3(0, 1, 0).cross(start)
    if (ortho.lengthSq() < 1e-4) ortho.crossVectors(new Vector3(1, 0, 0), start)
    return new Quaternion().setFromAxisAngle(ortho.normalize(), Math.PI)
  }
  return new Quaternion().setFromUnitVectors(start, end).normalize()
}

function upperArmAlignment(source: RestTrs | undefined, target: RestTrs | undefined): Quaternion {
  if (!source?.childBoneWorldDir || !target?.childBoneWorldDir) return new Quaternion()
  const src = source.childBoneWorldDir.clone().normalize()
  const dst = target.childBoneWorldDir.clone().normalize()
  const dot = src.dot(dst)
  if (dot > 0 && dot < 0.999) return shortestArc(dst, src)
  return new Quaternion()
}

function chainAlignment(parentAlign: Quaternion, source: RestTrs | undefined, target: RestTrs | undefined): Quaternion {
  if (!source?.childBoneWorldDir || !target?.childBoneWorldDir) return parentAlign
  const dst = target.childBoneWorldDir.clone().normalize().applyQuaternion(parentAlign).normalize()
  const src = source.childBoneWorldDir.clone().normalize()
  const dot = src.dot(dst)
  if (dot > 0.25 && dot < 0.999) return shortestArc(dst, src).multiply(parentAlign).normalize()
  return parentAlign
}

function armWorldAlignment(slot: HumanoidBoneSlot | null, source?: HumanoidRigProfile | null, target?: HumanoidRigProfile | null): Quaternion {
  if (!slot || !source || !target) return new Quaternion()
  if (slot === 'LeftUpperArm' || slot === 'RightUpperArm') return upperArmAlignment(source.bySlot.get(slot), target.bySlot.get(slot))
  const parent = ARM_PARENT[slot]
  if (!parent) return new Quaternion()
  return chainAlignment(armWorldAlignment(parent, source, target), source.bySlot.get(slot), target.bySlot.get(slot))
}

function compensatePosition(track: PoseTrack, sourceRest: RestTrs | undefined, targetRest: RestTrs, ratio: number, sourceHasBind: boolean): void {
  const first = vecAt(track.values, 0)
  const srcRest = sourceHasBind && sourceRest && sourceRest.position.lengthSq() > 1e-5 ? sourceRest.position : first
  const dstRest = targetRest.position
  const effective = Math.abs(ratio - 1) > 1e-3
    ? ratio
    : srcRest.length() > 1e-3 && dstRest.length() > 1e-3 ? dstRest.length() / srcRest.length() : 1
  const deltaRot = (targetRest.parentWorldRotation ?? new Quaternion()).clone().invert().multiply(sourceRest?.parentWorldRotation ?? new Quaternion()).normalize()
  for (let i = 0; i < track.times.length; i += 1) {
    const delta = vecAt(track.values, i).sub(srcRest).multiplyScalar(effective).applyQuaternion(deltaRot)
    writeVec(track, i, dstRest.clone().add(delta))
  }
}

function compensateQuaternion(
  track: PoseTrack,
  slot: HumanoidBoneSlot,
  sourceRest: RestTrs,
  targetRest: RestTrs,
  sourceHasBind: boolean,
  source?: HumanoidRigProfile | null,
  target?: HumanoidRigProfile | null,
): void {
  if (sourceHasBind) {
    const parentAlign = armWorldAlignment(ARM_PARENT[slot] ?? null, source, target)
    const selfAlign = armWorldAlignment(slot, source, target)
    const invParent = parentAlign.clone().invert().normalize()
    const localDot = Math.abs(sourceRest.rotation.dot(targetRest.rotation))
    const worldDot = Math.abs((sourceRest.worldRotation ?? sourceRest.rotation).dot(targetRest.worldRotation ?? targetRest.rotation))
    if (localDot >= 0.9995 && worldDot >= 0.9995 && Math.abs(invParent.w) >= 0.9995 && Math.abs(selfAlign.w) >= 0.9995) return
    const srcWorld = sourceRest.worldRotation ?? sourceRest.rotation
    const dstWorld = targetRest.worldRotation ?? targetRest.rotation
    const left = targetRest.rotation.clone()
      .multiply(dstWorld.clone().invert())
      .multiply(invParent)
      .multiply(srcWorld)
      .multiply(sourceRest.rotation.clone().invert())
      .normalize()
    const right = srcWorld.clone().invert().multiply(selfAlign).multiply(dstWorld).normalize()
    let previous: Quaternion | null = null
    for (let i = 0; i < track.times.length; i += 1) {
      let next = left.clone().multiply(quatAt(track.values, i)).multiply(right).normalize()
      if (previous && next.dot(previous) < 0) next.set(-next.x, -next.y, -next.z, -next.w)
      previous = next.clone()
      writeQuat(track, i, next)
    }
    return
  }
  if (sourceRest.childBoneLocalDir && targetRest.childBoneLocalDir && sourceRest.childBoneLocalDir.dot(targetRest.childBoneLocalDir) < -0.5) {
    for (let i = 0; i < track.times.length; i += 1) {
      const q = quatAt(track.values, i)
      writeQuat(track, i, new Quaternion(-q.x, -q.y, q.z, q.w))
    }
  }
}

function authoredTracks(clip: AnimationClip): HumanoidAvatarTrackInput[] {
  return clip.tracks.map(track => {
    const { bone, property } = splitTrack(track.name)
    const size = track.getValueSize()
    const keys = []
    for (let i = 0; i < track.times.length; i += 1) {
      keys.push({ frame: track.times[i] ?? 0, value: Array.from(track.values.slice(i * size, (i + 1) * size)) })
    }
    return { targetName: bone, targetProperty: property === 'quaternion' ? 'rotationQuaternion' : property, keys }
  })
}

function matrixFromPosition(position: Vector3): number[] {
  return Array.from(new Matrix4().compose(position, new Quaternion(), new Vector3(1, 1, 1)).elements)
}

function profileForClip(clip: AnimationClip, existing: HumanoidRigProfile | null): HumanoidRigProfile | null {
  if (existing?.bySlot.has('Hips')) return existing
  const names = [...new Set(clip.tracks.map(track => splitTrack(track.name).bone).filter(Boolean))]
  const inputs = authoredTracks(clip)
  const pelvisKey = inputs.find(track => track.targetProperty === 'position' && track.targetName && normHumanoidBoneName(track.targetName) === 'pelvis')?.keys[0]?.value
  const pelvisLen = Array.isArray(pelvisKey) ? Math.hypot(Number(pelvisKey[0]) || 0, Number(pelvisKey[1]) || 0, Number(pelvisKey[2]) || 0) : 0
  const registered = matchingRegisteredSkeletons(names)
  if (registered) {
    const built = buildRigProfile(registered, true)
    if (built) {
      const regPelvis = built.bySlot.get('Hips')?.position.length() ?? 0
      if (pelvisLen <= 1e-3 || regPelvis <= 1e-3 || (pelvisLen / regPelvis > 0.2 && pelvisLen / regPelvis < 5)) return built
    }
  }
  const unrealScale = pelvisLen > 10 ? 100 : 1
  const unreal = unrealMannequinSkeleton(names, unrealScale)
  if (unreal) return buildRigProfile([unreal], true)
  const bones = names.map((name, index) => {
    const key = inputs.find(track => track.targetName === name && track.targetProperty === 'position')?.keys[0]?.value
    const position = Array.isArray(key) ? new Vector3(Number(key[0]) || 0, Number(key[1]) || 0, Number(key[2]) || 0) : new Vector3()
    return { index, name, restMatrix: matrixFromPosition(position) }
  })
  return buildRigProfile([{ bones, externalRotation: [0, 0, 0, 1], externalScale: 1 }], false)
}

function nameForSlot(profile: HumanoidRigProfile, slot: HumanoidBoneSlot): string | undefined {
  return profile.boneNameBySlot.get(slot)
}

function findAuthored(tracks: readonly HumanoidAvatarTrackInput[], bone: string, property: string) {
  const key = normHumanoidBoneName(bone)
  return tracks.find(track => track.targetProperty === property && track.targetName && normHumanoidBoneName(track.targetName) === key)
}

function solveProportion(aSrc: number, bSrc: number, aDst: number, bDst: number, hinge: number): { hinge: number; root: number } {
  if (aSrc <= 1e-4 || bSrc <= 1e-4 || aDst <= 1e-4 || bDst <= 1e-4) return { hinge: 0, root: 0 }
  if (Math.abs(aSrc / bSrc - aDst / bDst) < 0.03) return { hinge: 0, root: 0 }
  const cSrc = Math.sqrt(Math.max(1e-6, aSrc * aSrc + bSrc * bSrc + 2 * aSrc * bSrc * Math.cos(hinge)))
  const norm = cSrc / (aSrc + bSrc)
  const cDst = Math.max(Math.abs(aDst - bDst) * 1.01, Math.min((aDst + bDst) * 0.999, norm * (aDst + bDst)))
  const theta = Math.acos(Math.max(-0.999, Math.min(0.999, (cDst * cDst - aDst * aDst - bDst * bDst) / (2 * aDst * bDst))))
  const alpha = (a: number, b: number, c: number) => Math.acos(Math.max(-0.999, Math.min(0.999, (a * a + c * c - b * b) / (2 * a * Math.max(1e-5, c)))))
  const limit = 0.35
  return {
    hinge: Math.max(-limit, Math.min(limit, theta - hinge)),
    root: Math.max(-limit, Math.min(limit, alpha(aDst, bDst, cDst) - alpha(aSrc, bSrc, cSrc))),
  }
}

function deltaAxis(current: Quaternion, rest: Quaternion): { axis: Vector3; angle: number } {
  const delta = rest.clone().invert().multiply(current).normalize()
  const sign = delta.w >= 0 ? 1 : -1
  const w = Math.max(-1, Math.min(1, Math.abs(delta.w)))
  const angle = 2 * Math.acos(w)
  const sine = Math.sqrt(Math.max(0, 1 - w * w))
  if (sine < 1e-4 || angle < 1e-3) return { axis: new Vector3(0, 0, 1), angle: 0 }
  return { axis: new Vector3(delta.x * sign / sine, delta.y * sign / sine, delta.z * sign / sine).normalize(), angle }
}

function boneLength(profile: HumanoidRigProfile, slot: HumanoidBoneSlot, fallback: number): number {
  const length = profile.bySlot.get(slot)?.position.length() ?? 0
  return length > 1e-4 ? length : fallback
}

function applyProportion(tracks: PoseTrack[], source: HumanoidRigProfile, target: HumanoidRigProfile): void {
  if (!source.hasTrueBindPose) return
  const bySlot = new Map<HumanoidBoneSlot, PoseTrack>()
  for (const track of tracks) {
    if (!track.slot || track.property !== 'quaternion' || track.values.length < 4 || bySlot.has(track.slot)) continue
    bySlot.set(track.slot, track)
  }
  const pair = (upper: HumanoidBoneSlot, lower: HumanoidBoneSlot, aSlot: HumanoidBoneSlot, bSlot: HumanoidBoneSlot) => {
    const aSrc = boneLength(source, aSlot, 0.4)
    const bSrc = boneLength(source, bSlot, 0.4)
    const aDst = boneLength(target, aSlot, aSrc)
    const bDst = boneLength(target, bSlot, bSrc)
    if (Math.abs(aSrc / bSrc - aDst / bDst) < 0.03) return
    const lowerTrack = bySlot.get(lower)
    const lowerRest = target.bySlot.get(lower)?.rotation
    if (!lowerTrack || !lowerRest) return
    const upperTrack = bySlot.get(upper)
    const upperRest = target.bySlot.get(upper)?.rotation
    for (let i = 0; i < lowerTrack.times.length; i += 1) {
      const current = quatAt(lowerTrack.values, i)
      const { axis, angle } = deltaAxis(current, lowerRest)
      if (angle < 0.05) continue
      const solved = solveProportion(aSrc, bSrc, aDst, bDst, angle)
      if (Math.abs(solved.hinge) > 1e-4) writeQuat(lowerTrack, i, current.multiply(new Quaternion().setFromAxisAngle(axis, solved.hinge)).normalize())
      if (!upperTrack || !upperRest || Math.abs(solved.root) <= 1e-4) continue
      const frame = lowerTrack.times[i]
      const upperIndex = upperTrack.times.findIndex(time => Math.abs(time - (frame ?? 0)) < 1e-4)
      if (upperIndex < 0) continue
      const upperCurrent = quatAt(upperTrack.values, upperIndex)
      const upperAxis = deltaAxis(upperCurrent, upperRest).axis
      writeQuat(upperTrack, upperIndex, upperCurrent.multiply(new Quaternion().setFromAxisAngle(upperAxis, solved.root)).normalize())
    }
  }
  pair('LeftUpperLeg', 'LeftLowerLeg', 'LeftLowerLeg', 'LeftFoot')
  pair('RightUpperLeg', 'RightLowerLeg', 'RightLowerLeg', 'RightFoot')
  pair('LeftUpperArm', 'LeftLowerArm', 'LeftLowerArm', 'LeftHand')
  pair('RightUpperArm', 'RightLowerArm', 'RightLowerArm', 'RightHand')
  const shoulder = (profile: HumanoidRigProfile, side: 'Left' | 'Right') => boneLength(profile, `${side}Shoulder` as HumanoidBoneSlot, 0) + boneLength(profile, `${side}UpperArm` as HumanoidBoneSlot, 0)
  const srcShoulder = shoulder(source, 'Left') + shoulder(source, 'Right')
  const dstShoulder = boneLength(target, 'LeftShoulder', 0) + boneLength(target, 'LeftUpperArm', 0) + boneLength(target, 'RightShoulder', 0) + boneLength(target, 'RightUpperArm', 0)
  const srcHip = boneLength(source, 'LeftUpperLeg', 0) + boneLength(source, 'RightUpperLeg', 0)
  const dstHip = boneLength(target, 'LeftUpperLeg', 0) + boneLength(target, 'RightUpperLeg', 0)
  if (srcShoulder <= 1e-3 || dstShoulder <= 1e-3 || srcHip <= 1e-3 || dstHip <= 1e-3) return
  const srcLeg = Math.max(1e-3, boneLength(source, 'LeftLowerLeg', 0.4) + boneLength(source, 'LeftFoot', 0.4))
  const dstLeg = Math.max(1e-3, boneLength(target, 'LeftLowerLeg', 0.4) + boneLength(target, 'LeftFoot', 0.4))
  const flare = Math.max(-0.18, Math.min(0.22, (dstHip / dstShoulder - srcHip / srcShoulder) * 0.25 + (srcShoulder / srcLeg - dstShoulder / dstLeg) * 0.35))
  if (Math.abs(flare) <= 0.015) return
  const flareArm = (slot: 'LeftUpperArm' | 'RightUpperArm', sign: 1 | -1) => {
    const track = bySlot.get(slot)
    const rest = target.bySlot.get(slot)
    if (!track || !rest) return
    const world = rest.worldRotation ?? rest.rotation
    const local = world.clone().invert().multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), sign * flare)).multiply(world).normalize()
    for (let i = 0; i < track.times.length; i += 1) {
      const current = quatAt(track.values, i)
      const dir = rest.childBoneLocalDir
      let weight = 1
      if (dir && dir.lengthSq() > 1e-6) {
        const worldDir = dir.clone().applyQuaternion((rest.parentWorldRotation ?? new Quaternion()).clone().multiply(current)).normalize()
        weight = Math.max(0, Math.min(1, 0.5 - 0.5 * worldDir.y))
      }
      if (weight < 0.05) continue
      const extra = weight >= 0.999 ? local : new Quaternion().slerpQuaternions(new Quaternion(), local, weight)
      writeQuat(track, i, current.multiply(extra).normalize())
    }
  }
  flareArm('LeftUpperArm', 1)
  flareArm('RightUpperArm', -1)
}

function asQuat(value: unknown): Quaternion | null {
  if (!Array.isArray(value) || value.length < 4) return null
  const quaternion = new Quaternion(Number(value[0]), Number(value[1]), Number(value[2]), Number(value[3]))
  return [quaternion.x, quaternion.y, quaternion.z, quaternion.w].every(Number.isFinite) ? quaternion.normalize() : null
}

function sampleQuat(keys: readonly { frame?: number; value: unknown }[] | undefined, frame: number, fallback: Quaternion): Quaternion {
  if (!keys) return fallback.clone()
  let best: Quaternion | null = null
  let bestFrame = -Infinity
  for (const key of keys) {
    const value = asQuat(key.value)
    if (!value) continue
    const keyFrame = key.frame ?? 0
    if (keyFrame <= frame && keyFrame >= bestFrame) {
      best = value
      bestFrame = keyFrame
    }
  }
  return best ?? fallback.clone()
}

function sampleVec(keys: readonly { frame?: number; value: unknown }[], frame: number, fallback: Vector3): Vector3 {
  let best: Vector3 | null = null
  let bestFrame = -Infinity
  for (const key of keys) {
    if (!Array.isArray(key.value) || key.value.length < 3) continue
    const value = new Vector3(Number(key.value[0]), Number(key.value[1]), Number(key.value[2]))
    const keyFrame = key.frame ?? 0
    if (keyFrame <= frame && keyFrame >= bestFrame) {
      best = value
      bestFrame = keyFrame
    }
  }
  return best ?? fallback.clone()
}

function footY(profile: HumanoidRigProfile, chain: readonly HumanoidBoneSlot[], hipsPos: Vector3, hipsRot: Quaternion, rotationAt: (slot: HumanoidBoneSlot) => Quaternion): number | null {
  const hipsRest = profile.bySlot.get('Hips')
  const parent = hipsRest?.parentWorldRotation ?? new Quaternion()
  const scale = profile.externalScale && profile.externalScale > 1e-4 ? profile.externalScale : 1
  let position = hipsPos.clone().applyQuaternion(parent).multiplyScalar(scale)
  let rotation = parent.clone().multiply(hipsRot).normalize()
  for (const slot of chain) {
    const rest = profile.bySlot.get(slot)
    if (!rest) return null
    position = position.add(rest.position.clone().multiplyScalar(scale).applyQuaternion(rotation))
    rotation = rotation.multiply(rotationAt(slot)).normalize()
  }
  return position.y
}

function xzSpan(values: Array<[number, number, number]>): number {
  if (values.length === 0) return 0
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const [x, , z] of values) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z)
  }
  return Math.hypot(maxX - minX, maxZ - minZ)
}

function plantFeet(tracks: PoseTrack[], source: HumanoidRigProfile, target: HumanoidRigProfile, authored: readonly HumanoidAvatarTrackInput[]): void {
  if (!source.hasTrueBindPose) return
  const hips = tracks.find(track => track.slot === 'Hips' && track.property === 'position')
  if (!hips || (!tracks.some(track => track.slot === 'LeftLowerLeg') && !tracks.some(track => track.slot === 'RightLowerLeg'))) return
  const srcLeg = Math.max(source.legScaleMetric * (source.externalScale && source.externalScale > 1e-4 ? source.externalScale : 1), 1e-3)
  const dstLeg = Math.max(target.legScaleMetric * (target.externalScale && target.externalScale > 1e-4 ? target.externalScale : 1), 1e-3)
  const hipsValues: Array<[number, number, number]> = []
  let minY = Infinity
  let maxY = -Infinity
  for (let i = 0; i < hips.times.length; i += 1) {
    const value = vecAt(hips.values, i)
    hipsValues.push([value.x, value.y, value.z])
    minY = Math.min(minY, value.y)
    maxY = Math.max(maxY, value.y)
  }
  if (xzSpan(hipsValues) > 0.2 * target.legScaleMetric || (maxY - minY) > 0.45 * target.legScaleMetric) return
  const sourceRot = (slot: HumanoidBoneSlot) => {
    const bone = nameForSlot(source, slot)
    return bone ? findAuthored(authored, bone, 'rotationQuaternion') : undefined
  }
  const sourceHipsBone = nameForSlot(source, 'Hips')
  const sourceHips = sourceHipsBone ? findAuthored(authored, sourceHipsBone, 'position') : undefined
  const frames = (sourceHips?.keys.length ? sourceHips.keys : sourceRot('LeftLowerLeg')?.keys ?? sourceRot('RightLowerLeg')?.keys ?? []).map(key => key.frame ?? 0)
  if (frames.length === 0) return
  const chain = {
    left: ['LeftUpperLeg', 'LeftLowerLeg', 'LeftFoot'] as const,
    right: ['RightUpperLeg', 'RightLowerLeg', 'RightFoot'] as const,
  }
  const sourceFoot = (frame: number) => {
    const hipsPos = sampleVec(sourceHips?.keys ?? [], frame, source.bySlot.get('Hips')?.position ?? new Vector3())
    const hipsRot = sampleQuat(sourceRot('Hips')?.keys, frame, source.bySlot.get('Hips')?.rotation ?? new Quaternion())
    const left = footY(source, chain.left, hipsPos, hipsRot, slot => sampleQuat(sourceRot(slot)?.keys, frame, source.bySlot.get(slot)?.rotation ?? new Quaternion()))
    const right = footY(source, chain.right, hipsPos, hipsRot, slot => sampleQuat(sourceRot(slot)?.keys, frame, source.bySlot.get(slot)?.rotation ?? new Quaternion()))
    const values = [left, right].filter((value): value is number => value !== null)
    return values.length ? Math.min(...values) : null
  }
  const restFoot = (profile: HumanoidRigProfile) => {
    const rest = profile.bySlot.get('Hips')
    if (!rest) return null
    const rotationAt = (slot: HumanoidBoneSlot) => profile.bySlot.get(slot)?.rotation ?? new Quaternion()
    const left = footY(profile, chain.left, rest.position, rest.rotation, rotationAt)
    const right = footY(profile, chain.right, rest.position, rest.rotation, rotationAt)
    const values = [left, right].filter((value): value is number => value !== null)
    return values.length ? Math.min(...values) : null
  }
  const sourceRestFoot = restFoot(source)
  if (sourceRestFoot === null) return
  const contact = frames.filter(frame => {
    const foot = sourceFoot(frame)
    return foot !== null && foot <= sourceRestFoot + 0.08 * srcLeg
  })
  if (contact.length === 0) return
  const targetRest = target.bySlot.get('Hips')
  const targetRestFoot = restFoot(target)
  if (!targetRest || targetRestFoot === null) return
  const targetTrack = (slot: HumanoidBoneSlot) => tracks.find(track => track.slot === slot && track.property === 'quaternion')
  const targetFeet = contact.map(frame => {
    const index = hips.times.findIndex(time => Math.abs(time - frame) < 1e-3)
    const hipsPos = index >= 0 ? vecAt(hips.values, index) : targetRest.position
    const hipsRotTrack = targetTrack('Hips')
    const hipsIndex = hipsRotTrack ? hipsRotTrack.times.findIndex(time => Math.abs(time - frame) < 1e-3) : -1
    const hipsRot = hipsIndex >= 0 && hipsRotTrack ? quatAt(hipsRotTrack.values, hipsIndex) : targetRest.rotation
    const rotationAt = (slot: HumanoidBoneSlot) => {
      const track = targetTrack(slot)
      const at = track ? track.times.findIndex(time => Math.abs(time - frame) < 1e-3) : -1
      return at >= 0 && track ? quatAt(track.values, at) : target.bySlot.get(slot)?.rotation ?? new Quaternion()
    }
    const left = footY(target, chain.left, hipsPos, hipsRot, rotationAt)
    const right = footY(target, chain.right, hipsPos, hipsRot, rotationAt)
    const values = [left, right].filter((value): value is number => value !== null)
    return values.length ? Math.min(...values) : null
  }).filter((value): value is number => value !== null)
  if (targetFeet.length === 0) return
  const sorted = [...targetFeet].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0)
  const offset = Math.max(-0.45 * dstLeg, Math.min(0.45 * dstLeg, targetRestFoot - median))
  if (Math.abs(offset) < 0.004 * dstLeg) return
  const scale = target.externalScale && target.externalScale > 1e-4 ? target.externalScale : 1
  const local = new Vector3(0, offset / scale, 0).applyQuaternion((targetRest.parentWorldRotation ?? new Quaternion()).clone().invert())
  for (let i = 0; i < hips.times.length; i += 1) writeVec(hips, i, vecAt(hips.values, i).add(local))
}

function worldAxis(rest: RestTrs, axis: Vector3, radians: number): Quaternion {
  const spin = new Quaternion().setFromAxisAngle(axis, radians)
  const world = rest.worldRotation ?? rest.rotation
  return world.clone().invert().multiply(spin).multiply(world).normalize()
}

function localBend(rest: RestTrs, radians: number): Quaternion {
  const bone = rest.childBoneLocalDir ?? new Vector3(1, 0, 0)
  let axis = new Vector3().crossVectors(bone, new Vector3(0, 1, 0))
  if (axis.lengthSq() < 1e-6) axis.crossVectors(bone, new Vector3(0, 0, 1))
  return new Quaternion().setFromAxisAngle(axis.normalize(), radians)
}

function multiplyKeys(track: PoseTrack, extra: Quaternion, side: 'left' | 'right'): void {
  if (Math.abs(extra.w) >= 0.999999) return
  for (let i = 0; i < track.times.length; i += 1) {
    const current = quatAt(track.values, i)
    writeQuat(track, i, (side === 'left' ? extra.clone().multiply(current) : current.multiply(extra)).normalize())
  }
}

function applyAdjust(tracks: PoseTrack[], profile: HumanoidRigProfile, raw: HumanoidRetargetAdjust | null | undefined): void {
  const adjust = normalizeHumanoidRetargetAdjust(raw)
  if (humanoidRetargetAdjustIsDefault(adjust)) return
  const deg = Math.PI / 180
  const quaternionTracks = tracks.filter(track => track.property === 'quaternion' && track.slot)
  const rotate = (slot: HumanoidBoneSlot, axis: Vector3, radians: number) => {
    const sign = slot.startsWith('Left') ? 1 : slot.startsWith('Right') ? -1 : 0
    const rest = profile.bySlot.get(slot)
    const track = quaternionTracks.find(item => item.slot === slot)
    if (!sign || !rest || !track || Math.abs(radians) < 1e-5) return null
    const extra = worldAxis(rest, axis, sign * radians)
    multiplyKeys(track, extra, 'right')
    return extra
  }
  for (const slot of ['LeftShoulder', 'RightShoulder'] as const) {
    const extra = rotate(slot, new Vector3(0, 1, 0), adjust.shoulderSpreadDeg * deg)
    if (!extra) continue
    const arm = quaternionTracks.find(track => track.slot === (slot === 'LeftShoulder' ? 'LeftUpperArm' : 'RightUpperArm'))
    if (arm) multiplyKeys(arm, extra.clone().invert(), 'left')
  }
  const shift = (slot: 'LeftShoulder' | 'RightShoulder') => {
    if (Math.abs(adjust.shoulderWidthRatio) < 1e-5) return
    const rest = profile.bySlot.get(slot)
    if (!rest) return
    let outward = new Vector3(rest.position.x, 0, rest.position.z)
    if (outward.lengthSq() < 1e-8) outward = new Vector3(slot === 'LeftShoulder' ? 1 : -1, 0, 0)
    const reach = Math.max(outward.length(), 1e-4)
    outward.normalize()
    const delta = outward.multiplyScalar(reach * adjust.shoulderWidthRatio)
    let track = tracks.find(item => item.slot === slot && item.property === 'position')
    if (!track) {
      const times = quaternionTracks.find(item => item.slot === slot)?.times ?? [0]
      track = { bone: nameForSlot(profile, slot) ?? slot, slot, property: 'position', times: [...times], values: [], passthrough: null }
      for (let i = 0; i < times.length; i += 1) track.values.push(rest.position.x, rest.position.y, rest.position.z)
      tracks.push(track)
    }
    for (let i = 0; i < track.times.length; i += 1) writeVec(track, i, vecAt(track.values, i).add(delta))
  }
  shift('LeftShoulder')
  shift('RightShoulder')
  for (const slot of ['LeftUpperArm', 'RightUpperArm'] as const) rotate(slot, new Vector3(0, 0, 1), adjust.armSpreadDeg * deg)
  for (const slot of ['LeftUpperLeg', 'RightUpperLeg'] as const) rotate(slot, new Vector3(0, 0, 1), adjust.hipSpreadDeg * deg)
  for (const slot of ['LeftLowerArm', 'RightLowerArm'] as const) {
    const rest = profile.bySlot.get(slot)
    const track = quaternionTracks.find(item => item.slot === slot)
    if (rest && track) multiplyKeys(track, localBend(rest, adjust.elbowBendDeg * deg), 'right')
  }
  for (const slot of ['LeftLowerLeg', 'RightLowerLeg'] as const) {
    const rest = profile.bySlot.get(slot)
    const track = quaternionTracks.find(item => item.slot === slot)
    if (rest && track) multiplyKeys(track, localBend(rest, adjust.kneeBendDeg * deg), 'right')
  }
  for (const slot of ['LeftFoot', 'RightFoot'] as const) {
    const rest = profile.bySlot.get(slot)
    const track = quaternionTracks.find(item => item.slot === slot)
    if (rest && track) multiplyKeys(track, worldAxis(rest, new Vector3(1, 0, 0), adjust.footPitchDeg * deg), 'right')
  }
  const hips = tracks.find(track => track.slot === 'Hips' && track.property === 'position')
  if (!hips || hips.values.length < 3) return
  const origin = vecAt(hips.values, 0)
  const height = adjust.hipsHeightLegRatio * profile.legScaleMetric
  for (let i = 0; i < hips.times.length; i += 1) {
    const base = vecAt(hips.values, i)
    writeVec(hips, i, new Vector3(
      origin.x + (base.x - origin.x) * adjust.strideScale,
      base.y + height,
      origin.z + (base.z - origin.z) * adjust.strideScale,
    ))
  }
}

function toClip(name: string, duration: number, tracks: PoseTrack[], extras: KeyframeTrack[]): AnimationClip {
  const baked: KeyframeTrack[] = [...extras]
  for (const track of tracks) {
    if (track.passthrough) {
      track.passthrough.name = `${track.bone}.${track.property}`
      baked.push(track.passthrough)
      continue
    }
    const values = new Float32Array(track.values)
    const times = new Float32Array(track.times)
    const created = track.property === 'quaternion'
      ? new QuaternionKeyframeTrack(`${track.bone}.quaternion`, times, values)
      : new VectorKeyframeTrack(`${track.bone}.position`, times, values)
    created.setInterpolation(InterpolateLinear)
    baked.push(created)
  }
  return new AnimationClip(name, duration, baked)
}

export function bindHumanoidClip(input: {
  clip: AnimationClip
  sourceProfile: HumanoidRigProfile | null
  sourceSkeletons: readonly HumanoidSkeletonRecord[]
  sourceAvatar?: ModelHumanoidAvatar | null
  targetProfile: HumanoidRigProfile
  targetSlots?: ReadonlyMap<HumanoidBoneSlot, string>
  adjust?: HumanoidRetargetAdjust | null
}): AnimationClip | null {
  const target = input.targetSlots && input.targetSlots.size > 0 ? applyAvatarSlots(input.targetProfile, input.targetSlots) : input.targetProfile
  if (!target.bySlot.has('Hips')) return null
  const source = profileForClip(input.clip, input.sourceProfile)
  if (!source?.bySlot.has('Hips')) return null
  const authored = foldRootMotionTracks(authoredTracks(input.clip), input.sourceSkeletons, source.slotByNormName, input.sourceAvatar)
  const ratio = computeHumanoidHipsScaleRatio(source, target)
  const targetNames = new Set(target.byNormName.keys())
  const used = new Set<string>()
  const pose: PoseTrack[] = []
  const extras: KeyframeTrack[] = []
  let crossed = false
  for (const track of input.clip.tracks) {
    const { bone, property } = splitTrack(track.name)
    if (!bone) continue
    if (property !== 'quaternion' && property !== 'position' && property !== 'scale') {
      if (targetNames.has(normHumanoidBoneName(bone))) extras.push(track.clone())
      continue
    }
    const norm = normHumanoidBoneName(bone)
    const sourceSlot = source.slotByNormName.get(norm) ?? classifyHumanoidBoneSlot(bone)
    let targetBone = target.originalByNorm.get(norm) ?? null
    let effective = sourceSlot
    let via = false
    if (!targetBone && sourceSlot) {
      for (const candidate of getHumanoidSlotFallbackChain(sourceSlot)) {
        const mapped = nameForSlot(target, candidate)
        const rest = target.bySlot.get(candidate)
        if (!mapped || !rest) continue
        targetBone = mapped
        effective = candidate
        via = true
        break
      }
    }
    const cross = via || Math.abs(ratio - 1) > 0.05
    if (cross) crossed = true
    if (cross && (property === 'scale' || (!effective && (property === 'position' || property === 'quaternion')) || (effective && effective !== 'Hips' && property === 'position'))) continue
    if (!targetBone) continue
    const key = `${normHumanoidBoneName(targetBone)}.${property}`
    if (used.has(key)) continue
    used.add(key)
    if (!cross) {
      const cloned = track.clone()
      cloned.name = `${targetBone}.${property}`
      if (property === 'scale') {
        extras.push(cloned)
        continue
      }
      const sampled = readSamples(track)
      pose.push({ bone: targetBone, slot: effective, property, times: sampled.times, values: sampled.values, passthrough: cloned })
      continue
    }
    if (property === 'scale') continue
    const sampled = readSamples(track)
    let times = sampled.times
    let values = sampled.values
    if (property === 'position' && effective === 'Hips') {
      const foldedHips = authored.find(item => item.targetProperty === 'position' && item.targetName && normHumanoidBoneName(item.targetName) === norm)
      if (foldedHips && foldedHips.keys.length > 0) {
        const foldedTimes: number[] = []
        const foldedValues: number[] = []
        for (const k of foldedHips.keys) {
          if (!Array.isArray(k.value) || k.value.length < 3) continue
          foldedTimes.push(k.frame ?? 0)
          foldedValues.push(Number(k.value[0]) || 0, Number(k.value[1]) || 0, Number(k.value[2]) || 0)
        }
        if (foldedTimes.length > 0) {
          times = foldedTimes
          values = foldedValues
        }
      }
    } else if (property === 'quaternion' && effective === 'Hips') {
      const foldedHipsRot = authored.find(item => item.targetProperty === 'rotationQuaternion' && item.targetName && normHumanoidBoneName(item.targetName) === norm)
      if (foldedHipsRot && foldedHipsRot.keys.length > 0) {
        const foldedTimes: number[] = []
        const foldedValues: number[] = []
        for (const k of foldedHipsRot.keys) {
          if (!Array.isArray(k.value) || k.value.length < 4) continue
          foldedTimes.push(k.frame ?? 0)
          foldedValues.push(Number(k.value[0]) || 0, Number(k.value[1]) || 0, Number(k.value[2]) || 0, Number(k.value[3]) ?? 1)
        }
        if (foldedTimes.length > 0) {
          times = foldedTimes
          values = foldedValues
        }
      }
    }
    const next: PoseTrack = { bone: targetBone, slot: effective, property, times, values, passthrough: null }
    const srcRest = (sourceSlot ? source.bySlot.get(sourceSlot) : undefined) ?? source.byNormName.get(norm)
    const dstRest = effective ? target.bySlot.get(effective) : undefined
    if (dstRest && effective) {
      if (property === 'position' && effective === 'Hips') compensatePosition(next, srcRest, dstRest, ratio, source.hasTrueBindPose)
      else if (property === 'quaternion' && srcRest) compensateQuaternion(next, effective, srcRest, dstRest, source.hasTrueBindPose, source, target)
    }
    pose.push(next)
  }
  if (crossed) {
    applyProportion(pose, source, target)
    plantFeet(pose, source, target, authored)
    applyAdjust(pose, target, input.adjust)
  }
  if (pose.length === 0 && extras.length === 0) return null
  return toClip(input.clip.name, input.clip.duration, pose.filter(track => track.passthrough || track.values.length > 0), extras)
}
