import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronRight, Search, Trash2, X } from 'lucide-react'
import { CardReset } from '../editor/panels/CardReset'
import { KeyField } from '../editor/ui/KeyField'
import { clipNamesFor } from '../editor/assets/models'
import { useInspectorCardOpen } from '../editor/panels/inspectorMemory'
import { useEditorStore } from '../editor/scene/store'
import { useI18n, type MessageKey } from '../editor/i18n'
import type { SceneNode, Vec3 } from '../editor/scene/types'
import { characterOrDefault } from './character'
import {
  cameraPresetForMode,
  defaultCameraFollow,
  defaultCharacter,
  resolveCharacterCamera,
  type CameraFollowSpec,
  type CameraOrbit,
  type CharacterDriver,
  type CharacterMode,
  type CharacterSpec,
} from './sceneRuntime'
import '../editor/panels/AssetPicker.css'

const MODES: CharacterMode[] = ['adventure', 'strafe', 'lockOn', 'pointAndClick', 'topDown', 'side25d', 'firstPerson']
const DRIVERS: CharacterDriver[] = ['capsule', 'nav', 'hybrid']

export function CharacterCard({ node, disabled }: { node: SceneNode, disabled: boolean }) {
  const { t } = useI18n()
  const [open, setOpen] = useInspectorCardOpen('character')
  const [pickingLock, setPickingLock] = useState(false)
  const nodes = useEditorStore(state => state.nodes)
  const spec = node.gameplay?.character
  if (!spec) return null
  const view = characterOrDefault(spec)
  const cam = resolveCharacterCamera(view, node.gameplay?.cameraFollow)
  const clips = [...new Set([...clipNamesFor(node.assetId), ...clipNamesFor(node.clipAssetId)])]
  const lockNode = view.lockTargetId
    ? nodes[view.lockTargetId]
    : view.lockTargetName
      ? Object.values(nodes).find(item => item.id !== node.id && item.name === view.lockTargetName)
      : undefined
  const fixedCam = view.mode === 'pointAndClick' || view.mode === 'topDown' || view.mode === 'side25d'
  const firstPerson = view.mode === 'firstPerson'
  const usesClick = view.mode === 'pointAndClick' || view.driver !== 'capsule'
  const write = (patch: Partial<CharacterSpec> | null) => {
    const store = useEditorStore.getState()
    store.beginGesture(t('character.title'))
    if (!patch) {
      const gameplay = { ...node.gameplay }
      delete gameplay.character
      delete gameplay.cameraFollow
      store.updateNode(node.id, { gameplay: Object.keys(gameplay).length ? gameplay : null })
      store.endGesture()
      return
    }
    const next = { ...(spec ?? defaultCharacter()), ...patch }
    const gameplay = { ...node.gameplay, character: next }
    const baseCam = gameplay.cameraFollow ?? defaultCameraFollow()
    gameplay.cameraFollow = patch.mode
      ? resolveCharacterCamera(next, { ...baseCam, ...cameraPresetForMode(next.mode) })
      : resolveCharacterCamera(next, baseCam)
    store.updateNode(node.id, { gameplay })
    store.endGesture()
  }
  const writeCam = (patch: Partial<CameraFollowSpec>) => {
    const store = useEditorStore.getState()
    store.beginGesture(t('camera.title'))
    const next = resolveCharacterCamera(view, { ...(node.gameplay?.cameraFollow ?? defaultCameraFollow()), ...patch })
    store.updateNode(node.id, { gameplay: { ...node.gameplay, cameraFollow: next } })
    store.endGesture()
  }
  return (
    <section className="iv2-card iv2-card--wide">
      <header className="iv2-card__header" onClick={() => setOpen(!open)}>
        <span className="iv2-card__dot" style={{ background: '#6fbf73' }} />
        <span>{t('character.title')}</span>
        <span className="iv2-card__actions" onClick={event => event.stopPropagation()}>
          <input
            type="checkbox"
            title={t('character.enable')}
            disabled={disabled}
            checked={spec.enabled !== false}
            onChange={event => write({ enabled: event.target.checked })}
          />
          <CardReset disabled={disabled} onReset={() => write(defaultCharacter())} />
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
          <Section title={t('character.section.control')} color="#6fbf73">
          <Select label={t('character.mode')} value={view.mode} disabled={disabled} options={MODES.map(item => ({ value: item, label: t(`character.mode.${item}`) }))} onChange={mode => write({ mode: mode as CharacterMode })} />
          <Select label={t('character.driver')} value={view.driver} disabled={disabled} options={DRIVERS.map(item => ({ value: item, label: t(`character.driver.${item}`) }))} onChange={driver => write({ driver: driver as CharacterDriver })} />
          {usesClick && (
            <div className="iv2-pair">
              <Select label={t('character.click')} value={view.clickButton} disabled={disabled} options={[{ value: 'right', label: t('character.clickRight') }, { value: 'left', label: t('character.clickLeft') }]} onChange={clickButton => write({ clickButton: clickButton as 'left' | 'right' })} />
              <Num label={t('character.clickStop')} value={view.clickStop} disabled={disabled} step={0.05} min={0.05} onChange={clickStop => write({ clickStop })} />
            </div>
          )}
          {view.mode === 'lockOn' && (
            <label className="field">
              <span>{t('character.lock')}</span>
              <button type="button" disabled={disabled} onClick={() => setPickingLock(true)}>{lockNode?.name ?? t('picker.none')}</button>
            </label>
          )}
          {pickingLock && (
            <NodePicker
              selfId={node.id}
              selectedId={lockNode?.id ?? ''}
              title={t('character.pickLock')}
              onSelect={id => {
                write({ lockTargetId: id, lockTargetName: '' })
                setPickingLock(false)
              }}
              onClose={() => setPickingLock(false)}
            />
          )}
          </Section>
          <Section title={t('character.section.body')} color="#8bc6a3">
          <div className="iv2-pair">
          <Num label={t('character.radius')} value={view.radius} disabled={disabled} step={0.01} min={0.05} onChange={radius => write({ radius })} />
          <Num label={t('character.height')} value={view.height} disabled={disabled} step={0.01} min={0.2} onChange={height => write({ height })} />
          </div>
          </Section>
          <Section title={t('character.section.move')} color="#7eb6ff">
          <div className="iv2-pair">
          <Num label={t('character.walk')} value={view.moveSpeed} disabled={disabled} step={0.1} min={0.2} onChange={moveSpeed => write({ moveSpeed })} />
          <Num label={t('character.turn')} value={view.turnSpeed} disabled={disabled} step={15} min={30} onChange={turnSpeed => write({ turnSpeed: Math.min(3600, Math.max(30, turnSpeed)) })} />
          <Num label={t('character.sprint')} value={view.sprintMultiplier} disabled={disabled} step={0.1} min={1} onChange={sprintMultiplier => write({ sprintMultiplier })} />
          <Num label={t('character.jump')} value={view.jumpSpeed} disabled={disabled} step={0.1} min={0} onChange={jumpSpeed => write({ jumpSpeed })} />
          <Num label={t('character.jumps')} value={view.maxJumps} disabled={disabled} step={1} min={1} onChange={maxJumps => write({ maxJumps: Math.max(1, Math.round(maxJumps)) })} />
          <Num label={t('character.gravity')} value={view.gravity} disabled={disabled} step={0.5} min={0} onChange={gravity => write({ gravity })} />
          <Num label={t('character.footstep')} value={view.footstepDistance} disabled={disabled} step={0.1} min={0.2} onChange={footstepDistance => write({ footstepDistance })} />
          <Num label={t('character.coyote')} value={view.coyoteTime} disabled={disabled} step={0.01} min={0} onChange={coyoteTime => write({ coyoteTime })} />
          <Num label={t('character.buffer')} value={view.jumpBuffer} disabled={disabled} step={0.01} min={0} onChange={jumpBuffer => write({ jumpBuffer })} />
          </div>
          </Section>
          <Section title={t('character.dash')} color="#e0a15a">
          <Check label={t('character.dash')} disabled={disabled} checked={view.dash} onChange={dash => write({ dash })} />
          {view.dash && (
            <div className="iv2-pair">
              <KeyField label={t('character.dashKey')} value={view.dashKey} disabled={disabled} onChange={dashKey => write({ dashKey })} />
              <Num label={t('character.dashDistance')} value={view.dashDistance} disabled={disabled} step={0.1} min={0.2} onChange={dashDistance => write({ dashDistance })} />
              <Num label={t('character.dashDuration')} value={view.dashDuration} disabled={disabled} step={0.02} min={0.05} onChange={dashDuration => write({ dashDuration })} />
              <Num label={t('character.dashCooldown')} value={view.dashCooldown} disabled={disabled} step={0.05} min={0} onChange={dashCooldown => write({ dashCooldown })} />
              <Num label={t('character.dashInvincible')} value={view.dashInvincible} disabled={disabled} step={0.05} min={0} onChange={dashInvincible => write({ dashInvincible })} />
            </div>
          )}
          </Section>
          <Section title={t('character.section.clips')} color="#c79bff">
          <Clip label={t('character.idle')} value={view.idleClip} clips={clips} disabled={disabled} onChange={idleClip => write({ idleClip })} />
          <Clip label={t('character.walkClip')} value={view.walkClip} clips={clips} disabled={disabled} onChange={walkClip => write({ walkClip })} />
          <Clip label={t('character.runClip')} value={view.runClip} clips={clips} disabled={disabled} onChange={runClip => write({ runClip })} />
          <div className="iv2-pair">
          <Clip label={t('character.jumpClip')} value={view.jumpClip} clips={clips} disabled={disabled} onChange={jumpClip => write({ jumpClip })} />
          <Clip label={t('character.dodgeClip')} value={view.dodgeClip} clips={clips} disabled={disabled} onChange={dodgeClip => write({ dodgeClip })} />
          </div>
          </Section>
          <Section title={t('camera.title')} color="#7aa2ff">
            <Check label={t('camera.enable')} disabled={disabled} checked={cam.enabled} onChange={enabled => writeCam({ enabled })} />
            {cam.enabled && (
              <>
                <Vec3Field label={t('camera.offset')} value={cam.offset} disabled={disabled} onChange={offset => writeCam({ offset })} />
                <Vec3Field label={t('camera.pivot')} value={cam.pivot} disabled={disabled} onChange={pivot => writeCam({ pivot })} />
                {(view.mode === 'adventure' || view.mode === 'lockOn') && !(usesClick && view.clickButton === 'right') && (
                  <Select
                    label={t('camera.orbit')}
                    value={cam.orbit}
                    disabled={disabled}
                    options={[
                      { value: 'rightDrag', label: t('camera.orbit.rightDrag') },
                      { value: 'mouse', label: t('camera.orbit.mouse') },
                    ]}
                    onChange={orbit => writeCam({ orbit: orbit as CameraOrbit })}
                  />
                )}
                {!fixedCam && (
                  <div className="iv2-pair">
                    <Num label={t('camera.sensitivity')} value={cam.sensitivity} disabled={disabled} step={0.05} min={0.02} onChange={sensitivity => writeCam({ sensitivity })} />
                    <Num label={t('camera.fov')} value={cam.fov} disabled={disabled} step={1} min={20} onChange={fov => writeCam({ fov })} />
                    <Num label={t('camera.minPitch')} value={cam.minPitch} disabled={disabled} step={1} min={-85} onChange={minPitch => writeCam({ minPitch })} />
                    <Num label={t('camera.maxPitch')} value={cam.maxPitch} disabled={disabled} step={1} min={0} onChange={maxPitch => writeCam({ maxPitch })} />
                  </div>
                )}
                {fixedCam && <Num label={t('camera.fov')} value={cam.fov} disabled={disabled} step={1} min={20} onChange={fov => writeCam({ fov })} />}
                <Num label={t('camera.damping')} value={cam.damping} disabled={disabled} step={0.5} min={0} onChange={damping => writeCam({ damping })} />
                <Check label={t('camera.zoom')} disabled={disabled} checked={cam.zoom !== false} onChange={zoom => writeCam({ zoom })} />
                {cam.zoom !== false && (
                  <div className="iv2-pair">
                    <Num label={t('camera.zoomSpeed')} value={cam.zoomSpeed} disabled={disabled} step={0.02} min={0.02} onChange={zoomSpeed => writeCam({ zoomSpeed })} />
                    <Num label={t('camera.minDistance')} value={cam.minDistance} disabled={disabled} step={0.1} min={0.2} onChange={minDistance => writeCam({ minDistance })} />
                    <Num label={t('camera.maxDistance')} value={cam.maxDistance} disabled={disabled} step={0.1} min={0.2} onChange={maxDistance => writeCam({ maxDistance })} />
                  </div>
                )}
                {!fixedCam && !firstPerson && (
                  <div className="iv2-pair">
                    <Check label={t('camera.collision')} disabled={disabled} checked={cam.collision} onChange={collision => writeCam({ collision })} />
                    {cam.collision && <Num label={t('camera.collisionRadius')} value={cam.collisionRadius} disabled={disabled} step={0.05} min={0.05} onChange={collisionRadius => writeCam({ collisionRadius })} />}
                  </div>
                )}
              </>
            )}
          </Section>
        </div>
      )}
    </section>
  )
}

function Section({ title, color, children }: { title: string, color: string, children: ReactNode }) {
  return (
    <section className="iv2-section">
      <div className="iv2-section__title" style={{ color }}><i /><span>{title}</span></div>
      {children}
    </section>
  )
}

function NodePicker({
  selfId,
  selectedId,
  title,
  onSelect,
  onClose,
}: {
  selfId: string
  selectedId: string
  title: string
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
      <section className="asset-picker" role="dialog" aria-label={title} onMouseDown={event => event.stopPropagation()}>
        <header className="asset-picker__header">
          <h2>{title}</h2>
          <button type="button" onClick={onClose}><X size={14} /></button>
        </header>
        <div className="asset-picker__search">
          <Search size={12} />
          <input autoFocus value={query} placeholder={t('picker.search')} onChange={event => setQuery(event.target.value)} />
        </div>
        <div className="asset-picker__list">
          <button type="button" className={!selectedId ? 'is-on' : ''} onClick={() => onSelect('')}>
            <i />
            <span>{t('picker.none')}</span>
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

function Check({ label, checked, disabled, onChange }: { label: string, checked: boolean, disabled: boolean, onChange: (value: boolean) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="checkbox" disabled={disabled} checked={checked} onChange={event => onChange(event.target.checked)} />
    </label>
  )
}

function Select({ label, value, options, disabled, onChange }: { label: string, value: string, options: { value: string, label: string }[], disabled: boolean, onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>
        {options.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
      </select>
    </label>
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

function Text({ label, value, disabled, onChange }: { label: string, value: string, disabled: boolean, onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value} disabled={disabled} onChange={event => onChange(event.target.value.trim())} />
    </label>
  )
}

function Clip({ label, value, clips, disabled, onChange }: { label: string, value: string, clips: string[], disabled: boolean, onChange: (value: string) => void }) {
  const names = value && !clips.includes(value) ? [value, ...clips] : clips
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>
        <option value="" />
        {names.map(name => <option key={name} value={name}>{name}</option>)}
      </select>
    </label>
  )
}
