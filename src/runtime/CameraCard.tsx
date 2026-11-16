import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronRight, Search, Trash2, X } from 'lucide-react'
import { useInspectorCardOpen } from '../editor/panels/inspectorMemory'
import { useEditorStore } from '../editor/scene/store'
import { useI18n, type MessageKey } from '../editor/i18n'
import type { SceneNode, Vec3 } from '../editor/scene/types'
import { cameraPresetForMode, defaultCameraFollow, type CameraFollowSpec, type CameraOrbit, type CharacterMode } from './sceneRuntime'
import '../editor/panels/AssetPicker.css'

const ORBITS: CameraOrbit[] = ['rightDrag', 'mouse', 'none']
const PRESETS: CharacterMode[] = ['adventure', 'strafe', 'lockOn', 'pointAndClick', 'topDown', 'side25d', 'firstPerson']

export function CameraCard({ node, disabled }: { node: SceneNode, disabled: boolean }) {
  const { t } = useI18n()
  const [open, setOpen] = useInspectorCardOpen('follow-camera')
  const [picking, setPicking] = useState(false)
  const nodes = useEditorStore(state => state.nodes)
  const spec = node.gameplay?.cameraFollow
  if (!spec || node.gameplay?.character) return null
  const view = { ...defaultCameraFollow(), ...spec }
  const picked = view.targetId ? nodes[view.targetId] : !view.targetId && view.targetName
    ? Object.values(nodes).find(item => item.name === view.targetName)
    : undefined
  const targetLabel = picked?.name ?? t('camera.targetSelf')
  const write = (patch: Partial<CameraFollowSpec> | null) => {
    const store = useEditorStore.getState()
    store.beginGesture(t('camera.title'))
    if (!patch) {
      const gameplay = { ...node.gameplay }
      delete gameplay.cameraFollow
      store.updateNode(node.id, { gameplay: Object.keys(gameplay).length ? gameplay : null })
      store.endGesture()
      return
    }
    const manual = ['offset', 'pivot', 'orbit', 'fov', 'collision', 'localOffset', 'sensitivity', 'minPitch', 'maxPitch', 'damping', 'lookAtTarget', 'collisionRadius']
    const next = !('preset' in patch) && manual.some(key => key in patch) ? { ...patch, preset: '' as const } : patch
    store.updateNode(node.id, { gameplay: { ...node.gameplay, cameraFollow: { ...view, ...next } } })
    store.endGesture()
  }
  return (
    <section className="iv2-card iv2-card--wide">
      <header className="iv2-card__header" onClick={() => setOpen(!open)}>
        <span className="iv2-card__dot" style={{ background: '#7aa2ff' }} />
        <span>{t('camera.title')}</span>
        <span className="iv2-card__actions" onClick={event => event.stopPropagation()}>
          <input
            type="checkbox"
            title={t('camera.enable')}
            disabled={disabled}
            checked={spec.enabled !== false}
            onChange={event => write({ enabled: event.target.checked })}
          />
          <button
            type="button"
            className="iv2-card__remove"
            title={t('component.remove')}
            disabled={disabled}
            onClick={() => write(null)}
          >
            <Trash2 size={12} />
          </button>
        </span>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </header>
      {open && (
        <div className="iv2-card__body">
          <section className="iv2-section">
            <div className="iv2-section__title" style={{ color: '#7aa2ff' }}><i /><span>{t('camera.target')}</span></div>
          <label className="field">
            <span>{t('camera.preset')}</span>
            <select disabled={disabled} value={view.preset || ''} onChange={event => { if (event.target.value) write({ ...cameraPresetForMode(event.target.value as CharacterMode), preset: event.target.value as CharacterMode }) }}>
              <option value="">{t('camera.presetPick')}</option>
              {PRESETS.map(mode => <option key={mode} value={mode}>{t(`character.mode.${mode}`)}</option>)}
            </select>
          </label>
          <label className="field">
            <span>{t('camera.target')}</span>
            <button type="button" disabled={disabled} onClick={() => setPicking(true)}>{targetLabel}</button>
          </label>
          </section>
          {picking && (
            <TargetPicker
              selfId={node.id}
              selectedId={picked && picked.id !== node.id ? picked.id : ''}
              onSelect={id => {
                write({ targetId: id, targetName: '' })
                setPicking(false)
              }}
              onClose={() => setPicking(false)}
            />
          )}
          <section className="iv2-section">
            <div className="iv2-section__title" style={{ color: '#9ab6ff' }}><i /><span>{t('camera.offset')}</span></div>
          <Vec3Field label={t('camera.offset')} value={view.offset} disabled={disabled} onChange={offset => write({ offset })} />
          <Vec3Field label={t('camera.pivot')} value={view.pivot} disabled={disabled} onChange={pivot => write({ pivot })} />
          </section>
          <section className="iv2-section">
            <div className="iv2-section__title" style={{ color: '#b7c9ff' }}><i /><span>{t('camera.orbit')}</span></div>
          <label className="field">
            <span>{t('camera.orbit')}</span>
            <select disabled={disabled} value={view.orbit} onChange={event => write({ orbit: event.target.value as CameraOrbit })}>
              {ORBITS.map(item => <option key={item} value={item}>{t(`camera.orbit.${item}`)}</option>)}
            </select>
          </label>
          {view.orbit !== 'none' && (
            <div className="iv2-pair">
              <Num label={t('camera.sensitivity')} value={view.sensitivity} disabled={disabled} step={0.05} min={0.02} onChange={sensitivity => write({ sensitivity })} />
              <Num label={t('camera.minPitch')} value={view.minPitch} disabled={disabled} step={1} min={-85} onChange={minPitch => write({ minPitch })} />
              <Num label={t('camera.maxPitch')} value={view.maxPitch} disabled={disabled} step={1} min={0} onChange={maxPitch => write({ maxPitch })} />
            </div>
          )}
          <label className="field">
            <span>{t('camera.local')}</span>
            <input type="checkbox" disabled={disabled} checked={view.localOffset} onChange={event => write({ localOffset: event.target.checked })} />
          </label>
          <label className="field">
            <span>{t('camera.look')}</span>
            <input type="checkbox" disabled={disabled} checked={view.lookAtTarget} onChange={event => write({ lookAtTarget: event.target.checked })} />
          </label>
          </section>
          <section className="iv2-section">
            <div className="iv2-section__title" style={{ color: '#d5e0ff' }}><i /><span>{t('camera.fov')}</span></div>
          <div className="iv2-pair">
          <Num label={t('camera.fov')} value={view.fov} disabled={disabled} step={1} min={20} onChange={fov => write({ fov })} />
          <Num label={t('camera.damping')} value={view.damping} disabled={disabled} step={0.5} min={0} onChange={damping => write({ damping })} />
          </div>
          <label className="field">
            <span>{t('camera.collision')}</span>
            <input type="checkbox" disabled={disabled} checked={view.collision} onChange={event => write({ collision: event.target.checked })} />
          </label>
          {view.collision && <Num label={t('camera.collisionRadius')} value={view.collisionRadius} disabled={disabled} step={0.05} min={0.05} onChange={collisionRadius => write({ collisionRadius })} />}
          </section>
        </div>
      )}
    </section>
  )
}

function TargetPicker({
  selfId,
  selectedId,
  onSelect,
  onClose,
}: {
  selfId: string
  selectedId: string
  onSelect: (id: string) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const nodes = useEditorStore(state => state.nodes)
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const items = Object.values(nodes)
    .filter(item => item.id !== selfId && (!q || item.name.toLowerCase().includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  return createPortal(
    <div className="asset-picker__backdrop" onMouseDown={onClose}>
      <section className="asset-picker" role="dialog" aria-label={t('camera.pickTarget')} onMouseDown={event => event.stopPropagation()}>
        <header className="asset-picker__header">
          <h2>{t('camera.pickTarget')}</h2>
          <button type="button" onClick={onClose}><X size={14} /></button>
        </header>
        <div className="asset-picker__search">
          <Search size={12} />
          <input autoFocus value={query} placeholder={t('picker.search')} onChange={event => setQuery(event.target.value)} />
        </div>
        <div className="asset-picker__list">
          <button type="button" className={!selectedId ? 'is-on' : ''} onClick={() => onSelect('')}>
            <i />
            <span>{t('camera.targetSelf')}</span>
          </button>
          {items.map(item => (
            <button key={item.id} type="button" className={selectedId === item.id ? 'is-on' : ''} onClick={() => onSelect(item.id)}>
              <i />
              <span>{item.name}</span>
              <em>{t(`kind.${item.kind}` as MessageKey)}</em>
            </button>
          ))}
          {items.length === 0 && <p>{t('picker.empty')}</p>}
        </div>
      </section>
    </div>,
    document.body,
  )
}

function Num({ label, value, disabled, step, min, onChange }: { label: string, value: number, disabled: boolean, step: number, min: number, onChange: (value: number) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" value={Number.isFinite(value) ? value : 0} disabled={disabled} step={step} min={min} onFocus={event => event.currentTarget.select()} onChange={event => { const next = Number(event.target.value); if (Number.isFinite(next)) onChange(next) }} />
    </label>
  )
}

function Vec3Field({ label, value, disabled, onChange }: { label: string, value: Vec3, disabled: boolean, onChange: (value: Vec3) => void }) {
  const axes = ['X', 'Y', 'Z'] as const
  return (
    <div className="vec3">
      <span className="vec3__label">{label}</span>
      {axes.map((axis, index) => (
        <label key={axis} className="vec3__cell">
          <span className="vec3__axis">{axis}</span>
          <input
            type="number"
            disabled={disabled}
            value={value[index]}
            step={0.05}
            onFocus={event => event.currentTarget.select()}
            onChange={event => {
              const next = Number(event.target.value)
              if (!Number.isFinite(next)) return
              const copy: Vec3 = [...value]
              copy[index] = next
              onChange(copy)
            }}
          />
        </label>
      ))}
    </div>
  )
}
