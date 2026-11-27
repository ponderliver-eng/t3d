import {
  AmbientLight,
  AnimationAction,
  AnimationClip,
  AnimationMixer,
  Color,
  DirectionalLight,
  EquirectangularReflectionMapping,
  Fog,
  Group,
  LoopOnce,
  LoopRepeat,
  Mesh,
  MeshStandardMaterial,
  NoColorSpace,
  Object3D,
  PCFShadowMap,
  PerspectiveCamera,
  Quaternion,
  Raycaster,
  Scene,
  Texture,
  Vector2,
  Vector3,
} from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js'
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'
import { WebGPURenderer } from 'three/webgpu'
import { capabilityEnabled, normalizeCapabilities, syncCapabilityRuntimes } from '../capabilities/registry'
import { disposeParticles, mountParticles } from '../capabilities/particles/session'
import { SKY_CAPABILITY_ID } from '../capabilities/sky/defaults'
import { skyFogActive } from '../capabilities/sky/session'
import { compileShaderSource, registerShaderTextureResolver, type CompiledShaderAsset } from '../core/codeAssets/shaderRuntime'
import { clearScriptRuntimeState, compileAndRegisterScript } from '../core/codeAssets/scriptRuntime'
import {
  applyModelMaterialsWithHost,
  applyNodeMaterialWithHost,
  instantiateModelScene,
  markSkeletonsDirty,
  normalizeMaterialKey,
  normalizeSkinIndex,
  particleDescForWithHost,
  readModelSlots,
  type MaterialEngineHost,
} from '../runtime/engine/materials'
import { buildUnityMetallicRoughnessTexture, loadUnpremultipliedTexture } from '../runtime/engine/textures'
import { loadBc7TextureFromUrl, rendererSupportsBc7 } from '../runtime/engine/bc7'
import { buildPlayableClip } from '../runtime/engine/animation'
import {
  applyCutscenePictureOverrides,
  isCutsceneDrivingAnim,
  sampleCutsceneAnimationClips,
} from '../runtime/engine/cutscene'
import {
  appendSocketLocalPose,
  createNodeLight,
  createPrimitiveGeometry,
  findModelBoneInScene,
  resolveToneMapping,
} from '../runtime/engine/sceneNodes'
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
import type { ModelHumanoidAvatar } from '../runtime/animation/humanoidAvatar'
import { describeHumanoid, type ModelHumanoid } from '../runtime/animation/humanoidRig'
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
  bc7Url?: string
  unityMrBc7Url?: string
  onlyUnityMr?: boolean
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
  nodes?: Record<string, SceneNode>
  picture?: ScenePicture
  requiredAssetIds?: string[]
  sceneUrl?: string
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
/** 工程里可加载资源超过这个数量时，不再在后台把别的场景全预热进内存，留到切场景时再加载。 */
const IDLE_WARMUP_MAX_ASSETS = 48

function collectPlayerNodeDeps(
  nodes: Record<string, SceneNode>,
  picture: ScenePicture | undefined,
  assets: Record<string, ExportedAssetEntry>,
  out: Set<string>,
) {
  const visited = new Set<string>()
  const scanUnknown = (val: unknown, depth = 0) => {
    if (depth > 5 || val === null || val === undefined) return
    if (typeof val === 'string') {
      if (val in assets) addAsset(val)
      return
    }
    if (Array.isArray(val)) {
      for (const item of val) scanUnknown(item, depth + 1)
      return
    }
    if (typeof val === 'object') {
      for (const v of Object.values(val as Record<string, unknown>)) scanUnknown(v, depth + 1)
    }
  }
  const addSlot = (slot: PbrSlot | undefined) => {
    if (!slot) return
    if (slot.materialAssetId) addAsset(slot.materialAssetId)
    for (const key of [
      'mapAssetId',
      'normalAssetId',
      'metallicRoughnessAssetId',
      'roughnessAssetId',
      'metalnessAssetId',
      'emissiveAssetId',
      'aoAssetId',
      'clearcoatMapAssetId',
      'clearcoatRoughnessMapAssetId',
      'clearcoatNormalMapAssetId',
    ] as const) {
      const ref = slot[key]
      if (typeof ref === 'string') addAsset(ref)
    }
    if (slot.shaderParams) scanUnknown(slot.shaderParams)
  }
  function addAsset(id: string | null | undefined) {
    if (!id || !(id in assets)) return
    out.add(id)
    if (visited.has(id)) return
    visited.add(id)
    const asset = assets[id]
    if (!asset) return
    if (asset.kind === 'material') addSlot(asset.slot)
    else if (asset.kind === 'model' && Array.isArray(asset.slots)) {
      for (const slot of asset.slots) addSlot(slot)
    } else if (asset.kind === 'effect') {
      if (asset.materialAssetId) addAsset(asset.materialAssetId)
      if (asset.simulation) scanUnknown(asset.simulation)
    } else if (asset.kind === 'ui' && asset.document) {
      scanUnknown(asset.document)
    } else if (asset.kind === 'prefab' && asset.nodes) {
      const map = Array.isArray(asset.nodes)
        ? Object.fromEntries((asset.nodes as SceneNode[]).map((n) => [n.id, n]))
        : asset.nodes
      collectPlayerNodeDeps(map, undefined, assets, out)
    }
  }
  if (picture) {
    if ('envAssetId' in picture && typeof picture.envAssetId === 'string') addAsset(picture.envAssetId)
    if ('environmentAssetId' in picture && typeof (picture as { environmentAssetId?: unknown }).environmentAssetId === 'string') {
      addAsset((picture as { environmentAssetId: string }).environmentAssetId)
    }
    if (picture.capabilities) scanUnknown(picture.capabilities)
  }
  for (const node of Object.values(nodes)) {
    addAsset(node.assetId)
    addAsset(node.materialAssetId)
    addAsset(node.mapAssetId)
    addAsset(node.normalAssetId)
    addAsset(node.metallicRoughnessAssetId)
    addAsset(node.roughnessAssetId)
    addAsset(node.metalnessAssetId)
    addAsset(node.emissiveAssetId)
    addAsset(node.aoAssetId)
    addAsset(node.clipAssetId)
    addAsset(node.overlayAssetId)
    addAsset(node.screen?.documentId)
    if (node.effect) {
      addAsset(node.effect.assetId)
      addAsset(node.effect.materialAssetId)
      if (node.effect.simulation) scanUnknown(node.effect.simulation)
    }
    if (Array.isArray(node.slots)) {
      for (const slot of node.slots) addSlot(slot)
    }
    if (node.partOverrides) {
      for (const ov of Object.values(node.partOverrides)) addAsset(ov.materialAssetId)
    }
    if (node.animator) scanUnknown(node.animator)
    if (node.capabilities) scanUnknown(node.capabilities)
    if (node.gameplay) scanUnknown(node.gameplay)
  }
}

function disposeSceneBranch(root: Object3D) {
  root.traverse((child) => {
    const mesh = child as Mesh
    if (!mesh.isMesh) return
    // 基础几何体是每个节点自己建的，要一起释放；模型网格与模板共用几何体，交给 releaseUnreferenced
    if (mesh.userData.t3dOwnGeometry) mesh.geometry?.dispose()
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const mat of materials) mat?.dispose?.()
  })
}

class PlayerAssetManager {
  private readonly gltfLoader = new GLTFLoader()
  private readonly hdrLoader = new RGBELoader()
  private readonly exrLoader = new EXRLoader()
  private readonly modelCache = new Map<string, { scene: Group; clips: AnimationClip[]; slots: PbrSlot[]; humanoid: ModelHumanoid; hasSkinnedMesh: boolean }>()
  private readonly texCache = new Map<string, Texture>()
  private readonly linearTexCache = new Map<string, Texture>()
  private readonly unityMrCache = new Map<string, Texture>()
  private readonly unityMrInflight = new Set<string>()
  private readonly baseTexInflight = new Set<string>()
  private readonly envCache = new Map<string, Texture>()
  private readonly pending = new Map<string, Promise<void>>()
  private readonly failedIds = new Set<string>()
  /** 不支持直接加载的格式（ktx2 / tga），记下来避免每次访问都重新发起一次空加载 */
  private readonly skippedIds = new Set<string>()
  private readonly unityMrBc7Failed = new Set<string>()
  /** 场景挂载时还没加载好、之后才按需加载的资源；加载完成后要把它们补到已挂载的场景上 */
  private readonly lazyWanted = new Set<string>()
  private lazyReady = false
  private bc7Supported = false
  private onAssetFailed: ((name: string) => void) | null = null

  constructor(readonly assets: Record<string, ExportedAssetEntry>) {
    this.gltfLoader.setMeshoptDecoder(MeshoptDecoder)
  }

  setBc7Supported(supported: boolean) {
    this.bc7Supported = supported
  }

  setFailureHandler(handler: ((name: string) => void) | null) {
    this.onAssetFailed = handler
  }

  /** 有按需加载的资源刚到位时返回 true（只返回一次），调用方据此刷新已挂载的场景。 */
  consumeLazyReady(): boolean {
    const ready = this.lazyReady
    this.lazyReady = false
    return ready
  }

  /** 切换场景时清掉失败记录，给临时性的失败（比如网络抖动）一次重试机会。 */
  resetFailures() {
    this.failedIds.clear()
    this.unityMrBc7Failed.clear()
  }

  /** 当前留在内存里的资源数量与贴图显存估算，挂在 window.__T3D_ASSET_STATS__ 上供排查用。 */
  stats() {
    let textureBytes = 0
    let compressed = 0
    const measure = (tex: Texture) => {
      const mips = (tex as { isCompressedTexture?: boolean; mipmaps?: Array<{ data?: { byteLength?: number } }> })
      if (mips.isCompressedTexture && mips.mipmaps?.length) {
        compressed += 1
        for (const mip of mips.mipmaps) textureBytes += mip.data?.byteLength ?? 0
        return
      }
      const img = tex.image as { width?: number; height?: number } | undefined
      textureBytes += Math.round((img?.width ?? 0) * (img?.height ?? 0) * 4 * 4 / 3)
    }
    for (const tex of this.texCache.values()) measure(tex)
    for (const tex of this.unityMrCache.values()) measure(tex)
    return {
      textures: this.texCache.size,
      unityMr: this.unityMrCache.size,
      environments: this.envCache.size,
      models: this.modelCache.size,
      compressedTextures: compressed,
      textureBytes,
      failed: [...this.failedIds],
      bc7Supported: this.bc7Supported,
    }
  }

  private requestLazy(assetId: string, kinds: readonly string[]) {
    const asset = this.assets[assetId]
    if (!asset?.url || !kinds.includes(asset.kind)) return
    if (this.failedIds.has(assetId) || this.skippedIds.has(assetId)) return
    this.lazyWanted.add(assetId)
    void this.ensureAsset(assetId)
  }

  getModelClone(
    assetId: string,
    node: SceneNode,
    host: MaterialEngineHost,
  ): { scene: Object3D; clips: AnimationClip[]; slots: PbrSlot[]; humanoid: ModelHumanoid; hasSkinnedMesh: boolean } | null {
    const tpl = this.modelCache.get(assetId)
    if (!tpl) {
      this.requestLazy(assetId, ['model'])
      return null
    }
    const mergedSlots = resolveMergedModelSlots(node, this.assets, tpl.slots)
    let initSlots = mergedSlots
    if (initSlots.length === 0 && node.materialAssetId) {
      const nodeMatSlot = host.getMaterialSlot(node.materialAssetId)
      if (nodeMatSlot) initSlots = [nodeMatSlot]
    }
    const cloneFn = tpl.hasSkinnedMesh ? cloneSkinned : (source: Object3D) => source.clone(true)
    const object = instantiateModelScene(tpl.scene, initSlots, host, cloneFn, node.partOverrides)
    return { scene: object, clips: tpl.clips, slots: mergedSlots, humanoid: tpl.humanoid, hasSkinnedMesh: tpl.hasSkinnedMesh }
  }

  getModelTemplate(assetId: string) {
    return this.modelCache.get(assetId) ?? null
  }

  getClips(assetId: string): AnimationClip[] {
    return this.modelCache.get(assetId)?.clips ?? []
  }

  private requestBaseTextureLazy(assetId: string) {
    const asset = this.assets[assetId]
    if (!asset?.url || asset.kind !== 'texture') return
    if (this.failedIds.has(assetId) || this.skippedIds.has(assetId) || this.baseTexInflight.has(assetId)) return
    // 若常规 ensureAsset 尚未跑完，交给它即可
    if (!this.unityMrCache.has(assetId)) {
      this.requestLazy(assetId, ['texture'])
      return
    }
    this.baseTexInflight.add(assetId)
    void (async () => {
      try {
        let base: Texture | null = null
        if (this.bc7Supported && asset.bc7Url) {
          base = await loadBc7TextureFromUrl(asset.bc7Url, true).catch(() => null)
        }
        if (!base) base = await loadUnpremultipliedTexture(asset.url!)
        this.texCache.set(assetId, base)
        this.lazyReady = true
      } catch {
        this.failedIds.add(assetId)
      } finally {
        this.baseTexInflight.delete(assetId)
      }
    })()
  }

  getTexture(assetId: string, srgb = true): Texture | null {
    if (srgb) {
      const hit = this.texCache.get(assetId)
      if (hit) return hit
      this.requestBaseTextureLazy(assetId)
      return null
    }
    const cached = this.linearTexCache.get(assetId)
    if (cached) return cached
    const base = this.texCache.get(assetId)
    if (!base) {
      this.requestBaseTextureLazy(assetId)
      return null
    }
    const linear = base.clone()
    linear.source = base.source
    linear.colorSpace = NoColorSpace
    linear.needsUpdate = true
    this.linearTexCache.set(assetId, linear)
    return linear
  }

  getUnityMetallicRoughnessTexture(assetId: string): Texture | null {
    const cached = this.unityMrCache.get(assetId)
    if (cached) return cached
    const asset = this.assets[assetId]
    if (this.bc7Supported && asset?.unityMrBc7Url && !this.unityMrBc7Failed.has(assetId) && !this.unityMrInflight.has(assetId)) {
      this.unityMrInflight.add(assetId)
      void loadBc7TextureFromUrl(asset.unityMrBc7Url, false)
        .catch(() => null)
        .then((tex) => {
          this.unityMrInflight.delete(assetId)
          if (tex) this.unityMrCache.set(assetId, tex)
          else this.unityMrBc7Failed.add(assetId)
          // 成功就换上压缩成品；失败也要刷新一次，让下面的「从原图重排」接手
          this.lazyReady = true
        })
    }
    const base = this.getTexture(assetId, false)
    if (!base || typeof document === 'undefined') return base
    // 主图本身是 BC7 压缩贴图时没有像素数组可供重排：若有重排好的 BC7 就等上面异步读回，否则从原图解一次做重排
    if ((base as { isCompressedTexture?: boolean }).isCompressedTexture) {
      if (!this.unityMrInflight.has(assetId) && asset?.url && !this.failedIds.has(`${assetId}#unity-mr`)) {
        this.unityMrInflight.add(assetId)
        void loadUnpremultipliedTexture(asset.url)
          .then((rawTex) => {
            this.unityMrInflight.delete(assetId)
            const converted = buildUnityMetallicRoughnessTexture(rawTex)
            if (converted !== rawTex) {
              const img = rawTex.image as { close?: () => void } | undefined
              rawTex.dispose()
              if (typeof img?.close === 'function') img.close()
            }
            this.unityMrCache.set(assetId, converted)
            this.lazyReady = true
          })
          .catch(() => {
            // 原图也读不出来：记为失败，不再反复尝试
            this.unityMrInflight.delete(assetId)
            this.unityMrBc7Failed.add(assetId)
            this.failedIds.add(`${assetId}#unity-mr`)
          })
      }
      return null
    }
    const converted = buildUnityMetallicRoughnessTexture(base)
    this.unityMrCache.set(assetId, converted)
    return converted
  }

  getEnvironment(assetId: string | null | undefined): Texture | null {
    if (!assetId) return null
    const hit = this.envCache.get(assetId)
    if (hit) return hit
    this.requestLazy(assetId, ['environment'])
    return null
  }

  /** 切换场景后释放新场景不再引用的模型、贴图与环境贴图。 */
  releaseUnreferenced(keepIds: ReadonlySet<string>): { textures: number; models: number } {
    let textures = 0
    let models = 0
    for (const [id, tex] of this.texCache) {
      if (keepIds.has(id) || this.pending.has(id)) continue
      const linear = this.linearTexCache.get(id)
      const mr = this.unityMrCache.get(id)
      linear?.dispose()
      if (mr && mr !== linear && mr !== tex) mr.dispose()
      const img = tex.image as { close?: () => void } | undefined
      tex.dispose()
      if (typeof img?.close === 'function') {
        try { img.close() } catch { /* ignore */ }
      }
      this.texCache.delete(id)
      this.linearTexCache.delete(id)
      this.unityMrCache.delete(id)
      textures += 1
    }
    for (const [id, mr] of this.unityMrCache) {
      if (keepIds.has(id) || this.pending.has(id)) continue
      mr.dispose()
      this.unityMrCache.delete(id)
      textures += 1
    }
    for (const [id, env] of this.envCache) {
      if (keepIds.has(id) || this.pending.has(id)) continue
      env.dispose()
      this.envCache.delete(id)
      textures += 1
    }
    for (const [id, tpl] of this.modelCache) {
      if (keepIds.has(id) || this.pending.has(id)) continue
      tpl.scene.traverse((child) => {
        const mesh = child as Mesh
        if (!mesh.isMesh) return
        mesh.geometry?.dispose()
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        for (const mat of mats) {
          if (!mat) continue
          // 模型文件里内嵌的贴图只挂在模板材质上，要一起释放
          for (const value of Object.values(mat)) {
            if ((value as { isTexture?: boolean } | null)?.isTexture) (value as Texture).dispose()
          }
          mat.dispose()
        }
      })
      this.modelCache.delete(id)
      models += 1
    }
    return { textures, models }
  }

  async ensureAsset(assetId: string): Promise<void> {
    if (this.modelCache.has(assetId) || this.texCache.has(assetId) || this.envCache.has(assetId)) return
    const asset = this.assets[assetId]
    if (!asset?.url) return
    if (asset.kind === 'texture' && asset.onlyUnityMr && this.unityMrCache.has(assetId)) return
    if (this.failedIds.has(assetId)) return
    const inflight = this.pending.get(assetId)
    if (inflight) return inflight

    const task = (async () => {
      try {
        if (asset.kind === 'model' || asset.kind === 'animation') {
          const gltf = await this.gltfLoader.loadAsync(asset.url!)
          normalizeSkinIndex(gltf.scene)
          const rawSlots = asset.kind === 'model' ? readModelSlots(gltf.scene) : []
          const slots = Array.isArray(asset.slots) && asset.slots.length > 0
            ? resolveMergedModelSlots({ id: '', name: '', kind: 'model', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#ffffff', roughness: 0.7, metalness: 0.1, visible: true, parentId: null, assetId, slots: rawSlots } as unknown as SceneNode, this.assets, asset.slots)
            : rawSlots
          const clips = gltf.animations ?? []
          let hasSkinnedMesh = false
          let hasBone = false
          gltf.scene.traverse((child) => {
            if ((child as Mesh & { isSkinnedMesh?: boolean }).isSkinnedMesh) hasSkinnedMesh = true
            if ((child as { isBone?: boolean }).isBone) hasBone = true
          })
          // 纯静态网格（无骨骼、无蒙皮、无动画片段且未指定人形 Avatar）直接跳过昂贵的骨骼拓扑与矩阵推断
          const humanoid: ModelHumanoid =
            hasSkinnedMesh || hasBone || clips.length > 0 || Boolean(asset.humanoidAvatar)
              ? describeHumanoid(gltf.scene, clips)
              : { profile: null, avatar: null, skeletons: [] }
          this.modelCache.set(assetId, { scene: gltf.scene, clips, slots, humanoid, hasSkinnedMesh })
        } else if (asset.kind === 'texture') {
          const lower = (asset.fileName || asset.url || '').toLowerCase()
          if (lower.endsWith('.ktx2') || lower.endsWith('.tga')) {
            this.skippedIds.add(assetId)
            return
          }
          if (this.bc7Supported && asset.unityMrBc7Url && !this.unityMrCache.has(assetId)) {
            const mrTex = await loadBc7TextureFromUrl(asset.unityMrBc7Url, false).catch(() => null)
            if (mrTex) {
              this.unityMrCache.set(assetId, mrTex)
              // 仅用作 Unity 金属光滑图的贴图命中重排 BC7 后直接完成，避免再读一份主图浪费一半 I/O 与显存
              if (asset.onlyUnityMr) return
            } else {
              this.unityMrBc7Failed.add(assetId)
            }
          }
          // 主图：显卡支持就读压缩成品（显存是未压缩的 1/4），读不到再退回原图
          let base: Texture | null = null
          if (this.bc7Supported && asset.bc7Url) {
            base = await loadBc7TextureFromUrl(asset.bc7Url, true).catch(() => null)
          }
          if (!base) base = await loadUnpremultipliedTexture(asset.url!)
          this.texCache.set(assetId, base)
        } else if (asset.kind === 'environment') {
          const ext = (asset.fileName || asset.url || '').split('.').pop()?.toLowerCase()
          const primary = ext === 'exr' ? this.exrLoader.loadAsync(asset.url!) : this.hdrLoader.loadAsync(asset.url!)
          const tex = await (ext === 'env' ? primary.catch(() => this.exrLoader.loadAsync(asset.url!)) : primary)
          tex.mapping = EquirectangularReflectionMapping
          this.envCache.set(assetId, tex)
        }
      } catch (err) {
        this.failedIds.add(assetId)
        console.warn(`[T3D Player] 资源加载失败 (${asset.name}):`, err)
        this.onAssetFailed?.(asset.name || assetId)
      } finally {
        this.pending.delete(assetId)
        if (this.lazyWanted.delete(assetId)) this.lazyReady = true
      }
    })()

    this.pending.set(assetId, task)
    return task
  }

  async preloadList(
    assetIds: string[],
    onProgress?: (loaded: number, total: number, categoryLabel: string) => void,
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
    // 贴图（尤其是 BC7 压缩贴图）与环境图体积小、无复杂树构建，与模型交错排在前面让磁盘/GPU 上传与 CPU 解析充分重叠
    const kindPriority = (kind: string | undefined): number => {
      if (kind === 'environment') return 0
      if (kind === 'texture') return 1
      if (kind === 'model') return 2
      return 3
    }
    const queue = [...targets].sort((a, b) => kindPriority(this.assets[a]?.kind) - kindPriority(this.assets[b]?.kind))
    const labelOfKind = (kind: string | undefined): string => {
      if (kind === 'model') return '模型资源'
      if (kind === 'animation') return '动作资源'
      if (kind === 'texture') return '贴图资源'
      if (kind === 'environment') return '环境光照'
      if (kind === 'audio') return '音频资源'
      return '场景资源'
    }
    let done = 0
    const workers = Array.from({ length: Math.min(16, total) }, async () => {
      while (queue.length > 0) {
        const id = queue.shift()
        if (!id) break
        const category = labelOfKind(this.assets[id]?.kind)
        await this.ensureAsset(id)
        done += 1
        onProgress?.(done, total, category)
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

  setProgress(ratio: number, categoryLabel?: string) {
    const pct = Math.max(0, Math.min(100, Math.round(ratio * 100)))
    if (this.barFill) this.barFill.style.width = `${pct}%`
    if (this.pctLabel) this.pctLabel.textContent = `${pct}%`
    const base = this.cfg.subtitle || '正在加载资源…'
    this.subLabel.textContent = categoryLabel ? `${base} · ${categoryLabel}` : base
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
  return createPrimitiveGeometry(node.kind)
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
  const targetTpl = sourceId !== ownerAssetId ? assetMgr.getModelTemplate(ownerAssetId) : undefined
  const sourceTpl = sourceId !== ownerAssetId ? assetMgr.getModelTemplate(sourceId) : undefined
  const targetAsset = assetMgr.assets[ownerAssetId]
  const sourceAsset = assetMgr.assets[sourceId]
  return buildPlayableClip({
    rawClip,
    sourceId,
    ownerAssetId,
    sourceHumanoid: sourceTpl?.humanoid ?? null,
    targetHumanoid: targetTpl?.humanoid ?? null,
    sourceAvatarOverride: sourceAsset?.humanoidAvatar ?? null,
    targetAvatarOverride: targetAsset?.humanoidAvatar ?? null,
    targetRetargetAdjust: targetAsset?.humanoidRetarget ?? null,
    mask,
    inPlace,
  })
}

const compiledShaders = new Map<string, CompiledShaderAsset>()

function createPlayerMaterialHost(
  assetMgr: PlayerAssetManager,
  assets: Record<string, ExportedAssetEntry>,
): MaterialEngineHost {
  return {
    getMaterialSlot: (id) => {
      if (!id) return null
      const asset = assets[id]
      if (!asset || asset.kind !== 'material') return null
      return asset.slot ?? null
    },
    getTexture: (assetId, colorMap) => (assetId ? assetMgr.getTexture(assetId, colorMap) : null),
    getUnityMetallicRoughnessTexture: (assetId) => (assetId ? assetMgr.getUnityMetallicRoughnessTexture(assetId) : null),
    getCustomShader: (shaderId) => {
      const rec = compiledShaders.get(shaderId)
      if (rec?.definition) return { definition: rec.definition, updatedAt: 1 }
      return null
    },
  }
}

function resolveMergedModelSlots(node: SceneNode, assets: Record<string, ExportedAssetEntry>, tplSlots: PbrSlot[] = []): PbrSlot[] {
  const assetSlots = node.assetId && Array.isArray(assets[node.assetId]?.slots) && assets[node.assetId]!.slots!.length > 0
    ? assets[node.assetId]!.slots!
    : tplSlots
  const nodeSlots = Array.isArray(node.slots) ? node.slots : []
  if (nodeSlots.length === 0) return assetSlots
  if (assetSlots.length === 0) return nodeSlots
  const assetByName = new Map(assetSlots.map((s) => [s.name, s]))
  const assetByNorm = new Map(assetSlots.map((s) => [normalizeMaterialKey(s.name), s]))
  return nodeSlots.map((slot, idx) => {
    const fresh = assetByName.get(slot.name) ?? assetByNorm.get(normalizeMaterialKey(slot.name)) ?? assetSlots[idx]
    if (!fresh) return slot
    const sameOrUnsetMat = !slot.materialAssetId || slot.materialAssetId === fresh.materialAssetId
    const hasMap = Boolean(slot.mapAssetId || (sameOrUnsetMat && fresh.mapAssetId) || slot.materialAssetId || fresh.materialAssetId)
    return {
      ...fresh,
      ...slot,
      color: hasMap && slot.color === '#000000' && fresh.color && fresh.color !== '#000000' ? fresh.color : slot.color,
      materialAssetId: slot.materialAssetId ?? fresh.materialAssetId,
      shader: slot.shader ?? fresh.shader,
      mapAssetId: slot.mapAssetId ?? (sameOrUnsetMat ? fresh.mapAssetId : null),
      normalAssetId: slot.normalAssetId ?? (sameOrUnsetMat ? fresh.normalAssetId : null),
      metallicRoughnessAssetId: slot.metallicRoughnessAssetId ?? (sameOrUnsetMat ? fresh.metallicRoughnessAssetId : null),
      roughnessAssetId: slot.roughnessAssetId ?? (sameOrUnsetMat ? fresh.roughnessAssetId : null),
      metalnessAssetId: slot.metalnessAssetId ?? (sameOrUnsetMat ? fresh.metalnessAssetId : null),
      emissiveAssetId: slot.emissiveAssetId ?? (sameOrUnsetMat ? fresh.emissiveAssetId : null),
      aoAssetId: slot.aoAssetId ?? (sameOrUnsetMat ? fresh.aoAssetId : null),
    }
  })
}

function applyPlayerModelMeshFlags(root: Object3D, node: SceneNode) {
  const overrides = node.partOverrides
  const hiddenSet = new Set(node.hiddenParts ?? [])
  const walkFlags = (object: Object3D, parentPath: string, parentHidden: boolean) => {
    const label = object.name || object.type
    const path = parentPath ? `${parentPath}/${label}` : label
    const isHidden = parentHidden || hiddenSet.has(path)
    const mesh = object as Mesh
    if (mesh.isMesh) {
      mesh.visible = !isHidden
      const ov = overrides?.[path]
      mesh.castShadow = ov?.castShadow ?? Boolean(node.castShadow)
      mesh.receiveShadow = ov?.receiveShadow ?? (node.receiveShadow !== false)
    }
    for (const child of object.children) walkFlags(child, path, isHidden)
  }
  for (const child of root.children) walkFlags(child, '', false)
}

function applyPlayerModelMaterials(
  root: Object3D,
  node: SceneNode,
  tplSlots: PbrSlot[],
  matHost: MaterialEngineHost,
  assets: Record<string, ExportedAssetEntry>,
) {
  const slots = resolveMergedModelSlots(node, assets, tplSlots)
  const overrides = node.partOverrides

  if (slots.length > 0 || (overrides && Object.keys(overrides).length > 0)) {
    applyModelMaterialsWithHost(root, slots, matHost, overrides)
  } else if (node.materialAssetId) {
    const nodeMatSlot = matHost.getMaterialSlot(node.materialAssetId)
    if (nodeMatSlot) {
      applyModelMaterialsWithHost(root, [nodeMatSlot], matHost, overrides)
    }
  }
  applyPlayerModelMeshFlags(root, node)
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
    getPicture: () => applyCutscenePictureOverrides(picture),
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
    resolveTexture: async (assetId) => {
      await assetMgr.ensureAsset(assetId)
      return assetMgr.getTexture(assetId, false)
    },
    getTexture: (assetId, srgb = false) => assetMgr.getTexture(assetId, srgb),
    resolveParticleDesc: (materialId) =>
      particleDescForWithHost(materialId ?? null, createPlayerMaterialHost(assetMgr, assets)),
    resolveAssetUrl: (assetId) => Promise.resolve(assets[assetId]?.url ?? null),
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
  return findModelBoneInScene(root, key)
}

function appendPlayerLocalPose(
  parent: { position: Vector3; quaternion: Quaternion; scale: Vector3 },
  node: Pick<SceneNode, 'position' | 'rotation' | 'scale'>,
) {
  return appendSocketLocalPose(parent, node)
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

function ensurePlayerAnimEntry(
  nodeId: string,
  mounted: { root: Group; map: Map<string, Group>; mixers: AnimationMixer[]; animEntries: Map<string, PlayerAnimEntry>; modelRoots: Map<string, Object3D> },
  nodes: Record<string, SceneNode>,
): PlayerAnimEntry | undefined {
  const existing = mounted.animEntries.get(nodeId)
  if (existing) return existing
  const node = nodes[nodeId]
  const rootScene = mounted.modelRoots.get(nodeId)
  if (!node?.assetId || !rootScene) return undefined
  const mixer = new AnimationMixer(rootScene)
  mounted.mixers.push(mixer)
  const entry: PlayerAnimEntry = {
    ownerAssetId: node.assetId,
    rootScene,
    mixer,
    actions: new Map(),
    activeKey: null,
    activeAction: null,
    upperKey: null,
    upperAction: null,
    animatorState: node.animator?.enabled ? node.animator.stateId : undefined,
    animatorTime: 0,
  }
  mounted.animEntries.set(nodeId, entry)
  return entry
}

function isPlayerNodeHierarchyVisible(nodeId: string, nodes: Record<string, SceneNode>, cache: Map<string, boolean>): boolean {
  const hit = cache.get(nodeId)
  if (hit !== undefined) return hit
  const node = nodes[nodeId]
  if (!node || node.visible === false) {
    cache.set(nodeId, false)
    return false
  }
  cache.set(nodeId, true)
  const ok = node.parentId ? isPlayerNodeHierarchyVisible(node.parentId, nodes, cache) : true
  cache.set(nodeId, ok)
  return ok
}

function mountSinglePlayerNode(
  node: SceneNode,
  mounted: { root: Group; map: Map<string, Group>; mixers: AnimationMixer[]; animEntries: Map<string, PlayerAnimEntry>; modelRoots: Map<string, Object3D> },
  assetMgr: PlayerAssetManager,
  assets: Record<string, ExportedAssetEntry>,
  allNodes?: Record<string, SceneNode>,
  visCache?: Map<string, boolean>,
): Group {
  const existing = mounted.map.get(node.id)
  if (existing) return existing

  const group = new Group()
  group.name = node.name
  group.userData.nodeId = node.id
  group.visible = allNodes && visCache
    ? isPlayerNodeHierarchyVisible(node.id, allNodes, visCache)
    : node.visible !== false
  group.updateMatrixWorld = function skipHiddenUpdateMatrixWorld(force?: boolean) {
    if (!this.visible) return
    Group.prototype.updateMatrixWorld.call(this, force)
  }
  group.position.set(node.position[0], node.position[1], node.position[2])
  group.rotation.set(
    node.rotation[0] * DEG_TO_RAD,
    node.rotation[1] * DEG_TO_RAD,
    node.rotation[2] * DEG_TO_RAD,
    'XYZ',
  )
  group.scale.set(node.scale[0], node.scale[1], node.scale[2])

  const geo = createGeometryForNode(node)
  const matHost = createPlayerMaterialHost(assetMgr, assets)
  if (geo) {
    const mesh = new Mesh(geo, new MeshStandardMaterial())
    applyNodeMaterialWithHost(mesh, node, matHost)
    mesh.userData.t3dOwnGeometry = true
    mesh.userData.t3dAppliedMaterial = mesh.material
    mesh.castShadow = Boolean(node.castShadow)
    mesh.receiveShadow = node.receiveShadow !== false
    group.add(mesh)
  } else if (node.kind === 'model' && node.assetId) {
    const modelClone = assetMgr.getModelClone(node.assetId, node, matHost)
    if (modelClone) {
      const modelAsset = assets[node.assetId]
      const importScale = typeof modelAsset?.importScale === 'number' && modelAsset.importScale > 0 ? modelAsset.importScale : 1
      modelClone.scene.scale.setScalar(importScale)
      // instantiateModelScene 已在克隆时一次性绑定好材质与部位覆盖，这里只需同步显隐与阴影标志，避免二次重建全套材质
      applyPlayerModelMeshFlags(modelClone.scene, node)
      group.add(modelClone.scene)
      mounted.modelRoots.set(node.id, modelClone.scene)

      const animState = node.animator?.enabled && node.animator.defaultStateId
        ? node.animator.states?.find((s) => s.id === node.animator!.defaultStateId)
        : undefined
      const charIdle = node.gameplay?.character?.enabled ? node.gameplay.character.idleClip : undefined
      const locoIdle = node.gameplay?.locomotion?.enabled ? node.gameplay.locomotion.idleClip : undefined
      const initClip = animState?.clip || node.clip || charIdle || locoIdle || ''
      const needsAnimNow = Boolean(
        initClip ||
        (node.overlayClip && node.overlayPlaying) ||
        node.animator?.enabled ||
        node.gameplay?.character?.enabled ||
        node.gameplay?.locomotion?.enabled,
      )
      if (needsAnimNow) {
        const entry = ensurePlayerAnimEntry(node.id, mounted, allNodes ?? { [node.id]: node })
        if (entry) {
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
      }
    }
  } else if (
    node.kind === 'directional-light' ||
    node.kind === 'point-light' ||
    node.kind === 'spot-light' ||
    node.kind === 'hemisphere-light'
  ) {
    const light = createNodeLight(node)
    group.add(light)
    if ('target' in light && light.target) {
      group.add(light.target as Object3D)
    }
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
  const visCache = new Map<string, boolean>()

  for (const node of Object.values(nodes)) {
    mountSinglePlayerNode(node, mounted, assetMgr, assets, nodes, visCache)
  }

  for (const node of Object.values(nodes)) {
    const obj = mounted.map.get(node.id)
    if (!obj) continue
    // socketBone 挂点节点在世界空间同步，直接挂在 root 下避免父级二次变换
    const parent = node.parentId && !node.socketBone ? mounted.map.get(node.parentId) : undefined
    ;(parent ?? mounted.root).add(obj)
  }

  // 与 EditorViewport 一致：始终保留基础环境漫反射，避免有太阳光时背光面全黑
  mounted.root.add(new AmbientLight(0xffffff, 0.28))

  const hasAnyLight = Object.values(nodes).some((n) => n.kind.endsWith('-light'))
  if (!hasAnyLight) {
    mounted.root.add(new AmbientLight('#ffffff', 0.4))
    const key = new DirectionalLight('#ffffff', 1.6)
    key.position.set(6, 12, 8)
    mounted.root.add(key)
  }

  return mounted
}

function applyMountedTextures(
  mounted: { root: Group; map: Map<string, Group>; mixers: AnimationMixer[]; animEntries: Map<string, PlayerAnimEntry>; modelRoots: Map<string, Object3D> },
  nodes: Record<string, SceneNode>,
  assetMgr: PlayerAssetManager,
  assets: Record<string, ExportedAssetEntry>,
) {
  const matHost = createPlayerMaterialHost(assetMgr, assets)
  for (const node of Object.values(nodes)) {
    const group = mounted.map.get(node.id)
    if (!group) continue
    if (node.kind === 'model' && node.assetId) {
      let modelRoot = mounted.modelRoots.get(node.id)
      // 懒加载模式下模型加载完成前组里还是空的，这里补挂上去
      if (!modelRoot && assetMgr.getModelTemplate(node.assetId)) {
        mounted.map.delete(node.id)
        const rebuilt = mountSinglePlayerNode(node, mounted, assetMgr, assets)
        group.add(...rebuilt.children)
        mounted.map.set(node.id, group)
        modelRoot = mounted.modelRoots.get(node.id)
      }
      if (modelRoot) {
        const tpl = assetMgr.getModelTemplate(node.assetId)
        applyPlayerModelMaterials(modelRoot, node, tpl?.slots ?? [], matHost, assets)
      }
      continue
    }
    const first = group.children[0] as Mesh | undefined
    // 材质已被能力包换掉（比如水面）的网格不动，否则会把它的材质冲掉
    if (first?.isMesh && first.userData.t3dOwnGeometry && first.material === first.userData.t3dAppliedMaterial) {
      applyNodeMaterialWithHost(first, node, matHost)
      first.userData.t3dAppliedMaterial = first.material
    }
  }
}

function attachFailureToast(container: HTMLElement) {
  let banner: HTMLDivElement | null = null
  let hideTimer = 0
  const failed = new Set<string>()
  return (name: string) => {
    failed.add(name)
    if (!banner) {
      banner = document.createElement('div')
      banner.style.cssText =
        'position:fixed;left:16px;bottom:16px;z-index:45;max-width:420px;padding:8px 12px;border-radius:8px;background:rgba(127,29,29,0.88);border:1px solid rgba(248,113,113,0.45);color:#fecaca;font-family:"Segoe UI",sans-serif;font-size:12px;line-height:1.5;pointer-events:none;transition:opacity 200ms ease;'
      container.appendChild(banner)
    }
    const names = [...failed]
    const head = names.slice(0, 3).join('、')
    banner.textContent = names.length > 3 ? `资源加载失败：${head} 等 ${names.length} 项` : `资源加载失败：${head}`
    banner.style.opacity = '1'
    if (hideTimer) window.clearTimeout(hideTimer)
    hideTimer = window.setTimeout(() => {
      if (banner) banner.style.opacity = '0'
    }, 6000)
  }
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
  return resolveToneMapping(mode)
}

function applyPlayerPicture(
  renderer: WebGPURenderer,
  scene: Scene,
  picture: ScenePicture,
  assetMgr: PlayerAssetManager,
  capabilities: Record<string, boolean>,
  volume: ReturnType<typeof createVolumeLight>,
) {
  const env = assetMgr.getEnvironment(picture.envAssetId)
  if (env) {
    scene.environment = env
  } else if (!capabilities[SKY_CAPABILITY_ID]) {
    scene.environment = null
  }
  if (!capabilities[SKY_CAPABILITY_ID]) {
    if (env) {
      scene.background = env
    } else {
      scene.background = new Color(picture.background || '#181d26')
    }
  }
  renderer.toneMapping = toneMappingOfPlayer(picture.toneMapping)
  renderer.toneMappingExposure = typeof picture.exposure === 'number' ? picture.exposure : 1.05
  volume.sync(picture)
  if (picture.fog && !skyFogActive() && !capabilityEnabled(capabilities, 'fog')) {
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
  const attachBackendInfo = async (r: WebGPURenderer, fallback: boolean) => {
    const backend = (r as unknown as {
      backend?: {
        constructor?: { name?: string }
        device?: { adapterInfo?: { vendor?: string; architecture?: string; device?: string; description?: string } }
        gl?: WebGL2RenderingContext
      }
    }).backend
    const backendName = backend?.constructor?.name ?? (fallback ? 'WebGLBackend' : 'WebGPUBackend')
    let gpuName = 'Unknown GPU'
    if (!fallback) {
      const info = backend?.device?.adapterInfo
      if (info) {
        gpuName = [info.vendor, info.description || info.device, info.architecture].filter(Boolean).join(' ') || gpuName
      } else if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
        const adapter = await (navigator as Navigator & { gpu?: { requestAdapter?: (opts?: { powerPreference?: string }) => Promise<{ info?: { vendor?: string; description?: string; device?: string } } | null> } })
          .gpu?.requestAdapter?.({ powerPreference: 'high-performance' }).catch(() => null)
        if (adapter?.info) {
          gpuName = [adapter.info.vendor, adapter.info.description || adapter.info.device].filter(Boolean).join(' ') || gpuName
        }
      }
    } else if (backend?.gl) {
      const ext = backend.gl.getExtension('WEBGL_debug_renderer_info')
      if (ext) {
        gpuName = String(backend.gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || gpuName)
      }
    }
    ;(window as unknown as { __T3D_GPU_INFO__?: unknown }).__T3D_GPU_INFO__ = {
      backend: backendName,
      isWebGPU: !fallback,
      gpu: gpuName,
    }
    console.info(`[T3D Player] 渲染后端: ${backendName}${fallback ? ' (WebGL2 回退)' : ' (WebGPU)'} | GPU: ${gpuName}`)
  }
  try {
    const webgpu = new WebGPURenderer({ canvas: primary, antialias: true, powerPreference: 'high-performance' })
    await webgpu.init()
    webgpu.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    webgpu.shadowMap.enabled = true
    webgpu.shadowMap.type = PCFShadowMap
    await attachBackendInfo(webgpu, false)
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
    await attachBackendInfo(webgl, true)
    return { renderer: webgl, canvas: fallbackCanvas }
  }
}

async function boot() {
  const rootEl = document.getElementById('player-root') ?? document.body
  const canvasStyle = 'display:block;width:100vw;height:100vh;'

  // 立即并行启动 WebGPU 适配器/渲染器初始化与工程清单读取，省掉串行等待时间
  const rendererPromise = createRenderer(rootEl, canvasStyle)

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
    (nodeId) => (mounted ? ensurePlayerAnimEntry(nodeId, mounted, world.getNodes()) : undefined),
    (node) => {
      if (!mounted) return
      const obj = mountSinglePlayerNode(node, mounted, assetMgr, assets, world.getNodes(), new Map())
      const parent = node.parentId && !node.socketBone ? mounted.map.get(node.parentId) : undefined
      ;(parent ?? mounted.root).add(obj)
    },
  )
  setRuntimeWorld(world)
  const [, { renderer }] = await Promise.all([
    syncCapabilityRuntimes(world.getCapabilities()),
    rendererPromise,
  ])
  const canvas = renderer.domElement
  assetMgr.setBc7Supported(rendererSupportsBc7(renderer))
  // 提示条只在构建设置里打开调试开关时显示；默认玩家看不到，失败只写控制台
  if (payload.buildSettings?.showLoadFailures === true) {
    assetMgr.setFailureHandler(attachFailureToast(rootEl))
  }
  const picturePipeline = new RuntimePicturePipeline(renderer, {
    onError: (msg) => console.error('[T3D Player]', msg),
  })
  const volume = createVolumeLight()
  const scene = new Scene()
  scene.add(volume.mesh)
  mountParticles(scene)
  const camera = new PerspectiveCamera(55, window.innerWidth / Math.max(1, window.innerHeight), 0.1, 1000)
  camera.position.set(0, 4, 8)
  camera.lookAt(0, 1, 0)
  attachAudioListener(camera)
  mountPlayerUiOverlay(rootEl)
  ;(window as unknown as { __T3D_ASSET_STATS__?: () => unknown }).__T3D_ASSET_STATS__ = () => assetMgr.stats()
  let switchingScene = false

  const preloadMode = payload.buildSettings?.preloadMode ?? 'entry-scene'
  const entryId = payload.entrySceneId ?? payload.activeSceneId ?? 'default'

  const getPreloadIdsForScene = (sceneId: string): string[] => {
    const sc = payload.scenes?.[sceneId]
    if (sc?.requiredAssetIds) return sc.requiredAssetIds
    return Object.keys(assets)
  }

  const keepIdsForScene = (sceneId: string, nodes: Record<string, SceneNode>, pic: ScenePicture | undefined): Set<string> => {
    const keep = new Set<string>(getPreloadIdsForScene(sceneId))
    if (loadingCfg.logoAssetId) keep.add(loadingCfg.logoAssetId)
    if (loadingCfg.backgroundAssetId) keep.add(loadingCfg.backgroundAssetId)
    collectPlayerNodeDeps(nodes, pic, assets, keep)
    return keep
  }

  const initialPreloadIds = preloadMode === 'minimal'
    ? []
    : preloadMode === 'all-scenes'
      ? [...new Set(Object.keys(payload.scenes ?? {}).flatMap((id) => getPreloadIdsForScene(id)))]
      : getPreloadIdsForScene(entryId)

  await assetMgr.preloadList(initialPreloadIds, (loaded, total, category) => {
    overlay.setProgress((loaded / Math.max(1, total)) * 0.85, category)
  })

  overlay.setProgress(0.9, '场景与脚本')
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
  overlay.setProgress(0.95, '渲染管线')
  if (initEffects) {
    picturePipeline.render(scene, camera, initPic, initW, initH)
  }
  await picturePipeline.precompile(scene, camera, initEffects).catch(() => undefined)
  overlay.setProgress(1, '')
  await overlay.hide()

  // 小工程才在空闲时把其余场景后台预热；资源多的大工程留到切场景时再按需加载，避免把整包全塞进显存
  const loadableCount = Object.values(assets).filter(
    (a) => a.url && (a.kind === 'model' || a.kind === 'animation' || a.kind === 'texture' || a.kind === 'environment'),
  ).length
  if (preloadMode === 'entry-scene' && payload.scenes && loadableCount <= IDLE_WARMUP_MAX_ASSETS) {
    const otherIds = Object.keys(payload.scenes).filter((id) => id !== entryId)
    const restAssets = [...new Set(otherIds.flatMap((id) => getPreloadIdsForScene(id)))]
    if (restAssets.length > 0) {
      const idle = (globalThis as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback
      const warmup = () => {
        if (!switchingScene && world.getActiveSceneId() === entryId) {
          void assetMgr.preloadList(restAssets)
        }
      }
      if (typeof idle === 'function') idle(warmup)
      else setTimeout(warmup, 1200)
    }
  }

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
        assetMgr.resetFailures()
        if (loadingCfg.enabled && loadingCfg.showOnSceneSwitch) {
          overlay.show(`正在切换场景：${nextScene.name}`)
        }
        const loadSceneJson = async () => {
          if (nextScene.nodes) return
          if (!nextScene.sceneUrl) {
            nextScene.nodes = {}
            return
          }
          const res = await fetch(nextScene.sceneUrl)
          if (!res.ok) throw new Error(`无法加载场景数据: ${nextScene.sceneUrl}`)
          const sceneData = (await res.json()) as { nodes?: Record<string, SceneNode>; picture?: ScenePicture }
          nextScene.nodes = sceneData.nodes ?? {}
          if (sceneData.picture && !nextScene.picture) nextScene.picture = sceneData.picture
        }
        await Promise.all([
          loadSceneJson(),
          assetMgr.preloadList(getPreloadIdsForScene(nextId), (loaded, total, category) => {
            overlay.setProgress(loaded / Math.max(1, total), category)
          }),
        ])
        disposeParticles()
        if (mounted) {
          for (const mixer of mounted.mixers) mixer.stopAllAction()
          scene.remove(mounted.root)
          disposeSceneBranch(mounted.root)
        }
        clearScriptRuntimeState()
        switchSceneData(nextId, nextScene.nodes ?? {}, nextScene.picture)
        for (const script of payload.scripts ?? []) {
          compileAndRegisterScript(script.id, script.relativePath, script.source)
        }
        mounted = mountSceneObjects(scene, world.getNodes(), assetMgr, assets)
        applyInitialSceneCamera(camera, world.getNodes(), mounted.map)
        applyPlayerPicture(renderer, scene, world.getPicture(), assetMgr, world.getCapabilities(), volume)
        bumpPlayerUiScene()
        // 新场景挂载完后再释放上一场景不再引用的模型与贴图
        assetMgr.releaseUnreferenced(keepIdsForScene(nextId, world.getNodes(), world.getPicture()))
        // 切换期间到位的按需资源已经随新场景一起挂上了，不用再刷一遍
        assetMgr.consumeLazyReady()
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
        if (isCutsceneDrivingAnim(nodeId)) continue
        const node = nodes[nodeId]
        if (node?.animator?.enabled && node.clipPlaying !== false) {
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
        const hasRunning = entry.actions.size > 0 && Array.from(entry.actions.values()).some((a) => a.isRunning() && !a.paused)
        if (!hasRunning) continue
        markSkeletonsDirty(entry.rootScene)
        entry.mixer.update(dt)
      }
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
    sampleNodeAnimation: (nodeId, clips, time) => {
      if (!mounted) return false
      const entry = ensurePlayerAnimEntry(nodeId, mounted, world.getNodes())
      if (!entry) return false
      return sampleCutsceneAnimationClips(entry.mixer, entry.actions, entry.ownerAssetId, clips, time, {
        getClip: (sourceAssetId, clipName) => {
          const resolved = resolvePlayerClipAndAsset(entry.ownerAssetId, clipName, sourceAssetId, assetMgr)
          if (!resolved) return null
          return buildBoundClip(resolved.clip, resolved.sourceId, entry.ownerAssetId, assetMgr, 'full', false)
        },
      })
    },
  }

  let lastTime = performance.now()
  const frame = (now: number) => {
    const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000))
    lastTime = now
    for (const item of beforeRenderHooks) {
      item.hook({ renderer, scene, camera, dt })
    }
    // 按需加载的资源到位后把它们补到场景上（每帧最多一次，切场景途中不处理）
    if (!switchingScene && mounted && assetMgr.consumeLazyReady()) {
      applyMountedTextures(mounted, world.getNodes(), assetMgr, assets)
      applyPlayerPicture(renderer, scene, world.getPicture(), assetMgr, world.getCapabilities(), volume)
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
    const pic = applyCutscenePictureOverrides(world.getPicture())
    if (pic !== world.getPicture()) {
      renderer.toneMappingExposure = pic.exposure ?? 1.05
    }
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
