import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react'
import { useInspectorCardOpen } from '../editor/panels/inspectorMemory'
import { useEditorStore } from '../editor/scene/store'
import { useI18n } from '../editor/i18n'
import type { SceneNode, Vec3 } from '../editor/scene/types'
import { cameraPresetForMode, defaultCameraFollow, type CameraFollowSpec, type CameraOrbit, type CharacterMode } from './sceneRuntime'

const ORBITS: CameraOrbit[] = ['rightDrag', 'mouse', 'none']
const PRESETS: CharacterMode[] = ['adventure', 'strafe', 'lockOn', 'pointAndClick', 'topDown', 'side25d', 'firstPerson']

export function CameraCard({ node, disabled }: { node: SceneNode, disabled: boolean }) {
  const { t } = useI18n()
  const [open, setOpen] = useInspectorCardOpen('follow-camera')
  const spec = node.gameplay?.cameraFollow
  if (!spec) return null
  const view = { ...defaultCameraFollow(), ...spec }
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
    store.updateNode(node.id, { gameplay: { ...node.gameplay, cameraFollow: { ...view, ...patch } } })
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
          <label className="field">
            <span>{t('camera.preset')}</span>
            <select disabled={disabled} value="" onChange={event => { if (event.target.value) write(cameraPresetForMode(event.target.value as CharacterMode)) }}>
              <option value="">{t('camera.presetPick')}</option>
              {PRESETS.map(mode => <option key={mode} value={mode}>{t(`character.mode.${mode}`)}</option>)}
            </select>
          </label>
          <label className="field">
            <span>{t('camera.target')}</span>
            <input value={view.targetName} disabled={disabled} onChange={event => write({ targetName: event.target.value.trim() })} />
          </label>
          <Vec3Field label={t('camera.offset')} value={view.offset} disabled={disabled} onChange={offset => write({ offset })} />
          <Vec3Field label={t('camera.pivot')} value={view.pivot} disabled={disabled} onChange={pivot => write({ pivot })} />
          <label className="field">
            <span>{t('camera.orbit')}</span>
            <select disabled={disabled} value={view.orbit} onChange={event => write({ orbit: event.target.value as CameraOrbit })}>
              {ORBITS.map(item => <option key={item} value={item}>{t(`camera.orbit.${item}`)}</option>)}
            </select>
          </label>
          {view.orbit !== 'none' && (
            <>
              <Num label={t('camera.sensitivity')} value={view.sensitivity} disabled={disabled} step={0.05} min={0.02} onChange={sensitivity => write({ sensitivity })} />
              <Num label={t('camera.minPitch')} value={view.minPitch} disabled={disabled} step={1} min={-85} onChange={minPitch => write({ minPitch })} />
              <Num label={t('camera.maxPitch')} value={view.maxPitch} disabled={disabled} step={1} min={0} onChange={maxPitch => write({ maxPitch })} />
            </>
          )}
          <label className="field">
            <span>{t('camera.local')}</span>
            <input type="checkbox" disabled={disabled} checked={view.localOffset} onChange={event => write({ localOffset: event.target.checked })} />
          </label>
          <label className="field">
            <span>{t('camera.look')}</span>
            <input type="checkbox" disabled={disabled} checked={view.lookAtTarget} onChange={event => write({ lookAtTarget: event.target.checked })} />
          </label>
          <Num label={t('camera.fov')} value={view.fov} disabled={disabled} step={1} min={20} onChange={fov => write({ fov })} />
          <Num label={t('camera.damping')} value={view.damping} disabled={disabled} step={0.5} min={0} onChange={damping => write({ damping })} />
          <label className="field">
            <span>{t('camera.collision')}</span>
            <input type="checkbox" disabled={disabled} checked={view.collision} onChange={event => write({ collision: event.target.checked })} />
          </label>
          {view.collision && <Num label={t('camera.collisionRadius')} value={view.collisionRadius} disabled={disabled} step={0.05} min={0.05} onChange={collisionRadius => write({ collisionRadius })} />}
        </div>
      )}
    </section>
  )
}

function Num({ label, value, disabled, step, min, onChange }: { label: string, value: number, disabled: boolean, step: number, min: number, onChange: (value: number) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" value={Number.isFinite(value) ? value : 0} disabled={disabled} step={step} min={min} onChange={event => { const next = Number(event.target.value); if (Number.isFinite(next)) onChange(next) }} />
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
