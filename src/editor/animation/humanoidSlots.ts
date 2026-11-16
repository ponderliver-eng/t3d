/** 人形槽位识别。名字覆盖 Mixamo、Mecanim、Biped、Rigify、Unreal、CC/Daz；对不上再按拓扑推断。 */

export type HumanoidBoneSlot =
  | 'Hips' | 'Spine' | 'Chest' | 'UpperChest' | 'Neck' | 'Head' | 'Jaw' | 'LeftEye' | 'RightEye'
  | 'LeftShoulder' | 'LeftUpperArm' | 'LeftLowerArm' | 'LeftHand'
  | 'RightShoulder' | 'RightUpperArm' | 'RightLowerArm' | 'RightHand'
  | 'LeftUpperLeg' | 'LeftLowerLeg' | 'LeftFoot' | 'LeftToes'
  | 'RightUpperLeg' | 'RightLowerLeg' | 'RightFoot' | 'RightToes'
  | 'LeftThumbProximal' | 'LeftThumbIntermediate' | 'LeftThumbDistal'
  | 'LeftIndexProximal' | 'LeftIndexIntermediate' | 'LeftIndexDistal'
  | 'LeftMiddleProximal' | 'LeftMiddleIntermediate' | 'LeftMiddleDistal'
  | 'LeftRingProximal' | 'LeftRingIntermediate' | 'LeftRingDistal'
  | 'LeftLittleProximal' | 'LeftLittleIntermediate' | 'LeftLittleDistal'
  | 'RightThumbProximal' | 'RightThumbIntermediate' | 'RightThumbDistal'
  | 'RightIndexProximal' | 'RightIndexIntermediate' | 'RightIndexDistal'
  | 'RightMiddleProximal' | 'RightMiddleIntermediate' | 'RightMiddleDistal'
  | 'RightRingProximal' | 'RightRingIntermediate' | 'RightRingDistal'
  | 'RightLittleProximal' | 'RightLittleIntermediate' | 'RightLittleDistal'

export const CORE_HUMANOID_SLOTS: readonly HumanoidBoneSlot[] = [
  'Hips', 'Spine', 'Head',
  'LeftUpperArm', 'LeftLowerArm', 'RightUpperArm', 'RightLowerArm',
  'LeftUpperLeg', 'LeftLowerLeg', 'RightUpperLeg', 'RightLowerLeg',
]

export function stripRigBonePrefix(rawName: string): string {
  let s = rawName.trim()
  const sepIdx = Math.max(s.lastIndexOf(':'), s.lastIndexOf('|'), s.lastIndexOf('/'))
  if (sepIdx >= 0 && sepIdx < s.length - 1) s = s.slice(sepIdx + 1)
  s = s.replace(/^(mixamorig\d*[_:]?|bip0*\d+[\s_.-]*|valvebiped[._]|cc_base_|rl_|def[-_]|org[-_]|mch[-_]|rig[-_]|armature[-_|/]|chr\d*[-_]|character\d+[_-]|b-)/i, '')
  return s.trim()
}

type Side = 'left' | 'right' | null

function detectSideAndStem(cleanName: string): { side: Side; stem: string } {
  const withoutMiddle = cleanName.replace(/[._\-\s]+m$/i, '')
  const lower = withoutMiddle.toLowerCase()
  if ((/(^|[._\-\s])(end|nub|twist\d*|roll\d*|ik|pole|rootpart\d*)($|[._\-\s])/i.test(lower) || /twist\d*(l|r)?$/i.test(lower) || /sharebone/i.test(lower) || /(?<!b)end$/i.test(lower)) && !/^necktwist0*1$/i.test(lower)) {
    return { side: null, stem: '' }
  }
  const suffixMatch = /^(.*?)[._\-\s]+(l|r|left|right)$/i.exec(lower)
  if (suffixMatch) {
    const token = suffixMatch[2].toLowerCase()
    return { side: token === 'l' || token === 'left' ? 'left' : 'right', stem: suffixMatch[1].replace(/[._\-\s]+/g, '') }
  }
  // GLTFLoader.createUniqueName 会剥掉骨骼名中的 '.'，导致 `thigh.L` / `upperarm.R` 变成 `thighL` / `upperarmR`
  const camelSuffixMatch = /^(.+?)(L|R)$/.exec(withoutMiddle)
  if (camelSuffixMatch) {
    const stemCandidate = camelSuffixMatch[1]!.toLowerCase().replace(/[._\-\s]+/g, '')
    if (/^(shoulder|clavicle|collar|scapula|shldr|upperarm|arm|uparm|bicep|humerus|shldrbend|lowerarm|forearm|loarm|elbow|forearmbend|ulna|hand|wrist|palm|upperleg|upleg|thigh|hip|femur|thighbend|lowerleg|leg|calf|shin|knee|tibia|foot|ankle|toes|toe|toebase|ball|forefoot|eye|eyeball|(hand|f)?(thumb|index|forefinger|middle|mid|ring|third|pinky|little|small|finger\d)(finger)?(\d*|a|b|c|proximal|intermediate|distal))$/.test(stemCandidate)) {
      return { side: camelSuffixMatch[2] === 'L' ? 'left' : 'right', stem: stemCandidate }
    }
  }
  const prefixWordMatch = /^(left|right)[._\-\s]*(.+)$/i.exec(lower)
  if (prefixWordMatch) {
    return { side: prefixWordMatch[1].toLowerCase() === 'left' ? 'left' : 'right', stem: prefixWordMatch[2].replace(/[._\-\s]+/g, '') }
  }
  const prefixCharMatch = /^(l|r)[._\-\s]+(.+)$/i.exec(lower)
  if (prefixCharMatch) {
    return { side: prefixCharMatch[1].toLowerCase() === 'l' ? 'left' : 'right', stem: prefixCharMatch[2].replace(/[._\-\s]+/g, '') }
  }
  const camelSideMatch = /^([lr])([A-Z][a-zA-Z0-9_]*)$/.exec(withoutMiddle)
  if (camelSideMatch) {
    return { side: camelSideMatch[1].toLowerCase() === 'l' ? 'left' : 'right', stem: camelSideMatch[2].toLowerCase().replace(/[._\-\s]+/g, '') }
  }
  return { side: null, stem: lower.replace(/[._\-\s]+/g, '') }
}

type FingerKind = 'Thumb' | 'Index' | 'Middle' | 'Ring' | 'Little'

function classifyFingerSlot(isLeft: boolean, stem: string): HumanoidBoneSlot | null {
  const s = stem.replace(/^hand/, '').replace(/^f(?!inger)/, '')
  let finger: FingerKind | null = null
  let rest = ''
  let oneBasedBipedPhalanx = false
  if (s.startsWith('thumb') || s.startsWith('finger0')) {
    finger = 'Thumb'
    oneBasedBipedPhalanx = s.startsWith('finger0')
    rest = s.replace(/^(thumb(finger)?|finger0)/, '')
  } else if (s.startsWith('index') || s.startsWith('finger1') || s.startsWith('forefinger')) {
    finger = 'Index'
    oneBasedBipedPhalanx = s.startsWith('finger1')
    rest = s.replace(/^(index(finger)?|finger1|forefinger)/, '')
  } else if (s.startsWith('middle') || s.startsWith('mid') || s.startsWith('finger2')) {
    finger = 'Middle'
    oneBasedBipedPhalanx = s.startsWith('finger2')
    rest = s.replace(/^(middle(finger)?|mid(finger)?|finger2)/, '')
  } else if (s.startsWith('ring') || s.startsWith('third') || s.startsWith('finger3')) {
    finger = 'Ring'
    oneBasedBipedPhalanx = s.startsWith('finger3')
    rest = s.replace(/^(ring(finger)?|third|finger3)/, '')
  } else if (s.startsWith('pinky') || s.startsWith('little') || s.startsWith('small') || s.startsWith('finger4')) {
    finger = 'Little'
    oneBasedBipedPhalanx = s.startsWith('finger4')
    rest = s.replace(/^(pinky(finger)?|little(finger)?|small(finger)?|finger4)/, '')
  }
  if (!finger) return null
  let phalanx: 'Proximal' | 'Intermediate' | 'Distal' | null = null
  if (oneBasedBipedPhalanx) {
    if (rest === '' || rest === '0') phalanx = 'Proximal'
    else if (rest === '1' || rest === '01') phalanx = 'Intermediate'
    else if (rest === '2' || rest === '02') phalanx = 'Distal'
  } else if (rest === '' || rest === '1' || rest === '01' || rest === '0' || rest === '00' || rest === 'proximal' || rest === 'a') {
    phalanx = 'Proximal'
  } else if (rest === '2' || rest === '02' || rest === 'intermediate' || rest === 'middle' || rest === 'b') {
    phalanx = 'Intermediate'
  } else if (rest === '3' || rest === '03' || rest === 'distal' || rest === 'c') {
    phalanx = 'Distal'
  }
  if (!phalanx) return null
  return `${isLeft ? 'Left' : 'Right'}${finger}${phalanx}` as HumanoidBoneSlot
}

export function classifyHumanoidBoneSlot(rawBoneName: string): HumanoidBoneSlot | null {
  const stripped = stripRigBonePrefix(rawBoneName)
  if (!stripped) return null
  const { side, stem } = detectSideAndStem(stripped)
  if (!stem) return null
  if (!side) {
    if (stem === 'hips' || stem === 'pelvis' || stem === 'hip' || stem === 'rootpelvis' || stem === 'cog' || stem === 'centerofgravity' || stem === 'waist' || /^root[._\-\s]*m$/i.test(stripped)) return 'Hips'
    if (['spine', 'spine01', 'spine1', 'spine00', 'spinea', 'abdomen', 'abdomenlower', 'torso'].includes(stem)) return 'Spine'
    if (['spine2', 'spine02', 'spineb', 'chest', 'thorax', 'ribcage', 'abdomenupper', 'chestlower'].includes(stem)) return 'Chest'
    if (['spine3', 'spine03', 'spine04', 'spine4', 'spinec', 'upperchest', 'topchest', 'chestupper'].includes(stem)) return 'UpperChest'
    if (stem === 'neck' || stem === 'neck01' || stem === 'neck1' || stem === 'necklower' || stem === 'necktwist01' || stem === 'necktwist1') return 'Neck'
    if (stem === 'head' || stem === 'head01' || stem === 'head1') return 'Head'
    if (stem === 'jaw' || stem === 'chin' || stem === 'mandible') return 'Jaw'
    return null
  }
  const isLeft = side === 'left'
  if (stem === 'eye' || stem === 'eyeball') return isLeft ? 'LeftEye' : 'RightEye'
  if (['shoulder', 'clavicle', 'collar', 'scapula', 'shldr'].includes(stem)) return isLeft ? 'LeftShoulder' : 'RightShoulder'
  if (['upperarm', 'arm', 'uparm', 'bicep', 'humerus', 'shldrbend'].includes(stem)) return isLeft ? 'LeftUpperArm' : 'RightUpperArm'
  if (['lowerarm', 'forearm', 'loarm', 'elbow', 'forearmbend', 'ulna'].includes(stem)) return isLeft ? 'LeftLowerArm' : 'RightLowerArm'
  if (['hand', 'wrist', 'palm'].includes(stem)) return isLeft ? 'LeftHand' : 'RightHand'
  if (['upperleg', 'upleg', 'thigh', 'hip', 'femur', 'thighbend'].includes(stem)) return isLeft ? 'LeftUpperLeg' : 'RightUpperLeg'
  if (['lowerleg', 'leg', 'calf', 'shin', 'knee', 'tibia'].includes(stem)) return isLeft ? 'LeftLowerLeg' : 'RightLowerLeg'
  if (stem === 'foot' || stem === 'ankle') return isLeft ? 'LeftFoot' : 'RightFoot'
  if (['toes', 'toe', 'toebase', 'ball', 'forefoot'].includes(stem)) return isLeft ? 'LeftToes' : 'RightToes'
  return classifyFingerSlot(isLeft, stem)
}

export function buildHumanoidBoneMapFromNames(boneNames: Iterable<string>): Map<HumanoidBoneSlot, string> {
  const map = new Map<HumanoidBoneSlot, string>()
  for (const name of boneNames) {
    if (!name) continue
    let slot = classifyHumanoidBoneSlot(name)
    if (!slot) continue
    if (slot === 'LeftShoulder' && map.has('LeftShoulder') && !map.has('LeftUpperArm')) slot = 'LeftUpperArm'
    else if (slot === 'RightShoulder' && map.has('RightShoulder') && !map.has('RightUpperArm')) slot = 'RightUpperArm'
    else if (slot === 'Spine' && map.has('Spine') && !map.has('Chest')) slot = 'Chest'
    else if (slot === 'Chest' && map.has('Chest') && !map.has('UpperChest')) slot = 'UpperChest'
    if (!map.has(slot)) map.set(slot, name)
  }
  return map
}

export function getHumanoidSlotFallbackChain(slot: HumanoidBoneSlot): readonly HumanoidBoneSlot[] {
  switch (slot) {
    case 'UpperChest': return ['UpperChest', 'Chest', 'Spine']
    case 'Chest': return ['Chest', 'Spine', 'UpperChest']
    case 'Neck': return ['Neck', 'Head']
    default: return [slot]
  }
}

export function isAuxiliaryHumanoidBone(rawName: string): boolean {
  const name = rawName.trim()
  if (!name) return false
  if (/^(j_|hair_|skirt|suso|ribbon|cloth_|mune_|tail_|breast)/i.test(name)) return true
  return /(skirt|ribbon|hairtail|hairside|hairfront|suso|cloth|breast)/i.test(name)
}

export function scoreHumanoidBoneMap(map: ReadonlyMap<HumanoidBoneSlot, string>): number {
  let score = 0
  for (const slot of CORE_HUMANOID_SLOTS) if (map.has(slot)) score += 10
  if (map.has('Hips') && map.has('LeftUpperLeg') && map.has('RightUpperLeg') && map.has('LeftUpperArm') && map.has('RightUpperArm')) score += 40
  return score
}

export interface SkeletonTopologyBoneInput {
  index: number
  name: string
  parentIndex?: number
  position?: { x: number; y: number; z: number }
}

export function inferHumanoidBoneMapFromTopology(bones: readonly SkeletonTopologyBoneInput[]): Map<HumanoidBoneSlot, string> {
  const map = new Map<HumanoidBoneSlot, string>()
  if (bones.length < 9) return map
  const namedMap = buildHumanoidBoneMapFromNames(bones.map(bone => bone.name))
  for (const [slot, boneName] of namedMap) map.set(slot, boneName)
  let namedCoreHits = 0
  for (const slot of CORE_HUMANOID_SLOTS) if (map.has(slot)) namedCoreHits += 1
  if (namedCoreHits >= 6 && map.has('Hips')) return map

  const usable = bones.filter(bone => bone.name && !isAuxiliaryHumanoidBone(bone.name))
  const byIdx = new Map<number, SkeletonTopologyBoneInput>()
  const childrenMap = new Map<number, number[]>()
  for (const bone of usable) {
    byIdx.set(bone.index, bone)
    if (!childrenMap.has(bone.index)) childrenMap.set(bone.index, [])
  }
  for (const bone of usable) {
    if (typeof bone.parentIndex === 'number' && bone.parentIndex >= 0 && bone.parentIndex !== bone.index && byIdx.has(bone.parentIndex)) {
      childrenMap.get(bone.parentIndex)!.push(bone.index)
    }
  }
  const maxDepth = (idx: number, visited = new Set<number>()): number => {
    if (visited.has(idx)) return 0
    visited.add(idx)
    let best = 0
    for (const child of childrenMap.get(idx) ?? []) best = Math.max(best, 1 + maxDepth(child, visited))
    return best
  }
  const subtreeSize = (idx: number, visited = new Set<number>()): number => {
    if (visited.has(idx)) return 0
    visited.add(idx)
    let total = 1
    for (const child of childrenMap.get(idx) ?? []) total += subtreeSize(child, visited)
    return total
  }
  let hipsIdx: number | null = null
  let spineBranchRootIdx: number | null = null
  let legBranchRoots: number[] = []
  let bestHipsScore = -1
  for (const bone of usable) {
    const children = (childrenMap.get(bone.index) ?? []).filter(child => maxDepth(child) >= 2)
    if (children.length < 3) continue
    const sorted = [...children].sort((a, b) => subtreeSize(b) - subtreeSize(a))
    const candidateSpine = sorted[0]
    if (candidateSpine === undefined || subtreeSize(candidateSpine) < 5) continue
    const score = subtreeSize(candidateSpine) + sorted.slice(1, 3).reduce((sum, idx) => sum + maxDepth(idx), 0)
    if (score <= bestHipsScore) continue
    bestHipsScore = score
    hipsIdx = bone.index
    spineBranchRootIdx = candidateSpine
    legBranchRoots = sorted.slice(1, 3)
  }
  if (hipsIdx === null || spineBranchRootIdx === null || legBranchRoots.length < 2) return map
  const setSlot = (slot: HumanoidBoneSlot, idx: number | undefined) => {
    const bone = idx !== undefined ? byIdx.get(idx) : undefined
    if (bone?.name && !map.has(slot)) map.set(slot, bone.name)
  }
  setSlot('Hips', hipsIdx)
  const isLeftPreferred = (idxA: number, idxB: number): [number, number] => {
    const a = byIdx.get(idxA)
    const b = byIdx.get(idxB)
    if (!a || !b) return [idxA, idxB]
    if (/left|[._\-\s]l$/i.test(a.name) || /right|[._\-\s]r$/i.test(b.name)) return [idxA, idxB]
    if (/right|[._\-\s]r$/i.test(a.name) || /left|[._\-\s]l$/i.test(b.name)) return [idxB, idxA]
    if (a.position && b.position && Math.abs(a.position.x - b.position.x) > 1e-4) {
      return a.position.x >= b.position.x ? [idxA, idxB] : [idxB, idxA]
    }
    return [idxA, idxB]
  }
  const walkChain = (startIdx: number, maxLen: number): number[] => {
    const chain = [startIdx]
    let current = startIdx
    while (chain.length < maxLen) {
      const children = (childrenMap.get(current) ?? []).sort((a, b) => maxDepth(b) - maxDepth(a))
      if (children.length === 0 || children[0] === undefined) break
      current = children[0]
      chain.push(current)
    }
    return chain
  }
  const [leftLegRoot, rightLegRoot] = isLeftPreferred(legBranchRoots[0]!, legBranchRoots[1]!)
  const leftLeg = walkChain(leftLegRoot, 4)
  const rightLeg = walkChain(rightLegRoot, 4)
  setSlot('LeftUpperLeg', leftLeg[0])
  setSlot('LeftLowerLeg', leftLeg[1])
  setSlot('LeftFoot', leftLeg[2])
  setSlot('LeftToes', leftLeg[3])
  setSlot('RightUpperLeg', rightLeg[0])
  setSlot('RightLowerLeg', rightLeg[1])
  setSlot('RightFoot', rightLeg[2])
  setSlot('RightToes', rightLeg[3])
  const spineChain: number[] = []
  let currentSpine: number | null = spineBranchRootIdx
  let chestHubIdx: number | null = null
  while (currentSpine !== null && spineChain.length < 6) {
    spineChain.push(currentSpine)
    const deep: number[] = (childrenMap.get(currentSpine) ?? []).filter(child => maxDepth(child) >= 1)
    if (deep.length >= 3) {
      chestHubIdx = currentSpine
      break
    }
    currentSpine = deep[0] ?? null
  }
  setSlot('Spine', spineChain[0])
  if (spineChain.length >= 2) setSlot('Chest', spineChain[1])
  if (spineChain.length >= 3) setSlot('UpperChest', spineChain[2])
  if (chestHubIdx !== null) {
    const branches = (childrenMap.get(chestHubIdx) ?? []).filter(child => maxDepth(child) >= 1).sort((a, b) => maxDepth(b) - maxDepth(a))
    if (branches.length >= 3) {
      const [leftArmRoot, rightArmRoot] = isLeftPreferred(branches[0]!, branches[1]!)
      const leftArm = walkChain(leftArmRoot, 4)
      const rightArm = walkChain(rightArmRoot, 4)
      if (leftArm.length >= 4) {
        setSlot('LeftShoulder', leftArm[0]); setSlot('LeftUpperArm', leftArm[1]); setSlot('LeftLowerArm', leftArm[2]); setSlot('LeftHand', leftArm[3])
      } else {
        setSlot('LeftUpperArm', leftArm[0]); setSlot('LeftLowerArm', leftArm[1]); setSlot('LeftHand', leftArm[2])
      }
      if (rightArm.length >= 4) {
        setSlot('RightShoulder', rightArm[0]); setSlot('RightUpperArm', rightArm[1]); setSlot('RightLowerArm', rightArm[2]); setSlot('RightHand', rightArm[3])
      } else {
        setSlot('RightUpperArm', rightArm[0]); setSlot('RightLowerArm', rightArm[1]); setSlot('RightHand', rightArm[2])
      }
      const neck = walkChain(branches[2]!, 2)
      if (neck.length >= 2) { setSlot('Neck', neck[0]); setSlot('Head', neck[1]) }
      else setSlot('Head', neck[0])
    }
  }
  return map
}

export function normHumanoidBoneName(name: string): string {
  return name.trim().toLowerCase().replace(/[\s_]+/g, ' ')
}
