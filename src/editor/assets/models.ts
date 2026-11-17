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
import { type FileAsset, type MaterialAsset, useAssetStore } from './library'
import { applyModelMaterials, normalizeSlot } from './materials'
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
  tree: ModelTreeNode[]
}

export interface ModelTreeNode {
  name: string
  path: string
  kind: 'bone' | 'mesh' | 'node'
  slotIndices: number[]
  children: ModelTreeNode[]
}

export function describeModelTree(root: Object3D): ModelTreeNode[] {
  const walk = (object: Object3D, parentPath: string): ModelTreeNode | null => {
    const label = object.name || object.type
    const path = parentPath ? `${parentPath}/${label}` : label
    const mesh = object as Mesh
    const bone = object.type === 'Bone' || (object as { isBone?: boolean }).isBone
    const kind: ModelTreeNode['kind'] = bone ? 'bone' : mesh.isMesh ? 'mesh' : 'node'
    const rawIndices = mesh.isMesh && Array.isArray(mesh.userData?.t3dSlotIndices)
      ? (mesh.userData.t3dSlotIndices as number[]).filter(index => typeof index === 'number' && index >= 0)
      : []
    const slotIndices = [...new Set(rawIndices)]
    const children = object.children
      .map(child => walk(child, path))
      .filter((child): child is ModelTreeNode => child !== null)
    if (kind === 'node' && children.length === 0) return null
    return { name: object.name || label, path, kind, slotIndices, children }
  }
  return root.children.map(child => walk(child, '')).filter((child): child is ModelTreeNode => child !== null)
}

export function pathOfModelObject(root: Object3D, target: Object3D): string | null {
  const parts: string[] = []
  let cursor: Object3D | null = target
  while (cursor && cursor !== root) {
    parts.push(cursor.name || cursor.type)
    cursor = cursor.parent
  }
  if (cursor !== root || parts.length === 0) return null
  parts.reverse()
  return parts.join('/')
}

export function findModelObject(root: Object3D, key: string): Object3D | null {
  let found: Object3D | null = null
  const walk = (object: Object3D, parentPath: string) => {
    if (found) return
    const label = object.name || object.type
    const path = parentPath ? `${parentPath}/${label}` : label
    if (path === key) {
      found = object
      return
    }
    for (const child of object.children) walk(child, path)
  }
  for (const child of root.children) walk(child, '')
  return found
}

export function slotIndicesOfModelObject(object: Object3D): number[] {
  const mesh = object as Mesh
  if (!mesh.isMesh) return []
  const raw = Array.isArray(mesh.userData?.t3dSlotIndices)
    ? (mesh.userData.t3dSlotIndices as number[]).filter(index => typeof index === 'number' && index >= 0)
    : []
  return [...new Set(raw)]
}

export function findModelBone(root: Object3D, key: string): Object3D | null {
  let found: Object3D | null = null
  const walk = (object: Object3D, parentPath: string) => {
    if (found) return
    const label = object.name || object.type
    const path = parentPath ? `${parentPath}/${label}` : label
    const bone = object.type === 'Bone' || (object as { isBone?: boolean }).isBone
    if (bone && (path === key || object.name === key)) {
      found = object
      return
    }
    for (const child of object.children) walk(child, object === root ? '' : path)
  }
  for (const child of root.children) walk(child, '')
  return found
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

export interface ProjectClip {
  assetId: string
  assetName: string
  kind: 'model' | 'animation'
  name: string
  duration: number
}

/** 工程里所有模型和动画资源上的片段。缺目录的会在后台加载。 */
export function projectClips(): ProjectClip[] {
  const out: ProjectClip[] = []
  for (const asset of Object.values(useAssetStore.getState().assets)) {
    if (asset.kind !== 'model' && asset.kind !== 'animation') continue
    for (const name of clipNamesFor(asset.id)) {
      out.push({
        assetId: asset.id,
        assetName: asset.name,
        kind: asset.kind,
        name,
        duration: clipDuration(asset.id, name),
      })
    }
  }
  out.sort((a, b) => a.assetName.localeCompare(b.assetName, 'zh') || a.name.localeCompare(b.name, 'zh'))
  return out
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
    const resolvedSlots = bindSlotsToProjectAssets(template.slots, template.scene, asset.name)
    const nextTemplate = { ...template, slots: resolvedSlots }
    applyModelMaterials(nextTemplate.scene, nextTemplate.slots)
    templates.set(asset.id, nextTemplate)
    revisions.set(asset.id, (revisions.get(asset.id) ?? 0) + 1)
    pending.delete(asset.id)
    releaseHumanoidPlayback(asset.id)
    registerHumanoidSkeletons(asset.id, nextTemplate.humanoid.skeletons)
    rememberHumanoidAvatar(asset.id, nextTemplate.humanoid.avatar)
    rememberHumanoidImportScale(asset.id, nextTemplate, forceSource)
    rememberClipCatalog(asset.id, nextTemplate.clips)
    useAssetStore.getState().bump()
    listeners.forEach(listener => listener())
    return nextTemplate
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

export interface ModelMaterialHint {
  bySlotIndex?: Record<number, string>
  byName?: Record<string, string>
}

const extraExternalFiles = new Map<string, Array<{ name: string; data: Uint8Array }>>()
const modelMaterialHints = new Map<string, ModelMaterialHint>()

export function withFbxCompanions<T>(
  assetId: string,
  files: ReadonlyArray<{ name: string; data: Uint8Array }>,
  run: () => Promise<T>,
  materialHint?: ModelMaterialHint,
): Promise<T> {
  if (files.length > 0) extraExternalFiles.set(assetId, [...files])
  if (materialHint) modelMaterialHints.set(assetId, materialHint)
  return run().finally(() => {
    extraExternalFiles.delete(assetId)
    modelMaterialHints.delete(assetId)
  })
}

export function applyModelMaterialBindings(assetId: string, hint?: ModelMaterialHint): PbrSlot[] | null {
  const template = templates.get(assetId)
  if (!template) return null
  const asset = useAssetStore.getState().assets[assetId]
  const slots = bindSlotsToProjectAssets(template.slots, template.scene, asset?.name ?? '', hint ?? modelMaterialHints.get(assetId))
  template.slots = slots
  applyModelMaterials(template.scene, slots)
  revisions.set(assetId, (revisions.get(assetId) ?? 0) + 1)
  useAssetStore.getState().bump()
  listeners.forEach(listener => listener())
  return slots
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
    if (Array.isArray(mesh.material)) mesh.material = mesh.material.map(material => cloneMaterialWithSlotToken(material))
    else mesh.material = cloneMaterialWithSlotToken(mesh.material)
  })
  applyModelMaterials(object, template.slots)
  return { object, clips: template.clips }
}

function cloneMaterialWithSlotToken(material: Material): Material {
  const next = material.clone()
  if (material.userData?.t3dSlot !== undefined) {
    next.userData = { ...next.userData, t3dSlot: material.userData.t3dSlot }
  }
  return next
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
  const slots = readSlots(scene)
  return { scene, clips, slots, humanoid: describeHumanoid(scene, clips), tree: describeModelTree(scene) }
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

export function normalizeMaterialKey(raw: string): string {
  return raw
    .split(':')
    .pop()!
    .trim()
    .toLowerCase()
    .replace(/\.(?:mat|t3dmat|gm3dmat)$/i, '')
    .replace(/\.\d+$/g, '')
    .replace(/^(?:m|mat|mtl)[_-]+/i, '')
    .replace(/(?:[_-\s]+(?:material|mat|mtl|instance))+$/i, '')
    .replace(/[\s._-]+/g, '')
}

function collectMeshNamesBySlot(root: Object3D): Map<number, string[]> {
  const out = new Map<number, string[]>()
  root.traverse(child => {
    const mesh = child as Mesh
    if (!mesh.isMesh) return
    const meshName = mesh.name || mesh.parent?.name || ''
    if (!meshName) return
    const indices = Array.isArray(mesh.userData?.t3dSlotIndices) ? mesh.userData.t3dSlotIndices as number[] : []
    for (const slotIndex of indices) {
      if (typeof slotIndex !== 'number' || slotIndex < 0) continue
      const list = out.get(slotIndex) ?? []
      if (!list.includes(meshName)) list.push(meshName)
      out.set(slotIndex, list)
    }
  })
  return out
}

function bindSlotsToProjectAssets(
  slots: PbrSlot[],
  root: Object3D,
  modelName: string,
  hint?: ModelMaterialHint,
): PbrSlot[] {
  const assets = useAssetStore.getState().assets
  const materials = Object.values(assets).filter((item): item is MaterialAsset => item.kind === 'material')
  const textures = Object.values(assets).filter((item): item is FileAsset => item.kind === 'texture' && 'fileName' in item)
  const meshNamesBySlot = collectMeshNamesBySlot(root)

  const matByKey = new Map<string, MaterialAsset>()
  for (const mat of materials) {
    const key = normalizeMaterialKey(mat.name)
    if (key && !matByKey.has(key)) matByKey.set(key, mat)
  }

  return slots.map((slot, index) => {
    const candidates = [
      slot.name,
      ...(meshNamesBySlot.get(index) ?? []),
      ...(slots.length === 1 && modelName ? [modelName] : []),
    ].filter(Boolean)

    // 1. 显式绑定或工程现有 MaterialAsset 匹配
    let matchedMat: MaterialAsset | undefined
    const explicitId = hint?.bySlotIndex?.[index]
      ?? candidates.map(name => hint?.byName?.[normalizeMaterialKey(name)]).find(Boolean)
    if (explicitId && assets[explicitId]?.kind === 'material') {
      matchedMat = assets[explicitId] as MaterialAsset
    }
    if (!matchedMat) {
      for (const candidate of candidates) {
        const key = normalizeMaterialKey(candidate)
        if (!key) continue
        const exact = matByKey.get(key)
        if (exact) {
          matchedMat = exact
          break
        }
      }
    }
    if (!matchedMat) {
      for (const candidate of candidates) {
        const key = normalizeMaterialKey(candidate)
        if (!key || key.length < 3) continue
        const suffixMatches = materials.filter(mat => {
          const matKey = normalizeMaterialKey(mat.name)
          return matKey && (matKey.endsWith(key) || key.endsWith(matKey))
        })
        if (suffixMatches.length === 1) {
          matchedMat = suffixMatches[0]
          break
        }
      }
    }
    if (!matchedMat && slots.length === 1 && materials.length === 1) {
      matchedMat = materials[0]
    }

    if (matchedMat) {
      const surface = normalizeSlot(matchedMat.slot)
      const inferred = inferTextureSet(candidates, modelName, textures)
      const mapAssetId = surface.mapAssetId ?? slot.mapAssetId ?? inferred.mapAssetId
      const normalAssetId = surface.normalAssetId ?? slot.normalAssetId ?? inferred.normalAssetId
      const metallicRoughnessAssetId = surface.metallicRoughnessAssetId ?? slot.metallicRoughnessAssetId ?? inferred.metallicRoughnessAssetId
      const emissiveAssetId = surface.emissiveAssetId ?? slot.emissiveAssetId ?? inferred.emissiveAssetId
      const aoAssetId = surface.aoAssetId ?? slot.aoAssetId ?? inferred.aoAssetId
      // 若材质资产本身缺贴图但推断出了贴图，同步补齐到材质资产上
      if (
        (!surface.mapAssetId && mapAssetId)
        || (!surface.normalAssetId && normalAssetId)
        || (!surface.metallicRoughnessAssetId && metallicRoughnessAssetId)
        || (!surface.emissiveAssetId && emissiveAssetId)
        || (!surface.aoAssetId && aoAssetId)
      ) {
        useAssetStore.getState().updateMaterial(matchedMat.id, {
          ...(mapAssetId ? { mapAssetId } : {}),
          ...(normalAssetId ? { normalAssetId } : {}),
          ...(metallicRoughnessAssetId ? { metallicRoughnessAssetId } : {}),
          ...(emissiveAssetId ? { emissiveAssetId } : {}),
          ...(aoAssetId ? { aoAssetId } : {}),
        })
      }
      return {
        ...surface,
        name: slot.name,
        materialAssetId: matchedMat.id,
        mapAssetId,
        normalAssetId,
        metallicRoughnessAssetId,
        emissiveAssetId,
        aoAssetId,
      }
    }

    // 2. 没有匹配到材质球时，按槽位名/网格名/模型名自动推断 PBR 全套贴图
    const inferred = inferTextureSet(candidates, modelName, textures)
    const hasAnyMap = Boolean(
      slot.mapAssetId || inferred.mapAssetId
      || slot.normalAssetId || inferred.normalAssetId
      || slot.metallicRoughnessAssetId || inferred.metallicRoughnessAssetId,
    )
    return {
      ...slot,
      ...(hasAnyMap && slot.color === '#000000' ? { color: '#ffffff' } : {}),
      ...(inferred.unityPacked && !slot.shader ? { shader: 'unity-standard' as const } : {}),
      mapAssetId: slot.mapAssetId ?? inferred.mapAssetId,
      normalAssetId: slot.normalAssetId ?? inferred.normalAssetId,
      metallicRoughnessAssetId: slot.metallicRoughnessAssetId ?? inferred.metallicRoughnessAssetId,
      emissiveAssetId: slot.emissiveAssetId ?? inferred.emissiveAssetId,
      aoAssetId: slot.aoAssetId ?? inferred.aoAssetId,
    }
  })
}

function inferTextureSet(
  candidates: string[],
  modelName: string,
  textures: FileAsset[],
): {
  mapAssetId: string | null
  normalAssetId: string | null
  metallicRoughnessAssetId: string | null
  emissiveAssetId: string | null
  aoAssetId: string | null
  unityPacked: boolean
} {
  const stems = [...candidates, modelName]
    .map(normalizeMaterialKey)
    .filter(Boolean)
  let mapAssetId: string | null = null
  let normalAssetId: string | null = null
  let metallicRoughnessAssetId: string | null = null
  let emissiveAssetId: string | null = null
  let aoAssetId: string | null = null
  let unityPacked = false

  for (const stem of stems) {
    for (const tex of textures) {
      const raw = tex.name.trim().toLowerCase().replace(/^t[_-]/i, '')
      const role = classifyTextureRole(raw)
      const baseKey = normalizeMaterialKey(role.base)
      if (!baseKey || (baseKey !== stem && !baseKey.endsWith(stem) && !stem.endsWith(baseKey))) continue
      if (role.kind === 'albedo' && !mapAssetId) mapAssetId = tex.id
      else if (role.kind === 'normal' && !normalAssetId) normalAssetId = tex.id
      else if (role.kind === 'metallic' && !metallicRoughnessAssetId) {
        metallicRoughnessAssetId = tex.id
        if (role.unityPacked) unityPacked = true
      } else if (role.kind === 'emissive' && !emissiveAssetId) emissiveAssetId = tex.id
      else if (role.kind === 'ao' && !aoAssetId) aoAssetId = tex.id
    }
  }
  return { mapAssetId, normalAssetId, metallicRoughnessAssetId, emissiveAssetId, aoAssetId, unityPacked }
}

function classifyTextureRole(name: string): {
  base: string
  kind: 'albedo' | 'normal' | 'metallic' | 'emissive' | 'ao'
  unityPacked?: boolean
} {
  const rules: Array<{ re: RegExp; kind: 'albedo' | 'normal' | 'metallic' | 'emissive' | 'ao'; unityPacked?: boolean }> = [
    { re: /(?:[_-\s]+)(?:normal|norm|nrm|nor|bump|n)$/i, kind: 'normal' },
    { re: /(?:[_-\s]+)(?:metallicgloss|metallicsmoothness|maskmap|mask|ms)$/i, kind: 'metallic', unityPacked: true },
    { re: /(?:[_-\s]+)(?:metallicroughness|metalrough|orm|arm|metallic|metalness|metal|roughness|rough|gloss|m)$/i, kind: 'metallic' },
    { re: /(?:[_-\s]+)(?:emission|emissive|emit|glow|e)$/i, kind: 'emissive' },
    { re: /(?:[_-\s]+)(?:occlusion|ambientocclusion|ao|occ)$/i, kind: 'ao' },
    { re: /(?:[_-\s]+)(?:albedo|basecolor|basemap|maintex|diffuse|color|col|diff|alb|bc|d|c)$/i, kind: 'albedo' },
  ]
  for (const rule of rules) {
    if (rule.re.test(name)) {
      return { base: name.replace(rule.re, ''), kind: rule.kind, unityPacked: rule.unityPacked }
    }
  }
  return { base: name, kind: 'albedo' }
}

function slotFromMaterial(material: Material, seen: Set<string>, index: number): PbrSlot[] {
  const name = material.name || `材质 ${index + 1}`
  if (seen.has(name)) return []
  seen.add(name)
  const standard = material as MeshStandardMaterial
  return [{
    name,
    color: standard.color ? `#${standard.color.getHexString()}` : '#ffffff',
    metalness: standard.metalness ?? 0,
    roughness: standard.roughness ?? 0.5,
    emissive: standard.emissive ? `#${standard.emissive.getHexString()}` : '#000000',
    emissiveIntensity: standard.emissiveIntensity ?? 1,
    opacity: standard.opacity ?? 1,
    ao: standard.aoMapIntensity ?? 1,
    mapAssetId: null,
    normalAssetId: null,
    metallicRoughnessAssetId: null,
    emissiveAssetId: null,
    aoAssetId: null,
  }]
}
