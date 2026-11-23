import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react'
import { SchemaForm } from '../../core/schema/SchemaForm'
import { CardReset } from '../../editor/panels/CardReset'
import { useInspectorCardOpen } from '../../editor/panels/inspectorMemory'
import { useI18n } from '../../editor/i18n'
import { useEditorStore } from '../../editor/scene/store'
import type { SceneNode } from '../../editor/scene/types'
import { capabilityEnabled } from '../registry'
import {
  defaultSpline,
  normalizeSpline,
  SPLINE_CAPABILITY_ID,
  SPLINE_SCHEMA,
  type SplineSpec,
} from './schema'

export function SplineCard({ node, disabled }: { node: SceneNode; disabled: boolean }) {
  const { t } = useI18n()
  const capEnabled = useEditorStore((state) => capabilityEnabled(state.capabilities, SPLINE_CAPABILITY_ID))
  const [open, setOpen] = useInspectorCardOpen(SPLINE_CAPABILITY_ID)
  const raw = node.capabilities?.[SPLINE_CAPABILITY_ID]
  if (!capEnabled || !raw) return null
  const spec = normalizeSpline(raw)

  const commit = (next: SplineSpec | null) => {
    const store = useEditorStore.getState()
    store.beginGesture(t('spline.title'))
    const capabilities = { ...(node.capabilities ?? {}) }
    if (next) capabilities[SPLINE_CAPABILITY_ID] = next
    else delete capabilities[SPLINE_CAPABILITY_ID]
    store.updateNode(node.id, {
      capabilities: Object.keys(capabilities).length > 0 ? capabilities : null,
    })
    store.endGesture()
  }

  return (
    <section className="iv2-card iv2-card--wide">
      <header className="iv2-card__header" onClick={() => setOpen(!open)}>
        <span className="iv2-card__dot" style={{ background: '#34d399' }} />
        <span>{t('spline.title')}</span>
        <span className="iv2-card__actions" onClick={(event) => event.stopPropagation()}>
          <CardReset disabled={disabled} onReset={() => commit(defaultSpline())} />
          <button
            type="button"
            className="iv2-icon-btn"
            title={t('component.remove')}
            disabled={disabled}
            onClick={() => commit(null)}
          >
            <Trash2 size={12} />
          </button>
        </span>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </header>

      {open && (
        <div className="iv2-card__body" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <SchemaForm
            schema={SPLINE_SCHEMA}
            value={spec as unknown as Record<string, unknown>}
            disabled={disabled}
            compact
            onChange={(next) => commit(normalizeSpline(next))}
          />
          {!spec.pathNodeId && (
            <div style={{ fontSize: 11, color: '#9ca3af', lineHeight: 1.4 }}>
              {t('spline.fallback')}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
