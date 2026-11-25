import { CompressedTexture, NoColorSpace, RepeatWrapping, RGBA_BPTC_Format, SRGBColorSpace } from 'three'

const BC7_MAGIC = 0x37434254 // 'TBC7'

export interface Bc7Mip {
  width: number
  height: number
  data: Uint8Array
}

export function packBc7Artifact(width: number, _height: number, mips: Bc7Mip[]): ArrayBuffer {
  let payloadBytes = 0
  for (const mip of mips) payloadBytes += 12 + mip.data.byteLength
  const out = new Uint8Array(16 + payloadBytes)
  const view = new DataView(out.buffer)
  view.setUint32(0, BC7_MAGIC, true)
  view.setUint32(4, 1, true)
  view.setUint32(8, width, true)
  view.setUint32(12, mips.length, true)
  let offset = 16
  for (const mip of mips) {
    view.setUint32(offset, mip.width, true)
    view.setUint32(offset + 4, mip.height, true)
    view.setUint32(offset + 8, mip.data.byteLength, true)
    out.set(mip.data, offset + 12)
    offset += 12 + mip.data.byteLength
  }
  return out.buffer
}

export function unpackBc7Artifact(buffer: ArrayBuffer): { width: number, height: number, mips: Bc7Mip[] } | null {
  if (buffer.byteLength < 16) return null
  const view = new DataView(buffer)
  if (view.getUint32(0, true) !== BC7_MAGIC || view.getUint32(4, true) !== 1) return null
  const width = view.getUint32(8, true)
  const mipCount = view.getUint32(12, true)
  if (width <= 0 || mipCount <= 0 || mipCount > 16) return null
  const mips: Bc7Mip[] = []
  let offset = 16
  for (let i = 0; i < mipCount; i += 1) {
    if (offset + 12 > buffer.byteLength) return null
    const w = view.getUint32(offset, true)
    const h = view.getUint32(offset + 4, true)
    const byteLen = view.getUint32(offset + 8, true)
    offset += 12
    if (offset + byteLen > buffer.byteLength) return null
    mips.push({ width: w, height: h, data: new Uint8Array(buffer, offset, byteLen) })
    offset += byteLen
  }
  if (mips.length === 0) return null
  return { width, height: mips[0]!.height, mips }
}

/**
 * 裁剪成品里的最高几级清晰度，满足构建设置的尺寸上限，
 * 但基准级必须保持 4 的倍数（否则 Three.js 上传 BC7 会报错）。
 */
export function trimBc7ArtifactToMaxSize(buffer: ArrayBuffer, maxSize: number): ArrayBuffer | null {
  if (maxSize <= 0) return buffer
  const unpacked = unpackBc7Artifact(buffer)
  if (!unpacked) return null
  let skip = 0
  while (
    skip + 1 < unpacked.mips.length
    && Math.max(unpacked.mips[skip]!.width, unpacked.mips[skip]!.height) > maxSize
    && unpacked.mips[skip + 1]!.width >= 4
    && unpacked.mips[skip + 1]!.height >= 4
    && unpacked.mips[skip + 1]!.width % 4 === 0
    && unpacked.mips[skip + 1]!.height % 4 === 0
  ) {
    skip += 1
  }
  if (skip === 0) return buffer
  const rest = unpacked.mips.slice(skip)
  return packBc7Artifact(rest[0]!.width, rest[0]!.height, rest)
}

export function buildBc7CompressedTexture(width: number, height: number, mips: Bc7Mip[], srgb = true): CompressedTexture {
  const tex = new CompressedTexture(mips as unknown as ImageData[], width, height, RGBA_BPTC_Format)
  tex.colorSpace = srgb ? SRGBColorSpace : NoColorSpace
  tex.flipY = false
  tex.wrapS = RepeatWrapping
  tex.wrapT = RepeatWrapping
  tex.needsUpdate = true
  return tex
}

export async function loadBc7TextureFromUrl(url: string, srgb = true): Promise<CompressedTexture | null> {
  const response = await fetch(url)
  if (!response.ok) return null
  const buffer = await response.arrayBuffer()
  const unpacked = unpackBc7Artifact(buffer)
  if (!unpacked) return null
  return buildBc7CompressedTexture(unpacked.width, unpacked.height, unpacked.mips, srgb)
}

export function checkWebGlBptcSupport(): boolean {
  if (typeof document === 'undefined') return false
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2')
    if (!gl) return false
    return Boolean(gl.getExtension('EXT_texture_compression_bptc'))
  } catch {
    return false
  }
}

/** 判断已经完成 init 的 WebGPURenderer 能不能直接上传 BC7 贴图。 */
export function rendererSupportsBc7(renderer: unknown): boolean {
  const backend = (renderer as {
    backend?: {
      device?: { features?: ReadonlySet<string> }
      gl?: WebGL2RenderingContext
    }
  } | null | undefined)?.backend
  if (backend?.device?.features) {
    return backend.device.features.has('texture-compression-bc')
  }
  if (backend?.gl) {
    return Boolean(backend.gl.getExtension('EXT_texture_compression_bptc'))
  }
  return false
}
