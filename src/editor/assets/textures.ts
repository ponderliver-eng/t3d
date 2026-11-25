import { CanvasTexture, CompressedTexture, DataTexture, EquirectangularReflectionMapping, NoColorSpace, RGBA_BPTC_Format, RGBAFormat, SRGBColorSpace, Texture, TextureLoader, UnsignedByteType } from 'three'
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js'
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js'
import type { WebGPURenderer } from 'three/webgpu'
import { compressRgbaToBc7Mips, ensureBc7Readable, initBc7Compressor, isBc7Supported, packBc7Artifact, unpackBc7Artifact, type Bc7Mip, type WebGpuDeviceLike } from './bc7Compress'
import { readFileBytes, readTextureArtifact, writeTextureArtifact } from './cache'
import { type FileAsset, useAssetStore } from './library'
import { readUnpremultipliedRgba } from './textureResize'
import { createLoadFailureGate } from './loadFailures'
import { canRestoreDegraded, chooseMipSkip, estimateRgbaBytes, textureBudgetBytes } from './memoryBudget'
import { watchGpuDevice } from '../../runtime/frameProfile'

const images = new Map<string, Texture>()
const imageHashes = new Map<string, string>()
const imageSources = new Map<string, 'bc7' | 'base' | 'source'>()
const imageArtifactBytes = new Map<string, number>()
const imageReadMs = new Map<string, number>()
const linearImages = new Map<string, Texture>()
const unityMrImages = new Map<string, Texture>()
const unityMrPending = new Set<string>()
/** 正在直接读取重排成品（不经过原图）的贴图。 */
const unityMrDirect = new Set<string>()
/** 直接读取没命中的贴图：之后改走「先加载原图再重排」的老路，不再重复尝试。 */
const unityMrDirectMiss = new Set<string>()
const unityMrInfo = new Map<string, { source: 'bc7' | 'base', bytes: number, readMs: number, hash: string }>()
const pendingImages = new Map<string, Promise<void>>()
const environments = new Map<string, Texture>()
const pendingEnvironments = new Map<string, Promise<void>>()
const loader = new TextureLoader()
const hdrLoader = new RGBELoader()
const exrLoader = new EXRLoader()
let ktx2: KTX2Loader | null = null
let bumpTimer = 0
let warmBumpDeferred = false
let warmBumpPending = false
const unityMrWaiters = new Map<string, Array<() => void>>()
const imageFailures = createLoadFailureGate('贴图')
const environmentFailures = createLoadFailureGate('环境贴图')
/** 因为显存估算超预算而少加载了几级清晰度的贴图：资源 -> 跳过的级数。 */
const degradedTextures = new Map<string, number>()
let memoryPressureHandler: ((info: { usedBytes: number, budgetBytes: number }) => void) | null = null
let lastPressureAt = 0

/** 显存估算超过预算时的回调（编辑器用它去回收场景没用到的资源）。 */
export function setTextureMemoryPressureHandler(handler: ((info: { usedBytes: number, budgetBytes: number }) => void) | null) {
  memoryPressureHandler = handler
}

function estimateTextureBytes(texture: Texture): number {
  const compressed = texture as { isCompressedTexture?: boolean, mipmaps?: Array<{ data?: { byteLength?: number } }> }
  if (compressed.isCompressedTexture && compressed.mipmaps?.length) {
    let bytes = 0
    for (const mip of compressed.mipmaps) bytes += mip.data?.byteLength ?? 0
    return bytes
  }
  const image = texture.image as { width?: number, height?: number, naturalWidth?: number, naturalHeight?: number } | undefined
  const width = image?.naturalWidth || image?.width || 0
  const height = image?.naturalHeight || image?.height || 0
  // 浮点环境贴图按每像素 8 字节（半浮点 RGBA）估
  const bytesPerPixel = texture.type === UnsignedByteType ? 4 : 8
  return estimateRgbaBytes(width, height, texture.generateMipmaps, bytesPerPixel)
}

function textureBytesOf(assetId: string): number {
  let bytes = 0
  const image = images.get(assetId)
  if (image) bytes += estimateTextureBytes(image)
  const packed = unityMrImages.get(assetId)
  if (packed) bytes += estimateTextureBytes(packed)
  const env = environments.get(assetId)
  if (env) bytes += estimateTextureBytes(env)
  return bytes
}

/** 当前留在内存里的贴图（含环境贴图和重排后的金属光滑图）。 */
export function loadedTextureIds(): string[] {
  return [...new Set([...images.keys(), ...unityMrImages.keys(), ...environments.keys()])]
}

/** 贴图是否正在加载或重排（这时不能回收）。 */
export function isTextureBusy(assetId: string): boolean {
  return pendingImages.has(assetId) || pendingEnvironments.has(assetId) || unityMrPending.has(assetId) || unityMrDirect.has(assetId)
}

/** 贴图显存的估算统计。数字是按尺寸和格式算的，不是显卡的真实读数。 */
export function textureMemoryStats(): { bytes: number, count: number, degraded: number, budgetBytes: number } {
  const ids = loadedTextureIds()
  let bytes = 0
  for (const id of ids) bytes += textureBytesOf(id)
  return { bytes, count: ids.length, degraded: degradedTextures.size, budgetBytes: textureBudgetBytes() }
}

/** 单个贴图资源的估算字节数（没加载时为 0）。 */
export function textureMemoryBytes(assetId: string): number {
  return textureBytesOf(assetId)
}

function noteTextureStored() {
  if (!memoryPressureHandler) return
  const now = performance.now()
  if (now - lastPressureAt < 5000) return
  const stats = textureMemoryStats()
  if (stats.bytes <= stats.budgetBytes) return
  lastPressureAt = now
  memoryPressureHandler({ usedBytes: stats.bytes, budgetBytes: stats.budgetBytes })
}

/**
 * 预算有余量时，把之前降过清晰度的贴图放掉重新加载成全清晰度。
 * 返回恢复的贴图数。
 */
export function restoreDegradedTextures(): number {
  if (degradedTextures.size === 0) return 0
  const stats = textureMemoryStats()
  const degraded = [...degradedTextures].map(([id, skip]) => ({ bytes: textureBytesOf(id), skip }))
  if (!canRestoreDegraded(stats.bytes, stats.budgetBytes, degraded)) return 0
  const ids = [...degradedTextures.keys()]
  for (const id of ids) releaseTexture(id)
  // 视口下一次同步会重新来要这些贴图
  scheduleBump()
  return ids.length
}

export function setWarmBumpDeferred(deferred: boolean) {
  warmBumpDeferred = deferred
  if (!deferred && warmBumpPending) {
    warmBumpPending = false
    // 立刻同步：材质要先换上贴图，紧接着的着色器预编译才编得对
    if (bumpTimer) {
      window.clearTimeout(bumpTimer)
      bumpTimer = 0
    }
    useAssetStore.getState().bump()
  }
}

function scheduleBump() {
  if (warmBumpDeferred) {
    warmBumpPending = true
    return
  }
  if (bumpTimer) return
  bumpTimer = window.setTimeout(() => {
    bumpTimer = 0
    useAssetStore.getState().bump()
  }, 16)
}

function notifyUnityMrReady(assetId: string) {
  const list = unityMrWaiters.get(assetId)
  if (!list) return
  unityMrWaiters.delete(assetId)
  for (const resolve of list) resolve()
}

export function warmUnityMetallicRoughness(assetId: string): Promise<void> {
  if (unityMrImages.has(assetId)) return Promise.resolve()
  const tex = unityMetallicRoughnessTextureFor(assetId)
  if (tex) return Promise.resolve()
  if (!unityMrPending.has(assetId) && !unityMrDirect.has(assetId)) return Promise.resolve()
  return new Promise<void>(resolve => {
    const list = unityMrWaiters.get(assetId) ?? []
    list.push(resolve)
    unityMrWaiters.set(assetId, list)
  })
}

let rendererReadyTime: number | null = null
let rendererInitDuration = 0

/** 主视口渲染器初始化完成的时刻（performance.now()），还没完成时为 null。 */
export function rendererReadyAt(): number | null {
  return rendererReadyTime
}

/** 主视口渲染器初始化花了多久 (ms)。 */
export function rendererInitMs(): number {
  return rendererInitDuration
}

export function bindTextureRenderer(renderer: WebGPURenderer, initMs = 0) {
  rendererReadyTime = performance.now()
  rendererInitDuration = initMs
  const device = (renderer.backend as { device?: WebGpuDeviceLike } | undefined)?.device
  watchGpuDevice(device)
  initBc7Compressor(device)
  if (ktx2) return
  ktx2 = new KTX2Loader()
  ktx2.setTranscoderPath('/basis/')
  try {
    ktx2.detectSupport(renderer as never)
  } catch (error) {
    console.warn('[ktx2] detectSupport failed', error)
  }
}

export async function ensureAssetUrl(assetId: string): Promise<string> {
  const current = useAssetStore.getState().assets[assetId]
  if (!current || !('fileName' in current)) throw new Error('资源不存在')
  if (current.url) return current.url
  const bytes = await readFileBytes(assetId)
  if (!bytes) throw new Error('缓存里没有源文件')
  const latest = useAssetStore.getState().assets[assetId]
  if (latest && 'url' in latest && latest.url) return latest.url
  const url = URL.createObjectURL(new Blob([bytes]))
  useAssetStore.getState().patch(assetId, { url })
  return url
}

export function textureFor(assetId: string | null, colorMap: boolean): Texture | null {
  if (!assetId) return null
  const asset = useAssetStore.getState().assets[assetId]
  const currentHash = asset && 'hash' in asset ? asset.hash : ''
  const cachedHash = imageHashes.get(assetId)
  if (images.has(assetId) && cachedHash !== undefined && currentHash && cachedHash !== currentHash) {
    releaseTexture(assetId)
  }
  const texture = images.get(assetId)
  if (!texture) {
    if (asset && asset.kind === 'texture' && imageFailures.shouldTry(assetId, asset.hash)) {
      void loadTextureAsset(asset).catch(() => undefined)
    }
    return null
  }
  if (colorMap) {
    texture.colorSpace = SRGBColorSpace
    return texture
  }
  let linear = linearImages.get(assetId)
  if (!linear) {
    linear = texture.clone()
    linear.source = texture.source
    linear.colorSpace = NoColorSpace
    linear.needsUpdate = true
    linearImages.set(assetId, linear)
  }
  return linear
}

const REPACK_WORKER_CODE = `
self.onmessage = async (e) => {
  const { id, bitmap, width, height, buffer } = e.data;
  try {
    let w = width, h = height, data;
    if (buffer) {
      data = new Uint8Array(buffer);
    } else {
      w = bitmap.width;
      h = bitmap.height;
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      const img = ctx.getImageData(0, 0, w, h);
      data = img.data;
    }
    const len = data.length;
    let hasAlpha = false;
    const firstA = data[3] ?? 255;
    for (let i = 3; i < len; i += 4) {
      if (Math.abs(data[i] - firstA) > 2) { hasAlpha = true; break; }
    }
    const useA = hasAlpha || firstA < 250;
    for (let i = 0; i < len; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const a = data[i + 3];
      data[i] = g > 0 ? g : 255;
      data[i + 1] = 255 - (useA ? a : r);
      data[i + 2] = r;
      data[i + 3] = 255;
    }
    self.postMessage({ id, w, h, buffer: data.buffer }, [data.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err) });
  }
};
`

let repackWorker: Worker | null = null
const repackCallbacks = new Map<string, (res: { w: number; h: number; buffer: ArrayBuffer } | null) => void>()

function getRepackWorker(): Worker | null {
  if (repackWorker) return repackWorker
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return null
  try {
    const blob = new Blob([REPACK_WORKER_CODE], { type: 'application/javascript' })
    const url = URL.createObjectURL(blob)
    repackWorker = new Worker(url)
    repackWorker.onmessage = (event: MessageEvent<{ id: string; w?: number; h?: number; buffer?: ArrayBuffer; error?: string }>) => {
      const { id, w, h, buffer } = event.data
      const cb = repackCallbacks.get(id)
      repackCallbacks.delete(id)
      if (cb) cb(w && h && buffer ? { w, h, buffer } : null)
    }
    return repackWorker
  } catch {
    return null
  }
}

const TEX_MAGIC = 0x54334454

function packTextureArtifact(width: number, height: number, rgba: Uint8Array): ArrayBuffer {
  const out = new Uint8Array(16 + rgba.byteLength)
  const view = new DataView(out.buffer)
  view.setUint32(0, TEX_MAGIC, true)
  view.setUint32(4, 1, true)
  view.setUint32(8, width, true)
  view.setUint32(12, height, true)
  out.set(rgba, 16)
  return out.buffer
}

function unpackTextureArtifact(buffer: ArrayBuffer): { width: number, height: number, rgba: Uint8Array } | null {
  if (buffer.byteLength < 16) return null
  const view = new DataView(buffer)
  if (view.getUint32(0, true) !== TEX_MAGIC || view.getUint32(4, true) !== 1) return null
  const width = view.getUint32(8, true)
  const height = view.getUint32(12, true)
  const expected = width * height * 4
  if (width <= 0 || height <= 0 || buffer.byteLength !== 16 + expected) return null
  return { width, height, rgba: new Uint8Array(buffer, 16, expected) }
}

function buildDataTexture(width: number, height: number, rgba: Uint8Array, base?: Texture): DataTexture {
  const tex = new DataTexture(rgba, width, height, RGBAFormat, UnsignedByteType)
  tex.flipY = base ? base.flipY : false
  if (base) {
    tex.wrapS = base.wrapS
    tex.wrapT = base.wrapT
  }
  tex.generateMipmaps = true
  tex.needsUpdate = true
  return tex
}

/**
 * degradeKey 给了资源编号时，显存估算超预算就跳过最清晰的一两级 mip（成品里本来就存着整条 mip 链），
 * 画面变糊但不会因为显存耗尽而出错；预算有余量后由 restoreDegradedTextures 恢复。
 */
function buildBc7Texture(width: number, height: number, allMips: Bc7Mip[], base?: Texture, degradeKey?: string): CompressedTexture {
  let mips = allMips
  if (degradeKey) {
    const stats = textureMemoryStats()
    const skip = chooseMipSkip(stats.bytes, stats.budgetBytes, allMips)
    if (skip > 0) {
      mips = allMips.slice(skip)
      width = mips[0]!.width
      height = mips[0]!.height
      degradedTextures.set(degradeKey, Math.max(skip, degradedTextures.get(degradeKey) ?? 0))
    }
  }
  const tex = new CompressedTexture(mips as unknown as ImageData[], width, height, RGBA_BPTC_Format)
  tex.flipY = base ? base.flipY : false
  if (base) {
    tex.wrapS = base.wrapS
    tex.wrapT = base.wrapT
  }
  tex.needsUpdate = true
  return tex
}

async function persistTextureCache(hash: string, width: number, height: number, rgba: Uint8Array, variantBase: string, variantBc7: string) {
  if (isBc7Supported() && width >= 4 && height >= 4 && (width % 4) === 0 && (height % 4) === 0) {
    const mips = await compressRgbaToBc7Mips(rgba, width, height).catch(() => null)
    if (mips) {
      await writeTextureArtifact(hash, packBc7Artifact(width, height, mips), variantBc7)
      return
    }
  }
  await writeTextureArtifact(hash, packTextureArtifact(width, height, rgba), variantBase)
}

function scheduleUnityRepack(
  assetId: string,
  base: Texture,
  source: CanvasImageSource | null,
  rawBuffer: Uint8Array | null,
  width: number,
  height: number,
) {
  if (unityMrPending.has(assetId)) return
  unityMrPending.add(assetId)
  const asset = useAssetStore.getState().assets[assetId]
  const assetHash = asset && 'hash' in asset ? asset.hash : ''
  const finishWithBuffer = (w: number, h: number, buffer: ArrayBuffer, persist = true) => {
    const rgba = new Uint8Array(buffer)
    const converted = buildDataTexture(w, h, rgba, base)
    converted.colorSpace = NoColorSpace
    unityMrImages.set(assetId, converted)
    unityMrPending.delete(assetId)
    notifyUnityMrReady(assetId)
    scheduleBump()
    if (persist && assetHash) {
      void persistTextureCache(assetHash, w, h, rgba, 'unity-mr', 'unity-mr-bc7').catch(() => undefined)
    }
  }
  const runCompute = () => {
    const worker = getRepackWorker()
    if (worker && rawBuffer) {
      const copy = new Uint8Array(rawBuffer).buffer
      repackCallbacks.set(assetId, res => {
        if (!res) { unityMrPending.delete(assetId); return }
        finishWithBuffer(res.w, res.h, res.buffer)
      })
      worker.postMessage({ id: assetId, width, height, buffer: copy }, [copy])
      return
    }
    if (worker && source && typeof createImageBitmap === 'function') {
      createImageBitmap(source, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }).then(bitmap => {
        repackCallbacks.set(assetId, res => {
          if (!res) { unityMrPending.delete(assetId); return }
          finishWithBuffer(res.w, res.h, res.buffer)
        })
        worker.postMessage({ id: assetId, bitmap }, [bitmap])
      }).catch(() => {
        unityMrPending.delete(assetId)
      })
      return
    }
    if (!source) {
      // 主图走了 BC7 压缩缓存时，没有裸像素；按需回源解码一次生成重排缓存
      ensureAssetUrl(assetId).then(url => loadBitmapTexture(url)).then(tex => {
        const img = tex.image as { width?: number, height?: number, naturalWidth?: number, naturalHeight?: number } | undefined
        const w = img?.naturalWidth || img?.width || 0
        const h = img?.naturalHeight || img?.height || 0
        if (!img || w <= 0 || h <= 0) { unityMrPending.delete(assetId); return }
        const rgba = readUnpremultipliedRgba(img as TexImageSource, w, h)
        tex.dispose()
        if (worker) {
          const copy = new Uint8Array(rgba).buffer
          repackCallbacks.set(assetId, res => {
            if (!res) { unityMrPending.delete(assetId); return }
            finishWithBuffer(res.w, res.h, res.buffer)
          })
          worker.postMessage({ id: assetId, width: w, height: h, buffer: copy }, [copy])
        } else {
          unityMrPending.delete(assetId)
        }
      }).catch(() => { unityMrPending.delete(assetId) })
      return
    }
    // 回退：异步微任务切出当前渲染帧再做重排
    window.setTimeout(() => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) { unityMrPending.delete(assetId); return }
        ctx.drawImage(source, 0, 0, width, height)
        const imgData = ctx.getImageData(0, 0, width, height)
        const data = imgData.data
        let hasAlpha = false
        const firstA = data[3] ?? 255
        for (let i = 3; i < data.length; i += 4) {
          if (Math.abs((data[i] ?? 255) - firstA) > 2) { hasAlpha = true; break }
        }
        const useA = hasAlpha || firstA < 250
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i]!
          const g = data[i + 1]!
          const a = data[i + 3]!
          data[i] = g > 0 ? g : 255
          data[i + 1] = 255 - (useA ? a : r)
          data[i + 2] = r
          data[i + 3] = 255
        }
        ctx.putImageData(imgData, 0, 0)
        const converted = new CanvasTexture(canvas)
        converted.colorSpace = NoColorSpace
        converted.flipY = base.flipY
        converted.wrapS = base.wrapS
        converted.wrapT = base.wrapT
        converted.needsUpdate = true
        unityMrImages.set(assetId, converted)
        unityMrPending.delete(assetId)
        notifyUnityMrReady(assetId)
        scheduleBump()
      } catch {
        unityMrPending.delete(assetId)
        notifyUnityMrReady(assetId)
      }
    }, 0)
  }
  if (assetHash) {
    void (async () => {
      if (await ensureBc7Readable()) {
        const bc7 = await readTextureArtifact(assetHash, 'unity-mr-bc7').catch(() => null)
        const unpackedBc7 = bc7 ? unpackBc7Artifact(bc7) : null
        if (unpackedBc7) {
          const converted = buildBc7Texture(unpackedBc7.width, unpackedBc7.height, unpackedBc7.mips, base, assetId)
          converted.colorSpace = NoColorSpace
          unityMrImages.set(assetId, converted)
          unityMrPending.delete(assetId)
          notifyUnityMrReady(assetId)
          scheduleBump()
          noteTextureStored()
          return
        }
      }
      const cached = await readTextureArtifact(assetHash, 'unity-mr').catch(() => null)
      const unpacked = cached ? unpackTextureArtifact(cached) : null
      if (unpacked) {
        finishWithBuffer(unpacked.width, unpacked.height, unpacked.rgba.buffer as ArrayBuffer, false)
        return
      }
      runCompute()
    })()
    return
  }
  runCompute()
}

/** 不加载原图，直接读取重排成品；没命中时回到老路（加载原图 -> 重排 -> 写成品）。 */
function loadUnityMrDirect(asset: FileAsset) {
  const assetId = asset.id
  unityMrDirect.add(assetId)
  void (async () => {
    const started = performance.now()
    let texture: Texture | null = null
    let source: 'bc7' | 'base' = 'base'
    let bytes = 0
    if (await ensureBc7Readable()) {
      const bc7 = await readTextureArtifact(asset.hash, 'unity-mr-bc7').catch(() => null)
      const unpacked = bc7 ? unpackBc7Artifact(bc7) : null
      if (unpacked) {
        texture = buildBc7Texture(unpacked.width, unpacked.height, unpacked.mips, undefined, assetId)
        source = 'bc7'
        bytes = bc7!.byteLength
      }
    }
    if (!texture) {
      const cached = await readTextureArtifact(asset.hash, 'unity-mr').catch(() => null)
      const unpacked = cached ? unpackTextureArtifact(cached) : null
      if (unpacked) {
        texture = buildDataTexture(unpacked.width, unpacked.height, unpacked.rgba)
        bytes = cached!.byteLength
      }
    }
    // 读取期间资源被释放或换了内容：丢弃结果
    const current = useAssetStore.getState().assets[assetId]
    const stale = !unityMrDirect.has(assetId) || !current || !('hash' in current) || current.hash !== asset.hash
    unityMrDirect.delete(assetId)
    if (stale) {
      texture?.dispose()
      notifyUnityMrReady(assetId)
      return
    }
    if (texture) {
      texture.colorSpace = NoColorSpace
      unityMrImages.set(assetId, texture)
      unityMrInfo.set(assetId, { source, bytes, readMs: performance.now() - started, hash: asset.hash })
      notifyUnityMrReady(assetId)
      scheduleBump()
      noteTextureStored()
      return
    }
    // 没有成品（第一次导入）：加载原图后重排，重排完成时会通知等待方并写入成品
    unityMrDirectMiss.add(assetId)
    await loadTextureAsset(asset)
    if (unityMetallicRoughnessTextureFor(assetId) || !unityMrPending.has(assetId)) notifyUnityMrReady(assetId)
  })().catch(() => {
    unityMrDirect.delete(assetId)
    unityMrDirectMiss.add(assetId)
    notifyUnityMrReady(assetId)
  })
}

/** 重排成品的加载来源与大小（只有直接读成品命中时才有），供打开工程的统计用。 */
export function unityMrLoadInfo(assetId: string): { source: 'bc7' | 'base', bytes: number, readMs: number } | null {
  return unityMrInfo.get(assetId) ?? null
}

/**
 * Unity Standard / URP MaskMap 金属光滑图重排为 Three.js / glTF ORM 贴图：
 * - Unity 输入：R = Metallic，G = AO（或 R 副本），A = Smoothness（1 - Roughness）
 * - Three.js 输出：R = AO（取 G），G = Roughness（1 - A），B = Metallic（取 R）
 */
export function unityMetallicRoughnessTextureFor(assetId: string | null): Texture | null {
  if (!assetId) return null
  const packed = unityMrImages.get(assetId)
  if (packed) {
    // 直接读成品得到的贴图没有原图帮忙发现内容变化，这里自己比对一次
    const info = unityMrInfo.get(assetId)
    const live = info ? useAssetStore.getState().assets[assetId] : undefined
    if (!info || !live || !('hash' in live) || !live.hash || live.hash === info.hash) return packed
    releaseTexture(assetId)
  }
  // 原图还没加载时，先直接读重排好的成品：命中就完全不需要原图（少读一个文件、少占一份显存）
  if (!images.has(assetId) && !unityMrDirectMiss.has(assetId)) {
    if (unityMrDirect.has(assetId)) return null
    const asset = useAssetStore.getState().assets[assetId]
    if (asset && asset.kind === 'texture' && asset.hash) {
      loadUnityMrDirect(asset)
      return null
    }
  }
  const base = textureFor(assetId, false)
  if (!base) return null
  if ((base as { isCompressedTexture?: boolean }).isCompressedTexture) {
    const size = base.image as { width?: number, height?: number } | undefined
    scheduleUnityRepack(assetId, base, null, null, size?.width ?? 0, size?.height ?? 0)
    return null
  }
  const image = base.image as { data?: Uint8Array, width?: number, height?: number, naturalWidth?: number, naturalHeight?: number } | undefined
  const width = image?.naturalWidth || image?.width || 0
  const height = image?.naturalHeight || image?.height || 0
  if (!image || width <= 0 || height <= 0) return base
  if (image.data instanceof Uint8Array) {
    scheduleUnityRepack(assetId, base, null, image.data, width, height)
    return null
  }
  if (typeof document === 'undefined') return base
  scheduleUnityRepack(assetId, base, image as CanvasImageSource, null, width, height)
  // 重排完成前返回 null，避免先将未重排的原图上传一次 GPU 造成闪烁与双倍显存
  return null
}

export function environmentFor(assetId: string | null): Texture | null {
  if (!assetId) return null
  const env = environments.get(assetId)
  if (!env) {
    const asset = useAssetStore.getState().assets[assetId]
    if (asset && asset.kind === 'environment' && environmentFailures.shouldTry(assetId, asset.hash)) {
      void loadEnvironmentAsset(asset).catch(() => undefined)
    }
    return null
  }
  return env
}

export function textureLoadSource(assetId: string): 'bc7' | 'base' | 'source' | null {
  return imageSources.get(assetId) ?? null
}

export function textureLoadBytes(assetId: string): number {
  return imageArtifactBytes.get(assetId) ?? 0
}

export function textureReadMs(assetId: string): number {
  return imageReadMs.get(assetId) ?? 0
}

export function releaseTexture(assetId: string) {
  images.get(assetId)?.dispose()
  images.delete(assetId)
  imageHashes.delete(assetId)
  imageSources.delete(assetId)
  imageArtifactBytes.delete(assetId)
  imageReadMs.delete(assetId)
  linearImages.get(assetId)?.dispose()
  linearImages.delete(assetId)
  unityMrImages.get(assetId)?.dispose()
  unityMrImages.delete(assetId)
  unityMrPending.delete(assetId)
  unityMrDirect.delete(assetId)
  unityMrDirectMiss.delete(assetId)
  unityMrInfo.delete(assetId)
  pendingImages.delete(assetId)
  environments.get(assetId)?.dispose()
  environments.delete(assetId)
  pendingEnvironments.delete(assetId)
  degradedTextures.delete(assetId)
}

export function loadEnvironmentAsset(asset: FileAsset): Promise<void> {
  if (environments.has(asset.id)) return Promise.resolve()
  const running = pendingEnvironments.get(asset.id)
  if (running) return running
  const task = ensureAssetUrl(asset.id).then(url => {
    const ext = asset.fileName.split('.').pop()?.toLowerCase()
    const primary = ext === 'exr' ? exrLoader.loadAsync(url) : hdrLoader.loadAsync(url)
    const loading = ext === 'env'
      ? primary.catch(() => exrLoader.loadAsync(url))
      : primary
    return loading.then(texture => {
      texture.mapping = EquirectangularReflectionMapping
      environments.set(asset.id, texture)
      pendingEnvironments.delete(asset.id)
      environmentFailures.clear(asset.id)
      scheduleBump()
    })
  }).catch(error => {
    pendingEnvironments.delete(asset.id)
    environmentFailures.fail(asset.id, asset.hash, asset.name, error)
    throw error
  })
  pendingEnvironments.set(asset.id, task)
  return task
}

export function loadTextureAsset(asset: FileAsset): Promise<void> {
  if (images.has(asset.id)) {
    const cachedHash = imageHashes.get(asset.id)
    if (!cachedHash || !asset.hash || cachedHash === asset.hash) return Promise.resolve()
    releaseTexture(asset.id)
  }
  const running = pendingImages.get(asset.id)
  if (running) return running
  const lower = asset.fileName.toLowerCase()
  const finishBitmap = (texture: Texture) => {
    texture.colorSpace = SRGBColorSpace
    images.set(asset.id, texture)
    imageHashes.set(asset.id, asset.hash)
    linearImages.delete(asset.id)
    // 已经从同一份内容的成品直接读到重排贴图时保留它，不必因为原图后到而重做
    if (unityMrInfo.get(asset.id)?.hash !== asset.hash || !asset.hash) {
      unityMrImages.get(asset.id)?.dispose()
      unityMrImages.delete(asset.id)
      unityMrInfo.delete(asset.id)
      unityMrPending.delete(asset.id)
    }
    pendingImages.delete(asset.id)
    imageFailures.clear(asset.id)
    scheduleBump()
    noteTextureStored()
  }
  const task = (async () => {
    if (lower.endsWith('.ktx2')) {
      const url = await ensureAssetUrl(asset.id)
      if (!ktx2) throw new Error('KTX2 转码器还没就绪')
      const texture = await ktx2.loadAsync(url)
      imageSources.set(asset.id, 'source')
      images.set(asset.id, texture)
      imageHashes.set(asset.id, asset.hash)
      linearImages.delete(asset.id)
      unityMrImages.get(asset.id)?.dispose()
      unityMrImages.delete(asset.id)
      pendingImages.delete(asset.id)
      scheduleBump()
      return
    }
    if (lower.endsWith('.svg')) {
      const url = await ensureAssetUrl(asset.id)
      imageSources.set(asset.id, 'source')
      await loadSvgTexture(asset.id, asset.hash, url)
      return
    }
    if (asset.hash) {
      if (await ensureBc7Readable()) {
        const t0 = performance.now()
        const bc7 = await readTextureArtifact(asset.hash, 'bc7').catch(() => null)
        const readDt = performance.now() - t0
        const unpackedBc7 = bc7 ? unpackBc7Artifact(bc7) : null
        if (unpackedBc7) {
          imageSources.set(asset.id, 'bc7')
          imageArtifactBytes.set(asset.id, bc7!.byteLength)
          imageReadMs.set(asset.id, readDt)
          finishBitmap(buildBc7Texture(unpackedBc7.width, unpackedBc7.height, unpackedBc7.mips, undefined, asset.id))
          return
        }
      }
      const cached = await readTextureArtifact(asset.hash, 'base').catch(() => null)
      const unpacked = cached ? unpackTextureArtifact(cached) : null
      if (unpacked) {
        imageSources.set(asset.id, 'base')
        imageArtifactBytes.set(asset.id, cached!.byteLength)
        const tex = buildDataTexture(unpacked.width, unpacked.height, unpacked.rgba)
        finishBitmap(tex)
        return
      }
    }
    const url = await ensureAssetUrl(asset.id)
    // 解码原图瞬时占用大（一张 4K 图 64MB），同时解码的数量要限住
    const texture = await withDecodeSlot(() => loadBitmapTexture(url))
    imageSources.set(asset.id, 'source')
    finishBitmap(texture)
    if (asset.hash) {
      const image = texture.image as { width?: number, height?: number, naturalWidth?: number, naturalHeight?: number } | undefined
      const width = image?.naturalWidth || image?.width || 0
      const height = image?.naturalHeight || image?.height || 0
      if (image && width > 0 && height > 0) {
        window.setTimeout(() => {
          try {
            const rgba = readUnpremultipliedRgba(image as TexImageSource, width, height)
            void persistTextureCache(asset.hash, width, height, rgba, 'base', 'bc7').catch(error => {
              console.warn('[cache] 贴图成品写入失败', asset.name, error)
            })
          } catch (error) {
            console.warn('[cache] 贴图像素提取失败', asset.name, error)
          }
        }, 0)
      }
    }
  })().catch(error => {
    pendingImages.delete(asset.id)
    imageFailures.fail(asset.id, asset.hash, asset.name, error)
    throw error
  })
  pendingImages.set(asset.id, task)
  return task
}

const MAX_TEXTURE_SIZE = 2048
const MAX_CONCURRENT_DECODES = 3
let activeDecodes = 0
const decodeWaiters: Array<() => void> = []

/** 限制同时解码原图的数量，避免一次要几十张贴图时内存瞬间冲高。 */
async function withDecodeSlot<T>(run: () => Promise<T>): Promise<T> {
  if (activeDecodes >= MAX_CONCURRENT_DECODES) {
    await new Promise<void>(resolve => decodeWaiters.push(resolve))
  } else {
    activeDecodes += 1
  }
  try {
    return await run()
  } finally {
    const next = decodeWaiters.shift()
    // 名额直接交给下一个等待者，不经过计数增减
    if (next) next()
    else activeDecodes -= 1
  }
}

/** 解码成不预乘、不做色彩转换的位图，超过上限尺寸时直接解成缩小后的尺寸。 */
async function decodeBitmap(blob: Blob): Promise<ImageBitmap> {
  const probe = await createImageBitmap(blob, {
    imageOrientation: 'none',
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  })
  const maxDim = Math.max(probe.width, probe.height)
  if (maxDim <= MAX_TEXTURE_SIZE) return probe
  const scale = MAX_TEXTURE_SIZE / maxDim
  const targetW = Math.max(1, Math.round(probe.width * scale))
  const targetH = Math.max(1, Math.round(probe.height * scale))
  probe.close()
  return createImageBitmap(blob, {
    imageOrientation: 'none',
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
    resizeWidth: targetW,
    resizeHeight: targetH,
    resizeQuality: 'high',
  })
}

/**
 * 批量导入用：不把贴图留在内存和显存里，只解码一次、压成 BC7 成品写盘就放掉。
 * 之后第一次用到这张贴图时直接读压缩成品（显存是未压缩的 1/4），不用再解码原图。
 * 显卡不支持 BC7、或是 KTX2 / SVG 时不烘，留到第一次使用时按老流程处理。
 */
export async function bakeTextureArtifact(asset: FileAsset, blob: Blob): Promise<boolean> {
  const lower = asset.fileName.toLowerCase()
  if (!asset.hash || lower.endsWith('.ktx2') || lower.endsWith('.svg')) return false
  if (typeof createImageBitmap !== 'function' || !isBc7Supported()) return false
  return withDecodeSlot(async () => {
    const bitmap = await decodeBitmap(blob)
    try {
      // 宽高不是 4 的倍数压不了 BC7，只能存未压缩成品（一张 2K 图 16MB）；批量导入时不为没用到的贴图占这个盘
      if (bitmap.width < 4 || bitmap.height < 4 || bitmap.width % 4 !== 0 || bitmap.height % 4 !== 0) return false
      const rgba = readUnpremultipliedRgba(bitmap, bitmap.width, bitmap.height)
      await persistTextureCache(asset.hash, bitmap.width, bitmap.height, rgba, 'base', 'bc7')
      return true
    } finally {
      bitmap.close()
    }
  })
}

async function loadBitmapTexture(url: string): Promise<Texture> {
  if (typeof createImageBitmap === 'function') {
    try {
      const response = await fetch(url)
      const blob = await response.blob()
      const bitmap = await decodeBitmap(blob)
      const texture = new Texture(bitmap)
      texture.flipY = false
      texture.needsUpdate = true
      return texture
    } catch {
      // 回退到 TextureLoader
    }
  }
  const texture = await loader.loadAsync(url)
  texture.flipY = false
  texture.needsUpdate = true
  return texture
}

function loadSvgTexture(assetId: string, hash: string, url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      const size = 512
      canvas.width = size
      canvas.height = size
      const context = canvas.getContext('2d')
      if (!context) {
        reject(new Error('无法绘制 SVG'))
        return
      }
      context.drawImage(image, 0, 0, size, size)
      const texture = new CanvasTexture(canvas)
      texture.colorSpace = SRGBColorSpace
      texture.flipY = false
      texture.needsUpdate = true
      images.set(assetId, texture)
      imageHashes.set(assetId, hash)
      linearImages.delete(assetId)
      pendingImages.delete(assetId)
      useAssetStore.getState().bump()
      resolve()
    }
    image.onerror = () => reject(new Error('SVG 读取失败'))
    image.src = url
  })
}
