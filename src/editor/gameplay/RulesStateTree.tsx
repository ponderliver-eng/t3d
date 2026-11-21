import { useState } from 'react'
import { Circle, GitBranch, Plus, Trash2 } from 'lucide-react'
import { useI18n } from '../i18n'
import { emptyRuleState, emptyStep, type RuleStateNode } from '../../runtime/sceneRuntime'
import { ConditionEditor, StepList, addCondition, flattenStates } from './RulesSteps'

const LANES = ['onEnter', 'onTick', 'onExit'] as const

export function RulesStateTree({
  tree,
  disabled,
  liveStateId,
  activeStepId,
  onChange,
}: {
  tree: RuleStateNode[]
  disabled: boolean
  liveStateId: string
  activeStepId: string
  onChange: (next: RuleStateNode[]) => void
}) {
  const { t } = useI18n()
  const rows = flattenStates(tree)
  const [selectedId, setSelectedId] = useState(rows[0]?.id ?? '')
  const [lane, setLane] = useState<(typeof LANES)[number]>('onEnter')
  const selected = findState(tree, selectedId) ?? findState(tree, rows[0]?.id ?? '')
  const update = (id: string, patch: Partial<RuleStateNode>) => onChange(mapStates(tree, id, node => ({ ...node, ...patch })))
  const addRoot = () => {
    const node = emptyRuleState(t('rule.unnamed'))
    onChange([...tree, node])
    setSelectedId(node.id)
  }
  return (
    <div className="rules-layout">
      <aside className="rules-side">
        <div className="rules-card__head">
          <strong>{t('rule.states')} {rows.length}</strong>
          <button type="button" disabled={disabled} onClick={addRoot}><Plus size={12} /> {t('rule.addState')}</button>
        </div>
        {rows.length === 0 ? <p className="rules-note">{t('rule.noState')}</p> : rows.map(row => {
          const node = findState(tree, row.id)
          const kids = node?.children.length ?? 0
          return (
            <div key={row.id} className="rules-state" style={{ paddingLeft: row.depth * 12 }}>
              <button type="button" className={`rules-state__node${selected?.id === row.id ? ' is-on' : ''}${liveStateId === row.id ? ' is-live' : ''}`} onClick={() => setSelectedId(row.id)}>
                {kids > 0 ? <GitBranch size={13} /> : <Circle size={8} />}
                <span className="rules-state__name">{node?.name || t('rule.unnamed')}</span>
              </button>
              <button type="button" disabled={disabled} title={t('rule.addChildState')} onClick={() => {
                const child = emptyRuleState(t('rule.unnamed'))
                update(row.id, { children: [...(node?.children ?? []), child] })
                setSelectedId(child.id)
              }}><Plus size={12} /></button>
              <button type="button" disabled={disabled} title={t('rule.remove')} onClick={() => onChange(dropState(tree, row.id))}><Trash2 size={12} /></button>
            </div>
          )
        })}
      </aside>
      <section className="rules-main">
        {!selected ? (
          <div className="rules-card">
            <p className="rules-note">{t('rule.noState')}</p>
            <button type="button" disabled={disabled} onClick={addRoot}><Plus size={12} /> {t('rule.addState')}</button>
          </div>
        ) : (
          <>
            <p className="rules-note">{pathOf(tree, selected.id).join(' / ')}</p>
            <label className="rules-field">
              <span>{t('rule.stateName')}</span>
              <input disabled={disabled} value={selected.name} onChange={event => update(selected.id, { name: event.target.value })} />
            </label>
            <div className="rules-card rules-card--if">
              <div className="rules-card__head">
                <strong>{t('rule.enterCond')}</strong>
                <button type="button" disabled={disabled} onClick={() => update(selected.id, { enter: [...selected.enter, addCondition()] })}><Plus size={12} /> {t('rule.addCond')}</button>
              </div>
              <p className="rules-note">{t('rule.enterHint')}</p>
              <ConditionEditor conditions={selected.enter} disabled={disabled} onChange={enter => update(selected.id, { enter })} />
            </div>
            <div className="rules-card rules-card--if">
              <strong>{t('rule.jump')}</strong>
              {selected.transitions.length === 0 ? <span className="rules-step__mute">{t('rule.noJump')}</span> : null}
              {selected.transitions.map(jump => (
                <div key={jump.id} className="rules-step">
                  <span className="rules-step__num" />
                  <select disabled={disabled} value={jump.targetId} onChange={event => update(selected.id, { transitions: selected.transitions.map(item => item.id === jump.id ? { ...item, targetId: event.target.value } : item) })}>
                    <option value="">{t('rule.pickState')}</option>
                    {rows.filter(row => row.id !== selected.id).map(row => <option key={row.id} value={row.id}>{`${'· '.repeat(row.depth)}${row.name || t('rule.unnamed')}`}</option>)}
                  </select>
                  <span />
                  <button type="button" disabled={disabled} title={t('rule.remove')} onClick={() => update(selected.id, { transitions: selected.transitions.filter(item => item.id !== jump.id) })}><Trash2 size={12} /></button>
                </div>
              ))}
              {selected.transitions.map(jump => (
                <ConditionEditor key={`${jump.id}-cond`} conditions={jump.conditions} disabled={disabled} onChange={conditions => update(selected.id, { transitions: selected.transitions.map(item => item.id === jump.id ? { ...item, conditions } : item) })} />
              ))}
              <button type="button" disabled={disabled || rows.length < 2} onClick={() => update(selected.id, { transitions: [...selected.transitions, { id: crypto.randomUUID(), targetId: rows.find(row => row.id !== selected.id)?.id ?? '', conditions: [addCondition()] }] })}>{t('rule.addJump')}</button>
            </div>
            <div className="rules-card rules-card--do">
              <div className="rules-lanes">
                {LANES.map(key => (
                  <button key={key} type="button" className={lane === key ? 'is-on' : ''} onClick={() => setLane(key)}>
                    {t(key === 'onEnter' ? 'rule.lane.enter' : key === 'onTick' ? 'rule.lane.tick' : 'rule.lane.exit')} {selected[key].length}
                  </button>
                ))}
              </div>
              <p className="rules-note">{t(lane === 'onEnter' ? 'rule.lane.enterHint' : lane === 'onTick' ? 'rule.lane.tickHint' : 'rule.lane.exitHint')}</p>
              <StepList steps={selected[lane]} disabled={disabled} activeId={activeStepId} states={rows} onChange={steps => update(selected.id, { [lane]: steps })} />
              {selected[lane].length === 0 ? <span className="rules-step__mute">{t('rule.noStep')}</span> : null}
              <button type="button" disabled={disabled} onClick={() => update(selected.id, { [lane]: [...selected[lane], emptyStep('message')] })}><Plus size={12} /> {t('rule.addStep')}</button>
            </div>
          </>
        )}
      </section>
    </div>
  )
}

function findState(nodes: RuleStateNode[], id: string): RuleStateNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node
    const child = findState(node.children, id)
    if (child) return child
  }
  return undefined
}

function mapStates(nodes: RuleStateNode[], id: string, patch: (node: RuleStateNode) => RuleStateNode): RuleStateNode[] {
  return nodes.map(node => node.id === id ? patch(node) : { ...node, children: mapStates(node.children, id, patch) })
}

function dropState(nodes: RuleStateNode[], id: string): RuleStateNode[] {
  return nodes.filter(node => node.id !== id).map(node => ({ ...node, children: dropState(node.children, id) }))
}

function pathOf(nodes: RuleStateNode[], id: string, trail: string[] = []): string[] {
  for (const node of nodes) {
    const next = [...trail, node.name || '']
    if (node.id === id) return next
    const child = pathOf(node.children, id, next)
    if (child.length) return child
  }
  return []
}
