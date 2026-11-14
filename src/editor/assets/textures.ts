import { CanvasTexture, EquirectangularReflectionMapping, NoColorSpace, SRGBColorSpace, Texture, TextureLoader } from 'three'
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js'
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js'
import type { WebGPURenderer } from 'three/webgpu'
import { type FileAsset, useAssetStore } from './library'

const images = new Map<string, Texture>()
const environments = new Map<string, Texture>()
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

export function textureFor(assetId: string | null, colorMap: boolean): Texture | null {
  if (!assetId) return null
  const texture = images.get(assetId)
  if (!texture) return null
  texture.colorSpace = colorMap ? SRGBColorSpace : NoColorSpace
  return texture
}

export function environmentFor(assetId: string | null): Texture | null {
  if (!assetId) return null
  return environments.get(assetId) ?? null
}

export function releaseTexture(assetId: string) {
  images.get(assetId)?.dispose()
  images.delete(assetId)
  environments.get(assetId)?.dispose()
  environments.delete(assetId)
}

export function loadEnvironmentAsset(asset: FileAsset): Promise<void> {
  if (environments.has(asset.id)) return Promise.resolve()
  const ext = asset.fileName.split('.').pop()?.toLowerCase()
  const primary = ext === 'exr' ? exrLoader.loadAsync(asset.url) : hdrLoader.loadAsync(asset.url)
  const loading = ext === 'env'
    ? primary.catch(() => exrLoader.loadAsync(asset.url))
    : primary
  return loading.then(texture => {
    texture.mapping = EquirectangularReflectionMapping
    environments.set(asset.id, texture)
    useAssetStore.getState().bump()
  })
}

export function loadTextureAsset(asset: FileAsset): Promise<void> {
  if (images.has(asset.id)) return Promise.resolve()
  const lower = asset.fileName.toLowerCase()
  if (lower.endsWith('.ktx2')) {
    if (!ktx2) return Promise.reject(new Error('KTX2 转码器还没就绪'))
    return ktx2.loadAsync(asset.url).then(texture => {
      images.set(asset.id, texture)
      useAssetStore.getState().bump()
    })
  }
  if (lower.endsWith('.svg')) return loadSvgTexture(asset)
  return loader.loadAsync(asset.url).then(texture => {
    texture.colorSpace = SRGBColorSpace
    images.set(asset.id, texture)
    useAssetStore.getState().bump()
  })
}

function loadSvgTexture(asset: FileAsset): Promise<void> {
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
      images.set(asset.id, texture)
      useAssetStore.getState().bump()
      resolve()
    }
    image.onerror = () => reject(new Error('SVG 读取失败'))
    image.src = asset.url
  })
}
