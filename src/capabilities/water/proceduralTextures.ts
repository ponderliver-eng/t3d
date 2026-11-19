import { DataTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, RGBAFormat, UnsignedByteType } from 'three'

let cachedNormal: DataTexture | null = null
let cachedFoam: DataTexture | null = null
let cachedCaustics: DataTexture | null = null

function hash2(ix: number, iy: number, period: number): [number, number] {
  const px = ((ix % period) + period) % period
  const py = ((iy % period) + period) % period
  let h = (px * 374761393 + py * 668265263) | 0
  h = ((h ^ (h >> 13)) * 1274126177) | 0
  const angle = ((h >>> 0) / 4294967295) * Math.PI * 2
  return [Math.cos(angle), Math.sin(angle)]
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** 四边严格无缝的周期性 2D Gradient Noise */
function periodicPerlin(u: number, v: number, period: number): number {
  const x = u * period
  const y = v * period
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = x0 + 1
  const y1 = y0 + 1
  const fx = x - x0
  const fy = y - y0

  const [g00x, g00y] = hash2(x0, y0, period)
  const [g10x, g10y] = hash2(x1, y0, period)
  const [g01x, g01y] = hash2(x0, y1, period)
  const [g11x, g11y] = hash2(x1, y1, period)

  const d00 = g00x * fx + g00y * fy
  const d10 = g10x * (fx - 1) + g10y * fy
  const d01 = g01x * fx + g01y * (fy - 1)
  const d11 = g11x * (fx - 1) + g11y * (fy - 1)

  const ux = fade(fx)
  const uy = fade(fy)
  return lerp(lerp(d00, d10, ux), lerp(d01, d11, ux), uy)
}

function waterFbm(u: number, v: number): number {
  let sum = 0
  sum += periodicPerlin(u, v, 10) * 0.36
  sum += periodicPerlin(u + 0.37, v + 0.19, 20) * 0.30
  sum += periodicPerlin(u + 0.71, v + 0.53, 40) * 0.22
  sum += periodicPerlin(u + 0.13, v + 0.83, 80) * 0.12
  return sum
}

/** 生成 512x512 无缝细腻水波切线法线贴图。 */
export function defaultWaterNormalTexture(): DataTexture {
  if (cachedNormal) return cachedNormal
  const size = 512
  const heights = new Float32Array(size * size)
  for (let y = 0; y < size; y += 1) {
    const v = y / size
    for (let x = 0; x < size; x += 1) {
      heights[y * size + x] = waterFbm(x / size, v)
    }
  }
  const data = new Uint8Array(size * size * 4)
  const strength = 3.4
  for (let y = 0; y < size; y += 1) {
    const ym = (y - 1 + size) % size
    const yp = (y + 1) % size
    for (let x = 0; x < size; x += 1) {
      const xm = (x - 1 + size) % size
      const xp = (x + 1) % size
      const dx = (heights[y * size + xp]! - heights[y * size + xm]!) * strength
      const dy = (heights[yp * size + x]! - heights[ym * size + x]!) * strength
      const nx = -dx
      const ny = -dy
      const nz = 1
      const invLen = 1 / Math.hypot(nx, ny, nz)
      const o = (y * size + x) * 4
      data[o] = Math.round((nx * invLen * 0.5 + 0.5) * 255)
      data[o + 1] = Math.round((ny * invLen * 0.5 + 0.5) * 255)
      data[o + 2] = Math.round((nz * invLen * 0.5 + 0.5) * 255)
      data[o + 3] = 255
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType)
  texture.colorSpace = NoColorSpace
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.minFilter = LinearMipmapLinearFilter
  texture.magFilter = LinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true
  cachedNormal = texture
  return texture
}

/** 生成 256x256 无缝自然碎沫噪波贴图。 */
export function defaultWaterFoamTexture(): DataTexture {
  if (cachedFoam) return cachedFoam
  const size = 256
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    const v = y / size
    for (let x = 0; x < size; x += 1) {
      const u = x / size
      const n1 = periodicPerlin(u, v, 8) * 0.5 + 0.5
      const n2 = periodicPerlin(u + 0.41, v + 0.23, 16) * 0.5 + 0.5
      const n3 = periodicPerlin(u + 0.17, v + 0.67, 32) * 0.5 + 0.5
      const ridge = 1 - Math.abs(n1 * 2 - 1)
      const val = Math.min(1, Math.max(0, ridge * 0.45 + n2 * 0.35 + n3 * 0.25))
      const byte = Math.round(Math.pow(val, 1.4) * 255)
      const o = (y * size + x) * 4
      data[o] = byte
      data[o + 1] = byte
      data[o + 2] = byte
      data[o + 3] = 255
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType)
  texture.colorSpace = NoColorSpace
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.minFilter = LinearMipmapLinearFilter
  texture.magFilter = LinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true
  cachedFoam = texture
  return texture
}

/** 生成 256x256 无缝水底焦散光网纹理（Cellular Ridge）。 */
export function defaultWaterCausticsTexture(): DataTexture {
  if (cachedCaustics) return cachedCaustics
  const size = 256
  const period = 8
  const pts: Array<[number, number]> = []
  for (let gy = 0; gy < period; gy += 1) {
    for (let gx = 0; gx < period; gx += 1) {
      const [rx, ry] = hash2(gx, gy, period)
      pts.push([(gx + 0.5 + rx * 0.38) / period, (gy + 0.5 + ry * 0.38) / period])
    }
  }
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    const v = y / size
    for (let x = 0; x < size; x += 1) {
      const u = x / size
      const gx = Math.floor(u * period)
      const gy = Math.floor(v * period)
      let d1 = 9
      let d2 = 9
      for (let oy = -1; oy <= 1; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          const cx = ((gx + ox) % period + period) % period
          const cy = ((gy + oy) % period + period) % period
          const [px, py] = pts[cy * period + cx]!
          let dx = px - u
          let dy = py - v
          if (dx > 0.5) dx -= 1
          if (dx < -0.5) dx += 1
          if (dy > 0.5) dy -= 1
          if (dy < -0.5) dy += 1
          const d = Math.hypot(dx, dy) * period
          if (d < d1) {
            d2 = d1
            d1 = d
          } else if (d < d2) {
            d2 = d
          }
        }
      }
      const edge = Math.max(0, 1 - Math.abs(d2 - d1) * 4.5)
      const ridge = Math.pow(edge, 2.2)
      const byte = Math.min(255, Math.round(ridge * 255))
      const o = (y * size + x) * 4
      data[o] = byte
      data[o + 1] = byte
      data[o + 2] = byte
      data[o + 3] = 255
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType)
  texture.colorSpace = NoColorSpace
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.minFilter = LinearMipmapLinearFilter
  texture.magFilter = LinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true
  cachedCaustics = texture
  return texture
}
