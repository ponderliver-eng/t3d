import {
  AmbientLight,
  BoxGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Scene,
  SphereGeometry,
  SpotLight,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector3,
} from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { WebGPURenderer } from 'three/webgpu'
import { syncCapabilityRuntimes } from '../capabilities/registry'
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
import { attachAudioListener } from '../runtime/audio'
import '../runtime/camera'
import '../runtime/character'
import '../runtime/locomotion'
import '../runtime/devices'
import '../runtime/rules'
import { stepSceneRuntime, type SceneRuntimeHost } from '../runtime/sceneRuntime'
import '../runtime/soundSource'
import { setRuntimeWorld, type RuntimeAssetSummary, type RuntimeRenderContext, type RuntimeWorld } from '../runtime/world'

interface ExportedAssetEntry extends RuntimeAssetSummary {
  fileName?: string
  slot?: PbrSlot
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
  private readonly modelCache = new Map<string, Group>()
  private readonly texCache = new Map<string, Texture>()
  private readonly pending = new Map<string, Promise<void>>()

  constructor(private readonly assets: Record<string, ExportedAssetEntry>) {
    this.gltfLoader.setMeshoptDecoder(MeshoptDecoder)
  }

  getModelClone(assetId: string): Group | null {
    const tpl = this.modelCache.get(assetId)
    return tpl ? tpl.clone(true) : null
  }

  getTexture(assetId: string): Texture | null {
    return this.texCache.get(assetId) ?? null
  }

  async ensureAsset(assetId: string): Promise<void> {
    if (this.modelCache.has(assetId) || this.texCache.has(assetId)) return
    const inflight = this.pending.get(assetId)
    if (inflight) return inflight

    const asset = this.assets[assetId]
    if (!asset?.url) return

    const task = (async () => {
      try {
        if (asset.kind === 'model' || asset.kind === 'animation') {
          const gltf = await this.gltfLoader.loadAsync(asset.url!)
          this.modelCache.set(assetId, gltf.scene)
        } else if (asset.kind === 'texture') {
          const lower = (asset.fileName || asset.url || '').toLowerCase()
          if (lower.endsWith('.ktx2') || lower.endsWith('.tga')) return
          const tex = await this.texLoader.loadAsync(asset.url!)
          tex.colorSpace = SRGBColorSpace
          this.texCache.set(assetId, tex)
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
      return Boolean(a?.url && (a.kind === 'model' || a.kind === 'animation' || a.kind === 'texture'))
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
  if (node.kind === 'sphere') return new SphereGeometry(0.5, 24, 16)
  if (node.kind === 'cylinder') return new CylinderGeometry(0.5, 0.5, 1, 24)
  if (node.kind === 'capsule') return new CapsuleGeometry(0.35, 0.7, 8, 16)
  if (node.kind === 'plane') {
    const geo = new PlaneGeometry(10, 10)
    geo.rotateX(-Math.PI / 2)
    return geo
  }
  return null
}

function buildStandaloneWorld(payload: ExportedProjectPayload) {
  const initialSceneId = payload.entrySceneId ?? payload.activeSceneId ?? 'default'
  const firstScene = payload.scenes?.[initialSceneId]
  let activeSceneId = initialSceneId
  let nodes: Record<string, SceneNode> = structuredClone(firstScene?.nodes ?? payload.nodes ?? {})
  let picture: ScenePicture = structuredClone((firstScene?.picture ?? payload.picture ?? {}) as ScenePicture)
  const capabilities = payload.capabilities ?? {}
  const gameplayPacks = payload.gameplayPacks ?? ['core']
  const gameDatabase = payload.gameDatabase ?? { tables: {} }
  const assets = payload.assets ?? {}
  const beforeRenderHooks: Array<{ id: string; order: number; hook: (ctx: RuntimeRenderContext) => void }> = []

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
  }

  return { world, beforeRenderHooks, switchSceneData }
}

function mountSceneObjects(
  scene: Scene,
  nodes: Record<string, SceneNode>,
  assetMgr: PlayerAssetManager,
  assets: Record<string, ExportedAssetEntry>,
): { root: Group; map: Map<string, Group> } {
  const map = new Map<string, Group>()
  const root = new Group()
  scene.add(root)

  for (const node of Object.values(nodes)) {
    const group = new Group()
    group.name = node.name
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
      const matAsset = node.materialAssetId ? assets[node.materialAssetId] : undefined
      const slot = matAsset?.slot ?? node.slots?.[0]
      const tex = slot?.mapAssetId ? assetMgr.getTexture(slot.mapAssetId) : null
      const mat = new MeshStandardMaterial({
        color: slot?.color || node.color || '#8c96a4',
        roughness: slot?.roughness ?? node.roughness ?? 0.7,
        metalness: slot?.metalness ?? node.metalness ?? 0.1,
        map: tex,
      })
      const mesh = new Mesh(geo, mat)
      mesh.castShadow = Boolean(node.castShadow)
      mesh.receiveShadow = node.receiveShadow !== false
      group.add(mesh)
    } else if (node.kind === 'model' && node.assetId) {
      const modelClone = assetMgr.getModelClone(node.assetId)
      if (modelClone) {
        modelClone.traverse((child) => {
          if ((child as Mesh).isMesh) {
            child.castShadow = Boolean(node.castShadow)
            child.receiveShadow = node.receiveShadow !== false
          }
        })
        group.add(modelClone)
      }
    } else if (node.kind === 'directional-light') {
      const light = new DirectionalLight(node.color || '#ffffff', node.intensity ?? 2)
      light.castShadow = Boolean(node.castShadow)
      group.add(light)
    } else if (node.kind === 'point-light') {
      const light = new PointLight(node.color || '#ffffff', node.intensity ?? 2, node.range ?? 15)
      group.add(light)
    } else if (node.kind === 'spot-light') {
      const light = new SpotLight(node.color || '#ffffff', node.intensity ?? 2, node.range ?? 15)
      group.add(light)
    } else if (node.kind === 'hemisphere-light') {
      const light = new HemisphereLight(node.color || '#dbeafe', '#334155', node.intensity ?? 1)
      group.add(light)
    }

    map.set(node.id, group)
  }

  for (const node of Object.values(nodes)) {
    const obj = map.get(node.id)
    if (!obj) continue
    const parent = node.parentId ? map.get(node.parentId) : undefined
    ;(parent ?? root).add(obj)
  }

  // 保底基础环境光，避免无灯光场景全黑
  const hasAnyLight = Object.values(nodes).some((n) => n.kind.endsWith('-light'))
  if (!hasAnyLight) {
    root.add(new AmbientLight('#ffffff', 0.65))
    const key = new DirectionalLight('#ffffff', 1.6)
    key.position.set(6, 12, 8)
    root.add(key)
  }

  return { root, map }
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

async function createRenderer(canvas: HTMLCanvasElement): Promise<WebGPURenderer> {
  try {
    const webgpu = new WebGPURenderer({ canvas, antialias: true })
    await webgpu.init()
    return webgpu
  } catch {
    const webgl = new WebGPURenderer({ canvas, antialias: true, forceWebGL: true })
    await webgl.init()
    return webgl
  }
}

async function boot() {
  const rootEl = document.getElementById('player-root') ?? document.body
  const canvas = document.createElement('canvas')
  canvas.style.cssText = 'display:block;width:100vw;height:100vh;'
  rootEl.appendChild(canvas)

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
  const overlay = new LoadingOverlay(rootEl, loadingCfg, assets, payload.name || 'Tact3D')
  overlay.show()

  if (payload.inputMap) {
    setInputActionMap(normalizeInputMap(payload.inputMap))
  }
  bindGlobalInputListeners()
  attachTouchOverlay(rootEl)

  const { world, beforeRenderHooks, switchSceneData } = buildStandaloneWorld(payload)
  setRuntimeWorld(world)
  syncCapabilityRuntimes(world.getCapabilities())

  const renderer = await createRenderer(canvas)
  const scene = new Scene()
  const camera = new PerspectiveCamera(55, window.innerWidth / Math.max(1, window.innerHeight), 0.1, 1000)
  camera.position.set(0, 4, 8)
  camera.lookAt(0, 1, 0)
  attachAudioListener(camera)

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

  for (const script of payload.scripts ?? []) {
    compileAndRegisterScript(script.id, script.relativePath, script.source)
  }

  let mounted = mountSceneObjects(scene, world.getNodes(), assetMgr, assets)
  scene.background = new Color(world.getPicture().background || '#181d26')

  // 进场前预编译着色器，减少首次渲染掉帧
  const maybeCompileAsync = (renderer as unknown as { compileAsync?: (s: Scene, c: PerspectiveCamera) => Promise<void> }).compileAsync
  if (typeof maybeCompileAsync === 'function') {
    await maybeCompileAsync.call(renderer, scene, camera).catch(() => undefined)
  }
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
        scene.remove(mounted.root)
        clearScriptRuntimeState()
        switchSceneData(nextId, nextScene.nodes, nextScene.picture)
        for (const script of payload.scripts ?? []) {
          compileAndRegisterScript(script.id, script.relativePath, script.source)
        }
        mounted = mountSceneObjects(scene, world.getNodes(), assetMgr, assets)
        scene.background = new Color(world.getPicture().background || '#181d26')
        if (typeof maybeCompileAsync === 'function') {
          await maybeCompileAsync.call(renderer, scene, camera).catch(() => undefined)
        }
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
  const host: SceneRuntimeHost = {
    ready: true,
    resolveObject: (id) => mounted.map.get(id) ?? null,
    updateAnimations: () => {},
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
  }

  let lastTime = performance.now()
  const frame = (now: number) => {
    const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000))
    lastTime = now
    if (!switchingScene) stepSceneRuntime(dt, host)
    for (const item of beforeRenderHooks) {
      item.hook({ renderer, scene, camera, dt })
    }
    renderer.render(scene, camera)
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

void boot().catch((err) => {
  console.error('[T3D Player] 启动失败:', err)
})
