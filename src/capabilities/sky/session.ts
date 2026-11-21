import { capabilityEnabled } from '../registry'
import { getRuntimeWorld, type RuntimeRenderContext } from '../../runtime/world'
import { SKY_CAPABILITY_ID, normalizeSkySettings, type SkySettings } from './defaults'
import type { Camera, Scene } from 'three'
import type { WebGPURenderer } from 'three/webgpu'

type ViewportRenderContext = RuntimeRenderContext & { renderer: WebGPURenderer; scene: Scene; camera: Camera }

interface SkyDriver {
  sync: (settings: SkySettings, camera: Camera) => void
  compile: () => Promise<void>
  hazeReady: () => boolean
  dispose: () => void
}

type SkyFogApply = (colorNode: unknown, scenePass: unknown) => unknown

let ownsSlots = false
let fogActive = false
let fogApply: SkyFogApply | null = null
let fogSignature = ''
let fogRevision = 0
let removeHook: (() => void) | null = null
let driver: SkyDriver | null = null
let booting = false
let bootToken = 0
let pending: ViewportRenderContext | null = null
let compiling = false

export function skyOwnsSceneSlots() {
  return ownsSlots
}

/** 天空着色器编译期间主绘制让路，避免和立方体烘焙抢同一台渲染器。 */
export function skyBlocksFrame() {
  return compiling
}

export function skyFogActive() {
  return fogActive
}

export function skyFogRevision() {
  return fogRevision
}

export function composeSkyFog(colorNode: unknown, scenePass: unknown) {
  return fogApply ? fogApply(colorNode, scenePass) : colorNode
}

export function setSkyViewState(next: { owns: boolean, fog: boolean, apply: SkyFogApply | null, signature?: string }) {
  ownsSlots = next.owns
  const signature = next.signature ?? ''
  if (fogActive === next.fog && fogApply === next.apply && fogSignature === signature) return
  fogActive = next.fog
  fogApply = next.apply
  fogSignature = signature
  fogRevision += 1
}

/** 视口销毁时丢掉绑定旧渲染器的天空，钩子留着，下一次绘制会按新渲染器重建。 */
export function releaseSkyResources() {
  bootToken += 1
  booting = false
  compiling = false
  driver?.dispose()
  driver = null
  setSkyViewState({ owns: false, fog: false, apply: null })
}

export function mount() {
  if (removeHook) return () => shutdown()
  removeHook = getRuntimeWorld().registerBeforeRenderHook?.('sky', 20, ctx => onBeforeRender(ctx as ViewportRenderContext)) ?? null
  return () => shutdown()
}

export function dispose() {
  shutdown()
}

function shutdown() {
  removeHook?.()
  removeHook = null
  releaseSkyResources()
}

function onBeforeRender(ctx: ViewportRenderContext) {
  pending = ctx
  try {
    const runtime = getRuntimeWorld()
    if (!capabilityEnabled(runtime.getCapabilities(), SKY_CAPABILITY_ID)) {
      if (driver || booting || compiling) releaseSkyResources()
      return
    }
    const settings = normalizeSkySettings(runtime.getPicture().capabilities?.[SKY_CAPABILITY_ID])
    if (!driver) {
      ensure()
      return
    }
    if (compiling) return
    if (settings.haze && !driver.hazeReady()) {
      driver.dispose()
      driver = null
      ensure()
      return
    }
    driver.sync(settings, ctx.camera)
  } catch (error) {
    console.warn('[sky] 天空更新失败', error)
  } finally {
    restoreCanvas(ctx)
  }
}

function restoreCanvas(ctx: ViewportRenderContext) {
  try {
    ctx.renderer.setRenderTarget(null)
  } catch {
    // 渲染器已经在恢复画布，忽略这次失败。
  }
}

function ensure() {
  if (booting || !pending) return
  booting = true
  const token = ++bootToken
  const ctx = pending
  void import('./runtime').then(module => {
    if (token !== bootToken) return
    booting = false
    const runtime = getRuntimeWorld()
    if (!capabilityEnabled(runtime.getCapabilities(), SKY_CAPABILITY_ID) || !pending) return
    let created: SkyDriver
    try {
      created = module.createSkyDriver(ctx.renderer, ctx.scene)
    } catch (error) {
      console.warn('[sky] 天空创建失败', error)
      return
    }
    driver = created
    compiling = true
    void created.compile().then(() => {
      if (token !== bootToken || driver !== created || !pending) return
      const latest = getRuntimeWorld()
      if (!capabilityEnabled(latest.getCapabilities(), SKY_CAPABILITY_ID)) return
      created.sync(normalizeSkySettings(latest.getPicture().capabilities?.[SKY_CAPABILITY_ID]), pending.camera)
    }).catch(error => {
      console.warn('[sky] 着色器编译失败', error)
    }).finally(() => {
      if (token === bootToken) compiling = false
    })
  }).catch(error => {
    if (token === bootToken) booting = false
    console.warn('[sky] 天空加载失败', error)
  })
}
