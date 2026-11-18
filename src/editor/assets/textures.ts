import { CanvasTexture, DataTexture, EquirectangularReflectionMapping, NoColorSpace, RGBAFormat, SRGBColorSpace, Texture, TextureLoader, UnsignedByteType } from 'three'
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js'
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js'
import type { WebGPURenderer } from 'three/webgpu'
import { readFileBytes } from './cache'
import { type FileAsset, useAssetStore } from './library'

const images = new Map<string, Texture>()
const imageHashes = new Map<string, string>()
const linearImages = new Map<string, Texture>()
const unityMrImages = new Map<string, Texture>()
const unityMrPending = new Set<string>()
const pendingImages = new Map<string, Promise<void>>()
const environments = new Map<string, Texture>()
const pendingEnvironments = new Map<string, Promise<void>>()
const loader = new TextureLoader()
const hdrLoader = new RGBELoader()
const exrLoader = new EXRLoader()
let ktx2: KTX2Loader | null = null

export function bindTextureRenderer(renderer: WebGPURenderer) {
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
    if (asset && asset.kind === 'texture') void loadTextureAsset(asset).catch(() => undefined)
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
  const { id, bitmap } = e.data;
  try {
    const w = bitmap.width, h = bitmap.height;
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const img = ctx.getImageData(0, 0, w, h);
    const data = img.data;
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

function scheduleUnityRepack(assetId: string, base: Texture, source: CanvasImageSource, width: number, height: number) {
  if (unityMrPending.has(assetId)) return
  unityMrPending.add(assetId)
  const finishWithBuffer = (w: number, h: number, buffer: ArrayBuffer) => {
    const converted = new DataTexture(new Uint8Array(buffer), w, h, RGBAFormat, UnsignedByteType)
    converted.colorSpace = NoColorSpace
    converted.flipY = base.flipY
    converted.wrapS = base.wrapS
    converted.wrapT = base.wrapT
    converted.generateMipmaps = true
    converted.needsUpdate = true
    unityMrImages.set(assetId, converted)
    unityMrPending.delete(assetId)
    useAssetStore.getState().bump()
  }
  const worker = getRepackWorker()
  if (worker && typeof createImageBitmap === 'function') {
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
      useAssetStore.getState().bump()
    } catch {
      unityMrPending.delete(assetId)
    }
  }, 0)
}

/**
 * Unity Standard / URP MaskMap 金属光滑图重排为 Three.js / glTF ORM 贴图：
 * - Unity 输入：R = Metallic，G = AO（或 R 副本），A = Smoothness（1 - Roughness）
 * - Three.js 输出：R = AO（取 G），G = Roughness（1 - A），B = Metallic（取 R）
 */
export function unityMetallicRoughnessTextureFor(assetId: string | null): Texture | null {
  if (!assetId) return null
  const packed = unityMrImages.get(assetId)
  if (packed) return packed
  const base = textureFor(assetId, false)
  if (!base) return null
  const source = base.image as (CanvasImageSource & { width?: number, height?: number, naturalWidth?: number, naturalHeight?: number }) | undefined
  const width = source?.naturalWidth || source?.width || 0
  const height = source?.naturalHeight || source?.height || 0
  if (!source || width <= 0 || height <= 0 || typeof document === 'undefined') return base
  scheduleUnityRepack(assetId, base, source, width, height)
  // 重排完成前返回 null，避免先将未重排的原图上传一次 GPU 造成闪烁与双倍显存
  return null
}

export function environmentFor(assetId: string | null): Texture | null {
  if (!assetId) return null
  const env = environments.get(assetId)
  if (!env) {
    const asset = useAssetStore.getState().assets[assetId]
    if (asset && asset.kind === 'environment') void loadEnvironmentAsset(asset).catch(() => undefined)
    return null
  }
  return env
}

export function releaseTexture(assetId: string) {
  images.get(assetId)?.dispose()
  images.delete(assetId)
  imageHashes.delete(assetId)
  linearImages.get(assetId)?.dispose()
  linearImages.delete(assetId)
  unityMrImages.get(assetId)?.dispose()
  unityMrImages.delete(assetId)
  unityMrPending.delete(assetId)
  pendingImages.delete(assetId)
  environments.get(assetId)?.dispose()
  environments.delete(assetId)
  pendingEnvironments.delete(assetId)
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
      useAssetStore.getState().bump()
    })
  }).catch(error => {
    pendingEnvironments.delete(asset.id)
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
  const task = ensureAssetUrl(asset.id).then(url => {
    if (lower.endsWith('.ktx2')) {
      if (!ktx2) return Promise.reject(new Error('KTX2 转码器还没就绪'))
      return ktx2.loadAsync(url).then(texture => {
        images.set(asset.id, texture)
        imageHashes.set(asset.id, asset.hash)
        linearImages.delete(asset.id)
        unityMrImages.get(asset.id)?.dispose()
        unityMrImages.delete(asset.id)
        pendingImages.delete(asset.id)
        useAssetStore.getState().bump()
      })
    }
    if (lower.endsWith('.svg')) return loadSvgTexture(asset.id, asset.hash, url)
    return loadBitmapTexture(url).then(texture => {
      texture.colorSpace = SRGBColorSpace
      images.set(asset.id, texture)
      imageHashes.set(asset.id, asset.hash)
      linearImages.delete(asset.id)
      unityMrImages.get(asset.id)?.dispose()
      unityMrImages.delete(asset.id)
      unityMrPending.delete(asset.id)
      pendingImages.delete(asset.id)
      useAssetStore.getState().bump()
    })
  }).catch(error => {
    pendingImages.delete(asset.id)
    throw error
  })
  pendingImages.set(asset.id, task)
  return task
}

const MAX_TEXTURE_SIZE = 2048

async function loadBitmapTexture(url: string): Promise<Texture> {
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
      if (maxDim > MAX_TEXTURE_SIZE) {
        const scale = MAX_TEXTURE_SIZE / maxDim
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
