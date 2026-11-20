import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react'
import { useI18n } from '../../editor/i18n'
import { CardReset } from '../../editor/panels/CardReset'
import { useInspectorCardOpen } from '../../editor/panels/inspectorMemory'
import { defaultNodePhysics } from '../physics/defaults'
import { useEditorStore } from '../../editor/scene/store'
import type { SceneNode } from '../../editor/scene/types'
import { capabilityEnabled } from '../registry'
import {
  BUOYANCY_CAPABILITY_ID,
  defaultBuoyancy,
  normalizeBuoyancy,
  type BuoyancySampleMode,
  type BuoyancySpec,
} from './defaults'

const SAMPLE_MODES: BuoyancySampleMode[] = ['box4', 'box8', 'center']

export function BuoyancyCard({ node, disabled }: { node: SceneNode, disabled: boolean }) {
  const { t } = useI18n()
  const capEnabled = useEditorStore(state => capabilityEnabled(state.capabilities, BUOYANCY_CAPABILITY_ID))
  const [open, setOpen] = useInspectorCardOpen('buoyancy')
  const raw = node.capabilities?.[BUOYANCY_CAPABILITY_ID]
  if (!capEnabled || !raw) return null
  const spec = normalizeBuoyancy(raw)
  const needsDynamic = !node.physics || node.physics.body !== 'dynamic'

  const commit = (next: BuoyancySpec | null) => {
    const store = useEditorStore.getState()
    store.beginGesture(t('buoyancy.title'))
    const capabilities = { ...(node.capabilities ?? {}) }
    if (next) capabilities[BUOYANCY_CAPABILITY_ID] = next
    else delete capabilities[BUOYANCY_CAPABILITY_ID]
    store.updateNode(node.id, {
      capabilities: Object.keys(capabilities).length > 0 ? capabilities : null,
    })
    store.endGesture()
  }

  const write = (patch: Partial<BuoyancySpec>) => {
    commit({ ...spec, ...patch })
  }

  const makeDynamic = () => {
    const store = useEditorStore.getState()
    store.beginGesture(t('buoyancy.title'))
    const base = node.physics ?? defaultNodePhysics(node.kind)
    store.updateNode(node.id, {
      physics: { ...base, body: 'dynamic' },
    })
    store.endGesture()
  }

  return (
    <section className="iv2-card iv2-card--wide">
      <header className="iv2-card__header" onClick={() => setOpen(!open)}>
        <span className="iv2-card__dot" style={{ background: '#29b6f6' }} />
        <span>{t('buoyancy.title')}</span>
        <span className="iv2-card__actions" onClick={event => event.stopPropagation()}>
          <CardReset disabled={disabled} onReset={() => commit(defaultBuoyancy())} />
          <button
            type="button"
            className="iv2-card__remove"
            title={t('component.remove')}
            disabled={disabled}
            onClick={() => commit(null)}
          >
            <Trash2 size={12} />
          </button>
        </span>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </header>
      {open && (
        <div className="iv2-card__body">
          {needsDynamic && (
            <div className="iv2-note" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span>{t('buoyancy.needsDynamic')}</span>
              <button type="button" className="btn-inline" disabled={disabled} onClick={makeDynamic}>
                {t('buoyancy.makeDynamic')}
              </button>
            </div>
          )}
          <section className="iv2-section">
            <label className="field field--check">
              <span>{t('buoyancy.enable')}</span>
              <input type="checkbox" checked={spec.enabled} disabled={disabled} onChange={event => write({ enabled: event.target.checked })} />
            </label>
            <label className="field">
              <span>{t('buoyancy.sampleMode')}</span>
              <select value={spec.sampleMode} disabled={disabled} onChange={event => write({ sampleMode: event.target.value as BuoyancySampleMode })}>
                {SAMPLE_MODES.map(mode => (
                  <option key={mode} value={mode}>{t(`buoyancy.sample.${mode}` as 'buoyancy.title')}</option>
                ))}
              </select>
            </label>
            <RangeField
              label={t('buoyancy.force')}
              value={spec.buoyancyForce}
              min={0}
              max={5}
              step={0.05}
              disabled={disabled}
              onChange={buoyancyForce => write({ buoyancyForce })}
            />
            <RangeField
              label={t('buoyancy.waterDrag')}
              value={spec.waterDrag}
              min={0}
              max={10}
              step={0.1}
              disabled={disabled}
              onChange={waterDrag => write({ waterDrag })}
            />
            <RangeField
              label={t('buoyancy.angularDrag')}
              value={spec.angularDrag}
              min={0}
              max={10}
              step={0.1}
              disabled={disabled}
              onChange={angularDrag => write({ angularDrag })}
            />
            <RangeField
              label={t('buoyancy.draftDepth')}
              value={spec.draftDepth}
              min={0}
              max={5}
              step={0.05}
              disabled={disabled}
              onChange={draftDepth => write({ draftDepth })}
            />
          </section>
        </div>
      )}
    </section>
  )
}

function RangeField({
  label,
  value,
  min,
  max,
  step,
  disabled,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  disabled: boolean
  onChange: (value: number) => void
}) {
  return (
    <label className="field field--range">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={event => onChange(Number(event.target.value))}
      />
      <b>{Number(value.toFixed(2))}</b>
    </label>
  )
}
