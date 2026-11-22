import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react'
import { SchemaForm } from '../../core/schema/SchemaForm'
import { CardReset } from '../../editor/panels/CardReset'
import { useInspectorCardOpen } from '../../editor/panels/inspectorMemory'
import { useEditorStore } from '../../editor/scene/store'
import type { SceneNode } from '../../editor/scene/types'
import { capabilityEnabled } from '../registry'
import {
  defaultTween,
  normalizeTween,
  TWEEN_CAPABILITY_ID,
  TWEEN_SCHEMA,
  type TweenSpec,
} from './schema'

export function TweenCard({ node, disabled }: { node: SceneNode; disabled: boolean }) {
  const capEnabled = useEditorStore((state) => capabilityEnabled(state.capabilities, TWEEN_CAPABILITY_ID))
  const [open, setOpen] = useInspectorCardOpen(TWEEN_CAPABILITY_ID)
  const raw = node.capabilities?.[TWEEN_CAPABILITY_ID]
  if (!capEnabled || !raw) return null
  const spec = normalizeTween(raw)

  const commit = (next: TweenSpec | null) => {
    const store = useEditorStore.getState()
    store.beginGesture('Tween 补间动效')
    const capabilities = { ...(node.capabilities ?? {}) }
    if (next) capabilities[TWEEN_CAPABILITY_ID] = next
    else delete capabilities[TWEEN_CAPABILITY_ID]
    store.updateNode(node.id, {
      capabilities: Object.keys(capabilities).length > 0 ? capabilities : null,
    })
    store.endGesture()
  }

  return (
    <section className="iv2-card iv2-card--wide">
      <header className="iv2-card__header" onClick={() => setOpen(!open)}>
        <span className="iv2-card__dot" style={{ background: '#c084fc' }} />
        <span>Tween 补间动效</span>
        <span className="iv2-card__actions" onClick={(event) => event.stopPropagation()}>
          <CardReset disabled={disabled} onReset={() => commit(defaultTween())} />
          <button
            type="button"
            className="iv2-icon-btn"
            title="移除组件"
            disabled={disabled}
            onClick={() => commit(null)}
          >
            <Trash2 size={12} />
          </button>
        </span>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </header>

      {open && (
        <div className="iv2-card__body">
          <SchemaForm
            schema={TWEEN_SCHEMA}
            value={spec as unknown as Record<string, unknown>}
            disabled={disabled}
            compact
            onChange={(next) => commit(normalizeTween(next))}
          />
        </div>
      )}
    </section>
  )
}
