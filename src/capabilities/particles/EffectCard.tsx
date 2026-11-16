import { ChevronDown, ChevronRight } from 'lucide-react'
import { useInspectorCardOpen } from '../../editor/panels/inspectorMemory'
import { useAssetStore } from '../../editor/assets/library'
import { capabilityEnabled } from '../registry'
import { QUARKS_VERSION } from './defaults'
import { effectVersion, particleIssue } from './session'
import { saveEffectFromNode } from './effectAsset'
import { EffectModules, MaterialDrop, commitSimulation, createParticleMaterial } from './EffectModules'
import { useEditorStore } from '../../editor/scene/store'
import { useI18n } from '../../editor/i18n'
import type { SceneNode } from '../../editor/scene/types'

export function EffectCard({ node, disabled }: { node: SceneNode, disabled: boolean }) {
  const { t } = useI18n()
  const enabled = useEditorStore(state => capabilityEnabled(state.capabilities, 'particles'))
  const assets = useAssetStore(state => state.assets)
  const [open, setOpen] = useInspectorCardOpen('particles')
  if (node.kind !== 'effect' || !node.effect) return null
  if (!enabled) {
    return <p className="settings-note">{t('particles.missing')}</p>
  }
  const effect = node.effect
  const asset = effect.assetId ? assets[effect.assetId] : undefined
  const missingAsset = Boolean(effect.assetId) && (!asset || asset.kind !== 'effect')
  const simulation = effect.assetId && asset?.kind === 'effect' ? asset.simulation : effect.simulation
  const materialId = effect.materialAssetId ?? (asset?.kind === 'effect' ? asset.materialAssetId : null)
  const version = effectVersion(effect)
  const loadError = particleIssue(node.id)
  const patch = (partial: Partial<typeof effect>) => {
    useEditorStore.getState().updateNode(node.id, { effect: { ...effect, ...partial } })
  }
  return (
    <>
    <section className="iv2-card iv2-card--wide">
      <header className="iv2-card__header" onClick={() => setOpen(!open)}>
        <span className="iv2-card__dot" style={{ background: '#ffb25a' }} />
        <span>{t('particles.title')}</span>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </header>
      {open && (
        <div className="iv2-card__body">
          <section className="iv2-section">
            <div className="iv2-section__title" style={{ color: '#ffb25a' }}><i /><span>{t('particles.playing')}</span></div>
          {missingAsset && <p className="settings-note">{t('particles.missingAsset')}</p>}
          {version !== QUARKS_VERSION && <p className="settings-note">{t('particles.version', { version, current: QUARKS_VERSION })}</p>}
          {loadError && <p className="settings-note">{t('particles.loadFail', { message: loadError })}</p>}
          {effect.assetId && asset?.kind === 'effect' && <p className="settings-note">{t('particles.shared', { name: asset.name })}</p>}
          <label className="field">
            <span>{t('particles.playing')}</span>
            <input type="checkbox" disabled={disabled} checked={effect.playing} onChange={event => patch({ playing: event.target.checked })} />
          </label>
          </section>
          <section className="iv2-section">
            <div className="iv2-section__title" style={{ color: '#ffd09a' }}><i /><span>{t('particles.material')}</span></div>
          <MaterialDrop
            materialId={materialId}
            disabled={disabled}
            onMaterial={id => patch({ materialAssetId: id })}
            onMap={mapAssetId => { if (materialId) useAssetStore.getState().updateMaterial(materialId, { mapAssetId }) }}
            onBlend={particleBlend => { if (materialId) useAssetStore.getState().updateMaterial(materialId, { particleBlend }) }}
            onColor={color => { if (materialId) useAssetStore.getState().updateMaterial(materialId, { color }) }}
            onOpacity={opacity => { if (materialId) useAssetStore.getState().updateMaterial(materialId, { opacity }) }}
            onDepthWrite={depthWrite => { if (materialId) useAssetStore.getState().updateMaterial(materialId, { depthWrite }) }}
          />
          <div className="particle-actions">
            {!materialId && (
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  const id = createParticleMaterial(effect, `${node.name} ${t('particles.material')}`)
                  const stored = effect.assetId ? useAssetStore.getState().assets[effect.assetId] : undefined
                  const onAsset = stored?.kind === 'effect' && stored.materialAssetId === id
                  if (!onAsset) patch({ materialAssetId: id })
                }}
              >{t('particles.createMaterial')}</button>
            )}
            {effect.materialAssetId && (
              <button type="button" disabled={disabled} onClick={() => patch({ materialAssetId: null })}>{t('particles.clearMaterial')}</button>
            )}
            {!effect.assetId && (
              <button type="button" disabled={disabled} onClick={() => saveEffectFromNode(node.id)}>{t('particles.saveAsset')}</button>
            )}
          </div>
          </section>
        </div>
      )}
    </section>
    <EffectModules simulation={simulation} disabled={disabled || missingAsset} onChange={next => commitSimulation(node, next)} />
    </>
  )
}
