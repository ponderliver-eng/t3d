import { AnimationClip, Group, Mesh, MeshStandardMaterial, Object3D, Vector3, type BufferGeometry, type Material } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js'
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'
import { TDSLoader } from 'three/addons/loaders/TDSLoader.js'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'
import type { PbrSlot } from '../scene/types'
import { boundsOf } from '../scene/bounds'
import { patchAssetMeta, readFileBytes, readModelArtifact, writeModelArtifact } from './cache'
import { type FileAsset, useAssetStore } from './library'
import { mergedHumanoidSlots, preserveHumanoidAvatarOverrides } from '../animation/humanoidAvatar'
import { bindHumanoidClip } from '../animation/humanoidRetarget'
import { releaseHumanoidPlayback } from '../animation/humanoidPlayback'
import { describeHumanoid, forgetHumanoidSkeletons, registerHumanoidSkeletons, type ModelHumanoid } from '../animation/humanoidRig'
import { convertFbxBytesToGlbWithUfbx } from './ufbx/ufbxToGlb'

export interface ModelTemplate {
  scene: Group
  clips: AnimationClip[]
  slots: PbrSlot[]
  humanoid: ModelHumanoid
}

const templates = new Map<string, ModelTemplate>()
const pending = new Map<string, Promise<ModelTemplate>>()
const revisions = new Map<string, number>()
const listeners = new Set<() => void>()

export function modelRevision(assetId: string): number {
  return revisions.get(assetId) ?? 0
}

export function subscribeModels(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getModelTemplate(assetId: string): ModelTemplate | undefined {
  const existing = templates.get(assetId)
  if (existing) return existing
  const asset = useAssetStore.getState().assets[assetId]
  if (asset && (asset.kind === 'model' || asset.kind === 'animation')) {
    void loadModelTemplate(asset).catch(() => undefined)
  }
  return undefined
}

export function releaseModel(assetId: string) {
  templates.delete(assetId)
  pending.delete(assetId)
  forgetHumanoidSkeletons(assetId)
  releaseHumanoidPlayback(assetId)
}

export function clipNamesFor(assetId: string | null): string[] {
  if (!assetId) return []
  const template = templates.get(assetId)
  if (template) return template.clips.map(clip => clip.name)
  const asset = useAssetStore.getState().assets[assetId]
  if (asset && 'clipCatalog' in asset && asset.clipCatalog?.length) {
    return asset.clipCatalog.map(entry => entry.name)
  }
  if (asset && (asset.kind === 'model' || asset.kind === 'animation')) {
    void loadModelTemplate(asset).catch(() => undefined)
  }
  return []
}

export function clipDuration(assetId: string | null, name: string): number {
  if (!assetId || !name) return 0
  const template = templates.get(assetId)
  if (template) return template.clips.find(clip => clip.name === name)?.duration ?? 0
  const asset = useAssetStore.getState().assets[assetId]
  if (asset && 'clipCatalog' in asset && asset.clipCatalog?.length) {
    return asset.clipCatalog.find(entry => entry.name === name)?.duration ?? 0
  }
  return 0
}

export function loadModelTemplate(asset: FileAsset, forceSource = false): Promise<ModelTemplate> {
  if (forceSource) {
    templates.delete(asset.id)
    pending.delete(asset.id)
  }
  const cached = templates.get(asset.id)
  if (cached) return Promise.resolve(cached)
  const running = pending.get(asset.id)
  if (running) return running
  const promise = (forceSource ? loadFromSource(asset) : loadCachedOrSource(asset)).then(template => {
    templates.set(asset.id, template)
    revisions.set(asset.id, (revisions.get(asset.id) ?? 0) + 1)
    pending.delete(asset.id)
    releaseHumanoidPlayback(asset.id)
    registerHumanoidSkeletons(asset.id, template.humanoid.skeletons)
    rememberHumanoidAvatar(asset.id, template.humanoid.avatar)
    rememberHumanoidImportScale(asset.id, template, forceSource)
    rememberClipCatalog(asset.id, template.clips)
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

/** 把已加载的动画资源按现有人形重定向写进模型自己的片段。 */
export function retargetClipsOntoModel(bodyId: string, sourceId: string, preferredName?: string): number {
  const body = templates.get(bodyId)
  const source = templates.get(sourceId)
  const target = body?.humanoid.profile
  if (!body || !source || !target) return 0
  const bodyAsset = useAssetStore.getState().assets[bodyId]
  const sourceAsset = useAssetStore.getState().assets[sourceId]
  const targetAvatar = bodyAsset && 'humanoidAvatar' in bodyAsset
    ? preserveHumanoidAvatarOverrides(body.humanoid.avatar, bodyAsset.humanoidAvatar) ?? body.humanoid.avatar
    : body.humanoid.avatar
  const sourceAvatar = sourceAsset && 'humanoidAvatar' in sourceAsset
    ? preserveHumanoidAvatarOverrides(source.humanoid.avatar, sourceAsset.humanoidAvatar) ?? source.humanoid.avatar
    : source.humanoid.avatar
  let added = 0
  for (const clip of source.clips) {
    const bound = bindHumanoidClip({
      clip,
      sourceProfile: source.humanoid.profile,
      sourceSkeletons: source.humanoid.skeletons,
      sourceAvatar,
      targetProfile: target,
      targetSlots: mergedHumanoidSlots(targetAvatar),
      adjust: bodyAsset && 'humanoidRetarget' in bodyAsset ? bodyAsset.humanoidRetarget ?? null : null,
    })
    if (!bound) continue
    const name = source.clips.length === 1 && preferredName ? preferredName : bound.name
    bound.name = uniqueClipName(body.clips, name)
    body.clips.push(bound)
    added += 1
  }
  if (added > 0) {
    rememberClipCatalog(bodyId, body.clips)
    revisions.set(bodyId, (revisions.get(bodyId) ?? 0) + 1)
    useAssetStore.getState().bump()
    listeners.forEach(listener => listener())
  }
  return added
}

function uniqueClipName(clips: AnimationClip[], base: string): string {
  const used = new Set(clips.map(clip => clip.name))
  if (!used.has(base)) return base
  let index = 2
  while (used.has(`${base} ${index}`)) index += 1
  return `${base} ${index}`
}

const extraExternalFiles = new Map<string, Array<{ name: string; data: Uint8Array }>>()

export function withFbxCompanions<T>(assetId: string, files: ReadonlyArray<{ name: string; data: Uint8Array }>, run: () => Promise<T>): Promise<T> {
  if (files.length === 0) return run()
  extraExternalFiles.set(assetId, [...files])
  return run().finally(() => extraExternalFiles.delete(assetId))
}

export function instantiateModel(assetId: string): { object: Object3D, clips: AnimationClip[] } | null {
  const template = getModelTemplate(assetId)
  if (!template) return null
  const object = cloneSkinned(template.scene)
  object.traverse(child => {
    const mesh = child as Mesh
    if (!mesh.isMesh) return
    mesh.castShadow = true
    mesh.receiveShadow = true
    if ((mesh as Mesh & { isSkinnedMesh?: boolean }).isSkinnedMesh) mesh.frustumCulled = false
    if (Array.isArray(mesh.material)) mesh.material = mesh.material.map(material => material.clone())
    else mesh.material = mesh.material.clone()
  })
  return { object, clips: template.clips }
}

function loadCachedOrSource(asset: FileAsset): Promise<ModelTemplate> {
  return loadArtifact(asset).then(template => template ?? loadFromSource(asset))
}

function loadFromSource(asset: FileAsset): Promise<ModelTemplate> {
  return ensureSourceUrl(asset).then(source => loadByExtension(source)).then(template => {
    const ext = asset.fileName.split('.').pop()?.toLowerCase()
    if (asset.hash && ext !== 'fbx') void storeModelArtifact(asset, template)
    return template
  })
}

async function loadArtifact(asset: FileAsset): Promise<ModelTemplate | null> {
  if (!asset.hash) return null
  try {
    const glb = await readModelArtifact(asset.hash)
    if (!glb) return null
    return await parseArtifact(glb)
  } catch (error) {
    console.warn('[cache] 模型成品不可用，改为解析源文件', asset.name, error)
    return null
  }
}

async function ensureSourceUrl(asset: FileAsset): Promise<FileAsset> {
  if (asset.url) return asset
  const bytes = await readFileBytes(asset.id)
  if (!bytes) throw new Error('缓存里没有源文件')
  const url = URL.createObjectURL(new Blob([bytes]))
  useAssetStore.getState().patch(asset.id, { url })
  return { ...asset, url }
}

function parseArtifact(data: ArrayBuffer): Promise<ModelTemplate> {
  const loader = new GLTFLoader()
  loader.setMeshoptDecoder(MeshoptDecoder)
  const payload = isGlb(data) ? data : new TextDecoder().decode(data)
  return new Promise((resolve, reject) => {
    loader.parse(payload, '', gltf => resolve(templateFromObject(gltf.scene, gltf.animations)), reject)
  })
}

function isGlb(data: ArrayBuffer): boolean {
  if (data.byteLength < 4) return false
  return new TextDecoder().decode(new Uint8Array(data, 0, 4)) === 'glTF'
}

async function storeModelArtifact(asset: FileAsset, template: ModelTemplate) {
  if (!asset.hash) return
  try {
    const ext = asset.fileName.split('.').pop()?.toLowerCase()
    const bytes = ext === 'glb' || ext === 'gltf'
      ? await sourceBytes(asset)
      : await exportGlb(template).then(exported => exported ? compressMeshopt(exported) : null)
    if (!bytes) return
    await writeModelArtifact(asset.hash, bytes)
    await patchAssetMeta(asset.id, { artifactReady: true })
  } catch (error) {
    console.warn('[cache] 模型成品写入失败', error)
  }
}

async function sourceBytes(asset: FileAsset): Promise<ArrayBuffer | null> {
  if (asset.url) return fetch(asset.url).then(response => response.arrayBuffer())
  return readFileBytes(asset.id)
}

async function exportGlb(template: ModelTemplate): Promise<ArrayBuffer | null> {
  const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js')
  const exporter = new GLTFExporter()
  const data = await exporter.parseAsync(template.scene, {
    binary: true,
    animations: template.clips,
    onlyVisible: false,
  })
  if (data instanceof ArrayBuffer) return data
  if (ArrayBuffer.isView(data)) {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
  }
  return null
}

async function compressMeshopt(glb: ArrayBuffer): Promise<ArrayBuffer> {
  try {
    const [{ WebIO }, { meshopt, reorder }, { EXTMeshoptCompression, KHRMeshQuantization }, { MeshoptEncoder }] = await Promise.all([
      import('@gltf-transform/core'),
      import('@gltf-transform/functions'),
      import('@gltf-transform/extensions'),
      import('meshoptimizer'),
    ])
    await MeshoptEncoder.ready
    const io = new WebIO()
      .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
      .registerDependencies({ 'meshopt.encoder': MeshoptEncoder })
    const document = await io.readBinary(new Uint8Array(glb))
    const hasSkin = document.getRoot().listSkins().length > 0
    if (hasSkin) {
      await document.transform(reorder({ encoder: MeshoptEncoder, target: 'size' }))
      document
        .createExtension(EXTMeshoptCompression)
        .setRequired(true)
        .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER })
    } else {
      await document.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }))
    }
    const compressed = await io.writeBinary(document)
    if (compressed.byteLength === 0 || compressed.byteLength >= glb.byteLength) return glb
    return compressed.buffer.slice(compressed.byteOffset, compressed.byteOffset + compressed.byteLength)
  } catch (error) {
    console.warn('[cache] meshopt 压缩失败，改存未压缩成品', error)
    return glb
  }
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
    return loadFbxWithUfbx(asset).catch(error => {
      console.warn('[fbx] ufbx 转换失败，回退 FBXLoader', asset.fileName, error)
      return loadWith<Group>(new FBXLoader(), asset.url).then(object => templateFromObject(object, object.animations ?? []))
    })
  }
  if (ext === 'dae') {
    return loadWith<{ scene: Object3D, animations?: AnimationClip[] }>(new ColladaLoader(), asset.url)
      .then(collada => templateFromObject(collada.scene, collada.animations ?? []))
  }
  if (ext === '3ds') {
    return loadWith<Group>(new TDSLoader(), asset.url).then(object => templateFromObject(object, []))
  }
  return loadWith<{ scene: Group, animations: AnimationClip[] }>(new GLTFLoader(), asset.url).then(gltf => templateFromObject(gltf.scene, gltf.animations))
}

function loadWith<T>(loader: { load: (...args: never[]) => void }, url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    loader.load(url as never, resolve as never, undefined as never, reject as never)
  })
}

async function collectProjectTextureFiles(): Promise<Array<{ name: string; data: Uint8Array }>> {
  const assets = Object.values(useAssetStore.getState().assets)
  const textures = assets.filter((item): item is FileAsset => item.kind === 'texture' && 'fileName' in item)
  const out: Array<{ name: string; data: Uint8Array }> = []
  for (const tex of textures) {
    try {
      const bytes = await sourceBytes(tex)
      if (!bytes || bytes.byteLength === 0) continue
      const data = new Uint8Array(bytes)
      out.push({ name: tex.fileName, data })
      if (tex.name && tex.name !== tex.fileName) {
        const ext = tex.fileName.split('.').pop() ?? 'png'
        out.push({ name: `${tex.name}.${ext}`, data })
      }
    } catch {
      // ignore unreadable texture
    }
  }
  return out
}

async function loadFbxWithUfbx(asset: FileAsset): Promise<ModelTemplate> {
  const [bytes, externalFiles] = await Promise.all([
    sourceBytes(asset),
    collectProjectTextureFiles(),
  ])
  if (!bytes) throw new Error('无法读取 FBX 字节')
  const glb = await convertFbxBytesToGlbWithUfbx(new Uint8Array(bytes), {
    logicalFileName: asset.fileName,
    externalFiles: [...externalFiles, ...(extraExternalFiles.get(asset.id) ?? [])],
  })
  const template = await parseArtifact(glb)
  if (asset.hash) {
    void compressMeshopt(glb).then(async compressed => {
      await writeModelArtifact(asset.hash, compressed)
      await patchAssetMeta(asset.id, { artifactReady: true })
    }).catch(error => {
      console.warn('[cache] FBX 成品写入失败', error)
    })
  }
  return template
}

function templateFromObject(object: Object3D, clips: AnimationClip[]): ModelTemplate {
  let scene: Group
  if (object instanceof Group) scene = object
  else {
    scene = new Group()
    scene.add(object)
  }
  return { scene, clips, slots: readSlots(scene), humanoid: describeHumanoid(scene, clips) }
}

function rememberClipCatalog(assetId: string, clips: AnimationClip[]) {
  const catalog = clips.filter(clip => clip.name).map(clip => ({ name: clip.name, duration: clip.duration }))
  if (catalog.length === 0) return
  const asset = useAssetStore.getState().assets[assetId]
  if (!asset || !('fileName' in asset)) return
  if (JSON.stringify(asset.clipCatalog ?? null) === JSON.stringify(catalog)) return
  useAssetStore.getState().patch(assetId, { clipCatalog: catalog })
  void patchAssetMeta(assetId, { clipCatalog: catalog })
}

function inferHumanoidImportScale(template: ModelTemplate): number {
  const slots = template.humanoid.avatar?.slots
  if (!slots?.Hips) return 1
  const box = boundsOf(template.scene)
  if (box.isEmpty()) return 1
  const size = box.getSize(new Vector3())
  const height = Math.max(0, size.y)
  if (height >= 0.008 && height < 0.04) return 100
  if (height >= 0.04 && height < 0.45) return 10
  if (height > 8 && height <= 20) return 0.1
  if (height > 20 && height < 400) return 0.01
  return 1
}

function rememberHumanoidImportScale(assetId: string, template: ModelTemplate, forceRecalc = false) {
  const asset = useAssetStore.getState().assets[assetId]
  if (!asset || !('fileName' in asset)) return
  const existing = typeof asset.importScale === 'number' && asset.importScale > 0 ? asset.importScale : undefined
  if (existing !== undefined && existing !== 1 && !forceRecalc) return
  const recommended = inferHumanoidImportScale(template)
  if (recommended === 1) return
  if (existing !== undefined && existing !== 1) {
    const rawHeight = Math.max(0, boundsOf(template.scene).getSize(new Vector3()).y)
    const effective = rawHeight * existing
    if (effective >= 0.45 && effective <= 20) return
  }
  useAssetStore.getState().patch(assetId, { importScale: recommended })
  void patchAssetMeta(assetId, { importScale: recommended })
}

function rememberHumanoidAvatar(assetId: string, built: ModelHumanoid['avatar']) {
  const asset = useAssetStore.getState().assets[assetId]
  if (!asset || !('fileName' in asset)) return
  const next = preserveHumanoidAvatarOverrides(built, asset.humanoidAvatar ?? null) ?? built
  if (!next || JSON.stringify(next) === JSON.stringify(asset.humanoidAvatar ?? null)) return
  useAssetStore.getState().patch(assetId, { humanoidAvatar: next })
  void patchAssetMeta(assetId, { humanoidAvatar: next })
}

function readSlots(root: Object3D): PbrSlot[] {
  const slots: PbrSlot[] = []
  const seen = new Set<string>()
  root.traverse(child => {
    const mesh = child as Mesh
    if (!mesh.isMesh) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    const indices: number[] = []
    for (const material of materials) {
      if (!material) {
        indices.push(-1)
        continue
      }
      const added = slotFromMaterial(material, seen, slots.length)
      if (added.length > 0) {
        const index = slots.length
        slots.push(...added)
        material.userData.t3dSlot = index
        indices.push(index)
      } else {
        const index = slots.findIndex(slot => slot.name === material.name)
        material.userData.t3dSlot = index
        indices.push(index)
      }
    }
    mesh.userData.t3dSlotIndices = indices
  })
  return slots
}

function matchProjectTexture(slotName: string): string | null {
  const clean = slotName.split(':').pop()?.trim().toLowerCase().replace(/^mat[_-]?/i, '') ?? ''
  if (!clean) return null
  const textures = Object.values(useAssetStore.getState().assets).filter(
    (item): item is FileAsset => item.kind === 'texture' && 'fileName' in item,
  )
  for (const tex of textures) {
    const stem = tex.name.trim().toLowerCase()
    if (stem === clean || stem === `masa_${clean}`) return tex.id
  }
  return null
}

function slotFromMaterial(material: Material, seen: Set<string>, index: number): PbrSlot[] {
  const name = material.name || `材质 ${index + 1}`
  if (seen.has(name)) return []
  seen.add(name)
  const standard = material as MeshStandardMaterial
  const matchedMap = !standard.map ? matchProjectTexture(name) : null
  return [{
    name,
    color: standard.color ? `#${standard.color.getHexString()}` : '#d5dde6',
    metalness: standard.metalness ?? 0,
    roughness: standard.roughness ?? 1,
    emissive: standard.emissive ? `#${standard.emissive.getHexString()}` : '#000000',
    emissiveIntensity: standard.emissiveIntensity ?? 1,
    opacity: standard.opacity ?? 1,
    ao: standard.aoMapIntensity ?? 1,
    mapAssetId: matchedMap,
    normalAssetId: null,
    metallicRoughnessAssetId: null,
    emissiveAssetId: null,
    aoAssetId: null,
  }]
}
