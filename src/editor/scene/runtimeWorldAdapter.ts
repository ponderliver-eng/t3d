import { getRuntimeWorld, setRuntimeWorld, type RuntimeWorld } from '../../runtime/world'
import { bodyProgress, playBody, playUpper, stopUpper } from '../animation/director'
import { useAssetStore } from '../assets/library'
import { particleDescFor } from '../assets/materials'
import { clipDuration } from '../assets/models'
import { instantiatePrefab, readPrefab } from '../assets/prefab'
import { ensureAssetUrl, textureFor } from '../assets/textures'
import { translate, type MessageKey } from '../i18n'
import { rapierCollisionGroups } from '../project/taxonomy'
import { registerBeforeRenderHook } from '../viewport/renderHooks'
import { useEditorStore } from './store'
import { clearPlayCameraForce, forcePlayCamera } from '../viewport/playCamera'

export function createEditorRuntimeWorld(): RuntimeWorld {
  return {
    getNodes: () => useEditorStore.getState().nodes,
    setNodes: (nodes) => useEditorStore.setState({ nodes, playDirty: true }),
    updateNode: (id, patch) => useEditorStore.getState().updateNode(id, patch),
    getActiveSceneId: () => useEditorStore.getState().activeSceneId,
    getPicture: () => useEditorStore.getState().picture,
    getCapabilities: () => useEditorStore.getState().capabilities,
    getGameplayPacks: () => useEditorStore.getState().gameplayPacks,
    getGameDatabase: () => useEditorStore.getState().gameDatabase,
    getTags: () => useEditorStore.getState().tags,
    getAsset: (id) => useAssetStore.getState().assets[id],
    listAssets: () => Object.values(useAssetStore.getState().assets),
    getPlayState: () => useEditorStore.getState().playState,
    markPlayDirty: () => useEditorStore.setState({ playDirty: true }),
    log: (level, message) => useEditorStore.getState().log(level, message),
    getSelection: () => useEditorStore.getState().selection,
    applySimulation: (poses) => useEditorStore.getState().applySimulation(poses),
    collisionGroupsForLayer: (renderLayerId) => {
      const state = useEditorStore.getState()
      return rapierCollisionGroups(
        renderLayerId,
        state.layers,
        state.physicsCollisionMatrixEnabled,
        state.physicsCollisionRowMasks,
      )
    },
    resolveTexture: (assetId) => Promise.resolve(textureFor(assetId, false)),
    getTexture: (assetId, srgb = false) => textureFor(assetId, srgb),
    resolveParticleDesc: (materialId) => particleDescFor(materialId ?? null),
    registerBeforeRenderHook: (id, order, hook) => registerBeforeRenderHook(id, order, hook as Parameters<typeof registerBeforeRenderHook>[2]),
    resolveAssetUrl: (assetId) => ensureAssetUrl(assetId),
    clipDuration: (assetId, clipName) => clipDuration(assetId ?? null, clipName),
    playBody: (nodeId, clipName, options) => {
      playBody(nodeId, {
        clip: clipName,
        ...(options?.assetId !== undefined ? { assetId: options.assetId } : {}),
        loop: options?.loop,
        fade: options?.fade,
        speed: options?.speed,
      })
    },
    playUpper: (nodeId, clipName, options) => {
      playUpper(nodeId, {
        clip: clipName,
        ...(options?.assetId !== undefined ? { assetId: options.assetId } : {}),
        loop: options?.loop,
        fade: options?.fade,
        speed: options?.speed,
      })
    },
    stopUpper: (nodeId) => stopUpper(nodeId),
    bodyProgress: (nodeId) => bodyProgress(nodeId),
    forcePlayCamera: (cameraId) => forcePlayCamera(cameraId),
    clearPlayCameraForce: () => clearPlayCameraForce(),
    instantiatePrefab: (prefabIdOrName, options) => {
      const assets = useAssetStore.getState().assets
      const asset = Object.values(assets).find(
        (item) => item.kind === 'prefab' && (item.id === prefabIdOrName || item.name === prefabIdOrName),
      )
      if (!asset || asset.kind !== 'prefab') return null
      const doc = readPrefab(asset)
      if (!doc.rootId) return null
      const nodes = structuredClone(useEditorStore.getState().nodes)
      const lookup = (assetId: string) => {
        const nested = useAssetStore.getState().assets[assetId]
        if (!nested || nested.kind !== 'prefab') return null
        const next = readPrefab(nested)
        return next.rootId ? next : null
      }
      const id = instantiatePrefab(
        nodes,
        doc,
        asset.id,
        options?.parentId ?? null,
        options?.position ?? [0, 0, 0],
        lookup,
      )
      if (!id) return null
      useEditorStore.setState({ nodes, playDirty: true })
      return id
    },
    translate: (key) => translate(key as MessageKey),
  }
}

let bound = false
export function bindEditorRuntimeWorld(): RuntimeWorld {
  if (!bound) {
    setRuntimeWorld(createEditorRuntimeWorld())
    bound = true
  }
  return getRuntimeWorld()
}
