import { Plus, Trash2 } from 'lucide-react'
import { useI18n, type MessageKey } from '../editor/i18n'
import { ClipField } from '../editor/panels/ClipPicker'
import { JuiceField, NodeField, PrefabField, TagField } from './RulePickers'
import {
  emptyCondition,
  emptyStep,
  type RuleCondition,
  type RuleCondKind,
  type RuleStateNode,
  type RuleStep,
  type RuleStepKind,
} from './sceneRuntime'

export const TRIGGERS = ['playStart', 'interact', 'key', 'message', 'enter', 'exit', 'hit'] as const
export const CONDS: RuleCondKind[] = ['always', 'hasTag', 'missingTag', 'compare', 'formula']
export const STEP_KINDS: RuleStepKind[] = [
  'message', 'setVar', 'addTag', 'removeTag', 'wait', 'waitFrame', 'waitUpper', 'waitMark',
  'playClip', 'playUpper', 'stance',
  'if', 'gather', 'each', 'switchState',
  'showUi', 'hideUi', 'lock', 'camera', 'moveTo', 'spawn', 'hide', 'score', 'juice', 'log',
]
export const OPS = ['==', '!=', '>', '<', '>=', '<=']
const NEST = 3

const TONE: Record<RuleStepKind, string> = {
  message: '#60a5fa',
  setVar: '#a78bfa',
  addTag: '#34d399',
  removeTag: '#f87171',
  wait: '#fbbf24',
  waitFrame: '#fbbf24',
  waitUpper: '#fbbf24',
  waitMark: '#fbbf24',
  playClip: '#f2cf7f',
  playUpper: '#f2cf7f',
  stance: '#e7c56a',
  if: '#3b82f6',
  gather: '#22d3ee',
  each: '#22d3ee',
  switchState: '#fb923c',
  showUi: '#38bdf8',
  hideUi: '#38bdf8',
  lock: '#f472b6',
  camera: '#818cf8',
  moveTo: '#4ade80',
  spawn: '#c084fc',
  hide: '#f87171',
  score: '#facc15',
  juice: '#fb7185',
  log: '#94a3b8',
}

export function ConditionEditor({
  conditions,
  disabled,
  onChange,
}: {
  conditions: RuleCondition[]
  disabled: boolean
  onChange: (next: RuleCondition[]) => void
}) {
  const { t } = useI18n()
  const patch = (id: string, partial: Partial<RuleCondition>) => onChange(conditions.map(item => item.id === id ? { ...item, ...partial } : item))
  return (
    <div className="rules-steps">
      {conditions.map((cond, index) => (
        <div key={cond.id} className="rules-step">
          <span className="rules-step__num">{index + 1}</span>
          <select disabled={disabled} value={cond.kind} onChange={event => patch(cond.id, { kind: event.target.value as RuleCondKind })}>
            {CONDS.map(item => <option key={item} value={item}>{t(`rule.cond.${item}`)}</option>)}
          </select>
          {cond.kind === 'hasTag' || cond.kind === 'missingTag' ? (
            <TagField value={cond.tag} disabled={disabled} onChange={tag => patch(cond.id, { tag })} />
          ) : cond.kind === 'compare' ? (
            <span className="rules-step__compare">
              <input disabled={disabled} value={cond.left} placeholder={t('rule.left')} onChange={event => patch(cond.id, { left: event.target.value })} />
              <select disabled={disabled} value={cond.op} onChange={event => patch(cond.id, { op: event.target.value })}>
                {OPS.map(op => <option key={op} value={op}>{op}</option>)}
              </select>
              <input disabled={disabled} value={cond.right} placeholder={t('rule.right')} onChange={event => patch(cond.id, { right: event.target.value })} />
            </span>
          ) : cond.kind === 'formula' ? (
            <input disabled={disabled} value={cond.left} placeholder={t('rule.formula')} onChange={event => patch(cond.id, { left: event.target.value })} />
          ) : <span className="rules-step__mute">{t('rule.alwaysPass')}</span>}
          <button type="button" disabled={disabled} title={t('rule.remove')} onClick={() => onChange(conditions.filter(item => item.id !== cond.id))}><Trash2 size={12} /></button>
        </div>
      ))}
    </div>
  )
}

export function StepList({
  steps,
  disabled,
  depth = 0,
  activeId,
  states,
  onChange,
}: {
  steps: RuleStep[]
  disabled: boolean
  depth?: number
  activeId?: string
  states: { id: string, name: string, depth: number }[]
  onChange: (next: RuleStep[]) => void
}) {
  const { t } = useI18n()
  const patch = (index: number, partial: Partial<RuleStep>) => onChange(steps.map((step, item) => item === index ? { ...step, ...partial } : step))
  return (
    <div className="rules-steps" style={{ marginLeft: depth * 14 }}>
      {steps.map((step, index) => (
        <div key={step.id} className="rules-step-wrap">
          <div className={`rules-step${activeId === step.id ? ' is-live' : ''}`} style={{ borderLeftColor: TONE[step.do] }}>
            <span className="rules-step__num">{index + 1}</span>
            <select disabled={disabled} value={step.do} onChange={event => patch(index, freshKind(step, event.target.value as RuleStepKind))}>
              {STEP_KINDS.map(item => <option key={item} value={item}>{t(`rule.step.${item}` as MessageKey)}</option>)}
            </select>
            <StepFields step={step} disabled={disabled} states={states} onChange={partial => patch(index, partial)} />
            <button type="button" disabled={disabled} title={t('rule.remove')} onClick={() => onChange(steps.filter((_, item) => item !== index))}><Trash2 size={12} /></button>
          </div>
          {(step.do === 'if' || step.do === 'each') && (
            <div className="rules-step__nest">
              {depth < NEST ? (
                <>
                  {step.do === 'if' && <ConditionEditor conditions={step.conditions} disabled={disabled} onChange={conditions => patch(index, { conditions })} />}
                  <StepList steps={step.steps} disabled={disabled} depth={depth + 1} activeId={activeId} states={states} onChange={children => patch(index, { steps: children })} />
                  <button type="button" className="rules-text-btn" disabled={disabled} onClick={() => patch(index, { steps: [...step.steps, emptyStep('message')] })}>
                    <Plus size={12} /> {t('rule.addChild')}
                  </button>
                </>
              ) : <span className="rules-step__mute">{t('rule.limit')}</span>}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function StepFields({
  step,
  disabled,
  states,
  onChange,
}: {
  step: RuleStep
  disabled: boolean
  states: { id: string, name: string, depth: number }[]
  onChange: (patch: Partial<RuleStep>) => void
}) {
  const { t } = useI18n()
  if (step.do === 'message') return <input disabled={disabled} value={step.message} placeholder={t('rule.message')} onChange={event => onChange({ message: event.target.value })} />
  if (step.do === 'setVar') {
    return (
      <span className="rules-step__compare">
        <input disabled={disabled} value={step.name} placeholder={t('rule.var')} onChange={event => onChange({ name: event.target.value })} />
        <input disabled={disabled} value={step.value} placeholder={t('rule.value')} onChange={event => onChange({ value: event.target.value })} />
      </span>
    )
  }
  if (step.do === 'addTag') {
    return (
      <span className="rules-step__compare rules-step__compare--tag">
        <TagField value={step.tag} disabled={disabled} onChange={tag => onChange({ tag })} />
        <input disabled={disabled} type="number" min={0} step={0.1} value={step.seconds} title={t('rule.seconds')} onChange={event => onChange({ seconds: Number(event.target.value) })} />
      </span>
    )
  }
  if (step.do === 'removeTag') return <TagField value={step.tag} disabled={disabled} onChange={tag => onChange({ tag })} />
  if (step.do === 'wait') return <input disabled={disabled} value={step.value || String(step.seconds)} title={t('rule.seconds')} placeholder={t('rule.seconds')} onChange={event => onChange({ value: event.target.value, seconds: Number(event.target.value) || 0 })} />
  if (step.do === 'waitFrame' || step.do === 'waitUpper' || step.do === 'hide') return <span className="rules-step__mute">{t(`rule.step.${step.do}`)}</span>
  if (step.do === 'waitMark') return <input disabled={disabled} value={step.value} placeholder="0-1" title={t('rule.mark')} onChange={event => onChange({ value: event.target.value })} />
  if (step.do === 'playClip' || step.do === 'playUpper' || step.do === 'stance') {
    return (
      <ClipField
        assetId={step.clipAssetId}
        name={step.clip}
        disabled={disabled}
        onChange={next => onChange({ clip: next?.name ?? '', clipAssetId: next?.assetId ?? '' })}
      />
    )
  }
  if (step.do === 'showUi' || step.do === 'hideUi') {
    return <NodeField value={step.name} kinds={['screen']} title={t('rule.pickScreen')} disabled={disabled} onChange={name => onChange({ name })} />
  }
  if (step.do === 'camera') {
    return <NodeField value={step.name} kinds={['camera']} title={t('rule.pickCamera')} disabled={disabled} onChange={name => onChange({ name })} />
  }
  if (step.do === 'lock') {
    return <NodeField value={step.name} title={t('rule.pickNode')} disabled={disabled} onChange={name => onChange({ name })} />
  }
  if (step.do === 'moveTo') {
    return (
      <span className="rules-step__compare rules-step__compare--pick">
        <NodeField value={step.name} title={t('rule.pickNode')} disabled={disabled} onChange={name => onChange({ name })} />
        <input disabled={disabled} value={step.value} placeholder="x,y,z" onChange={event => onChange({ value: event.target.value })} />
      </span>
    )
  }
  if (step.do === 'spawn') {
    return (
      <span className="rules-step__compare rules-step__compare--pick">
        <PrefabField value={step.name} disabled={disabled} onChange={name => onChange({ name })} />
        <input disabled={disabled} value={step.value} placeholder={t('rule.offset')} onChange={event => onChange({ value: event.target.value })} />
      </span>
    )
  }
  if (step.do === 'score') return <input disabled={disabled} value={step.value} placeholder={t('rule.amount')} onChange={event => onChange({ value: event.target.value })} />
  if (step.do === 'juice') return <JuiceField value={step.name} disabled={disabled} onChange={name => onChange({ name })} />
  if (step.do === 'gather') {
    return (
      <span className="rules-step__compare">
        <input disabled={disabled} type="number" min={0.1} step={0.1} value={step.seconds || 3} title={t('rule.radius')} onChange={event => onChange({ seconds: Number(event.target.value) })} />
        <TagField value={step.tag} disabled={disabled} onChange={tag => onChange({ tag })} />
        <input disabled={disabled} value={step.value} placeholder={t('rule.angle')} onChange={event => onChange({ value: event.target.value })} />
      </span>
    )
  }
  if (step.do === 'each') return <span className="rules-step__mute">{t('rule.step.each')}</span>
  if (step.do === 'log') {
    return (
      <span className="rules-step__compare rules-step__compare--log">
        <select disabled={disabled} value={step.level} onChange={event => onChange({ level: event.target.value as RuleStep['level'] })}>
          <option value="info">{t('console.info')}</option>
          <option value="warn">{t('console.warn')}</option>
          <option value="error">{t('console.error')}</option>
        </select>
        <input disabled={disabled} value={step.message} placeholder={t('rule.logText')} onChange={event => onChange({ message: event.target.value })} />
      </span>
    )
  }
  if (step.do === 'switchState') {
    return (
      <select disabled={disabled} value={step.stateId} onChange={event => onChange({ stateId: event.target.value })}>
        <option value="">{t('rule.pickState')}</option>
        {states.map(item => <option key={item.id} value={item.id}>{`${'· '.repeat(item.depth)}${item.name || t('rule.unnamed')}`}</option>)}
      </select>
    )
  }
  return <span className="rules-step__mute">{t('rule.cond')}</span>
}

function freshKind(step: RuleStep, kind: RuleStepKind): Partial<RuleStep> {
  const next = emptyStep(kind)
  return { ...next, id: step.id }
}

export function flattenStates(nodes: RuleStateNode[], depth = 0): { id: string, name: string, depth: number }[] {
  return nodes.flatMap(node => [{ id: node.id, name: node.name, depth }, ...flattenStates(node.children, depth + 1)])
}

export function addCondition(): RuleCondition {
  return emptyCondition('hasTag')
}
