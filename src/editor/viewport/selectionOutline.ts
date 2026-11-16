import {
  Color,
  Mesh,
  Node,
  NodeMaterial,
  NodeUpdateType,
  RenderTarget,
  RendererUtils,
  Vector2,
  type Camera,
  type Material,
  type Object3D,
  type Scene,
} from 'three/webgpu'
import { Fn, float, max, passTexture, screenUV, uniform, vec2, vec4 } from 'three/tsl'
import { EDITOR_HELPER_LAYER } from '../project/taxonomy'

const size = new Vector2()
let savedState = {} as ReturnType<typeof RendererUtils.resetRendererState>

/**
 * 极简可定制屏幕空间轮廓节点（集成在 RenderPipeline 中）：
 * - updateBefore() 仅将被选中或闪烁的目标 Mesh 渲染到一张单通道 Mask RT（R=选中，G=部件闪烁），
 *   不重画未选中的全场景物体，也不跑多重高斯模糊；
 * - setup() 在主后期管线的全屏输出阶段直接采样 Mask RT 的 8 邻域并与原图 alpha 混合，
 *   因为合成发生在 RenderPipeline 的单次输出 Pass 内，不会触发 WebGPU fullscreenPass 的二次清屏。
 */
export class SelectionOutlineNode extends Node {
  readonly selectedRoots: Object3D[] = []
  flashRoot: Object3D | null = null
  readonly selectionColor = uniform(new Color('#ff9933'))
  readonly flashColor = uniform(new Color('#39ff14'))
  readonly thickness = uniform(2.2)

  private readonly maskTarget = new RenderTarget(1, 1, { depthBuffer: false })
  private readonly maskSelectMaterial = new NodeMaterial()
  private readonly maskFlashMaterial = new NodeMaterial()
  private readonly invSize = uniform(new Vector2(1 / 1024, 1 / 768))
  private readonly maskTextureNode = passTexture(this as never, this.maskTarget.texture)
  private readonly maskPassCache = new Map<Material, { material: NodeMaterial, version: number }>()
  private readonly flashPassCache = new Map<Material, { material: NodeMaterial, version: number }>()
  private readonly selectedMeshes = new Set<Object3D>()
  private readonly flashMeshes = new Set<Object3D>()
  private hadContent = false

  constructor(
    private readonly scene: Scene,
    private readonly camera: Camera,
  ) {
    super('vec4')
    this.updateBeforeType = NodeUpdateType.FRAME

    this.maskSelectMaterial.colorNode = vec4(1, 0, 0, 1)
    this.maskSelectMaterial.depthTest = false
    this.maskSelectMaterial.depthWrite = false

    this.maskFlashMaterial.colorNode = vec4(0, 1, 0, 1)
    this.maskFlashMaterial.depthTest = false
    this.maskFlashMaterial.depthWrite = false
  }

  updateBefore(frame: { renderer?: unknown }): boolean | undefined {
    const renderer = frame.renderer as import('three/webgpu').WebGPURenderer
    this.selectedMeshes.clear()
    this.flashMeshes.clear()

    const helperMask = 1 << EDITOR_HELPER_LAYER
    for (const root of this.selectedRoots) {
      root.traverse(child => {
        const mesh = child as Mesh
        if (!mesh.isMesh || (mesh.layers.mask & helperMask) !== 0 || !isVisibleChain(mesh, this.scene)) return
        this.selectedMeshes.add(mesh)
      })
    }
    if (this.flashRoot) {
      this.flashRoot.traverse(child => {
        const mesh = child as Mesh
        if (!mesh.isMesh || (mesh.layers.mask & helperMask) !== 0 || !isVisibleChain(mesh, this.scene)) return
        this.flashMeshes.add(mesh)
      })
    }

    if (this.selectedMeshes.size === 0 && this.flashMeshes.size === 0) {
      if (this.hadContent) {
        savedState = RendererUtils.resetRendererState(renderer, savedState)
        renderer.setRenderTarget(this.maskTarget)
        renderer.setClearColor(0x000000, 0)
        renderer.clear(true, false, false)
        RendererUtils.restoreRendererState(renderer, savedState)
        this.hadContent = false
      }
      return undefined
    }

    this.hadContent = true
    renderer.getDrawingBufferSize(size)
    const w = Math.max(1, Math.round(size.width))
    const h = Math.max(1, Math.round(size.height))
    if (this.maskTarget.width !== w || this.maskTarget.height !== h) {
      this.maskTarget.setSize(w, h)
    }
    this.invSize.value.set(1 / w, 1 / h)

    const prevBg = this.scene.background
    const prevBgNode = this.scene.backgroundNode
    const prevOverride = this.scene.overrideMaterial
    this.scene.background = null
    this.scene.backgroundNode = null
    this.scene.overrideMaterial = null
    savedState = RendererUtils.resetRendererState(renderer, savedState)
    try {
      renderer.setRenderTarget(this.maskTarget)
      renderer.setClearColor(0x000000, 0)
      renderer.clear(true, false, false)

      renderer.setRenderObjectFunction((object: Object3D, sc: Scene, cam: Camera, geometry, material: Material, group, lightsNode, clippingContext) => {
        const isFlash = this.flashMeshes.has(object)
        const isSelected = this.selectedMeshes.has(object)
        if (!isFlash && !isSelected) return
        const base = isFlash ? this.maskFlashMaterial : this.maskSelectMaterial
        const cache = isFlash ? this.flashPassCache : this.maskPassCache
        const passMat = this.passMaterialFor(cache, base, material)
        renderer.renderObject(object, sc, cam, geometry, passMat, group, lightsNode, clippingContext)
      })

      renderer.render(this.scene, this.camera)
      renderer.setRenderObjectFunction(savedState.renderObjectFunction as never)
    } finally {
      RendererUtils.restoreRendererState(renderer, savedState)
      this.scene.background = prevBg
      this.scene.backgroundNode = prevBgNode
      this.scene.overrideMaterial = prevOverride
    }
    return undefined
  }

  setup() {
    const maskTex = this.maskTextureNode
    const inv = this.invSize
    const step = this.thickness
    const selCol = this.selectionColor
    const flsCol = this.flashColor

    return Fn(() => {
      const centerUv = screenUV
      const center = maskTex.sample(centerUv).toVar()
      const d = inv.mul(step).toVar()

      const n0 = maskTex.sample(centerUv.add(vec2(d.x, float(0)))).toVar()
      const n1 = maskTex.sample(centerUv.sub(vec2(d.x, float(0)))).toVar()
      const n2 = maskTex.sample(centerUv.add(vec2(float(0), d.y))).toVar()
      const n3 = maskTex.sample(centerUv.sub(vec2(float(0), d.y))).toVar()

      const diag = d.mul(0.7071).toVar()
      const n4 = maskTex.sample(centerUv.add(vec2(diag.x, diag.y))).toVar()
      const n5 = maskTex.sample(centerUv.add(vec2(diag.x.negate(), diag.y))).toVar()
      const n6 = maskTex.sample(centerUv.add(vec2(diag.x, diag.y.negate()))).toVar()
      const n7 = maskTex.sample(centerUv.sub(vec2(diag.x, diag.y))).toVar()

      const maxR = max(max(max(n0.r, n1.r), max(n2.r, n3.r)), max(max(n4.r, n5.r), max(n6.r, n7.r)))
      const maxG = max(max(max(n0.g, n1.g), max(n2.g, n3.g)), max(max(n4.g, n5.g), max(n6.g, n7.g)))

      const edgeSel = maxR.sub(center.r).clamp(0, 1)
      const edgeFlash = maxG.sub(center.g).clamp(0, 1)
      const alpha = max(edgeSel, edgeFlash)
      const rgb = edgeFlash.greaterThan(0.01).select(flsCol, selCol)
      return vec4(rgb, alpha)
    })()
  }

  dispose() {
    super.dispose()
    this.selectedRoots.length = 0
    this.flashRoot = null
    this.maskTarget.dispose()
    this.maskSelectMaterial.dispose()
    this.maskFlashMaterial.dispose()
    for (const cache of [this.maskPassCache, this.flashPassCache]) {
      for (const [orig, entry] of cache) {
        orig.removeEventListener('dispose', this.onMaterialDispose)
        entry.material.dispose()
      }
      cache.clear()
    }
  }

  private onMaterialDispose = (event: { target: Material }) => {
    const orig = event.target
    orig.removeEventListener('dispose', this.onMaterialDispose)
    for (const cache of [this.maskPassCache, this.flashPassCache]) {
      const entry = cache.get(orig)
      if (entry) {
        entry.material.dispose()
        cache.delete(orig)
      }
    }
  }

  private passMaterialFor(
    cache: Map<Material, { material: NodeMaterial, version: number }>,
    base: NodeMaterial,
    original: Material,
  ): NodeMaterial {
    const nodeOriginal = original as Material & { positionNode?: NodeMaterial['positionNode'] }
    if (!nodeOriginal.positionNode) return base
    let entry = cache.get(original)
    if (!entry) {
      const cloned = base.clone()
      cloned.positionNode = nodeOriginal.positionNode ?? null
      entry = { material: cloned, version: original.version }
      cache.set(original, entry)
      original.addEventListener('dispose', this.onMaterialDispose)
      return cloned
    }
    if (entry.version !== original.version) {
      entry.material.positionNode = nodeOriginal.positionNode ?? null
      entry.material.needsUpdate = true
      entry.version = original.version
    }
    return entry.material
  }
}

function isVisibleChain(object: Object3D, stop: Object3D): boolean {
  let cur: Object3D | null = object
  while (cur && cur !== stop) {
    if (!cur.visible) return false
    cur = cur.parent
  }
  return true
}
