import { ChevronDown, ChevronRight } from 'lucide-react'
import { clipNamesFor } from '../editor/assets/models'
import { useInspectorCardOpen } from '../editor/panels/inspectorMemory'
import { useEditorStore } from '../editor/scene/store'
import { useI18n } from '../editor/i18n'
import type { SceneNode } from '../editor/scene/types'
import { characterOrDefault } from './character'
import { cameraPresetForMode, defaultCameraFollow, defaultCharacter, type CharacterDriver, type CharacterMode, type CharacterSpec } from './sceneRuntime'

const MODES: CharacterMode[] = ['adventure', 'strafe', 'lockOn', 'pointAndClick', 'topDown', 'side25d', 'firstPerson']
const DRIVERS: CharacterDriver[] = ['capsule', 'nav', 'hybrid']

export function CharacterCard({ node, disabled }: { node: SceneNode, disabled: boolean }) {
  const { t } = useI18n()
  const [open, setOpen] = useInspectorCardOpen('character')
  const spec = node.gameplay?.character
  const view = characterOrDefault(spec)
  const clips = [...new Set([...clipNamesFor(node.assetId), ...clipNamesFor(node.clipAssetId)])]
  const write = (patch: Partial<CharacterSpec> | null) => {
    const store = useEditorStore.getState()
    if (!patch) {
      const gameplay = { ...node.gameplay }
      delete gameplay.character
      store.updateNode(node.id, { gameplay: Object.keys(gameplay).length ? gameplay : null })
      return
    }
    const next = { ...(spec ?? defaultCharacter()), ...patch, enabled: true }
    const gameplay = { ...node.gameplay, character: next }
    if (patch.mode || !gameplay.cameraFollow?.enabled) {
      gameplay.cameraFollow = { ...(gameplay.cameraFollow ?? defaultCameraFollow()), ...cameraPresetForMode(next.mode), enabled: true }
    }
    store.updateNode(node.id, { gameplay })
  }
  return (
    <section className="iv2-card iv2-card--wide">
      <header className="iv2-card__header" onClick={() => setOpen(!open)}>
        <span className="iv2-card__dot" style={{ background: '#6fbf73' }} />
        <span>{t('character.title')}</span>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </header>
      {open && (
        <div className="iv2-card__body">
          <Check label={t('character.enable')} disabled={disabled} checked={spec?.enabled === true} onChange={checked => write(checked ? { ...view, enabled: true } : null)} />
          {spec?.enabled && (
            <>
              <Select label={t('character.driver')} value={view.driver} disabled={disabled} options={DRIVERS.map(item => ({ value: item, label: t(`character.driver.${item}`) }))} onChange={driver => write({ driver: driver as CharacterDriver })} />
              <Select label={t('character.mode')} value={view.mode} disabled={disabled} options={MODES.map(item => ({ value: item, label: t(`character.mode.${item}`) }))} onChange={mode => write({ mode: mode as CharacterMode })} />
              {(view.mode === 'pointAndClick' || view.driver !== 'capsule') && (
                <>
                  <Select label={t('character.click')} value={view.clickButton} disabled={disabled} options={[{ value: 'right', label: t('character.clickRight') }, { value: 'left', label: t('character.clickLeft') }]} onChange={clickButton => write({ clickButton: clickButton as 'left' | 'right' })} />
                  <Num label={t('character.clickStop')} value={view.clickStop} disabled={disabled} step={0.05} min={0.05} onChange={clickStop => write({ clickStop })} />
                </>
              )}
              <Num label={t('character.radius')} value={view.radius} disabled={disabled} step={0.01} min={0.05} onChange={radius => write({ radius })} />
              <Num label={t('character.height')} value={view.height} disabled={disabled} step={0.01} min={0.2} onChange={height => write({ height })} />
              <Num label={t('character.walk')} value={view.moveSpeed} disabled={disabled} step={0.1} min={0.2} onChange={moveSpeed => write({ moveSpeed })} />
              <Num label={t('character.sprint')} value={view.sprintMultiplier} disabled={disabled} step={0.1} min={1} onChange={sprintMultiplier => write({ sprintMultiplier })} />
              <Num label={t('character.jump')} value={view.jumpSpeed} disabled={disabled} step={0.1} min={0} onChange={jumpSpeed => write({ jumpSpeed })} />
              <Num label={t('character.jumps')} value={view.maxJumps} disabled={disabled} step={1} min={1} onChange={maxJumps => write({ maxJumps: Math.max(1, Math.round(maxJumps)) })} />
              <Num label={t('character.gravity')} value={view.gravity} disabled={disabled} step={0.5} min={0} onChange={gravity => write({ gravity })} />
              <Num label={t('character.coyote')} value={view.coyoteTime} disabled={disabled} step={0.01} min={0} onChange={coyoteTime => write({ coyoteTime })} />
              <Num label={t('character.buffer')} value={view.jumpBuffer} disabled={disabled} step={0.01} min={0} onChange={jumpBuffer => write({ jumpBuffer })} />
              <Num label={t('character.footstep')} value={view.footstepDistance} disabled={disabled} step={0.1} min={0.2} onChange={footstepDistance => write({ footstepDistance })} />
              <Check label={t('character.dash')} disabled={disabled} checked={view.dash} onChange={dash => write({ dash })} />
              {view.dash && (
                <>
                  <Text label={t('character.dashKey')} value={view.dashKey} disabled={disabled} onChange={dashKey => write({ dashKey })} />
                  <Num label={t('character.dashDistance')} value={view.dashDistance} disabled={disabled} step={0.1} min={0.2} onChange={dashDistance => write({ dashDistance })} />
                  <Num label={t('character.dashDuration')} value={view.dashDuration} disabled={disabled} step={0.02} min={0.05} onChange={dashDuration => write({ dashDuration })} />
                  <Num label={t('character.dashInvincible')} value={view.dashInvincible} disabled={disabled} step={0.05} min={0} onChange={dashInvincible => write({ dashInvincible })} />
                  <Num label={t('character.dashCooldown')} value={view.dashCooldown} disabled={disabled} step={0.05} min={0} onChange={dashCooldown => write({ dashCooldown })} />
                </>
              )}
              {view.mode === 'lockOn' && <Text label={t('character.lock')} value={view.lockTargetName} disabled={disabled} onChange={lockTargetName => write({ lockTargetName })} />}
              <Clip label={t('character.idle')} value={view.idleClip} clips={clips} disabled={disabled} onChange={idleClip => write({ idleClip })} />
              <Clip label={t('character.walkClip')} value={view.walkClip} clips={clips} disabled={disabled} onChange={walkClip => write({ walkClip })} />
              <Clip label={t('character.runClip')} value={view.runClip} clips={clips} disabled={disabled} onChange={runClip => write({ runClip })} />
              <Clip label={t('character.jumpClip')} value={view.jumpClip} clips={clips} disabled={disabled} onChange={jumpClip => write({ jumpClip })} />
              <Clip label={t('character.dodgeClip')} value={view.dodgeClip} clips={clips} disabled={disabled} onChange={dodgeClip => write({ dodgeClip })} />
            </>
          )}
        </div>
      )}
    </section>
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
      <input type="number" value={Number.isFinite(value) ? value : 0} disabled={disabled} step={step} min={min} onChange={event => { const next = Number(event.target.value); if (Number.isFinite(next)) onChange(next) }} />
    </label>
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
