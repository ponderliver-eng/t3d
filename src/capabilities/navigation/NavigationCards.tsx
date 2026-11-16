import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react'
import { useInspectorCardOpen } from '../../editor/panels/inspectorMemory'
import { capabilityEnabled } from '../registry'
import { openProjectSettings } from '../../editor/project/ProjectSettingsDialog'
import { useEditorStore } from '../../editor/scene/store'
import { useI18n } from '../../editor/i18n'
import type { NavRole, NavSettings, NodeNavigation, SceneNode } from '../../editor/scene/types'
import { navSettingsOf, navSignature } from './defaults'
import { cancelNavBake, clearNavMesh, requestNavBake, useNavUi } from './session'

export function NavigationCard({ node, disabled }: { node: SceneNode, disabled: boolean }) {
  const { t } = useI18n()
  const enabled = useEditorStore(state => capabilityEnabled(state.capabilities, 'navigation'))
  const [open, setOpen] = useInspectorCardOpen('navigation')
  const navigation = node.navigation
  if (!enabled || !navigation) return null
  const patch = (next: NodeNavigation | null) => {
    const store = useEditorStore.getState()
    store.beginGesture(t('navigation.title'))
    store.updateNode(node.id, { navigation: next })
    store.endGesture()
  }
  const edit = (partial: Partial<NodeNavigation>) => {
    patch({ ...navigation, ...partial })
  }
  return (
    <section className="iv2-card">
      <header className="iv2-card__header" onClick={() => setOpen(!open)}>
        <span className="iv2-card__dot" style={{ background: '#4fc3f7' }} />
        <span>{t('navigation.title')}</span>
        <span className="iv2-card__actions" onClick={event => event.stopPropagation()}>
          <button
            type="button"
            className="iv2-card__remove"
            title={t('component.remove')}
            disabled={disabled}
            onClick={() => patch(null)}
          >
            <Trash2 size={12} />
          </button>
        </span>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </header>
      {open && (
        <div className="iv2-card__body">
          <label className="field">
            <span>{t('navigation.role')}</span>
            <select disabled={disabled} value={navigation.role} onChange={event => edit({ role: event.target.value as NavRole })}>
              <option value="surface">{t('navigation.surface')}</option>
              <option value="obstacle">{t('navigation.obstacle')}</option>
            </select>
          </label>
          {navigation.role === 'obstacle' && (
            <>
              <NumberInput label={t('navigation.radius')} disabled={disabled} value={navigation.radius} step={0.05} min={0.05} onChange={radius => edit({ radius })} />
              <NumberInput label={t('navigation.height')} disabled={disabled} value={navigation.height} step={0.05} min={0.05} onChange={height => edit({ height })} />
            </>
          )}
        </div>
      )}
    </section>
  )
}

export function SceneNavigationCard() {
  const { t } = useI18n()
  const enabled = useEditorStore(state => capabilityEnabled(state.capabilities, 'navigation'))
  const picture = useEditorStore(state => state.picture)
  const playing = useEditorStore(state => state.playState !== 'stopped')
  const navMeshVisible = useEditorStore(state => state.navMeshVisible)
  const activeSceneId = useEditorStore(state => state.activeSceneId)
  const ui = useNavUi()
  const [open, setOpen] = useInspectorCardOpen('scene-navigation')
  const settings = navSettingsOf(picture.navigation)
  const bakedHere = ui.sceneId === activeSceneId && ui.signature !== ''
  const stale = bakedHere && ui.signature !== navSignature(settings)
  const setNav = (patch: Partial<NavSettings>) => {
    const store = useEditorStore.getState()
    store.setPicture({ navigation: { ...navSettingsOf(store.picture.navigation), ...patch } })
  }
  return (
    <section className="iv2-card">
      <header className="iv2-card__header" onClick={() => setOpen(!open)}>
        <span className="iv2-card__dot" style={{ background: '#4fc3f7' }} />
        <span>{t('navigation.title')}</span>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </header>
      {open && (
        <div className="iv2-card__body">
          {!enabled && (
            <>
              <p className="settings-note">{t('navigation.disabledHint')}</p>
              <button type="button" onClick={openProjectSettings}>{t('menu.projectSettings')}</button>
            </>
          )}
          {enabled && (
            <>
              <NumberInput label={t('navigation.cellSize')} value={settings.cellSize} step={0.05} min={0.05} gesture onChange={cellSize => setNav({ cellSize })} />
              <NumberInput label={t('navigation.cellHeight')} value={settings.cellHeight} step={0.05} min={0.05} gesture onChange={cellHeight => setNav({ cellHeight })} />
              <NumberInput label={t('navigation.slope')} value={settings.walkableSlopeAngle} step={1} min={0} max={89} gesture onChange={walkableSlopeAngle => setNav({ walkableSlopeAngle })} />
              <NumberInput label={t('navigation.agentRadius')} value={settings.agentRadius} step={0.05} min={0.05} gesture onChange={agentRadius => setNav({ agentRadius })} />
              <NumberInput label={t('navigation.agentHeight')} value={settings.agentHeight} step={0.05} min={0.2} gesture onChange={agentHeight => setNav({ agentHeight })} />
              <NumberInput label={t('navigation.maxObstacles')} value={settings.maxObstacles} step={1} min={0} max={128} gesture onChange={maxObstacles => setNav({ maxObstacles: Math.round(maxObstacles) })} />
              <p className="settings-note">{t('navigation.obstacleHint')}</p>
              <label className="field">
                <span>{t('navigation.show')}</span>
                <input type="checkbox" checked={navMeshVisible} onChange={event => useEditorStore.getState().setNavMeshVisible(event.target.checked)} />
              </label>
              <div className="inspector__resets">
                <button type="button" disabled={playing || ui.phase === 'baking'} onClick={requestNavBake}>{bakedHere ? t('navigation.rebake') : t('navigation.bake')}</button>
                {ui.phase === 'baking' ? (
                  <button type="button" onClick={cancelNavBake}>{t('navigation.cancel')}</button>
                ) : (
                  <button type="button" disabled={playing || !bakedHere} onClick={clearNavMesh}>{t('navigation.clear')}</button>
                )}
              </div>
              {ui.sceneId === activeSceneId && ui.text && (
                <p className="settings-note">
                  {ui.text}{ui.triangles > 0 ? ` · ${t('navigation.triangles')} ${ui.triangles}` : ''}
                </p>
              )}
              {stale && <p className="settings-note">{t('navigation.stale')}</p>}
            </>
          )}
        </div>
      )}
    </section>
  )
}

function NumberInput({
  label,
  value,
  step,
  min,
  max,
  disabled,
  gesture,
  onChange,
}: {
  label: string
  value: number
  step: number
  min?: number
  max?: number
  disabled?: boolean
  gesture?: boolean
  onChange: (value: number) => void
}) {
  const { t } = useI18n()
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        disabled={disabled}
        value={Number.isFinite(value) ? value : 0}
        step={step}
        min={min}
        max={max}
        onFocus={() => { if (gesture) useEditorStore.getState().beginGesture(t('gesture.picture')) }}
        onBlur={() => { if (gesture) useEditorStore.getState().endGesture() }}
        onChange={event => {
          const next = Number(event.target.value)
          if (Number.isFinite(next)) onChange(next)
        }}
      />
    </label>
  )
}
