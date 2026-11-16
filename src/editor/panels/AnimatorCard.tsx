import { Star, Trash2 } from 'lucide-react'
import { activeAnimatorState, emptyAnimator, type AnimatorController, type AnimatorParam, type AnimatorTransition } from '../animation/animator'
import { clipNamesFor } from '../assets/models'
import { useI18n } from '../i18n'
import { useEditorStore } from '../scene/store'

export function AnimatorCard({ nodeId }: { nodeId: string }) {
  const { t } = useI18n()
  const node = useEditorStore(state => state.nodes[nodeId])
  if (!node || node.kind !== 'model') return null
  const animator = node.animator ?? emptyAnimator()
  const modelClips = clipNamesFor(node.assetId)
  const fileClips = clipNamesFor(node.clipAssetId)
  const clips = [...new Set([...modelClips, ...fileClips, ...animator.states.map(state => state.clip)].filter(Boolean))]
  const write = (next: AnimatorController) => useEditorStore.getState().updateNode(nodeId, { animator: next })
  const current = activeAnimatorState(animator)
  const patchState = (id: string, patch: Partial<AnimatorController['states'][number]>) => {
    write({ ...animator, states: animator.states.map(item => item.id === id ? { ...item, ...patch } : item) })
  }
  return (
    <div className="anim-machine anim-fields">
      <p className="anim-current">{t('anim.current', { name: current?.name || current?.clip || '—' })}</p>
      {animator.states.map(state => (
        <div key={state.id} className="anim-block">
          <div className="anim-state__head">
            <input value={state.name} onChange={event => patchState(state.id, { name: event.target.value })} />
            <button type="button" className={(animator.defaultStateId ?? animator.states[0]?.id) === state.id ? 'is-on' : ''} title={t('anim.setDefault')} aria-label={t('anim.setDefault')} onClick={() => write({ ...animator, defaultStateId: state.id })}><Star size={13} /></button>
            <button type="button" title={t('anim.remove')} aria-label={t('anim.remove')} onClick={() => {
              const states = animator.states.filter(item => item.id !== state.id)
              write({
                ...animator,
                states,
                stateId: animator.stateId === state.id ? states[0]?.id ?? '' : animator.stateId,
                defaultStateId: animator.defaultStateId === state.id ? states[0]?.id : animator.defaultStateId,
              })
            }}><Trash2 size={13} /></button>
          </div>
          <label className="field">
            <span>{t('inspector.clip')}</span>
            <select
              value={state.clip ? `${state.clipAssetId ? 'file' : 'model'}\u001f${state.clip}` : ''}
              onChange={event => {
                const value = event.target.value
                if (!value) {
                  patchState(state.id, { clip: '', clipAssetId: null })
                  return
                }
                const [source, name] = value.split('\u001f')
                patchState(state.id, { clip: name ?? '', clipAssetId: source === 'file' ? node.clipAssetId : null })
              }}
            >
              <option value="">{t('material.none')}</option>
              {modelClips.map(name => <option key={`model:${name}`} value={`model\u001f${name}`}>{name}</option>)}
              {fileClips.map(name => <option key={`file:${name}`} value={`file\u001f${name}`}>{name}</option>)}
            </select>
          </label>
          <label className="field">
            <span>{t('anim.speed')}</span>
            <input type="number" min={0.05} step={0.05} value={state.speed} onChange={event => patchState(state.id, { speed: Number(event.target.value) })} />
          </label>
          <label className="field">
            <span>{t('anim.mask')}</span>
            <select value={state.mask ?? 'full'} onChange={event => patchState(state.id, { mask: event.target.value as 'full' | 'upper' | 'lower' })}>
              <option value="full">{t('anim.maskFull')}</option>
              <option value="upper">{t('anim.maskUpper')}</option>
              <option value="lower">{t('anim.maskLower')}</option>
            </select>
          </label>
          <div className="anim-checks">
            <label className="field">
              <span>{t('anim.loop')}</span>
              <input type="checkbox" checked={state.loop} onChange={event => patchState(state.id, { loop: event.target.checked })} />
            </label>
            <label className="field">
              <span>{t('anim.inPlace')}</span>
              <input type="checkbox" checked={state.inPlace === true} onChange={event => patchState(state.id, { inPlace: event.target.checked })} />
            </label>
          </div>
        </div>
      ))}
      <div className="anim-tools">
        <button type="button" onClick={() => {
          const id = crypto.randomUUID()
          write({ ...animator, states: [...animator.states, { id, name: t('anim.state'), clip: '', clipAssetId: node.clipAssetId, loop: true, speed: 1, mask: 'full' }] })
        }}>{t('anim.addState')}</button>
        <button type="button" onClick={() => {
          const names = clips.filter(Boolean)
          if (names.length === 0) return
          const states = names.map(name => ({ id: crypto.randomUUID(), name, clip: name, clipAssetId: node.clipAssetId, loop: true, speed: 1, mask: 'full' as const }))
          write({ ...animator, states, stateId: states[0]!.id, defaultStateId: states[0]!.id })
        }}>{t('anim.fromClips')}</button>
        <button type="button" onClick={() => {
          const parameters = [...animator.parameters]
          if (!parameters.some(param => param.name === 'speed')) parameters.push({ id: crypto.randomUUID(), name: 'speed', type: 'number', value: 0 })
          if (!parameters.some(param => param.name === 'jump')) parameters.push({ id: crypto.randomUUID(), name: 'jump', type: 'trigger', value: false })
          write({ ...animator, parameters })
        }}>{t('anim.seedParams')}</button>
      </div>
      {animator.parameters.map(param => (
        <ParamRow key={param.id} param={param} onChange={next => write({ ...animator, parameters: animator.parameters.map(item => item.id === param.id ? next : item) })} onRemove={() => write({ ...animator, parameters: animator.parameters.filter(item => item.id !== param.id) })} />
      ))}
      <div className="anim-tools">
        <button type="button" onClick={() => write({
          ...animator,
          parameters: [...animator.parameters, { id: crypto.randomUUID(), name: t('anim.param'), type: 'bool', value: false }],
        })}>{t('anim.addParam')}</button>
        <button type="button" onClick={() => {
          const [from, to] = animator.states
          if (!from || !to) return
          const transition: AnimatorTransition = {
            id: crypto.randomUUID(),
            from: from.id,
            to: to.id,
            param: animator.parameters[0]?.name ?? '',
            mode: animator.parameters[0]?.type === 'trigger' ? 'triggered' : 'equals',
            value: animator.parameters[0]?.type === 'number' ? 0 : true,
            fade: 0.15,
          }
          write({ ...animator, transitions: [...animator.transitions, transition] })
        }}>{t('anim.addTransition')}</button>
      </div>
      {animator.transitions.map(transition => (
        <TransitionRow
          key={transition.id}
          transition={transition}
          states={animator.states.map(state => ({ id: state.id, name: state.name || state.clip }))}
          params={animator.parameters.map(param => ({ name: param.name, type: param.type }))}
          onChange={next => write({ ...animator, transitions: animator.transitions.map(item => item.id === transition.id ? next : item) })}
          onRemove={() => write({ ...animator, transitions: animator.transitions.filter(item => item.id !== transition.id) })}
        />
      ))}
    </div>
  )
}

function ParamRow({ param, onChange, onRemove }: { param: AnimatorParam, onChange: (param: AnimatorParam) => void, onRemove: () => void }) {
  const { t } = useI18n()
  return (
    <div className="anim-block">
      <div className="anim-state__head">
        <input value={param.name} onChange={event => onChange({ ...param, name: event.target.value })} />
        <button type="button" title={t('anim.remove')} aria-label={t('anim.remove')} onClick={onRemove}><Trash2 size={13} /></button>
      </div>
      <label className="field">
        <span>{t('anim.param')}</span>
        <select value={param.type} onChange={event => {
          const type = event.target.value as AnimatorParam['type']
          onChange({ ...param, type, value: type === 'number' ? 0 : false })
        }}>
          <option value="bool">{t('anim.bool')}</option>
          <option value="number">{t('anim.number')}</option>
          <option value="trigger">{t('anim.trigger')}</option>
        </select>
      </label>
      {param.type === 'bool' && (
        <label className="field">
          <span>{t('anim.bool')}</span>
          <input type="checkbox" checked={param.value === true} onChange={event => onChange({ ...param, value: event.target.checked })} />
        </label>
      )}
      {param.type === 'number' && (
        <label className="field">
          <span>{t('anim.number')}</span>
          <input type="number" value={Number(param.value) || 0} step={0.1} onChange={event => onChange({ ...param, value: Number(event.target.value) })} />
        </label>
      )}
      {param.type === 'trigger' && <button type="button" className="anim-tools__solo" onClick={() => onChange({ ...param, value: true })}>{t('anim.fire')}</button>}
    </div>
  )
}

function TransitionRow({
  transition, states, params, onChange, onRemove,
}: {
  transition: AnimatorTransition
  states: Array<{ id: string, name: string }>
  params: Array<{ name: string, type: AnimatorParam['type'] }>
  onChange: (transition: AnimatorTransition) => void
  onRemove: () => void
}) {
  const { t } = useI18n()
  return (
    <div className="anim-block">
      <div className="anim-state__head">
        <span>{t('anim.addTransition')}</span>
        <button type="button" title={t('anim.remove')} aria-label={t('anim.remove')} onClick={onRemove}><Trash2 size={13} /></button>
      </div>
      <label className="field">
        <span>{t('anim.state')}</span>
        <select value={transition.from} onChange={event => onChange({ ...transition, from: event.target.value })}>
          {states.map(state => <option key={state.id} value={state.id}>{state.name}</option>)}
        </select>
      </label>
      <label className="field">
        <span />
        <select value={transition.to} onChange={event => onChange({ ...transition, to: event.target.value })}>
          {states.map(state => <option key={state.id} value={state.id}>{state.name}</option>)}
        </select>
      </label>
      <label className="field">
        <span>{t('anim.param')}</span>
        <select value={transition.param} onChange={event => onChange({ ...transition, param: event.target.value })}>
          {params.map(param => <option key={param.name} value={param.name}>{param.name}</option>)}
        </select>
      </label>
      <label className="field">
        <span />
        <select value={transition.mode} onChange={event => onChange({ ...transition, mode: event.target.value as AnimatorTransition['mode'] })}>
          <option value="equals">{t('anim.equals')}</option>
          <option value="greater">{t('anim.greater')}</option>
          <option value="less">{t('anim.less')}</option>
          <option value="triggered">{t('anim.trigger')}</option>
        </select>
      </label>
      <label className="field">
        <span>{t('anim.exit')}</span>
        <input
          type="checkbox"
          checked={transition.exitTime !== undefined}
          onChange={event => onChange({ ...transition, exitTime: event.target.checked ? 0.9 : undefined })}
        />
      </label>
      {params.find(param => param.name === transition.param)?.type === 'bool' && transition.mode === 'equals' && (
        <label className="field">
          <span />
          <input type="checkbox" checked={transition.value === true} onChange={event => onChange({ ...transition, value: event.target.checked })} />
        </label>
      )}
      {params.find(param => param.name === transition.param)?.type === 'number' && transition.mode !== 'triggered' && (
        <label className="field">
          <span />
          <input type="number" step={0.1} value={typeof transition.value === 'number' ? transition.value : 0} onChange={event => onChange({ ...transition, value: Number(event.target.value) })} />
        </label>
      )}
      {transition.exitTime !== undefined && (
        <label className="field">
          <span>{t('anim.exit')}</span>
          <input type="number" min={0} max={1} step={0.05} value={transition.exitTime} onChange={event => onChange({ ...transition, exitTime: Number(event.target.value) })} />
        </label>
      )}
    </div>
  )
}
