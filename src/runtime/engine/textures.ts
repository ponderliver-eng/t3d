import { DataTexture, NoColorSpace, RepeatWrapping, RGBAFormat, SRGBColorSpace, Texture, TextureLoader, UnsignedByteType } from 'three'

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
  const vs = compile(
    gl.VERTEX_SHADER,
    `#version 300 es
    out vec2 vUv;
    void main() {
      vec2 p = vec2((gl_VertexID == 1) ? 3.0 : -1.0, (gl_VertexID == 2) ? 3.0 : -1.0);
      vUv = p * 0.5 + 0.5;
      gl_Position = vec4(p, 0.0, 1.0);
    }
  `,
  )
  const fs = compile(
    gl.FRAGMENT_SHADER,
    `#version 300 es
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
  `,
  )
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

/**
 * 用 WebGL2 无预乘（`UNPACK_PREMULTIPLY_ALPHA_WEBGL = false`）读出像素，
 * 避免 2D Canvas 把 A=0（完全粗糙 / 带 Alpha 遮罩）区域的 RGB 清零导致整张贴图发黑。
 */
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

/**
 * 将 Unity Standard / URP MaskMap 无损重排为 Three.js ORM DataTexture：
 * - 输入：R = Metallic，G = AO，A = Smoothness（1 - Roughness）
 * - 输出：R = AO（G 若全 0 则填 255 避免全黑死阴影），G = Roughness（255 - A），B = Metallic（R）
 */
export function buildUnityMetallicRoughnessTexture(base: Texture): Texture {
  const image = base.image as { data?: Uint8Array; width?: number; height?: number; naturalWidth?: number; naturalHeight?: number } | undefined
  const w = image?.naturalWidth || image?.width || 0
  const h = image?.naturalHeight || image?.height || 0
  if (!image || w <= 0 || h <= 0) return base

  try {
    const src = image.data instanceof Uint8Array
      ? image.data
      : readUnpremultipliedRgba(image as TexImageSource, w, h)
    const rgba = new Uint8Array(src.length)
    let hasAlpha = false
    const firstA = src[3] ?? 255
    for (let i = 3; i < src.length; i += 4) {
      if (Math.abs((src[i] ?? 255) - firstA) > 2) {
        hasAlpha = true
        break
      }
    }
    const useA = hasAlpha || firstA < 250
    for (let i = 0; i < src.length; i += 4) {
      const r = src[i]!
      const g = src[i + 1]!
      const a = src[i + 3]!
      rgba[i] = g > 0 ? g : 255
      rgba[i + 1] = 255 - (useA ? a : r)
      rgba[i + 2] = r
      rgba[i + 3] = 255
    }
    const tex = new DataTexture(rgba, w, h, RGBAFormat, UnsignedByteType)
    tex.colorSpace = NoColorSpace
    tex.flipY = base.flipY
    tex.wrapS = base.wrapS
    tex.wrapT = base.wrapT
    tex.generateMipmaps = true
    tex.needsUpdate = true
    return tex
  } catch {
    return base
  }
}

const fallbackLoader = new TextureLoader()
const MAX_TEXTURE_SIZE = 2048

/**
 * 统一的无损贴图加载器（`premultiplyAlpha: 'none'`, `colorSpaceConversion: 'none'`, `flipY = false`）：
 * 防止 `<img />` / 2D Canvas 预乘 Alpha 把 A=0 像素的 RGB 抹成 0。
 */
export async function loadUnpremultipliedTexture(url: string, maxDimLimit = MAX_TEXTURE_SIZE): Promise<Texture> {
  if (typeof createImageBitmap === 'function') {
    try {
      const response = await fetch(url)
      const blob = await response.blob()
      const probe = await createImageBitmap(blob, {
        imageOrientation: 'none',
        premultiplyAlpha: 'none',
        colorSpaceConversion: 'none',
      })
      let bitmap = probe
      const maxDim = Math.max(probe.width, probe.height)
      if (maxDimLimit > 0 && maxDim > maxDimLimit) {
        const scale = maxDimLimit / maxDim
        const targetW = Math.max(1, Math.round(probe.width * scale))
        const targetH = Math.max(1, Math.round(probe.height * scale))
        probe.close()
        bitmap = await createImageBitmap(blob, {
          imageOrientation: 'none',
          premultiplyAlpha: 'none',
          colorSpaceConversion: 'none',
          resizeWidth: targetW,
          resizeHeight: targetH,
          resizeQuality: 'high',
        })
      }
      const texture = new Texture(bitmap)
      texture.colorSpace = SRGBColorSpace
      texture.flipY = false
      texture.wrapS = RepeatWrapping
      texture.wrapT = RepeatWrapping
      texture.needsUpdate = true
      return texture
    } catch {
      // 回退到 TextureLoader
    }
  }
  const texture = await fallbackLoader.loadAsync(url)
  texture.colorSpace = SRGBColorSpace
  texture.flipY = false
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.needsUpdate = true
  return texture
}
