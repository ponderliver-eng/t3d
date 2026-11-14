import { useEffect, useRef, useState } from 'react'
import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  TorusGeometry,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { applySlot } from '../assets/materials'
import { useAssetStore } from '../assets/library'
import { useEditorStore } from '../scene/store'
import { slotFromNode } from '../assets/materials'
import type { PbrSlot } from '../scene/types'
import { useI18n } from '../i18n'
import { popPreviewWindow, type PreviewKind } from './previewStore'

type Shape = 'sphere' | 'box' | 'torus' | 'plane'
type LightPreset = 'studio' | 'bright' | 'dark'

const LIGHTS: Record<LightPreset, { hemi: number, key: number, fill: number, clear: string }> = {
  studio: { hemi: 0.55, key: 1.35, fill: 0.35, clear: '#1a1d22' },
  bright: { hemi: 0.9, key: 1.7, fill: 0.55, clear: '#2a3038' },
  dark: { hemi: 0.2, key: 1.15, fill: 0.18, clear: '#0c0e12' },
}

export function MaterialPreview({ assetId, kind, standalone = false }: { assetId: string, kind: PreviewKind, standalone?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const slotRef = useRef<PbrSlot | null>(null)
  const [shape, setShape] = useState<Shape>('sphere')
  const [preset, setPreset] = useState<LightPreset>('studio')
  const [turntable, setTurntable] = useState(false)
  const { t } = useI18n()
  const shapeRef = useRef(shape)
  const presetRef = useRef(preset)
  const turnRef = useRef(turntable)
  shapeRef.current = shape
  presetRef.current = preset
  turnRef.current = turntable
  const assets = useAssetStore(state => state.assets)
  const nodes = useEditorStore(state => state.nodes)
  const asset = assets[assetId]
  const node = nodes[assetId]
  const slot = kind === 'node-material'
    ? (node ? slotFromNode(node) : null)
    : (asset?.kind === 'material' ? asset.slot : null)
  slotRef.current = slot

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    const scene = new Scene()
    scene.background = new Color(LIGHTS.studio.clear)
    const camera = new PerspectiveCamera(40, 1, 0.05, 50)
    camera.position.set(1.6, 1.05, 1.8)
    const controls = new OrbitControls(camera, canvas)
    controls.enableDamping = true
    controls.target.set(0, 0, 0)
    const hemi = new AmbientLight(0xffffff, LIGHTS.studio.hemi)
    const key = new DirectionalLight(0xffffff, LIGHTS.studio.key)
    key.position.set(2.5, 4, 2)
    const fill = new DirectionalLight(0x9eb4d0, LIGHTS.studio.fill)
    fill.position.set(-3, 1.5, -2)
    scene.add(hemi, key, fill)
    const material = new MeshStandardMaterial({ color: '#d5dde6', roughness: 0.55, metalness: 0.04 })
    const mesh: Mesh = new Mesh(new SphereGeometry(0.72, 64, 48), material)
    shareOcclusionUv(mesh)
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
    const tick = () => {
      const slot = slotRef.current
      if (slot) {
        const next = applySlot(mesh.material as MeshStandardMaterial, slot)
        if (mesh.material !== next) mesh.material = next
      }
      const nextShape = shapeRef.current
      if (mesh.userData.shape !== nextShape) {
        mesh.geometry.dispose()
        mesh.geometry = geometryFor(nextShape)
        shareOcclusionUv(mesh)
        mesh.userData.shape = nextShape
      }
      const lights = LIGHTS[presetRef.current]
      scene.background = new Color(lights.clear)
      hemi.intensity = lights.hemi
      key.intensity = lights.key
      fill.intensity = lights.fill
      if (turnRef.current) mesh.rotation.y += 0.008
      controls.update()
      renderer.render(scene, camera)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      controls.dispose()
      mesh.geometry.dispose()
      const current = mesh.material
      if (Array.isArray(current)) current.forEach(item => item.dispose())
      else current.dispose()
      if (current !== material) material.dispose()
      renderer.dispose()
    }
  }, [])

  return (
    <div className="preview-view">
      <div className="preview-view__stage">
        <canvas ref={canvasRef} />
        {!slot && <div className="preview-view__empty">{t('preview.pendingMaterial')}</div>}
      </div>
      <div className="preview-view__bar">
        <select value={shape} onChange={event => setShape(event.target.value as Shape)}>
          <option value="sphere">{t('preview.sphere')}</option>
          <option value="box">{t('preview.box')}</option>
          <option value="torus">{t('preview.torus')}</option>
          <option value="plane">{t('preview.plane')}</option>
        </select>
        <select value={preset} onChange={event => setPreset(event.target.value as LightPreset)}>
          <option value="studio">{t('preview.studio')}</option>
          <option value="bright">{t('preview.bright')}</option>
          <option value="dark">{t('preview.dark')}</option>
        </select>
        <button type="button" className={turntable ? 'is-on' : ''} onClick={() => setTurntable(value => !value)}>{t('preview.turn')}</button>
        {!standalone && <button type="button" onClick={() => popPreviewWindow(kind, assetId)}>{t('preview.popout')}</button>}
      </div>
    </div>
  )
}

function shareOcclusionUv(mesh: Mesh) {
  const geometry = mesh.geometry
  if (geometry.attributes.uv && !geometry.attributes.uv2) geometry.setAttribute('uv2', geometry.attributes.uv)
}

function geometryFor(shape: Shape) {
  if (shape === 'box') return new BoxGeometry(1.15, 1.15, 1.15)
  if (shape === 'torus') return new TorusGeometry(0.62, 0.24, 24, 64)
  if (shape === 'plane') return new PlaneGeometry(1.4, 1.4)
  return new SphereGeometry(0.72, 64, 48)
}
