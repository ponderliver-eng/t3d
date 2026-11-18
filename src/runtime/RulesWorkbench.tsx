import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Copy, Play, Plus, ShieldCheck, Trash2, X, Zap } from 'lucide-react'
import { useEditorStore } from '../editor/scene/store'
import { useI18n, type MessageKey } from '../editor/i18n'
import type { SceneNode } from '../editor/scene/types'
import { emptyRule, emptyStep, readRuleStates, readRules, type RuleEntry, type RuleStateNode, type RuleTriggerKind } from './sceneRuntime'
import { ruleTrace } from './rules'
import { KeyField } from '../editor/ui/KeyField'
import { ConditionEditor, StepList, TRIGGERS, addCondition, flattenStates } from './RulesSteps'
import { findPackTrigger, listEnabledPackTriggers } from '../gameplay/registry'
import { isCoreTrigger } from './sceneRuntime'
import { RulesStateTree } from './RulesStateTree'
import './RulesWorkbench.css'

export function whenText(rule: RuleEntry, t: (key: MessageKey, vars?: Record<string, string | number>) => string): string {
  const pack = isCoreTrigger(rule.trigger) ? undefined : findPackTrigger(rule.trigger, useEditorStore.getState().gameplayPacks)
  const name = isCoreTrigger(rule.trigger)
    ? t(`rule.trigger.${rule.trigger}` as MessageKey)
    : (pack?.def.label ?? rule.trigger)
  if (rule.trigger === 'key') return `${name} ${rule.key}`
  if (rule.trigger === 'message') return `${name} ${rule.message}`
  return name
}

export function RulesWorkbench({
  node,
  disabled,
  focusId,
  onClose,
}: {
  node: SceneNode
  disabled: boolean
  focusId?: string
  onClose: () => void
}) {
  const { t } = useI18n()
  const rules = readRules(node.gameplay?.rules)
  const states = readRuleStates(node.gameplay?.ruleStates)
  const enabledPacks = useEditorStore(state => state.gameplayPacks)
  const packTriggers = listEnabledPackTriggers(enabledPacks)
  const [selectedId, setSelectedId] = useState(focusId || rules[0]?.id || '')
  const [view, setView] = useState<'rules' | 'states'>('rules')
  const playing = useEditorStore(state => state.playState === 'playing')
  const [, setTick] = useState(0)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  useEffect(() => {
    if (!playing) return
    const timer = window.setInterval(() => setTick(value => value + 1), 160)
    return () => window.clearInterval(timer)
  }, [playing])
  const trace = playing ? ruleTrace(node.id) : null
  const active = rules.find(rule => rule.id === selectedId) ?? rules[0]
  const commitRules = (next: RuleEntry[]) => commit(node.id, { rules: next }, t('rule.title'))
  const commitStates = (next: RuleStateNode[]) => commit(node.id, { ruleStates: next }, t('rule.states'))
  const update = (id: string, patch: Partial<RuleEntry>) => commitRules(rules.map(rule => rule.id === id ? { ...rule, ...patch } : rule))
  const add = () => {
    const rule = { ...emptyRule(), name: `${t('rule.unnamed')} ${rules.length + 1}` }
    commitRules([...rules, rule])
    setSelectedId(rule.id)
    setView('rules')
  }
  const duplicate = (rule: RuleEntry) => {
    const copy = structuredClone(rule)
    copy.id = crypto.randomUUID()
    copy.name = `${rule.name || t('rule.unnamed')} 2`
    commitRules([...rules, copy])
    setSelectedId(copy.id)
  }
  const flat = flattenStates(states)
  return createPortal(
    <div className="rules-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <div className="rules-window" role="dialog" aria-modal="true" aria-label={t('rule.workbench')} onMouseDown={event => event.stopPropagation()}>
        <div className="rules-window__bar">
          <span className="rules-window__title"><Zap size={14} color="#f59e0b" /> {t('rule.workbench')} — {node.name}</span>
          <span>{t('rule.count', { count: rules.length })}</span>
          <button type="button" onClick={onClose} title={t('rule.done')}><X size={15} /></button>
        </div>
        <div className="rules-window__tools">
          <div>
            <button type="button" disabled={disabled} onClick={add}><Plus size={13} /> {t('rule.add')}</button>
            {active && <button type="button" disabled={disabled} onClick={() => duplicate(active)}><Copy size={12} /> {t('rule.duplicate')}</button>}
            <button type="button" className={`rules-tab${view === 'rules' ? ' is-on' : ''}`} onClick={() => setView('rules')}>{t('rule.rules')}</button>
            <button type="button" className={`rules-tab${view === 'states' ? ' is-on' : ''}`} onClick={() => setView('states')}>{t('rule.states')}</button>
          </div>
        </div>
        {view === 'states' ? (
          <RulesStateTree tree={states} disabled={disabled} liveStateId={trace?.stateId ?? ''} activeStepId={trace?.stepId ?? ''} onChange={commitStates} />
        ) : (
          <div className="rules-layout">
            <aside className="rules-side">
              <div className="rules-side__label">{t('rule.list')} ({rules.length})</div>
              {rules.map((rule, index) => (
                <div key={rule.id} className={`rules-pick${rule.id === active?.id ? ' is-on' : ''}`} onClick={() => setSelectedId(rule.id)}>
                  <input type="checkbox" checked={rule.enabled} disabled={disabled} onClick={event => event.stopPropagation()} onChange={event => update(rule.id, { enabled: event.target.checked })} />
                  <div className="rules-pick__main">
                    <span>{index + 1}. {rule.name || t('rule.unnamed')}</span>
                    <em>{whenText(rule, t)} · {rule.conditions.length} → {rule.steps.length}</em>
                  </div>
                  <button type="button" disabled={disabled} title={t('rule.remove')} onClick={event => {
                    event.stopPropagation()
                    const next = rules.filter(item => item.id !== rule.id)
                    commitRules(next)
                    if (selectedId === rule.id) setSelectedId(next[0]?.id ?? '')
                  }}><Trash2 size={12} /></button>
                </div>
              ))}
            </aside>
            <section className="rules-main">
              {!active ? <p className="rules-note">{t('rule.empty')}</p> : (
                <>
                  <div className="rules-grid">
                    <label className="rules-field">
                      <span>{t('rule.name')}</span>
                      <input disabled={disabled} value={active.name} placeholder={t('rule.unnamed')} onChange={event => update(active.id, { name: event.target.value })} />
                    </label>
                    <label className="rules-check">
                      <input type="checkbox" disabled={disabled} checked={active.enabled} onChange={event => update(active.id, { enabled: event.target.checked })} />
                      {t('rule.enabled')}
                    </label>
                  </div>
                  <div className="rules-card rules-card--when">
                    <strong style={{ color: '#f59e0b' }}><Zap size={14} /> {t('rule.when')}</strong>
                    <div className="rules-grid">
                      <label className="rules-field">
                        <span>{t('rule.triggerKind')}</span>
                        <select disabled={disabled} value={active.trigger} onChange={event => update(active.id, { trigger: event.target.value as RuleTriggerKind })}>
                          {TRIGGERS.map(item => <option key={item} value={item}>{t(`rule.trigger.${item}`)}</option>)}
                          {packTriggers.map(item => <option key={item.def.kind} value={item.def.kind}>{item.def.label}</option>)}
                          {!isCoreTrigger(active.trigger) && !findPackTrigger(active.trigger, enabledPacks)?.enabled && (
                            <option value={active.trigger}>{t('rule.packMissing', { kind: findPackTrigger(active.trigger, enabledPacks)?.def.label ?? active.trigger })}</option>
                          )}
                        </select>
                      </label>
                      {active.trigger === 'key' && (
                        <label className="rules-field">
                          <span>{t('rule.key')}</span>
                          <KeyField value={active.key} disabled={disabled} onChange={key => update(active.id, { key })} />
                        </label>
                      )}
                      {active.trigger === 'message' && (
                        <label className="rules-field">
                          <span>{t('rule.message')}</span>
                          <input disabled={disabled} value={active.message} onChange={event => update(active.id, { message: event.target.value })} />
                        </label>
                      )}
                    </div>
                  </div>
                  <div className="rules-card rules-card--if">
                    <div className="rules-card__head">
                      <strong style={{ color: '#60a5fa' }}><ShieldCheck size={14} /> {t('rule.ifTitle')} · {active.conditions.length}</strong>
                      <button type="button" disabled={disabled} onClick={() => update(active.id, { conditions: [...active.conditions, addCondition()] })}><Plus size={12} /> {t('rule.addCond')}</button>
                    </div>
                    {active.conditions.length === 0 ? <span className="rules-step__mute">{t('rule.noCond')}</span> : (
                      <ConditionEditor conditions={active.conditions} disabled={disabled} onChange={conditions => update(active.id, { conditions })} />
                    )}
                  </div>
                  <div className="rules-card rules-card--do">
                    <div className="rules-card__head">
                      <strong style={{ color: '#34d399' }}><Play size={14} /> {t('rule.doTitle')} · {active.steps.length}</strong>
                      <button type="button" disabled={disabled} onClick={() => update(active.id, { steps: [...active.steps, emptyStep('message')] })}><Plus size={12} /> {t('rule.addStep')}</button>
                    </div>
                    {active.steps.length === 0 ? <span className="rules-step__mute">{t('rule.noStep')}</span> : (
                      <StepList steps={active.steps} disabled={disabled} activeId={trace?.ruleId === active.id ? trace.stepId : ''} states={flat} onChange={steps => update(active.id, { steps })} />
                    )}
                  </div>
                  {trace?.stepId ? <div className="rules-live">{trace.waiting ? t('rule.waiting') : t('rule.live')}{trace.value !== null ? ` · ${trace.value}` : ''}</div> : null}
                </>
              )}
            </section>
          </div>
        )}
        <div className="rules-window__foot">
          <span>{t('rule.footer')}</span>
          <button type="button" onClick={onClose}><Check size={12} /> {t('rule.done')}</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function commit(nodeId: string, patch: { rules?: RuleEntry[], ruleStates?: RuleStateNode[] }, label: string) {
  const store = useEditorStore.getState()
  const node = store.nodes[nodeId]
  if (!node) return
  store.beginGesture(label)
  store.updateNode(nodeId, { gameplay: { ...node.gameplay, ...patch } })
  store.endGesture()
}
