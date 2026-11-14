import { useState } from 'react'
import { Layers, Pencil, Plus, Tag, X } from 'lucide-react'
import { useEditorStore } from '../scene/store'
import { useI18n } from '../i18n'
import { useTaxonomyUi } from '../project/taxonomyUi'
import '../project/taxonomy.css'
import { LAYER_ID_DEFAULT, sortedLayers, sortedTags } from '../project/taxonomy'
import type { SceneNode } from '../scene/types'

function pillColor(name: string): { bg: string, border: string, text: string } {
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
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const tagRows = sortedTags(tags)
  const layerRows = sortedLayers(layers)
  const names = new Map(tagRows.map(tag => [tag.id, tag.name]))
  const extras = node.tagIds ?? []
  const known = tagRows.some(tag => tag.id === node.tagId)
  const layerValue = node.renderLayerId || LAYER_ID_DEFAULT

  const addExtra = () => {
    const clean = draft.trim()
    if (!clean) return
    const store = useEditorStore.getState()
    let id = store.tags.find(tag => tag.name.toLowerCase() === clean.toLowerCase() || tag.id === clean)?.id
    if (!id) {
      id = `tag_${clean.replace(/[^a-zA-Z0-9_.-]/g, '_')}_${Date.now().toString(36)}`
      store.setTags([...store.tags, { id, name: clean }])
    }
    const current = useEditorStore.getState().nodes[node.id]
    const next = current?.tagIds ?? []
    if (!next.includes(id)) store.updateNode(node.id, { tagIds: [...next, id] })
    setDraft('')
    setAdding(false)
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
        <button type="button" title={t('tags.add')} disabled={disabled} onClick={() => setAdding(value => !value)}><Plus size={12} /></button>
        <button type="button" title={t('tags.title')} disabled={disabled} onClick={() => useTaxonomyUi.getState().openTags()}><Pencil size={12} /></button>
      </div>
      {(extras.length > 0 || adding) && (
        <div className="tag-pills" style={{ marginLeft: 18 }}>
          {extras.map(id => {
            const name = names.get(id) ?? id
            const color = pillColor(name)
            return (
              <span key={id} className="tag-pill" style={{ background: color.bg, borderColor: color.border, color: color.text }}>
                <span>{name}</span>
                {!disabled && (
                  <button type="button" title={t('tags.remove')} onClick={() => useEditorStore.getState().updateNode(node.id, { tagIds: extras.filter(item => item !== id) })}><X size={10} /></button>
                )}
              </span>
            )
          })}
        </div>
      )}
      {adding && !disabled && (
        <div className="identity-extra">
          <input
            type="text"
            autoFocus
            value={draft}
            placeholder={t('tags.extraPlaceholder')}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault()
                addExtra()
              }
              if (event.key === 'Escape') setAdding(false)
            }}
            onBlur={() => {
              if (!draft.trim()) setAdding(false)
            }}
          />
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
