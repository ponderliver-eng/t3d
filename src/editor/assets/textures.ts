import { EquirectangularReflectionMapping, NoColorSpace, SRGBColorSpace, Texture, TextureLoader } from 'three'
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js'
import type { WebGPURenderer } from 'three/webgpu'
import { type FileAsset, useAssetStore } from './library'

const images = new Map<string, Texture>()
const environments = new Map<string, Texture>()
const loader = new TextureLoader()
const hdrLoader = new RGBELoader()
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

export function loadEnvironmentAsset(asset: FileAsset): Promise<void> {
  if (environments.has(asset.id)) return Promise.resolve()
  return hdrLoader.loadAsync(asset.url).then(texture => {
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
  return loader.loadAsync(asset.url).then(texture => {
    texture.colorSpace = SRGBColorSpace
    images.set(asset.id, texture)
    useAssetStore.getState().bump()
  })
}
