import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { CardReset } from '../../editor/panels/CardReset'
import { useInspectorCardOpen } from '../../editor/panels/inspectorMemory'
import { useI18n } from '../../editor/i18n'
import { useEditorStore } from '../../editor/scene/store'
import type { SceneNode, Vec3 } from '../../editor/scene/types'
import {
  defaultSplinePath,
  normalizeSplinePath,
  SPLINE_PATH_CAPABILITY_ID,
  type SplinePathData,
} from './schema'
import { getActiveSplinePoints, setActiveSplinePoint, setActiveSplinePoints, subscribeActiveSplinePoint } from '../../editor/viewport/splineGizmo'

export function SplinePathCard({ node, disabled }: { node: SceneNode; disabled: boolean }) {
  const { t } = useI18n()
  const [open, setOpen] = useInspectorCardOpen(SPLINE_PATH_CAPABILITY_ID)
  const activePoints = useSyncExternalStore(subscribeActiveSplinePoint, getActiveSplinePoints)
  if (node.kind !== 'spline') return null
  const data = normalizeSplinePath(node.capabilities?.[SPLINE_PATH_CAPABILITY_ID])

  const commit = (next: SplinePathData) => {
    const store = useEditorStore.getState()
    store.beginGesture(t('spline.gesture'))
    store.updateNode(node.id, {
      capabilities: {
        ...(node.capabilities ?? {}),
        [SPLINE_PATH_CAPABILITY_ID]: next,
      },
    })
    store.endGesture()
  }

  const updatePoint = (idx: number, axis: 0 | 1 | 2, val: number) => {
    const safe = Number.isFinite(val) ? val : 0
    const nextPoints = data.points.map((p, i) => {
      if (i !== idx) return p
      const copy: Vec3 = [p[0], p[1], p[2]]
      copy[axis] = safe
      return copy
    })
    commit({ ...data, points: nextPoints })
  }

  const appendPoint = () => {
    const last = data.points[data.points.length - 1] ?? [0, 0, 0]
    const prev = data.points[data.points.length - 2] ?? [last[0] - 2, last[1], last[2]]
    const dx = last[0] - prev[0]
    const dy = last[1] - prev[1]
    const dz = last[2] - prev[2]
    const len = Math.hypot(dx, dy, dz) || 1
    const step = 3 / len
    const nextPt: Vec3 = [
      Math.round((last[0] + dx * step) * 100) / 100,
      Math.round((last[1] + dy * step) * 100) / 100,
      Math.round((last[2] + dz * step) * 100) / 100,
    ]
    commit({ ...data, points: [...data.points, nextPt] })
  }

  const removePoint = (idx: number) => {
    if (data.points.length <= 2) return
    const next = getActiveSplinePoints().flatMap(point => {
      if (point.id !== node.id) return [point]
      if (point.index === idx) return []
      if (point.index > idx) return [{ id: node.id, index: point.index - 1 }]
      return [point]
    })
    setActiveSplinePoints(next)
    commit({ ...data, points: data.points.filter((_, i) => i !== idx) })
  }

  return (
    <section className="iv2-card iv2-card--wide">
      <header className="iv2-card__header" onClick={() => setOpen(!open)}>
        <span className="iv2-card__dot" style={{ background: data.color || '#34d399' }} />
        <span>{t('spline.edit')}</span>
        <span className="iv2-card__actions" onClick={(event) => event.stopPropagation()}>
          <CardReset disabled={disabled} onReset={() => commit(defaultSplinePath())} />
        </span>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </header>

      {open && (
        <div className="iv2-card__body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.4 }}>
            {t('spline.hint')}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5 }}>
              <input
                type="checkbox"
                checked={data.closed}
                disabled={disabled}
                onChange={(e) => commit({ ...data, closed: e.target.checked })}
              />
              <span>{t('field.closed')}</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5 }}>
              <span>{t('field.color')}</span>
              <input
                type="color"
                value={data.color}
                disabled={disabled}
                onChange={(e) => commit({ ...data, color: e.target.value })}
                style={{ width: 28, height: 20, padding: 0, border: 'none', background: 'transparent' }}
              />
            </label>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5 }}>
            <span style={{ minWidth: 56 }}>{t('field.tension')}</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={data.tension}
              disabled={disabled}
              onChange={(e) => commit({ ...data, tension: Number(e.target.value) })}
              style={{ flex: 1 }}
            />
            <span style={{ width: 32, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              {data.tension.toFixed(2)}
            </span>
          </label>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
            <span style={{ fontSize: 11.5, color: '#cbd5e1' }}>{t('spline.points', { count: data.points.length })}</span>
            <button
              type="button"
              className="iv2-btn"
              disabled={disabled}
              onClick={appendPoint}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', fontSize: 11 }}
            >
              <Plus size={12} /> {t('spline.addPoint')}
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflowY: 'auto' }}>
            {data.points.map((pt, idx) => (
              <div
                key={idx}
                onClick={() => {
                  if (!disabled) setActiveSplinePoint({ id: node.id, index: idx })
                }}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '24px 1fr 1fr 1fr 22px',
                  gap: 4,
                  alignItems: 'center',
                  borderRadius: 4,
                  outline: activePoints.some(point => point.id === node.id && point.index === idx) ? '1px solid rgba(248, 250, 252, 0.7)' : 'none',
                  cursor: disabled ? 'default' : 'pointer',
                }}
              >
                <span style={{ fontSize: 11, color: idx === 0 ? '#fbbf24' : '#94a3b8' }}>#{idx}</span>
                {([0, 1, 2] as const).map((axis) => (
                  <input
                    key={axis}
                    type="number"
                    step={0.25}
                    value={pt[axis]}
                    disabled={disabled}
                    onChange={(e) => updatePoint(idx, axis, Number(e.target.value))}
                    style={{
                      width: '100%',
                      fontSize: 11,
                      padding: '2px 4px',
                      background: 'rgba(15, 23, 42, 0.5)',
                      border: '1px solid rgba(148, 163, 184, 0.2)',
                      borderRadius: 4,
                      color: '#e2e8f0',
                    }}
                  />
                ))}
                <button
                  type="button"
                  className="iv2-icon-btn"
                  title={t('spline.removePoint')}
                  disabled={disabled || data.points.length <= 2}
                  onClick={() => removePoint(idx)}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
