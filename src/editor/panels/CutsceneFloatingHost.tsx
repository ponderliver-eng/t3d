import { Film, Minimize2, X } from 'lucide-react'
import { useState, type PointerEvent } from 'react'
import CutscenePanel from './CutscenePanel'
import { useCutsceneWindowStore } from './cutsceneWindowStore'

type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
const DIRS: ResizeDir[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

export function CutsceneFloatingHost() {
  const { floating, x, y, width, height, setFloating, setBounds } = useCutsceneWindowStore()
  const [drag, setDrag] = useState<{ sx: number; sy: number; ox: number; oy: number } | null>(null)
  const [resize, setResize] = useState<{
    dir: ResizeDir
    sx: number
    sy: number
    ox: number
    oy: number
    ow: number
    oh: number
  } | null>(null)

  if (!floating) return null

  const onHeaderMove = (e: PointerEvent) => {
    if (!drag) return
    setBounds({
      x: Math.max(0, Math.min(window.innerWidth - 200, drag.ox + e.clientX - drag.sx)),
      y: Math.max(0, Math.min(window.innerHeight - 100, drag.oy + e.clientY - drag.sy)),
    })
  }

  const onResizeMove = (e: PointerEvent) => {
    if (!resize) return
    const dx = e.clientX - resize.sx
    const dy = e.clientY - resize.sy
    const minW = 560
    const minH = 240
    let nw = resize.ow
    let nh = resize.oh
    let nx = resize.ox
    let ny = resize.oy
    if (resize.dir.includes('e')) nw = Math.max(minW, resize.ow + dx)
    if (resize.dir.includes('s')) nh = Math.max(minH, resize.oh + dy)
    if (resize.dir.includes('w')) {
      nw = Math.max(minW, resize.ow - dx)
      nx = resize.ox + (resize.ow - nw)
    }
    if (resize.dir.includes('n')) {
      nh = Math.max(minH, resize.oh - dy)
      ny = resize.oy + (resize.oh - nh)
    }
    setBounds({ x: nx, y: ny, width: nw, height: nh })
  }

  return (
    <div
      className="cutscene-floating-win"
      style={{ left: x, top: y, width, height }}
    >
      <div
        className="cutscene-floating-win__header"
        onPointerDown={e => {
          if ((e.target as HTMLElement).closest('button')) return
          e.currentTarget.setPointerCapture(e.pointerId)
          setDrag({ sx: e.clientX, sy: e.clientY, ox: x, oy: y })
        }}
        onPointerMove={onHeaderMove}
        onPointerUp={() => setDrag(null)}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Film size={13} color="var(--accent)" />
          过场时间轴 (Cutscene)
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button type="button" className="cutscene-btn" onClick={() => setFloating(false)} title="停靠回底部面板">
            <Minimize2 size={12} /> 停靠
          </button>
          <button type="button" className="cutscene-btn" onClick={() => setFloating(false)} title="关闭独立窗口">
            <X size={12} />
          </button>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <CutscenePanel isFloating />
      </div>
      {DIRS.map(dir => (
        <div
          key={dir}
          className={`cutscene-floating-win__resize is-${dir}`}
          onPointerDown={e => {
            e.stopPropagation()
            e.currentTarget.setPointerCapture(e.pointerId)
            setResize({ dir, sx: e.clientX, sy: e.clientY, ox: x, oy: y, ow: width, oh: height })
          }}
          onPointerMove={onResizeMove}
          onPointerUp={() => setResize(null)}
        />
      ))}
    </div>
  )
}
