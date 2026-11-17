import { CanvasTexture, EquirectangularReflectionMapping, NoColorSpace, SRGBColorSpace, Texture, TextureLoader } from 'three'
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js'
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js'
import type { WebGPURenderer } from 'three/webgpu'
import { readFileBytes } from './cache'
import { type FileAsset, useAssetStore } from './library'

const images = new Map<string, Texture>()
const linearImages = new Map<string, Texture>()
const unityMrImages = new Map<string, Texture>()
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
  const texture = images.get(assetId)
  if (!texture) {
    const asset = useAssetStore.getState().assets[assetId]
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
  try {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return base
    ctx.drawImage(source, 0, 0, width, height)
    const imgData = ctx.getImageData(0, 0, width, height)
    const data = imgData.data
    let hasAlphaVariation = false
    const firstAlpha = data[3] ?? 255
    for (let i = 0; i < data.length; i += 4) {
      if (Math.abs((data[i + 3] ?? 255) - firstAlpha) > 2) {
        hasAlphaVariation = true
        break
      }
    }
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]!
      const g = data[i + 1]!
      const a = data[i + 3]!
      // 若贴图 Alpha 全为 255（无透明通道），则用 R 通道作为光滑度来源兜底
      const smoothness = hasAlphaVariation || firstAlpha < 250 ? a : r
      const roughness = 255 - smoothness
      const ao = g > 0 ? g : 255
      data[i] = ao
      data[i + 1] = roughness
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
    return converted
  } catch {
    return base
  }
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
  linearImages.get(assetId)?.dispose()
  linearImages.delete(assetId)
  unityMrImages.get(assetId)?.dispose()
  unityMrImages.delete(assetId)
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
  if (images.has(asset.id)) return Promise.resolve()
  const running = pendingImages.get(asset.id)
  if (running) return running
  const lower = asset.fileName.toLowerCase()
  const task = ensureAssetUrl(asset.id).then(url => {
    if (lower.endsWith('.ktx2')) {
      if (!ktx2) return Promise.reject(new Error('KTX2 转码器还没就绪'))
      return ktx2.loadAsync(url).then(texture => {
        images.set(asset.id, texture)
        linearImages.delete(asset.id)
        unityMrImages.get(asset.id)?.dispose()
        unityMrImages.delete(asset.id)
        pendingImages.delete(asset.id)
        useAssetStore.getState().bump()
      })
    }
    if (lower.endsWith('.svg')) return loadSvgTexture(asset.id, url)
    return loader.loadAsync(url).then(texture => {
      texture.colorSpace = SRGBColorSpace
      images.set(asset.id, texture)
      linearImages.delete(asset.id)
      unityMrImages.get(asset.id)?.dispose()
      unityMrImages.delete(asset.id)
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

function loadSvgTexture(assetId: string, url: string): Promise<void> {
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
      texture.needsUpdate = true
      images.set(assetId, texture)
      linearImages.delete(assetId)
      pendingImages.delete(assetId)
      useAssetStore.getState().bump()
      resolve()
    }
    image.onerror = () => reject(new Error('SVG 读取失败'))
    image.src = url
  })
}
