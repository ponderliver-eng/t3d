import type { Camera, Scene } from 'three'
import type { WebGPURenderer } from 'three/webgpu'

export interface ViewportRenderContext {
  readonly renderer: WebGPURenderer
  readonly scene: Scene
  readonly camera: Camera
  readonly width: number
  readonly height: number
  readonly dt: number
}

export type ViewportBeforeRenderHook = (ctx: ViewportRenderContext) => void

const beforeRenderHooks: Array<{ id: string, order: number, hook: ViewportBeforeRenderHook }> = []

/**
 * 注册在主场景绘制前执行的渲染钩子（如水体平面反射 Pass、离屏缓冲更新、天象 Uniform 更新）。
 * 保持 EditorViewport 自身不需要为每个新视觉能力包硬编码修改。
 */
export function registerBeforeRenderHook(id: string, order: number, hook: ViewportBeforeRenderHook): () => void {
  const index = beforeRenderHooks.findIndex(item => item.id === id)
  if (index >= 0) beforeRenderHooks.splice(index, 1)
  beforeRenderHooks.push({ id, order, hook })
  beforeRenderHooks.sort((a, b) => a.order - b.order)
  return () => {
    const idx = beforeRenderHooks.findIndex(item => item.id === id)
    if (idx >= 0) beforeRenderHooks.splice(idx, 1)
  }
}

export function runBeforeRenderHooks(ctx: ViewportRenderContext) {
  for (const item of beforeRenderHooks) {
    item.hook(ctx)
  }
}
