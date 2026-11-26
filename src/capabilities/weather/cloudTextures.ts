import {
  DataTexture,
  LinearFilter,
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

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

function hash2Grad2D(ix: number, iy: number, periodX: number, periodY: number, seed: number): [number, number] {
  const px = ((ix % periodX) + periodX) % periodX
  const py = ((iy % periodY) + periodY) % periodY
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
    0.15 + ((h1 >>> 0) / 4294967295) * 0.70,
    0.15 + ((h2 >>> 0) / 4294967295) * 0.70,
  ]
}

/** 严格四边无缝的双轴整数周期 2D Perlin 梯度噪声（返回值归一化到 [0, 1]） */
function periodicPerlin2D(u: number, v: number, periodX: number, periodY: number, seed: number): number {
  const x = u * periodX
  const y = v * periodY
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0

  const [g00x, g00y] = hash2Grad2D(x0, y0, periodX, periodY, seed)
  const [g10x, g10y] = hash2Grad2D(x0 + 1, y0, periodX, periodY, seed)
  const [g01x, g01y] = hash2Grad2D(x0, y0 + 1, periodX, periodY, seed)
  const [g11x, g11y] = hash2Grad2D(x0 + 1, y0 + 1, periodX, periodY, seed)

  const d00 = g00x * fx + g00y * fy
  const d10 = g10x * (fx - 1) + g10y * fy
  const d01 = g01x * fx + g01y * (fy - 1)
  const d11 = g11x * (fx - 1) + g11y * (fy - 1)

  const ux = fade(fx)
  const uy = fade(fy)
  const val = lerp(lerp(d00, d10, ux), lerp(d01, d11, ux), uy)
  return clamp01(val * 0.72 + 0.5)
}

/** 严格四边无缝的周期性 2D Perlin 梯度噪声（返回值归一化到 [0, 1]） */
function periodicPerlin(u: number, v: number, period: number, seed: number): number {
  return periodicPerlin2D(u, v, period, period, seed)
}

/** 严格四边无缝的周期性圆润云包（使用平滑余弦拱形代替 |x| 折角，彻底消除长直折痕线） */
function periodicBillow(u: number, v: number, period: number, seed: number): number {
  const p = periodicPerlin(u, v, period, seed)
  const centered = (p - 0.5) * 2.0
  const smoothArch = 1.0 - centered * centered
  return smoothstep(0.05, 0.98, smoothArch)
}

/** 大尺度柔和 Worley 团簇（仅用于低频花椰菜圆顶膨胀，绝不用作高频打孔） */
function periodicSoftWorley(u: number, v: number, period: number, seed: number): number {
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
  return smoothstep(0.95, 0.0, dist)
}

function macroContinentFbm(u: number, v: number, seed: number): number {
  const p1 = periodicPerlin(u, v, 2, seed)
  const p2 = periodicPerlin(u, v, 4, seed + 13)
  const p3 = periodicPerlin(u, v, 8, seed + 29)
  const b1 = periodicBillow(u, v, 2, seed + 47)
  const w1 = periodicSoftWorley(u, v, 3, seed + 61)
  const fbm = p1 * 0.50 + p2 * 0.25 + p3 * 0.10 + b1 * 0.15
  // 将大尺度连续 FBM 与柔和云包融合，形成大片连绵、厚实饱满的积云大陆底图
  return clamp01(fbm * 0.78 + w1 * 0.22)
}

function cauliflowerLobeFbm(u: number, v: number, seed: number): number {
  const b1 = periodicBillow(u, v, 3, seed)
  const b2 = periodicBillow(u, v, 6, seed + 19)
  const w1 = periodicSoftWorley(u, v, 4, seed + 37)
  const p1 = periodicPerlin(u, v, 6, seed + 53)
  return clamp01(b1 * 0.40 + w1 * 0.30 + b2 * 0.18 + p1 * 0.12)
}

function turbulentFluffFbm(u: number, v: number, seed: number): number {
  const wx = (periodicPerlin(u, v, 4, seed + 101) - 0.5) * 0.12
  const wy = (periodicPerlin(u, v, 4, seed + 211) - 0.5) * 0.12
  const p1 = periodicPerlin(u + wx, v + wy, 4, seed)
  const p2 = periodicPerlin(u + wx, v + wy, 8, seed + 17)
  const b1 = periodicBillow(u + wx, v + wy, 6, seed + 31)
  const p3 = periodicPerlin(u, v, 12, seed + 43)
  return clamp01(p1 * 0.42 + b1 * 0.28 + p2 * 0.20 + p3 * 0.10)
}

function cirrusStreakFlow(u: number, v: number, seed: number): number {
  // 各向异性双级旋流扭曲，严格使用整数周期 periodX / periodY，100% 消除贴图接缝边线与折痕
  const flowU1 = (periodicPerlin2D(u, v, 2, 2, seed + 7) - 0.5) * 0.24
  const flowV1 = (periodicPerlin2D(u, v, 2, 2, seed + 19) - 0.5) * 0.16
  const flowU2 = (periodicPerlin2D(u + flowU1, v + flowV1, 4, 4, seed + 23) - 0.5) * 0.10
  const flowV2 = (periodicPerlin2D(u + flowU1, v + flowV1, 4, 4, seed + 29) - 0.5) * 0.08
  const su = u + flowU1 + flowU2
  const sv = v + flowV1 + flowV2

  // 严格整数双轴周期（periodX, periodY 均为整数），确保 u=0/1 与 v=0/1 处导数与数值完全连续无边线
  const f1 = periodicPerlin2D(su, sv, 2, 5, seed + 31)
  const f2 = periodicPerlin2D(su, sv, 3, 8, seed + 47)
  const f3 = periodicPerlin2D(su, sv, 5, 12, seed + 73)
  const env = periodicPerlin2D(u + flowU1 * 0.5, v + flowV1 * 0.5, 2, 3, seed + 97)
  const wisps = smoothstep(0.28, 0.86, f1 * 0.46 + f2 * 0.34 + f3 * 0.20)
  return clamp01(wisps * smoothstep(0.24, 0.80, env))
}

/**
 * 生成 256×256 四通道无缝 UDS 风格大气云与沙尘暴体积贴图：
 * - R 通道：大尺度连续积云大陆底图（Macro Cloud Continent，连绵饱满无碎点）
 * - G 通道：中尺度花椰菜圆润云包隆起（Cauliflower Cumulus Lobes）
 * - B 通道：域扭曲絮状边缘与沙尘暴翻滚尘团纹理（Turbulent Fluff & Dust Billow）
 * - A 通道：各向异性旋流纤维高空卷云场（Anisotropic Cirrus Ice Wisps）
 */
export function defaultCloudNoiseTexture(): DataTexture {
  if (cachedCloudTexture) return cachedCloudTexture
  const size = 256
  const data = new Uint8Array(size * size * 4)

  for (let y = 0; y < size; y += 1) {
    const v = y / size
    for (let x = 0; x < size; x += 1) {
      const u = x / size

      // 大尺度气旋流场扭曲，赋予云系自然的气象流线感
      const warpU = (periodicPerlin(u, v, 2, 101) - 0.5) * 0.11
      const warpV = (periodicPerlin(u, v, 2, 203) - 0.5) * 0.11
      const wu = u + warpU
      const wv = v + warpV

      const rMacro = macroContinentFbm(wu, wv, 11)
      const gLobes = cauliflowerLobeFbm(wu, wv, 53)
      const bFluff = turbulentFluffFbm(u, v, 89)
      const aCirrus = cirrusStreakFlow(u, v, 137)

      const idx = (y * size + x) * 4
      data[idx + 0] = Math.round(clamp01(rMacro) * 255)
      data[idx + 1] = Math.round(clamp01(gLobes) * 255)
      data[idx + 2] = Math.round(clamp01(bFluff) * 255)
      data[idx + 3] = Math.round(clamp01(aCirrus) * 255)
    }
  }

  const tex = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType)
  tex.colorSpace = NoColorSpace
  tex.wrapS = RepeatWrapping
  tex.wrapT = RepeatWrapping
  tex.magFilter = LinearFilter
  tex.minFilter = LinearFilter
  tex.generateMipmaps = false
  tex.needsUpdate = true
  cachedCloudTexture = tex
  return tex
}
