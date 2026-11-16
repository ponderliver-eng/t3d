import { ChevronDown, ChevronRight } from 'lucide-react'
import { useInspectorCardOpen } from '../editor/panels/inspectorMemory'
import { useEditorStore } from '../editor/scene/store'
import { useI18n } from '../editor/i18n'
import type { SceneNode, Vec3 } from '../editor/scene/types'
import { defaultInteract, defaultTrigger, defaultMover, defaultCheckpoint, defaultScore, type InteractSpec, type TriggerZoneSpec, type MoverSpec, type CheckpointSpec, type ScoreSpec } from './sceneRuntime'

export function InteractCard({ node, disabled }: { node: SceneNode, disabled: boolean }) {
  const { t } = useI18n()
  const [open, setOpen] = useInspectorCardOpen('interact')
  const tags = useEditorStore(state => state.tags)
  const spec = node.gameplay?.interact
  const view = { ...defaultInteract(), ...spec }
  const write = (patch: Partial<InteractSpec> | null) => {
    const store = useEditorStore.getState()
    if (!patch) {
      const gameplay = { ...node.gameplay }
      delete gameplay.interact
      store.updateNode(node.id, { gameplay: Object.keys(gameplay).length ? gameplay : null })
      return
    }
    store.updateNode(node.id, { gameplay: { ...node.gameplay, interact: { ...view, ...patch, enabled: true } } })
  }
  return (
    <section className="iv2-card iv2-card--wide">
      <header className="iv2-card__header" onClick={() => setOpen(!open)}>
        <span className="iv2-card__dot" style={{ background: '#e0a15a' }} />
        <span>{t('interact.title')}</span>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </header>
      {open && (
        <div className="iv2-card__body">
          <Check label={t('interact.enable')} disabled={disabled} checked={spec?.enabled === true} onChange={checked => write(checked ? { enabled: true } : null)} />
          {spec?.enabled && (
            <>
              <Text label={t('interact.prompt')} value={view.prompt} disabled={disabled} onChange={prompt => write({ prompt })} />
              <Text label={t('interact.key')} value={view.key} disabled={disabled} onChange={key => write({ key })} />
              <Num label={t('interact.radius')} value={view.radius} disabled={disabled} onChange={radius => write({ radius })} />
              <TagSelect label={t('interact.tag')} empty={t('interact.any')} value={view.filterTagId} tags={tags} disabled={disabled} onChange={filterTagId => write({ filterTagId })} />
              <Text label={t('interact.message')} value={view.message} disabled={disabled} onChange={message => write({ message })} />
              <Check label={t('interact.once')} disabled={disabled} checked={view.once} onChange={once => write({ once })} />
            </>
          )}
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
  const view = { ...defaultTrigger(), ...spec, filterTagId: spec?.filterTagId ?? '' }
  const write = (patch: Partial<TriggerZoneSpec> | null) => {
    const store = useEditorStore.getState()
    if (!patch) {
      const gameplay = { ...node.gameplay }
      delete gameplay.trigger
      store.updateNode(node.id, { gameplay: Object.keys(gameplay).length ? gameplay : null })
      return
    }
    store.updateNode(node.id, { gameplay: { ...node.gameplay, trigger: { ...view, ...patch, enabled: true } } })
  }
  return (
    <section className="iv2-card iv2-card--wide">
      <header className="iv2-card__header" onClick={() => setOpen(!open)}>
        <span className="iv2-card__dot" style={{ background: '#d27ba0' }} />
        <span>{t('trigger.title')}</span>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </header>
      {open && (
        <div className="iv2-card__body">
          <Check label={t('trigger.enable')} disabled={disabled} checked={spec?.enabled === true} onChange={checked => write(checked ? { enabled: true } : null)} />
          {spec?.enabled && (
            <>
              <Num label={t('trigger.radius')} value={view.radius} disabled={disabled} onChange={radius => write({ radius })} />
              <TagSelect label={t('trigger.tag')} empty={t('interact.any')} value={view.filterTagId} tags={tags} disabled={disabled} onChange={filterTagId => write({ filterTagId })} />
              <Text label={t('trigger.enter')} value={view.enterMessage} disabled={disabled} onChange={enterMessage => write({ enterMessage })} />
              <Text label={t('trigger.exit')} value={view.exitMessage} disabled={disabled} onChange={exitMessage => write({ exitMessage })} />
              <Check label={t('trigger.once')} disabled={disabled} checked={view.once} onChange={once => write({ once })} />
            </>
          )}
        </div>
      )}
    </section>
  )
}

export function MoverCard({ node, disabled }: { node: SceneNode, disabled: boolean }) {
  const { t } = useI18n()
  const [open, setOpen] = useInspectorCardOpen('mover')
  const spec = node.gameplay?.mover
  const view = { ...defaultMover(), ...spec }
  const write = (patch: Partial<MoverSpec> | null) => {
    const store = useEditorStore.getState()
    if (!patch) {
      const gameplay = { ...node.gameplay }
      delete gameplay.mover
      store.updateNode(node.id, { gameplay: Object.keys(gameplay).length ? gameplay : null })
      return
    }
    store.updateNode(node.id, { gameplay: { ...node.gameplay, mover: { ...view, ...patch, enabled: true } } })
  }
  return (
    <section className="iv2-card iv2-card--wide">
      <header className="iv2-card__header" onClick={() => setOpen(!open)}>
        <span className="iv2-card__dot" style={{ background: '#6ec4c4' }} />
        <span>{t('mover.title')}</span>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </header>
      {open && (
        <div className="iv2-card__body">
          <Check label={t('mover.enable')} disabled={disabled} checked={spec?.enabled === true} onChange={checked => write(checked ? { enabled: true } : null)} />
          {spec?.enabled && (
            <>
              <Vec3Field label={t('mover.offset')} value={view.offset} disabled={disabled} onChange={offset => write({ offset })} />
              <Num label={t('mover.duration')} value={view.duration} disabled={disabled} onChange={duration => write({ duration })} />
              <Num label={t('mover.pause')} value={view.pause} disabled={disabled} onChange={pause => write({ pause })} />
              <Num label={t('mover.carry')} value={view.carryRadius} disabled={disabled} onChange={carryRadius => write({ carryRadius })} />
              <Check label={t('mover.ping')} disabled={disabled} checked={view.pingPong} onChange={pingPong => write({ pingPong })} />
              <Check label={t('mover.auto')} disabled={disabled} checked={view.autoPlay} onChange={autoPlay => write({ autoPlay })} />
              {!view.autoPlay && <Text label={t('mover.message')} value={view.startMessage} disabled={disabled} onChange={startMessage => write({ startMessage })} />}
            </>
          )}
        </div>
      )}
    </section>
  )
}

export function CheckpointCard({ node, disabled }: { node: SceneNode, disabled: boolean }) {
  const { t } = useI18n()
  const [open, setOpen] = useInspectorCardOpen('checkpoint')
  const spec = node.gameplay?.checkpoint
  const view = { ...defaultCheckpoint(), ...spec }
  const write = (patch: Partial<CheckpointSpec> | null) => {
    const store = useEditorStore.getState()
    if (!patch) {
      const gameplay = { ...node.gameplay }
      delete gameplay.checkpoint
      store.updateNode(node.id, { gameplay: Object.keys(gameplay).length ? gameplay : null })
      return
    }
    store.updateNode(node.id, { gameplay: { ...node.gameplay, checkpoint: { ...view, ...patch, enabled: true } } })
  }
  return (
    <section className="iv2-card iv2-card--wide">
      <header className="iv2-card__header" onClick={() => setOpen(!open)}>
        <span className="iv2-card__dot" style={{ background: '#d4c15a' }} />
        <span>{t('checkpoint.title')}</span>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </header>
      {open && (
        <div className="iv2-card__body">
          <Check label={t('checkpoint.enable')} disabled={disabled} checked={spec?.enabled === true} onChange={checked => write(checked ? { enabled: true } : null)} />
          {spec?.enabled && (
            <>
              <Check label={t('checkpoint.spawn')} disabled={disabled} checked={view.spawn} onChange={spawn => write({ spawn })} />
              <Num label={t('checkpoint.radius')} value={view.radius} disabled={disabled} onChange={radius => write({ radius })} />
              <Num label={t('checkpoint.delay')} value={view.delay} disabled={disabled} onChange={delay => write({ delay })} />
              <Num label={t('checkpoint.abyss')} value={view.abyssY} disabled={disabled} onChange={abyssY => write({ abyssY })} />
              <Text label={t('checkpoint.message')} value={view.message} disabled={disabled} onChange={message => write({ message })} />
            </>
          )}
        </div>
      )}
    </section>
  )
}

export function ScoreCard({ node, disabled }: { node: SceneNode, disabled: boolean }) {
  const { t } = useI18n()
  const [open, setOpen] = useInspectorCardOpen('score')
  const spec = node.gameplay?.score
  const view = { ...defaultScore(), ...spec }
  const write = (patch: Partial<ScoreSpec> | null) => {
    const store = useEditorStore.getState()
    if (!patch) {
      const gameplay = { ...node.gameplay }
      delete gameplay.score
      store.updateNode(node.id, { gameplay: Object.keys(gameplay).length ? gameplay : null })
      return
    }
    store.updateNode(node.id, { gameplay: { ...node.gameplay, score: { ...view, ...patch, enabled: true } } })
  }
  return (
    <section className="iv2-card iv2-card--wide">
      <header className="iv2-card__header" onClick={() => setOpen(!open)}>
        <span className="iv2-card__dot" style={{ background: '#c48bdc' }} />
        <span>{t('score.title')}</span>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </header>
      {open && (
        <div className="iv2-card__body">
          <Check label={t('score.enable')} disabled={disabled} checked={spec?.enabled === true} onChange={checked => write(checked ? { enabled: true } : null)} />
          {spec?.enabled && (
            <>
              <p className="character-card__hint">{t('score.hint')}</p>
              <Text label={t('score.objective')} value={view.title} disabled={disabled} onChange={title => write({ title })} />
              <Num label={t('score.target')} value={view.target} disabled={disabled} onChange={target => write({ target })} />
              <Num label={t('score.interact')} value={view.perInteract} disabled={disabled} onChange={perInteract => write({ perInteract })} />
              <Num label={t('score.time')} value={view.timeLimit} disabled={disabled} onChange={timeLimit => write({ timeLimit })} />
            </>
          )}
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
