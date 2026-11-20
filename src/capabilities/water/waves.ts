import type { WaterSpec } from './defaults'

export interface WaveDef {
  /** 波长 (m)。 */
  length: number
  /** 相对主风向的偏角 (度)。 */
  angle: number
  /** 占浪高的比例。 */
  weight: number
  /** 该波可占用的水平压缩份额（所有顶点波之和必须 < 1）。 */
  share: number
  phase: number
}

export const GRAVITY = 9.81
/** 浪尖圆角量 ε（见 profileOf）：越大浪尖越圆。0.03 对应浪尖两侧各约 0.35 弧度相位的圆弧。 */
export const CREST_ROUND = 0.03
/** 多道波很少同相叠加，整体补偿一点振幅，让「浪高」参数的观感与之前接近。 */
export const AMP_GAIN = 1.25
export const PINCH_GAIN = 2.2

/**
 * 位移顶点的长波。方向围绕主风向散开，越短的波散得越开。速度按深水色散 ω = √(g·k)。
 * 每两道为一对，共用一个起落包络（见 SWELL_GROUPS）。
 */
export const VERTEX_WAVES: WaveDef[] = [
  { length: 41, angle: -8, weight: 0.26, share: 0.09, phase: 0.0 },
  { length: 33, angle: 7, weight: 0.22, share: 0.10, phase: 1.7 },
  { length: 22, angle: -19, weight: 0.17, share: 0.12, phase: 4.1 },
  { length: 17, angle: 16, weight: 0.14, share: 0.13, phase: 2.9 },
  { length: 11, angle: -31, weight: 0.12, share: 0.14, phase: 5.3 },
  { length: 7.5, angle: 27, weight: 0.09, share: 0.14, phase: 0.8 },
]

/** 浪脊弯曲：相位扰动的最大幅度（弧度）与沿浪脊方向的周期（波长的倍数）。 */
export const BEND_PRIMARY = { amount: 1.3, amountSolo: 1.6, span: 3.1 }
export const BEND_SECONDARY = { amount: 0.7, span: 1.7, along: 0.25, waves: 4 }

/**
 * 浪尖卷曲（单道波的剖面形状）由两部分组成，共用一个参数：
 * LEAN_GAIN 是高度剖面的前倾系数；CURL_GAIN 是把浪峰上半部往前推的水平位移倍率（相对该波的聚拢量）。
 */
export const LEAN_GAIN = 0.4
export const CURL_GAIN = 1.3

/**
 * 浪群包络（每对顶点波一组）：一个个顺风移动的「能量团」，low/high 是团外/团内的振幅倍率。
 */
export const SWELL_GROUPS = [
  { offset: 0.0, low: 0.2, high: 1.4 },
  { offset: 2.1, low: 0.25, high: 1.35 },
  { offset: 4.4, low: 0.5, high: 1.2 },
]

/** 能量团顺风方向的间距（以波长计）。 */
export const PACKET_SPACING = 1.6
/** 能量团沿浪脊方向的尺度（以波长计）。 */
export const PACKET_WIDTH = 3.5
/** 浪峰相对能量团的超越速度（以浪峰速度计）。 */
export const PACKET_OVERTAKE = 0.65
/** 团的前后不对称（0 = 对称）。 */
export const PACKET_SKEW = 0.55

export function swellGroupInfo(group: number) {
  const a = VERTEX_WAVES[group * 2]
  const b = VERTEX_WAVES[group * 2 + 1] ?? a
  const length = (a.length + b.length) / 2
  const k = (Math.PI * 2) / length
  const speed = Math.sqrt(GRAVITY / k)
  return {
    crestSpeed: speed,
    overtake: speed * PACKET_OVERTAKE,
    kAlong: (Math.PI * 2) / (length * PACKET_SPACING),
    kAcross: (Math.PI * 2) / (length * PACKET_WIDTH),
  }
}

export const MID_WAVE_COUNT = 2
export const DETAIL_WAVES: WaveDef[] = [
  { length: 4.9, angle: -44, weight: 0.055, share: 0.04, phase: 3.6 },
  { length: 3.3, angle: 39, weight: 0.038, share: 0.04, phase: 1.1 },
  { length: 2.2, angle: -58, weight: 0.026, share: 0, phase: 5.9 },
  { length: 1.5, angle: 12, weight: 0.018, share: 0, phase: 2.4 },
]

const SWELL_INFOS = SWELL_GROUPS.map((_, g) => swellGroupInfo(g))

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/**
 * 在给定的静止水平坐标 (restX, restZ) 处计算波浪的位移 (dx, dy, dz) 与斜率 (slopeX, slopeZ)。
 * 与 waterMaterial.ts 的顶点/片元着色器使用完全相同的数学公式。
 */
function sampleAtRest(
  restX: number,
  restZ: number,
  spec: WaterSpec,
  waveTime: number,
  swellTime: number,
): { dx: number, dy: number, dz: number, slopeX: number, slopeZ: number } {
  if (spec.quality === 'fast' || spec.waveHeight <= 0.001) {
    return { dx: 0, dy: 0, dz: 0, slopeX: 0, slopeZ: 0 }
  }

  const rich = spec.quality === 'ultra'
  const flowRad = (spec.flowDirection * Math.PI) / 180
  const flowX = Math.cos(flowRad)
  const flowZ = Math.sin(flowRad)
  const flowOrthoX = -flowZ
  const flowOrthoZ = flowX

  const ridge = Math.max(0, Math.min(1, spec.crestSharpness))
  const crestPower = 1.0 - ridge * 0.5
  const crestRoundPow = Math.pow(CREST_ROUND, crestPower)
  const crestLift = ridge * 0.274
  const waveLean = spec.waveLean * LEAN_GAIN
  const waveCurl = spec.waveLean * CURL_GAIN

  // 3 组能量团包络
  const swells = SWELL_GROUPS.map((cfg, g) => {
    const info = SWELL_INFOS[g]
    const along = restX * flowX + restZ * flowZ - waveTime * info.crestSpeed + swellTime * info.overtake
    const across = restX * flowOrthoX + restZ * flowOrthoZ
    const stagger = Math.sin(across * info.kAcross + cfg.offset) * 1.5
      + Math.sin(across * info.kAcross * 0.43 - along * info.kAlong * 0.21 + cfg.offset * 2) * 1.0
    const psi = along * info.kAlong + stagger
    const pulse = smoothstep(-0.75, 0.75, Math.sin(psi - Math.sin(psi) * PACKET_SKEW))
    return mix(cfg.low, cfg.high, pulse)
  })

  const defs = rich ? [...VERTEX_WAVES, ...DETAIL_WAVES.slice(0, MID_WAVE_COUNT)] : VERTEX_WAVES
  let dx = 0
  let dy = 0
  let dz = 0
  let slopeX = 0
  let slopeZ = 0

  for (let i = 0; i < defs.length; i += 1) {
    const def = defs[i]
    const k = (Math.PI * 2) / def.length
    const amp = spec.waveHeight * def.weight * AMP_GAIN
    const pinch = Math.min(amp * PINCH_GAIN, def.share / k)
    const omega = Math.sqrt(GRAVITY * k)

    const rad = (def.angle * Math.PI) / 180
    const rc = Math.cos(rad)
    const rs = Math.sin(rad)
    const dirX = flowX * rc - flowZ * rs
    const dirZ = flowX * rs + flowZ * rc
    const perpX = -dirZ
    const perpZ = dirX

    const isMid = i >= VERTEX_WAVES.length
    const along = restX * dirX + restZ * dirZ
    const across = restX * perpX + restZ * perpZ

    let bendPhase = 0
    let gradAcross = 0
    let gradAlong = 0
    if (!isMid) {
      const q1 = k / BEND_PRIMARY.span
      const amount1 = spec.waveBend * (rich ? BEND_PRIMARY.amount : BEND_PRIMARY.amountSolo)
      const a1 = across * q1 + (i * 1.9 + 0.7) + waveTime * (0.11 + i * 0.013)
      bendPhase = Math.sin(a1) * amount1
      gradAcross = Math.cos(a1) * amount1 * q1
      if (rich && i < BEND_SECONDARY.waves) {
        const q2 = k / BEND_SECONDARY.span
        const amount2 = spec.waveBend * BEND_SECONDARY.amount
        const a2 = across * q2 + along * q2 * BEND_SECONDARY.along + (i * 2.7 + 1.3) - waveTime * (0.17 + i * 0.011)
        bendPhase += Math.sin(a2) * amount2
        const g2 = Math.cos(a2) * amount2 * q2
        gradAcross += g2
        gradAlong += g2 * BEND_SECONDARY.along
      }
    }

    const group = Math.min(SWELL_GROUPS.length - 1, Math.floor(i / 2))
    const mod = swells[group]
    const theta = along * k + def.phase + bendPhase - waveTime * omega
    const s = Math.sin(theta)
    const c = Math.cos(theta)

    const m = Math.max((1.0 - s) * 0.5, 0.0) + CREST_ROUND
    const w = Math.pow(m, crestPower - 1.0)
    const height = 1.0 + crestLift - (m * w - crestRoundPow) * 2.0 - s * c * waveLean
    const slope = c * w * crestPower - (c * c * 2.0 - 1.0) * waveLean

    dy += height * amp * mod

    const crestUp = Math.max(s, 0.0)
    const gather = c * spec.waveSteepness + crestUp * crestUp * waveCurl
    const horiz = gather * pinch * Math.min(mod, 1.1)
    dx += dirX * horiz
    dz += dirZ * horiz

    const gradX = dirX * (gradAlong + k) + perpX * gradAcross
    const gradZ = dirZ * (gradAlong + k) + perpZ * gradAcross
    const scaleSlope = slope * amp * mod
    slopeX += gradX * scaleSlope
    slopeZ += gradZ * scaleSlope
  }

  return { dx, dy, dz, slopeX, slopeZ }
}

/**
 * 给定世界坐标 (worldX, worldZ) 与水体参数，通过两次水平反推迭代求出与 Gerstner 视觉波面一致的水面高度偏移与法线。
 * 返回的 dy 是相对静止水面的竖直偏移 (m)。
 */
export function evaluateWaterWave(
  worldX: number,
  worldZ: number,
  spec: WaterSpec,
  waveTime: number,
  swellTime: number,
): { dy: number, normal: [number, number, number] } {
  if (spec.quality === 'fast' || spec.waveHeight <= 0.001) {
    return { dy: 0, normal: [0, 1, 0] }
  }
  const first = sampleAtRest(worldX, worldZ, spec, waveTime, swellTime)
  const second = sampleAtRest(worldX - first.dx, worldZ - first.dz, spec, waveTime, swellTime)
  const nx = -second.slopeX
  const ny = 1
  const nz = -second.slopeZ
  const invLen = 1 / Math.hypot(nx, ny, nz)
  return {
    dy: second.dy,
    normal: [nx * invLen, ny * invLen, nz * invLen],
  }
}
