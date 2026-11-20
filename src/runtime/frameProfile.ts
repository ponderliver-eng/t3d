const buckets = new Map<string, number>()
let frames = 0
let capture: Map<string, number> | null = null

export function beginFrameCosts() {
  frames += 1
}

export function measureCost(id: string, run: () => void) {
  const start = performance.now()
  try {
    run()
  } finally {
    const ms = performance.now() - start
    buckets.set(id, (buckets.get(id) ?? 0) + ms)
    if (capture) capture.set(id, (capture.get(id) ?? 0) + ms)
  }
}

export function takeCostAverages(): { id: string, ms: number }[] {
  const count = Math.max(1, frames)
  const rows = [...buckets.entries()].map(([id, sum]) => ({ id, ms: sum / count }))
  buckets.clear()
  frames = 0
  return rows.filter(row => row.ms >= 0.05).sort((a, b) => b.ms - a.ms).slice(0, 8)
}

/** 开始累计一段时间内各环节的主线程总耗时（不做平均），用于量打开工程后的卡顿落在哪一段。 */
export function startCostCapture() {
  capture = new Map()
}

/** 结束累计，按总耗时从大到小返回。 */
export function stopCostCapture(): { id: string, ms: number }[] {
  const rows = capture ? [...capture.entries()].map(([id, ms]) => ({ id, ms })) : []
  capture = null
  return rows.sort((a, b) => b.ms - a.ms)
}

export type GpuCounters = {
  /** 着色器模块创建次数。 */
  shaders: number
  /** 同步创建的渲染管线数（首次绘制时现编译的）。 */
  pipelines: number
  /** 异步创建的渲染管线数（预编译的）。 */
  asyncPipelines: number
  /** 异步管线从发起到完成的累计时长 (ms)。 */
  asyncMs: number
  /** 单条异步管线最长耗时 (ms)。 */
  asyncWorst: number
  /** 计算管线数。 */
  compute: number
}

const gpu: GpuCounters = { shaders: 0, pipelines: 0, asyncPipelines: 0, asyncMs: 0, asyncWorst: 0, compute: 0 }

export type PipelineRecord = {
  /** 材质名或材质类型。 */
  material: string
  /** 材质 id。 */
  id: string
  /** 输出格式签名：颜色格式 / 深度格式 / 采样数，用来区分主画面、离屏图、阴影等不同绘制目标。 */
  target: string
  /** 是否预编译（异步）创建。 */
  precompiled: boolean
  /** 顶点着色器文本。 */
  vertex: string
  /** 片元着色器文本。 */
  fragment: string
  /** 着色器之外的管线状态（混合、深度、剔除、顶点布局等）。 */
  state: string
}

const pipelineLog: PipelineRecord[] = []
const moduleCode = new WeakMap<object, string>()
let pendingModuleCode = ''

function recordPipeline(descriptor: unknown, precompiled: boolean) {
  if (pipelineLog.length > 1500) return
  const desc = descriptor as {
    label?: string
    vertex?: { module?: object, buffers?: unknown }
    fragment?: { module?: object, targets?: Array<{ format?: string } | null> }
    primitive?: unknown
    depthStencil?: { format?: string }
    multisample?: { count?: number }
  } | undefined
  let state = ''
  try {
    state = JSON.stringify({
      primitive: desc?.primitive,
      depthStencil: desc?.depthStencil,
      multisample: desc?.multisample,
      targets: desc?.fragment?.targets,
      buffers: desc?.vertex?.buffers,
    })
  } catch {
    state = ''
  }
  const label = desc?.label ?? ''
  const match = /^renderPipeline_(.*)_(\d+)$/.exec(label)
  const colors = (desc?.fragment?.targets ?? []).map(item => item?.format ?? '?').join('+') || '无颜色'
  pipelineLog.push({
    material: match ? match[1] : label || '?',
    id: match ? match[2] : '',
    target: `${colors}/${desc?.depthStencil?.format ?? '无深度'}/x${desc?.multisample?.count ?? 1}`,
    precompiled,
    vertex: (desc?.vertex?.module && moduleCode.get(desc.vertex.module)) || '',
    fragment: (desc?.fragment?.module && moduleCode.get(desc.fragment.module)) || '',
    state,
  })
}

const shaderHashes = new Set<string>()
const SHADER_HASH_KEY = 't3d:shader-hashes'

function hashText(text: string): string {
  let a = 0x811c9dc5
  let b = 0x01000193
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    a = Math.imul(a ^ code, 0x01000193)
    b = Math.imul(b + code, 0x85ebca6b) ^ (b >>> 13)
  }
  return `${text.length.toString(36)}-${(a >>> 0).toString(36)}-${(b >>> 0).toString(36)}`
}

/**
 * 本次运行生成的着色器文本，有多少和上一次运行一字不差。
 * 文本一样，显卡的磁盘缓存才可能命中；不一样就只能每次重编。调用后把本次的记录存下来供下次比较。
 */
export function compareShadersWithLastRun(): { unique: number, same: number, hadPrevious: boolean } {
  let previous: Set<string> | null = null
  try {
    const raw = localStorage.getItem(SHADER_HASH_KEY)
    if (raw) previous = new Set(JSON.parse(raw) as string[])
  } catch {
    previous = null
  }
  let same = 0
  if (previous) for (const hash of shaderHashes) if (previous.has(hash)) same += 1
  try {
    localStorage.setItem(SHADER_HASH_KEY, JSON.stringify([...shaderHashes]))
  } catch {
    // 存不下就算了，只影响下次的比较
  }
  return { unique: shaderHashes.size, same, hadPrevious: previous !== null }
}

/** 已创建的渲染管线记录条数，配合 pipelineRecordsSince 取一段时间内的新增。 */
export function pipelineRecordCount(): number {
  return pipelineLog.length
}

export function pipelineRecordsSince(index: number): PipelineRecord[] {
  return pipelineLog.slice(index)
}

/** 给 WebGPU 设备的着色器、管线创建入口计数。只统计次数与时长，不改变行为。 */
export function watchGpuDevice(device: unknown) {
  const target = device as Record<string, unknown> | null | undefined
  if (!target || target.__t3dWatched) return
  target.__t3dWatched = true
  const wrap = (name: string, onCall: (result: unknown) => void, before?: (descriptor: unknown) => void) => {
    const original = target[name]
    if (typeof original !== 'function') return
    target[name] = function (this: unknown, ...args: unknown[]) {
      // three 会复用并清空同一个描述对象，要在调用前读
      before?.(args[0])
      const result = (original as (...rest: unknown[]) => unknown).apply(this, args)
      onCall(result)
      return result
    }
  }
  wrap('createShaderModule', result => {
    gpu.shaders += 1
    if (result && typeof result === 'object' && pendingModuleCode) moduleCode.set(result, pendingModuleCode)
    pendingModuleCode = ''
  }, descriptor => {
    const code = (descriptor as { code?: unknown } | undefined)?.code
    pendingModuleCode = typeof code === 'string' ? code : ''
    if (typeof code === 'string' && shaderHashes.size < 4000) shaderHashes.add(hashText(code))
  })
  wrap('createRenderPipeline', () => { gpu.pipelines += 1 }, descriptor => recordPipeline(descriptor, false))
  wrap('createComputePipeline', () => { gpu.compute += 1 })
  wrap('createRenderPipelineAsync', result => {
    gpu.asyncPipelines += 1
    const start = performance.now()
    const done = () => {
      const ms = performance.now() - start
      gpu.asyncMs += ms
      gpu.asyncWorst = Math.max(gpu.asyncWorst, ms)
    }
    void (result as Promise<unknown>).then(done, done)
  }, descriptor => recordPipeline(descriptor, true))
}

export function gpuCounters(): GpuCounters {
  return { ...gpu }
}
