import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  AmbientLight,
  AnimationAction,
  AnimationClip,
  AnimationMixer,
  BackSide,
  BoxGeometry,
  CanvasTexture,
  CapsuleGeometry,
  CineonToneMapping,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  EquirectangularReflectionMapping,
  Euler,
  Fog,
  FrontSide,
  Group,
  HemisphereLight,
  LinearToneMapping,
  LoopOnce,
  LoopRepeat,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NeutralToneMapping,
  NoColorSpace,
  NoToneMapping,
  Object3D,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Quaternion,
  Raycaster,
  ReinhardToneMapping,
  RepeatWrapping,
  Scene,
  SphereGeometry,
  SpotLight,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector2,
  Vector3,
} from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js'
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'
import { WebGPURenderer } from 'three/webgpu'
import { normalizeCapabilities, syncCapabilityRuntimes } from '../capabilities/registry'
import { SKY_CAPABILITY_ID } from '../capabilities/sky/defaults'
import { skyFogActive } from '../capabilities/sky/session'
import { compileShaderSource, buildMaterialFromShader, registerShaderTextureResolver, type CompiledShaderAsset } from '../core/codeAssets/shaderRuntime'
import { clearScriptRuntimeState, compileAndRegisterScript } from '../core/codeAssets/scriptRuntime'
import {
  bindGlobalInputListeners,
  injectVirtualInput,
  normalizeInputMap,
  setInputActionMap,
} from '../core/input/actionMap'
import type { BuildLoadingConfig, BuildSettings } from '../core/project/buildSettings'
import type { PbrSlot, SceneNode, ScenePicture, Vec3 } from '../editor/scene/types'
import type { GameDatabase } from '../gameplay/types'
import { activeAnimatorState, stepAnimator } from '../runtime/animation/animator'
import type { HumanoidRetargetAdjust } from '../runtime/animation/humanoidAdjust'
import { mergedHumanoidSlots, preserveHumanoidAvatarOverrides, type ModelHumanoidAvatar } from '../runtime/animation/humanoidAvatar'
import { bindHumanoidClip } from '../runtime/animation/humanoidRetarget'
import { describeHumanoid, type ModelHumanoid } from '../runtime/animation/humanoidRig'
import { lockClipInPlace, maskClip } from '../runtime/animation/playback'
import { attachAudioListener } from '../runtime/audio'
import '../runtime/camera'
import '../runtime/character'
import '../runtime/locomotion'
import '../runtime/devices'
import { RuntimePicturePipeline } from '../runtime/picturePipeline'
import { bumpPlayerUiScene, mountPlayerUiOverlay } from '../runtime/playerUiOverlay'
import '../runtime/rules'
import { stepSceneRuntime, type SceneRuntimeHost } from '../runtime/sceneRuntime'
import '../runtime/soundSource'
import { createVolumeLight } from '../runtime/volumeLight'
import { setRuntimeWorld, type RuntimeAssetSummary, type RuntimeRenderContext, type RuntimeWorld } from '../runtime/world'

interface ExportedAssetEntry extends RuntimeAssetSummary {
  fileName?: string
  importScale?: number
  humanoidAvatar?: ModelHumanoidAvatar | null
  humanoidRetarget?: HumanoidRetargetAdjust | null
  slot?: PbrSlot
  slots?: PbrSlot[]
  document?: unknown
  nodes?: Record<string, SceneNode>
}

interface ExportedSceneEntry {
  id: string
  name: string
  nodes: Record<string, SceneNode>
  picture?: ScenePicture
  requiredAssetIds?: string[]
}

interface ExportedProjectPayload {
  version?: number
  name?: string
  activeSceneId?: string
  entrySceneId?: string
  nodes: Record<string, SceneNode>
  picture?: ScenePicture
  scenes?: Record<string, ExportedSceneEntry>
  sceneOrder?: string[]
  buildSettings?: Partial<BuildSettings>
  capabilities?: Record<string, boolean>
  gameplayPacks?: string[]
  gameDatabase?: GameDatabase
  assets?: Record<string, ExportedAssetEntry>
  scripts?: Array<{ id: string; relativePath: string; source: string }>
  shaders?: Array<{ id: string; relativePath: string; source: string }>
  inputMap?: unknown
}

const DEG_TO_RAD = Math.PI / 180

class PlayerAssetManager {
  private readonly gltfLoader = new GLTFLoader()
  private readonly texLoader = new TextureLoader()
  private readonly hdrLoader = new RGBELoader()
  private readonly exrLoader = new EXRLoader()
  private readonly modelCache = new Map<string, { scene: Group; clips: AnimationClip[]; humanoid: ModelHumanoid }>()
  private readonly texCache = new Map<string, Texture>()
  private readonly linearTexCache = new Map<string, Texture>()
  private readonly unityMrCache = new Map<string, Texture>()
  private readonly envCache = new Map<string, Texture>()
  private readonly pending = new Map<string, Promise<void>>()

  constructor(readonly assets: Record<string, ExportedAssetEntry>) {
    this.gltfLoader.setMeshoptDecoder(MeshoptDecoder)
  }

  getModelClone(assetId: string): { scene: Object3D; clips: AnimationClip[]; humanoid: ModelHumanoid } | null {
    const tpl = this.modelCache.get(assetId)
    if (!tpl) return null
    return { scene: cloneSkinned(tpl.scene), clips: tpl.clips, humanoid: tpl.humanoid }
  }

  getModelTemplate(assetId: string) {
    return this.modelCache.get(assetId) ?? null
  }

  getClips(assetId: string): AnimationClip[] {
    return this.modelCache.get(assetId)?.clips ?? []
  }

  getTexture(assetId: string, srgb = true): Texture | null {
    if (srgb) return this.texCache.get(assetId) ?? null
    const cached = this.linearTexCache.get(assetId)
    if (cached) return cached
    const base = this.texCache.get(assetId)
    if (!base) return null
    const linear = base.clone()
    linear.colorSpace = NoColorSpace
    linear.needsUpdate = true
    this.linearTexCache.set(assetId, linear)
    return linear
  }

  getUnityMetallicRoughnessTexture(assetId: string): Texture | null {
    const cached = this.unityMrCache.get(assetId)
    if (cached) return cached
    const base = this.getTexture(assetId, false)
    if (!base || typeof document === 'undefined') return base
    const image = base.image as { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number } | undefined
    const w = image?.naturalWidth || image?.width || 0
    const h = image?.naturalHeight || image?.height || 0
    if (!image || w <= 0 || h <= 0) return base
    try {
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return base
      ctx.drawImage(image as CanvasImageSource, 0, 0, w, h)
      const imgData = ctx.getImageData(0, 0, w, h)
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
      this.unityMrCache.set(assetId, converted)
      return converted
    } catch {
      return base
    }
  }

  getEnvironment(assetId: string | null | undefined): Texture | null {
    if (!assetId) return null
    return this.envCache.get(assetId) ?? null
  }

  async ensureAsset(assetId: string): Promise<void> {
    if (this.modelCache.has(assetId) || this.texCache.has(assetId) || this.envCache.has(assetId)) return
    const inflight = this.pending.get(assetId)
    if (inflight) return inflight

    const asset = this.assets[assetId]
    if (!asset?.url) return

    const task = (async () => {
      try {
        if (asset.kind === 'model' || asset.kind === 'animation') {
          const gltf = await this.gltfLoader.loadAsync(asset.url!)
          const clips = gltf.animations ?? []
          const humanoid = describeHumanoid(gltf.scene, clips)
          this.modelCache.set(assetId, { scene: gltf.scene, clips, humanoid })
        } else if (asset.kind === 'texture') {
          const lower = (asset.fileName || asset.url || '').toLowerCase()
          if (lower.endsWith('.ktx2') || lower.endsWith('.tga')) return
          const tex = await this.texLoader.loadAsync(asset.url!)
          tex.colorSpace = SRGBColorSpace
          tex.flipY = false
          tex.wrapS = RepeatWrapping
          tex.wrapT = RepeatWrapping
          tex.needsUpdate = true
          this.texCache.set(assetId, tex)
        } else if (asset.kind === 'environment') {
          const ext = (asset.fileName || asset.url || '').split('.').pop()?.toLowerCase()
          const primary = ext === 'exr' ? this.exrLoader.loadAsync(asset.url!) : this.hdrLoader.loadAsync(asset.url!)
          const tex = await (ext === 'env' ? primary.catch(() => this.exrLoader.loadAsync(asset.url!)) : primary)
          tex.mapping = EquirectangularReflectionMapping
          this.envCache.set(assetId, tex)
        }
      } catch (err) {
        console.warn(`[T3D Player] 资源加载失败 (${asset.name}):`, err)
      } finally {
        this.pending.delete(assetId)
      }
    })()

    this.pending.set(assetId, task)
    return task
  }

  async preloadList(
    assetIds: string[],
    onProgress?: (loaded: number, total: number, currentName: string) => void,
  ): Promise<void> {
    const targets = assetIds.filter((id) => {
      const a = this.assets[id]
      return Boolean(a?.url && (a.kind === 'model' || a.kind === 'animation' || a.kind === 'texture' || a.kind === 'environment'))
    })
    const total = targets.length
    if (total === 0) {
      onProgress?.(1, 1, '')
      return
    }
    let done = 0
    const queue = [...targets]
    const workers = Array.from({ length: Math.min(6, total) }, async () => {
      while (queue.length > 0) {
        const id = queue.shift()
        if (!id) break
        const name = this.assets[id]?.name ?? id
        await this.ensureAsset(id)
        done += 1
        onProgress?.(done, total, name)
      }
    })
    await Promise.all(workers)
  }
}

class LoadingOverlay {
  private readonly root: HTMLDivElement
  private readonly barFill: HTMLDivElement | null = null
  private readonly pctLabel: HTMLDivElement | null = null
  private readonly subLabel: HTMLDivElement
  private shownAt = 0

  constructor(
    container: HTMLElement,
    private readonly cfg: BuildLoadingConfig,
    assets: Record<string, ExportedAssetEntry>,
    projectName: string,
  ) {
    this.root = document.createElement('div')
    const bgAsset = cfg.backgroundAssetId ? assets[cfg.backgroundAssetId] : undefined
    const bgImgCss = bgAsset?.url ? `background-image:url("${bgAsset.url}");background-size:cover;background-position:center;` : ''
    this.root.style.cssText = [
      'position:fixed;inset:0;z-index:50;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;',
      `background-color:${cfg.backgroundColor || '#141820'};`,
      bgImgCss,
      'color:#f1f5f9;font-family:"Segoe UI",sans-serif;transition:opacity 240ms ease;opacity:0;pointer-events:none;',
    ].join('')

    const card = document.createElement('div')
    card.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:12px;max-width:420px;width:100%;padding:24px 28px;border-radius:12px;background:rgba(15,23,42,0.72);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,0.08);text-align:center;'

    const logoAsset = cfg.logoAssetId ? assets[cfg.logoAssetId] : undefined
    if (logoAsset?.url) {
      const img = document.createElement('img')
      img.src = logoAsset.url
      img.alt = ''
      img.style.cssText = 'max-width:120px;max-height:72px;object-fit:contain;'
      card.appendChild(img)
    }

    const titleEl = document.createElement('div')
    titleEl.textContent = cfg.title.trim() || projectName || 'Tact3D'
    titleEl.style.cssText = 'font-size:20px;font-weight:700;letter-spacing:0.04em;'
    card.appendChild(titleEl)

    this.subLabel = document.createElement('div')
    this.subLabel.textContent = cfg.subtitle || '正在加载资源…'
    this.subLabel.style.cssText = 'font-size:12px;color:#94a3b8;min-height:18px;'
    card.appendChild(this.subLabel)

    if (cfg.showProgressBar) {
      const track = document.createElement('div')
      track.style.cssText = 'width:100%;height:6px;border-radius:999px;background:rgba(255,255,255,0.12);overflow:hidden;'
      this.barFill = document.createElement('div')
      this.barFill.style.cssText = `width:0%;height:100%;border-radius:999px;background:${cfg.accentColor || '#4a9eff'};transition:width 120ms ease;`
      track.appendChild(this.barFill)
      card.appendChild(track)

      this.pctLabel = document.createElement('div')
      this.pctLabel.textContent = '0%'
      this.pctLabel.style.cssText = 'font-size:11px;color:#cbd5e1;font-variant-numeric:tabular-nums;'
      card.appendChild(this.pctLabel)
    }

    this.root.appendChild(card)
    container.appendChild(this.root)
  }

  show(subtitle?: string) {
    if (!this.cfg.enabled) return
    this.shownAt = performance.now()
    if (subtitle) this.subLabel.textContent = subtitle
    this.setProgress(0, '')
    this.root.style.pointerEvents = 'auto'
    this.root.style.opacity = '1'
  }

  setProgress(ratio: number, currentName?: string) {
    const pct = Math.max(0, Math.min(100, Math.round(ratio * 100)))
    if (this.barFill) this.barFill.style.width = `${pct}%`
    if (this.pctLabel) this.pctLabel.textContent = `${pct}%`
    if (currentName) {
      this.subLabel.textContent = `${this.cfg.subtitle || '正在加载资源…'} (${currentName})`
    }
  }

  async hide() {
    if (!this.cfg.enabled) return
    const elapsed = performance.now() - this.shownAt
    const wait = Math.max(0, (this.cfg.minDisplayMs ?? 350) - elapsed)
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    this.root.style.opacity = '0'
    this.root.style.pointerEvents = 'none'
  }
}

function createGeometryForNode(node: SceneNode) {
  if (node.kind === 'box') return new BoxGeometry(1, 1, 1)
  if (node.kind === 'sphere') return new SphereGeometry(0.5, 32, 24)
  if (node.kind === 'cylinder') return new CylinderGeometry(0.5, 0.5, 1, 24)
  if (node.kind === 'capsule') return new CapsuleGeometry(0.3, 0.5, 6, 16)
  if (node.kind === 'cone') return new ConeGeometry(0.5, 1, 24)
  if (node.kind === 'plane') return new PlaneGeometry(1, 1)
  return null
}

interface PlayerAnimEntry {
  ownerAssetId: string
  rootScene: Object3D
  mixer: AnimationMixer
  actions: Map<string, AnimationAction>
  activeKey: string | null
  activeAction: AnimationAction | null
  upperKey: string | null
  upperAction: AnimationAction | null
  animatorState?: string
  animatorTime?: number
}

function resolvePlayerClipAndAsset(
  ownerAssetId: string,
  clipOrAsset: string,
  explicitAssetId: string | null | undefined,
  assetMgr: PlayerAssetManager,
): { clip: AnimationClip; sourceId: string } | null {
  const raw = (clipOrAsset ?? '').trim()
  if (!raw) return null

  const findInAsset = (id: string, name: string): AnimationClip | undefined => {
    const clips = assetMgr.getClips(id)
    return clips.find((c) => c.name === name) ?? (id !== ownerAssetId && clips.length === 1 ? clips[0] : undefined)
  }

  if (explicitAssetId) {
    const hit = findInAsset(explicitAssetId, raw)
    if (hit) return { clip: hit, sourceId: explicitAssetId }
  }

  // 1. 角色自身模型包含该剪辑
  const selfHit = findInAsset(ownerAssetId, raw)
  if (selfHit) return { clip: selfHit, sourceId: ownerAssetId }

  // 2. 在工程所有 animation / model 资产中按剪辑名查找（优先 animation 资产）
  const entries = Object.values(assetMgr.assets)
  for (const kind of ['animation', 'model'] as const) {
    for (const a of entries) {
      if (a.kind !== kind) continue
      const clips = assetMgr.getClips(a.id)
      const hit = clips.find((c) => c.name === raw)
      if (hit) return { clip: hit, sourceId: a.id }
    }
  }

  // 3. 兜底：若传入的是动画资产 ID 或资产名，则取其首个剪辑
  const byAsset = assetMgr.assets[raw]
    ?? entries.find((a) => (a.kind === 'animation' || a.kind === 'model') && a.name === raw)
  if (byAsset && (byAsset.kind === 'animation' || byAsset.kind === 'model')) {
    const first = assetMgr.getClips(byAsset.id)[0]
    if (first) return { clip: first, sourceId: byAsset.id }
  }

  return null
}

function buildBoundClip(
  rawClip: AnimationClip,
  sourceId: string,
  ownerAssetId: string,
  assetMgr: PlayerAssetManager,
  mask: 'full' | 'upper' | 'lower' = 'full',
  inPlace = false,
): AnimationClip {
  let clip = rawClip
  if (sourceId !== ownerAssetId) {
    const targetTpl = assetMgr.getModelTemplate(ownerAssetId)
    const sourceTpl = assetMgr.getModelTemplate(sourceId)
    const targetAsset = assetMgr.assets[ownerAssetId]
    const sourceAsset = assetMgr.assets[sourceId]
    if (targetTpl?.humanoid.profile) {
      const targetAvatar = preserveHumanoidAvatarOverrides(targetTpl.humanoid.avatar, targetAsset?.humanoidAvatar) ?? targetTpl.humanoid.avatar
      const sourceAvatar = preserveHumanoidAvatarOverrides(sourceTpl?.humanoid.avatar, sourceAsset?.humanoidAvatar) ?? sourceTpl?.humanoid.avatar
      const bound = bindHumanoidClip({
        clip: rawClip,
        sourceProfile: sourceTpl?.humanoid.profile ?? null,
        sourceSkeletons: sourceTpl?.humanoid.skeletons ?? [],
        sourceAvatar,
        targetProfile: targetTpl.humanoid.profile,
        targetSlots: mergedHumanoidSlots(targetAvatar),
        adjust: targetAsset?.humanoidRetarget ?? null,
      })
      if (bound) clip = bound
    }
  }
  if (mask === 'upper') clip = maskClip(clip, 'upperBody')
  else if (mask === 'lower') clip = maskClip(clip, 'lowerBody')
  if (inPlace) clip = lockClipInPlace(clip)
  return clip
}

function resolveSlotData(slot: PbrSlot, assets: Record<string, ExportedAssetEntry>): PbrSlot {
  if (slot.materialAssetId) {
    const linked = assets[slot.materialAssetId]
    if (linked?.slot) return { ...linked.slot, name: slot.name }
  }
  return slot
}

const compiledShaders = new Map<string, CompiledShaderAsset>()

function sideForCull(cull: PbrSlot['cull']) {
  if (cull === 'front') return BackSide
  if (cull === 'off') return DoubleSide
  return FrontSide
}

function slotFromPlayerNode(node: SceneNode, assets: Record<string, ExportedAssetEntry>): PbrSlot {
  if (node.materialAssetId && assets[node.materialAssetId]?.slot) {
    return { ...assets[node.materialAssetId]!.slot!, name: node.name }
  }
  return {
    name: node.name,
    color: node.color || '#8c96a4',
    metalness: node.metalness ?? 0,
    roughness: node.roughness ?? 1,
    emissive: node.emissive ?? '#000000',
    emissiveIntensity: node.emissiveIntensity ?? 0,
    opacity: node.opacity ?? 1,
    ao: node.ao ?? 1,
    mapAssetId: node.mapAssetId ?? null,
    normalAssetId: node.normalAssetId ?? null,
    metallicRoughnessAssetId: node.metallicRoughnessAssetId ?? node.roughnessAssetId ?? node.metalnessAssetId ?? null,
    roughnessAssetId: node.roughnessAssetId ?? null,
    metalnessAssetId: node.metalnessAssetId ?? null,
    emissiveAssetId: node.emissiveAssetId ?? null,
    aoAssetId: node.aoAssetId ?? null,
    materialAssetId: node.materialAssetId ?? null,
    shader: node.shader ?? 'lit',
    shaderParams: (node.capabilities?.__materialShaderParams as Record<string, unknown> | undefined) ?? undefined,
    normalScale: node.normalScale ?? 1,
    alphaMode: node.alphaMode ?? 'opaque',
    alphaCutoff: node.alphaCutoff ?? 0.5,
    cull: node.cull ?? 'back',
    depthWrite: node.depthWrite ?? true,
    wireframe: node.wireframe ?? false,
  }
}

function buildMaterialFromSlot(
  baseMat: Material | null,
  rawSlot: PbrSlot,
  assetMgr: PlayerAssetManager,
  assets: Record<string, ExportedAssetEntry>,
): Material {
  const slot = resolveSlotData(rawSlot, assets)
  const shaderKind = slot.shader ?? 'lit'

  if (shaderKind.startsWith('custom:')) {
    const shaderId = shaderKind.slice('custom:'.length)
    const rec = compiledShaders.get(shaderId)
    if (rec?.definition) {
      const built = buildMaterialFromShader(rec.definition, slot.shaderParams)
      const mat = built.material
      if (baseMat?.name) mat.name = baseMat.name
      if (!rec.definition.doubleSided) mat.side = sideForCull(slot.cull)
      ;(mat as unknown as { wireframe: boolean }).wireframe = Boolean(slot.wireframe)
      return mat
    }
  }

  const isUnlit = shaderKind !== 'lit' && shaderKind !== 'unity-standard'
  const mat: MeshBasicMaterial | MeshStandardMaterial = isUnlit
    ? (baseMat && (baseMat as MeshBasicMaterial).isMeshBasicMaterial
      ? (baseMat as MeshBasicMaterial).clone()
      : new MeshBasicMaterial())
    : (baseMat && (baseMat as MeshStandardMaterial).isMeshStandardMaterial
      ? (baseMat as MeshStandardMaterial).clone()
      : new MeshStandardMaterial())

  if (baseMat?.name) mat.name = baseMat.name
  if (slot.color) mat.color.set(slot.color)

  const alphaMode = slot.alphaMode ?? 'opaque'
  const opacity = typeof slot.opacity === 'number' ? slot.opacity : 1
  if (alphaMode === 'blend') {
    mat.transparent = opacity < 0.999
    mat.opacity = opacity
    mat.alphaTest = 0
    mat.depthWrite = slot.depthWrite ?? false
  } else if (alphaMode === 'clip') {
    mat.transparent = false
    mat.opacity = 1
    mat.alphaTest = slot.alphaCutoff ?? 0.5
    mat.depthWrite = slot.depthWrite ?? true
  } else {
    mat.transparent = false
    mat.opacity = 1
    mat.alphaTest = 0
    mat.depthWrite = slot.depthWrite ?? true
  }

  mat.side = sideForCull(slot.cull)
  mat.wireframe = Boolean(slot.wireframe)

  if (shaderKind !== 'unlit-color') {
    const mapTex = slot.mapAssetId ? assetMgr.getTexture(slot.mapAssetId, true) : null
    if (mapTex) mat.map = mapTex
  } else {
    mat.map = null
  }

  if (!isUnlit) {
    const std = mat as MeshStandardMaterial
    const isUnity = shaderKind === 'unity-standard'
    const mrId = slot.metallicRoughnessAssetId ?? slot.roughnessAssetId ?? slot.metalnessAssetId
    if (typeof slot.roughness === 'number') std.roughness = slot.roughness
    if (typeof slot.metalness === 'number') std.metalness = isUnity && mrId ? 1 : slot.metalness
    if (slot.emissive) std.emissive.set(slot.emissive)
    if (typeof slot.emissiveIntensity === 'number') std.emissiveIntensity = slot.emissiveIntensity
    if (typeof slot.ao === 'number') std.aoMapIntensity = slot.ao
    const nScale = typeof slot.normalScale === 'number' ? slot.normalScale : 1
    if (std.normalScale) std.normalScale.set(nScale, nScale)
    else std.normalScale = new Vector2(nScale, nScale)

    const normalTex = slot.normalAssetId ? assetMgr.getTexture(slot.normalAssetId, false) : null
    if (normalTex) std.normalMap = normalTex

    const mrTex = mrId
      ? (isUnity ? assetMgr.getUnityMetallicRoughnessTexture(mrId) : assetMgr.getTexture(mrId, false))
      : null
    if (mrTex) {
      std.roughnessMap = mrTex
      std.metalnessMap = mrTex
    }

    const emissiveTex = slot.emissiveAssetId ? assetMgr.getTexture(slot.emissiveAssetId, true) : null
    if (emissiveTex) std.emissiveMap = emissiveTex

    const aoId = slot.aoAssetId ?? (isUnity ? mrId : null)
    const aoTex = aoId
      ? (isUnity && aoId === mrId ? assetMgr.getUnityMetallicRoughnessTexture(aoId) : assetMgr.getTexture(aoId, false))
      : null
    if (aoTex) std.aoMap = aoTex
  }

  mat.needsUpdate = true
  return mat
}

function applyPlayerModelMaterials(
  root: Object3D,
  node: SceneNode,
  assetMgr: PlayerAssetManager,
  assets: Record<string, ExportedAssetEntry>,
) {
  const assetSlots = node.assetId && Array.isArray(assets[node.assetId]?.slots) ? assets[node.assetId]!.slots! : []
  const slots = Array.isArray(node.slots) && node.slots.length > 0 ? node.slots : assetSlots
  const overrides = node.partOverrides
  const hiddenSet = new Set(node.hiddenParts ?? [])
  const hasSlotOrMat = slots.length > 0 || Boolean(node.materialAssetId) || Boolean(overrides && Object.keys(overrides).length > 0)
  const indexByName = new Map(slots.map((s, idx) => [s.name, idx]))
  const nodeMatSlot = node.materialAssetId ? assets[node.materialAssetId]?.slot : undefined

  const walk = (object: Object3D, parentPath: string, parentHidden: boolean) => {
    const label = object.name || object.type
    const path = parentPath ? `${parentPath}/${label}` : label
    const isHidden = parentHidden || hiddenSet.has(path)
    const mesh = object as Mesh
    if (mesh.isMesh) {
      mesh.visible = !isHidden
      const ov = overrides?.[path]
      mesh.castShadow = ov?.castShadow ?? Boolean(node.castShadow)
      mesh.receiveShadow = ov?.receiveShadow ?? (node.receiveShadow !== false)

      if (mesh.geometry?.attributes?.uv && !mesh.geometry.attributes.uv2) {
        mesh.geometry.setAttribute('uv2', mesh.geometry.attributes.uv)
      }

      if (hasSlotOrMat) {
        const overrideSlot = ov?.materialAssetId ? assets[ov.materialAssetId]?.slot : undefined
        const existingIndices = Array.isArray(mesh.userData?.t3dSlotIndices)
          ? (mesh.userData.t3dSlotIndices as number[])
          : null
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        const nextMats = mats.map((m, idx) => {
          if (!m) return m
          if (overrideSlot) {
            return buildMaterialFromSlot(m, overrideSlot, assetMgr, assets)
          }
          let slot: PbrSlot | undefined
          const slotIdx = existingIndices?.[idx] ?? indexByName.get(m.name) ?? (slots.length === 1 ? 0 : idx)
          if (typeof slotIdx === 'number' && slotIdx >= 0 && slotIdx < slots.length) {
            slot = slots[slotIdx]
          } else if (nodeMatSlot) {
            slot = nodeMatSlot
          }
          if (slot) return buildMaterialFromSlot(m, slot, assetMgr, assets)
          return m
        })
        mesh.material = Array.isArray(mesh.material) ? nextMats : nextMats[0]
      }
    }
    for (const child of object.children) walk(child, path, isHidden)
  }

  for (const child of root.children) walk(child, '', false)
}

function playBodyOnEntry(
  entry: PlayerAnimEntry,
  clipName: string,
  assetMgr: PlayerAssetManager,
  options?: { assetId?: string | null; loop?: boolean; fade?: number; speed?: number },
) {
  const resolved = resolvePlayerClipAndAsset(entry.ownerAssetId, clipName, options?.assetId, assetMgr)
  if (!resolved) return

  const key = `body\0${resolved.sourceId}\0${resolved.clip.name}`
  let action = entry.actions.get(key)
  if (!action) {
    const bound = buildBoundClip(resolved.clip, resolved.sourceId, entry.ownerAssetId, assetMgr, 'full', false)
    action = entry.mixer.clipAction(bound)
    entry.actions.set(key, action)
  }

  const loop = options?.loop !== false
  action.setLoop(loop ? LoopRepeat : LoopOnce, loop ? Infinity : 1)
  action.clampWhenFinished = !loop
  action.setEffectiveTimeScale(options?.speed ?? 1)
  action.setEffectiveWeight(1)

  if (entry.activeKey === key && entry.activeAction === action) {
    if (!action.isRunning()) action.play()
    return
  }

  const fade = Math.max(0, options?.fade ?? 0.15)
  const prev = entry.activeAction
  action.reset()
  action.enabled = true
  action.paused = false
  action.play()
  if (prev && prev !== action && fade > 0) {
    prev.crossFadeTo(action, fade, false)
  } else if (prev && prev !== action) {
    prev.stop()
  }
  entry.activeKey = key
  entry.activeAction = action
}

function playUpperOnEntry(
  entry: PlayerAnimEntry,
  clipName: string,
  assetMgr: PlayerAssetManager,
  options?: { assetId?: string | null; loop?: boolean; fade?: number; speed?: number },
) {
  const resolved = resolvePlayerClipAndAsset(entry.ownerAssetId, clipName, options?.assetId, assetMgr)
  if (!resolved) return

  const key = `upper\0${resolved.sourceId}\0${resolved.clip.name}`
  let action = entry.actions.get(key)
  if (!action) {
    const bound = buildBoundClip(resolved.clip, resolved.sourceId, entry.ownerAssetId, assetMgr, 'upper', false)
    action = entry.mixer.clipAction(bound)
    entry.actions.set(key, action)
  }

  const loop = options?.loop === true
  action.setLoop(loop ? LoopRepeat : LoopOnce, loop ? Infinity : 1)
  action.clampWhenFinished = !loop
  action.setEffectiveTimeScale(options?.speed ?? 1)
  action.setEffectiveWeight(1)

  const fade = Math.max(0, options?.fade ?? 0.12)
  const prev = entry.upperAction
  action.reset()
  action.enabled = true
  action.paused = false
  action.play()
  if (prev && prev !== action && fade > 0) {
    prev.crossFadeTo(action, fade, false)
  } else if (prev && prev !== action) {
    prev.stop()
  }
  entry.upperKey = key
  entry.upperAction = action
}

function stopUpperOnEntry(entry: PlayerAnimEntry, fade = 0.15) {
  const prev = entry.upperAction
  if (!prev) return
  if (fade > 0) prev.fadeOut(fade)
  else prev.stop()
  entry.upperKey = null
  entry.upperAction = null
}

function buildStandaloneWorld(
  payload: ExportedProjectPayload,
  assetMgr: PlayerAssetManager,
  getAnimEntry: (nodeId: string) => PlayerAnimEntry | undefined,
  onInstantiateNode: (node: SceneNode) => void,
) {
  const initialSceneId = payload.entrySceneId ?? payload.activeSceneId ?? 'default'
  const firstScene = payload.scenes?.[initialSceneId]
  let activeSceneId = initialSceneId
  let nodes: Record<string, SceneNode> = structuredClone(firstScene?.nodes ?? payload.nodes ?? {})
  let picture: ScenePicture = structuredClone((firstScene?.picture ?? payload.picture ?? {}) as ScenePicture)
  const capabilities = normalizeCapabilities(payload.capabilities)
  const gameplayPacks = payload.gameplayPacks ?? ['core']
  const gameDatabase = payload.gameDatabase ?? { tables: {} }
  const assets = payload.assets ?? {}
  const beforeRenderHooks: Array<{ id: string; order: number; hook: (ctx: RuntimeRenderContext) => void }> = []
  let forcedCameraId = ''
  let forcedCameraUntil = 0

  const instantiatePrefabTree = (
    prefabIdOrName: string,
    options?: { parentId?: string | null; position?: Vec3 },
  ): string | null => {
    const prefabAsset = Object.values(assets).find(
      (a) => a.kind === 'prefab' && (a.id === prefabIdOrName || a.name === prefabIdOrName),
    )
    if (!prefabAsset || prefabAsset.kind !== 'prefab' || !prefabAsset.nodes) return null
    const templateNodes = Array.isArray(prefabAsset.nodes)
      ? Object.fromEntries((prefabAsset.nodes as SceneNode[]).map((n) => [n.id, n]))
      : (prefabAsset.nodes as Record<string, SceneNode>)
    const roots = Object.values(templateNodes).filter((n) => !n.parentId || !templateNodes[n.parentId])
    if (roots.length === 0) return null

    const idMap = new Map<string, string>()
    for (const src of Object.values(templateNodes)) {
      idMap.set(src.id, crypto.randomUUID())
    }
    const primaryRootId = idMap.get(roots[0].id) ?? null
    const created: SceneNode[] = []
    for (const src of Object.values(templateNodes)) {
      const nextId = idMap.get(src.id)!
      const copy = structuredClone(src)
      copy.id = nextId
      const isRoot = !src.parentId || !templateNodes[src.parentId]
      copy.parentId = isRoot ? (options?.parentId ?? null) : (idMap.get(src.parentId!) ?? null)
      if (isRoot && src.id === roots[0].id && options?.position) {
        copy.position = [options.position[0], options.position[1], options.position[2]]
      }
      copy.prefabAssetId = prefabAsset.id
      copy.prefabInstanceId = primaryRootId ?? nextId
      copy.prefabTemplateId = src.id
      nodes[nextId] = copy
      created.push(copy)
    }
    for (const item of created) {
      onInstantiateNode(item)
    }
    return primaryRootId
  }

  const world: RuntimeWorld = {
    getNodes: () => nodes,
    setNodes: (next) => {
      nodes = next
    },
    updateNode: (id, patch) => {
      const current = nodes[id]
      if (!current) return
      nodes = { ...nodes, [id]: { ...current, ...patch } }
    },
    getActiveSceneId: () => activeSceneId,
    getPicture: () => picture,
    getCapabilities: () => capabilities,
    getGameplayPacks: () => gameplayPacks,
    getGameDatabase: () => gameDatabase,
    clipDuration: (assetId, clipName) => {
      if (!clipName) return 0
      if (assetId) {
        const clips = assetMgr.getClips(assetId)
        const hit = clips.find((c) => c.name === clipName) ?? (clips.length === 1 ? clips[0] : undefined)
        if (hit) return hit.duration
      }
      for (const a of Object.values(assets)) {
        if (a.kind !== 'animation' && a.kind !== 'model') continue
        const hit = assetMgr.getClips(a.id).find((c) => c.name === clipName)
        if (hit) return hit.duration
      }
      return 0
    },
    playBody: (nodeId, clipName, options) => {
      const entry = getAnimEntry(nodeId)
      if (!entry) return
      playBodyOnEntry(entry, clipName, assetMgr, options)
    },
    playUpper: (nodeId, clipName, options) => {
      const entry = getAnimEntry(nodeId)
      if (!entry) return
      playUpperOnEntry(entry, clipName, assetMgr, options)
    },
    stopUpper: (nodeId, fade) => {
      const entry = getAnimEntry(nodeId)
      if (!entry) return
      stopUpperOnEntry(entry, fade)
    },
    bodyProgress: (nodeId) => {
      const entry = getAnimEntry(nodeId)
      const action = entry?.activeAction
      if (!action) return 0
      const dur = action.getClip().duration
      if (dur <= 0) return 0
      return Math.min(1, Math.max(0, action.time / dur))
    },
    forcePlayCamera: (cameraId, duration) => {
      forcedCameraId = cameraId
      forcedCameraUntil = typeof duration === 'number' && duration > 0 ? performance.now() + duration * 1000 : 0
    },
    clearPlayCameraForce: () => {
      forcedCameraId = ''
      forcedCameraUntil = 0
    },
    instantiatePrefab: instantiatePrefabTree,
    getTags: () => [],
    getAsset: (id) => assets[id],
    listAssets: () => Object.values(assets),
    getPlayState: () => 'playing',
    markPlayDirty: () => {},
    log: (level, message) => {
      if (level === 'error') console.error('[T3D Player]', message)
      else if (level === 'warn') console.warn('[T3D Player]', message)
      else console.info('[T3D Player]', message)
    },
    registerBeforeRenderHook: (id, order, hook) => {
      const entry = { id, order, hook }
      beforeRenderHooks.push(entry)
      beforeRenderHooks.sort((a, b) => a.order - b.order)
      return () => {
        const idx = beforeRenderHooks.indexOf(entry)
        if (idx >= 0) beforeRenderHooks.splice(idx, 1)
      }
    },
  }

  const switchSceneData = (nextId: string, nextNodes: Record<string, SceneNode>, nextPicture?: ScenePicture) => {
    activeSceneId = nextId
    nodes = structuredClone(nextNodes)
    picture = structuredClone((nextPicture ?? {}) as ScenePicture)
    forcedCameraId = ''
    forcedCameraUntil = 0
  }

  const activeForcedCameraId = () => {
    if (!forcedCameraId) return ''
    if (forcedCameraUntil > 0 && performance.now() > forcedCameraUntil) {
      forcedCameraId = ''
      forcedCameraUntil = 0
      return ''
    }
    return forcedCameraId
  }

  return { world, beforeRenderHooks, switchSceneData, activeForcedCameraId }
}

function findPlayerModelBone(root: Object3D, key: string): Object3D | null {
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

function appendPlayerLocalPose(
  parent: { position: Vector3; quaternion: Quaternion; scale: Vector3 },
  node: Pick<SceneNode, 'position' | 'rotation' | 'scale'>,
) {
  const position = new Vector3(node.position[0], node.position[1], node.position[2])
    .multiply(parent.scale)
    .applyQuaternion(parent.quaternion)
    .add(parent.position)
  const q = new Quaternion().setFromEuler(
    new Euler(node.rotation[0] * DEG_TO_RAD, node.rotation[1] * DEG_TO_RAD, node.rotation[2] * DEG_TO_RAD, 'XYZ'),
  )
  return {
    position,
    quaternion: parent.quaternion.clone().multiply(q),
    scale: parent.scale.clone().multiply(new Vector3(node.scale[0], node.scale[1], node.scale[2])),
  }
}

function posePlayerSockets(
  nodes: Record<string, SceneNode>,
  map: Map<string, Group>,
  modelRoots: Map<string, Object3D>,
) {
  const pos = new Vector3()
  const quat = new Quaternion()
  const scl = new Vector3()
  for (const node of Object.values(nodes)) {
    if (!node.socketBone || !node.parentId) continue
    const parentGroup = map.get(node.parentId)
    const modelRoot = modelRoots.get(node.parentId)
    const group = map.get(node.id)
    if (!parentGroup || !modelRoot || !group) continue
    const bone = findPlayerModelBone(modelRoot, node.socketBone)
    if (!bone) continue
    bone.updateWorldMatrix(true, false)
    bone.matrixWorld.decompose(pos, quat, scl)
    const world = appendPlayerLocalPose({ position: pos, quaternion: quat, scale: parentGroup.scale }, node)
    group.position.copy(world.position)
    group.quaternion.copy(world.quaternion)
    group.scale.copy(world.scale)
  }
}

function mountSinglePlayerNode(
  node: SceneNode,
  mounted: { root: Group; map: Map<string, Group>; mixers: AnimationMixer[]; animEntries: Map<string, PlayerAnimEntry>; modelRoots: Map<string, Object3D> },
  assetMgr: PlayerAssetManager,
  assets: Record<string, ExportedAssetEntry>,
): Group {
  const existing = mounted.map.get(node.id)
  if (existing) return existing

  const group = new Group()
  group.name = node.name
  group.userData.nodeId = node.id
  group.visible = node.visible !== false
  group.position.set(node.position[0], node.position[1], node.position[2])
  group.rotation.set(
    node.rotation[0] * DEG_TO_RAD,
    node.rotation[1] * DEG_TO_RAD,
    node.rotation[2] * DEG_TO_RAD,
    'XYZ',
  )
  group.scale.set(node.scale[0], node.scale[1], node.scale[2])

  const geo = createGeometryForNode(node)
  if (geo) {
    if (geo.attributes?.uv && !geo.attributes.uv2) {
      geo.setAttribute('uv2', geo.attributes.uv)
    }
    const slot = slotFromPlayerNode(node, assets)
    const mat = buildMaterialFromSlot(null, slot, assetMgr, assets)
    const mesh = new Mesh(geo, mat)
    mesh.castShadow = Boolean(node.castShadow)
    mesh.receiveShadow = node.receiveShadow !== false
    group.add(mesh)
  } else if (node.kind === 'model' && node.assetId) {
    const modelClone = assetMgr.getModelClone(node.assetId)
    if (modelClone) {
      const modelAsset = assets[node.assetId]
      const importScale = typeof modelAsset?.importScale === 'number' && modelAsset.importScale > 0 ? modelAsset.importScale : 1
      modelClone.scene.scale.setScalar(importScale)
      applyPlayerModelMaterials(modelClone.scene, node, assetMgr, assets)
      group.add(modelClone.scene)
      mounted.modelRoots.set(node.id, modelClone.scene)
      const mixer = new AnimationMixer(modelClone.scene)
      mounted.mixers.push(mixer)
      const entry: PlayerAnimEntry = {
        ownerAssetId: node.assetId,
        rootScene: modelClone.scene,
        mixer,
        actions: new Map(),
        activeKey: null,
        activeAction: null,
        upperKey: null,
        upperAction: null,
        animatorState: node.animator?.enabled ? node.animator.stateId : undefined,
        animatorTime: 0,
      }
      mounted.animEntries.set(node.id, entry)
      const animState = node.animator?.enabled && node.animator.defaultStateId
        ? node.animator.states?.find((s) => s.id === node.animator!.defaultStateId)
        : undefined
      const charIdle = node.gameplay?.character?.enabled ? node.gameplay.character.idleClip : undefined
      const locoIdle = node.gameplay?.locomotion?.enabled ? node.gameplay.locomotion.idleClip : undefined
      const initClip = animState?.clip || node.clip || charIdle || locoIdle || ''
      if (initClip && node.clipPlaying !== false) {
        playBodyOnEntry(entry, initClip, assetMgr, {
          assetId: animState?.clipAssetId ?? node.clipAssetId,
          loop: animState ? animState.loop !== false : node.clipLoop !== false,
          fade: node.clipFade ?? 0.15,
          speed: animState?.speed ?? node.clipSpeed ?? 1,
        })
      }
      if (node.overlayClip && node.overlayPlaying) {
        playUpperOnEntry(entry, node.overlayClip, assetMgr, {
          assetId: node.overlayAssetId,
          loop: node.overlayLoop === true,
          fade: node.clipFade ?? 0.15,
        })
      }
    }
  } else if (node.kind === 'directional-light') {
    const light = new DirectionalLight(node.color || '#ffffff', node.intensity ?? 2)
    light.castShadow = Boolean(node.castShadow)
    light.shadow.mapSize.set(2048, 2048)
    const distance = Math.max(node.range ?? 20, 4)
    light.shadow.camera.near = 0.5
    light.shadow.camera.far = distance * 4
    light.shadow.camera.left = -distance
    light.shadow.camera.right = distance
    light.shadow.camera.top = distance
    light.shadow.camera.bottom = -distance
    if (typeof node.shadowBias === 'number') light.shadow.bias = node.shadowBias
    if (typeof node.shadowNormalBias === 'number') light.shadow.normalBias = node.shadowNormalBias
    light.target.position.set(0, -1, 0)
    group.add(light)
    group.add(light.target)
  } else if (node.kind === 'point-light') {
    const light = new PointLight(node.color || '#ffffff', node.intensity ?? 2, node.range ?? 15, node.decay ?? 2)
    light.castShadow = Boolean(node.castShadow)
    if (typeof node.shadowBias === 'number') light.shadow.bias = node.shadowBias
    if (typeof node.shadowNormalBias === 'number') light.shadow.normalBias = node.shadowNormalBias
    group.add(light)
  } else if (node.kind === 'spot-light') {
    const light = new SpotLight(
      node.color || '#ffffff',
      node.intensity ?? 2,
      node.range ?? 15,
      ((node.spotAngle ?? 40) * DEG_TO_RAD),
      node.penumbra ?? 0.25,
      node.decay ?? 2,
    )
    light.castShadow = Boolean(node.castShadow)
    if (typeof node.shadowBias === 'number') light.shadow.bias = node.shadowBias
    if (typeof node.shadowNormalBias === 'number') light.shadow.normalBias = node.shadowNormalBias
    light.target.position.set(0, -1, 0)
    group.add(light)
    group.add(light.target)
  } else if (node.kind === 'hemisphere-light') {
    const light = new HemisphereLight(node.color || '#dbeafe', node.groundColor || '#334155', node.intensity ?? 1)
    group.add(light)
  }

  mounted.map.set(node.id, group)
  return group
}

function mountSceneObjects(
  scene: Scene,
  nodes: Record<string, SceneNode>,
  assetMgr: PlayerAssetManager,
  assets: Record<string, ExportedAssetEntry>,
) {
  const mounted = {
    root: new Group(),
    map: new Map<string, Group>(),
    mixers: [] as AnimationMixer[],
    animEntries: new Map<string, PlayerAnimEntry>(),
    modelRoots: new Map<string, Object3D>(),
  }
  scene.add(mounted.root)

  for (const node of Object.values(nodes)) {
    mountSinglePlayerNode(node, mounted, assetMgr, assets)
  }

  for (const node of Object.values(nodes)) {
    const obj = mounted.map.get(node.id)
    if (!obj) continue
    // socketBone 挂点节点在世界空间同步，直接挂在 root 下避免父级二次变换
    const parent = node.parentId && !node.socketBone ? mounted.map.get(node.parentId) : undefined
    ;(parent ?? mounted.root).add(obj)
  }

  const hasAnyLight = Object.values(nodes).some((n) => n.kind.endsWith('-light'))
  if (!hasAnyLight) {
    mounted.root.add(new AmbientLight('#ffffff', 0.65))
    const key = new DirectionalLight('#ffffff', 1.6)
    key.position.set(6, 12, 8)
    mounted.root.add(key)
  }

  return mounted
}

function attachTouchOverlay(container: HTMLElement) {
  if (!('ontouchstart' in window) && navigator.maxTouchPoints <= 0) return
  const overlay = document.createElement('div')
  overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:20;'
  const jumpBtn = document.createElement('button')
  jumpBtn.textContent = '跳跃'
  jumpBtn.style.cssText =
    'position:absolute;right:24px;bottom:28px;width:64px;height:64px;border-radius:999px;border:1px solid rgba(255,255,255,0.28);background:rgba(15,23,42,0.55);color:#fff;font-size:13px;pointer-events:auto;'
  jumpBtn.addEventListener('pointerdown', () => injectVirtualInput({ type: 'actionDown', action: 'Jump' }))
  jumpBtn.addEventListener('pointerup', () => injectVirtualInput({ type: 'actionUp', action: 'Jump' }))
  jumpBtn.addEventListener('pointercancel', () => injectVirtualInput({ type: 'actionUp', action: 'Jump' }))
  overlay.appendChild(jumpBtn)
  container.appendChild(overlay)
}

function toneMappingOfPlayer(mode: ScenePicture['toneMapping'] | undefined) {
  if (mode === 'none') return NoToneMapping
  if (mode === 'linear') return LinearToneMapping
  if (mode === 'reinhard') return ReinhardToneMapping
  if (mode === 'cineon') return CineonToneMapping
  if (mode === 'agx') return AgXToneMapping
  if (mode === 'neutral') return NeutralToneMapping
  return ACESFilmicToneMapping
}

function applyPlayerPicture(
  renderer: WebGPURenderer,
  scene: Scene,
  picture: ScenePicture,
  assetMgr: PlayerAssetManager,
  capabilities: Record<string, boolean>,
  volume: ReturnType<typeof createVolumeLight>,
) {
  if (!capabilities[SKY_CAPABILITY_ID]) {
    const env = assetMgr.getEnvironment(picture.envAssetId)
    if (env) {
      scene.environment = env
      scene.background = env
    } else {
      scene.environment = null
      scene.background = new Color(picture.background || '#181d26')
    }
  }
  renderer.toneMapping = toneMappingOfPlayer(picture.toneMapping)
  renderer.toneMappingExposure = typeof picture.exposure === 'number' ? picture.exposure : 1.05
  volume.sync(picture)
  if (picture.fog && !skyFogActive()) {
    scene.fog = new Fog(picture.fogColor || '#181d26', picture.fogNear ?? 15, picture.fogFar ?? 85)
  } else {
    scene.fog = null
  }
}

function applyInitialSceneCamera(
  camera: PerspectiveCamera,
  nodes: Record<string, SceneNode>,
  mountedMap: Map<string, Group>,
) {
  const camNodes = Object.values(nodes).filter((n) => n.kind === 'camera' && n.visible !== false)
  if (camNodes.length === 0) return
  const mainCam = camNodes.find((n) => n.tagId === 'main-camera' || n.tagId === 'MainCamera') ?? camNodes[0]
  if (!mainCam) return
  const obj = mountedMap.get(mainCam.id)
  if (obj) {
    obj.updateWorldMatrix(true, false)
    obj.getWorldPosition(camera.position)
    obj.getWorldQuaternion(camera.quaternion)
  }
  camera.fov = mainCam.fov ?? 55
  camera.near = Math.max(0.001, mainCam.near ?? 0.1)
  camera.far = Math.max(camera.near + 0.01, mainCam.far ?? 1000)
  camera.updateProjectionMatrix()
}

async function createRenderer(
  rootEl: HTMLElement,
  canvasStyle: string,
): Promise<{ renderer: WebGPURenderer; canvas: HTMLCanvasElement }> {
  const makeCanvas = () => {
    const c = document.createElement('canvas')
    c.style.cssText = canvasStyle
    rootEl.appendChild(c)
    return c
  }
  const primary = makeCanvas()
  const attachBackendInfo = (r: WebGPURenderer, fallback: boolean) => {
    const backendName = (r as unknown as { backend?: { constructor?: { name?: string } } }).backend?.constructor?.name ?? (fallback ? 'WebGLBackend' : 'WebGPUBackend')
    console.info(`[T3D Player] 渲染后端: ${backendName}${fallback ? ' (WebGL2 回退)' : ''}`)
  }
  try {
    const webgpu = new WebGPURenderer({ canvas: primary, antialias: true, powerPreference: 'high-performance' })
    await webgpu.init()
    webgpu.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    webgpu.shadowMap.enabled = true
    webgpu.shadowMap.type = PCFShadowMap
    attachBackendInfo(webgpu, false)
    return { renderer: webgpu, canvas: primary }
  } catch (err) {
    console.warn('[T3D Player] WebGPU 初始化失败，回退 WebGL2:', err)
    primary.remove()
    const fallbackCanvas = makeCanvas()
    const webgl = new WebGPURenderer({ canvas: fallbackCanvas, antialias: true, forceWebGL: true, powerPreference: 'high-performance' })
    await webgl.init()
    webgl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    webgl.shadowMap.enabled = true
    webgl.shadowMap.type = PCFShadowMap
    attachBackendInfo(webgl, true)
    return { renderer: webgl, canvas: fallbackCanvas }
  }
}

async function boot() {
  const rootEl = document.getElementById('player-root') ?? document.body
  const canvasStyle = 'display:block;width:100vw;height:100vh;'

  const params = new URLSearchParams(window.location.search)
  const projectUrl = params.get('project') || './project.t3d.json'
  const response = await fetch(projectUrl)
  if (!response.ok) throw new Error(`无法加载工程数据: ${projectUrl}`)
  const payload = (await response.json()) as ExportedProjectPayload

  const assets = payload.assets ?? {}
  const loadingCfg: BuildLoadingConfig = {
    enabled: payload.buildSettings?.loading?.enabled !== false,
    title: payload.buildSettings?.loading?.title ?? (payload.name || 'Tact3D'),
    subtitle: payload.buildSettings?.loading?.subtitle ?? '正在加载资源…',
    logoAssetId: payload.buildSettings?.loading?.logoAssetId ?? null,
    backgroundAssetId: payload.buildSettings?.loading?.backgroundAssetId ?? null,
    backgroundColor: payload.buildSettings?.loading?.backgroundColor ?? '#141820',
    accentColor: payload.buildSettings?.loading?.accentColor ?? '#4a9eff',
    showProgressBar: payload.buildSettings?.loading?.showProgressBar !== false,
    minDisplayMs: payload.buildSettings?.loading?.minDisplayMs ?? 350,
    showOnSceneSwitch: payload.buildSettings?.loading?.showOnSceneSwitch !== false,
  }

  const assetMgr = new PlayerAssetManager(assets)
  registerShaderTextureResolver((assetId) => assetMgr.getTexture(assetId, false))
  const overlay = new LoadingOverlay(rootEl, loadingCfg, assets, payload.name || 'Tact3D')
  overlay.show()

  if (payload.inputMap) {
    setInputActionMap(normalizeInputMap(payload.inputMap))
  }
  bindGlobalInputListeners()
  attachTouchOverlay(rootEl)

  let mounted: ReturnType<typeof mountSceneObjects> | null = null
  const { world, beforeRenderHooks, switchSceneData, activeForcedCameraId } = buildStandaloneWorld(
    payload,
    assetMgr,
    (nodeId) => mounted?.animEntries.get(nodeId),
    (node) => {
      if (!mounted) return
      const obj = mountSinglePlayerNode(node, mounted, assetMgr, assets)
      const parent = node.parentId && !node.socketBone ? mounted.map.get(node.parentId) : undefined
      ;(parent ?? mounted.root).add(obj)
    },
  )
  setRuntimeWorld(world)
  await syncCapabilityRuntimes(world.getCapabilities())

  const { renderer, canvas } = await createRenderer(rootEl, canvasStyle)
  const picturePipeline = new RuntimePicturePipeline(renderer, {
    onError: (msg) => console.error('[T3D Player]', msg),
  })
  const volume = createVolumeLight()
  const scene = new Scene()
  scene.add(volume.mesh)
  const camera = new PerspectiveCamera(55, window.innerWidth / Math.max(1, window.innerHeight), 0.1, 1000)
  camera.position.set(0, 4, 8)
  camera.lookAt(0, 1, 0)
  attachAudioListener(camera)
  mountPlayerUiOverlay(rootEl)

  const preloadMode = payload.buildSettings?.preloadMode ?? 'entry-scene'
  const entryId = payload.entrySceneId ?? payload.activeSceneId ?? 'default'

  const getPreloadIdsForScene = (sceneId: string): string[] => {
    const sc = payload.scenes?.[sceneId]
    if (sc?.requiredAssetIds) return sc.requiredAssetIds
    return Object.keys(assets)
  }

  const initialPreloadIds = preloadMode === 'minimal'
    ? []
    : preloadMode === 'all-scenes'
      ? [...new Set(Object.keys(payload.scenes ?? {}).flatMap((id) => getPreloadIdsForScene(id)))]
      : getPreloadIdsForScene(entryId)

  await assetMgr.preloadList(initialPreloadIds, (loaded, total, name) => {
    overlay.setProgress(loaded / Math.max(1, total), name)
  })

  for (const shader of payload.shaders ?? []) {
    const compiled = compileShaderSource(shader.id, shader.relativePath, shader.source)
    if (compiled.ok && compiled.exports) compiledShaders.set(shader.id, compiled.exports)
  }
  for (const script of payload.scripts ?? []) {
    compileAndRegisterScript(script.id, script.relativePath, script.source)
  }

  mounted = mountSceneObjects(scene, world.getNodes(), assetMgr, assets)
  applyInitialSceneCamera(camera, world.getNodes(), mounted.map)
  applyPlayerPicture(renderer, scene, world.getPicture(), assetMgr, world.getCapabilities(), volume)
  bumpPlayerUiScene()

  // 进场前先触发一次能力包挂载钩子（如水体、天空），再统一预编译着色器
  for (const item of beforeRenderHooks) {
    item.hook({ renderer, scene, camera, dt: 0 })
  }
  const initW = window.innerWidth
  const initH = Math.max(1, window.innerHeight)
  const initPic = world.getPicture()
  const initEffects = picturePipeline.usesEffects(initPic)
  if (initEffects) {
    picturePipeline.render(scene, camera, initPic, initW, initH)
  }
  await picturePipeline.precompile(scene, camera, initEffects).catch(() => undefined)
  await overlay.hide()

  // 若选择仅预加载初始场景，则进入后在空闲时后台预热其余场景资源
  if (preloadMode === 'entry-scene' && payload.scenes) {
    const otherIds = Object.keys(payload.scenes).filter((id) => id !== entryId)
    const restAssets = [...new Set(otherIds.flatMap((id) => getPreloadIdsForScene(id)))]
    if (restAssets.length > 0) {
      const idle = (globalThis as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback
      const warmup = () => { void assetMgr.preloadList(restAssets) }
      if (typeof idle === 'function') idle(warmup)
      else setTimeout(warmup, 1200)
    }
  }

  let switchingScene = false
  window.addEventListener('t3d:load-scene', (ev) => {
    const detail = (ev as CustomEvent<{ sceneId?: string; spawnPoint?: string }>).detail
    const nextId = detail?.sceneId
    if (!nextId || switchingScene) return
    const nextScene = payload.scenes?.[nextId]
    if (!nextScene) {
      console.warn(`[T3D Player] 目标场景 "${nextId}" 未打包在构建产物中`)
      return
    }
    switchingScene = true
    void (async () => {
      try {
        if (loadingCfg.enabled && loadingCfg.showOnSceneSwitch) {
          overlay.show(`正在切换场景：${nextScene.name}`)
        }
        await assetMgr.preloadList(getPreloadIdsForScene(nextId), (loaded, total, name) => {
          overlay.setProgress(loaded / Math.max(1, total), name)
        })
        if (mounted) scene.remove(mounted.root)
        clearScriptRuntimeState()
        switchSceneData(nextId, nextScene.nodes, nextScene.picture)
        for (const script of payload.scripts ?? []) {
          compileAndRegisterScript(script.id, script.relativePath, script.source)
        }
        mounted = mountSceneObjects(scene, world.getNodes(), assetMgr, assets)
        applyInitialSceneCamera(camera, world.getNodes(), mounted.map)
        applyPlayerPicture(renderer, scene, world.getPicture(), assetMgr, world.getCapabilities(), volume)
        bumpPlayerUiScene()
        const pic = world.getPicture()
        const useFx = picturePipeline.usesEffects(pic)
        if (useFx) {
          picturePipeline.render(scene, camera, pic, window.innerWidth, Math.max(1, window.innerHeight))
        }
        await picturePipeline.precompile(scene, camera, useFx).catch(() => undefined)
        if (loadingCfg.enabled && loadingCfg.showOnSceneSwitch) {
          await overlay.hide()
        }
      } finally {
        switchingScene = false
      }
    })()
  })

  const resize = () => {
    const w = window.innerWidth
    const h = Math.max(1, window.innerHeight)
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  resize()
  window.addEventListener('resize', resize)

  const viewForward = new Vector3()
  const probeRay = new Raycaster()
  const probeOrigin = new Vector3()
  const probeDir = new Vector3()
  const clickRay = new Raycaster()

  let pointerDelta = { x: 0, y: 0 }
  const pointerNorm = { x: 0, y: 0 }
  let mouseButtonsMask = 0
  let rightButton = false
  let wheelDelta = 0
  const clickPoints: { left: [number, number, number] | null; right: [number, number, number] | null } = { left: null, right: null }
  const clickHits: { left: { nodeId: string | null; point: [number, number, number] } | null; right: { nodeId: string | null; point: [number, number, number] } | null } = { left: null, right: null }
  let downPos: { x: number; y: number; button: number; additive: boolean } | null = null
  let playMarqueeEnabled = false
  let playMarqueeResult: { ids: string[]; additive: boolean } | null = null
  let marqueeEl: HTMLDivElement | null = null

  const ensureMarqueeEl = () => {
    if (marqueeEl) return marqueeEl
    marqueeEl = document.createElement('div')
    marqueeEl.style.cssText = 'position:fixed;display:none;border:1px solid rgba(96,165,250,0.9);background:rgba(59,130,246,0.18);pointer-events:none;z-index:15;'
    rootEl.appendChild(marqueeEl)
    return marqueeEl
  }

  const collectMarqueeIds = (x0: number, y0: number, x1: number, y1: number): string[] => {
    if (!mounted) return []
    const rect = canvas.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return []
    const minX = Math.min(x0, x1) - rect.left
    const maxX = Math.max(x0, x1) - rect.left
    const minY = Math.min(y0, y1) - rect.top
    const maxY = Math.max(y0, y1) - rect.top
    const ids: string[] = []
    const pos = new Vector3()
    camera.updateMatrixWorld()
    for (const [id, group] of mounted.map) {
      if (!isObjVisible(group)) continue
      group.getWorldPosition(pos)
      pos.project(camera)
      if (pos.z < -1 || pos.z > 1) continue
      const sx = (pos.x * 0.5 + 0.5) * rect.width
      const sy = (-pos.y * 0.5 + 0.5) * rect.height
      if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) ids.push(id)
    }
    return ids
  }

  const needsMouseLock = () => {
    const nodes = world.getNodes()
    return Object.values(nodes).some((n) => {
      const ch = n.gameplay?.character
      if (!ch?.enabled) return false
      return ch.mode === 'firstPerson' || ch.mode === 'strafe' || n.gameplay?.cameraFollow?.orbit === 'mouse'
    })
  }

  const isObjVisible = (obj: Object3D): boolean => {
    let cur: Object3D | null = obj
    while (cur) {
      if (!cur.visible) return false
      cur = cur.parent
    }
    return true
  }

  const collectProbeMeshes = (ignoreObj: Object3D | undefined, out: Object3D[]) => {
    if (!mounted) return
    const walk = (obj: Object3D) => {
      if (!obj.visible || obj === ignoreObj) return
      if (obj.userData?.t3dWaterMesh) return
      const mesh = obj as Mesh & { isSkinnedMesh?: boolean }
      if (mesh.isMesh && !mesh.isSkinnedMesh) {
        out.push(mesh)
      }
      for (const child of obj.children) walk(child)
    }
    for (const child of mounted.root.children) walk(child)
  }

  canvas.addEventListener('contextmenu', (e) => e.preventDefault())
  canvas.addEventListener('pointerdown', (e) => {
    mouseButtonsMask = e.buttons
    rightButton = (e.buttons & 2) !== 0
    if (e.button === 0 || e.button === 2) {
      downPos = { x: e.clientX, y: e.clientY, button: e.button, additive: e.shiftKey || e.ctrlKey || e.metaKey }
    }
    if (needsMouseLock() && document.pointerLockElement !== canvas) {
      void Promise.resolve(canvas.requestPointerLock?.()).catch(() => undefined)
    }
  })
  window.addEventListener('pointermove', (e) => {
    pointerDelta.x += e.movementX
    pointerDelta.y += e.movementY
    mouseButtonsMask = e.buttons
    rightButton = (e.buttons & 2) !== 0
    const rect = canvas.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) {
      pointerNorm.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      pointerNorm.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
    }
    if (playMarqueeEnabled && downPos?.button === 0) {
      const dx = e.clientX - downPos.x
      const dy = e.clientY - downPos.y
      if (dx * dx + dy * dy >= 36) {
        const box = ensureMarqueeEl()
        box.style.display = 'block'
        box.style.left = `${Math.min(downPos.x, e.clientX)}px`
        box.style.top = `${Math.min(downPos.y, e.clientY)}px`
        box.style.width = `${Math.abs(dx)}px`
        box.style.height = `${Math.abs(dy)}px`
      }
    }
  })
  window.addEventListener('pointerup', (e) => {
    mouseButtonsMask = e.buttons
    rightButton = (e.buttons & 2) !== 0
    const draggedMarquee = marqueeEl?.style.display === 'block'
    if (marqueeEl) marqueeEl.style.display = 'none'
    if (!downPos || downPos.button !== e.button) {
      downPos = null
      return
    }
    const dx = e.clientX - downPos.x
    const dy = e.clientY - downPos.y
    const btn = downPos.button
    const press = downPos
    downPos = null
    if (btn === 0 && draggedMarquee && playMarqueeEnabled) {
      playMarqueeResult = {
        ids: collectMarqueeIds(press.x, press.y, e.clientX, e.clientY),
        additive: press.additive,
      }
      return
    }
    if (dx * dx + dy * dy > 36 || !mounted) return
    const rect = canvas.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1
    const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1
    clickRay.setFromCamera({ x: nx, y: ny } as Vector2, camera)
    const targets: Object3D[] = []
    collectProbeMeshes(undefined, targets)
    const hits = clickRay.intersectObjects(targets, false)
    const hit = hits.find((h) => isObjVisible(h.object))
    const key = btn === 2 ? 'right' : 'left'
    if (hit) {
      const pt: [number, number, number] = [hit.point.x, hit.point.y, hit.point.z]
      let cur: Object3D | null = hit.object
      while (cur && !cur.userData?.nodeId) cur = cur.parent
      clickPoints[key] = pt
      clickHits[key] = { nodeId: (cur?.userData?.nodeId as string) ?? null, point: pt }
    }
  })
  canvas.addEventListener('wheel', (e) => {
    wheelDelta += e.deltaY
  }, { passive: true })

  const host: SceneRuntimeHost = {
    ready: true,
    resolveObject: (id) => mounted?.map.get(id) ?? null,
    updateAnimations: (dt: number) => {
      if (!mounted) return
      const nodes = world.getNodes()
      for (const [nodeId, entry] of mounted.animEntries) {
        const node = nodes[nodeId]
        if (!node?.animator?.enabled || node.clipPlaying === false) continue
        if (entry.animatorState !== node.animator.stateId) {
          entry.animatorState = node.animator.stateId
          entry.animatorTime = 0
        }
        const st = activeAnimatorState(node.animator)
        const dur = st?.clip ? (world.clipDuration?.(st.clipAssetId || node.assetId, st.clip) ?? 0) : 0
        entry.animatorTime = (entry.animatorTime ?? 0) + dt * (st?.speed || 1)
        const stepped = stepAnimator(node.animator, entry.animatorTime, dur)
        if (stepped.changed) {
          entry.animatorState = stepped.controller.stateId
          entry.animatorTime = 0
          world.updateNode(nodeId, { animator: stepped.controller })
          const nextState = activeAnimatorState(stepped.controller)
          if (nextState?.clip) {
            playBodyOnEntry(entry, nextState.clip, assetMgr, {
              assetId: nextState.clipAssetId,
              loop: nextState.loop !== false,
              fade: stepped.fade,
              speed: nextState.speed,
            })
          }
        }
      }
      for (const mixer of mounted.mixers) mixer.update(dt)
    },
    probe: (origin: Vec3, direction: Vec3, max: number, ignoreId: string) => {
      if (!mounted) return null
      probeOrigin.set(origin[0], origin[1], origin[2])
      probeDir.set(direction[0], direction[1], direction[2])
      if (probeDir.lengthSq() < 1e-8) return null
      probeDir.normalize()
      probeRay.set(probeOrigin, probeDir)
      probeRay.near = 0.02
      probeRay.far = max
      const ignoreObj = mounted.map.get(ignoreId)
      const targets: Object3D[] = []
      collectProbeMeshes(ignoreObj, targets)
      const hits = probeRay.intersectObjects(targets, false)
      return hits.length > 0 ? hits[0].distance : null
    },
    // 不能直接读 camera.rotation.y：欧拉角在有俯仰时会偏，镜头转过 90° 后还会整个翻面
    yaw: () => {
      camera.getWorldDirection(viewForward)
      if (viewForward.x * viewForward.x + viewForward.z * viewForward.z < 1e-6) return camera.rotation.y
      return Math.atan2(-viewForward.x, -viewForward.z)
    },
    pitch: () => camera.rotation.x,
    poseCamera: (position: Vec3, lookAt: Vec3, fov: number) => {
      camera.position.set(position[0], position[1], position[2])
      camera.lookAt(new Vector3(lookAt[0], lookAt[1], lookAt[2]))
      if (fov > 0 && camera.fov !== fov) {
        camera.fov = fov
        camera.updateProjectionMatrix()
      }
    },
    pointerDelta: () => {
      const delta = pointerDelta
      pointerDelta = { x: 0, y: 0 }
      return delta
    },
    peekPointerDelta: () => ({ ...pointerDelta }),
    rightHeld: () => rightButton,
    mouseButtons: () => mouseButtonsMask,
    wheel: () => {
      const delta = wheelDelta
      wheelDelta = 0
      return delta
    },
    peekWheel: () => wheelDelta,
    consumeClick: (button) => {
      const pt = clickPoints[button]
      clickPoints[button] = null
      return pt
    },
    pointerNormalized: () => ({ ...pointerNorm }),
    consumeNodeClick: (button) => {
      const hit = clickHits[button]
      clickHits[button] = null
      return hit
    },
    setPlayMarqueeEnabled: (enabled) => {
      playMarqueeEnabled = enabled
      if (!enabled) {
        playMarqueeResult = null
        if (marqueeEl) marqueeEl.style.display = 'none'
      }
    },
    consumePlayMarquee: () => {
      const next = playMarqueeResult
      playMarqueeResult = null
      return next
    },
    worldToScreen: (pos) => {
      const w = window.innerWidth
      const h = Math.max(1, window.innerHeight)
      camera.updateMatrixWorld()
      const projected = new Vector3(pos[0], pos[1], pos[2]).project(camera)
      const inFront = projected.z >= -1 && projected.z <= 1
      const x = (projected.x * 0.5 + 0.5) * w
      const y = (-projected.y * 0.5 + 0.5) * h
      const visible = inFront && projected.x >= -1 && projected.x <= 1 && projected.y >= -1 && projected.y <= 1
      return { x, y, ndcX: projected.x, ndcY: projected.y, visible }
    },
  }

  let lastTime = performance.now()
  const frame = (now: number) => {
    const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000))
    lastTime = now
    for (const item of beforeRenderHooks) {
      item.hook({ renderer, scene, camera, dt })
    }
    if (!switchingScene) {
      stepSceneRuntime(dt, host)
      if (mounted) {
        posePlayerSockets(world.getNodes(), mounted.map, mounted.modelRoots)
        const forcedId = activeForcedCameraId()
        if (forcedId) {
          const camNode = world.getNodes()[forcedId]
          const camObj = mounted.map.get(forcedId)
          if (camNode?.kind === 'camera' && camObj) {
            camObj.updateWorldMatrix(true, false)
            camObj.getWorldPosition(camera.position)
            camObj.getWorldQuaternion(camera.quaternion)
            camera.fov = camNode.fov ?? camera.fov
            camera.near = Math.max(0.001, camNode.near ?? camera.near)
            camera.far = Math.max(camera.near + 0.01, camNode.far ?? camera.far)
            camera.updateProjectionMatrix()
          }
        }
      }
    }
    const pic = world.getPicture()
    if (picturePipeline.usesEffects(pic)) {
      picturePipeline.render(scene, camera, pic, window.innerWidth, Math.max(1, window.innerHeight))
    } else {
      renderer.render(scene, camera)
    }
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

void boot().catch((err) => {
  console.error('[T3D Player] 启动失败:', err)
})
