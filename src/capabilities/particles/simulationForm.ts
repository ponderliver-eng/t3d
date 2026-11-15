/** 把单个 Quarks 粒子系统上能用数字和开关表达的字段读出来、写回去。曲线原样保留。 */

export interface SystemView {
  looping: boolean
  prewarm: boolean
  duration: number
  worldSpace: boolean
  renderMode: number
  rateMin: number
  rateMax: number
  rateCurve: boolean
  burst: number
  burstLocked: boolean
  lifeMin: number
  lifeMax: number
  lifeCurve: boolean
  speedMin: number
  speedMax: number
  speedCurve: boolean
  sizeMin: number
  sizeMax: number
  sizeCurve: boolean
  rotationDeg: number
  rotationCurve: boolean
  color: string
  colorAlpha: number
  colorCurve: boolean
  shape: string
  radius: number
  angleDeg: number
  arcDeg: number
  thickness: number
  width: number
  height: number
  tilesX: number
  tilesY: number
  /** 沿 Y 轴的加速度。负值向下。斜向的力不在这里改。 */
  gravity: number
  gravityLocked: boolean
  speedFactor: number
  lengthFactor: number
  trailLength: number
  modules: string[]
}

export interface SystemSlot {
  label: string
  path: Array<string | number>
}

const SHAPES = ['point', 'cone', 'sphere', 'hemisphere', 'circle', 'donut', 'rectangle'] as const

export function isKnownShape(type: string): boolean {
  return (SHAPES as readonly string[]).includes(type)
}

export function systemSlots(simulation: unknown): SystemSlot[] {
  if (!simulation || typeof simulation !== 'object') return []
  const root = simulation as { format?: string, body?: unknown }
  if (root.format === 'system' && root.body && typeof root.body === 'object') {
    return [{ label: '', path: ['body'] }]
  }
  if (root.format === 'loader' && root.body && typeof root.body === 'object') {
    const slots: SystemSlot[] = []
    const record = root.body as { object?: unknown }
    walk(record.object, ['body', 'object'], slots)
    return slots
  }
  return []
}

export function readSystem(simulation: unknown, path: Array<string | number>): SystemView | null {
  const body = at(simulation, path)
  if (!body || typeof body !== 'object') return null
  const record = body as Record<string, unknown>
  const life = readRange(record.startLife)
  const speed = readRange(record.startSpeed)
  const size = readRange(record.startSize)
  const rotation = readRange(record.startRotation)
  const rate = readRange(record.emissionOverTime)
  const color = readColor(record.startColor)
  const shape = record.shape && typeof record.shape === 'object' ? record.shape as Record<string, unknown> : {}
  const bursts = Array.isArray(record.emissionBursts) ? record.emissionBursts : []
  const behaviors = behaviorList(record.behaviors)
  return {
    looping: record.looping !== false,
    prewarm: record.prewarm === true,
    duration: num(record.duration, 1),
    worldSpace: record.worldSpace === true,
    renderMode: num(record.renderMode, 0),
    rateMin: rate.min,
    rateMax: rate.max,
    rateCurve: rate.curve,
    burst: bursts.length === 1 ? readRange((bursts[0] as { count?: unknown }).count).min : 0,
    burstLocked: bursts.length > 1,
    lifeMin: life.min,
    lifeMax: life.max,
    lifeCurve: life.curve,
    speedMin: speed.min,
    speedMax: speed.max,
    speedCurve: speed.curve,
    sizeMin: size.min,
    sizeMax: size.max,
    sizeCurve: size.curve,
    rotationDeg: rotation.curve ? 0 : rotation.min * 180 / Math.PI,
    rotationCurve: rotation.curve,
    color: color.hex,
    colorAlpha: color.alpha,
    colorCurve: color.curve,
    shape: typeof shape.type === 'string' ? shape.type : 'point',
    radius: num(shape.radius, 0),
    angleDeg: num(shape.angle, 0) * 180 / Math.PI,
    arcDeg: num(shape.arc, Math.PI * 2) * 180 / Math.PI,
    thickness: num(shape.thickness, 1),
    width: num(shape.width, 1),
    height: num(shape.height, 1),
    tilesX: num(record.uTileCount, 1),
    tilesY: num(record.vTileCount, 1),
    gravity: readGravity(behaviors).value,
    gravityLocked: readGravity(behaviors).locked,
    speedFactor: num(settingsOf(record).speedFactor, 0.1),
    lengthFactor: num(settingsOf(record).lengthFactor, 0),
    trailLength: trailSamples(settingsOf(record)),
    modules: behaviors.map(item => typeof item.type === 'string' ? item.type : '').filter(type => type && type !== 'ApplyForce'),
  }
}

export function writeSystem(simulation: unknown, path: Array<string | number>, view: SystemView): unknown {
  const current = at(simulation, path)
  if (!current || typeof current !== 'object' || !simulation || typeof simulation !== 'object') return simulation
  const body = { ...(current as Record<string, unknown>) }
  body.looping = view.looping
  body.prewarm = view.prewarm
  body.duration = view.duration
  body.worldSpace = view.worldSpace
  body.renderMode = view.renderMode
  body.uTileCount = Math.max(1, Math.round(view.tilesX))
  body.vTileCount = Math.max(1, Math.round(view.tilesY))
  body.rendererEmitterSettings = rendererSettings(view, body.rendererEmitterSettings)
  if (!view.rateCurve) body.emissionOverTime = writeRange(view.rateMin, view.rateMax)
  if (!view.lifeCurve) body.startLife = writeRange(view.lifeMin, view.lifeMax)
  if (!view.speedCurve) body.startSpeed = writeRange(view.speedMin, view.speedMax)
  if (!view.sizeCurve) body.startSize = writeRange(view.sizeMin, view.sizeMax)
  if (!view.rotationCurve) body.startRotation = { type: 'ConstantValue', value: view.rotationDeg * Math.PI / 180 }
  if (!view.colorCurve) body.startColor = writeColor(view.color, view.colorAlpha)
  body.shape = writeShape(body.shape, view)
  const behaviors = Array.isArray(body.behaviors) ? body.behaviors as Record<string, unknown>[] : []
  if (!view.gravityLocked) body.behaviors = writeGravity(behaviors, view.gravity)
  if (!view.burstLocked) {
    const existing = Array.isArray(body.emissionBursts) ? body.emissionBursts[0] as Record<string, unknown> | undefined : undefined
    body.emissionBursts = view.burst > 0
      ? [{
        time: num(existing?.time, 0),
        count: { type: 'ConstantValue', value: view.burst },
        cycle: num(existing?.cycle, 1),
        interval: num(existing?.interval, 0.1),
        probability: num(existing?.probability, 1),
      }]
      : []
  }
  return setAt(simulation, path, body)
}

function walk(node: unknown, path: Array<string | number>, out: SystemSlot[]) {
  if (!node || typeof node !== 'object') return
  const record = node as Record<string, unknown>
  if (record.ps && typeof record.ps === 'object') {
    const name = typeof record.name === 'string' && record.name ? record.name : ''
    out.push({ label: name || `发射器 ${out.length + 1}`, path: [...path, 'ps'] })
  }
  if (Array.isArray(record.children)) {
    record.children.forEach((child, index) => walk(child, [...path, 'children', index], out))
  }
}

function at(root: unknown, path: Array<string | number>): unknown {
  let cursor = root
  for (const key of path) {
    if (!cursor || typeof cursor !== 'object') return null
    cursor = (cursor as Record<string | number, unknown>)[key]
  }
  return cursor
}

function setAt(root: unknown, path: Array<string | number>, value: unknown): unknown {
  const clone = structuredClone(root) as Record<string | number, unknown>
  let cursor: Record<string | number, unknown> = clone
  for (let index = 0; index < path.length - 1; index += 1) {
    const key = path[index]
    const next = cursor[key]
    if (!next || typeof next !== 'object') return root
    cursor = next as Record<string | number, unknown>
  }
  cursor[path[path.length - 1]] = value
  return clone
}

function readRange(value: unknown): { min: number, max: number, curve: boolean } {
  if (!value || typeof value !== 'object') return { min: 0, max: 0, curve: false }
  const record = value as { type?: string, value?: number, a?: number, b?: number }
  if (record.type === 'ConstantValue' && typeof record.value === 'number') return { min: record.value, max: record.value, curve: false }
  if (record.type === 'IntervalValue' && typeof record.a === 'number' && typeof record.b === 'number') {
    return { min: record.a, max: record.b, curve: false }
  }
  return { min: 0, max: 0, curve: true }
}

function writeRange(min: number, max: number) {
  if (Math.abs(min - max) < 1e-5) return { type: 'ConstantValue', value: min }
  return { type: 'IntervalValue', a: min, b: max }
}

function readColor(value: unknown): { hex: string, alpha: number, curve: boolean } {
  if (!value || typeof value !== 'object') return { hex: '#ffffff', alpha: 1, curve: false }
  const record = value as { type?: string, color?: { r?: number, g?: number, b?: number, a?: number } }
  if (record.type === 'ConstantColor' && record.color) {
    return { hex: rgbHex(record.color.r ?? 1, record.color.g ?? 1, record.color.b ?? 1), alpha: record.color.a ?? 1, curve: false }
  }
  return { hex: '#ffffff', alpha: 1, curve: true }
}

function writeColor(hex: string, alpha: number) {
  const parsed = /^#([0-9a-fA-F]{6})$/.exec(hex)
  const raw = parsed ? Number.parseInt(parsed[1], 16) : 0xffffff
  return {
    type: 'ConstantColor',
    color: {
      r: ((raw >> 16) & 255) / 255,
      g: ((raw >> 8) & 255) / 255,
      b: (raw & 255) / 255,
      a: alpha,
    },
  }
}

function writeShape(current: unknown, view: SystemView): Record<string, unknown> {
  const previous = current && typeof current === 'object' ? { ...(current as Record<string, unknown>) } : {}
  if (!isKnownShape(view.shape)) return previous
  const next: Record<string, unknown> = { ...previous, type: view.shape }
  if (view.shape !== 'point') next.radius = view.radius
  if (view.shape === 'cone') next.angle = view.angleDeg * Math.PI / 180
  if (view.shape === 'cone' || view.shape === 'circle' || view.shape === 'sphere' || view.shape === 'hemisphere' || view.shape === 'donut') {
    next.arc = view.arcDeg * Math.PI / 180
  }
  if (view.shape === 'cone' || view.shape === 'donut' || view.shape === 'rectangle' || view.shape === 'sphere' || view.shape === 'hemisphere') {
    next.thickness = view.thickness
  }
  if (view.shape === 'rectangle') {
    next.width = view.width
    next.height = view.height
  }
  if (view.shape === 'point') return { type: 'point' }
  if (next.speed == null) next.speed = { type: 'ConstantValue', value: 1 }
  if (next.mode == null) next.mode = 0
  if (next.spread == null) next.spread = 0
  return next
}

function readGravity(behaviors: Record<string, unknown>[]): { value: number, locked: boolean } {
  const force = behaviors.find(item => item.type === 'ApplyForce')
  if (!force) return { value: 0, locked: false }
  if (!verticalForce(force)) return { value: 0, locked: true }
  const magnitude = readRange(force.magnitude).min
  const direction = force.direction as number[]
  return { value: Math.sign(direction[1]) * magnitude, locked: false }
}

function writeGravity(behaviors: Record<string, unknown>[], gravity: number) {
  const rest = behaviors.filter(item => item.type !== 'ApplyForce' || !verticalForce(item))
  if (Math.abs(gravity) < 1e-6) return rest
  return [
    ...rest,
    {
      type: 'ApplyForce',
      direction: [0, Math.sign(gravity), 0],
      magnitude: { type: 'ConstantValue', value: Math.abs(gravity) },
    },
  ]
}

function verticalForce(force: Record<string, unknown>): boolean {
  if (!Array.isArray(force.direction) || force.direction.length < 3) return false
  const [x, y, z] = force.direction
  return x === 0 && z === 0 && typeof y === 'number' && y !== 0
}

/** quarks 的 startLength 是拖尾保留的历史点数，不是米。少于 2 个点画不出带子。早期检查器把缺省写成了 1。 */
const TRAIL_SAMPLES = 30

export function trailSamples(settings: Record<string, unknown>): number {
  const length = readRange(settings.startLength)
  if (length.curve || length.min < 2) return TRAIL_SAMPLES
  return Math.round(length.min)
}

/** 播放前修正读出来仍然画不出的拖尾。不改检查器里的原件，只给这次生成用。 */
export function systemBodyForPlayback(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body
  const record = body as Record<string, unknown>
  if (record.renderMode !== 3) return body
  const settings = settingsOf(record)
  const stored = readRange(settings.startLength)
  if (stored.curve || stored.min >= 2) return body
  return {
    ...record,
    rendererEmitterSettings: {
      ...settings,
      startLength: { type: 'ConstantValue', value: TRAIL_SAMPLES },
      followLocalOrigin: settings.followLocalOrigin === true,
    },
  }
}

function behaviorList(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
}

function settingsOf(record: Record<string, unknown>): Record<string, unknown> {
  return record.rendererEmitterSettings && typeof record.rendererEmitterSettings === 'object'
    ? record.rendererEmitterSettings as Record<string, unknown>
    : {}
}

function rendererSettings(view: SystemView, current: unknown): Record<string, unknown> {
  const previous = current && typeof current === 'object' ? { ...(current as Record<string, unknown>) } : {}
  if (view.renderMode === 1) {
    return { ...previous, speedFactor: view.speedFactor, lengthFactor: view.lengthFactor }
  }
  if (view.renderMode === 3) {
    return {
      ...previous,
      startLength: { type: 'ConstantValue', value: Math.max(2, Math.round(view.trailLength)) },
      followLocalOrigin: previous.followLocalOrigin === true,
    }
  }
  return previous
}

function rgbHex(r: number, g: number, b: number): string {
  const channel = (value: number) => Math.max(0, Math.min(255, Math.round(value * 255))).toString(16).padStart(2, '0')
  return `#${channel(r)}${channel(g)}${channel(b)}`
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}
