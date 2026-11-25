import {
  AmbientLight,
  DirectionalLight,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
  type Object3D,
} from 'three'
import { boundsOf } from '../scene/bounds'

export async function imageThumb(url: string): Promise<string | null> {
  try {
    const image = await loadImage(url)
    const canvas = document.createElement('canvas')
    canvas.width = 96
    canvas.height = 96
    const context = canvas.getContext('2d')
    if (!context) return null
    context.fillStyle = '#1b1e24'
    context.fillRect(0, 0, 96, 96)
    const scale = Math.min(96 / image.width, 96 / image.height)
    const width = image.width * scale
    const height = image.height * scale
    context.drawImage(image, (96 - width) / 2, (96 - height) / 2, width, height)
    return canvas.toDataURL('image/png')
  } catch {
    return null
  }
}

/** 用一段图片字节（比如资源包自带的预览图）生成缩略图。 */
export async function bytesThumb(bytes: Uint8Array): Promise<string | null> {
  if (bytes.byteLength === 0) return null
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const url = URL.createObjectURL(new Blob([copy.buffer]))
  try {
    return await imageThumb(url)
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function labelThumb(text: string): string {
  const canvas = document.createElement('canvas')
  canvas.width = 96
  canvas.height = 96
  const context = canvas.getContext('2d')
  if (!context) return ''
  context.fillStyle = '#243044'
  context.fillRect(0, 0, 96, 96)
  context.fillStyle = '#d5dde6'
  context.font = '700 16px sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(text, 48, 48)
  return canvas.toDataURL('image/png')
}

export function renderModelThumb(root: Object3D): string | null {
  const canvas = document.createElement('canvas')
  canvas.width = 96
  canvas.height = 96
  let renderer: WebGLRenderer | null = null
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true })
    renderer.setSize(96, 96, false)
    renderer.setClearColor(0x000000, 0)
    const scene = new Scene()
    const object = root.clone(true)
    scene.add(object)
    scene.add(new AmbientLight(0xffffff, 0.7))
    const sun = new DirectionalLight(0xffffff, 1.4)
    sun.position.set(2, 4, 3)
    scene.add(sun)
    const box = boundsOf(object)
    const center = box.isEmpty() ? new Vector3() : box.getCenter(new Vector3())
    const radius = Math.max(box.isEmpty() ? 1 : box.getSize(new Vector3()).length() * 0.5, 0.4)
    const camera = new PerspectiveCamera(35, 1, 0.01, radius * 20)
    camera.position.copy(center).add(new Vector3(radius, radius * 0.75, radius).multiplyScalar(2.2))
    camera.lookAt(center)
    renderer.render(scene, camera)
    return canvas.toDataURL('image/png')
  } catch {
    return null
  } finally {
    // 浏览器同时只留十几个上下文，批量出图时不主动释放会导致后面的缩略图全部失败
    renderer?.forceContextLoss()
    renderer?.dispose()
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('缩略图读取失败'))
    image.src = url
  })
}
