import {
  deleteOriginalTextureBackup,
  hasOriginalTextureBackup,
  readFileBytes,
  readOriginalTextureBackup,
  rememberFile,
  sha256,
  writeOriginalTextureBackup,
} from './cache'
import { type FileAsset, useAssetStore } from './library'
import { ensureAssetUrl, releaseTexture } from './textures'
import { imageThumb } from './thumbs'

const SUPPORTED_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'avif'])

export interface TextureResizeProbe {
  id: string
  width: number
  height: number
  byteLength: number
  hasOriginal: boolean
  supported: boolean
}

export interface TextureResizeBatchResult {
  updated: number
  skipped: number
  failed: number
}

export function canResizeTextureFile(fileName: string): boolean {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  return SUPPORTED_EXT.has(ext)
}

function replaceExtensionWithPng(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? `${fileName.slice(0, dot)}.png` : `${fileName}.png`
}

export async function readCurrentBytes(asset: FileAsset): Promise<ArrayBuffer> {
  const cached = await readFileBytes(asset.id)
  if (cached) return cached
  const url = await ensureAssetUrl(asset.id)
  const response = await fetch(url)
  return response.arrayBuffer()
}

async function decodeDimensions(bytes: ArrayBuffer): Promise<{ width: number, height: number }> {
  const blob = new Blob([bytes])
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob, {
      imageOrientation: 'none',
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    })
    const size = { width: bitmap.width, height: bitmap.height }
    bitmap.close()
    return size
  }
  const url = URL.createObjectURL(blob)
  try {
    const img = await loadHtmlImage(url)
    return { width: img.naturalWidth || img.width, height: img.naturalHeight || img.height }
  } finally {
    URL.revokeObjectURL(url)
  }
}

function loadHtmlImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('无法解码贴图'))
    img.src = url
  })
}

let glSampler: {
  gl: WebGL2RenderingContext
  program: WebGLProgram
  vao: WebGLVertexArrayObject
  tex: WebGLTexture
  fbo: WebGLFramebuffer
  outTex: WebGLTexture
  uFlipX: WebGLUniformLocation | null
  uFlipY: WebGLUniformLocation | null
  uFlipNormalY: WebGLUniformLocation | null
} | null = null

function getGlSampler() {
  if (glSampler) return glSampler
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
  })
  if (!gl) throw new Error('无法创建 WebGL2 上下文')

  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    return shader
  }
  const vs = compile(gl.VERTEX_SHADER, `#version 300 es
    out vec2 vUv;
    void main() {
      vec2 p = vec2((gl_VertexID == 1) ? 3.0 : -1.0, (gl_VertexID == 2) ? 3.0 : -1.0);
      vUv = p * 0.5 + 0.5;
      gl_Position = vec4(p, 0.0, 1.0);
    }
  `)
  const fs = compile(gl.FRAGMENT_SHADER, `#version 300 es
    precision highp float;
    uniform sampler2D uTex;
    uniform int uFlipX;
    uniform int uFlipY;
    uniform int uFlipNormalY;
    in vec2 vUv;
    out vec4 fragColor;
    void main() {
      vec2 uv = vUv;
      if (uFlipX == 1) uv.x = 1.0 - uv.x;
      if (uFlipY == 1) uv.y = 1.0 - uv.y;
      vec4 c = texture(uTex, uv);
      if (uFlipNormalY == 1) c.g = 1.0 - c.g;
      fragColor = c;
    }
  `)
  const program = gl.createProgram()!
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  gl.deleteShader(vs)
  gl.deleteShader(fs)

  const vao = gl.createVertexArray()!
  const tex = gl.createTexture()!
  const outTex = gl.createTexture()!
  const fbo = gl.createFramebuffer()!
  const uFlipX = gl.getUniformLocation(program, 'uFlipX')
  const uFlipY = gl.getUniformLocation(program, 'uFlipY')
  const uFlipNormalY = gl.getUniformLocation(program, 'uFlipNormalY')

  glSampler = { gl, program, vao, tex, fbo, outTex, uFlipX, uFlipY, uFlipNormalY }
  return glSampler
}

/** 用 WebGL2 无预乘读出像素，避免 2D Canvas 把 A=0 区域的 RGB 清零导致发黑。 */
export function readUnpremultipliedRgba(
  source: TexImageSource,
  width: number,
  height: number,
  flipX = false,
  flipY = false,
  flipNormalY = false,
): Uint8Array {
  const { gl, program, vao, tex, fbo, outTex, uFlipX, uFlipY, uFlipNormalY } = getGlSampler()
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE)

  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)

  gl.bindTexture(gl.TEXTURE_2D, outTex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, outTex, 0)

  gl.viewport(0, 0, width, height)
  gl.disable(gl.BLEND)
  gl.useProgram(program)
  gl.uniform1i(uFlipX, flipX ? 1 : 0)
  gl.uniform1i(uFlipY, flipY ? 1 : 0)
  gl.uniform1i(uFlipNormalY, flipNormalY ? 1 : 0)
  gl.bindVertexArray(vao)
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.drawArrays(gl.TRIANGLES, 0, 3)

  const pixels = new Uint8Array(width * height * 4)
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  return pixels
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  out[4] = type.charCodeAt(0)
  out[5] = type.charCodeAt(1)
  out[6] = type.charCodeAt(2)
  out[7] = type.charCodeAt(3)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

async function encodeRgbaPng(rgba: Uint8Array, width: number, height: number): Promise<ArrayBuffer> {
  const stride = width * 4
  const raw = new Uint8Array((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1)
    raw[rowStart] = 0
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), rowStart + 1)
  }
  const compressed = new Uint8Array(
    await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer(),
  )
  const ihdr = new Uint8Array(13)
  const ihdrView = new DataView(ihdr.buffer)
  ihdrView.setUint32(0, width)
  ihdrView.setUint32(4, height)
  ihdr[8] = 8
  ihdr[9] = 6
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  const c1 = pngChunk('IHDR', ihdr)
  const c2 = pngChunk('IDAT', compressed)
  const c3 = pngChunk('IEND', new Uint8Array(0))
  const out = new Uint8Array(sig.length + c1.length + c2.length + c3.length)
  let offset = 0
  for (const part of [sig, c1, c2, c3]) {
    out.set(part, offset)
    offset += part.length
  }
  return out.buffer
}

export async function renderTextureToPng(
  bytes: ArrayBuffer,
  options: { width: number, height: number, flipX?: boolean, flipY?: boolean, flipNormalY?: boolean },
): Promise<ArrayBuffer> {
  const { width, height, flipX = false, flipY = false, flipNormalY = false } = options
  const blob = new Blob([bytes])
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob, {
      imageOrientation: 'none',
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
      resizeWidth: width,
      resizeHeight: height,
      resizeQuality: 'high',
    })
    try {
      const rgba = readUnpremultipliedRgba(bitmap, width, height, flipX, flipY, flipNormalY)
      return await encodeRgbaPng(rgba, width, height)
    } finally {
      bitmap.close()
    }
  }
  const url = URL.createObjectURL(blob)
  try {
    const img = await loadHtmlImage(url)
    const rgba = readUnpremultipliedRgba(img, width, height, flipX, flipY, flipNormalY)
    return await encodeRgbaPng(rgba, width, height)
  } finally {
    URL.revokeObjectURL(url)
  }
}

function resampleToPng(bytes: ArrayBuffer, targetWidth: number, targetHeight: number): Promise<ArrayBuffer> {
  return renderTextureToPng(bytes, { width: targetWidth, height: targetHeight })
}

export async function saveOverwrittenTexture(asset: FileAsset, pngBytes: ArrayBuffer): Promise<void> {
  const hasBackup = await hasOriginalTextureBackup(asset.id).catch(() => false)
  if (!hasBackup) {
    const raw = await readCurrentBytes(asset)
    await writeOriginalTextureBackup(asset.id, asset.fileName, raw)
  }
  await overwriteTextureAsset(asset, pngBytes, replaceExtensionWithPng(asset.fileName))
}

async function overwriteTextureAsset(asset: FileAsset, bytes: ArrayBuffer, nextFileName: string): Promise<void> {
  const previousUrl = asset.url
  const hash = await sha256(bytes)
  const url = URL.createObjectURL(new Blob([bytes]))
  const thumb = await imageThumb(url)
  releaseTexture(asset.id)
  useAssetStore.getState().patch(asset.id, {
    url,
    hash,
    thumb,
    fileName: nextFileName,
  })
  await rememberFile({
    id: asset.id,
    name: asset.name,
    kind: 'texture',
    fileName: nextFileName,
    hash,
    thumb,
    bytes,
  })
  if (previousUrl.startsWith('blob:')) URL.revokeObjectURL(previousUrl)
}

export async function probeTextureInfo(asset: FileAsset): Promise<TextureResizeProbe> {
  const supported = canResizeTextureFile(asset.fileName)
  const hasOriginal = await hasOriginalTextureBackup(asset.id).catch(() => false)
  if (!supported) {
    return { id: asset.id, width: 0, height: 0, byteLength: 0, hasOriginal, supported: false }
  }
  try {
    const bytes = await readCurrentBytes(asset)
    const { width, height } = await decodeDimensions(bytes)
    return { id: asset.id, width, height, byteLength: bytes.byteLength, hasOriginal, supported: true }
  } catch {
    return { id: asset.id, width: 0, height: 0, byteLength: 0, hasOriginal, supported: false }
  }
}

export async function resizeTextureAssets(
  assetIds: string[],
  maxSize: number,
  onProgress?: (done: number, total: number) => void,
): Promise<TextureResizeBatchResult> {
  let updated = 0
  let skipped = 0
  let failed = 0
  const total = assetIds.length

  for (let i = 0; i < total; i += 1) {
    const id = assetIds[i]
    const asset = useAssetStore.getState().assets[id]
    if (!asset || asset.kind !== 'texture' || !canResizeTextureFile(asset.fileName)) {
      skipped += 1
      onProgress?.(i + 1, total)
      continue
    }
    try {
      const backup = await readOriginalTextureBackup(id)
      const sourceBytes = backup ? backup.bytes : await readCurrentBytes(asset)
      const sourceFileName = backup ? backup.fileName : asset.fileName
      const { width, height } = await decodeDimensions(sourceBytes)
      const longest = Math.max(width, height)

      if (longest <= 0) {
        skipped += 1
      } else if (longest <= maxSize) {
        if (backup) {
          await overwriteTextureAsset(asset, sourceBytes, sourceFileName)
          await deleteOriginalTextureBackup(id)
          updated += 1
        } else {
          skipped += 1
        }
      } else {
        if (!backup) {
          await writeOriginalTextureBackup(id, asset.fileName, sourceBytes)
        }
        const scale = maxSize / longest
        const targetW = Math.max(1, Math.round(width * scale))
        const targetH = Math.max(1, Math.round(height * scale))
        const resizedBytes = await resampleToPng(sourceBytes, targetW, targetH)
        const nextFileName = replaceExtensionWithPng(sourceFileName)
        await overwriteTextureAsset(asset, resizedBytes, nextFileName)
        updated += 1
      }
    } catch (error) {
      console.warn('[textureResize] 调整失败', asset.name, error)
      failed += 1
    }
    onProgress?.(i + 1, total)
  }

  return { updated, skipped, failed }
}

export async function restoreTextureOriginals(
  assetIds: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<TextureResizeBatchResult> {
  let updated = 0
  let skipped = 0
  let failed = 0
  const total = assetIds.length

  for (let i = 0; i < total; i += 1) {
    const id = assetIds[i]
    const asset = useAssetStore.getState().assets[id]
    if (!asset || asset.kind !== 'texture') {
      skipped += 1
      onProgress?.(i + 1, total)
      continue
    }
    try {
      const backup = await readOriginalTextureBackup(id)
      if (!backup) {
        skipped += 1
      } else {
        await overwriteTextureAsset(asset, backup.bytes, backup.fileName)
        await deleteOriginalTextureBackup(id)
        updated += 1
      }
    } catch (error) {
      console.warn('[textureResize] 还原失败', asset.name, error)
      failed += 1
    }
    onProgress?.(i + 1, total)
  }

  return { updated, skipped, failed }
}
