import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RGBAFormat,
  RepeatWrapping,
  UnsignedByteType,
} from 'three'

let cachedCloudTexture: DataTexture | null = null

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/** Guerrilla Games / Horizon Zero Dawn 经典云密度重映射函数 */
function remap(value: number, oldMin: number, oldMax: number, newMin: number, newMax: number): number {
  const denom = oldMax - oldMin
  if (Math.abs(denom) < 1e-6) return newMin
  return clamp01((value - oldMin) / denom) * (newMax - newMin) + newMin
}

function hash2Grad(ix: number, iy: number, period: number, seed: number): [number, number] {
  const px = ((ix % period) + period) % period
  const py = ((iy % period) + period) % period
  let h = (px * 374761393 + py * 668265263 + seed * 1442695041) | 0
  h = ((h ^ (h >> 13)) * 1274126177) | 0
  const angle = ((h >>> 0) / 4294967295) * Math.PI * 2
  return [Math.cos(angle), Math.sin(angle)]
}

function hash2Point(ix: number, iy: number, period: number, seed: number): [number, number] {
  const px = ((ix % period) + period) % period
  const py = ((iy % period) + period) % period
  let h1 = (px * 374761393 + py * 668265263 + seed * 2654435761) | 0
  h1 = ((h1 ^ (h1 >> 13)) * 1274126177) | 0
  let h2 = (px * 1103515245 + py * 12345 + seed * 1664525) | 0
  h2 = ((h2 ^ (h2 >> 13)) * 1597334677) | 0
  return [
    0.12 + ((h1 >>> 0) / 4294967295) * 0.76,
    0.12 + ((h2 >>> 0) / 4294967295) * 0.76,
  ]
}

/** 严格四边无缝的周期性 2D Perlin 梯度噪声（返回值归一化到 [0, 1]） */
function periodicPerlin(u: number, v: number, period: number, seed: number): number {
  const x = u * period
  const y = v * period
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0

  const [g00x, g00y] = hash2Grad(x0, y0, period, seed)
  const [g10x, g10y] = hash2Grad(x0 + 1, y0, period, seed)
  const [g01x, g01y] = hash2Grad(x0, y0 + 1, period, seed)
  const [g11x, g11y] = hash2Grad(x0 + 1, y0 + 1, period, seed)

  const d00 = g00x * fx + g00y * fy
  const d10 = g10x * (fx - 1) + g10y * fy
  const d01 = g01x * fx + g01y * (fy - 1)
  const d11 = g11x * (fx - 1) + g11y * (fy - 1)

  const ux = fade(fx)
  const uy = fade(fy)
  const val = lerp(lerp(d00, d10, ux), lerp(d01, d11, ux), uy)
  return clamp01(val * 0.707 + 0.5)
}

/**
 * 严格四边无缝的周期性反转 Worley 胞状噪声（Inverted Cellular Noise）：
 * 返回 [0, 1]，中心饱满圆润如真实积云团簇，边缘自然收拢。
 */
function periodicInvertedWorley(u: number, v: number, period: number, seed: number): number {
  const x = u * period
  const y = v * period
  const cx = Math.floor(x)
  const cy = Math.floor(y)
  const fx = x - cx
  const fy = y - cy

  let minDistSq = 4.0
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const [px, py] = hash2Point(cx + dx, cy + dy, period, seed)
      const ox = dx + px - fx
      const oy = dy + py - fy
      const d2 = ox * ox + oy * oy
      if (d2 < minDistSq) minDistSq = d2
    }
  }
  const dist = Math.sqrt(minDistSq)
  return clamp01(1.0 - dist * 1.15)
}

function worleyFbm(u: number, v: number, basePeriod: number, seed: number): number {
  const w1 = periodicInvertedWorley(u, v, basePeriod, seed)
  const w2 = periodicInvertedWorley(u, v, basePeriod * 2, seed + 17)
  const w3 = periodicInvertedWorley(u, v, basePeriod * 4, seed + 37)
  return clamp01(w1 * 0.625 + w2 * 0.25 + w3 * 0.125)
}

function perlinFbm(u: number, v: number, basePeriod: number, seed: number): number {
  const p1 = periodicPerlin(u, v, basePeriod, seed)
  const p2 = periodicPerlin(u, v, basePeriod * 2, seed + 11)
  const p3 = periodicPerlin(u, v, basePeriod * 4, seed + 23)
  const p4 = periodicPerlin(u, v, basePeriod * 8, seed + 41)
  return clamp01(p1 * 0.52 + p2 * 0.26 + p3 * 0.14 + p4 * 0.08)
}

/**
 * 生成 256×256 四通道无缝 Perlin-Worley 体积云噪声贴图（Horizon Zero Dawn / Nubis 标准管线）：
 * - R 通道：基础 Perlin-Worley 积云团簇体（Macro Shape）
 * - G 通道：中频 3 级 Worley 胞状云朵隆起（Cauliflower Lobes）
 * - B 通道：高频 Worley 絮状边缘侵蚀细节（Fine Wispy Erosion）
 * - A 通道：第二层高度截面 Perlin-Worley（用于 3D 体积垂直步进形变）
 */
export function defaultCloudNoiseTexture(): DataTexture {
  if (cachedCloudTexture) return cachedCloudTexture
  const size = 256
  const data = new Uint8Array(size * size * 4)

  for (let y = 0; y < size; y += 1) {
    const v = y / size
    for (let x = 0; x < size; x += 1) {
      const u = x / size

      // 轻微旋涡流场扰动，让云团分布呈现自然气旋感而非死板网格
      const warpU = (periodicPerlin(u, v, 3, 101) - 0.5) * 0.08
      const warpV = (periodicPerlin(u, v, 3, 203) - 0.5) * 0.08
      const wu = u + warpU
      const wv = v + warpV

      // R: 宏大积云主体（Perlin FBM 被 Worley FBM 膨胀塑形）
      const basePerlin = perlinFbm(wu, wv, 4, 1)
      const baseWorley = worleyFbm(wu, wv, 5, 7)
      const perlinWorleyR = remap(basePerlin, -(1.0 - baseWorley), 1.0, 0.0, 1.0)

      // G: 中频棉絮团簇（周期 8 / 16 / 32 的 Worley FBM）
      const mediumWorleyG = worleyFbm(wu, wv, 8, 53)

      // B: 高频边缘碎云（周期 16 / 32 / 64 的 Worley FBM）
      const fineWorleyB = worleyFbm(u, v, 16, 97)

      // A: 上层高度截面 Perlin-Worley（偏移种子，使云体在垂直高度上真实变化）
      const topPerlin = perlinFbm(wu + 0.23, wv + 0.41, 4, 31)
      const topWorley = worleyFbm(wu + 0.23, wv + 0.41, 6, 73)
      const perlinWorleyA = remap(topPerlin, -(1.0 - topWorley), 1.0, 0.0, 1.0)

      const idx = (y * size + x) * 4
      data[idx + 0] = Math.round(clamp01(perlinWorleyR) * 255)
      data[idx + 1] = Math.round(clamp01(mediumWorleyG) * 255)
      data[idx + 2] = Math.round(clamp01(fineWorleyB) * 255)
      data[idx + 3] = Math.round(clamp01(perlinWorleyA) * 255)
    }
  }

  const tex = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType)
  tex.colorSpace = NoColorSpace
  tex.wrapS = RepeatWrapping
  tex.wrapT = RepeatWrapping
  tex.magFilter = LinearFilter
  tex.minFilter = LinearMipmapLinearFilter
  tex.generateMipmaps = true
  tex.needsUpdate = true
  cachedCloudTexture = tex
  return tex
}
