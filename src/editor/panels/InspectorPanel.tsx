import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronRight, ExternalLink, FolderSearch, Image as ImageIcon, Search, Trash2, X } from 'lucide-react'
import { clipDuration, clipNamesFor, loadModelTemplate, subscribeModels } from '../assets/models'
import { activeAnimatorState, emptyAnimator } from '../animation/animator'
import { HumanoidCard } from './HumanoidCard'
import { AnimatorCard } from './AnimatorCard'
import { ASSET_MIME, reimportModel, saveMaterialFromNode, savePrefabFromSelection, openAsset } from '../assets/import'
import { primaryId, useEditorStore } from '../scene/store'
import { isLight, isMesh } from '../scene/kinds'
import { capabilityEnabled } from '../../capabilities/registry'
import { EffectModules } from '../../capabilities/particles/EffectModules'
import { openProjectSettings } from '../project/ProjectSettingsDialog'
import { PhysicsCard } from '../../capabilities/physics/PhysicsCard'
import { EffectCard } from '../../capabilities/particles/EffectCard'
import { NavigationCard, SceneNavigationCard } from '../../capabilities/navigation/NavigationCards'
import {
  InspectorFrame,
  useInspectorCardOpen,
  useInspectorMemory,
  useInspectorSlot,
} from './inspectorMemory'
import { TagLayerStrip } from './TagLayerCards'
import { ScreenCard } from '../ui/ScreenCard'
import { openUiEditor } from '../ui/session'
import { normalizeSlot, resolveModelSlot, slotFromNode } from '../assets/materials'
import { assetDirectory, useAssetStore, type FileAsset } from '../assets/library'
import { instanceDirty, isPrefabRoot } from '../assets/prefab'
import { translate, useI18n, type MessageKey } from '../i18n'
import { AssetPicker } from './AssetPicker'
import { openAssetPreview } from '../preview/previewStore'
import type { AlphaMode, CullMode, NodeKind, ParticleBlend, PbrSlot, SceneNode, ScenePicture, SurfaceShader, Vec3 } from '../scene/types'
import './InspectorPanel.css'

const AXES = [
  { key: 0 as const, label: 'X', color: 'var(--axis-x)' },
  { key: 1 as const, label: 'Y', color: 'var(--axis-y)' },
  { key: 2 as const, label: 'Z', color: 'var(--axis-z)' },
]

export default function InspectorPanel() {
  const selection = useEditorStore(state => state.selection)
  const inspectedAssetId = useEditorStore(state => state.inspectedAssetId)
  const nodes = useEditorStore(state => state.nodes)
  const playing = useEditorStore(state => state.playState !== 'stopped')
  const activeSceneId = useEditorStore(state => state.activeSceneId)
  const prefabSession = useEditorStore(state => state.prefabSession)
  const [unpackId, setUnpackId] = useState<string | null>(null)
  const [rebindId, setRebindId] = useState('')
  const assets = useAssetStore(state => state.assets)
  const prefabAssets = useMemo(() => Object.values(assets).filter(item => item.kind === 'prefab'), [assets])
  const asset = useAssetStore(state => inspectedAssetId ? state.assets[inspectedAssetId] : undefined)
  const { t } = useI18n()
  const id = primaryId({ selection })
  const node = id ? nodes[id] : undefined
  const kindName = (kind: NodeKind) => t(`kind.${kind}` as MessageKey)

  if (asset && selection.length === 0) {
    return (
      <InspectorFrame subject={`asset:${asset.id}`}>
        {asset.kind === 'scene' ? <SceneSettings /> : <AssetSettings asset={asset} />}
      </InspectorFrame>
    )
  }

  if (!node || selection.length === 0) {
    return (
      <InspectorFrame subject={`scene:${activeSceneId || 'current'}`}>
        <SceneSettings />
      </InspectorFrame>
    )
  }

  const locked = node.locked
  const templateRoot = !!prefabSession && !node.parentId
  const prefabRoot = isPrefabRoot(node) ? node : (node.prefabInstanceId ? nodes[node.prefabInstanceId] : undefined)

  return (
    <InspectorFrame subject={`node:${node.id}`}>
      {playing && <div className="inspector__banner inspector__banner--play">{t('inspector.playBanner')}</div>}
      {selection.length > 1 && (
        <div className="inspector__banner">{t('inspector.multi', { count: selection.length })}</div>
      )}
      <header className="inspector__header">
        <div className="inspector__kind">{kindName(node.kind)}{locked ? ` · ${t('inspector.locked')}` : ''}</div>
        <div className="inspector__header-row">
          {selection.length === 1 ? (
            <ObjectName node={node} disabled={locked || templateRoot} />
          ) : (
            <div className="inspector__multi">{node.name}</div>
          )}
          <label className="inspector__flag" title={t('inspector.visible')}>
            <input type="checkbox" checked={node.visible} onChange={() => useEditorStore.getState().toggleVisible(node.id)} />
          </label>
          <label className="inspector__flag" title={locked ? t('inspector.unlock') : t('inspector.lockHint')}>
            <input type="checkbox" checked={node.locked} onChange={() => useEditorStore.getState().toggleLocked(node.id)} />
          </label>
        </div>
      </header>

      <TagLayerStrip node={node} disabled={locked} />

      {templateRoot && <div className="inspector__banner">{t('prefab.rootLocked')}</div>}
      {prefabRoot && isPrefabRoot(prefabRoot) && (
        <Card id="prefab" title={t('prefab.instance')} color="#c79bff">
          <div className="prefab-actions">
            <span>{prefabAssets.find(item => item.id === prefabRoot.prefabAssetId)?.name ?? t('prefab.missing')}</span>
            {instanceDirty(nodes, prefabRoot.id) && <em title={t('prefab.dirty')}>{t('prefab.dirty')}</em>}
            {prefabAssets.some(item => item.id === prefabRoot.prefabAssetId) ? (
              <>
                <button type="button" onClick={() => useEditorStore.getState().openPrefab(prefabRoot.prefabAssetId ?? '')}>{t('prefab.edit')}</button>
                <button type="button" onClick={() => revealPrefabAsset(prefabRoot.prefabAssetId ?? '')}>{t('prefab.reveal')}</button>
                <button type="button" disabled={!instanceDirty(nodes, prefabRoot.id)} onClick={() => useEditorStore.getState().applyPrefabInstance(prefabRoot.id)}>{t('prefab.apply')}</button>
                <button type="button" disabled={!instanceDirty(nodes, prefabRoot.id)} onClick={() => useEditorStore.getState().revertPrefabInstance(prefabRoot.id)}>{t('prefab.revert')}</button>
                <button type="button" onClick={() => setUnpackId(prefabRoot.id)}>{t('prefab.unpack')}</button>
              </>
            ) : (
              <>
                <select value={rebindId} onChange={event => setRebindId(event.target.value)}>
                  <option value="">{t('prefab.rebindPick')}</option>
                  {prefabAssets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                <button type="button" disabled={!rebindId} onClick={() => useEditorStore.getState().rebindPrefab(prefabRoot.prefabAssetId ?? '', rebindId)}>{t('prefab.rebind')}</button>
              </>
            )}
          </div>
        </Card>
      )}
      {unpackId && createPortal(
        <div className="prefab-dialog__backdrop" onMouseDown={() => setUnpackId(null)}>
          <div className="prefab-dialog" role="dialog" onMouseDown={event => event.stopPropagation()}>
            <h2>{t('prefab.unpackTitle')}</h2>
            <p>{t('prefab.unpackMessage')}</p>
            <div>
              <button type="button" onClick={() => setUnpackId(null)}>{t('prefab.cancel')}</button>
              <button type="button" onClick={() => { useEditorStore.getState().unpackPrefabInstance(unpackId); setUnpackId(null) }}>{t('prefab.unpack')}</button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      <Card id="transform" title={t('inspector.transform')} color={kindColor(node.kind)}>
        <Vec3Fields
          label={t('inspector.position')}
          value={node.position}
          step={0.02}
          disabled={locked || templateRoot}
          gesture={t('gesture.move')}
          onChange={position => useEditorStore.getState().updateNode(node.id, { position })}
        />
        <Vec3Fields
          label={t('inspector.rotation')}
          value={node.rotation}
          step={0.4}
          disabled={locked || templateRoot}
          gesture={t('gesture.rotate')}
          onChange={rotation => useEditorStore.getState().updateNode(node.id, { rotation })}
        />
        <Vec3Fields
          label={t('inspector.scale')}
          value={node.scale}
          step={0.01}
          reset={1}
          disabled={locked || templateRoot}
          gesture={t('gesture.scale')}
          onChange={scale => useEditorStore.getState().updateNode(node.id, { scale })}
        />
        <div className="inspector__resets">
          <button type="button" disabled={locked || templateRoot} onClick={() => resetTransform(node.id, { position: [0, 0, 0] })}>{t('inspector.resetPosition')}</button>
          <button type="button" disabled={locked || templateRoot} onClick={() => resetTransform(node.id, { rotation: [0, 0, 0] })}>{t('inspector.resetRotation')}</button>
          <button type="button" disabled={locked || templateRoot} onClick={() => resetTransform(node.id, { scale: [1, 1, 1] })}>{t('inspector.resetScale')}</button>
        </div>
      </Card>

      {(isMesh(node.kind) || node.kind === 'model' || node.kind === 'empty') && (
        <PhysicsCard node={node} disabled={locked || playing} />
      )}
      {node.kind === 'effect' && <EffectCard node={node} disabled={locked || playing} />}
      {(isMesh(node.kind) || node.kind === 'model' || node.kind === 'empty') && (
        <NavigationCard node={node} disabled={locked || playing} />
      )}
      {node.kind === 'screen' && <ScreenCard node={node} locked={locked || playing} playing={playing} />}

      {(isMesh(node.kind) || node.kind === 'model') && <MeshRendererCard node={node} />}

      {node.kind === 'model' && (
        <Card id="model" title={t('inspector.model')} color={kindColor(node.kind)}>
          <AnimModeSwitch nodeId={node.id} />
          <AnimationCard
            nodeId={node.id}
            assetId={node.assetId}
            clipAssetId={node.clipAssetId}
            clip={node.clip}
            clipTime={node.clipTime}
            clipPlaying={node.clipPlaying}
            driven={node.animator?.enabled === true}
          />
          <label className="field">
            <span>{t('anim.end')}</span>
            <select
              value={node.clipEnd ?? 'hold'}
              onChange={event => useEditorStore.getState().updateNode(node.id, { clipEnd: event.target.value as 'hold' | 'stop' | 'default' })}
            >
              <option value="hold">{t('anim.hold')}</option>
              <option value="stop">{t('anim.stop')}</option>
              <option value="default">{t('anim.backToDefault')}</option>
            </select>
          </label>
          {node.animator?.enabled === true && <AnimatorCard nodeId={node.id} />}
          {node.assetId && <HumanoidCard assetId={node.assetId} />}
        </Card>
      )}

      {isLight(node.kind) && (
        <Card id="light" title={t('inspector.light')} color={kindColor(node.kind)}>
          <ColorField
            label={t('inspector.color')}
            value={node.color}
            gesture={t('gesture.light')}
            onChange={color => useEditorStore.getState().updateNode(node.id, { color })}
          />
          <NumberRow
            label={t('inspector.intensity')}
            value={node.intensity}
            min={0}
            max={20}
            step={0.05}
            gesture={t('gesture.light')}
            onChange={intensity => useEditorStore.getState().updateNode(node.id, { intensity })}
          />
          {node.kind === 'spot-light' && (
            <NumberRow
              label={t('inspector.angle')}
              value={node.spotAngle}
              min={1}
              max={90}
              step={0.2}
              gesture={t('gesture.light')}
              onChange={spotAngle => useEditorStore.getState().updateNode(node.id, { spotAngle })}
            />
          )}
          {node.kind === 'hemisphere-light' && (
            <ColorField
              label={t('inspector.ground')}
              value={node.groundColor}
              gesture={t('gesture.light')}
              onChange={groundColor => useEditorStore.getState().updateNode(node.id, { groundColor })}
            />
          )}
          {node.kind !== 'hemisphere-light' && node.kind !== 'directional-light' && (
            <>
              <NumberRow label={t('inspector.range')} value={node.range} min={0} max={80} step={0.2} gesture={t('gesture.light')} onChange={range => useEditorStore.getState().updateNode(node.id, { range })} />
              <NumberRow label={t('inspector.decay')} value={node.decay} min={0} max={4} step={0.05} gesture={t('gesture.light')} onChange={decay => useEditorStore.getState().updateNode(node.id, { decay })} />
            </>
          )}
          {node.kind === 'directional-light' && (
            <NumberRow label={t('inspector.range')} value={node.range} min={1} max={200} step={0.5} gesture={t('gesture.light')} onChange={range => useEditorStore.getState().updateNode(node.id, { range })} />
          )}
          {node.kind === 'spot-light' && (
            <NumberRow label={t('inspector.penumbra')} value={node.penumbra} min={0} max={1} step={0.01} gesture={t('gesture.light')} onChange={penumbra => useEditorStore.getState().updateNode(node.id, { penumbra })} />
          )}
          {node.kind !== 'hemisphere-light' && (
            <>
              <label className="field">
                <span>{t('inspector.shadow')}</span>
                <input type="checkbox" checked={node.castShadow} onChange={event => commitNode(node.id, t('gesture.light'), { castShadow: event.target.checked })} />
              </label>
              <NumberRow label={t('inspector.bias')} value={node.shadowBias} step={0.0001} gesture={t('gesture.light')} onChange={shadowBias => useEditorStore.getState().updateNode(node.id, { shadowBias })} />
              <NumberRow label={t('inspector.normalBias')} value={node.shadowNormalBias} min={0} max={1} step={0.001} gesture={t('gesture.light')} onChange={shadowNormalBias => useEditorStore.getState().updateNode(node.id, { shadowNormalBias })} />
            </>
          )}
        </Card>
      )}

      {node.kind === 'camera' && (
        <Card id="camera" title={t('inspector.camera')} color={kindColor(node.kind)}>
          <NumberRow
            label={t('inspector.fov')}
            value={node.fov}
            min={10}
            max={120}
            step={0.2}
            gesture={t('gesture.camera')}
            onChange={fov => useEditorStore.getState().updateNode(node.id, { fov })}
          />
          <NumberRow label={t('inspector.near')} value={node.near} min={0.01} max={20} step={0.01} gesture={t('gesture.camera')} onChange={near => useEditorStore.getState().updateNode(node.id, { near })} />
          <NumberRow label={t('inspector.far')} value={node.far} min={1} max={500} step={1} gesture={t('gesture.camera')} onChange={far => useEditorStore.getState().updateNode(node.id, { far })} />
        </Card>
      )}
    </InspectorFrame>
  )
}

function AssetSettings({ asset }: { asset: import('../assets/library').ProjectAsset }) {
  const { t } = useI18n()
  const preview = asset.kind === 'model' || asset.kind === 'texture' || asset.kind === 'material' || asset.kind === 'environment'
    ? asset.kind
    : null
  return (
    <>
      <header className="inspector__header">
        <div className="inspector__kind">{assetKindLabel(asset.kind)}</div>
        <input
          value={asset.name}
          onChange={event => useAssetStore.getState().rename(asset.id, event.target.value)}
          onBlur={event => {
            const name = event.target.value.trim() || asset.name
            useAssetStore.getState().rename(asset.id, name)
          }}
        />
      </header>
      {asset.kind === 'material' && (
        <Card id="material" title={t('inspector.material')} color="#ab47bc">
          <MaterialEditor slot={normalizeSlot(asset.slot)} onChange={patch => useAssetStore.getState().updateMaterial(asset.id, patch)} />
        </Card>
      )}
      {asset.kind === 'effect' && (
        <EffectModules
          simulation={asset.simulation}
          disabled={false}
          onChange={simulation => useAssetStore.getState().updateEffect(asset.id, { simulation })}
        />
      )}
      {asset.kind !== 'material' && asset.kind !== 'effect' && (
        <Card id="asset" title={t('inspector.asset')} color="#4a9eff">
          <label className="field"><span>{t('inspector.type')}</span><span>{assetKindLabel(asset.kind)}</span></label>
          {'fileName' in asset && <label className="field"><span>{t('inspector.file')}</span><span>{asset.fileName}</span></label>}
          {asset.kind === 'scene' && <label className="field"><span>{t('inspector.objects')}</span><span>{Object.keys(asset.nodes).length}</span></label>}
          {asset.kind === 'prefab' && <label className="field"><span>{t('inspector.objects')}</span><span>{Object.keys(asset.nodes).length}</span></label>}
          {asset.kind === 'ui' && <button type="button" onClick={() => openUiEditor(asset.id)}>{t('ui.open')}</button>}
          {asset.kind === 'model' && <label className="field"><span>{t('inspector.clips')}</span><span>{clipNamesFor(asset.id).length}</span></label>}
        </Card>
      )}
      <div className="inspector__header">
        {preview && <button type="button" className="inspector__action" onClick={() => openAssetPreview(preview, asset.id, asset.name)}>{t('inspector.preview')}</button>}
        {(asset.kind === 'model' || asset.kind === 'prefab') && (
          <button type="button" className="inspector__action" onClick={() => void openAsset(asset.id)}>{t('inspector.place')}</button>
        )}
        {(asset.kind === 'model' || asset.kind === 'animation') && (
          <button type="button" className="inspector__action" onClick={() => void reimportModel(asset.id)}>{t('preview.reimport')}</button>
        )}
      </div>
    </>
  )
}

function ObjectName({ node, disabled }: { node: SceneNode, disabled: boolean }) {
  const { t } = useI18n()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(node.name)
  const cancel = useRef(false)
  useEffect(() => {
    setEditing(false)
    setDraft(node.name)
  }, [node.id, node.name])
  if (!editing) {
    return (
      <button type="button" className="inspector__name" disabled={disabled} onClick={() => { setDraft(node.name); setEditing(true) }}>
        {node.name}
      </button>
    )
  }
  return (
    <input
      autoFocus
      value={draft}
      onFocus={event => event.target.select()}
      onChange={event => setDraft(event.target.value)}
      onKeyDown={event => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') {
          cancel.current = true
          event.currentTarget.blur()
        }
      }}
      onBlur={() => {
        const skipped = cancel.current
        cancel.current = false
        setEditing(false)
        if (skipped) {
          setDraft(node.name)
          return
        }
        const name = draft.trim() || node.name
        if (name === node.name) return
        const store = useEditorStore.getState()
        store.beginGesture(t('gesture.rename'))
        store.updateNode(node.id, { name })
        store.endGesture()
      }}
    />
  )
}

function assetKindLabel(kind: string): string {
  const key = `asset.${kind}` as MessageKey
  const known = ['scene', 'model', 'texture', 'environment', 'material', 'animation', 'audio', 'prefab', 'effect', 'ui']
  return known.includes(kind) ? translate(key) : kind
}

function SceneSettings() {
  const { t } = useI18n()
  const picture = useEditorStore(state => state.picture)
  const capabilities = useEditorStore(state => state.capabilities)
  const physicsOn = capabilityEnabled(capabilities, 'physics')
  const activeSceneId = useEditorStore(state => state.activeSceneId)
  const scene = useAssetStore(state => state.assets[activeSceneId])
  const name = scene?.kind === 'scene' ? scene.name : t('inspector.unnamedScene')
  const set = (patch: Partial<ScenePicture>) => useEditorStore.getState().setPicture(patch)
  return (
    <>
      <header className="inspector__header">
        <div className="inspector__kind">{t('inspector.scene')}</div>
        <input
          value={name}
          onChange={event => {
            if (scene?.kind === 'scene') useAssetStore.getState().rename(scene.id, event.target.value)
          }}
          onBlur={event => {
            const next = event.target.value.trim() || t('inspector.unnamedScene')
            if (scene?.kind === 'scene') useAssetStore.getState().rename(scene.id, next)
          }}
        />
      </header>
      {physicsOn && (
        <Card id="scene-physics" title={t('physics.title')} color="#8bc34a">
          <Vec3Fields
            label={t('physics.gravity')}
            value={picture.gravity ?? [0, -9.81, 0]}
            step={0.1}
            gesture={t('gesture.picture')}
            onChange={gravity => set({ gravity })}
          />
        </Card>
      )}
      {!physicsOn && (
        <Card id="scene-physics" title={t('physics.title')} color="#8bc34a">
          <p className="settings-note">{t('physics.disabledHint')}</p>
          <button type="button" onClick={openProjectSettings}>{t('menu.projectSettings')}</button>
        </Card>
      )}
      <SceneNavigationCard />
      <Card id="sky" title={t('inspector.sky')} color="#4a9eff">
        <ColorField label={t('inspector.background')} value={picture.background} gesture={t('gesture.picture')} onChange={background => set({ background })} />
        <NumberRow label={t('inspector.exposure')} value={picture.exposure} min={0} max={5} step={0.01} gesture={t('gesture.picture')} onChange={exposure => set({ exposure })} />
        <label className="field">
          <span>{t('inspector.toneMapping')}</span>
          <select value={picture.toneMapping} onChange={event => set({ toneMapping: event.target.value as typeof picture.toneMapping })}>
            <option value="aces">{t('tone.aces')}</option>
            <option value="agx">{t('tone.agx')}</option>
            <option value="neutral">{t('tone.neutral')}</option>
            <option value="cineon">{t('tone.cineon')}</option>
            <option value="reinhard">{t('tone.reinhard')}</option>
            <option value="linear">{t('tone.linear')}</option>
            <option value="none">{t('tone.none')}</option>
          </select>
        </label>
      </Card>
      <Card id="fog" title={t('inspector.fog')} color="#90a4ae">
        <label className="field"><span>{t('inspector.enabled')}</span><input type="checkbox" checked={picture.fog} onChange={event => set({ fog: event.target.checked })} /></label>
        {picture.fog && (
          <>
            <ColorField label={t('inspector.fogColor')} value={picture.fogColor} gesture={t('gesture.picture')} onChange={fogColor => set({ fogColor })} />
            <NumberRow label={t('inspector.fogStart')} value={picture.fogNear} min={0} max={200} step={0.5} gesture={t('gesture.picture')} onChange={fogNear => set({ fogNear })} />
            <NumberRow label={t('inspector.fogEnd')} value={picture.fogFar} min={0} max={400} step={0.5} gesture={t('gesture.picture')} onChange={fogFar => set({ fogFar })} />
          </>
        )}
      </Card>
      <Card id="environment" title={t('inspector.environment')} color="#ffd36b">
        <EnvField value={picture.envAssetId} onChange={envAssetId => set({ envAssetId })} />
      </Card>
      <Card id="aa" title={t('inspector.aa')} color="#26c6da">
        <label className="field"><span>{t('inspector.enabled')}</span><input type="checkbox" checked={picture.aa !== false} onChange={event => set({ aa: event.target.checked })} /></label>
      </Card>
      <Card id="bloom" title={t('inspector.bloom')} color="#ab47bc">
        <label className="field"><span>{t('inspector.enabled')}</span><input type="checkbox" checked={picture.bloom} onChange={event => set({ bloom: event.target.checked })} /></label>
        {picture.bloom && (
          <>
            <NumberRow label={t('inspector.intensity')} value={picture.bloomStrength} min={0} max={2} step={0.01} gesture={t('gesture.picture')} onChange={bloomStrength => set({ bloomStrength })} />
            <NumberRow label={t('inspector.radius')} value={picture.bloomRadius} min={0} max={1} step={0.01} gesture={t('gesture.picture')} onChange={bloomRadius => set({ bloomRadius })} />
            <NumberRow label={t('inspector.threshold')} value={picture.bloomThreshold} min={0} max={1} step={0.01} gesture={t('gesture.picture')} onChange={bloomThreshold => set({ bloomThreshold })} />
          </>
        )}
      </Card>
      <Card id="volume" title={t('inspector.volume')} color="#80deea">
        <label className="field"><span>{t('inspector.enabled')}</span><input type="checkbox" checked={picture.volume} onChange={event => set({ volume: event.target.checked })} /></label>
        {picture.volume && (
          <>
            <ColorField label={t('inspector.color')} value={picture.volumeColor} gesture={t('gesture.picture')} onChange={volumeColor => set({ volumeColor })} />
            <NumberRow label={t('inspector.volumeDensity')} value={picture.volumeDensity} min={0} max={2} step={0.01} gesture={t('gesture.picture')} onChange={volumeDensity => set({ volumeDensity })} />
            <NumberRow label={t('inspector.volumeSteps')} value={picture.volumeSteps} min={4} max={64} step={1} gesture={t('gesture.picture')} onChange={volumeSteps => set({ volumeSteps })} />
            <NumberRow label={t('inspector.volumeSize')} value={picture.volumeSize} min={1} max={200} step={1} gesture={t('gesture.picture')} onChange={volumeSize => set({ volumeSize })} />
            <NumberRow label={t('inspector.volumeHeight')} value={picture.volumeHeight} min={0.5} max={80} step={0.5} gesture={t('gesture.picture')} onChange={volumeHeight => set({ volumeHeight })} />
          </>
        )}
      </Card>
      <Card id="ssgi" title={t('inspector.ssgi')} color="#7e57c2">
        <label className="field"><span>{t('inspector.enabled')}</span><input type="checkbox" checked={picture.ssgi} onChange={event => set({ ssgi: event.target.checked })} /></label>
        {picture.ssgi && (
          <>
            <NumberRow label={t('inspector.ssgiIndirect')} value={picture.ssgiIntensity} min={0} max={40} step={0.5} gesture={t('gesture.picture')} onChange={ssgiIntensity => set({ ssgiIntensity })} />
            <NumberRow label={t('inspector.ssgiOcclusion')} value={picture.ssgiOcclusion} min={0} max={4} step={0.05} gesture={t('gesture.picture')} onChange={ssgiOcclusion => set({ ssgiOcclusion })} />
            <NumberRow label={t('inspector.ssgiRadius')} value={picture.ssgiRadius} min={1} max={25} step={0.5} gesture={t('gesture.picture')} onChange={ssgiRadius => set({ ssgiRadius })} />
            <NumberRow label={t('inspector.ssgiSlices')} value={picture.ssgiSlices} min={1} max={4} step={1} gesture={t('gesture.picture')} onChange={ssgiSlices => set({ ssgiSlices })} />
            <NumberRow label={t('inspector.ssgiSteps')} value={picture.ssgiSteps} min={1} max={32} step={1} gesture={t('gesture.picture')} onChange={ssgiSteps => set({ ssgiSteps })} />
          </>
        )}
      </Card>
      <Card id="ssr" title={t('inspector.ssr')} color="#5c6bc0">
        <label className="field"><span>{t('inspector.enabled')}</span><input type="checkbox" checked={picture.ssr} onChange={event => set({ ssr: event.target.checked })} /></label>
        {picture.ssr && (
          <>
            <NumberRow label={t('inspector.ssrQuality')} value={picture.ssrQuality} min={0} max={1} step={0.05} gesture={t('gesture.picture')} onChange={ssrQuality => set({ ssrQuality })} />
            <NumberRow label={t('inspector.ssrDistance')} value={picture.ssrDistance} min={0.2} max={30} step={0.1} gesture={t('gesture.picture')} onChange={ssrDistance => set({ ssrDistance })} />
            <NumberRow label={t('inspector.ssrThickness')} value={picture.ssrThickness} min={0.001} max={0.2} step={0.001} gesture={t('gesture.picture')} onChange={ssrThickness => set({ ssrThickness })} />
            <NumberRow label={t('inspector.intensity')} value={picture.ssrIntensity} min={0} max={2} step={0.05} gesture={t('gesture.picture')} onChange={ssrIntensity => set({ ssrIntensity })} />
          </>
        )}
      </Card>
      <Card id="dof" title={t('inspector.dof')} color="#26a69a">
        <label className="field"><span>{t('inspector.enabled')}</span><input type="checkbox" checked={picture.dof} onChange={event => set({ dof: event.target.checked })} /></label>
        {picture.dof && (
          <>
            <NumberRow label={t('inspector.focus')} value={picture.dofFocus} min={0} max={50} step={0.1} gesture={t('gesture.picture')} onChange={dofFocus => set({ dofFocus })} />
            <NumberRow label={t('inspector.focal')} value={picture.dofFocal} min={0} max={20} step={0.05} gesture={t('gesture.picture')} onChange={dofFocal => set({ dofFocal })} />
            <NumberRow label={t('inspector.bokeh')} value={picture.dofBokeh} min={0} max={10} step={0.05} gesture={t('gesture.picture')} onChange={dofBokeh => set({ dofBokeh })} />
          </>
        )}
      </Card>
      <Card id="occlusion" title={t('inspector.occlusion')} color="#78909c">
        <label className="field"><span>{t('inspector.enabled')}</span><input type="checkbox" checked={picture.ao} onChange={event => set({ ao: event.target.checked })} /></label>
      </Card>
      <Card id="grade" title={t('inspector.grade')} color="#ef6c00">
        <NumberRow label={t('inspector.hue')} value={picture.hue} min={-1} max={1} step={0.01} gesture={t('gesture.picture')} onChange={hue => set({ hue })} />
        <NumberRow label={t('inspector.saturation')} value={picture.saturation} min={0} max={2} step={0.01} gesture={t('gesture.picture')} onChange={saturation => set({ saturation })} />
      </Card>
    </>
  )
}

function MeshRendererCard({ node }: { node: SceneNode }) {
  const { t } = useI18n()
  const assets = useAssetStore(state => state.assets)
  const [listOpen, setListOpen] = useInspectorCardOpen('material-slots')
  const [storedSlot, setOpenSlot] = useInspectorSlot()
  const openSlot = storedSlot === undefined
    ? (node.kind === 'model' && node.slots.length > 1 ? null : 0)
    : storedSlot
  const [query, setQuery] = useState('')
  const [dropSlot, setDropSlot] = useState<number | null>(null)
  const [picking, setPicking] = useState<number | null>(null)
  const [handledNonce, setHandledNonce] = useState(0)
  const [flashNonce, setFlashNonce] = useState(0)
  const focus = useInspectorMemory(state => state.materialFocus)
  const pickedFocus = focus?.nodeId === node.id ? focus : null
  if (pickedFocus && pickedFocus.nonce !== handledNonce) {
    setHandledNonce(pickedFocus.nonce)
    if (query) setQuery('')
  }
  useEffect(() => {
    setQuery('')
    setDropSlot(null)
    setPicking(null)
  }, [node.id])
  useEffect(() => {
    if (!pickedFocus) return
    setFlashNonce(pickedFocus.nonce)
    const timer = window.setTimeout(() => {
      setFlashNonce(current => current === pickedFocus.nonce ? 0 : current)
    }, 1600)
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`mesh-slot-${node.id}-${pickedFocus.slot}`)?.scrollIntoView({ block: 'nearest' })
    })
    return () => {
      window.clearTimeout(timer)
      window.cancelAnimationFrame(frame)
    }
  }, [pickedFocus, node.id])
  const entries = node.kind === 'model'
    ? node.slots.map((slot, index) => ({ index, name: slot.name, linked: linkedMaterialId(slot.materialAssetId, assets) }))
    : [{ index: 0, name: node.name, linked: linkedMaterialId(node.materialAssetId, assets) }]
  const q = query.trim().toLowerCase()
  const visible = q
    ? entries.filter(entry => String(entry.index).includes(q) || entry.name.toLowerCase().includes(q) || (entry.linked ? assets[entry.linked]?.name.toLowerCase().includes(q) : t('inspector.inline').toLowerCase().includes(q)))
    : entries
  return (
    <Card id="model-renderer" title={t('inspector.modelRenderer')} color={kindColor(node.kind)}>
      {node.kind === 'model' && (
        <>
          <button type="button" className="inspector__action" onClick={savePrefabFromSelection}>{t('inspector.savePrefab')}</button>
          {node.assetId && <button type="button" className="inspector__action" onClick={() => openAssetPreview('model', node.assetId!, node.name)}>{t('inspector.previewModel')}</button>}
        </>
      )}
      <label className="field">
        <span>{t('inspector.castShadow')}</span>
        <input type="checkbox" checked={node.castShadow} onChange={event => commitNode(node.id, t('gesture.shadow'), { castShadow: event.target.checked })} />
      </label>
      <label className="field">
        <span>{t('inspector.receiveShadow')}</span>
        <input type="checkbox" checked={node.receiveShadow} onChange={event => commitNode(node.id, t('gesture.shadow'), { receiveShadow: event.target.checked })} />
      </label>
      <button type="button" className="mesh-slots__head" aria-expanded={listOpen} onClick={() => setListOpen(!listOpen)}>
        {listOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>{t('inspector.materialSlots')}</span>
        <em>{entries.length}</em>
      </button>
      {listOpen && entries.length >= 6 && (
        <input className="mesh-slots__search" value={query} placeholder={t('inspector.searchSlots')} onChange={event => setQuery(event.target.value)} />
      )}
      {listOpen && visible.map(entry => {
        const open = openSlot === entry.index
        const picked = flashNonce !== 0 && pickedFocus?.nonce === flashNonce && pickedFocus.slot === entry.index
        const source = node.kind === 'model' ? node.slots[entry.index] : null
        const resolved = source ? resolveModelSlot(source) : slotFromNode(node)
        const linked = entry.linked
        return (
          <div
            key={entry.index}
            id={`mesh-slot-${node.id}-${entry.index}`}
            className={`mesh-slot ${open ? 'is-open' : ''} ${picked ? 'is-picked' : ''} ${dropSlot === entry.index ? 'is-drop' : ''}`}
            onDragOver={event => onSlotDragOver(event, entry.index, setDropSlot)}
            onDragLeave={() => setDropSlot(current => current === entry.index ? null : current)}
            onDrop={event => {
              const materialId = materialIdFromDrop(event)
              setDropSlot(null)
              if (materialId) setSlotLink(node.id, node.kind === 'model' ? entry.index : null, materialId)
            }}
          >
            <div className="mesh-slot__row">
              <button type="button" className="mesh-slot__twist" aria-label={open ? t('inspector.collapseSlot') : t('inspector.expandSlot')} onClick={() => setOpenSlot(open ? null : entry.index)}>
                <ChevronRight size={12} />
              </button>
              <span className="mesh-slot__index">{t('inspector.slot', { index: entry.index })}</span>
              <button
                type="button"
                className="mesh-slot__pick asset-ref"
                title={entry.name}
                onClick={event => { event.stopPropagation(); setPicking(entry.index) }}
              >
                <span>{linked ? (assets[linked]?.name ?? t('picker.none')) : `${entry.name} · ${t('inspector.inline')}`}</span>
                <Search size={12} />
              </button>
              {picking === entry.index && (
                <AssetPicker
                  title={t('picker.material')}
                  kinds={['material']}
                  selectedId={linked}
                  onSelect={id => {
                    setSlotLink(node.id, node.kind === 'model' ? entry.index : null, id)
                    setPicking(null)
                  }}
                  onClose={() => setPicking(null)}
                />
              )}
              {!linked && (
                <button type="button" title={t('inspector.extract')} onClick={() => saveMaterialFromNode(node.id, node.kind === 'model' ? entry.index : null)}>
                  <ExternalLink size={12} />
                </button>
              )}
              {linked && (
                <button type="button" title={t('inspector.reveal')} onClick={() => useEditorStore.getState().inspectAsset(linked)}>
                  <FolderSearch size={12} />
                </button>
              )}
              {linked && (
                <button type="button" title={t('inspector.clear')} onClick={() => setSlotLink(node.id, node.kind === 'model' ? entry.index : null, null)}>
                  <Trash2 size={12} />
                </button>
              )}
            </div>
            {open && (
              <div className="mesh-slot__body">
                {linked && <div className="inspector__banner">{t('inspector.linkedNote')}</div>}
                <MaterialEditor
                  slot={resolved}
                  onChange={patch => writeSlot(node.id, node.kind === 'model' ? entry.index : null, linked, patch)}
                />
              </div>
            )}
          </div>
        )
      })}
    </Card>
  )
}

function linkedMaterialId(id: string | null | undefined, assets: ReturnType<typeof useAssetStore.getState>['assets']): string | null {
  if (!id) return null
  return assets[id]?.kind === 'material' ? id : null
}

function setSlotLink(nodeId: string, slotIndex: number | null, materialId: string | null) {
  const node = useEditorStore.getState().nodes[nodeId]
  if (!node) return
  if (node.kind === 'model' && slotIndex != null) {
    useEditorStore.getState().updateNode(nodeId, {
      slots: node.slots.map((item, index) => index === slotIndex ? { ...item, materialAssetId: materialId } : item),
    })
    return
  }
  useEditorStore.getState().updateNode(nodeId, { materialAssetId: materialId })
}

function writeSlot(nodeId: string, slotIndex: number | null, linked: string | null, patch: Partial<PbrSlot>) {
  if (linked) {
    useAssetStore.getState().updateMaterial(linked, patch)
    return
  }
  const node = useEditorStore.getState().nodes[nodeId]
  if (!node) return
  if (node.kind === 'model' && slotIndex != null) {
    useEditorStore.getState().updateNode(nodeId, {
      slots: node.slots.map((item, index) => index === slotIndex ? { ...item, ...patch } : item),
    })
    return
  }
  useEditorStore.getState().updateNode(nodeId, patch)
}

function onSlotDragOver(event: DragEvent, index: number, setDropSlot: (index: number | null) => void) {
  const types = [...event.dataTransfer.types]
  if (!types.includes(ASSET_MIME)) return
  event.preventDefault()
  event.stopPropagation()
  setDropSlot(index)
}

function materialIdFromDrop(event: DragEvent): string | null {
  const id = event.dataTransfer.getData(ASSET_MIME)
  event.preventDefault()
  event.stopPropagation()
  if (!id) return null
  const asset = useAssetStore.getState().assets[id]
  return asset?.kind === 'material' ? id : null
}

function MaterialEditor({ slot, onChange }: { slot: PbrSlot, onChange: (patch: Partial<PbrSlot>) => void }) {
  const { t } = useI18n()
  const lit = (slot.shader ?? 'lit') === 'lit'
  const particle = (slot.shader ?? 'lit') === 'particle-unlit'
  const textured = slot.shader !== 'unlit-color'
  return (
    <>
      <label className="field">
        <span>{t('material.shader')}</span>
        <select value={slot.shader ?? 'lit'} onChange={event => {
          const shader = event.target.value as SurfaceShader
          onChange(shader === 'particle-unlit'
            ? { shader, particleBlend: slot.particleBlend ?? 'additive', depthWrite: false, cull: 'off', alphaMode: 'blend' }
            : { shader })
        }}>
          <option value="lit">{t('material.lit')}</option>
          <option value="unlit-color">{t('material.unlitColor')}</option>
          <option value="unlit-texture">{t('material.unlitTexture')}</option>
          <option value="particle-unlit">{t('material.particle')}</option>
        </select>
      </label>
      <div className="field-section">{t('material.surface')}</div>
      <ColorField label={t('material.color')} value={slot.color} gesture={t('gesture.material')} onChange={color => onChange({ color })} />
      {textured && <MapField label={t('material.baseMap')} value={slot.mapAssetId ?? null} onChange={mapAssetId => onChange({ mapAssetId })} />}
      {lit && (
        <>
          <NumberRow label={t('material.metalness')} value={slot.metalness} min={0} max={1} step={0.01} gesture={t('gesture.material')} onChange={metalness => onChange({ metalness })} />
          <NumberRow label={t('material.roughness')} value={slot.roughness} min={0} max={1} step={0.01} gesture={t('gesture.material')} onChange={roughness => onChange({ roughness })} />
          <MapField label={t('material.metallicRoughness')} title={t('material.metallicRoughnessHint')} value={slot.metallicRoughnessAssetId ?? null} onChange={metallicRoughnessAssetId => onChange({ metallicRoughnessAssetId, roughnessAssetId: metallicRoughnessAssetId, metalnessAssetId: metallicRoughnessAssetId })} />
          <MapField label={t('material.normal')} value={slot.normalAssetId ?? null} onChange={normalAssetId => onChange({ normalAssetId })} />
          <NumberRow label={t('material.normalScale')} value={slot.normalScale ?? 1} min={0} max={4} step={0.01} gesture={t('gesture.material')} onChange={normalScale => onChange({ normalScale })} />
          <NumberRow label={t('material.ao')} value={slot.ao} min={0} max={1} step={0.01} gesture={t('gesture.material')} onChange={ao => onChange({ ao })} />
          <MapField label={t('material.aoMap')} title={t('material.aoMapHint')} value={slot.aoAssetId ?? null} onChange={aoAssetId => onChange({ aoAssetId })} />
          <div className="field-section">{t('material.emission')}</div>
          <ColorField label={t('material.emissionColor')} value={slot.emissive} gesture={t('gesture.material')} onChange={emissive => onChange({ emissive })} />
          <NumberRow label={t('material.emissionIntensity')} value={slot.emissiveIntensity} min={0} max={10} step={0.05} gesture={t('gesture.material')} onChange={emissiveIntensity => onChange({ emissiveIntensity })} />
          <MapField label={t('material.emissionMap')} value={slot.emissiveAssetId ?? null} onChange={emissiveAssetId => onChange({ emissiveAssetId })} />
        </>
      )}
      {particle && (
        <label className="field">
          <span>{t('material.particleBlend')}</span>
          <select value={slot.particleBlend ?? 'additive'} onChange={event => onChange({ particleBlend: event.target.value as ParticleBlend })}>
            <option value="alpha">{t('material.blendAlpha')}</option>
            <option value="premultiply">{t('material.blendPremultiply')}</option>
            <option value="additive">{t('material.blendAdditive')}</option>
            <option value="multiply">{t('material.blendMultiply')}</option>
          </select>
        </label>
      )}
      {!particle && <div className="field-section">{t('material.transparency')}</div>}
      {!particle && <label className="field">
        <span>{t('material.mode')}</span>
        <select value={slot.alphaMode ?? 'opaque'} onChange={event => onChange({ alphaMode: event.target.value as AlphaMode })}>
          <option value="opaque">{t('material.opaque')}</option>
          <option value="blend">{t('material.blend')}</option>
          <option value="clip">{t('material.clip')}</option>
        </select>
      </label>}
      {!particle && (slot.alphaMode ?? 'opaque') === 'blend' && (
        <NumberRow label={t('material.opacity')} value={slot.opacity} min={0} max={1} step={0.01} gesture={t('gesture.material')} onChange={opacity => onChange({ opacity })} />
      )}
      {(slot.alphaMode ?? 'opaque') === 'clip' && (
        <NumberRow label={t('material.cutoff')} value={slot.alphaCutoff ?? 0.5} min={0} max={1} step={0.01} gesture={t('gesture.material')} onChange={alphaCutoff => onChange({ alphaCutoff })} />
      )}
      <div className="field-section">{t('material.render')}</div>
      <label className="field">
        <span>{t('material.cull')}</span>
        <select value={slot.cull ?? 'back'} onChange={event => onChange({ cull: event.target.value as CullMode })}>
          <option value="back">{t('material.cullBack')}</option>
          <option value="front">{t('material.cullFront')}</option>
          <option value="off">{t('material.cullOff')}</option>
        </select>
      </label>
      <label className="field">
        <span>{t('material.depthWrite')}</span>
        <input type="checkbox" checked={slot.depthWrite ?? true} onChange={event => onChange({ depthWrite: event.target.checked })} />
      </label>
      {!particle && <label className="field">
        <span>{t('material.wireframe')}</span>
        <input type="checkbox" checked={slot.wireframe ?? false} onChange={event => onChange({ wireframe: event.target.checked })} />
      </label>}
    </>
  )
}

function AnimModeSwitch({ nodeId }: { nodeId: string }) {
  const { t } = useI18n()
  const node = useEditorStore(state => state.nodes[nodeId])
  const enabled = node?.animator?.enabled === true
  const embedded = node?.assetId ? clipNamesFor(node.assetId).length : 0
  const choose = (machine: boolean) => {
    const store = useEditorStore.getState()
    const node = store.nodes[nodeId]
    if (!node) return
    const animator = node.animator ?? emptyAnimator()
    const states = animator.states.map((state, index) => (
      index === 0 && !state.clip && node.clip ? { ...state, clip: node.clip, clipAssetId: node.clipAssetId } : state
    ))
    store.updateNode(nodeId, {
      animator: { ...animator, enabled: machine, states, stateId: animator.stateId || states[0]?.id || '', defaultStateId: animator.defaultStateId || states[0]?.id },
    })
  }
  return (
    <div className="anim-mode">
      <button type="button" className={!enabled ? 'is-on' : ''} onClick={() => choose(false)}>{t('anim.simple')}</button>
      <button type="button" className={enabled ? 'is-on' : ''} onClick={() => choose(true)}>{t('anim.machine')}</button>
      <span>{t(enabled ? 'anim.machineHint' : 'anim.simpleHint')}</span>
      {embedded > 0 && <em>{t('anim.embedded', { count: embedded })}</em>}
    </div>
  )
}

function AnimationCard({
  nodeId, assetId, clipAssetId, clip, clipTime, clipPlaying, driven = false,
}: {
  nodeId: string
  assetId: string | null
  clipAssetId: string | null
  clip: string
  clipTime: number
  clipPlaying: boolean
  driven?: boolean
}) {
  const { t } = useI18n()
  const [version, setVersion] = useState(0)
  useEffect(() => subscribeModels(() => setVersion(value => value + 1)), [])
  void version
  const playback = useEditorStore(state => state.nodes[nodeId])
  const clipLoop = playback?.clipLoop !== false
  const clipSpeed = playback?.clipSpeed ?? 1
  const clipFade = playback?.clipFade ?? 0.15
  const clipInPlace = playback?.clipInPlace === true
  const clipMask = playback?.clipMask === 'upper' || playback?.clipMask === 'lower' ? playback.clipMask : 'full'
  const modelClips = clipNamesFor(assetId)
  const fileClips = clipNamesFor(clipAssetId)
  const fromFile = !!clipAssetId && fileClips.includes(clip)
  const sourceId = fromFile ? clipAssetId : assetId
  const drivenState = driven && playback?.animator ? activeAnimatorState(playback.animator) : undefined
  const playName = drivenState?.clip || clip
  const playSource = drivenState ? (drivenState.clipAssetId || assetId) : sourceId
  const duration = clipDuration(playSource, playName)
  const shown = duration > 0 ? Math.min(clipTime, duration) : clipTime
  const choose = (value: string) => {
    const store = useEditorStore.getState()
    if (!value) {
      store.updateNode(nodeId, { clip: '', clipTime: 0, clipPlaying: false })
      return
    }
    const [source, name] = value.split('\u001f')
    if (source === 'file') store.updateNode(nodeId, { clip: name, clipTime: 0, clipPlaying: true })
    else store.updateNode(nodeId, {
      clip: name,
      clipTime: 0,
      clipPlaying: true,
      ...(fileClips.includes(name) ? { clipAssetId: null } : {}),
    })
  }
  return (
    <>
      <div className="anim-transport">
        <button
          type="button"
          title={clipPlaying ? t('inspector.pause') : t('inspector.play')}
          onClick={() => {
            const store = useEditorStore.getState()
            if (driven) {
              store.updateNode(nodeId, { clipPlaying: !clipPlaying })
              return
            }
            if (!clip) {
              const name = modelClips[0] ?? fileClips[0]
              if (!name) return
              store.updateNode(nodeId, {
                clip: name,
                clipTime: 0,
                clipPlaying: true,
                ...(modelClips[0] && fileClips.includes(modelClips[0]) ? { clipAssetId: null } : {}),
              })
              return
            }
            store.updateNode(nodeId, { clipPlaying: !clipPlaying })
          }}
        >
          {clipPlaying ? t('inspector.pause') : t('inspector.play')}
        </button>
        <input
          type="range"
          min={0}
          max={duration || 1}
          step={0.01}
          value={Number.isFinite(shown) ? shown : 0}
          disabled={!playName || duration <= 0}
          onPointerDown={() => {
            const store = useEditorStore.getState()
            store.beginGesture(t('gesture.anim'))
            store.updateNode(nodeId, { clipPlaying: false })
          }}
          onChange={event => useEditorStore.getState().updateNode(nodeId, { clipTime: Number(event.target.value), clipPlaying: false })}
          onPointerUp={() => useEditorStore.getState().endGesture()}
          onBlur={() => useEditorStore.getState().endGesture()}
        />
        <span>{formatClipTime(shown)} / {formatClipTime(duration)}</span>
      </div>
      {!driven && <label className="field">
        <span>{t('inspector.clip')}</span>
        <select value={clip ? `${fromFile ? 'file' : 'model'}\u001f${clip}` : ''} onChange={event => choose(event.target.value)}>
          <option value="">{t('material.none')}</option>
          {modelClips.length > 0 && (
            <optgroup label={t('inspector.modelClips')}>
              {modelClips.map(name => <option key={`model:${name}`} value={`model\u001f${name}`}>{name}</option>)}
            </optgroup>
          )}
          {fileClips.length > 0 && (
            <optgroup label={t('inspector.fileClips')}>
              {fileClips.map(name => <option key={`file:${name}`} value={`file\u001f${name}`}>{name}</option>)}
            </optgroup>
          )}
        </select>
      </label>}
      {!driven && <AssetRef
        label={t('inspector.animFile')}
        title={t('inspector.animFile')}
        kinds={['animation']}
        value={clipAssetId}
        onChange={id => {
          const store = useEditorStore.getState()
          if (!id) {
            store.updateNode(nodeId, { clipAssetId: null, clip: modelClips[0] ?? '', clipTime: 0, clipPlaying: false })
            return
          }
          const file = useAssetStore.getState().assets[id]
          if (!file || file.kind !== 'animation') return
          void loadModelTemplate(file).then(() => {
            const names = clipNamesFor(id)
            useEditorStore.getState().updateNode(nodeId, {
              clipAssetId: id,
              clip: names[0] ?? '',
              clipTime: 0,
              clipPlaying: names.length > 0,
            })
          }).catch(() => undefined)
        }}
      />}
      {!driven && <label className="field">
        <span>{t('anim.loop')}</span>
        <input type="checkbox" checked={clipLoop} onChange={event => useEditorStore.getState().updateNode(nodeId, { clipLoop: event.target.checked })} />
      </label>}
      {!driven && <NumberRow label={t('anim.speed')} value={clipSpeed} step={0.05} min={0.05} gesture={t('anim.speed')} onChange={speed => useEditorStore.getState().updateNode(nodeId, { clipSpeed: speed })} />}
      <NumberRow label={t('anim.fade')} value={clipFade} step={0.05} min={0} gesture={t('anim.fade')} onChange={fade => useEditorStore.getState().updateNode(nodeId, { clipFade: fade })} />
      {!driven && <label className="field">
        <span>{t('anim.mask')}</span>
        <select value={clipMask} onChange={event => useEditorStore.getState().updateNode(nodeId, { clipMask: event.target.value as 'full' | 'upper' | 'lower' })}>
          <option value="full">{t('anim.maskFull')}</option>
          <option value="upper">{t('anim.maskUpper')}</option>
          <option value="lower">{t('anim.maskLower')}</option>
        </select>
      </label>}
      {!driven && <label className="field">
        <span>{t('anim.overlay')}</span>
        <select
          value={playback?.overlayClip ? `${playback.overlayAssetId ? 'file' : 'model'}\u001f${playback.overlayClip}` : ''}
          onChange={event => {
            const store = useEditorStore.getState()
            if (!event.target.value) {
              store.updateNode(nodeId, { overlayClip: '', overlayPlaying: false, overlayTime: 0 })
              return
            }
            const [source, name] = event.target.value.split('\u001f')
            store.updateNode(nodeId, {
              overlayClip: name,
              overlayAssetId: source === 'file' ? clipAssetId : null,
              overlayTime: 0,
              overlayPlaying: true,
              overlayLoop: false,
            })
          }}
        >
          <option value="">{t('anim.overlayStop')}</option>
          {modelClips.map(name => <option key={`overlay-model:${name}`} value={`model\u001f${name}`}>{name}</option>)}
          {fileClips.map(name => <option key={`overlay-file:${name}`} value={`file\u001f${name}`}>{name}</option>)}
        </select>
      </label>}
      {!driven && <label className="field">
        <span>{t('anim.inPlace')}</span>
        <input type="checkbox" checked={clipInPlace} onChange={event => useEditorStore.getState().updateNode(nodeId, { clipInPlace: event.target.checked })} />
      </label>}
    </>
  )
}

function formatClipTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0.00s'
  return `${seconds.toFixed(2)}s`
}

function MapField({ label, title, value, onChange }: { label: string; title?: string; value: string | null; onChange: (id: string | null) => void }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const clickTimer = useRef<number | null>(null)
  const asset = useAssetStore(state => value ? state.assets[value] : undefined)
  const texture = asset?.kind === 'texture' ? asset : undefined
  const preview = texturePreview(texture)
  useEffect(() => () => {
    if (clickTimer.current != null) window.clearTimeout(clickTimer.current)
  }, [])

  const openPicker = () => setOpen(true)
  const previewClick = () => {
    if (clickTimer.current != null) window.clearTimeout(clickTimer.current)
    clickTimer.current = window.setTimeout(() => {
      clickTimer.current = null
      openPicker()
    }, 220)
  }
  const previewDoubleClick = () => {
    if (clickTimer.current != null) {
      window.clearTimeout(clickTimer.current)
      clickTimer.current = null
    }
    if (texture) openAssetPreview('texture', texture.id, texture.name)
  }
  const reveal = () => {
    if (!value) return
    const library = useAssetStore.getState()
    library.setBrowseDir(assetDirectory(value, library.assetDirs))
    useEditorStore.setState({ inspectedAssetId: value })
  }
  const takeDrop = (event: DragEvent) => {
    const id = event.dataTransfer.getData(ASSET_MIME)
    const dropped = id ? useAssetStore.getState().assets[id] : undefined
    if (dropped?.kind !== 'texture') return
    event.preventDefault()
    onChange(dropped.id)
  }

  return (
    <div className="tex-slot">
      <span className="tex-slot__label" title={title}>{label}</span>
      <div
        className="tex-slot__control"
        onDragOver={event => {
          if (event.dataTransfer.types.includes(ASSET_MIME)) event.preventDefault()
        }}
        onDrop={takeDrop}
      >
        <button
          type="button"
          className="tex-slot__preview"
          title={t('picker.textureHint')}
          onClick={previewClick}
          onDoubleClick={previewDoubleClick}
        >
          {preview ? <img src={preview} alt={texture?.name ?? ''} /> : <ImageIcon size={12} />}
        </button>
        <button
          type="button"
          className={`tex-slot__name ${texture ? '' : 'tex-slot__name--empty'}`}
          title={texture?.fileName ?? texture?.name ?? t('picker.textureHint')}
          onClick={openPicker}
        >
          {texture?.name ?? (value ? t('picker.missing') : t('picker.unset'))}
        </button>
        {value && (
          <button type="button" className="tex-slot__icon" title={t('inspector.reveal')} onClick={reveal}>
            <FolderSearch size={12} />
          </button>
        )}
        {value && (
          <button type="button" className="tex-slot__icon" title={t('picker.clear')} onClick={() => onChange(null)}>
            <X size={12} />
          </button>
        )}
      </div>
      {open && (
        <AssetPicker
          title={t('picker.texture')}
          kinds={['texture']}
          selectedId={value}
          onSelect={id => { onChange(id); setOpen(false) }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}

function texturePreview(asset: FileAsset | undefined): string | null {
  if (!asset) return null
  if (asset.thumb) return asset.thumb
  if (asset.url && !asset.fileName.toLowerCase().endsWith('.ktx2')) return asset.url
  return null
}

function EnvField({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const { t } = useI18n()
  return <AssetRef label={t('inspector.env')} title={t('picker.environment')} kinds={['environment']} value={value} onChange={onChange} />
}

function AssetRef({
  label, title, kinds, value, onChange,
}: {
  label: string
  title: string
  kinds: Array<import('../assets/library').ProjectAsset['kind']>
  value: string | null
  onChange: (id: string | null) => void
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const asset = useAssetStore(state => value ? state.assets[value] : undefined)
  return (
    <label className="field">
      <span>{label}</span>
      <button type="button" className="asset-ref" onClick={() => setOpen(true)}>
        <span>{asset?.name ?? t('picker.none')}</span>
        <Search size={12} />
      </button>
      {open && (
        <AssetPicker
          title={title}
          kinds={kinds}
          selectedId={value}
          onSelect={id => { onChange(id); setOpen(false) }}
          onClose={() => setOpen(false)}
        />
      )}
    </label>
  )
}

function revealPrefabAsset(assetId: string) {
  if (!assetId) return
  const library = useAssetStore.getState()
  library.setBrowseDir(assetDirectory(assetId, library.assetDirs))
  useEditorStore.setState({ inspectedAssetId: assetId })
}

function commitNode(id: string, label: string, patch: Partial<SceneNode>) {
  const store = useEditorStore.getState()
  store.beginGesture(label)
  store.updateNode(id, patch)
  store.endGesture()
}

function resetTransform(id: string, patch: Partial<SceneNode>) {
  commitNode(id, translate('gesture.reset'), patch)
}

function Card({ id, title, color, children }: { id: string; title: string; color: string; children: ReactNode }) {
  const [stored, setStored] = useInspectorCardOpen(id)
  const open = stored
  const setOpen = (value: boolean) => setStored(value)
  return (
    <section className="iv2-card">
      <header className="iv2-card__header" onClick={() => setOpen(!open)}>
        <span className="iv2-card__dot" style={{ background: color }} />
        <span>{title}</span>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </header>
      {open && <div className="iv2-card__body">{children}</div>}
    </section>
  )
}

function Vec3Fields({
  label,
  value,
  step,
  reset = 0,
  disabled,
  gesture,
  onChange,
}: {
  label: string
  value: Vec3
  step: number
  disabled?: boolean
  reset?: number
  gesture: string
  onChange: (value: Vec3) => void
}) {
  return (
    <div className="vec3">
      <span className="vec3__label">{label}</span>
      {AXES.map(axis => (
        <label key={axis.label} className="vec3__cell">
          <span
            className="vec3__axis"
            style={{ color: axis.color }}
            onPointerDown={event => {
              if (disabled || event.button !== 0) return
              event.preventDefault()
              useEditorStore.getState().beginGesture(gesture)
              const origin: Vec3 = [...value]
              let current = value[axis.key]
              let last = event.clientX
              const move = (ev: PointerEvent) => {
                const dx = ev.clientX - last
                last = ev.clientX
                const speed = ev.shiftKey ? 0.1 : 1
                current += dx * step * speed
                const next: Vec3 = [...origin]
                next[axis.key] = current
                onChange(next)
              }
              const up = () => {
                window.removeEventListener('pointermove', move)
                window.removeEventListener('pointerup', up)
                useEditorStore.getState().endGesture()
              }
              window.addEventListener('pointermove', move)
              window.addEventListener('pointerup', up)
            }}
            onDoubleClick={() => {
              if (disabled) return
              const store = useEditorStore.getState()
              store.beginGesture(gesture)
              const copy: Vec3 = [...value]
              copy[axis.key] = reset
              onChange(copy)
              store.endGesture()
            }}
          >
            {axis.label}
          </span>
          <NumberField
            value={value[axis.key]}
            disabled={disabled}
            onBegin={() => useEditorStore.getState().beginGesture(gesture)}
            onChange={next => {
              const copy: Vec3 = [...value]
              copy[axis.key] = next
              onChange(copy)
            }}
            onEnd={() => useEditorStore.getState().endGesture()}
          />
        </label>
      ))}
    </div>
  )
}

function NumberRow({
  label,
  value,
  step,
  min,
  max,
  gesture,
  onChange,
}: {
  label: string
  value: number
  step: number
  min?: number
  max?: number
  gesture: string
  onChange: (value: number) => void
}) {
  const ranged = min !== undefined && max !== undefined
  const field = (
    <NumberField
      value={value}
      step={step}
      onBegin={() => useEditorStore.getState().beginGesture(gesture)}
      onChange={onChange}
      onEnd={() => useEditorStore.getState().endGesture()}
    />
  )
  return (
    <label className="field">
      <span>{label}</span>
      {ranged ? (
        <span className="field__range">
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={Math.min(max, Math.max(min, value))}
            onPointerDown={() => useEditorStore.getState().beginGesture(gesture)}
            onChange={event => onChange(Number(event.target.value))}
            onPointerUp={() => useEditorStore.getState().endGesture()}
            onBlur={() => useEditorStore.getState().endGesture()}
          />
          {field}
        </span>
      ) : field}
    </label>
  )
}

function NumberField({
  value,
  disabled,
  step,
  onBegin,
  onChange,
  onEnd,
}: {
  value: number
  disabled?: boolean
  step?: number
  onBegin: () => void
  onChange: (value: number) => void
  onEnd: () => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <input
      type="number"
      step={step ?? 0.1}
      disabled={disabled}
      value={draft ?? formatNum(value)}
      onFocus={() => {
        setDraft(formatNum(value))
        onBegin()
      }}
      onChange={event => {
        setDraft(event.target.value)
        const next = Number(event.target.value)
        if (event.target.value.trim() !== '' && Number.isFinite(next)) onChange(next)
      }}
      onBlur={() => {
        setDraft(null)
        onEnd()
      }}
    />
  )
}

function ColorField({
  label,
  value,
  gesture = translate('gesture.color'),
  onChange,
}: {
  label: string
  value: string
  gesture?: string
  onChange: (value: string) => void
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="color"
        value={toColorInput(value)}
        onFocus={() => useEditorStore.getState().beginGesture(gesture)}
        onChange={event => onChange(event.target.value)}
        onBlur={() => useEditorStore.getState().endGesture()}
      />
    </label>
  )
}

function formatNum(value: number): string {
  if (!Number.isFinite(value)) return '0'
  const rounded = Math.round(value * 1000) / 1000
  return String(rounded)
}

function toColorInput(value: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#cccccc'
}

function kindColor(kind: NodeKind): string {
  if (isLight(kind)) return '#ffd36b'
  if (kind === 'camera' || kind === 'screen') return '#4a9eff'
  if (isMesh(kind)) return '#f5a623'
  return '#999999'
}
