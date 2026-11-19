import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react'
import { CardReset } from '../editor/panels/CardReset'
import { KeyField } from '../editor/ui/KeyField'
import { useInspectorCardOpen } from '../editor/panels/inspectorMemory'
import { useEditorStore } from '../editor/scene/store'
import { useI18n } from '../editor/i18n'
import type { SceneNode, Vec3 } from '../editor/scene/types'
import { AudioField } from './RulePickers'
import { defaultInteract, defaultTrigger, defaultMover, defaultCheckpoint, defaultScore, defaultSoundSource, type InteractSpec, type TriggerZoneSpec, type MoverSpec, type CheckpointSpec, type ScoreSpec, type SoundSourceSpec } from './sceneRuntime'

export function SoundSourceCard({ node, disabled }: { node: SceneNode, disabled: boolean }) {
  const { t } = useI18n()
  const [open, setOpen] = useInspectorCardOpen('soundSource')
  const spec = node.gameplay?.soundSource
  if (!spec) return null
  const view = { ...defaultSoundSource(), ...spec }
  const write = (patch: Partial<SoundSourceSpec> | null) => {
    const store = useEditorStore.getState()
    store.beginGesture(t('soundSource.title'))
    if (!patch) {
      const gameplay = { ...node.gameplay }
      delete gameplay.soundSource
      store.updateNode(node.id, { gameplay: Object.keys(gameplay).length ? gameplay : null })
      store.endGesture()
      return
    }
    store.updateNode(node.id, { gameplay: { ...node.gameplay, soundSource: { ...view, ...patch } } })
    store.endGesture()
  }
  return (
    <section className="iv2-card iv2-card--wide">
      <header className="iv2-card__header" onClick={() => setOpen(!open)}>
        <span className="iv2-card__dot" style={{ background: '#26a69a' }} />
        <span>{t('soundSource.title')}</span>
        <span className="iv2-card__actions" onClick={event => event.stopPropagation()}>
          <input
            type="checkbox"
            title={t('soundSource.enable')}
            disabled={disabled}
            checked={spec.enabled !== false}
            onChange={event => write({ enabled: event.target.checked })}
          />
          <CardReset disabled={disabled} onReset={() => write(defaultSoundSource())} />
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
            <div className="iv2-section__title" style={{ color: '#26a69a' }}><i /><span>{t('soundSource.clip')}</span></div>
            <label className="field">
              <span>{t('soundSource.clip')}</span>
              <AudioField value={view.assetId} disabled={disabled} onChange={assetId => write({ assetId })} />
            </label>
            <label className="field">
              <span>{t('soundSource.loop')}</span>
              <input type="checkbox" disabled={disabled} checked={view.loop} onChange={event => write({ loop: event.target.checked })} />
            </label>
            <div className="iv2-pair">
              <SoundNumber label={t('audio.volume')} value={view.volume} disabled={disabled} min={0} max={4} step={0.05} onChange={volume => write({ volume })} />
              <SoundNumber label={t('soundSource.distance')} value={view.refDistance} disabled={disabled} min={0.1} step={0.1} onChange={refDistance => write({ refDistance })} />
              <SoundNumber label={t('soundSource.rolloff')} value={view.rolloff} disabled={disabled} min={0} step={0.1} onChange={rolloff => write({ rolloff })} />
            </div>
            <p className="settings-note">{t('soundSource.hint')}</p>
          </section>
        </div>
      )}
    </section>
  )
}

export function InteractCard({ node, disabled }: { node: SceneNode, disabled: boolean }) {
  const { t } = useI18n()
  const [open, setOpen] = useInspectorCardOpen('interact')
  const tags = useEditorStore(state => state.tags)
  const spec = node.gameplay?.interact
  if (!spec) return null
  const view = { ...defaultInteract(), ...spec }
  const write = (patch: Partial<InteractSpec> | null) => {
    const store = useEditorStore.getState()
    store.beginGesture(t('interact.title'))
    if (!patch) {
      const gameplay = { ...node.gameplay }
      delete gameplay.interact
      store.updateNode(node.id, { gameplay: Object.keys(gameplay).length ? gameplay : null })
      store.endGesture()
      return
    }
    store.updateNode(node.id, { gameplay: { ...node.gameplay, interact: { ...view, ...patch } } })
    store.endGesture()
  }
  return (
    <section className="iv2-card iv2-card--wide">
      <header className="iv2-card__header" onClick={() => setOpen(!open)}>
        <span className="iv2-card__dot" style={{ background: '#e0a15a' }} />
        <span>{t('interact.title')}</span>
        <span className="iv2-card__actions" onClick={event => event.stopPropagation()}>
          <input
            type="checkbox"
            title={t('interact.enable')}
            disabled={disabled}
            checked={spec.enabled !== false}
            onChange={event => write({ enabled: event.target.checked })}
          />
          <CardReset disabled={disabled} onReset={() => write(defaultInteract())} />
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
            <div className="iv2-section__title" style={{ color: '#e0a15a' }}><i /><span>{t('interact.prompt')}</span></div>
            <div className="iv2-pair">
              <Text label={t('interact.prompt')} value={view.prompt} disabled={disabled} onChange={prompt => write({ prompt })} />
              <KeyField label={t('interact.key')} value={view.key} disabled={disabled} onChange={key => write({ key })} />
            </div>
            <Check label={t('interact.once')} disabled={disabled} checked={view.once} onChange={once => write({ once })} />
          </section>
          <section className="iv2-section">
            <div className="iv2-section__title" style={{ color: '#f0c674' }}><i /><span>{t('interact.radius')}</span></div>
            <Num label={t('interact.radius')} value={view.radius} disabled={disabled} onChange={radius => write({ radius })} />
            <TagSelect label={t('interact.tag')} empty={t('interact.any')} value={view.filterTagId} tags={tags} disabled={disabled} onChange={filterTagId => write({ filterTagId })} />
            <Text label={t('interact.message')} value={view.message} disabled={disabled} onChange={message => write({ message })} />
          </section>
        </div>
      )}
    </section>
  )
}

export function TriggerCard({ node, disabled }: { node: SceneNode, disabled: boolean }) {
  const { t } = useI18n()
  const [open, setOpen] = useInspectorCardOpen('trigger')
  const tags = useEditorStore(state => state.tags)
  const spec = node.gameplay?.trigger
  if (!spec) return null
  const view = { ...defaultTrigger(), ...spec, filterTagId: spec?.filterTagId ?? '' }
  const write = (patch: Partial<TriggerZoneSpec> | null) => {
    const store = useEditorStore.getState()
    store.beginGesture(t('trigger.title'))
    if (!patch) {
      const gameplay = { ...node.gameplay }
      delete gameplay.trigger
      store.updateNode(node.id, { gameplay: Object.keys(gameplay).length ? gameplay : null })
      store.endGesture()
      return
    }
    store.updateNode(node.id, { gameplay: { ...node.gameplay, trigger: { ...view, ...patch } } })
    store.endGesture()
  }
  return (
    <section className="iv2-card iv2-card--wide">
      <header className="iv2-card__header" onClick={() => setOpen(!open)}>
        <span className="iv2-card__dot" style={{ background: '#d27ba0' }} />
        <span>{t('trigger.title')}</span>
        <span className="iv2-card__actions" onClick={event => event.stopPropagation()}>
          <input
            type="checkbox"
            title={t('trigger.enable')}
            disabled={disabled}
            checked={spec.enabled !== false}
            onChange={event => write({ enabled: event.target.checked })}
          />
          <CardReset disabled={disabled} onReset={() => write(defaultTrigger())} />
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
            <div className="iv2-section__title" style={{ color: '#d27ba0' }}><i /><span>{t('trigger.radius')}</span></div>
            <div className="iv2-pair">
              <Num label={t('trigger.radius')} value={view.radius} disabled={disabled} onChange={radius => write({ radius })} />
              <Check label={t('trigger.once')} disabled={disabled} checked={view.once} onChange={once => write({ once })} />
            </div>
            <TagSelect label={t('trigger.tag')} empty={t('interact.any')} value={view.filterTagId} tags={tags} disabled={disabled} onChange={filterTagId => write({ filterTagId })} />
          </section>
          <section className="iv2-section">
            <div className="iv2-section__title" style={{ color: '#e7a0c0' }}><i /><span>{t('rule.message')}</span></div>
            <Text label={t('trigger.enter')} value={view.enterMessage} disabled={disabled} onChange={enterMessage => write({ enterMessage })} />
            <Text label={t('trigger.exit')} value={view.exitMessage} disabled={disabled} onChange={exitMessage => write({ exitMessage })} />
          </section>
        </div>
      )}
    </section>
  )
}

export function MoverCard({ node, disabled }: { node: SceneNode, disabled: boolean }) {
  const { t } = useI18n()
  const [open, setOpen] = useInspectorCardOpen('mover')
  const spec = node.gameplay?.mover
  if (!spec) return null
  const view = { ...defaultMover(), ...spec }
  const write = (patch: Partial<MoverSpec> | null) => {
    const store = useEditorStore.getState()
    store.beginGesture(t('mover.title'))
    if (!patch) {
      const gameplay = { ...node.gameplay }
      delete gameplay.mover
      store.updateNode(node.id, { gameplay: Object.keys(gameplay).length ? gameplay : null })
      store.endGesture()
      return
    }
    store.updateNode(node.id, { gameplay: { ...node.gameplay, mover: { ...view, ...patch } } })
    store.endGesture()
  }
  return (
    <section className="iv2-card iv2-card--wide">
      <header className="iv2-card__header" onClick={() => setOpen(!open)}>
        <span className="iv2-card__dot" style={{ background: '#6ec4c4' }} />
        <span>{t('mover.title')}</span>
        <span className="iv2-card__actions" onClick={event => event.stopPropagation()}>
          <input
            type="checkbox"
            title={t('mover.enable')}
            disabled={disabled}
            checked={spec.enabled !== false}
            onChange={event => write({ enabled: event.target.checked })}
          />
          <CardReset disabled={disabled} onReset={() => write(defaultMover())} />
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
            <div className="iv2-section__title" style={{ color: '#6ec4c4' }}><i /><span>{t('mover.offset')}</span></div>
            <Vec3Field label={t('mover.offset')} value={view.offset} disabled={disabled} onChange={offset => write({ offset })} />
            <Num label={t('mover.carry')} value={view.carryRadius} disabled={disabled} onChange={carryRadius => write({ carryRadius })} />
          </section>
          <section className="iv2-section">
            <div className="iv2-section__title" style={{ color: '#9ad7d7' }}><i /><span>{t('mover.duration')}</span></div>
            <div className="iv2-pair">
              <Num label={t('mover.duration')} value={view.duration} disabled={disabled} onChange={duration => write({ duration })} />
              <Num label={t('mover.pause')} value={view.pause} disabled={disabled} onChange={pause => write({ pause })} />
            </div>
            <Check label={t('mover.ping')} disabled={disabled} checked={view.pingPong} onChange={pingPong => write({ pingPong })} />
            <Check label={t('mover.auto')} disabled={disabled} checked={view.autoPlay} onChange={autoPlay => write({ autoPlay })} />
            {!view.autoPlay && <Text label={t('mover.message')} value={view.startMessage} disabled={disabled} onChange={startMessage => write({ startMessage })} />}
          </section>
        </div>
      )}
    </section>
  )
}

export function CheckpointCard({ node, disabled }: { node: SceneNode, disabled: boolean }) {
  const { t } = useI18n()
  const [open, setOpen] = useInspectorCardOpen('checkpoint')
  const spec = node.gameplay?.checkpoint
  if (!spec) return null
  const view = { ...defaultCheckpoint(), ...spec }
  const write = (patch: Partial<CheckpointSpec> | null) => {
    const store = useEditorStore.getState()
    store.beginGesture(t('checkpoint.title'))
    if (!patch) {
      const gameplay = { ...node.gameplay }
      delete gameplay.checkpoint
      store.updateNode(node.id, { gameplay: Object.keys(gameplay).length ? gameplay : null })
      store.endGesture()
      return
    }
    store.updateNode(node.id, { gameplay: { ...node.gameplay, checkpoint: { ...view, ...patch } } })
    store.endGesture()
  }
  return (
    <section className="iv2-card iv2-card--wide">
      <header className="iv2-card__header" onClick={() => setOpen(!open)}>
        <span className="iv2-card__dot" style={{ background: '#d4c15a' }} />
        <span>{t('checkpoint.title')}</span>
        <span className="iv2-card__actions" onClick={event => event.stopPropagation()}>
          <input
            type="checkbox"
            title={t('checkpoint.enable')}
            disabled={disabled}
            checked={spec.enabled !== false}
            onChange={event => write({ enabled: event.target.checked })}
          />
          <CardReset disabled={disabled} onReset={() => write(defaultCheckpoint())} />
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
            <div className="iv2-section__title" style={{ color: '#d4c15a' }}><i /><span>{t('checkpoint.spawn')}</span></div>
            <Check label={t('checkpoint.spawn')} disabled={disabled} checked={view.spawn} onChange={spawn => write({ spawn })} />
            <div className="iv2-pair">
              <Num label={t('checkpoint.radius')} value={view.radius} disabled={disabled} onChange={radius => write({ radius })} />
              <Num label={t('checkpoint.delay')} value={view.delay} disabled={disabled} onChange={delay => write({ delay })} />
            </div>
          </section>
          <section className="iv2-section">
            <div className="iv2-section__title" style={{ color: '#e07a7a' }}><i /><span>{t('checkpoint.abyss')}</span></div>
            <Num label={t('checkpoint.abyss')} value={view.abyssY} disabled={disabled} onChange={abyssY => write({ abyssY })} />
            <Text label={t('checkpoint.message')} value={view.message} disabled={disabled} onChange={message => write({ message })} />
          </section>
        </div>
      )}
    </section>
  )
}

export function ScoreCard({ node, disabled }: { node: SceneNode, disabled: boolean }) {
  const { t } = useI18n()
  const [open, setOpen] = useInspectorCardOpen('score')
  const spec = node.gameplay?.score
  if (!spec) return null
  const view = { ...defaultScore(), ...spec }
  const write = (patch: Partial<ScoreSpec> | null) => {
    const store = useEditorStore.getState()
    store.beginGesture(t('score.title'))
    if (!patch) {
      const gameplay = { ...node.gameplay }
      delete gameplay.score
      store.updateNode(node.id, { gameplay: Object.keys(gameplay).length ? gameplay : null })
      store.endGesture()
      return
    }
    store.updateNode(node.id, { gameplay: { ...node.gameplay, score: { ...view, ...patch } } })
    store.endGesture()
  }
  return (
    <section className="iv2-card iv2-card--wide">
      <header className="iv2-card__header" onClick={() => setOpen(!open)}>
        <span className="iv2-card__dot" style={{ background: '#c48bdc' }} />
        <span>{t('score.title')}</span>
        <span className="iv2-card__actions" onClick={event => event.stopPropagation()}>
          <input
            type="checkbox"
            title={t('score.enable')}
            disabled={disabled}
            checked={spec.enabled !== false}
            onChange={event => write({ enabled: event.target.checked })}
          />
          <CardReset disabled={disabled} onReset={() => write(defaultScore())} />
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
            <div className="iv2-section__title" style={{ color: '#c48bdc' }}><i /><span>{t('score.objective')}</span></div>
            <Text label={t('score.objective')} value={view.title} disabled={disabled} onChange={title => write({ title })} />
            <div className="iv2-pair">
              <Num label={t('score.target')} value={view.target} disabled={disabled} onChange={target => write({ target })} />
              <Num label={t('score.interact')} value={view.perInteract} disabled={disabled} onChange={perInteract => write({ perInteract })} />
            </div>
          </section>
          <section className="iv2-section">
            <div className="iv2-section__title" style={{ color: '#d7b0e8' }}><i /><span>{t('score.time')}</span></div>
            <Num label={t('score.time')} value={view.timeLimit} disabled={disabled} onChange={timeLimit => write({ timeLimit })} />
            <p className="settings-note">{t('score.hint')}</p>
          </section>
        </div>
      )}
    </section>
  )
}

function Vec3Field({ label, value, disabled, onChange }: { label: string, value: Vec3, disabled: boolean, onChange: (value: Vec3) => void }) {
  const set = (index: number, raw: string) => {
    const next = Number(raw)
    if (!Number.isFinite(next)) return
    const copy: Vec3 = [value[0], value[1], value[2]]
    copy[index] = next
    onChange(copy)
  }
  return (
    <label className="field">
      <span>{label}</span>
      <span className="vec3">
        <input type="number" step={0.1} disabled={disabled} value={value[0]} onChange={event => set(0, event.target.value)} />
        <input type="number" step={0.1} disabled={disabled} value={value[1]} onChange={event => set(1, event.target.value)} />
        <input type="number" step={0.1} disabled={disabled} value={value[2]} onChange={event => set(2, event.target.value)} />
      </span>
    </label>
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

function SoundNumber({ label, value, disabled, min, max, step, onChange }: { label: string, value: number, disabled: boolean, min: number, max?: number, step: number, onChange: (value: number) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" min={min} max={max} step={step} disabled={disabled} value={Number.isFinite(value) ? value : 0} onChange={event => { const next = Number(event.target.value); if (Number.isFinite(next)) onChange(next) }} />
    </label>
  )
}

function Num({ label, value, disabled, onChange }: { label: string, value: number, disabled: boolean, onChange: (value: number) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" min={0.2} step={0.1} disabled={disabled} value={Number.isFinite(value) ? value : 0} onChange={event => { const next = Number(event.target.value); if (Number.isFinite(next)) onChange(next) }} />
    </label>
  )
}

function Text({ label, value, disabled, onChange }: { label: string, value: string, disabled: boolean, onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value} disabled={disabled} onChange={event => onChange(event.target.value)} />
    </label>
  )
}

function TagSelect({ label, empty, value, tags, disabled, onChange }: { label: string, empty: string, value: string, tags: { id: string, name: string }[], disabled: boolean, onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>
        <option value="">{empty}</option>
        {tags.map(tag => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
      </select>
    </label>
  )
}
