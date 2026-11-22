import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react'
import { SchemaForm } from '../../core/schema/SchemaForm'
import { CardReset } from '../../editor/panels/CardReset'
import { useInspectorCardOpen } from '../../editor/panels/inspectorMemory'
import { useEditorStore } from '../../editor/scene/store'
import type { SceneNode } from '../../editor/scene/types'
import { capabilityEnabled } from '../registry'
import {
  CROWD_CAPABILITY_ID,
  CROWD_SCHEMA,
  defaultCrowd,
  normalizeCrowd,
  type CrowdSpec,
} from './schema'

export function CrowdCard({ node, disabled }: { node: SceneNode; disabled: boolean }) {
  const capEnabled = useEditorStore((state) => capabilityEnabled(state.capabilities, CROWD_CAPABILITY_ID))
  const [open, setOpen] = useInspectorCardOpen(CROWD_CAPABILITY_ID)
  const raw = node.capabilities?.[CROWD_CAPABILITY_ID]
  if (!capEnabled || !raw) return null
  const spec = normalizeCrowd(raw)

  const commit = (next: CrowdSpec | null) => {
    const store = useEditorStore.getState()
    store.beginGesture('群体避让设置')
    const capabilities = { ...(node.capabilities ?? {}) }
    if (next) capabilities[CROWD_CAPABILITY_ID] = next
    else delete capabilities[CROWD_CAPABILITY_ID]
    store.updateNode(node.id, {
      capabilities: Object.keys(capabilities).length > 0 ? capabilities : null,
    })
    store.endGesture()
  }

  return (
    <section className="iv2-card iv2-card--wide">
      <header className="iv2-card__header" onClick={() => setOpen(!open)}>
        <span className="iv2-card__dot" style={{ background: '#38bdf8' }} />
        <span>群体避让 (Crowd)</span>
        <span className="iv2-card__actions" onClick={(event) => event.stopPropagation()}>
          <CardReset disabled={disabled} onReset={() => commit(defaultCrowd())} />
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
        <div className="iv2-card__body" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <SchemaForm
            schema={CROWD_SCHEMA}
            value={spec as unknown as Record<string, unknown>}
            disabled={disabled}
            onChange={(next) => commit(normalizeCrowd(next))}
          />
        </div>
      )}
    </section>
  )
}
