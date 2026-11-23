import { useEffect, useRef } from 'react'
import { Quaternion, Vector3 } from 'three'
import { useI18n, type MessageKey } from '../i18n'
import { useEditorStore } from '../scene/store'
import type { CameraView } from '../scene/types'
import { viewCubePose } from './viewCubeBridge'
import { resolvePlayCamera } from './playCamera'

interface AxisDef {
  id: string
  label: string
  view: CameraView
  titleKey: MessageKey
  dir: [number, number, number]
  color: string
  positive: boolean
}

const AXES: AxisDef[] = [
  { id: '+x', label: 'X', view: 'right', titleKey: 'view.right', dir: [1, 0, 0], color: '#ef4444', positive: true },
  { id: '-x', label: '-X', view: 'left', titleKey: 'view.left', dir: [-1, 0, 0], color: '#71717a', positive: false },
  { id: '+y', label: 'Y', view: 'top', titleKey: 'view.up', dir: [0, 1, 0], color: '#22c55e', positive: true },
  { id: '-y', label: '-Y', view: 'bottom', titleKey: 'view.down', dir: [0, -1, 0], color: '#71717a', positive: false },
  { id: '+z', label: 'Z', view: 'front', titleKey: 'view.front', dir: [0, 0, 1], color: '#3b82f6', positive: true },
  { id: '-z', label: '-Z', view: 'back', titleKey: 'view.back', dir: [0, 0, -1], color: '#71717a', positive: false },
]

const CUBE_VERTS: [number, number, number][] = [
  [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
]

const CUBE_FACES: { indices: [number, number, number, number]; normal: [number, number, number] }[] = [
  { indices: [4, 5, 6, 7], normal: [0, 0, 1] },
  { indices: [1, 0, 3, 2], normal: [0, 0, -1] },
  { indices: [5, 1, 2, 6], normal: [1, 0, 0] },
  { indices: [0, 4, 7, 3], normal: [-1, 0, 0] },
  { indices: [7, 6, 2, 3], normal: [0, 1, 0] },
  { indices: [0, 1, 5, 4], normal: [0, -1, 0] },
]

interface HitTarget {
  kind: 'axis' | 'center'
  view: CameraView
  x: number
  y: number
  r: number
  z: number
  title: string
}

export default function ViewCube() {
  const playState = useEditorStore((state) => state.playState)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hoverIdRef = useRef<string | null>(null)
  const targetsRef = useRef<HitTarget[]>([])
  const { t } = useI18n()

  useEffect(() => {
    if (playState !== 'stopped') return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const size = 84
    const cx = size / 2
    const cy = size / 2
    const arm = 27
    const cubeHalf = 7.5
    const quat = new Quaternion()
    const v = new Vector3()

    let frame = 0
    const draw = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const targetW = Math.round(size * dpr)
      if (canvas.width !== targetW || canvas.height !== targetW) {
        canvas.width = targetW
        canvas.height = targetW
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, size, size)

      quat.set(viewCubePose.x, viewCubePose.y, viewCubePose.z, viewCubePose.w)

      const projectedAxes = AXES.map((axis) => {
        v.set(axis.dir[0], axis.dir[1], axis.dir[2]).applyQuaternion(quat)
        return {
          axis,
          vx: v.x,
          vy: v.y,
          vz: v.z,
          sx: cx + v.x * arm,
          sy: cy - v.y * arm,
          r: axis.positive ? 8.5 : 6.2,
        }
      })

      const centerTarget: HitTarget = {
        kind: 'center',
        view: 'persp',
        x: cx,
        y: cy,
        r: 9.5,
        z: 0,
        title: t('view.persp'),
      }

      type DrawItem =
        | { kind: 'cube'; z: number }
        | { kind: 'axis'; z: number; item: (typeof projectedAxes)[number] }

      const queue: DrawItem[] = [{ kind: 'cube', z: 0 }]
      for (const item of projectedAxes) {
        queue.push({ kind: 'axis', z: item.vz, item })
      }
      queue.sort((a, b) => a.z - b.z)

      const hitList: HitTarget[] = [centerTarget]

      for (const entry of queue) {
        if (entry.kind === 'cube') {
          const verts = CUBE_VERTS.map(([x, y, z]) => {
            v.set(x * cubeHalf, y * cubeHalf, z * cubeHalf).applyQuaternion(quat)
            return { x: cx + v.x, y: cy - v.y, z: v.z }
          })
          const visibleFaces = CUBE_FACES.map((face) => {
            v.set(face.normal[0], face.normal[1], face.normal[2]).applyQuaternion(quat)
            return { face, nz: v.z }
          })
            .filter((f) => f.nz > 0.02)
            .sort((a, b) => a.nz - b.nz)

          const hoveredCenter = hoverIdRef.current === 'center'
          for (const { face, nz } of visibleFaces) {
            const shade = Math.round(hoveredCenter ? 150 + nz * 65 : 108 + nz * 62)
            ctx.beginPath()
            face.indices.forEach((idx, i) => {
              const p = verts[idx]
              if (i === 0) ctx.moveTo(p.x, p.y)
              else ctx.lineTo(p.x, p.y)
            })
            ctx.closePath()
            ctx.fillStyle = `rgb(${shade}, ${shade}, ${shade + 4})`
            ctx.fill()
            ctx.strokeStyle = hoveredCenter ? 'rgba(255,255,255,0.75)' : 'rgba(24,24,27,0.7)'
            ctx.lineWidth = 1
            ctx.stroke()
          }
          continue
        }

        const { axis, sx, sy, vz, r } = entry.item
        const isHovered = hoverIdRef.current === axis.id
        const alpha = vz < -0.25 ? 0.55 : 0.96

        // 轴线
        const startRatio = 0.24
        ctx.beginPath()
        ctx.moveTo(cx + (sx - cx) * startRatio, cy + (sy - cy) * startRatio)
        ctx.lineTo(sx, sy)
        ctx.strokeStyle = axis.positive ? axis.color : 'rgba(161, 161, 170, 0.55)'
        ctx.lineWidth = axis.positive ? 2 : 1.4
        ctx.globalAlpha = alpha
        ctx.stroke()

        // 端点球体
        const drawR = isHovered ? r + 1.4 : r
        ctx.beginPath()
        ctx.arc(sx, sy, drawR, 0, Math.PI * 2)
        if (axis.positive) {
          ctx.fillStyle = axis.color
          ctx.fill()
          if (isHovered) {
            ctx.strokeStyle = '#ffffff'
            ctx.lineWidth = 1.5
            ctx.stroke()
          }
        } else {
          ctx.fillStyle = isHovered ? 'rgba(113, 113, 122, 0.92)' : 'rgba(63, 63, 70, 0.82)'
          ctx.fill()
          ctx.strokeStyle = isHovered ? '#ffffff' : 'rgba(212, 212, 216, 0.45)'
          ctx.lineWidth = 1
          ctx.stroke()
        }

        // 字母标签
        if (axis.positive || isHovered) {
          ctx.fillStyle = '#ffffff'
          ctx.font = axis.positive ? '700 9.5px "Segoe UI", sans-serif' : '600 7.5px "Segoe UI", sans-serif'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(axis.label, sx, sy + 0.5)
        }
        ctx.globalAlpha = 1

        hitList.push({
          kind: 'axis',
          view: axis.view,
          x: sx,
          y: sy,
          r: r + 2.5,
          z: vz,
          title: t(axis.titleKey),
        })
      }

      // 按前到后排序便于命中检测
      hitList.sort((a, b) => b.z - a.z)
      targetsRef.current = hitList

      frame = requestAnimationFrame(draw)
    }

    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [playState, t])

  if (playState !== 'stopped') return null

  const pickTarget = (clientX: number, clientY: number): { id: string; target: HitTarget } | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const x = clientX - rect.left
    const y = clientY - rect.top
    for (const target of targetsRef.current) {
      const dx = x - target.x
      const dy = y - target.y
      if (dx * dx + dy * dy <= target.r * target.r) {
        return { id: target.kind === 'center' ? 'center' : (AXES.find((a) => a.view === target.view)?.id ?? 'center'), target }
      }
    }
    return null
  }

  return (
    <div className="viewcube">
      <canvas
        ref={canvasRef}
        className="viewcube__canvas"
        width={84}
        height={84}
        onPointerMove={(event) => {
          const hit = pickTarget(event.clientX, event.clientY)
          hoverIdRef.current = hit ? hit.id : null
          event.currentTarget.title = hit ? hit.target.title : ''
          event.currentTarget.style.cursor = hit ? 'pointer' : 'default'
        }}
        onPointerLeave={() => {
          hoverIdRef.current = null
        }}
        onPointerDown={(event) => {
          const editor = useEditorStore.getState()
          if (editor.playState !== 'stopped' && resolvePlayCamera(editor.nodes, editor.tags).id) return
          const hit = pickTarget(event.clientX, event.clientY)
          if (hit) editor.requestView(hit.target.view)
        }}
      />
      <button
        type="button"
        className="viewcube__home"
        onClick={() => {
          const editor = useEditorStore.getState()
          if (editor.playState !== 'stopped' && resolvePlayCamera(editor.nodes, editor.tags).id) return
          editor.requestView('persp')
        }}
      >
        {t('view.persp')}
      </button>
    </div>
  )
}
