import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react'
import { CardReset } from '../../editor/panels/CardReset'
import { defaultNodePhysics } from './defaults'
import { useInspectorCardOpen } from '../../editor/panels/inspectorMemory'
import { capabilityEnabled } from '../registry'
import { useEditorStore } from '../../editor/scene/store'
import { useI18n } from '../../editor/i18n'
import type { ColliderShape, NodePhysics, PhysicsBodyKind, SceneNode, Vec3 } from '../../editor/scene/types'

export function PhysicsCard({ node, disabled }: { node: SceneNode, disabled: boolean }) {
  const { t } = useI18n()
  const enabled = useEditorStore(state => capabilityEnabled(state.capabilities, 'physics'))
  const [open, setOpen] = useInspectorCardOpen('physics')
  const physics = node.physics
  if (!enabled || !physics) return null
  const patch = (next: NodePhysics | null) => {
    const store = useEditorStore.getState()
    store.beginGesture(t('physics.title'))
    store.updateNode(node.id, { physics: next })
    store.endGesture()
  }
  const edit = (partial: Partial<NodePhysics>) => {
    patch({ ...physics, ...partial })
  }
  return (
    <section className="iv2-card iv2-card--wide">
      <header className="iv2-card__header" onClick={() => setOpen(!open)}>
        <span className="iv2-card__dot" style={{ background: '#8bc34a' }} />
        <span>{t('physics.title')}</span>
        <span className="iv2-card__actions" onClick={event => event.stopPropagation()}>
          <CardReset disabled={disabled} onReset={() => patch(defaultNodePhysics(node.kind))} />
          <button
            type="button"
            className="iv2-card__remove"
            title={t('component.remove')}
            disabled={disabled}
            onClick={() => patch(null)}
          >
            <Trash2 size={12} />
          </button>
        </span>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </header>
      {open && <div className="iv2-card__body">
          <section className="iv2-section">
            <div className="iv2-section__title" style={{ color: '#8bc34a' }}><i /><span>{t('physics.shape')}</span></div>
          <label className="field">
            <span>{t('physics.body')}</span>
            <select disabled={disabled} value={physics.body} onChange={event => edit({ body: event.target.value as PhysicsBodyKind })}>
              <option value="static">{t('physics.static')}</option>
              <option value="dynamic">{t('physics.dynamic')}</option>
              <option value="kinematic">{t('physics.kinematic')}</option>
            </select>
          </label>
          <label className="field">
            <span>{t('physics.shape')}</span>
            <select disabled={disabled} value={physics.shape} onChange={event => edit({ shape: event.target.value as ColliderShape })}>
              <option value="box">{t('physics.box')}</option>
              <option value="sphere">{t('physics.sphere')}</option>
              <option value="capsule">{t('physics.capsule')}</option>
              <option value="cylinder">{t('physics.cylinder')}</option>
              <option value="cone">{t('physics.cone')}</option>
              <option value="convex">{t('physics.convex')}</option>
              <option value="trimesh">{t('physics.trimesh')}</option>
            </select>
          </label>
          {physics.shape === 'sphere' ? (
            <NumberInput label={t('physics.radius')} disabled={disabled} value={physics.size[0]} step={0.01} min={0.01} onChange={radius => edit({ size: [radius, radius, radius] })} />
          ) : physics.shape === 'capsule' || physics.shape === 'cylinder' || physics.shape === 'cone' ? (
            <div className="iv2-pair">
              <NumberInput label={t('physics.radius')} disabled={disabled} value={physics.size[0]} step={0.01} min={0.01} onChange={radius => edit({ size: [radius, physics.size[1], radius] })} />
              <NumberInput label={t('physics.height')} disabled={disabled} value={physics.size[1]} step={0.01} min={0.02} onChange={height => edit({ size: [physics.size[0], height, physics.size[0]] })} />
            </div>
          ) : physics.shape === 'convex' || physics.shape === 'trimesh' ? (
            <p className="settings-note">{physics.shape === 'convex' ? t('physics.convexHint') : t('physics.trimeshHint')}</p>
          ) : (
            <SizeInput label={t('physics.size')} disabled={disabled} value={physics.size} onChange={size => edit({ size })} />
          )}
          <label className="field">
            <span>{t('physics.trigger')}</span>
            <input type="checkbox" disabled={disabled} checked={physics.trigger} onChange={event => edit({ trigger: event.target.checked })} />
          </label>
          </section>
          {physics.body === 'dynamic' && (
            <section className="iv2-section">
              <div className="iv2-section__title" style={{ color: '#aed581' }}><i /><span>{t('physics.mass')}</span></div>
              <div className="iv2-pair">
              <NumberInput label={t('physics.mass')} disabled={disabled} value={physics.mass} step={0.1} min={0.001} onChange={mass => edit({ mass })} />
              <NumberInput label={t('physics.gravityScale')} disabled={disabled} value={physics.gravityScale} step={0.05} onChange={gravityScale => edit({ gravityScale })} />
              <NumberInput label={t('physics.linearDamping')} disabled={disabled} value={physics.linearDamping} step={0.01} min={0} onChange={linearDamping => edit({ linearDamping })} />
              <NumberInput label={t('physics.angularDamping')} disabled={disabled} value={physics.angularDamping} step={0.01} min={0} onChange={angularDamping => edit({ angularDamping })} />
              </div>
            </section>
          )}
          <section className="iv2-section">
            <div className="iv2-section__title" style={{ color: '#c5e1a5' }}><i /><span>{t('physics.friction')}</span></div>
            <div className="iv2-pair">
          <NumberInput label={t('physics.friction')} disabled={disabled} value={physics.friction} step={0.01} min={0} onChange={friction => edit({ friction })} />
          <NumberInput label={t('physics.restitution')} disabled={disabled} value={physics.restitution} step={0.01} min={0} max={1} onChange={restitution => edit({ restitution })} />
            </div>
          </section>
      </div>}
    </section>
  )
}

function NumberInput({
  label,
  value,
  step,
  min,
  max,
  disabled,
  onChange,
}: {
  label: string
  value: number
  step: number
  min?: number
  max?: number
  disabled: boolean
  onChange: (value: number) => void
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        disabled={disabled}
        value={Number.isFinite(value) ? value : 0}
        step={step}
        min={min}
        max={max}
        onChange={event => {
          const next = Number(event.target.value)
          if (Number.isFinite(next)) onChange(next)
        }}
      />
    </label>
  )
}

function SizeInput({ label, value, disabled, onChange }: { label: string, value: Vec3, disabled: boolean, onChange: (size: Vec3) => void }) {
  const labels = ['X', 'Y', 'Z'] as const
  return (
    <div className="vec3">
      <span className="vec3__label">{label}</span>
      {labels.map((label, index) => (
        <label key={label} className="vec3__cell">
          <span className="vec3__axis">{label}</span>
          <input
            type="number"
            disabled={disabled}
            value={value[index]}
            step={0.01}
            onChange={event => {
              const next = Number(event.target.value)
              if (!Number.isFinite(next)) return
              const size: Vec3 = [...value]
              size[index] = next
              onChange(size)
            }}
          />
        </label>
      ))}
    </div>
  )
}
