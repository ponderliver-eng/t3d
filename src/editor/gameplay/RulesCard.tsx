import { useState } from 'react'
import { ChevronDown, ChevronRight, ExternalLink, Plus, Trash2, Zap } from 'lucide-react'
import { useInspectorCardOpen } from '../panels/inspectorMemory'
import { useEditorStore } from '../scene/store'
import { useI18n } from '../i18n'
import type { SceneNode } from '../scene/types'
import { emptyRule, readRules, type RuleEntry } from '../../runtime/sceneRuntime'
import { RulesWorkbench, whenText } from './RulesWorkbench'
import './RulesWorkbench.css'

export function RulesCard({ node, disabled }: { node: SceneNode, disabled: boolean }) {
  const { t } = useI18n()
  const [open, setOpen] = useInspectorCardOpen('rules')
  const [workbench, setWorkbench] = useState<string | null>(null)
  const rules = node.gameplay?.rules
  if (!rules) return null
  const view = readRules(rules)
  const write = (next: RuleEntry[] | null) => {
    const store = useEditorStore.getState()
    store.beginGesture(t('rule.title'))
    const gameplay = { ...node.gameplay }
    if (!next) {
      delete gameplay.rules
      delete gameplay.ruleStates
    } else gameplay.rules = next
    store.updateNode(node.id, { gameplay: Object.keys(gameplay).length ? gameplay : null })
    store.endGesture()
  }
  const openAt = (id?: string) => setWorkbench(id ?? view[0]?.id ?? '')
  return (
    <section className="iv2-card iv2-card--wide">
      <header className="iv2-card__header" onClick={() => setOpen(!open)}>
        <span className="iv2-card__dot" style={{ background: '#f0c674' }} />
        <span>{t('rule.title')}</span>
        <span className="iv2-card__actions" onClick={event => event.stopPropagation()}>
          <button type="button" className="iv2-card__remove" title={t('component.remove')} disabled={disabled} onClick={() => write(null)}>
            <Trash2 size={12} />
          </button>
        </span>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </header>
      {open && (
        <div className="iv2-card__body">
          <button type="button" className="rules-open" onClick={() => openAt()}>
            <ExternalLink size={12} />
            {t('rule.open', { count: view.length })}
          </button>
          <p className="rules-note">{t('rule.note')}</p>
          {view.map((rule, index) => (
            <div key={rule.id} className="rules-row" onClick={() => openAt(rule.id)}>
              <input
                type="checkbox"
                checked={rule.enabled}
                disabled={disabled}
                onClick={event => event.stopPropagation()}
                onChange={event => write(view.map(item => item.id === rule.id ? { ...item, enabled: event.target.checked } : item))}
              />
              <div className="rules-row__main">
                <div className="rules-row__name">
                  <Zap size={11} color="#f59e0b" />
                  <span>{index + 1}. {rule.name || t('rule.unnamed')}</span>
                </div>
                <span className="rules-row__sub">{whenText(rule, t)} · {rule.conditions.length} → {rule.steps.length}</span>
              </div>
              <button type="button" title={t('rule.remove')} disabled={disabled} onClick={event => { event.stopPropagation(); write(view.filter(item => item.id !== rule.id)) }}><Trash2 size={12} /></button>
            </div>
          ))}
          <button type="button" disabled={disabled} onClick={() => {
            const rule = { ...emptyRule(), name: `${t('rule.unnamed')} ${view.length + 1}` }
            write([...view, rule])
            setWorkbench(rule.id)
          }}><Plus size={12} /> {t('rule.add')}</button>
          {workbench !== null && <RulesWorkbench node={node} disabled={disabled} focusId={workbench} onClose={() => setWorkbench(null)} />}
        </div>
      )}
    </section>
  )
}
