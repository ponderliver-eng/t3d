import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Bone, ChevronDown, ChevronRight, Component, ExternalLink, Eye, FolderOpen, FolderSearch, Image as ImageIcon, MapPin, Move, Package, Pause, Play, Plus, Rotate3d, Scaling, Search, Square, SunMedium, Trash2, Undo2, Unlink, Upload, X } from 'lucide-react'
import { clipDuration, clipNamesFor, getModelTemplate, loadModelTemplate, subscribeModels, type ModelTreeNode } from '../assets/models'
import { ClipField } from './ClipPicker'
import { activeAnimatorState, emptyAnimator } from '../animation/animator'
import { HumanoidCard } from './HumanoidCard'
import { AnimatorCard } from './AnimatorCard'
import { ASSET_MIME, reimportModel, saveMaterialFromNode, savePrefabFromSelection, openAsset } from '../assets/import'
import { primaryId, useEditorStore } from '../scene/store'
import { isLight, isMesh } from '../scene/kinds'
import { capabilityEnabled } from '../../capabilities/registry'
import { defaultNodePhysics } from '../../capabilities/physics/defaults'
import { defaultNodeNavigation } from '../../capabilities/navigation/defaults'
import { EffectModules } from '../../capabilities/particles/EffectModules'
import { openProjectSettings } from '../project/ProjectSettingsDialog'
import { PhysicsCard } from '../../capabilities/physics/PhysicsCard'
import { CharacterCard } from '../../runtime/CharacterCard'
import { RulesCard } from '../../runtime/RulesCard'
import { emptyRule } from '../../runtime/sceneRuntime'
import { CameraCard } from '../../runtime/CameraCard'
import { InteractCard, TriggerCard, MoverCard, CheckpointCard, ScoreCard } from '../../runtime/DeviceCards'
import { listEnabledPackComponents } from '../../gameplay/registry'
import {
  cameraPresetForMode,
  defaultCameraFollow,
  defaultCharacter,
  defaultCheckpoint,
  defaultInteract,
  defaultMover,
  defaultScore,
  defaultTrigger,
} from '../../runtime/sceneRuntime'
import { EffectCard } from '../../capabilities/particles/EffectCard'
import { NavigationCard, SceneNavigationCard } from '../../capabilities/navigation/NavigationCards'
import { SkyCard } from '../../capabilities/sky/SkyCard'
import { audioMixPatch, readAudioMix } from '../../runtime/audio'
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
  const playDirty = useEditorStore(state => state.playDirty)
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
  const subSelection = useInspectorMemory(state => state.subSelection)
  const activeSub = node && subSelection?.nodeId === node.id ? subSelection : null
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
      {playing && playDirty && (
        <div className="inspector__banner inspector__banner--play">
          <span>{t('inspector.playBanner')}</span>
          <button
            type="button"
            className="inspector__banner-btn"
            disabled={!playDirty}
            title={t('tool.keepPlayChanges')}
            onClick={() => useEditorStore.getState().keepPlayChanges()}
          >
            {t('inspector.keepPlayChanges')}
          </button>
        </div>
      )}
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

      {activeSub && (
        <div className="sub-crumb">
          <span className={`sub-crumb__badge is-${activeSub.kind}`}>{activeSub.name}</span>
          <button type="button" onClick={() => useInspectorMemory.getState().clearSubSelection()}>{t('inspector.backToModel')}</button>
        </div>
      )}

      {activeSub?.kind === 'bone' && <BoneSocketCard node={node} sub={activeSub} disabled={locked || playing} />}

      {templateRoot && <div className="inspector__banner">{t('prefab.rootLocked')}</div>}
      {prefabRoot && isPrefabRoot(prefabRoot) && (
        <Card id="prefab" title={t('prefab.instance')} color="#c79bff">
          <div className="prefab-actions">
            <div className="prefab-actions__name">
              <Component size={13} />
              <span>{prefabAssets.find(item => item.id === prefabRoot.prefabAssetId)?.name ?? t('prefab.missing')}</span>
              {instanceDirty(nodes, prefabRoot.id) && <em title={t('prefab.dirty')}>*</em>}
              {!prefabAssets.some(item => item.id === prefabRoot.prefabAssetId) && (
                <button type="button" className="prefab-actions__unpack" title={t('prefab.unpack')} onClick={() => setUnpackId(prefabRoot.id)}>{t('prefab.shortUnpack')}</button>
              )}
            </div>
            {prefabAssets.some(item => item.id === prefabRoot.prefabAssetId) ? (
              <>
                <button type="button" title={t('prefab.edit')} aria-label={t('prefab.edit')} onClick={() => useEditorStore.getState().openPrefab(prefabRoot.prefabAssetId ?? '')}><FolderOpen size={14} /></button>
                <button type="button" title={t('prefab.reveal')} aria-label={t('prefab.reveal')} onClick={() => revealPrefabAsset(prefabRoot.prefabAssetId ?? '')}><MapPin size={14} /></button>
                <button type="button" title={t('prefab.apply')} aria-label={t('prefab.apply')} disabled={!instanceDirty(nodes, prefabRoot.id)} onClick={() => useEditorStore.getState().applyPrefabInstance(prefabRoot.id)}><Upload size={14} /></button>
                <button type="button" title={t('prefab.revert')} aria-label={t('prefab.revert')} disabled={!instanceDirty(nodes, prefabRoot.id)} onClick={() => useEditorStore.getState().revertPrefabInstance(prefabRoot.id)}><Undo2 size={14} /></button>
                <button type="button" title={t('prefab.unpack')} aria-label={t('prefab.unpack')} onClick={() => setUnpackId(prefabRoot.id)}><Unlink size={14} /></button>
              </>
            ) : (
              <div className="prefab-actions__rebind">
                <select value={rebindId} onChange={event => setRebindId(event.target.value)}>
                  <option value="">{t('prefab.rebindPick')}</option>
                  {prefabAssets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                <button type="button" disabled={!rebindId} onClick={() => useEditorStore.getState().rebindPrefab(prefabRoot.prefabAssetId ?? '', rebindId)}>{t('prefab.rebind')}</button>
              </div>
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
          <button type="button" title={t('inspector.resetPosition')} aria-label={t('inspector.resetPosition')} disabled={locked || templateRoot} onClick={() => resetTransform(node.id, { position: [0, 0, 0] })}><Move size={14} /></button>
          <button type="button" title={t('inspector.resetRotation')} aria-label={t('inspector.resetRotation')} disabled={locked || templateRoot} onClick={() => resetTransform(node.id, { rotation: [0, 0, 0] })}><Rotate3d size={14} /></button>
          <button type="button" title={t('inspector.resetScale')} aria-label={t('inspector.resetScale')} disabled={locked || templateRoot} onClick={() => resetTransform(node.id, { scale: [1, 1, 1] })}><Scaling size={14} /></button>
        </div>
      </Card>

      {(isMesh(node.kind) || node.kind === 'model') && <MeshRendererCard node={node} />}

      {node.kind === 'model' && (
        <Card id="model" title={t('inspector.model')} color={kindColor(node.kind)}>
          <Section title={node.animator?.enabled === true ? t('anim.machine') : t('anim.simple')} color="#f2cf7f">
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
          </Section>
          <Section title={t('anim.end')} color="#e7c56a">
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
          </Section>
          {node.animator?.enabled === true && <AnimatorCard nodeId={node.id} />}
          {node.assetId && <HumanoidCard assetId={node.assetId} />}
        </Card>
      )}

      {isLight(node.kind) && (
        <Card id="light" title={t('inspector.light')} color={kindColor(node.kind)}>
          <Section title={t('inspector.color')} color="#ffd36b">
            <ColorField
              label={t('inspector.color')}
              value={node.color}
              gesture={t('gesture.light')}
              onChange={color => useEditorStore.getState().updateNode(node.id, { color })}
            />
            <div className="iv2-pair">
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
            </div>
            {node.kind === 'hemisphere-light' && (
              <ColorField
                label={t('inspector.ground')}
                value={node.groundColor}
                gesture={t('gesture.light')}
                onChange={groundColor => useEditorStore.getState().updateNode(node.id, { groundColor })}
              />
            )}
          </Section>
          {node.kind !== 'hemisphere-light' && (
            <Section title={t('inspector.range')} color="#ffe08a">
              <div className="iv2-pair">
                {node.kind !== 'directional-light' && (
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
              </div>
            </Section>
          )}
          {node.kind !== 'hemisphere-light' && (
            <Section title={t('inspector.shadow')} color="#fff1c2">
              <label className="field">
                <span>{t('inspector.shadow')}</span>
                <input type="checkbox" checked={node.castShadow} onChange={event => commitNode(node.id, t('gesture.light'), { castShadow: event.target.checked })} />
              </label>
              <div className="iv2-pair">
                <NumberRow label={t('inspector.bias')} value={node.shadowBias} step={0.0001} gesture={t('gesture.light')} onChange={shadowBias => useEditorStore.getState().updateNode(node.id, { shadowBias })} />
                <NumberRow label={t('inspector.normalBias')} value={node.shadowNormalBias} min={0} max={1} step={0.001} gesture={t('gesture.light')} onChange={shadowNormalBias => useEditorStore.getState().updateNode(node.id, { shadowNormalBias })} />
              </div>
            </Section>
          )}
        </Card>
      )}

      {node.kind === 'camera' && (
        <Card id="camera" title={t('inspector.camera')} color={kindColor(node.kind)}>
          <Section title={t('inspector.fov')} color="#7aa2ff">
            <NumberRow
              label={t('inspector.fov')}
              value={node.fov}
              min={10}
              max={120}
              step={0.2}
              gesture={t('gesture.camera')}
              onChange={fov => useEditorStore.getState().updateNode(node.id, { fov })}
            />
            <div className="iv2-pair">
              <NumberRow label={t('inspector.near')} value={node.near} min={0.01} max={20} step={0.01} gesture={t('gesture.camera')} onChange={near => useEditorStore.getState().updateNode(node.id, { near })} />
              <NumberRow label={t('inspector.far')} value={node.far} min={1} max={500} step={1} gesture={t('gesture.camera')} onChange={far => useEditorStore.getState().updateNode(node.id, { far })} />
            </div>
          </Section>
        </Card>
      )}

      {node.kind === 'effect' && <EffectCard node={node} disabled={locked} />}
      {node.kind === 'screen' && <ScreenCard node={node} locked={locked} playing={playing} />}

      <CharacterCard node={node} disabled={locked} />
      <CameraCard node={node} disabled={locked} />
      <InteractCard node={node} disabled={locked} />
      <TriggerCard node={node} disabled={locked} />
      <MoverCard node={node} disabled={locked} />
      <CheckpointCard node={node} disabled={locked} />
      <ScoreCard node={node} disabled={locked} />
      <RulesCard node={node} disabled={locked} />
      <PackComponentCards node={node} disabled={locked} />
      <PhysicsCard node={node} disabled={locked} />
      <NavigationCard node={node} disabled={locked} />

      <AddComponentPicker node={node} disabled={locked} />
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
          <MaterialEditor slot={normalizeSlot(asset.slot)} onChange={patch => applyMaterialPatch(asset.id, patch)} />
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
          <Section title={t('inspector.type')} color="#4a9eff">
          <label className="field"><span>{t('inspector.type')}</span><span>{assetKindLabel(asset.kind)}</span></label>
          {'fileName' in asset && <label className="field"><span>{t('inspector.file')}</span><span>{asset.fileName}</span></label>}
          {asset.kind === 'scene' && <label className="field"><span>{t('inspector.objects')}</span><span>{Object.keys(asset.nodes).length}</span></label>}
          {asset.kind === 'prefab' && <label className="field"><span>{t('inspector.objects')}</span><span>{Object.keys(asset.nodes).length}</span></label>}
          {asset.kind === 'ui' && <button type="button" onClick={() => openUiEditor(asset.id)}>{t('ui.open')}</button>}
          {asset.kind === 'model' && <label className="field"><span>{t('inspector.clips')}</span><span>{clipNamesFor(asset.id).length}</span></label>}
          </Section>
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

function SceneColumn({ title, children }: { title: string, children: ReactNode }) {
  return (
    <section className="inspector-column">
      <h3 className="inspector-column__title">{title}</h3>
      <div className="inspector-column__body">{children}</div>
    </section>
  )
}

function SceneSettings() {
  const { t } = useI18n()
  const picture = useEditorStore(state => state.picture)
  const playing = useEditorStore(state => state.playState !== 'stopped')
  const playDirty = useEditorStore(state => state.playDirty)
  const capabilities = useEditorStore(state => state.capabilities)
  const physicsOn = capabilityEnabled(capabilities, 'physics')
  const activeSceneId = useEditorStore(state => state.activeSceneId)
  const scene = useAssetStore(state => state.assets[activeSceneId])
  const name = scene?.kind === 'scene' ? scene.name : t('inspector.unnamedScene')
  const set = (patch: Partial<ScenePicture>) => useEditorStore.getState().setPicture(patch)
  return (
    <>
      {playing && playDirty && (
        <div className="inspector__banner inspector__banner--play">
          <span>{t('inspector.playBanner')}</span>
          <button
            type="button"
            className="inspector__banner-btn"
            disabled={!playDirty}
            title={t('tool.keepPlayChanges')}
            onClick={() => useEditorStore.getState().keepPlayChanges()}
          >
            {t('inspector.keepPlayChanges')}
          </button>
        </div>
      )}
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
      <SceneColumn title={t('inspector.column.system')}>
      {capabilityEnabled(capabilities, 'sky') ? null : (
        <Card id="sky" title={t('inspector.sky')} color="#4a9eff">
          <Section title={t('inspector.background')} color="#4a9eff">
            <ColorField label={t('inspector.background')} value={picture.background} gesture={t('gesture.picture')} onChange={background => set({ background })} />
          </Section>
        </Card>
      )}
      <Card id="tone" title={t('inspector.toneMapping')} color="#8ec5ff">
        <Section title={t('inspector.toneMapping')} color="#8ec5ff">
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
        </Section>
      </Card>
      <Card id="fog" title={t('inspector.fog')} color="#90a4ae">
        <Section title={t('inspector.fog')} color="#90a4ae">
          <label className="field"><span>{t('inspector.enabled')}</span><input type="checkbox" checked={picture.fog} onChange={event => set({ fog: event.target.checked })} /></label>
          {picture.fog && (
            <>
              <ColorField label={t('inspector.fogColor')} value={picture.fogColor} gesture={t('gesture.picture')} onChange={fogColor => set({ fogColor })} />
              <div className="iv2-pair">
                <NumberRow label={t('inspector.fogStart')} value={picture.fogNear} min={0} max={200} step={0.5} gesture={t('gesture.picture')} onChange={fogNear => set({ fogNear })} />
                <NumberRow label={t('inspector.fogEnd')} value={picture.fogFar} min={0} max={400} step={0.5} gesture={t('gesture.picture')} onChange={fogFar => set({ fogFar })} />
              </div>
            </>
          )}
        </Section>
      </Card>
      {!capabilityEnabled(capabilities, 'sky') && (
        <Card id="environment" title={t('inspector.environment')} color="#ffd36b">
          <Section title={t('inspector.environment')} color="#ffd36b">
            <EnvField value={picture.envAssetId} onChange={envAssetId => set({ envAssetId })} />
          </Section>
        </Card>
      )}
      <Card id="aa" title={t('inspector.aa')} color="#26c6da">
        <Section title={t('inspector.enabled')} color="#26c6da">
          <label className="field"><span>{t('inspector.enabled')}</span><input type="checkbox" checked={picture.aa !== false} onChange={event => set({ aa: event.target.checked })} /></label>
        </Section>
      </Card>
      <Card id="bloom" title={t('inspector.bloom')} color="#ab47bc">
        <Section title={t('inspector.bloom')} color="#ab47bc">
          <label className="field"><span>{t('inspector.enabled')}</span><input type="checkbox" checked={picture.bloom} onChange={event => set({ bloom: event.target.checked })} /></label>
          {picture.bloom && (
            <div className="iv2-pair">
              <NumberRow label={t('inspector.intensity')} value={picture.bloomStrength} min={0} max={2} step={0.01} gesture={t('gesture.picture')} onChange={bloomStrength => set({ bloomStrength })} />
              <NumberRow label={t('inspector.radius')} value={picture.bloomRadius} min={0} max={1} step={0.01} gesture={t('gesture.picture')} onChange={bloomRadius => set({ bloomRadius })} />
              <NumberRow label={t('inspector.threshold')} value={picture.bloomThreshold} min={0} max={1} step={0.01} gesture={t('gesture.picture')} onChange={bloomThreshold => set({ bloomThreshold })} />
            </div>
          )}
        </Section>
      </Card>
      <Card id="volume" title={t('inspector.volume')} color="#80deea">
        <Section title={t('inspector.volume')} color="#80deea">
          <label className="field"><span>{t('inspector.enabled')}</span><input type="checkbox" checked={picture.volume} onChange={event => set({ volume: event.target.checked })} /></label>
          {picture.volume && (
            <>
              <ColorField label={t('inspector.color')} value={picture.volumeColor} gesture={t('gesture.picture')} onChange={volumeColor => set({ volumeColor })} />
              <div className="iv2-pair">
                <NumberRow label={t('inspector.volumeDensity')} value={picture.volumeDensity} min={0} max={2} step={0.01} gesture={t('gesture.picture')} onChange={volumeDensity => set({ volumeDensity })} />
                <NumberRow label={t('inspector.volumeSteps')} value={picture.volumeSteps} min={4} max={64} step={1} gesture={t('gesture.picture')} onChange={volumeSteps => set({ volumeSteps })} />
                <NumberRow label={t('inspector.volumeSize')} value={picture.volumeSize} min={1} max={200} step={1} gesture={t('gesture.picture')} onChange={volumeSize => set({ volumeSize })} />
                <NumberRow label={t('inspector.volumeHeight')} value={picture.volumeHeight} min={0.5} max={80} step={0.5} gesture={t('gesture.picture')} onChange={volumeHeight => set({ volumeHeight })} />
              </div>
            </>
          )}
        </Section>
      </Card>
      <Card id="ssgi" title={t('inspector.ssgi')} color="#7e57c2">
        <Section title={t('inspector.ssgi')} color="#7e57c2">
          <label className="field"><span>{t('inspector.enabled')}</span><input type="checkbox" checked={picture.ssgi} onChange={event => set({ ssgi: event.target.checked })} /></label>
          {picture.ssgi && (
            <>
              <div className="iv2-pair">
                <NumberRow label={t('inspector.ssgiIndirect')} value={picture.ssgiIntensity} min={0} max={40} step={0.5} gesture={t('gesture.picture')} onChange={ssgiIntensity => set({ ssgiIntensity })} />
                <NumberRow label={t('inspector.ssgiOcclusion')} value={picture.ssgiOcclusion} min={0} max={4} step={0.05} gesture={t('gesture.picture')} onChange={ssgiOcclusion => set({ ssgiOcclusion })} />
                <NumberRow label={t('inspector.ssgiRadius')} value={picture.ssgiRadius} min={1} max={25} step={0.5} gesture={t('gesture.picture')} onChange={ssgiRadius => set({ ssgiRadius })} />
                <NumberRow label={t('inspector.ssgiSlices')} value={picture.ssgiSlices} min={1} max={4} step={1} gesture={t('gesture.picture')} onChange={ssgiSlices => set({ ssgiSlices })} />
                <NumberRow label={t('inspector.ssgiSteps')} value={picture.ssgiSteps} min={1} max={32} step={1} gesture={t('gesture.picture')} onChange={ssgiSteps => set({ ssgiSteps })} />
              </div>
              <label className="field"><span>{t('inspector.ssgiDenoise')}</span><input type="checkbox" checked={picture.ssgiDenoise} onChange={event => set({ ssgiDenoise: event.target.checked })} /></label>
            </>
          )}
        </Section>
      </Card>
      <Card id="ssr" title={t('inspector.ssr')} color="#5c6bc0">
        <Section title={t('inspector.ssr')} color="#5c6bc0">
          <label className="field"><span>{t('inspector.enabled')}</span><input type="checkbox" checked={picture.ssr} onChange={event => set({ ssr: event.target.checked })} /></label>
          {picture.ssr && (
            <div className="iv2-pair">
              <NumberRow label={t('inspector.ssrQuality')} value={picture.ssrQuality} min={0} max={1} step={0.05} gesture={t('gesture.picture')} onChange={ssrQuality => set({ ssrQuality })} />
              <NumberRow label={t('inspector.ssrDistance')} value={picture.ssrDistance} min={0.2} max={30} step={0.1} gesture={t('gesture.picture')} onChange={ssrDistance => set({ ssrDistance })} />
              <NumberRow label={t('inspector.ssrThickness')} value={picture.ssrThickness} min={0.001} max={0.2} step={0.001} gesture={t('gesture.picture')} onChange={ssrThickness => set({ ssrThickness })} />
              <NumberRow label={t('inspector.intensity')} value={picture.ssrIntensity} min={0} max={2} step={0.05} gesture={t('gesture.picture')} onChange={ssrIntensity => set({ ssrIntensity })} />
            </div>
          )}
        </Section>
      </Card>
      <Card id="dof" title={t('inspector.dof')} color="#26a69a">
        <Section title={t('inspector.dof')} color="#26a69a">
          <label className="field"><span>{t('inspector.enabled')}</span><input type="checkbox" checked={picture.dof} onChange={event => set({ dof: event.target.checked })} /></label>
          {picture.dof && (
            <div className="iv2-pair">
              <NumberRow label={t('inspector.focus')} value={picture.dofFocus} min={0} max={50} step={0.1} gesture={t('gesture.picture')} onChange={dofFocus => set({ dofFocus })} />
              <NumberRow label={t('inspector.focal')} value={picture.dofFocal} min={0} max={20} step={0.05} gesture={t('gesture.picture')} onChange={dofFocal => set({ dofFocal })} />
              <NumberRow label={t('inspector.bokeh')} value={picture.dofBokeh} min={0} max={10} step={0.05} gesture={t('gesture.picture')} onChange={dofBokeh => set({ dofBokeh })} />
            </div>
          )}
        </Section>
      </Card>
      <Card id="occlusion" title={t('inspector.occlusion')} color="#78909c">
        <Section title={t('inspector.enabled')} color="#78909c">
          <label className="field"><span>{t('inspector.enabled')}</span><input type="checkbox" checked={picture.ao} onChange={event => set({ ao: event.target.checked })} /></label>
        </Section>
      </Card>
      <Card id="grade" title={t('inspector.grade')} color="#ef6c00">
        <Section title={t('inspector.grade')} color="#ef6c00">
          <div className="iv2-pair">
            <NumberRow label={t('inspector.hue')} value={picture.hue} min={-1} max={1} step={0.01} gesture={t('gesture.picture')} onChange={hue => set({ hue })} />
            <NumberRow label={t('inspector.saturation')} value={picture.saturation} min={0} max={2} step={0.01} gesture={t('gesture.picture')} onChange={saturation => set({ saturation })} />
          </div>
        </Section>
      </Card>
      <Card id="scene-audio" title={t('audio.title')} color="#26a69a">
        <Section title={t('audio.title')} color="#26a69a">
          <div className="iv2-pair">
            <NumberRow label={t('audio.master')} value={readAudioMix(picture).master} min={0} max={1} step={0.01} gesture={t('gesture.picture')} onChange={master => set(audioMixPatch(picture, { master }))} />
            <NumberRow label={t('audio.music')} value={readAudioMix(picture).music} min={0} max={1} step={0.01} gesture={t('gesture.picture')} onChange={music => set(audioMixPatch(picture, { music }))} />
            <NumberRow label={t('audio.sfx')} value={readAudioMix(picture).sfx} min={0} max={1} step={0.01} gesture={t('gesture.picture')} onChange={sfx => set(audioMixPatch(picture, { sfx }))} />
          </div>
          <p className="settings-note">{t('audio.hint')}</p>
        </Section>
      </Card>
      </SceneColumn>
      <SceneColumn title={t('inspector.column.packs')}>
      {physicsOn && (
        <Card id="scene-physics" title={t('physics.title')} color="#8bc34a">
          <Section title={t('physics.gravity')} color="#8bc34a">
            <Vec3Fields
              label={t('physics.gravity')}
              value={picture.gravity ?? [0, -9.81, 0]}
              step={0.1}
              gesture={t('gesture.picture')}
              onChange={gravity => set({ gravity })}
            />
          </Section>
        </Card>
      )}
      {!physicsOn && (
        <Card id="scene-physics" title={t('physics.title')} color="#8bc34a">
          <p className="settings-note">{t('physics.disabledHint')}</p>
          <button type="button" onClick={openProjectSettings}>{t('menu.projectSettings')}</button>
        </Card>
      )}
      <SceneNavigationCard />
      {capabilityEnabled(capabilities, 'sky') && <SkyCard />}
      </SceneColumn>
    </>
  )
}

function BoneSocketCard({
  node,
  sub,
  disabled,
}: {
  node: SceneNode
  sub: NonNullable<ReturnType<typeof useInspectorMemory.getState>['subSelection']>
  disabled: boolean
}) {
  const { t } = useI18n()
  const socketId = useEditorStore(state => {
    for (const item of Object.values(state.nodes)) {
      if (item.parentId === node.id && item.socketBone === sub.path) return item.id
    }
    return null
  })
  return (
    <Card id="bone-socket" title={t('inspector.sockets')} color="#f2cf7f">
      <Section title={sub.name} color="#f2cf7f">
        <label className="field">
          <span>{t('inspector.bonePath')}</span>
          <span className="bone-socket__path" title={sub.path}>{sub.path}</span>
        </label>
        <p className="settings-note">{t('inspector.socketHint')}</p>
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            const store = useEditorStore.getState()
            if (socketId) store.setSelection([socketId])
            else store.extractSocket(node.id, sub.path, sub.name)
          }}
        >
          <Bone size={12} /> {socketId ? t('inspector.jumpSocket') : t('inspector.extractSocket')}
        </button>
      </Section>
    </Card>
  )
}

function countSlotUsers(nodes: ModelTreeNode[], slotIndex: number): number {
  let count = 0
  for (const item of nodes) {
    if (item.kind === 'mesh' && item.slotIndices.includes(slotIndex)) count += 1
    if (item.children.length > 0) count += countSlotUsers(item.children, slotIndex)
  }
  return count
}

function MeshRendererCard({ node }: { node: SceneNode }) {
  const { t } = useI18n()
  const assets = useAssetStore(state => state.assets)
  const [listOpen, setListOpen] = useInspectorCardOpen('material-slots')
  const [storedSlot, setOpenSlot] = useInspectorSlot()
  const subSelection = useInspectorMemory(state => state.subSelection)
  const activePart = node.kind === 'model' && subSelection?.nodeId === node.id && subSelection.kind === 'mesh' ? subSelection : null
  const [showAllSlots, setShowAllSlots] = useState(false)
  const [pickingPartMat, setPickingPartMat] = useState(false)
  const [dropPartMat, setDropPartMat] = useState(false)
  useEffect(() => {
    setShowAllSlots(false)
    setPickingPartMat(false)
    setDropPartMat(false)
  }, [activePart?.path])
  const openSlot = activePart && !showAllSlots && activePart.slotIndices.length > 0
    ? (storedSlot !== undefined && storedSlot !== null && activePart.slotIndices.includes(storedSlot) ? storedSlot : activePart.slotIndices[0])
    : (storedSlot === undefined ? (node.kind === 'model' && node.slots.length > 1 ? null : 0) : storedSlot)
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
  const partFiltered = activePart && !showAllSlots
    ? entries.filter(entry => activePart.slotIndices.includes(entry.index))
    : entries
  const q = query.trim().toLowerCase()
  const visible = q
    ? partFiltered.filter(entry => String(entry.index).includes(q) || entry.name.toLowerCase().includes(q) || (entry.linked ? assets[entry.linked]?.name.toLowerCase().includes(q) : t('inspector.inline').toLowerCase().includes(q)))
    : partFiltered
  const tree = node.kind === 'model' && node.assetId ? (getModelTemplate(node.assetId)?.tree ?? []) : []
  const partVisible = activePart ? !(node.hiddenParts ?? []).includes(activePart.path) : true
  const partOverride = activePart ? node.partOverrides?.[activePart.path] : undefined
  const partMatLinked = linkedMaterialId(partOverride?.materialAssetId, assets)
  const writePartOverride = (patch: Partial<{ castShadow?: boolean; receiveShadow?: boolean; materialAssetId?: string | null }>) => {
    if (!activePart) return
    const nextMap = { ...(node.partOverrides ?? {}) }
    const merged = { ...(nextMap[activePart.path] ?? {}), ...patch }
    if (merged.castShadow === undefined) delete merged.castShadow
    if (merged.receiveShadow === undefined) delete merged.receiveShadow
    if (!merged.materialAssetId) delete merged.materialAssetId
    if (Object.keys(merged).length === 0) delete nextMap[activePart.path]
    else nextMap[activePart.path] = merged
    commitNode(node.id, t('inspector.parts'), { partOverrides: Object.keys(nextMap).length > 0 ? nextMap : undefined })
  }
  const effectiveOpen = Boolean(activePart && !showAllSlots && !partMatLinked) || listOpen
  return (
    <Card id="model-renderer" title={t('inspector.modelRenderer')} color={kindColor(node.kind)}>
      {node.kind === 'model' && (
        <div className="inspector__chips">
          <button type="button" title={t('inspector.savePrefab')} aria-label={t('inspector.savePrefab')} onClick={savePrefabFromSelection}><Package size={14} /></button>
          {node.assetId && <button type="button" title={t('inspector.previewModel')} aria-label={t('inspector.previewModel')} onClick={() => openAssetPreview('model', node.assetId!, node.name)}><Eye size={14} /></button>}
        </div>
      )}
      {activePart && (
        <Section title={activePart.name} color="#9fc5ff">
          <label className="field">
            <span>{t('inspector.partVisible')}</span>
            <input
              type="checkbox"
              checked={partVisible}
              onChange={event => {
                const next = event.target.checked
                  ? (node.hiddenParts ?? []).filter(id => id !== activePart.path)
                  : [...(node.hiddenParts ?? []), activePart.path]
                commitNode(node.id, t('inspector.parts'), { hiddenParts: next })
              }}
            />
          </label>
          <div className="iv2-pair">
            <label className="field">
              <span>{t('inspector.castShadow')}</span>
              <select
                value={partOverride?.castShadow === undefined ? 'follow' : partOverride.castShadow ? 'on' : 'off'}
                onChange={event => {
                  const val = event.target.value
                  writePartOverride({ castShadow: val === 'follow' ? undefined : val === 'on' })
                }}
              >
                <option value="follow">{t('inspector.followModel')}</option>
                <option value="on">{t('inspector.on')}</option>
                <option value="off">{t('inspector.off')}</option>
              </select>
            </label>
            <label className="field">
              <span>{t('inspector.receiveShadow')}</span>
              <select
                value={partOverride?.receiveShadow === undefined ? 'follow' : partOverride.receiveShadow ? 'on' : 'off'}
                onChange={event => {
                  const val = event.target.value
                  writePartOverride({ receiveShadow: val === 'follow' ? undefined : val === 'on' })
                }}
              >
                <option value="follow">{t('inspector.followModel')}</option>
                <option value="on">{t('inspector.on')}</option>
                <option value="off">{t('inspector.off')}</option>
              </select>
            </label>
          </div>
          <div
            className={`field ${dropPartMat ? 'is-drop' : ''}`}
            onDragOver={event => {
              if ([...event.dataTransfer.types].includes(ASSET_MIME)) {
                event.preventDefault()
                event.stopPropagation()
                setDropPartMat(true)
              }
            }}
            onDragLeave={() => setDropPartMat(false)}
            onDrop={event => {
              const id = materialIdFromDrop(event)
              setDropPartMat(false)
              if (id) writePartOverride({ materialAssetId: id })
            }}
          >
            <span>{t('inspector.partMaterial')}</span>
            <div className="mesh-slot__row" style={{ flex: 1, minWidth: 0 }}>
              <button type="button" className="mesh-slot__pick asset-ref" onClick={() => setPickingPartMat(true)}>
                <span>{partMatLinked ? (assets[partMatLinked]?.name ?? t('inspector.followSlot')) : t('inspector.followSlot')}</span>
                <Search size={12} />
              </button>
              {partMatLinked && (
                <>
                  <button type="button" title={t('inspector.reveal')} onClick={() => useEditorStore.getState().inspectAsset(partMatLinked)}>
                    <FolderSearch size={12} />
                  </button>
                  <button type="button" title={t('inspector.clear')} onClick={() => writePartOverride({ materialAssetId: undefined })}>
                    <Trash2 size={12} />
                  </button>
                </>
              )}
            </div>
            {pickingPartMat && (
              <AssetPicker
                title={t('picker.material')}
                kinds={['material']}
                selectedId={partMatLinked}
                onSelect={id => {
                  writePartOverride({ materialAssetId: id ?? undefined })
                  setPickingPartMat(false)
                }}
                onClose={() => setPickingPartMat(false)}
              />
            )}
          </div>
        </Section>
      )}
      <Section title={t('inspector.shadow')} color="#ffd36b">
        <div className="shadow-flags">
          <label>
            <SunMedium size={13} />
            <span>{t('inspector.castShadow')}</span>
            <input type="checkbox" checked={node.castShadow} onChange={event => commitNode(node.id, t('gesture.shadow'), { castShadow: event.target.checked })} />
          </label>
          <label>
            <Square size={13} />
            <span>{t('inspector.receiveShadow')}</span>
            <input type="checkbox" checked={node.receiveShadow} onChange={event => commitNode(node.id, t('gesture.shadow'), { receiveShadow: event.target.checked })} />
          </label>
        </div>
      </Section>
      <Section title={t('inspector.materialSlots')} color="#d4b8ff">
      <div className="mesh-slots__bar">
        <button type="button" className="mesh-slots__head" aria-expanded={effectiveOpen} onClick={() => setListOpen(!listOpen)}>
          {effectiveOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span>{t('inspector.materialSlots')}</span>
          <em>{visible.length}</em>
        </button>
        {activePart && entries.length > partFiltered.length && (
          <button type="button" className="mesh-slots__filter" onClick={() => setShowAllSlots(value => !value)}>
            {showAllSlots ? t('inspector.partSlotsOnly') : t('inspector.showAllSlots', { count: entries.length })}
          </button>
        )}
      </div>
      {effectiveOpen && visible.length >= 6 && (
        <input className="mesh-slots__search" value={query} placeholder={t('inspector.searchSlots')} onChange={event => setQuery(event.target.value)} />
      )}
      {effectiveOpen && visible.map(entry => {
        const open = openSlot === entry.index
        const picked = flashNonce !== 0 && pickedFocus?.nonce === flashNonce && pickedFocus.slot === entry.index
        const source = node.kind === 'model' ? node.slots[entry.index] : null
        const resolved = source ? resolveModelSlot(source) : slotFromNode(node)
        const linked = entry.linked
        const shared = activePart && !showAllSlots && tree.length > 0 && countSlotUsers(tree, entry.index) > 1
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
                {shared && <div className="inspector__banner">{t('inspector.sharedSlotHint')}</div>}
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
      </Section>
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

const MAP_KEYS = new Set(['mapAssetId', 'normalAssetId', 'metallicRoughnessAssetId', 'roughnessAssetId', 'metalnessAssetId', 'emissiveAssetId', 'aoAssetId'])

function isMapPatch(patch: Partial<PbrSlot>): boolean {
  const keys = Object.keys(patch)
  return keys.length > 0 && keys.every(key => MAP_KEYS.has(key))
}

function mapLabel(patch: Partial<PbrSlot>): string {
  const clearing = Object.values(patch).every(value => value == null)
  return translate(clearing ? 'gesture.mapClear' : 'gesture.map')
}

function applyMaterialPatch(id: string, patch: Partial<PbrSlot>) {
  if (isMapPatch(patch)) {
    useEditorStore.getState().commitMaterial(id, patch, mapLabel(patch))
    return
  }
  useAssetStore.getState().updateMaterial(id, patch)
}

function writeSlot(nodeId: string, slotIndex: number | null, linked: string | null, patch: Partial<PbrSlot>) {
  if (linked) {
    applyMaterialPatch(linked, patch)
    return
  }
  const node = useEditorStore.getState().nodes[nodeId]
  if (!node) return
  const next = node.kind === 'model' && slotIndex != null
    ? { slots: node.slots.map((item, index) => index === slotIndex ? { ...item, ...patch } : item) }
    : patch
  if (isMapPatch(patch)) {
    commitNode(nodeId, mapLabel(patch), next)
    return
  }
  useEditorStore.getState().updateNode(nodeId, next)
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
  const shaderKind = slot.shader ?? 'lit'
  const lit = shaderKind === 'lit' || shaderKind === 'unity-standard'
  const isUnity = shaderKind === 'unity-standard'
  const particle = shaderKind === 'particle-unlit'
  const textured = shaderKind !== 'unlit-color'
  return (
    <>
      <Section title={t('material.shader')} color="#d4b8ff">
        <label className="field">
          <span>{t('material.shader')}</span>
          <select value={shaderKind} onChange={event => {
            const shader = event.target.value as SurfaceShader
            onChange(shader === 'particle-unlit'
              ? { shader, particleBlend: slot.particleBlend ?? 'additive', depthWrite: false, cull: 'off', alphaMode: 'blend' }
              : { shader })
          }}>
            <option value="lit">{t('material.lit')}</option>
            <option value="unity-standard">{t('material.unityStandard')}</option>
            <option value="unlit-color">{t('material.unlitColor')}</option>
            <option value="unlit-texture">{t('material.unlitTexture')}</option>
            <option value="particle-unlit">{t('material.particle')}</option>
          </select>
        </label>
      </Section>
      <Section title={t('material.surface')} color="#c9a6ff">
        <ColorField label={t('material.color')} value={slot.color} gesture={t('gesture.material')} onChange={color => onChange({ color })} />
        {textured && <MapField label={t('material.baseMap')} value={slot.mapAssetId ?? null} onChange={mapAssetId => onChange({ mapAssetId })} />}
        {lit && (
          <>
            <div className="iv2-pair">
              <NumberRow label={t('material.metalness')} value={slot.metalness} min={0} max={1} step={0.01} gesture={t('gesture.material')} onChange={metalness => onChange({ metalness })} />
              <NumberRow label={t('material.roughness')} value={slot.roughness} min={0} max={1} step={0.01} gesture={t('gesture.material')} onChange={roughness => onChange({ roughness })} />
            </div>
            <MapField
              label={isUnity ? t('material.unityMetallicGloss') : t('material.metallicRoughness')}
              title={isUnity ? t('material.unityMetallicGlossHint') : t('material.metallicRoughnessHint')}
              value={slot.metallicRoughnessAssetId ?? null}
              onChange={metallicRoughnessAssetId => onChange({ metallicRoughnessAssetId, roughnessAssetId: metallicRoughnessAssetId, metalnessAssetId: metallicRoughnessAssetId })}
            />
            <MapField label={t('material.normal')} value={slot.normalAssetId ?? null} onChange={normalAssetId => onChange({ normalAssetId })} />
            <div className="iv2-pair">
              <NumberRow label={t('material.normalScale')} value={slot.normalScale ?? 1} min={0} max={4} step={0.01} gesture={t('gesture.material')} onChange={normalScale => onChange({ normalScale })} />
              <NumberRow label={t('material.ao')} value={slot.ao} min={0} max={1} step={0.01} gesture={t('gesture.material')} onChange={ao => onChange({ ao })} />
            </div>
            <MapField label={t('material.aoMap')} title={t('material.aoMapHint')} value={slot.aoAssetId ?? null} onChange={aoAssetId => onChange({ aoAssetId })} />
          </>
        )}
      </Section>
      {lit && (
        <Section title={t('material.emission')} color="#f2cf7f">
          <ColorField label={t('material.emissionColor')} value={slot.emissive} gesture={t('gesture.material')} onChange={emissive => onChange({ emissive })} />
          <NumberRow label={t('material.emissionIntensity')} value={slot.emissiveIntensity} min={0} max={10} step={0.05} gesture={t('gesture.material')} onChange={emissiveIntensity => onChange({ emissiveIntensity })} />
          <MapField label={t('material.emissionMap')} value={slot.emissiveAssetId ?? null} onChange={emissiveAssetId => onChange({ emissiveAssetId })} />
        </Section>
      )}
      {particle && (
        <Section title={t('material.particleBlend')} color="#ffb25a">
          <label className="field">
            <span>{t('material.particleBlend')}</span>
            <select value={slot.particleBlend ?? 'additive'} onChange={event => onChange({ particleBlend: event.target.value as ParticleBlend })}>
              <option value="alpha">{t('material.blendAlpha')}</option>
              <option value="premultiply">{t('material.blendPremultiply')}</option>
              <option value="additive">{t('material.blendAdditive')}</option>
              <option value="multiply">{t('material.blendMultiply')}</option>
            </select>
          </label>
        </Section>
      )}
      {!particle && <Section title={t('material.transparency')} color="#9fd6ff">
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
      </Section>}
      <Section title={t('material.render')} color="#8ec5ff">
        <label className="field">
          <span>{t('material.cull')}</span>
          <select value={slot.cull ?? 'back'} onChange={event => onChange({ cull: event.target.value as CullMode })}>
            <option value="back">{t('material.cullBack')}</option>
            <option value="front">{t('material.cullFront')}</option>
            <option value="off">{t('material.cullOff')}</option>
          </select>
        </label>
        <div className="iv2-pair">
          <label className="field">
            <span>{t('material.depthWrite')}</span>
            <input type="checkbox" checked={slot.depthWrite ?? true} onChange={event => onChange({ depthWrite: event.target.checked })} />
          </label>
          {!particle && <label className="field">
            <span>{t('material.wireframe')}</span>
            <input type="checkbox" checked={slot.wireframe ?? false} onChange={event => onChange({ wireframe: event.target.checked })} />
          </label>}
        </div>
      </Section>
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
    const stateId = animator.stateId || states[0]?.id || ''
    const active = states.find(state => state.id === stateId) ?? states[0]
    store.updateNode(nodeId, {
      animator: { ...animator, enabled: machine, states, stateId, defaultStateId: animator.defaultStateId || states[0]?.id },
      ...(machine && active?.clip ? { clipPlaying: true, clipTime: 0 } : {}),
    })
  }
  return (
    <div className="anim-mode">
      <div className="anim-mode__tabs">
        <button type="button" className={!enabled ? 'is-on' : ''} onClick={() => choose(false)}>{t('anim.simple')}</button>
        <button type="button" className={enabled ? 'is-on' : ''} onClick={() => choose(true)}>{t('anim.machine')}</button>
      </div>
      <p>{t(enabled ? 'anim.machineHint' : 'anim.simpleHint')}</p>
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
  return (
    <div className="anim-fields">
      <div className="anim-transport">
        <button
          type="button"
          title={clipPlaying ? t('inspector.pause') : t('inspector.play')}
          aria-label={clipPlaying ? t('inspector.pause') : t('inspector.play')}
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
          {clipPlaying ? <Pause size={13} /> : <Play size={13} />}
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
      {!driven && (
        <ClipField
          label={t('inspector.clip')}
          assetId={fromFile ? (clipAssetId ?? '') : (clip ? (assetId ?? '') : '')}
          name={clip}
          onChange={next => {
            const store = useEditorStore.getState()
            if (!next) {
              store.updateNode(nodeId, { clip: '', clipAssetId: null, clipTime: 0, clipPlaying: false })
              return
            }
            const own = !assetId || next.assetId === assetId
            store.updateNode(nodeId, {
              clip: next.name,
              clipAssetId: own ? null : next.assetId,
              clipTime: 0,
              clipPlaying: true,
            })
          }}
        />
      )}
      {!driven && <AssetRef
        label={t('inspector.animFile')}
        title={t('inspector.animFile')}
        kinds={['animation', 'model']}
        include={asset => asset.kind === 'animation' || clipNamesFor(asset.id).length > 0}
        value={clipAssetId}
        onChange={id => {
          const store = useEditorStore.getState()
          if (!id) {
            store.updateNode(nodeId, { clipAssetId: null, clip: modelClips[0] ?? '', clipTime: 0, clipPlaying: Boolean(modelClips[0]) })
            return
          }
          const file = useAssetStore.getState().assets[id]
          if (!file || (file.kind !== 'animation' && file.kind !== 'model')) return
          void loadModelTemplate(file).then(() => {
            const names = clipNamesFor(id)
            useEditorStore.getState().updateNode(nodeId, {
              clipAssetId: id === assetId ? null : id,
              clip: names[0] ?? '',
              clipTime: 0,
              clipPlaying: names.length > 0,
            })
          }).catch(() => undefined)
        }}
      />}
      {!driven && (
        <div className="anim-checks">
          <label className="field">
            <span>{t('anim.loop')}</span>
            <input type="checkbox" checked={clipLoop} onChange={event => useEditorStore.getState().updateNode(nodeId, { clipLoop: event.target.checked })} />
          </label>
          <label className="field">
            <span>{t('anim.inPlace')}</span>
            <input type="checkbox" checked={clipInPlace} onChange={event => useEditorStore.getState().updateNode(nodeId, { clipInPlace: event.target.checked })} />
          </label>
        </div>
      )}
      <Section title={t('anim.speed')} color="#e7c56a">
        <div className="iv2-pair">
          {!driven && <NumberRow label={t('anim.speed')} value={clipSpeed} step={0.05} min={0.05} gesture={t('anim.speed')} onChange={speed => useEditorStore.getState().updateNode(nodeId, { clipSpeed: speed })} />}
          <NumberRow label={t('anim.fade')} value={clipFade} step={0.05} min={0} gesture={t('anim.fade')} onChange={fade => useEditorStore.getState().updateNode(nodeId, { clipFade: fade })} />
        </div>
      </Section>
      {!driven && <Section title={t('anim.mask')} color="#f2cf7f">
      <label className="field">
        <span>{t('anim.mask')}</span>
        <select value={clipMask} onChange={event => useEditorStore.getState().updateNode(nodeId, { clipMask: event.target.value as 'full' | 'upper' | 'lower' })}>
          <option value="full">{t('anim.maskFull')}</option>
          <option value="upper">{t('anim.maskUpper')}</option>
          <option value="lower">{t('anim.maskLower')}</option>
        </select>
      </label>
      <ClipField
        label={t('anim.overlay')}
        assetId={playback?.overlayAssetId || (playback?.overlayClip ? (assetId ?? '') : '')}
        name={playback?.overlayClip ?? ''}
        onChange={next => {
          const store = useEditorStore.getState()
          if (!next) {
            store.updateNode(nodeId, { overlayClip: '', overlayAssetId: null, overlayPlaying: false, overlayTime: 0 })
            return
          }
          const own = !assetId || next.assetId === assetId
          store.updateNode(nodeId, {
            overlayClip: next.name,
            overlayAssetId: own ? null : next.assetId,
            overlayTime: 0,
            overlayPlaying: true,
            overlayLoop: false,
          })
        }}
      />
      </Section>}
    </div>
  )
}

function formatClipTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0.00s'
  return `${seconds.toFixed(2)}s`
}

function MapField({ label, title, value, onChange }: { label: string; title?: string; value: string | null; onChange: (id: string | null) => void }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [dropping, setDropping] = useState(false)
  const clickTimer = useRef<number | null>(null)
  const asset = useAssetStore(state => value ? state.assets[value] : undefined)
  const texture = asset?.kind === 'texture' ? asset : undefined
  const preview = texturePreview(texture)
  useEffect(() => () => {
    if (clickTimer.current != null) window.clearTimeout(clickTimer.current)
  }, [])

  const reveal = () => {
    if (!value) return
    useEditorStore.getState().pingAsset(value)
  }
  const previewClick = () => {
    if (!texture) return
    if (clickTimer.current != null) window.clearTimeout(clickTimer.current)
    clickTimer.current = window.setTimeout(() => {
      clickTimer.current = null
      reveal()
    }, 220)
  }
  const previewDoubleClick = () => {
    if (clickTimer.current != null) {
      window.clearTimeout(clickTimer.current)
      clickTimer.current = null
    }
    if (texture) openAssetPreview('texture', texture.id, texture.name)
  }
  const acceptsDrop = (event: DragEvent) => event.dataTransfer.types.includes(ASSET_MIME)
  const takeDrop = (event: DragEvent) => {
    setDropping(false)
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
        className={`tex-slot__control${dropping ? ' is-drop' : ''}`}
        onDragEnter={event => {
          if (!acceptsDrop(event)) return
          event.preventDefault()
          setDropping(true)
        }}
        onDragOver={event => {
          if (!acceptsDrop(event)) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
          if (!dropping) setDropping(true)
        }}
        onDragLeave={event => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
          setDropping(false)
        }}
        onDrop={takeDrop}
      >
        <button
          type="button"
          className="tex-slot__preview"
          title={texture ? t('picker.textureLocate') : t('picker.textureDrop')}
          onClick={previewClick}
          onDoubleClick={previewDoubleClick}
        >
          {preview ? <img src={preview} alt={texture?.name ?? ''} /> : <ImageIcon size={12} />}
        </button>
        <button
          type="button"
          className={`tex-slot__name ${texture ? '' : 'tex-slot__name--empty'}`}
          title={texture ? t('picker.textureLocate') : t('picker.textureDrop')}
          onClick={reveal}
        >
          {dropping ? t('picker.textureDrop') : (texture?.name ?? (value ? t('picker.missing') : t('picker.unset')))}
        </button>
        <button type="button" className="tex-slot__icon" title={t('picker.textureReplace')} aria-label={t('picker.textureReplace')} onClick={() => setOpen(true)}>
          <Search size={12} />
        </button>
        {value && (
          <button type="button" className="tex-slot__icon" title={t('picker.clear')} onClick={() => onChange(null)}>
            <X size={12} />
          </button>
        )}
        {dropping && <span className="tex-slot__drop">{t('picker.textureDrop')}</span>}
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
  label, title, kinds, include, value, onChange,
}: {
  label: string
  title: string
  kinds: Array<import('../assets/library').ProjectAsset['kind']>
  include?: (asset: import('../assets/library').ProjectAsset) => boolean
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
          include={include}
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

function Section({ title, color, children }: { title: string; color: string; children: ReactNode }) {
  return (
    <section className="iv2-section">
      <div className="iv2-section__title" style={{ color }}><i /><span>{title}</span></div>
      {children}
    </section>
  )
}

function Card({ id, title, color, children }: { id: string; title: string; color: string; children: ReactNode }) {
  const [stored, setStored] = useInspectorCardOpen(id)
  const open = stored
  const setOpen = (value: boolean) => setStored(value)
  return (
    <section className="iv2-card iv2-card--wide">
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

type ComponentId = 'character' | 'cameraFollow' | 'interact' | 'trigger' | 'mover' | 'checkpoint' | 'score' | 'rules' | 'physics' | 'navigation' | (string & {})

interface ComponentOption {
  id: ComponentId
  cardId: string
  group: 'character' | 'devices' | 'world' | 'pack'
  label: string
  color: string
  added: boolean
  apply: () => void
}

function PackComponentCards({ node, disabled }: { node: SceneNode, disabled: boolean }) {
  const enabledPacks = useEditorStore(state => state.gameplayPacks)
  const packsData = node.gameplay?.packs
  if (!packsData || typeof packsData !== 'object') return null
  const registered = listEnabledPackComponents(enabledPacks)
  return (
    <>
      {registered.map(({ packId, def }) => {
        const bag = packsData[packId] as Record<string, unknown> | undefined
        if (!bag || !bag[def.componentId]) return null
        const CardView = def.Card
        return <CardView key={`${packId}:${def.componentId}`} node={node} packId={packId} componentId={def.componentId} disabled={disabled} />
      })}
    </>
  )
}

function AddComponentPicker({ node, disabled }: { node: SceneNode, disabled: boolean }) {
  const { t } = useI18n()
  const capabilities = useEditorStore(state => state.capabilities)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setOpen(false)
    setQuery('')
  }, [node.id])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const canGameplay = isMesh(node.kind) || node.kind === 'model' || node.kind === 'empty'
  const canCameraFollow = canGameplay
  const physicsEnabled = capabilityEnabled(capabilities, 'physics')
  const navEnabled = capabilityEnabled(capabilities, 'navigation')

  const options: ComponentOption[] = []
  if (canGameplay) {
    options.push({
      id: 'character',
      cardId: 'character',
      group: 'character',
      label: t('character.title'),
      color: '#6fbf73',
      added: Boolean(node.gameplay?.character),
      apply: () => {
        const nextChar = defaultCharacter()
        const gameplay = { ...node.gameplay, character: nextChar }
        if (!gameplay.cameraFollow) {
          gameplay.cameraFollow = { ...defaultCameraFollow(), ...cameraPresetForMode(nextChar.mode), enabled: true }
        }
        commitNode(node.id, t('character.title'), { gameplay })
        useInspectorMemory.getState().setOpen(`node:${node.id}`, 'character', true)
      },
    })
  }
  if (!node.gameplay?.character && canCameraFollow) {
    options.push({
      id: 'cameraFollow',
      cardId: 'follow-camera',
      group: 'character',
      label: t('camera.title'),
      color: '#7aa2ff',
      added: Boolean(node.gameplay?.cameraFollow),
      apply: () => {
        commitNode(node.id, t('camera.title'), {
          gameplay: { ...node.gameplay, cameraFollow: defaultCameraFollow() },
        })
        useInspectorMemory.getState().setOpen(`node:${node.id}`, 'follow-camera', true)
      },
    })
  }
  if (canGameplay) {
    options.push(
      {
        id: 'interact',
        cardId: 'interact',
        group: 'devices',
        label: t('interact.title'),
        color: '#e0a15a',
        added: Boolean(node.gameplay?.interact),
        apply: () => {
          commitNode(node.id, t('interact.title'), {
            gameplay: { ...node.gameplay, interact: defaultInteract() },
          })
          useInspectorMemory.getState().setOpen(`node:${node.id}`, 'interact', true)
        },
      },
      {
        id: 'trigger',
        cardId: 'trigger',
        group: 'devices',
        label: t('trigger.title'),
        color: '#d27ba0',
        added: Boolean(node.gameplay?.trigger),
        apply: () => {
          commitNode(node.id, t('trigger.title'), {
            gameplay: { ...node.gameplay, trigger: defaultTrigger() },
          })
          useInspectorMemory.getState().setOpen(`node:${node.id}`, 'trigger', true)
        },
      },
      {
        id: 'mover',
        cardId: 'mover',
        group: 'devices',
        label: t('mover.title'),
        color: '#6ec4c4',
        added: Boolean(node.gameplay?.mover),
        apply: () => {
          commitNode(node.id, t('mover.title'), {
            gameplay: { ...node.gameplay, mover: defaultMover() },
          })
          useInspectorMemory.getState().setOpen(`node:${node.id}`, 'mover', true)
        },
      },
      {
        id: 'checkpoint',
        cardId: 'checkpoint',
        group: 'devices',
        label: t('checkpoint.title'),
        color: '#d4c15a',
        added: Boolean(node.gameplay?.checkpoint),
        apply: () => {
          commitNode(node.id, t('checkpoint.title'), {
            gameplay: { ...node.gameplay, checkpoint: defaultCheckpoint() },
          })
          useInspectorMemory.getState().setOpen(`node:${node.id}`, 'checkpoint', true)
        },
      },
      {
        id: 'score',
        cardId: 'score',
        group: 'devices',
        label: t('score.title'),
        color: '#c48bdc',
        added: Boolean(node.gameplay?.score),
        apply: () => {
          commitNode(node.id, t('score.title'), {
            gameplay: { ...node.gameplay, score: defaultScore() },
          })
          useInspectorMemory.getState().setOpen(`node:${node.id}`, 'score', true)
        },
      },
      {
        id: 'rules',
        cardId: 'rules',
        group: 'devices',
        label: t('rule.title'),
        color: '#f0c674',
        added: Array.isArray(node.gameplay?.rules),
        apply: () => {
          commitNode(node.id, t('rule.title'), {
            gameplay: { ...node.gameplay, rules: node.gameplay?.rules ?? [emptyRule()] },
          })
          useInspectorMemory.getState().setOpen(`node:${node.id}`, 'rules', true)
        },
      },
    )
    if (physicsEnabled) {
      options.push({
        id: 'physics',
        cardId: 'physics',
        group: 'world',
        label: t('physics.title'),
        color: '#8bc34a',
        added: Boolean(node.physics),
        apply: () => {
          commitNode(node.id, t('physics.title'), {
            physics: defaultNodePhysics(node.kind),
          })
          useInspectorMemory.getState().setOpen(`node:${node.id}`, 'physics', true)
        },
      })
    }
    if (navEnabled) {
      options.push({
        id: 'navigation',
        cardId: 'navigation',
        group: 'world',
        label: t('navigation.title'),
        color: '#4fc3f7',
        added: Boolean(node.navigation),
        apply: () => {
          commitNode(node.id, t('navigation.title'), {
            navigation: defaultNodeNavigation(node.kind),
          })
          useInspectorMemory.getState().setOpen(`node:${node.id}`, 'navigation', true)
        },
      })
    }
  }
  const enabledPacks = useEditorStore.getState().gameplayPacks
  for (const { packId, def } of listEnabledPackComponents(enabledPacks)) {
    const allowed = def.appliesTo ? def.appliesTo.includes(node.kind) : canGameplay
    if (!allowed) continue
    const packBag = (node.gameplay?.packs?.[packId] ?? {}) as Record<string, unknown>
    options.push({
      id: `${packId}:${def.componentId}`,
      cardId: `${packId}:${def.componentId}`,
      group: def.group ?? 'pack',
      label: def.label,
      color: def.color,
      added: Boolean(packBag[def.componentId]),
      apply: () => {
        const nextBag = { ...packBag, [def.componentId]: def.defaultData() }
        const nextPacks = { ...(node.gameplay?.packs ?? {}), [packId]: nextBag }
        commitNode(node.id, def.label, {
          gameplay: { ...node.gameplay, packs: nextPacks },
        })
        useInspectorMemory.getState().setOpen(`node:${node.id}`, `${packId}:${def.componentId}`, true)
      },
    })
  }

  if (options.length === 0) return null

  const q = query.trim().toLowerCase()
  const filtered = q ? options.filter(item => item.label.toLowerCase().includes(q)) : options
  const groups: Array<{ key: ComponentOption['group'], title: string, items: ComponentOption[] }> = (
    [
      { key: 'character' as const, title: t('component.group.character') },
      { key: 'devices' as const, title: t('component.group.devices') },
      { key: 'world' as const, title: t('component.group.world') },
      { key: 'pack' as const, title: t('component.group.pack') },
    ]
  )
    .map(group => ({ ...group, items: filtered.filter(item => item.group === group.key) }))
    .filter(group => group.items.length > 0)

  return (
    <div className="add-component" ref={rootRef}>
      <button
        type="button"
        className="add-component__btn"
        disabled={disabled}
        onClick={() => setOpen(value => !value)}
      >
        <Plus size={13} />
        <span>{t('component.add')}</span>
      </button>
      {open && (
        <div className="add-component__menu">
          <div className="add-component__search">
            <Search size={12} />
            <input
              autoFocus
              value={query}
              placeholder={t('component.search')}
              onChange={event => setQuery(event.target.value)}
            />
            {query && (
              <button type="button" onClick={() => setQuery('')}>
                <X size={11} />
              </button>
            )}
          </div>
          <div className="add-component__list">
            {groups.length === 0 && (
              <div className="add-component__empty">{t('component.empty')}</div>
            )}
            {groups.map(group => (
              <div key={group.key} className="add-component__group">
                <div className="add-component__group-title">{group.title}</div>
                {group.items.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    className="add-component__item"
                    disabled={item.added}
                    onClick={() => {
                      item.apply()
                      setOpen(false)
                      setQuery('')
                    }}
                  >
                    <span className="iv2-card__dot" style={{ background: item.color }} />
                    <span>{item.label}</span>
                    {item.added && <em>{t('component.added')}</em>}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
