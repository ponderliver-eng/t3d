import { useMemo } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useAssetStore, type UiAsset } from '../assets/library'
import { translate, useI18n } from '../i18n'
import { useInspectorCardOpen } from '../panels/inspectorMemory'
import { useEditorStore } from '../scene/store'
import type { SceneNode } from '../scene/types'
import type { UiLayer } from '../../runtime/ui/spec'
import { defaultNodeScreen, UI_LAYERS } from '../../runtime/ui/spec'
import { collectUiBindings } from '../../runtime/ui/tree'
import { coerceUiValue } from '../../runtime/ui/bindings'
import { uiValues, useUiValues, writeUiComponent, writeUiVariable } from './runtimeStore'
import { openUiEditor } from './session'

export function ScreenCard({ node, locked, playing }: { node: SceneNode; locked: boolean; playing: boolean }) {
  const { t } = useI18n()
  const [open, setOpen] = useInspectorCardOpen('screen')
  const assets = useAssetStore(state => state.assets)
  const documents = useMemo(
    () => Object.values(assets).filter((asset): asset is UiAsset => asset.kind === 'ui'),
    [assets],
  )
  const values = useUiValues()
  const screen = node.screen ?? defaultNodeScreen()
  const document = screen.documentId ? documents.find(asset => asset.id === screen.documentId) : undefined
  const bindings = document && document.kind === 'ui' ? collectUiBindings(document.document.root) : []
  return (
    <section className="iv2-card">
      <header className="iv2-card__header" onClick={() => setOpen(!open)}>
        <span className="iv2-card__dot" style={{ background: '#4a9eff' }} />
        <span>{t('ui.document')}</span>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </header>
      {open && (
        <div className="iv2-card__body">
          <label className="field">
            <span>{t('ui.document')}</span>
            <select disabled={locked} value={screen.documentId ?? ''} onChange={event => commitScreen(node.id, { ...screen, documentId: event.target.value || null })}>
              <option value="">{t('picker.none')}</option>
              {documents.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
            </select>
          </label>
          {screen.documentId && !document && <p className="field">{t('ui.missing')}</p>}
          <label className="field">
            <span>{t('ui.layer')}</span>
            <select disabled={locked} value={screen.layer} onChange={event => commitScreen(node.id, { ...screen, layer: event.target.value as UiLayer })}>
              {UI_LAYERS.map(layer => <option key={layer} value={layer}>{t(`ui.layer.${layer}`)}</option>)}
            </select>
          </label>
          <label className="field">
            <span>{t('ui.visibleOnPlay')}</span>
            <input type="checkbox" disabled={locked} checked={screen.visibleOnPlay} onChange={event => commitScreen(node.id, { ...screen, visibleOnPlay: event.target.checked })} />
          </label>
          <button type="button" disabled={!screen.documentId} onClick={() => screen.documentId && openUiEditor(screen.documentId)}>{t('ui.open')}</button>
          {playing && bindings.map(item => {
            const source = item.binding.source
            const current = source.kind === 'variable'
              ? values.variables[source.varId]
              : values.components[source.nodeId]?.[source.field]
            return (
              <label key={item.binding.id} className="field">
                <span>{item.node.name || source.kind}</span>
                <input
                  defaultValue={current === undefined ? '' : String(current)}
                  key={`${item.binding.id}:${String(current ?? '')}`}
                  placeholder={source.kind === 'variable' ? source.varId : source.field}
                  onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }}
                  onBlur={event => {
                    if (event.target.value.trim() === '') return
                    const value = coerceUiValue(event.target.value)
                    if (source.kind === 'variable') writeUiVariable(source.varId, value)
                    else writeUiComponent(source.nodeId, source.field, value)
                  }}
                />
              </label>
            )
          })}
        </div>
      )}
    </section>
  )
}

function commitScreen(id: string, screen: SceneNode['screen']) {
  const store = useEditorStore.getState()
  store.beginGesture(translate('ui.mount'))
  store.updateNode(id, { screen })
  store.endGesture()
}

export function readPlayScreens(nodes: Record<string, SceneNode>) {
  const values = uiValues()
  return Object.values(nodes).flatMap(node => {
    if (node.kind !== 'screen' || !node.visible) return []
    const screen = node.screen
    if (!screen?.documentId) return []
    const shown = node.id in values.screens ? values.screens[node.id] : screen.visibleOnPlay
    if (!shown) return []
    const asset = useAssetStore.getState().assets[screen.documentId]
    if (!asset || asset.kind !== 'ui') return []
    return [{ nodeId: node.id, layer: screen.layer, root: asset.document.root }]
  })
}
