import type { Object3D } from 'three'

export interface RenderMetricsSnapshot {
  drawCalls: number
  triangles: number
  points: number
  lines: number
  geometries: number
  textures: number
}

export interface CaptureViewportOptions {
  width?: number
  height?: number
  mimeType?: 'image/png' | 'image/jpeg' | 'image/webp'
  quality?: number
}

export interface ViewportBridge {
  captureDataUrl: (options?: CaptureViewportOptions) => string | null
  getRenderMetrics: () => RenderMetricsSnapshot
  stepRuntime: (fixedDt: number) => void
  renderNow: () => void
  resolveObject: (nodeId: string) => Object3D | null
}

let activeBridge: ViewportBridge | null = null
let activeCompositeCapture: ((options?: CaptureViewportOptions) => Promise<string | null>) | null = null

export function registerViewportBridge(bridge: ViewportBridge | null): () => void {
  activeBridge = bridge
  return () => {
    if (activeBridge === bridge) activeBridge = null
  }
}

export function registerCompositeCapture(
  capturer: ((options?: CaptureViewportOptions) => Promise<string | null>) | null,
): () => void {
  activeCompositeCapture = capturer
  return () => {
    if (activeCompositeCapture === capturer) activeCompositeCapture = null
  }
}

export function getViewportBridge(): ViewportBridge | null {
  return activeBridge
}

/**
 * 复用主渲染器抓图（不创建第二个 WebGPURenderer/WebGLRenderer）。
 */
export function captureMainViewport(options?: CaptureViewportOptions): string | null {
  if (!activeBridge) return null
  activeBridge.renderNow()
  return activeBridge.captureDataUrl(options)
}

/**
 * 合成抓图（包含 3D 视口与叠加在其上的 UI DOM 层，优先使用宿主窗口区域截图）。
 */
export async function captureViewportComposite(options?: CaptureViewportOptions): Promise<string | null> {
  if (activeBridge) activeBridge.renderNow()
  if (activeCompositeCapture) {
    try {
      const composite = await activeCompositeCapture(options)
      if (composite) return composite
    } catch {
      // 回退到纯 3D 画布截图
    }
  }
  return captureMainViewport(options)
}

export function readMainRenderMetrics(): RenderMetricsSnapshot | null {
  return activeBridge?.getRenderMetrics() ?? null
}

/**
 * 把现有 HTMLCanvasElement 按目标宽高缩放输出为 DataURL（用于离屏缩略图与 AI 试玩截图）。
 */
export function snapshotCanvasToDataUrl(
  source: HTMLCanvasElement,
  options?: CaptureViewportOptions,
): string | null {
  if (typeof document === 'undefined' || source.width <= 0 || source.height <= 0) return null
  const mimeType = options?.mimeType ?? 'image/png'
  const quality = options?.quality ?? 0.92
  const targetWidth = options?.width && options.width > 0 ? Math.round(options.width) : source.width
  const targetHeight = options?.height && options.height > 0 ? Math.round(options.height) : source.height
  if (targetWidth === source.width && targetHeight === source.height) {
    try {
      return source.toDataURL(mimeType, quality)
    } catch {
      return null
    }
  }
  const scratch = document.createElement('canvas')
  scratch.width = targetWidth
  scratch.height = targetHeight
  const ctx = scratch.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(source, 0, 0, targetWidth, targetHeight)
  try {
    return scratch.toDataURL(mimeType, quality)
  } catch {
    return null
  }
}
