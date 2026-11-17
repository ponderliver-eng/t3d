import { decodeTgaToRgba, encodeRgbaToPng } from './tgaTexture'
import {
  readFbxWithUfbx,
  ufbxBytes,
  ufbxF32,
  ufbxU16,
  ufbxU32,
  type UfbxScene,
  type UfbxTexture,
} from './ufbxRead'

export interface UfbxToGlbOptions {
  logicalFileName?: string
  externalFiles?: ReadonlyArray<{ name: string; data: Uint8Array }>
  importAnimations?: boolean
  animationNames?: readonly string[]
  dropNonJointAnimationTracks?: boolean
}

const GENERIC_CLIP_NAMES = new Set([
  '',
  'mixamo.com',
  'take 001',
  'take001',
  'unreal take',
  'default take',
  'unnamed',
  'scene',
])

function isGenericUfbxClipName(name: string): boolean {
  return GENERIC_CLIP_NAMES.has(name.trim().toLowerCase())
}

function fixQuatContinuity(q: Float32Array): void {
  for (let i = 4; i < q.length; i += 4) {
    const dot = q[i]! * q[i - 4]! + q[i + 1]! * q[i - 3]! + q[i + 2]! * q[i - 2]! + q[i + 3]! * q[i - 1]!
    if (dot < 0) {
      q[i] = -q[i]!
      q[i + 1] = -q[i + 1]!
      q[i + 2] = -q[i + 2]!
      q[i + 3] = -q[i + 3]!
    }
  }
}

function flipUvV(src: Float32Array): Float32Array {
  const out = new Float32Array(src.length)
  for (let i = 0; i < src.length; i += 2) {
    out[i] = src[i]!
    out[i + 1] = 1 - src[i + 1]!
  }
  return out
}

export async function convertFbxBytesToGlbWithUfbx(
  sourceBytes: Uint8Array,
  options: UfbxToGlbOptions = {},
): Promise<ArrayBuffer> {
  const scene = await readFbxWithUfbx(sourceBytes)
  return buildGlbFromUfbxScene(scene, options)
}

export function buildGlbFromUfbxScene(
  scene: UfbxScene,
  options: UfbxToGlbOptions = {},
): ArrayBuffer {
  const binChunks: Uint8Array[] = []
  let binByteLength = 0
  const bufferViews: Array<Record<string, unknown>> = []
  const accessors: Array<Record<string, unknown>> = []

  const appendBufferView = (bytes: Uint8Array, target?: number): number => {
    const padBefore = (4 - (binByteLength % 4)) % 4
    if (padBefore > 0) {
      binChunks.push(new Uint8Array(padBefore))
      binByteLength += padBefore
    }
    const byteOffset = binByteLength
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    binChunks.push(copy)
    binByteLength += copy.byteLength
    const viewIndex = bufferViews.length
    bufferViews.push({
      buffer: 0,
      byteOffset,
      byteLength: copy.byteLength,
      ...(target !== undefined ? { target } : {}),
    })
    return viewIndex
  }

  const appendAccessor = (
    typed: Float32Array | Uint16Array | Uint32Array,
    componentType: number,
    type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4' | 'MAT4',
    count: number,
    opts?: { target?: number; min?: number[]; max?: number[] },
  ): number => {
    const raw = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength)
    const bufferView = appendBufferView(raw, opts?.target)
    const accessorIndex = accessors.length
    accessors.push({
      bufferView,
      byteOffset: 0,
      componentType,
      count,
      type,
      ...(opts?.min ? { min: opts.min } : {}),
      ...(opts?.max ? { max: opts.max } : {}),
    })
    return accessorIndex
  }

  // 1. Nodes
  const gltfNodes: Array<Record<string, unknown>> = []
  const nodeIndexByUfbxIndex = new Map<number, number>()
  const rootChildren: number[] = []

  const rootIdx = scene.nodes.findIndex(n => n.isRoot)
  const root = rootIdx >= 0 ? scene.nodes[rootIdx] : undefined
  if (root && !isIdentityTransform(root.t, root.r, root.s)) {
    const idx = gltfNodes.length
    gltfNodes.push({
      name: root.name || 'RootNode',
      translation: root.t,
      rotation: root.r,
      scale: root.s,
    })
    nodeIndexByUfbxIndex.set(rootIdx, idx)
    rootChildren.push(idx)
  }

  for (let i = 0; i < scene.nodes.length; i += 1) {
    const n = scene.nodes[i]!
    if (n.isRoot) continue
    const idx = gltfNodes.length
    gltfNodes.push({
      name: n.name || `Node_${i}`,
      translation: n.t,
      rotation: n.r,
      scale: n.s,
    })
    nodeIndexByUfbxIndex.set(i, idx)
  }

  for (let i = 0; i < scene.nodes.length; i += 1) {
    const n = scene.nodes[i]!
    if (n.isRoot) continue
    const childGltfIdx = nodeIndexByUfbxIndex.get(i)
    if (childGltfIdx === undefined) continue
    const parentGltfIdx = n.parent >= 0 ? nodeIndexByUfbxIndex.get(n.parent) : undefined
    if (parentGltfIdx !== undefined) {
      const parentNode = gltfNodes[parentGltfIdx]!
      const children = (parentNode.children as number[] | undefined) ?? []
      children.push(childGltfIdx)
      parentNode.children = children
    } else {
      rootChildren.push(childGltfIdx)
    }
  }

  // 2. Textures & Images
  const externalLookup = buildExternalFileMap(options.externalFiles)
  const gltfImages: Array<Record<string, unknown>> = []
  const gltfTextures: Array<Record<string, unknown>> = []
  const textureIndexByUfbxIndex = new Map<number, number>()

  for (let i = 0; i < scene.textures.length; i += 1) {
    const tex = scene.textures[i]!
    const resolved = resolveUfbxTextureBytes(scene, tex, externalLookup)
    if (!resolved) continue
    const bv = appendBufferView(resolved.bytes)
    const imgIdx = gltfImages.length
    gltfImages.push({
      name: tex.name || `image_${imgIdx}`,
      bufferView: bv,
      mimeType: resolved.mimeType,
    })
    const texIdx = gltfTextures.length
    gltfTextures.push({
      name: tex.name || `texture_${texIdx}`,
      source: imgIdx,
    })
    textureIndexByUfbxIndex.set(i, texIdx)
  }

  // 3. Materials
  const gltfMaterials: Array<Record<string, unknown>> = scene.materials.map((m, idx) => {
    const baseTex = textureIndexByUfbxIndex.get(m.baseTex)
    const mrTex =
      m.metallicTex >= 0 && m.metallicTex === m.roughnessTex
        ? textureIndexByUfbxIndex.get(m.metallicTex)
        : undefined
    const normalTex = textureIndexByUfbxIndex.get(m.normalTex)
    const occTex = textureIndexByUfbxIndex.get(m.occlusionTex)
    const emTex = textureIndexByUfbxIndex.get(m.emissiveTex)
    const alpha = m.opacity < 0.999 ? clamp01(m.opacity) : clamp01(m.baseColor[3])
    const pbr: Record<string, unknown> = {
      baseColorFactor: baseTex
        ? [1, 1, 1, alpha]
        : [clamp01(m.baseColor[0]), clamp01(m.baseColor[1]), clamp01(m.baseColor[2]), alpha],
      metallicFactor: mrTex !== undefined ? 1 : clamp01(m.metallic),
      roughnessFactor: mrTex !== undefined ? 1 : clamp01(m.roughness),
      ...(baseTex !== undefined ? { baseColorTexture: { index: baseTex } } : {}),
      ...(mrTex !== undefined ? { metallicRoughnessTexture: { index: mrTex } } : {}),
    }
    const mat: Record<string, unknown> = {
      name: m.name || `Material_${idx}`,
      pbrMetallicRoughness: pbr,
      doubleSided: Boolean(m.doubleSided),
    }
    if (normalTex !== undefined) mat.normalTexture = { index: normalTex }
    if (occTex !== undefined) mat.occlusionTexture = { index: occTex }
    if (emTex !== undefined) {
      mat.emissiveTexture = { index: emTex }
      mat.emissiveFactor = [1, 1, 1]
    } else if (m.emissive.some(v => v > 0)) {
      mat.emissiveFactor = [clamp01(m.emissive[0]), clamp01(m.emissive[1]), clamp01(m.emissive[2])]
    }
    if (m.opacityTex >= 0) {
      mat.alphaMode = 'MASK'
      mat.alphaCutoff = 0.5
    } else if (m.opacity < 0.999) {
      mat.alphaMode = 'BLEND'
    }
    return mat
  })

  // 4. Meshes
  const meshNodeName: string[] = new Array(scene.meshes.length).fill('')
  for (const n of scene.nodes) {
    if (n.mesh >= 0 && n.mesh < meshNodeName.length && !meshNodeName[n.mesh]) {
      meshNodeName[n.mesh] = n.name
    }
  }

  const gltfMeshes: Array<Record<string, unknown>> = scene.meshes.map((m, mi) => {
    const primitives: Array<Record<string, unknown>> = m.primitives.map(p => {
      const attrs: Record<string, number> = {}
      const posArr = ufbxF32(scene, p.pos, p.vertexCount * 3)
      const { min, max } = computeVec3MinMax(posArr, p.min, p.max)
      attrs.POSITION = appendAccessor(posArr, 5126, 'VEC3', p.vertexCount, { target: 34962, min, max })
      if (p.nrm >= 0) {
        attrs.NORMAL = appendAccessor(ufbxF32(scene, p.nrm, p.vertexCount * 3), 5126, 'VEC3', p.vertexCount, { target: 34962 })
      }
      if (p.uv >= 0) {
        attrs.TEXCOORD_0 = appendAccessor(flipUvV(ufbxF32(scene, p.uv, p.vertexCount * 2)), 5126, 'VEC2', p.vertexCount, { target: 34962 })
      }
      if (p.uv1 !== undefined && p.uv1 >= 0) {
        attrs.TEXCOORD_1 = appendAccessor(flipUvV(ufbxF32(scene, p.uv1, p.vertexCount * 2)), 5126, 'VEC2', p.vertexCount, { target: 34962 })
      }
      if (p.col >= 0) {
        const col = ufbxF32(scene, p.col, p.vertexCount * 4)
        if (!isDeadVertexColor(col)) {
          attrs.COLOR_0 = appendAccessor(col, 5126, 'VEC4', p.vertexCount, { target: 34962 })
        }
      }
      if (p.joints >= 0 && p.weights >= 0) {
        attrs.JOINTS_0 = appendAccessor(ufbxU16(scene, p.joints, p.vertexCount * 4), 5123, 'VEC4', p.vertexCount, { target: 34962 })
        attrs.WEIGHTS_0 = appendAccessor(ufbxF32(scene, p.weights, p.vertexCount * 4), 5126, 'VEC4', p.vertexCount, { target: 34962 })
      }
      const idxU32 = ufbxU32(scene, p.indices, p.indexCount)
      const indicesAccessor = p.vertexCount <= 65535
        ? appendAccessor(Uint16Array.from(idxU32), 5123, 'SCALAR', p.indexCount, { target: 34963 })
        : appendAccessor(idxU32, 5125, 'SCALAR', p.indexCount, { target: 34963 })
      return {
        attributes: attrs,
        indices: indicesAccessor,
        ...(p.material >= 0 && p.material < gltfMaterials.length ? { material: p.material } : {}),
      }
    })
    return {
      name: m.name || meshNodeName[mi] || `Mesh_${mi}`,
      primitives,
    }
  })

  // 5. Skins
  const skinJointGltfNodeSet = new Set<number>()
  const gltfSkins: Array<Record<string, unknown>> = scene.skins.map((s, si) => {
    const joints: number[] = []
    for (let j = 0; j < s.joints.length; j += 1) {
      const ufbxNodeIdx = s.joints[j]!
      const gltfNodeIdx = nodeIndexByUfbxIndex.get(ufbxNodeIdx) ?? 0
      joints.push(gltfNodeIdx)
      skinJointGltfNodeSet.add(gltfNodeIdx)
    }
    const ibm = ufbxF32(scene, s.ibm, s.joints.length * 16)
    const ibmAccessor = appendAccessor(ibm, 5126, 'MAT4', s.joints.length)
    return {
      name: s.name || `Skin_${si}`,
      joints,
      inverseBindMatrices: ibmAccessor,
    }
  })

  for (let i = 0; i < scene.nodes.length; i += 1) {
    const n = scene.nodes[i]!
    const gltfIdx = nodeIndexByUfbxIndex.get(i)
    if (gltfIdx === undefined) continue
    const gNode = gltfNodes[gltfIdx]!
    if (n.mesh >= 0 && n.mesh < gltfMeshes.length) gNode.mesh = n.mesh
    if (n.skin >= 0 && n.skin < gltfSkins.length) gNode.skin = n.skin
  }

  // 6. Animations
  const gltfAnimations: Array<Record<string, unknown>> = []
  const dropNonJoint = options.dropNonJointAnimationTracks !== false && skinJointGltfNodeSet.size > 0

  if (options.importAnimations !== false) {
    const emitted = scene.animations.filter(a => a.tracks.length > 0)
    const defaultStem = stripFileExt(options.logicalFileName ?? '')
    emitted.forEach((a, index) => {
      const explicitName = options.animationNames?.length === 1
        ? options.animationNames[0]
        : options.animationNames?.[index]
      let name = explicitName || a.name
      if (!explicitName && emitted.length === 1 && isGenericUfbxClipName(name) && defaultStem) {
        name = defaultStem
      }
      const samplers: Array<Record<string, unknown>> = []
      const channels: Array<Record<string, unknown>> = []
      const usableTracks = dropNonJoint
        ? a.tracks.filter(tr => {
            const gIdx = nodeIndexByUfbxIndex.get(tr.node)
            return gIdx !== undefined && skinJointGltfNodeSet.has(gIdx)
          })
        : a.tracks
      const tracksToEmit = usableTracks.length > 0 ? usableTracks : a.tracks
      for (const tr of tracksToEmit) {
        const targetNode = nodeIndexByUfbxIndex.get(tr.node)
        if (targetNode === undefined || tr.count <= 0) continue
        const times = ufbxF32(scene, tr.times, tr.count).slice()
        const comps = tr.path === 'rotation' ? 4 : 3
        const values = ufbxF32(scene, tr.values, tr.count * comps).slice()
        if (tr.path === 'rotation') fixQuatContinuity(values)
        const input = appendAccessor(times, 5126, 'SCALAR', tr.count, {
          min: [times[0] ?? 0],
          max: [times[times.length - 1] ?? 0],
        })
        const output = appendAccessor(values, 5126, comps === 4 ? 'VEC4' : 'VEC3', tr.count)
        const samplerIdx = samplers.length
        samplers.push({ input, output, interpolation: 'LINEAR' })
        channels.push({
          sampler: samplerIdx,
          target: { node: targetNode, path: tr.path },
        })
      }
      if (channels.length > 0) {
        gltfAnimations.push({
          name: name || `Animation_${index}`,
          samplers,
          channels,
        })
      }
    })
  }

  const gltfJson: Record<string, unknown> = {
    asset: { version: '2.0', generator: 'T3D-ufbx-wasm' },
    scene: 0,
    scenes: [{ name: 'Scene', nodes: rootChildren }],
    nodes: gltfNodes,
    ...(gltfMeshes.length > 0 ? { meshes: gltfMeshes } : {}),
    ...(gltfSkins.length > 0 ? { skins: gltfSkins } : {}),
    ...(gltfMaterials.length > 0 ? { materials: gltfMaterials } : {}),
    ...(gltfTextures.length > 0 ? { textures: gltfTextures } : {}),
    ...(gltfImages.length > 0 ? { images: gltfImages } : {}),
    ...(gltfAnimations.length > 0 ? { animations: gltfAnimations } : {}),
    ...(accessors.length > 0 ? { accessors } : {}),
    ...(bufferViews.length > 0 ? { bufferViews } : {}),
    buffers: [{ byteLength: align4(binByteLength) }],
  }

  const binBuffer = concatChunks(binChunks, align4(binByteLength))
  return encodeGlb(gltfJson, binBuffer)
}

function resolveUfbxTextureBytes(
  scene: UfbxScene,
  tex: UfbxTexture,
  externalLookup: ReadonlyMap<string, Uint8Array>,
): { bytes: Uint8Array; mimeType: 'image/png' | 'image/jpeg' | 'image/webp' } | null {
  let raw: Uint8Array | null = tex.content >= 0 && tex.size > 0
    ? ufbxBytes(scene, tex.content, tex.size)
    : null
  if (!raw) {
    for (const candidate of [tex.relative, tex.filename, tex.absolute, tex.name]) {
      if (!candidate) continue
      const key = normalizeExternalKey(candidate)
      const base = candidate.split(/[\\/]/).pop() ?? ''
      const baseKey = normalizeExternalKey(base)
      const stemKey = normalizeExternalKey(stripFileExt(base))
      raw = externalLookup.get(key) ?? externalLookup.get(baseKey) ?? (stemKey ? externalLookup.get(stemKey) : undefined) ?? null
      if (raw) break
    }
  }
  if (!raw || raw.byteLength < 4) return null
  const sniffed = sniffImageMime(raw)
  if (sniffed) return { bytes: raw, mimeType: sniffed }
  const ext = (tex.filename || tex.relative || tex.name).split('.').pop()?.toLowerCase()
  if (ext === 'tga') {
    try {
      const png = encodeRgbaToPng(decodeTgaToRgba(raw))
      return { bytes: png, mimeType: 'image/png' }
    } catch {
      return null
    }
  }
  return null
}

function sniffImageMime(bytes: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (
    bytes.byteLength >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return 'image/webp'
  }
  return null
}

function buildExternalFileMap(files?: ReadonlyArray<{ name: string; data: Uint8Array }>): Map<string, Uint8Array> {
  const map = new Map<string, Uint8Array>()
  for (const file of files ?? []) {
    if (!file.name || file.data.byteLength === 0) continue
    map.set(normalizeExternalKey(file.name), file.data)
    const base = file.name.split(/[\\/]/).pop() ?? file.name
    map.set(normalizeExternalKey(base), file.data)
    const stem = stripFileExt(base)
    if (stem) map.set(normalizeExternalKey(stem), file.data)
  }
  return map
}

function normalizeExternalKey(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').trim().toLowerCase()
}

function stripFileExt(name: string): string {
  return name.replace(/\\/g, '/').split('/').pop()?.replace(/\.[^.]+$/, '') ?? ''
}

function isIdentityTransform(t: number[], r: number[], s: number[]): boolean {
  return (
    Math.hypot(t[0] ?? 0, t[1] ?? 0, t[2] ?? 0) < 1e-9 &&
    Math.abs((r[3] ?? 1) - 1) < 1e-9 &&
    Math.hypot(r[0] ?? 0, r[1] ?? 0, r[2] ?? 0) < 1e-9 &&
    Math.abs((s[0] ?? 1) - 1) < 1e-9 &&
    Math.abs((s[1] ?? 1) - 1) < 1e-9 &&
    Math.abs((s[2] ?? 1) - 1) < 1e-9
  )
}

function isDeadVertexColor(col: Float32Array): boolean {
  for (let i = 0; i + 3 < col.length; i += 4) {
    if (col[i]! > 0 || col[i + 1]! > 0 || col[i + 2]! > 0) return false
  }
  return col.length > 0
}

function computeVec3MinMax(
  pos: Float32Array,
  fallbackMin?: [number, number, number],
  fallbackMax?: [number, number, number],
): { min: [number, number, number]; max: [number, number, number] } {
  if (pos.length < 3) {
    return {
      min: fallbackMin ?? [0, 0, 0],
      max: fallbackMax ?? [0, 0, 0],
    }
  }
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (let i = 0; i + 2 < pos.length; i += 3) {
    const x = pos[i]!, y = pos[i + 1]!, z = pos[i + 2]!
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (z < minZ) minZ = z
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
    if (z > maxZ) maxZ = z
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function align4(n: number): number {
  return (n + 3) & ~3
}

function concatChunks(chunks: readonly Uint8Array[], totalByteLength: number): Uint8Array {
  const out = new Uint8Array(totalByteLength)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

function encodeGlb(json: Record<string, unknown>, bin: Uint8Array): ArrayBuffer {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json))
  const jsonLength = align4(jsonBytes.byteLength)
  const binLength = align4(bin.byteLength)
  const totalLength = 12 + 8 + jsonLength + (binLength > 0 ? 8 + binLength : 0)
  const out = new ArrayBuffer(totalLength)
  const bytes = new Uint8Array(out)
  const view = new DataView(out)
  bytes.set([0x67, 0x6c, 0x54, 0x46], 0)
  view.setUint32(4, 2, true)
  view.setUint32(8, totalLength, true)
  view.setUint32(12, jsonLength, true)
  bytes.set([0x4a, 0x53, 0x4f, 0x4e], 16)
  bytes.fill(0x20, 20, 20 + jsonLength)
  bytes.set(jsonBytes, 20)
  if (binLength > 0) {
    const binHeader = 20 + jsonLength
    view.setUint32(binHeader, binLength, true)
    bytes.set([0x42, 0x49, 0x4e, 0x00], binHeader + 4)
    bytes.set(bin, binHeader + 8)
  }
  return out
}
