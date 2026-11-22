export interface MotionVec3 {
  x: number
  y: number
  z: number
}

export type EasingName =
  | 'linear'
  | 'inQuad'
  | 'outQuad'
  | 'inOutQuad'
  | 'inCubic'
  | 'outCubic'
  | 'inOutCubic'
  | 'inOutSine'
  | 'outBack'
  | 'inOutBack'
  | 'outBounce'
  | 'outElastic'

export type CurveKeyInput =
  | readonly [number, number]
  | { t: number; v: number; mode?: 'linear' | 'smooth' | 'step' }

export interface NormalizedCurveKey {
  t: number
  v: number
  mode: 'linear' | 'smooth' | 'step'
}

export interface AnimationCurve {
  eval(t: number): number
  readonly keys: readonly NormalizedCurveKey[]
}

export interface SplinePath {
  readonly length: number
  readonly points: readonly MotionVec3[]
  readonly closed: boolean
  pointAt(t: number): MotionVec3
  tangentAt(t: number): MotionVec3
  pointAtDistance(distance: number): MotionVec3
  tangentAtDistance(distance: number): MotionVec3
}

export function evalEasing(name: EasingName | undefined, rawT: number): number {
  const t = Math.max(0, Math.min(1, Number.isFinite(rawT) ? rawT : 0))
  switch (name) {
    case 'inQuad':
      return t * t
    case 'outQuad':
      return 1 - (1 - t) * (1 - t)
    case 'inOutQuad':
      return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
    case 'inCubic':
      return t * t * t
    case 'outCubic':
      return 1 - Math.pow(1 - t, 3)
    case 'inOutCubic':
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
    case 'inOutSine':
      return -(Math.cos(Math.PI * t) - 1) / 2
    case 'outBack': {
      const c1 = 1.70158
      const c3 = c1 + 1
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
    }
    case 'inOutBack': {
      const c1 = 1.70158
      const c2 = c1 * 1.525
      return t < 0.5
        ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2
        : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2
    }
    case 'outBounce': {
      const n1 = 7.5625
      const d1 = 2.75
      if (t < 1 / d1) return n1 * t * t
      if (t < 2 / d1) {
        const u = t - 1.5 / d1
        return n1 * u * u + 0.75
      }
      if (t < 2.5 / d1) {
        const u = t - 2.25 / d1
        return n1 * u * u + 0.9375
      }
      const u = t - 2.625 / d1
      return n1 * u * u + 0.984375
    }
    case 'outElastic': {
      if (t === 0 || t === 1) return t
      const c4 = (2 * Math.PI) / 3
      return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1
    }
    case 'linear':
    default:
      return t
  }
}

export function normalizeCurveKeys(rawKeys: readonly CurveKeyInput[]): NormalizedCurveKey[] {
  const out: NormalizedCurveKey[] = []
  for (const k of rawKeys) {
    if (Array.isArray(k)) {
      const t = Number(k[0])
      const v = Number(k[1])
      if (Number.isFinite(t) && Number.isFinite(v)) {
        out.push({ t, v, mode: 'smooth' })
      }
    } else if (k && typeof k === 'object') {
      const obj = k as { t?: unknown; v?: unknown; mode?: unknown }
      const t = Number(obj.t)
      const v = Number(obj.v)
      const mode = obj.mode === 'linear' || obj.mode === 'step' ? obj.mode : 'smooth'
      if (Number.isFinite(t) && Number.isFinite(v)) {
        out.push({ t, v, mode })
      }
    }
  }
  out.sort((a, b) => a.t - b.t)
  return out
}

export function evalCurveKeys(
  keys: readonly NormalizedCurveKey[],
  rawT: number,
  wrapMode: 'clamp' | 'loop' | 'pingPong' = 'clamp',
): number {
  if (keys.length === 0) return 0
  if (keys.length === 1) return keys[0].v

  const minT = keys[0].t
  const maxT = keys[keys.length - 1].t
  const span = maxT - minT
  let t = Number.isFinite(rawT) ? rawT : minT

  if (span > 1e-6) {
    if (wrapMode === 'loop') {
      const offset = (((t - minT) % span) + span) % span
      t = minT + offset
    } else if (wrapMode === 'pingPong') {
      const cycle = span * 2
      const offset = (((t - minT) % cycle) + cycle) % cycle
      t = offset <= span ? minT + offset : maxT - (offset - span)
    } else {
      t = Math.max(minT, Math.min(maxT, t))
    }
  } else {
    return keys[0].v
  }

  for (let i = 0; i < keys.length - 1; i += 1) {
    const a = keys[i]
    const b = keys[i + 1]
    if (t <= b.t || i === keys.length - 2) {
      const segLen = b.t - a.t
      if (segLen <= 1e-6) return b.v
      const u = Math.max(0, Math.min(1, (t - a.t) / segLen))
      if (a.mode === 'step') return a.v
      if (a.mode === 'linear') return a.v + (b.v - a.v) * u
      // smooth Hermite (SmoothStep)
      const s = u * u * (3 - 2 * u)
      return a.v + (b.v - a.v) * s
    }
  }
  return keys[keys.length - 1].v
}

export function createAnimationCurve(
  rawKeys: readonly CurveKeyInput[],
  options?: { wrap?: 'clamp' | 'loop' | 'pingPong' },
): AnimationCurve {
  const keys = normalizeCurveKeys(rawKeys)
  const wrap = options?.wrap ?? 'clamp'
  return {
    keys,
    eval: (t: number) => evalCurveKeys(keys, t, wrap),
  }
}

function catmullRomValue(p0: number, p1: number, p2: number, p3: number, t: number, tension: number): number {
  const t2 = t * t
  const t3 = t2 * t
  const m1 = tension * (p2 - p0)
  const m2 = tension * (p3 - p1)
  const a = 2 * p1 - 2 * p2 + m1 + m2
  const b = -3 * p1 + 3 * p2 - 2 * m1 - m2
  return a * t3 + b * t2 + m1 * t + p1
}

export function createSplinePath(
  rawPoints: readonly MotionVec3[],
  options?: { closed?: boolean; tension?: number; samplesPerSegment?: number },
): SplinePath {
  const points = rawPoints.map((p) => ({ x: p.x, y: p.y, z: p.z }))
  const closed = Boolean(options?.closed)
  const tension = Number.isFinite(options?.tension) ? Number(options?.tension) : 0.5
  const samplesPerSegment = Math.max(4, Math.min(64, Math.floor(options?.samplesPerSegment ?? 16)))

  if (points.length === 0) {
    const zero = { x: 0, y: 0, z: 0 }
    return {
      length: 0,
      points,
      closed,
      pointAt: () => ({ ...zero }),
      tangentAt: () => ({ x: 0, y: 0, z: 1 }),
      pointAtDistance: () => ({ ...zero }),
      tangentAtDistance: () => ({ x: 0, y: 0, z: 1 }),
    }
  }

  if (points.length === 1) {
    const only = points[0]
    return {
      length: 0,
      points,
      closed,
      pointAt: () => ({ ...only }),
      tangentAt: () => ({ x: 0, y: 0, z: 1 }),
      pointAtDistance: () => ({ ...only }),
      tangentAtDistance: () => ({ x: 0, y: 0, z: 1 }),
    }
  }

  const segCount = closed ? points.length : points.length - 1
  const getCtrl = (idx: number): MotionVec3 => {
    if (closed) {
      const wrapped = ((idx % points.length) + points.length) % points.length
      return points[wrapped]
    }
    const clamped = Math.max(0, Math.min(points.length - 1, idx))
    return points[clamped]
  }

  const rawPointAt = (uRaw: number): MotionVec3 => {
    const u = closed ? (((uRaw % 1) + 1) % 1) : Math.max(0, Math.min(1, uRaw))
    const scaled = u * segCount
    const segIdx = Math.min(segCount - 1, Math.floor(scaled))
    const localT = scaled - segIdx
    const p0 = getCtrl(segIdx - 1)
    const p1 = getCtrl(segIdx)
    const p2 = getCtrl(segIdx + 1)
    const p3 = getCtrl(segIdx + 2)
    return {
      x: catmullRomValue(p0.x, p1.x, p2.x, p3.x, localT, tension),
      y: catmullRomValue(p0.y, p1.y, p2.y, p3.y, localT, tension),
      z: catmullRomValue(p0.z, p1.z, p2.z, p3.z, localT, tension),
    }
  }

  // 构建弧长查表 LUT，保证匀速前进
  const totalSamples = segCount * samplesPerSegment
  const lutU: number[] = [0]
  const lutDist: number[] = [0]
  let acc = 0
  let prev = rawPointAt(0)
  for (let i = 1; i <= totalSamples; i += 1) {
    const u = i / totalSamples
    const cur = rawPointAt(u)
    acc += Math.hypot(cur.x - prev.x, cur.y - prev.y, cur.z - prev.z)
    lutU.push(u)
    lutDist.push(acc)
    prev = cur
  }
  const totalLength = acc

  const distanceToU = (distRaw: number): number => {
    if (totalLength <= 1e-6) return 0
    const d = closed
      ? (((distRaw % totalLength) + totalLength) % totalLength)
      : Math.max(0, Math.min(totalLength, distRaw))
    let lo = 0
    let hi = lutDist.length - 1
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1
      if (lutDist[mid] <= d) lo = mid
      else hi = mid
    }
    const d0 = lutDist[lo]
    const d1 = lutDist[hi]
    const ratio = d1 > d0 + 1e-6 ? (d - d0) / (d1 - d0) : 0
    return lutU[lo] + (lutU[hi] - lutU[lo]) * ratio
  }

  const tangentFromU = (u: number): MotionVec3 => {
    const eps = 1 / Math.max(100, totalSamples * 2)
    const a = rawPointAt(u - eps)
    const b = rawPointAt(u + eps)
    const dx = b.x - a.x
    const dy = b.y - a.y
    const dz = b.z - a.z
    const len = Math.hypot(dx, dy, dz)
    if (len <= 1e-6) return { x: 0, y: 0, z: 1 }
    return { x: dx / len, y: dy / len, z: dz / len }
  }

  return {
    length: totalLength,
    points,
    closed,
    pointAt: (t: number) => rawPointAt(distanceToU((closed ? (((t % 1) + 1) % 1) : Math.max(0, Math.min(1, t))) * totalLength)),
    tangentAt: (t: number) => tangentFromU(distanceToU((closed ? (((t % 1) + 1) % 1) : Math.max(0, Math.min(1, t))) * totalLength)),
    pointAtDistance: (distance: number) => rawPointAt(distanceToU(distance)),
    tangentAtDistance: (distance: number) => tangentFromU(distanceToU(distance)),
  }
}
