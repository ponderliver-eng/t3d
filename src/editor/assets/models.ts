import { AnimationClip, Group, Mesh, MeshStandardMaterial, Object3D, type BufferGeometry, type Material } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'
import type { PbrSlot } from '../scene/types'
import { type FileAsset, useAssetStore } from './library'

export interface ModelTemplate {
  scene: Group
  clips: AnimationClip[]
  slots: PbrSlot[]
}

const templates = new Map<string, ModelTemplate>()
const pending = new Map<string, Promise<ModelTemplate>>()
const listeners = new Set<() => void>()

export function subscribeModels(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getModelTemplate(assetId: string): ModelTemplate | undefined {
  return templates.get(assetId)
}

export function clipNamesFor(assetId: string | null): string[] {
  if (!assetId) return []
  return templates.get(assetId)?.clips.map(clip => clip.name) ?? []
}

export function loadModelTemplate(asset: FileAsset): Promise<ModelTemplate> {
  const cached = templates.get(asset.id)
  if (cached) return Promise.resolve(cached)
  const running = pending.get(asset.id)
  if (running) return running
  const promise = loadByExtension(asset).then(template => {
    templates.set(asset.id, template)
    pending.delete(asset.id)
    useAssetStore.getState().bump()
    listeners.forEach(listener => listener())
    return template
  }).catch(error => {
    pending.delete(asset.id)
    throw error
  })
  pending.set(asset.id, promise)
  return promise
}

export function instantiateModel(assetId: string): { object: Object3D, clips: AnimationClip[] } | null {
  const template = templates.get(assetId)
  if (!template) return null
  const object = cloneSkinned(template.scene)
  object.traverse(child => {
    const mesh = child as Mesh
    if (!mesh.isMesh) return
    mesh.castShadow = true
    mesh.receiveShadow = true
    if (Array.isArray(mesh.material)) mesh.material = mesh.material.map(material => material.clone())
    else mesh.material = mesh.material.clone()
  })
  return { object, clips: template.clips }
}

function loadByExtension(asset: FileAsset): Promise<ModelTemplate> {
  const ext = asset.fileName.split('.').pop()?.toLowerCase()
  if (ext === 'obj') {
    return loadWith<Group>(new OBJLoader(), asset.url).then(object => templateFromObject(object, []))
  }
  if (ext === 'stl') {
    return loadWith<BufferGeometry>(new STLLoader(), asset.url).then(geometry => {
      const mesh = new Mesh(geometry, new MeshStandardMaterial({ color: '#d5dde6', roughness: 0.6, metalness: 0.04 }))
      mesh.name = asset.name
      return templateFromObject(mesh, [])
    })
  }
  if (ext === 'fbx') {
    return loadWith<Group>(new FBXLoader(), asset.url).then(object => templateFromObject(object, object.animations ?? []))
  }
  return loadWith<{ scene: Group, animations: AnimationClip[] }>(new GLTFLoader(), asset.url).then(gltf => templateFromObject(gltf.scene, gltf.animations))
}

function loadWith<T>(loader: { load: (...args: never[]) => void }, url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    loader.load(url as never, resolve as never, undefined as never, reject as never)
  })
}

function templateFromObject(object: Object3D, clips: AnimationClip[]): ModelTemplate {
  let scene: Group
  if (object instanceof Group) scene = object
  else {
    scene = new Group()
    scene.add(object)
  }
  return { scene, clips, slots: readSlots(scene) }
}

function readSlots(root: Object3D): PbrSlot[] {
  const slots: PbrSlot[] = []
  const seen = new Set<string>()
  root.traverse(child => {
    const mesh = child as Mesh
    if (!mesh.isMesh) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials) slots.push(...slotFromMaterial(material, seen, slots.length))
  })
  return slots
}

function slotFromMaterial(material: Material, seen: Set<string>, index: number): PbrSlot[] {
  const name = material.name || `材质 ${index + 1}`
  if (seen.has(name)) return []
  seen.add(name)
  const standard = material as MeshStandardMaterial
  return [{
    name,
    color: standard.color ? `#${standard.color.getHexString()}` : '#d5dde6',
    metalness: standard.metalness ?? 0,
    roughness: standard.roughness ?? 1,
    emissive: standard.emissive ? `#${standard.emissive.getHexString()}` : '#000000',
    emissiveIntensity: standard.emissiveIntensity ?? 1,
    opacity: standard.opacity ?? 1,
    ao: standard.aoMapIntensity ?? 1,
    mapAssetId: null,
    normalAssetId: null,
    roughnessAssetId: null,
    metalnessAssetId: null,
    emissiveAssetId: null,
    aoAssetId: null,
  }]
}
