import { Vector3 } from 'three'
import type { SceneNode } from '../../editor/scene/types'
import { playSound } from '../../runtime/audio'
import {
  applyCutsceneNodeProperty,
  clearCutsceneAnimMarks,
  clearCutsceneOverrides,
  evaluateCutsceneCameraTrack,
  evaluatePropertyKeys,
  markCutsceneAnimNode,
  setCutscenePictureOverride,
} from '../../runtime/engine/cutscene'
import { createSplinePath, type MotionVec3 } from '../../runtime/motion'
import { postRuleMessage } from '../../runtime/rules'
import { registerRuntimeSystem, RUNTIME_STAGE, type SceneRuntimeHost } from '../../runtime/sceneRuntime'
import { setScreenVisible } from '../../runtime/ui/values'
import { getRuntimeWorld } from '../../runtime/world'
import { normalizeSplinePath, SPLINE_PATH_CAPABILITY_ID } from '../spline/schema'
import type { CapabilityRuntimeModule } from '../registry'
import {
  CUTSCENE_CAPABILITY_ID,
  normalizeCutsceneDocument,
  type CutsceneSequence,
  type CutsceneTrack,
} from './schema'

interface ActivePlayback {
  sequence: CutsceneSequence
  time: number
  prevTime: number
  speed: number
  loop: boolean
  firedEvents: Set<string>
  onComplete?: () => void
}

const playbacks = new Map<string, ActivePlayback>()
let autoPlayedSceneKey = ''
let unregisterPre: (() => void) | null = null
let unregisterPostPhysics: (() => void) | null = null
let unregisterAnim: (() => void) | null = null
let unregisterCamera: (() => void) | null = null

// 编辑器停止态预览状态（仅在 playState === 'stopped' 时由时间轴面板设置）
let editorPreviewState: { sequence: CutsceneSequence; time: number } | null = null

export function setEditorCutscenePreview(sequence: CutsceneSequence | null, time = 0): void {
  if (!sequence) {
    editorPreviewState = null
    clearCutsceneOverrides()
    return
  }
  editorPreviewState = { sequence, time }
}

export function getEditorCutscenePreview(): { sequence: CutsceneSequence; time: number } | null {
  return editorPreviewState
}

function getSequences(): CutsceneSequence[] {
  const world = getRuntimeWorld()
  const picture = world.getPicture()
  const doc = normalizeCutsceneDocument(picture.capabilities?.[CUTSCENE_CAPABILITY_ID])
  const out: CutsceneSequence[] = []
  const seenIds = new Set<string>()
  const directorMap = new Map(doc.directors.map(d => [d.assetId, d]))

  // 1. 优先读取独立 CutsceneAsset 资产（合并当前场景 directors 挂载覆写）
  for (const asset of world.listAssets()) {
    if (asset.kind !== 'cutscene' || !asset.sequence) continue
    const base = asset.sequence as CutsceneSequence
    const dir = directorMap.get(asset.id)
    const merged: CutsceneSequence = dir
      ? {
          ...base,
          id: asset.id,
          name: asset.name || base.name,
          autoPlay: dir.autoPlay ?? base.autoPlay,
          loop: dir.loop ?? base.loop,
          lockPlayerInput: dir.lockPlayerInput ?? base.lockPlayerInput,
        }
      : { ...base, id: asset.id, name: asset.name || base.name }
    out.push(merged)
    seenIds.add(asset.id)
    if (base.id) seenIds.add(base.id)
  }

  // 2. 向下兼容旧版场景内嵌 sequences
  for (const seq of doc.sequences) {
    if (seenIds.has(seq.id)) continue
    out.push(seq)
  }
  return out
}

export function playCutscene(
  nameOrId: string,
  options?: { loop?: boolean; speed?: number; startTime?: number; onComplete?: () => void },
): boolean {
  const seq = getSequences().find(s => s.id === nameOrId || s.name === nameOrId)
  if (!seq) return false
  const startTime = Math.max(0, Math.min(seq.duration, options?.startTime ?? 0))
  playbacks.set(seq.id, {
    sequence: seq,
    time: startTime,
    prevTime: startTime - 1e-4,
    speed: Math.max(0.01, options?.speed ?? 1),
    loop: options?.loop ?? seq.loop,
    firedEvents: new Set(),
    onComplete: options?.onComplete,
  })
  return true
}

export function stopCutscene(nameOrId?: string): void {
  if (!nameOrId) {
    playbacks.clear()
    clearCutsceneOverrides()
    return
  }
  for (const [id, pb] of playbacks.entries()) {
    if (id === nameOrId || pb.sequence.name === nameOrId) {
      playbacks.delete(id)
    }
  }
  if (playbacks.size === 0) {
    clearCutsceneOverrides()
  }
}

export function isCutscenePlaying(nameOrId?: string): boolean {
  if (!nameOrId) return playbacks.size > 0
  for (const [id, pb] of playbacks.entries()) {
    if (id === nameOrId || pb.sequence.name === nameOrId) return true
  }
  return false
}

export function isCutsceneInputLocked(): boolean {
  for (const pb of playbacks.values()) {
    if (pb.sequence.lockPlayerInput !== false) return true
  }
  return false
}

function evalSplineTrack(
  track: CutsceneTrack,
  time: number,
  nodes: Record<string, SceneNode>,
  host: SceneRuntimeHost,
): void {
  if (!track.splineNodeId || !track.keys || track.keys.length === 0) return
  const targetObj = host.resolveObject(track.targetNodeId)
  const pathNode = nodes[track.splineNodeId]
  if (!targetObj || !pathNode) return

  const rawPath = pathNode.capabilities?.[SPLINE_PATH_CAPABILITY_ID]
  const pathData = normalizeSplinePath(rawPath)
  const pathObj = host.resolveObject(pathNode.id)
  if (pathObj) pathObj.updateMatrixWorld()
  const tmp = new Vector3()
  const points: MotionVec3[] = pathData.points.map(pt => {
    if (pathObj) {
      tmp.set(pt[0], pt[1], pt[2]).applyMatrix4(pathObj.matrixWorld)
      return { x: tmp.x, y: tmp.y, z: tmp.z }
    }
    return { x: pathNode.position[0] + pt[0], y: pathNode.position[1] + pt[1], z: pathNode.position[2] + pt[2] }
  })
  if (points.length < 2) return

  const spline = createSplinePath(points, { closed: pathData.closed, tension: pathData.tension })
  const rawProgress = evaluatePropertyKeys(track.keys, time, 'number')
  const progress = Math.max(0, Math.min(1, Number(rawProgress) || 0))
  const pt = spline.pointAt(progress)
  targetObj.position.set(pt.x, track.planeXZ ? targetObj.position.y : pt.y, pt.z)
  if (track.faceDirection !== false) {
    const tan = spline.tangentAt(progress)
    if (Math.abs(tan.x) > 1e-5 || Math.abs(tan.z) > 1e-5) {
      targetObj.rotation.y = Math.atan2(tan.x, tan.z)
    }
  }
}

export function evaluateCutsceneTracks(
  seq: CutsceneSequence,
  time: number,
  nodes: Record<string, SceneNode>,
  host: SceneRuntimeHost,
  phase: 'transform' | 'animation' | 'render',
): void {
  for (const track of seq.tracks) {
    if (track.muted) continue
    if (phase === 'transform') {
      if (track.kind === 'spline') {
        evalSplineTrack(track, time, nodes, host)
        continue
      }
      if (track.kind === 'activation' && track.spans) {
        const obj = host.resolveObject(track.targetNodeId)
        if (obj) {
          const hit = track.spans.find(s => time >= s.startTime && time <= s.startTime + s.duration)
          if (hit) obj.visible = hit.active
        }
        continue
      }
      if (track.kind === 'property' && track.targetNodeId && track.targetNodeId !== '__picture__' && track.keys) {
        const p = track.propertyPath ?? ''
        if (p === 'position' || p === 'rotation' || p === 'scale' || p === 'visible') {
          const node = nodes[track.targetNodeId]
          const obj = host.resolveObject(track.targetNodeId)
          if (node) {
            const val = evaluatePropertyKeys(track.keys, time, track.valueType ?? 'vec3')
            if (val !== undefined) applyCutsceneNodeProperty(node, obj, p, val)
          }
        }
      }
    } else if (phase === 'animation') {
      if (track.kind === 'animation' && track.clips && track.clips.length > 0 && track.targetNodeId) {
        const handled = host.sampleNodeAnimation?.(track.targetNodeId, track.clips, time)
        if (handled) markCutsceneAnimNode(track.targetNodeId)
      }
    } else if (phase === 'render') {
      if (track.kind !== 'property' || !track.keys) continue
      const p = track.propertyPath ?? ''
      if (p === 'position' || p === 'rotation' || p === 'scale' || p === 'visible') continue
      const val = evaluatePropertyKeys(track.keys, time, track.valueType ?? 'number')
      if (val === undefined) continue
      if (!track.targetNodeId || track.targetNodeId === '__picture__') {
        setCutscenePictureOverride(p, val)
      } else {
        const node = nodes[track.targetNodeId]
        const obj = host.resolveObject(track.targetNodeId)
        if (node) applyCutsceneNodeProperty(node, obj, p, val)
      }
    }
  }
}

function stepCutscenePrePhysics(dt: number): void {
  const world = getRuntimeWorld()
  const playState = world.getPlayState()
  if (playState !== 'playing') {
    if (playbacks.size > 0 || autoPlayedSceneKey) {
      playbacks.clear()
      autoPlayedSceneKey = ''
      clearCutsceneOverrides()
    }
    return
  }

  const sceneKey = world.getActiveSceneId()
  if (autoPlayedSceneKey !== sceneKey) {
    autoPlayedSceneKey = sceneKey
    for (const seq of getSequences()) {
      if (seq.autoPlay) playCutscene(seq.id)
    }
  }

  if (playbacks.size === 0) return

  const finished: ActivePlayback[] = []
  for (const pb of playbacks.values()) {
    pb.prevTime = pb.time
    pb.time += dt * pb.speed
    if (pb.time >= pb.sequence.duration) {
      if (pb.loop && pb.sequence.duration > 0) {
        pb.time = pb.time % pb.sequence.duration
        pb.firedEvents.clear()
      } else {
        pb.time = pb.sequence.duration
        finished.push(pb)
      }
    }

    for (const ev of pb.sequence.eventTrack) {
      if (pb.firedEvents.has(ev.id)) continue
      if (ev.time > pb.prevTime && ev.time <= pb.time) {
        pb.firedEvents.add(ev.id)
        if (ev.kind === 'message' && ev.name) {
          postRuleMessage(ev.name, '', ev.payload)
        } else if (ev.kind === 'sound' && ev.assetId) {
          playSound({ assetId: ev.assetId, bus: 'sfx', volume: ev.volume ?? 1 })
        } else if (ev.kind === 'showUi' && ev.name) {
          setScreenVisible(ev.name, true)
        } else if (ev.kind === 'hideUi' && ev.name) {
          setScreenVisible(ev.name, false)
        }
      }
    }
  }

  for (const pb of finished) {
    playbacks.delete(pb.sequence.id)
    pb.onComplete?.()
  }
  if (playbacks.size === 0) {
    clearCutsceneOverrides()
  }
}

function stepCutscenePostPhysics(_dt: number, host: SceneRuntimeHost): void {
  if (playbacks.size === 0) return
  const nodes = getRuntimeWorld().getNodes()
  for (const pb of playbacks.values()) {
    evaluateCutsceneTracks(pb.sequence, pb.time, nodes, host, 'transform')
  }
}

function stepCutsceneAnimation(_dt: number, host: SceneRuntimeHost): void {
  clearCutsceneAnimMarks()
  if (playbacks.size === 0) return
  const nodes = getRuntimeWorld().getNodes()
  for (const pb of playbacks.values()) {
    evaluateCutsceneTracks(pb.sequence, pb.time, nodes, host, 'animation')
  }
}

function stepCutscenePostAnimationAndRender(_dt: number, host: SceneRuntimeHost): void {
  if (playbacks.size === 0) return
  const nodes = getRuntimeWorld().getNodes()
  for (const pb of playbacks.values()) {
    evaluateCutsceneTracks(pb.sequence, pb.time, nodes, host, 'render')
    const camPose = evaluateCutsceneCameraTrack(
      pb.sequence.cameraTrack,
      pb.time,
      nodes,
      id => host.resolveObject(id),
    )
    if (camPose) {
      host.poseCamera?.(camPose.position, camPose.lookAt, camPose.fov)
    }
  }
}

export function mount(): () => void {
  if (!unregisterPre) {
    unregisterPre = registerRuntimeSystem('capability.cutscene.pre', RUNTIME_STAGE.PRE_PHYSICS + 5, stepCutscenePrePhysics)
  }
  if (!unregisterPostPhysics) {
    unregisterPostPhysics = registerRuntimeSystem('capability.cutscene.postPhysics', RUNTIME_STAGE.POST_PHYSICS + 3, stepCutscenePostPhysics)
  }
  if (!unregisterAnim) {
    unregisterAnim = registerRuntimeSystem('capability.cutscene.anim', RUNTIME_STAGE.ANIMATION + 2, stepCutsceneAnimation)
  }
  if (!unregisterCamera) {
    unregisterCamera = registerRuntimeSystem('capability.cutscene.render', RUNTIME_STAGE.POST_ANIMATION + 7, stepCutscenePostAnimationAndRender)
  }
  return dispose
}

export function dispose(): void {
  unregisterPre?.(); unregisterPre = null
  unregisterPostPhysics?.(); unregisterPostPhysics = null
  unregisterAnim?.(); unregisterAnim = null
  unregisterCamera?.(); unregisterCamera = null
  playbacks.clear()
  clearCutsceneOverrides()
  editorPreviewState = null
}

const cutsceneRuntimeModule: CapabilityRuntimeModule = { mount, dispose }
export default cutsceneRuntimeModule
