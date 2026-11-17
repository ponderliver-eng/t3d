import { useEffect, useRef, useState } from 'react'
import { FlipVertical2, Link2, Unlink2 } from 'lucide-react'
import {
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Texture,
  TextureLoader,
  WebGLRenderer,
} from 'three'
import { useI18n } from '../i18n'
import { environmentFor, ensureAssetUrl, textureFor } from '../assets/textures'
import { assetDirectory, useAssetStore } from '../assets/library'
import { importExtractedBytes } from '../assets/import'
import { useEditorStore } from '../scene/store'
import { popPreviewWindow } from './previewStore'

function clampSize(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.max(1, Math.min(8192, Math.round(value)))
}

function scaledSize(next: number, other: number, base: number): number {
  if (base < 1 || other < 1) return next
  return clampSize(next * other / base)
}

function uniqueCopyName(base: string): string {
  const names = new Set(Object.values(useAssetStore.getState().assets).map(item => item.name))
  const stem = `${base} edit`
  if (!names.has(stem)) return stem
  let index = 2
  while (names.has(`${stem} ${index}`)) index += 1
  return `${stem} ${index}`
}

function renderEditedPng(url: string, width: number, height: number, flipY: boolean): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context) {
        reject(new Error('无法绘制贴图'))
        return
      }
      if (flipY) {
        context.translate(0, height)
        context.scale(1, -1)
      }
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'
      context.drawImage(image, 0, 0, width, height)
      canvas.toBlob(blob => {
        if (!blob) {
          reject(new Error('无法导出 PNG'))
          return
        }
        void blob.arrayBuffer().then(resolve, reject)
      }, 'image/png')
    }
    image.onerror = () => reject(new Error('无法读取贴图'))
    image.src = url
  })
}

type Channel = 'rgb' | 'r' | 'g' | 'b' | 'a'

const CHANNEL: Record<Channel, number> = { rgb: 0, r: 1, g: 2, b: 3, a: 4 }

export function TexturePreview({ assetId, environment = false, standalone = false }: { assetId: string, environment?: boolean, standalone?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const channelRef = useRef<Channel>('rgb')
  const flipRef = useRef(false)
  const outSizeRef = useRef({ width: 0, height: 0 })
  const sourceSizeRef = useRef({ width: 0, height: 0 })
  const [channel, setChannel] = useState<Channel>('rgb')
  const [size, setSize] = useState('')
  const [flipY, setFlipY] = useState(false)
  const [outWidth, setOutWidth] = useState(0)
  const [outHeight, setOutHeight] = useState(0)
  const [lockAspect, setLockAspect] = useState(true)
  const [saving, setSaving] = useState(false)
  channelRef.current = channel
  flipRef.current = flipY
  outSizeRef.current = { width: outWidth, height: outHeight }
  const { t } = useI18n()
  const asset = useAssetStore(state => state.assets[assetId])
  const revision = useAssetStore(state => state.revision)

  useEffect(() => {
    sourceSizeRef.current = { width: 0, height: 0 }
    setOutWidth(0)
    setOutHeight(0)
    setFlipY(false)
    setSize('')
  }, [assetId])

  const saveEditedTexture = async () => {
    if (!asset || !('fileName' in asset) || saving || outWidth < 1 || outHeight < 1) return
    setSaving(true)
    try {
      const url = asset.url || await ensureAssetUrl(assetId)
      const png = await renderEditedPng(url, outWidth, outHeight, flipY)
      const dir = assetDirectory(assetId, useAssetStore.getState().assetDirs)
      const fileName = `${uniqueCopyName(asset.name)}.png`
      const id = await importExtractedBytes(fileName, new Uint8Array(png), dir)
      if (!id) throw new Error('save failed')
      useEditorStore.getState().pingAsset(id)
      useEditorStore.getState().log('info', t('preview.savedTexture', { name: fileName.replace(/\.png$/i, '') }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      useEditorStore.getState().log('error', t('preview.saveTextureFail', { message }))
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !asset || !('url' in asset)) return
    const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    renderer.setClearColor(0x000000, 0)
    const scene = new Scene()
    const camera = environment
      ? new PerspectiveCamera(40, 1, 0.01, 20)
      : new OrthographicCamera(-1, 1, 1, -1, 0.1, 10)
    camera.position.z = environment ? 2.6 : 1
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
          varying vec2 vUv;
          void main() {
            vec4 color = texture2D(map, vUv);
            if (channel == 1) color = vec4(vec3(color.r), 1.0);
            else if (channel == 2) color = vec4(vec3(color.g), 1.0);
            else if (channel == 3) color = vec4(vec3(color.b), 1.0);
            else if (channel == 4) color = vec4(vec3(color.a), 1.0);
            gl_FragColor = color;
          }
        `,
      })
    const mesh = new Mesh(
      environment ? new SphereGeometry(1, 48, 32) : new PlaneGeometry(1, 1),
      material,
    )
    scene.add(mesh)
    let frame = 0
    let zoom = 1
    let panX = 0
    let panY = 0
    let spanX = 1
    let spanY = 1
    const frameTexture = () => {
      if (!(camera instanceof OrthographicCamera)) return
      const rect = canvas.getBoundingClientRect()
      if (rect.width < 2 || rect.height < 2) return
      const image = map?.image as { width?: number, height?: number } | undefined
      const iw = image?.width && image.height ? image.width : 1
      const ih = image?.width && image.height ? image.height : 1
      const edited = outSizeRef.current
      const imageAspect = edited.width > 0 && edited.height > 0 ? edited.width / edited.height : iw / ih
      mesh.scale.set(imageAspect, flipRef.current ? -1 : 1, 1)
      const viewAspect = rect.width / rect.height
      const worldW = viewAspect >= imageAspect ? viewAspect : imageAspect
      const worldH = viewAspect >= imageAspect ? 1 : imageAspect / viewAspect
      spanX = worldW / zoom
      spanY = worldH / zoom
      camera.left = panX - spanX / 2
      camera.right = panX + spanX / 2
      camera.top = panY + spanY / 2
      camera.bottom = panY - spanY / 2
      camera.updateProjectionMatrix()
    }
    const resize = () => {
      const rect = canvas.parentElement?.getBoundingClientRect()
      if (!rect || rect.width < 2 || rect.height < 2) return
      renderer.setSize(rect.width, rect.height, false)
      if (camera instanceof PerspectiveCamera) {
        camera.aspect = rect.width / rect.height
        camera.updateProjectionMatrix()
        return
      }
      frameTexture()
    }
    const observer = new ResizeObserver(resize)
    if (canvas.parentElement) observer.observe(canvas.parentElement)
    resize()
    const onWheel = (event: WheelEvent) => {
      if (!(camera instanceof OrthographicCamera)) {
        camera.position.z = Math.min(6, Math.max(1.2, camera.position.z + event.deltaY * 0.002))
        return
      }
      event.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const next = Math.min(16, Math.max(0.25, zoom * (event.deltaY > 0 ? 0.9 : 1.1)))
      if (rect.width > 2 && rect.height > 2) {
        const u = (event.clientX - rect.left) / rect.width
        const v = (event.clientY - rect.top) / rect.height
        const worldX = panX + (u - 0.5) * spanX
        const worldY = panY + (0.5 - v) * spanY
        zoom = next
        frameTexture()
        panX = worldX - (u - 0.5) * spanX
        panY = worldY - (0.5 - v) * spanY
      } else {
        zoom = next
      }
      frameTexture()
    }
    let drag: { x: number, y: number } | null = null
    const onDown = (event: PointerEvent) => { drag = { x: event.clientX, y: event.clientY } }
    const onMove = (event: PointerEvent) => {
      if (!drag) return
      if (camera instanceof OrthographicCamera) {
        const rect = canvas.getBoundingClientRect()
        if (rect.width > 2 && rect.height > 2) {
          panX -= (event.clientX - drag.x) / rect.width * spanX
          panY += (event.clientY - drag.y) / rect.height * spanY
          frameTexture()
        }
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
      if (image?.width && image.height) {
        if (sourceSizeRef.current.width !== image.width || sourceSizeRef.current.height !== image.height) {
          sourceSizeRef.current = { width: image.width, height: image.height }
          setSize(`${image.width} × ${image.height}`)
          setOutWidth(current => current > 0 ? current : image.width)
          setOutHeight(current => current > 0 ? current : image.height)
        }
        const edited = outSizeRef.current
        const aspect = edited.width > 0 && edited.height > 0 ? edited.width / edited.height : image.width / image.height
        const flip = flipRef.current ? -1 : 1
        if (camera instanceof OrthographicCamera && (Math.abs(mesh.scale.x - aspect) > 1e-4 || Math.abs(mesh.scale.y - flip) > 1e-4)) frameTexture()
      }
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
        {size && <div className="preview-view__chip">{t('preview.sourceSize', { size })}</div>}
        {!environment && (
          <div className="preview-view__float">
            {(['rgb', 'r', 'g', 'b', 'a'] as Channel[]).map(item => (
              <button key={item} type="button" className={channel === item ? 'is-on' : ''} onClick={() => setChannel(item)}>{item.toUpperCase()}</button>
            ))}
          </div>
        )}
      </div>
      {!environment ? (
        <div className="tex-edit">
          <div className="tex-edit__row">
            <button type="button" className={`tex-edit__icon${flipY ? ' is-on' : ''}`} title={t('preview.flipY')} aria-label={t('preview.flipY')} onClick={() => setFlipY(value => !value)}>
              <FlipVertical2 size={14} />
            </button>
            <label className="tex-edit__field">
              <span>{t('preview.width')}</span>
              <input
                type="number"
                min={1}
                max={8192}
                value={outWidth || ''}
                onChange={event => {
                  const next = clampSize(Number(event.target.value))
                  setOutWidth(next)
                  if (lockAspect) setOutHeight(scaledSize(next, sourceSizeRef.current.height, sourceSizeRef.current.width))
                }}
              />
            </label>
            <button type="button" className={`tex-edit__icon${lockAspect ? ' is-on' : ''}`} title={t('preview.lockAspect')} aria-label={t('preview.lockAspect')} onClick={() => setLockAspect(value => !value)}>
              {lockAspect ? <Link2 size={14} /> : <Unlink2 size={14} />}
            </button>
            <label className="tex-edit__field">
              <span>{t('preview.height')}</span>
              <input
                type="number"
                min={1}
                max={8192}
                value={outHeight || ''}
                onChange={event => {
                  const next = clampSize(Number(event.target.value))
                  setOutHeight(next)
                  if (lockAspect) setOutWidth(scaledSize(next, sourceSizeRef.current.width, sourceSizeRef.current.height))
                }}
              />
            </label>
            <span className="tex-edit__spacer" />
            {!standalone && <button type="button" className="tex-edit__ghost" onClick={() => popPreviewWindow('texture', assetId)}>{t('preview.popout')}</button>}
            <button type="button" className="tex-edit__save" disabled={saving || outWidth < 1 || outHeight < 1 || !asset || !('url' in asset)} onClick={() => { void saveEditedTexture() }}>{saving ? t('preview.saving') : t('preview.saveTexture')}</button>
          </div>
          <p className="tex-edit__note">{t('preview.textureHint')}</p>
        </div>
      ) : (
        <div className="preview-view__bar">
          <span>{t('preview.envHint')}</span>
          {!standalone && <button type="button" onClick={() => popPreviewWindow('environment', assetId)}>{t('preview.popout')}</button>}
        </div>
      )}
    </div>
  )
}
