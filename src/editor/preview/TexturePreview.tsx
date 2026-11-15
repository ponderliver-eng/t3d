import { useEffect, useRef, useState } from 'react'
import {
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Texture,
  TextureLoader,
  Vector2,
  WebGLRenderer,
} from 'three'
import { useI18n } from '../i18n'
import { environmentFor, textureFor } from '../assets/textures'
import { useAssetStore } from '../assets/library'
import { popPreviewWindow } from './previewStore'

type Channel = 'rgb' | 'r' | 'g' | 'b' | 'a'

const CHANNEL: Record<Channel, number> = { rgb: 0, r: 1, g: 2, b: 3, a: 4 }

export function TexturePreview({ assetId, environment = false, standalone = false }: { assetId: string, environment?: boolean, standalone?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const channelRef = useRef<Channel>('rgb')
  const [channel, setChannel] = useState<Channel>('rgb')
  const [size, setSize] = useState('')
  channelRef.current = channel
  const { t } = useI18n()
  const asset = useAssetStore(state => state.assets[assetId])
  const revision = useAssetStore(state => state.revision)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !asset || !('url' in asset)) return
    const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    const scene = new Scene()
    const camera = new PerspectiveCamera(40, 1, 0.01, 20)
    camera.position.z = environment ? 2.6 : 2.2
    let map: Texture | null = environment ? environmentFor(assetId) : textureFor(assetId, true)
    let owned = false
    if (!map && !environment && asset.url) {
      map = new TextureLoader().load(asset.url)
      owned = true
    }
    const material = environment
      ? new MeshBasicMaterial({ map: map ?? undefined })
      : new ShaderMaterial({
        uniforms: {
          map: { value: map },
          channel: { value: 0 },
          pan: { value: new Vector2() },
          zoom: { value: 1 },
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D map;
          uniform int channel;
          uniform vec2 pan;
          uniform float zoom;
          varying vec2 vUv;
          void main() {
            vec2 uv = (vUv - 0.5) / max(zoom, 0.001) + 0.5 + pan;
            vec4 color = texture2D(map, uv);
            if (channel == 1) color = vec4(vec3(color.r), 1.0);
            else if (channel == 2) color = vec4(vec3(color.g), 1.0);
            else if (channel == 3) color = vec4(vec3(color.b), 1.0);
            else if (channel == 4) color = vec4(vec3(color.a), 1.0);
            gl_FragColor = color;
          }
        `,
      })
    const mesh = new Mesh(
      environment ? new SphereGeometry(1, 48, 32) : new PlaneGeometry(2.2, 2.2),
      material,
    )
    scene.add(mesh)
    let frame = 0
    const resize = () => {
      const rect = canvas.parentElement?.getBoundingClientRect()
      if (!rect || rect.width < 2) return
      renderer.setSize(rect.width, rect.height, false)
      camera.aspect = rect.width / Math.max(rect.height, 1)
      camera.updateProjectionMatrix()
    }
    const observer = new ResizeObserver(resize)
    if (canvas.parentElement) observer.observe(canvas.parentElement)
    resize()
    const onWheel = (event: WheelEvent) => {
      if (!(material instanceof ShaderMaterial)) {
        camera.position.z = Math.min(6, Math.max(1.2, camera.position.z + event.deltaY * 0.002))
        return
      }
      event.preventDefault()
      const zoom = material.uniforms.zoom.value as number
      material.uniforms.zoom.value = Math.min(8, Math.max(0.4, zoom * (event.deltaY > 0 ? 0.9 : 1.1)))
    }
    let drag: { x: number, y: number } | null = null
    const onDown = (event: PointerEvent) => { drag = { x: event.clientX, y: event.clientY } }
    const onMove = (event: PointerEvent) => {
      if (!drag) return
      if (material instanceof ShaderMaterial) {
        const pan = material.uniforms.pan.value as Vector2
        pan.x -= (event.clientX - drag.x) / 420
        pan.y += (event.clientY - drag.y) / 420
      } else {
        mesh.rotation.y += (event.clientX - drag.x) * 0.005
        mesh.rotation.x += (event.clientY - drag.y) * 0.005
      }
      drag = { x: event.clientX, y: event.clientY }
    }
    const onUp = () => { drag = null }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    const tick = () => {
      if (material instanceof ShaderMaterial) material.uniforms.channel.value = CHANNEL[channelRef.current]
      const image = map?.image as { width?: number, height?: number } | undefined
      if (image?.width && image.height) setSize(`${image.width} × ${image.height}`)
      renderer.render(scene, camera)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      mesh.geometry.dispose()
      material.dispose()
      if (owned) map?.dispose()
      renderer.dispose()
    }
  }, [asset, assetId, environment, revision])

  return (
    <div className="preview-view">
      <div className={`preview-view__stage ${environment ? '' : 'preview-view__stage--checker'}`}>
        <canvas ref={canvasRef} />
        {size && <div className="preview-view__chip">{size}</div>}
      </div>
      <div className="preview-view__bar">
        {!environment && (['rgb', 'r', 'g', 'b', 'a'] as Channel[]).map(item => (
          <button key={item} type="button" className={channel === item ? 'is-on' : ''} onClick={() => setChannel(item)}>{item.toUpperCase()}</button>
        ))}
        <span>{environment ? t('preview.envHint') : t('preview.textureHint')}</span>
        {!standalone && <button type="button" onClick={() => popPreviewWindow(environment ? 'environment' : 'texture', assetId)}>{t('preview.popout')}</button>}
      </div>
    </div>
  )
}
