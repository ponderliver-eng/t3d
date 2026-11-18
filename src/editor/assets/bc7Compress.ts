const BC7_MAGIC = 0x37434254 // 'TBC7'
const GPU_STAGE_COMPUTE = 0x4
const GPU_BUF_MAP_READ = 0x0001
const GPU_BUF_COPY_SRC = 0x0004
const GPU_BUF_COPY_DST = 0x0008
const GPU_BUF_UNIFORM = 0x0040
const GPU_BUF_STORAGE = 0x0080
const GPU_MAP_READ = 0x0001

export interface WebGpuDeviceLike {
  features: ReadonlySet<string>
  queue: {
    writeBuffer: (buffer: unknown, offset: number, data: ArrayBufferView | ArrayBuffer, dataOffset?: number, size?: number) => void
    submit: (commands: unknown[]) => void
  }
  createBuffer: (desc: { size: number, usage: number }) => WebGpuBufferLike
  createBindGroupLayout: (desc: unknown) => unknown
  createPipelineLayout: (desc: unknown) => unknown
  createShaderModule: (desc: { code: string }) => unknown
  createComputePipeline: (desc: unknown) => unknown
  createBindGroup: (desc: unknown) => unknown
  createCommandEncoder: () => {
    beginComputePass: () => {
      setPipeline: (pipeline: unknown) => void
      setBindGroup: (index: number, group: unknown) => void
      dispatchWorkgroups: (x: number, y?: number, z?: number) => void
      end: () => void
    }
    copyBufferToBuffer: (src: unknown, srcOffset: number, dst: unknown, dstOffset: number, size: number) => void
    finish: () => unknown
  }
}

interface WebGpuBufferLike {
  mapAsync: (mode: number) => Promise<void>
  getMappedRange: () => ArrayBuffer
  unmap: () => void
  destroy: () => void
}

export interface Bc7Mip {
  width: number
  height: number
  data: Uint8Array
}

let gpuDevice: WebGpuDeviceLike | null = null
let bc7Supported = false
let bc7Readable: boolean | null = null
let bc7ProbePromise: Promise<boolean> | null = null
let pipeline: unknown = null
let bindGroupLayout: unknown = null

const WGSL_BC7_MODE6 = /* wgsl */ `
struct Params {
  width: u32,
  height: u32,
  blocksX: u32,
  blocksY: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> pixels: array<u32>;
@group(0) @binding(2) var<storage, read_write> blocks: array<vec4<u32>>;

const WEIGHTS = array<f32, 16>(
  0.0, 4.0, 9.0, 13.0, 17.0, 21.0, 26.0, 30.0,
  34.0, 38.0, 43.0, 47.0, 51.0, 55.0, 60.0, 64.0
);

fn unpackRgba(packed: u32) -> vec4<f32> {
  return vec4<f32>(
    f32(packed & 0xffu),
    f32((packed >> 8u) & 0xffu),
    f32((packed >> 16u) & 0xffu),
    f32((packed >> 24u) & 0xffu),
  );
}

fn writeBits(words: ptr<function, vec4<u32>>, bitPos: u32, count: u32, value: u32) {
  let wordIdx = bitPos >> 5u;
  let bitOff = bitPos & 31u;
  let mask = (1u << count) - 1u;
  let v = value & mask;
  (*words)[wordIdx] |= (v << bitOff);
  if (bitOff + count > 32u) {
    (*words)[wordIdx + 1u] |= (v >> (32u - bitOff));
  }
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= params.blocksX || gid.y >= params.blocksY) {
    return;
  }

  var p: array<vec4<f32>, 16>;
  var mean = vec4<f32>(0.0);
  var minC = vec4<f32>(255.0);
  var maxC = vec4<f32>(0.0);

  let baseX = gid.x * 4u;
  let baseY = gid.y * 4u;
  for (var dy = 0u; dy < 4u; dy = dy + 1u) {
    let sy = min(baseY + dy, params.height - 1u);
    for (var dx = 0u; dx < 4u; dx = dx + 1u) {
      let sx = min(baseX + dx, params.width - 1u);
      let c = unpackRgba(pixels[sy * params.width + sx]);
      let i = dy * 4u + dx;
      p[i] = c;
      mean += c;
      minC = min(minC, c);
      maxC = max(maxC, c);
    }
  }
  mean *= 0.0625;

  // 幂迭代求 4D 颜色空间主方向，减少端点的轴对齐色偏
  var axis = maxC - minC;
  let axisLen = length(axis);
  if (axisLen > 0.001) {
    axis /= axisLen;
    for (var it = 0u; it < 3u; it = it + 1u) {
      var nextAxis = vec4<f32>(0.0);
      for (var i = 0u; i < 16u; i = i + 1u) {
        let d = p[i] - mean;
        nextAxis += d * dot(d, axis);
      }
      let nLen = length(nextAxis);
      if (nLen > 0.0001) {
        axis = nextAxis / nLen;
      }
    }
  } else {
    axis = vec4<f32>(1.0, 0.0, 0.0, 0.0);
  }

  var minT = 1e9;
  var maxT = -1e9;
  var ep0 = minC;
  var ep1 = maxC;
  for (var i = 0u; i < 16u; i = i + 1u) {
    let t = dot(p[i] - mean, axis);
    if (t < minT) { minT = t; ep0 = p[i]; }
    if (t > maxT) { maxT = t; ep1 = p[i]; }
  }

  var q0 = vec4<u32>(clamp(round(ep0), vec4<f32>(0.0), vec4<f32>(255.0)));
  var q1 = vec4<u32>(clamp(round(ep1), vec4<f32>(0.0), vec4<f32>(255.0)));

  // Mode 6 共享每个端点的 P-bit（4 个通道共用同一个最低位）
  var p0 = (q0.r + q0.g + q0.b + q0.a) & 1u;
  var p1 = (q1.r + q1.g + q1.b + q1.a) & 1u;
  // 若 4 通道中最低位多数为 1 则取 1
  let sumLsb0 = (q0.r & 1u) + (q0.g & 1u) + (q0.b & 1u) + (q0.a & 1u);
  let sumLsb1 = (q1.r & 1u) + (q1.g & 1u) + (q1.b & 1u) + (q1.a & 1u);
  p0 = select(0u, 1u, sumLsb0 >= 2u);
  p1 = select(0u, 1u, sumLsb1 >= 2u);

  var e0 = vec4<f32>(((q0 >> vec4<u32>(1u)) << vec4<u32>(1u)) | vec4<u32>(p0));
  var e1 = vec4<f32>(((q1 >> vec4<u32>(1u)) << vec4<u32>(1u)) | vec4<u32>(p1));

  let diff = e1 - e0;
  let diffSq = dot(diff, diff);
  var indices: array<u32, 16>;
  for (var i = 0u; i < 16u; i = i + 1u) {
    var idx = 0u;
    if (diffSq > 0.001) {
      let t = clamp(dot(p[i] - e0, diff) / diffSq, 0.0, 1.0);
      idx = u32(round(t * 15.0));
      // 用官方权重微调相邻索引，确保量化误差最小
      var bestIdx = idx;
      let d0 = p[i] - (e0 + diff * (WEIGHTS[idx] / 64.0));
      var bestErr = dot(d0, d0);
      if (idx > 0u) {
        let dl = p[i] - (e0 + diff * (WEIGHTS[idx - 1u] / 64.0));
        let el = dot(dl, dl);
        if (el < bestErr) { bestErr = el; bestIdx = idx - 1u; }
      }
      if (idx < 15u) {
        let dr = p[i] - (e0 + diff * (WEIGHTS[idx + 1u] / 64.0));
        let er = dot(dr, dr);
        if (er < bestErr) { bestIdx = idx + 1u; }
      }
      idx = bestIdx;
    }
    indices[i] = idx;
  }

  // Anchor 像素 0 的最高位必须为 0（idx < 8），否则翻转两个端点与全部索引
  if (indices[0] >= 8u) {
    let tmpQ = q0; q0 = q1; q1 = tmpQ;
    let tmpP = p0; p0 = p1; p1 = tmpP;
    for (var i = 0u; i < 16u; i = i + 1u) {
      indices[i] = 15u - indices[i];
    }
  }

  var words = vec4<u32>(0u);
  // Mode 6: bit 0..6 = 0b1000000 (64)
  writeBits(&words, 0u, 7u, 64u);
  writeBits(&words, 7u, 7u, q0.r >> 1u);
  writeBits(&words, 14u, 7u, q1.r >> 1u);
  writeBits(&words, 21u, 7u, q0.g >> 1u);
  writeBits(&words, 28u, 7u, q1.g >> 1u);
  writeBits(&words, 35u, 7u, q0.b >> 1u);
  writeBits(&words, 42u, 7u, q1.b >> 1u);
  writeBits(&words, 49u, 7u, q0.a >> 1u);
  writeBits(&words, 56u, 7u, q1.a >> 1u);
  writeBits(&words, 63u, 1u, p0);
  writeBits(&words, 64u, 1u, p1);
  writeBits(&words, 65u, 3u, indices[0]);
  var bitPos = 68u;
  for (var i = 1u; i < 16u; i = i + 1u) {
    writeBits(&words, bitPos, 4u, indices[i]);
    bitPos += 4u;
  }

  blocks[gid.y * params.blocksX + gid.x] = words;
}
`

function checkWebGlBptcSupport(): boolean {
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

export function initBc7Compressor(device: WebGpuDeviceLike | null | undefined) {
  if (!device || !device.features.has('texture-compression-bc') || !checkWebGlBptcSupport()) {
    gpuDevice = null
    bc7Supported = false
    bc7Readable = false
    return
  }
  gpuDevice = device
  bc7Supported = true
  bc7Readable = true
  pipeline = null
  bindGroupLayout = null
}

export function isBc7Supported(): boolean {
  return bc7Supported && gpuDevice !== null
}

/** 网页刚刷新时渲染器可能尚未完成 init，提前探测是否可直接读取 BC7 缓存。 */
export function ensureBc7Readable(): Promise<boolean> {
  if (bc7Readable !== null) return Promise.resolve(bc7Readable)
  if (bc7ProbePromise) return bc7ProbePromise
  bc7ProbePromise = (async () => {
    try {
      if (!checkWebGlBptcSupport()) return false
      const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<{ features?: ReadonlySet<string> } | null> } }).gpu
      if (!gpu) return false
      const adapter = await gpu.requestAdapter()
      return Boolean(adapter?.features?.has('texture-compression-bc'))
    } catch {
      return false
    }
  })().then(result => {
    if (bc7Readable === null) bc7Readable = result
    return bc7Readable
  })
  return bc7ProbePromise
}

function ensurePipeline(device: WebGpuDeviceLike) {
  if (pipeline && bindGroupLayout) return { pipeline, bindGroupLayout }
  bindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPU_STAGE_COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPU_STAGE_COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPU_STAGE_COMPUTE, buffer: { type: 'storage' } },
    ],
  })
  const module = device.createShaderModule({ code: WGSL_BC7_MODE6 })
  pipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    compute: { module, entryPoint: 'main' },
  })
  return { pipeline, bindGroupLayout }
}

function downsampleBox2x2(src: Uint8Array, w: number, h: number): { width: number, height: number, data: Uint8Array } {
  const nw = Math.max(1, w >> 1)
  const nh = Math.max(1, h >> 1)
  const dst = new Uint8Array(nw * nh * 4)
  for (let y = 0; y < nh; y += 1) {
    const sy0 = Math.min(h - 1, y * 2)
    const sy1 = Math.min(h - 1, sy0 + 1)
    for (let x = 0; x < nw; x += 1) {
      const sx0 = Math.min(w - 1, x * 2)
      const sx1 = Math.min(w - 1, sx0 + 1)
      const i00 = (sy0 * w + sx0) * 4
      const i10 = (sy0 * w + sx1) * 4
      const i01 = (sy1 * w + sx0) * 4
      const i11 = (sy1 * w + sx1) * 4
      const o = (y * nw + x) * 4
      dst[o] = (src[i00] + src[i10] + src[i01] + src[i11] + 2) >> 2
      dst[o + 1] = (src[i00 + 1] + src[i10 + 1] + src[i01 + 1] + src[i11 + 1] + 2) >> 2
      dst[o + 2] = (src[i00 + 2] + src[i10 + 2] + src[i01 + 2] + src[i11 + 2] + 2) >> 2
      dst[o + 3] = (src[i00 + 3] + src[i10 + 3] + src[i01 + 3] + src[i11 + 3] + 2) >> 2
    }
  }
  return { width: nw, height: nh, data: dst }
}

async function compressSingleLevel(device: WebGpuDeviceLike, rgba: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  const { pipeline: compPipeline, bindGroupLayout: layout } = ensurePipeline(device)
  const blocksX = Math.ceil(width / 4)
  const blocksY = Math.ceil(height / 4)
  const outByteLength = blocksX * blocksY * 16

  const paramBuf = device.createBuffer({
    size: 16,
    usage: GPU_BUF_UNIFORM | GPU_BUF_COPY_DST,
  })
  device.queue.writeBuffer(paramBuf, 0, new Uint32Array([width, height, blocksX, blocksY]))

  const srcBuf = device.createBuffer({
    size: rgba.byteLength,
    usage: GPU_BUF_STORAGE | GPU_BUF_COPY_DST,
  })
  device.queue.writeBuffer(srcBuf, 0, rgba)

  const outBuf = device.createBuffer({
    size: outByteLength,
    usage: GPU_BUF_STORAGE | GPU_BUF_COPY_SRC,
  })
  const readBuf = device.createBuffer({
    size: outByteLength,
    usage: GPU_BUF_MAP_READ | GPU_BUF_COPY_DST,
  })

  const bindGroup = device.createBindGroup({
    layout,
    entries: [
      { binding: 0, resource: { buffer: paramBuf } },
      { binding: 1, resource: { buffer: srcBuf } },
      { binding: 2, resource: { buffer: outBuf } },
    ],
  })

  const encoder = device.createCommandEncoder()
  const pass = encoder.beginComputePass()
  pass.setPipeline(compPipeline)
  pass.setBindGroup(0, bindGroup)
  pass.dispatchWorkgroups(Math.ceil(blocksX / 8), Math.ceil(blocksY / 8))
  pass.end()
  encoder.copyBufferToBuffer(outBuf, 0, readBuf, 0, outByteLength)
  device.queue.submit([encoder.finish()])

  await readBuf.mapAsync(GPU_MAP_READ)
  const result = new Uint8Array(readBuf.getMappedRange()).slice()
  readBuf.unmap()

  paramBuf.destroy()
  srcBuf.destroy()
  outBuf.destroy()
  readBuf.destroy()
  return result
}

export async function compressRgbaToBc7Mips(rgba: Uint8Array, width: number, height: number): Promise<Bc7Mip[] | null> {
  const device = gpuDevice
  if (!device || !bc7Supported) return null
  if (width < 4 || height < 4 || (width % 4) !== 0 || (height % 4) !== 0) return null

  const levels: { width: number, height: number, data: Uint8Array }[] = [{ width, height, data: rgba }]
  let cw = width
  let ch = height
  let current = rgba
  while (cw > 1 || ch > 1) {
    const next = downsampleBox2x2(current, cw, ch)
    levels.push(next)
    cw = next.width
    ch = next.height
    current = next.data
  }

  const mips: Bc7Mip[] = []
  for (const level of levels) {
    const compressed = await compressSingleLevel(device, level.data, level.width, level.height)
    mips.push({ width: level.width, height: level.height, data: compressed })
  }
  return mips
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
