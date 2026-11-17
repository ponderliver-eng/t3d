import { useEffect, useState } from 'react'
import { Layers, Pencil, Plus, Tag, X, Zap } from 'lucide-react'
import { useEditorStore } from '../scene/store'
import { useI18n } from '../i18n'
import { useTaxonomyUi } from '../project/taxonomyUi'
import { listRuntimeTags } from '../../gameplay/runtimeTags'
import { tableRows } from '../../gameplay/registry'
import '../project/taxonomy.css'
import { LAYER_ID_DEFAULT, sortedLayers, sortedTags } from '../project/taxonomy'
import type { SceneNode } from '../scene/types'

function pillColor(name: string, hex?: string): { bg: string, border: string, text: string } {
  if (hex && /^#[0-9a-fA-F]{6}$/.test(hex)) {
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    return { bg: `rgba(${r}, ${g}, ${b}, 0.16)`, border: `rgba(${r}, ${g}, ${b}, 0.45)`, text: hex }
  }
  const lower = name.toLowerCase()
  if (lower.startsWith('state.') || lower.startsWith('debuff.')) return { bg: 'rgba(245, 158, 11, 0.14)', border: 'rgba(245, 158, 11, 0.4)', text: '#fcd34d' }
  if (lower.startsWith('team.') || lower.startsWith('faction.')) return { bg: 'rgba(59, 130, 246, 0.15)', border: 'rgba(59, 130, 246, 0.42)', text: '#93c5fd' }
  if (lower.startsWith('buff.') || lower.startsWith('friendly.')) return { bg: 'rgba(16, 185, 129, 0.14)', border: 'rgba(16, 185, 129, 0.4)', text: '#6ee7b7' }
  if (lower.startsWith('action.') || lower.startsWith('ability.')) return { bg: 'rgba(168, 85, 247, 0.15)', border: 'rgba(168, 85, 247, 0.42)', text: '#d8b4fe' }
  return { bg: 'rgba(255, 255, 255, 0.06)', border: 'rgba(255, 255, 255, 0.16)', text: 'var(--text-secondary, #c5cad3)' }
}

export function TagLayerStrip({ node, disabled }: { node: SceneNode, disabled: boolean }) {
  const { t } = useI18n()
  const tags = useEditorStore(state => state.tags)
  const layers = useEditorStore(state => state.layers)
  const database = useEditorStore(state => state.gameDatabase)
  const playing = useEditorStore(state => state.playState === 'playing')
  const [draft, setDraft] = useState('')
  const [clock, setClock] = useState(0)
  const tagRows = sortedTags(tags)
  const layerRows = sortedLayers(layers)
  const names = new Map(tagRows.map(tag => [tag.id, tag.name]))
  const gameplayRows = tableRows(database, 'tags')
  const extras = node.tagIds ?? []
  const known = tagRows.some(tag => tag.id === node.tagId)
  const layerValue = node.renderLayerId || LAYER_ID_DEFAULT
  const runtime = playing ? listRuntimeTags(node.id) : []
  void clock

  useEffect(() => {
    if (!playing) return
    const timer = window.setInterval(() => setClock(value => value + 1), 200)
    return () => window.clearInterval(timer)
  }, [playing])

  const addGameplay = () => {
    const clean = draft.trim()
    if (!clean) return
    const row = gameplayRows.find(item => item.id === clean || item.name.toLowerCase() === clean.toLowerCase())
    const id = row?.id ?? clean
    if (!extras.includes(id)) useEditorStore.getState().updateNode(node.id, { tagIds: [...extras, id] })
    setDraft('')
  }

  return (
    <div className="identity-strip">
      <div className="identity-row">
        <Tag size={12} />
        <select
          disabled={disabled}
          aria-label={t('tags.card')}
          value={node.tagId ?? ''}
          onChange={event => useEditorStore.getState().updateNode(node.id, { tagId: event.target.value || null })}
        >
          {!known && node.tagId ? <option value={node.tagId}>{t('tags.orphan', { id: node.tagId })}</option> : null}
          <option value="">{t('tags.none')}</option>
          {tagRows.map(tag => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
        </select>
        <button type="button" title={t('tags.title')} disabled={disabled} onClick={() => useTaxonomyUi.getState().openTags()}><Pencil size={12} /></button>
      </div>
      {(extras.length > 0 || runtime.length > 0) && (
        <div className="tag-pills">
          {extras.map(id => {
            const row = gameplayRows.find(item => item.id === id)
            const label = row?.id ?? names.get(id) ?? id
            const color = pillColor(label, typeof row?.fields?.color === 'string' ? row.fields.color : undefined)
            return (
              <span key={id} className="tag-pill" title={row?.name ?? id} style={{ background: color.bg, borderColor: color.border, color: color.text }}>
                <span>{label}</span>
                {!disabled && (
                  <button type="button" title={t('tags.remove')} onClick={() => useEditorStore.getState().updateNode(node.id, { tagIds: extras.filter(item => item !== id) })}><X size={10} /></button>
                )}
              </span>
            )
          })}
          {runtime.map(item => {
            const row = gameplayRows.find(entry => entry.id === item.tag)
            const color = pillColor(item.tag, typeof row?.fields?.color === 'string' ? row.fields.color : undefined)
            return (
              <span key={`rt_${item.tag}`} className="tag-pill tag-pill--runtime" title={t('tags.runtime')} style={{ background: color.bg, borderColor: color.border, color: color.text }}>
                <Zap size={9} />
                <span>{item.tag}</span>
                {item.remaining !== null && <em>{item.remaining.toFixed(1)}s</em>}
              </span>
            )
          })}
        </div>
      )}
      {!disabled && (
        <div className="gameplay-tag-entry">
          <input
            type="text"
            value={draft}
            placeholder={t('tags.extraPlaceholder')}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault()
                addGameplay()
              }
            }}
          />
          {draft.trim() && (
            <button type="button" title={t('tags.addGameplay')} onClick={addGameplay}><Plus size={12} /></button>
          )}
        </div>
      )}
      <div className="identity-row">
        <Layers size={12} />
        <select
          disabled={disabled}
          aria-label={t('layers.card')}
          value={layerValue}
          onChange={event => useEditorStore.getState().updateNode(node.id, {
            renderLayerId: event.target.value === LAYER_ID_DEFAULT ? undefined : event.target.value,
          })}
        >
          {layerRows.map(layer => (
            <option key={layer.id} value={layer.id}>{layer.name}</option>
          ))}
        </select>
        <span className="identity-gap" />
        <button type="button" title={t('layers.title')} disabled={disabled} onClick={() => useTaxonomyUi.getState().openLayers()}><Pencil size={12} /></button>
      </div>
    </div>
  )
}
