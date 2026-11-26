import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Camera,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  ClipboardPaste,
  Copy,
  ExternalLink,
  Film,
  Flag,
  Minimize2,
  Pause,
  Play,
  Plus,
  Repeat,
  SkipBack,
  Square,
  Trash2,
} from 'lucide-react'
import {
  CUTSCENE_CAPABILITY_ID,
  createEmptySequence,
  normalizeCutsceneDocument,
  type CutsceneAnimClip,
  type CutsceneCameraShot,
  type CutsceneDocument,
  type CutsceneEventKey,
  type CutsceneKeyEase,
  type CutscenePropertyKey,
  type CutsceneSequence,
  type CutsceneTrack,
  type CutsceneValueType,
} from '../../capabilities/cutscene/schema'
import { setEditorCutscenePreview } from '../../capabilities/cutscene/session'
import { CLIP_MIME, readClipDrag } from '../animation/playback'
import { isNodeDrag, NODE_MIME } from '../assets/import'
import { useAssetStore, type CutsceneAsset } from '../assets/library'
import { clipNamesFor } from '../assets/models'
import { useCodeAssetStore } from '../../core/codeAssets/workspace'
import {
  evalEaseFactor,
  listAnimatablePropertiesForNode,
  listAnimatablePropertiesForPicture,
  readCutsceneNodeProperty,
  readCutscenePictureProperty,
} from '../../runtime/engine/cutscene'
import { useEditorStore } from '../scene/store'
import { useCutsceneWindowStore } from './cutsceneWindowStore'
import './CutscenePanel.css'

const PX_PER_SEC = 90
const ROW_H = 28
const RULER_H = 24
const EASE_OPTIONS: Array<{ value: CutsceneKeyEase; label: string }> = [
  { value: 'smooth', label: '平滑 (Smooth)' },
  { value: 'linear', label: '线性 (Linear)' },
  { value: 'step', label: '阶梯 (Step / 瞬切)' },
  { value: 'inQuad', label: '二次缓入 (InQuad)' },
  { value: 'outQuad', label: '二次缓出 (OutQuad)' },
  { value: 'inOutQuad', label: '二次缓入出 (InOutQuad)' },
  { value: 'inCubic', label: '三次缓入 (InCubic)' },
  { value: 'outCubic', label: '三次缓出 (OutCubic)' },
  { value: 'inOutCubic', label: '三次缓入出 (InOutCubic)' },
  { value: 'inOutSine', label: '正弦缓入出 (InOutSine)' },
  { value: 'outBack', label: '回弹缓出 (OutBack)' },
  { value: 'inOutBack', label: '回弹缓入出 (InOutBack)' },
  { value: 'outBounce', label: '弹跳缓出 (OutBounce)' },
  { value: 'outElastic', label: '弹性缓出 (OutElastic)' },
]

interface KeyRef {
  trackId: string
  keyId: string
}

interface CopiedKeyEntry {
  trackId: string
  offset: number
  value: CutscenePropertyKey['value']
  ease?: CutsceneKeyEase
}

type SelectionRef =
  | { kind: 'clip'; trackId: string; clipId: string }
  | { kind: 'shot'; shotId: string }
  | { kind: 'event'; eventId: string }
  | null

function formatTime(sec: number): string {
  const s = Math.max(0, sec)
  const mins = Math.floor(s / 60)
  const rem = (s % 60).toFixed(2).padStart(5, '0')
  return `${String(mins).padStart(2, '0')}:${rem}`
}

export default function CutscenePanel({ isFloating = false }: { isFloating?: boolean }) {
  const mode = useCutsceneWindowStore(s => s.mode)
  const dockToBottom = useCutsceneWindowStore(s => s.dockToBottom)

  if (mode === 'floating' && !isFloating) {
    return (
      <div className="cutscene-panel">
        <div className="cutscene-empty">
          <Film size={24} />
          <div>过场时间轴已在独立窗口中打开</div>
          <button type="button" className="cutscene-btn is-active" onClick={dockToBottom}>
            <Minimize2 size={12} /> 停靠回底部面板
          </button>
        </div>
      </div>
    )
  }

  return <CutsceneEditorBody isFloating={isFloating} />
}

function CutsceneEditorBody({ isFloating }: { isFloating: boolean }) {
  const picture = useEditorStore(s => s.picture)
  const nodes = useEditorStore(s => s.nodes)
  const selection = useEditorStore(s => s.selection)
  const playState = useEditorStore(s => s.playState)
  const assets = useAssetStore(s => s.assets)
  const codeAssets = useCodeAssetStore(s => s.assets)
  const openFloating = useCutsceneWindowStore(s => s.openFloating)
  const dockToBottom = useCutsceneWindowStore(s => s.dockToBottom)

  const doc = useMemo<CutsceneDocument>(
    () => normalizeCutsceneDocument(picture.capabilities?.[CUTSCENE_CAPABILITY_ID]),
    [picture.capabilities],
  )

  const cutsceneAssets = useMemo<CutsceneAsset[]>(
    () => Object.values(assets).filter((a): a is CutsceneAsset => a.kind === 'cutscene'),
    [assets],
  )

  // 列出工程内所有独立过场资产 + 向下兼容旧版内嵌序列
  const allSequenceEntries = useMemo(() => {
    const list: Array<{ id: string; isAsset: boolean; name: string; sequence: CutsceneSequence }> = []
    for (const a of cutsceneAssets) {
      list.push({ id: a.id, isAsset: true, name: a.name, sequence: a.sequence })
    }
    for (const s of doc.sequences) {
      if (!list.some(item => item.id === s.id)) {
        list.push({ id: s.id, isAsset: false, name: `${s.name} (内嵌)`, sequence: s })
      }
    }
    return list
  }, [cutsceneAssets, doc.sequences])

  const activeEntry = useMemo(() => {
    if (doc.activeAssetId) {
      const found = allSequenceEntries.find(e => e.id === doc.activeAssetId)
      if (found) return found
    }
    if (doc.activeSequenceId) {
      const found = allSequenceEntries.find(e => e.id === doc.activeSequenceId)
      if (found) return found
    }
    return allSequenceEntries[0] ?? null
  }, [allSequenceEntries, doc.activeAssetId, doc.activeSequenceId])

  const activeSeq = activeEntry?.sequence ?? null

  const [currentTime, setCurrentTime] = useState(0)
  const [previewPlaying, setPreviewPlaying] = useState(false)
  const [previewActive, setPreviewActive] = useState(false)
  const [recording, setRecording] = useState(false)
  const [selectedItem, setSelectedItem] = useState<SelectionRef>(null)
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const toggleGroupCollapse = useCallback((groupId: string) => {
    setCollapsedGroups(prev => ({ ...prev, [groupId]: !prev[groupId] }))
  }, [])
  const [selectedKeys, setSelectedKeys] = useState<KeyRef[]>([])
  const [copiedKeys, setCopiedKeys] = useState<CopiedKeyEntry[]>([])
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const [addMenuNodeId, setAddMenuNodeId] = useState<string | null>(null)
  const [dragOverPanel, setDragOverPanel] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const writeDoc = useCallback((next: CutsceneDocument) => {
    const state = useEditorStore.getState()
    state.setPicture({
      capabilities: {
        ...(state.picture.capabilities ?? {}),
        [CUTSCENE_CAPABILITY_ID]: next,
      },
    })
  }, [])

  const updateActiveSeq = useCallback((updater: (seq: CutsceneSequence) => CutsceneSequence) => {
    if (!activeEntry) return
    const updated = updater(activeEntry.sequence)
    if (activeEntry.isAsset) {
      const store = useAssetStore.getState()
      const currentAsset = store.assets[activeEntry.id]
      if (currentAsset && currentAsset.kind === 'cutscene') {
        useAssetStore.setState(state => ({
          assets: {
            ...state.assets,
            [activeEntry.id]: {
              ...currentAsset,
              name: updated.name || currentAsset.name,
              sequence: updated,
            },
          },
          revision: state.revision + 1,
        }))
        // 同步轻量导演引用里的 autoPlay / loop / lockPlayerInput
        const existingDir = doc.directors.find(d => d.assetId === activeEntry.id)
        const nextDirs = existingDir
          ? doc.directors.map(d => (
              d.assetId === activeEntry.id
                ? { ...d, autoPlay: updated.autoPlay, loop: updated.loop, lockPlayerInput: updated.lockPlayerInput }
                : d
            ))
          : [
              ...doc.directors,
              {
                id: crypto.randomUUID(),
                assetId: activeEntry.id,
                autoPlay: updated.autoPlay,
                loop: updated.loop,
                lockPlayerInput: updated.lockPlayerInput,
              },
            ]
        writeDoc({ ...doc, activeAssetId: activeEntry.id, directors: nextDirs })
      }
      return
    }
    writeDoc({
      ...doc,
      sequences: doc.sequences.map(s => (s.id === activeEntry.id ? updated : s)),
    })
  }, [activeEntry, doc, writeDoc])

  // 同步编辑器停止态预览到 EditorViewport
  useEffect(() => {
    if (playState !== 'stopped' || !previewActive || !activeSeq) {
      setEditorCutscenePreview(null)
      return
    }
    setEditorCutscenePreview(activeSeq, currentTime)
  }, [activeSeq, currentTime, playState, previewActive])

  useEffect(() => () => setEditorCutscenePreview(null), [])

  // 预览播放循环
  useEffect(() => {
    if (!previewPlaying || !activeSeq || playState !== 'stopped') return
    setPreviewActive(true)
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      setCurrentTime(prev => {
        let next = prev + dt
        if (next >= activeSeq.duration) {
          if (activeSeq.loop) {
            next = next % activeSeq.duration
          } else {
            next = activeSeq.duration
            setPreviewPlaying(false)
          }
        }
        return next
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [activeSeq, playState, previewPlaying])

  // 🔴 录制（Auto-Key）模式
  const prevSnapshotRef = useRef<{ nodes: typeof nodes; picture: typeof picture }>({ nodes, picture })
  useEffect(() => {
    const prev = prevSnapshotRef.current
    prevSnapshotRef.current = { nodes, picture }
    if (!recording || !activeSeq || playState !== 'stopped') return

    const snappedTime = Math.round(currentTime * activeSeq.fps) / activeSeq.fps
    let nextSeq = activeSeq
    let changed = false

    const upsertKeyOnTrack = (
      targetNodeId: string,
      path: string,
      label: string,
      valueType: CutsceneValueType,
      val: CutscenePropertyKey['value'],
    ) => {
      let track = nextSeq.tracks.find(
        t => t.kind === 'property' && t.targetNodeId === targetNodeId && t.propertyPath === path,
      )
      const newKey: CutscenePropertyKey = {
        id: crypto.randomUUID(),
        time: snappedTime,
        value: val,
        ease: 'smooth',
      }
      if (!track) {
        track = {
          id: crypto.randomUUID(),
          kind: 'property',
          targetNodeId,
          label,
          propertyPath: path,
          valueType,
          keys: [newKey],
        }
        nextSeq = { ...nextSeq, tracks: [...nextSeq.tracks, track] }
      } else {
        const existingIdx = (track.keys ?? []).findIndex(k => Math.abs(k.time - snappedTime) < 0.015)
        const nextKeys = existingIdx >= 0
          ? (track.keys ?? []).map((k, i) => (i === existingIdx ? { ...k, value: val } : k))
          : [...(track.keys ?? []), newKey].sort((a, b) => a.time - b.time)
        nextSeq = {
          ...nextSeq,
          tracks: nextSeq.tracks.map(t => (t.id === track!.id ? { ...t, keys: nextKeys } : t)),
        }
      }
      changed = true
    }

    for (const id of selection) {
      const prevNode = prev.nodes[id]
      const curNode = nodes[id]
      if (!prevNode || !curNode || prevNode === curNode) continue
      const props = listAnimatablePropertiesForNode(curNode, null)
      for (const prop of props) {
        const oldV = readCutsceneNodeProperty(prevNode, null, prop.path)
        const newV = readCutsceneNodeProperty(curNode, null, prop.path)
        if (JSON.stringify(oldV) !== JSON.stringify(newV) && newV !== undefined) {
          upsertKeyOnTrack(id, prop.path, prop.label, prop.valueType, newV as CutscenePropertyKey['value'])
        }
      }
    }

    if (prev.picture !== picture) {
      const picProps = listAnimatablePropertiesForPicture(picture)
      for (const prop of picProps) {
        const oldV = readCutscenePictureProperty(prev.picture, prop.path)
        const newV = readCutscenePictureProperty(picture, prop.path)
        if (JSON.stringify(oldV) !== JSON.stringify(newV) && newV !== undefined) {
          upsertKeyOnTrack('__picture__', prop.path, prop.label, prop.valueType, newV as CutscenePropertyKey['value'])
        }
      }
    }

    if (changed) {
      updateActiveSeq(() => nextSeq)
    }
  }, [activeSeq, currentTime, nodes, picture, playState, recording, selection, updateActiveSeq])

  const shaderParamMetaMap = useMemo(() => {
    const map: Record<string, Record<string, { type: string; label?: string; default?: unknown }>> = {}
    for (const item of Object.values(codeAssets)) {
      if (item.kind === 'shader' && item.compiledShader?.definition?.params) {
        map[item.id] = item.compiledShader.definition.params as Record<string, { type: string; label?: string; default?: unknown }>
      }
    }
    return map
  }, [codeAssets])

  const scriptSchemaMap = useMemo(() => {
    const map: Record<string, { name: string; params: Record<string, { type: string; label?: string; default?: unknown }> }> = {}
    for (const item of Object.values(codeAssets)) {
      if (item.kind === 'script' && item.compiledScript?.behavior) {
        map[item.id] = {
          name: item.compiledScript.behavior.name || item.relativePath,
          params: (item.compiledScript.behavior.params ?? {}) as Record<string, { type: string; label?: string; default?: unknown }>,
        }
      }
    }
    return map
  }, [codeAssets])

  const boundNodeIds = useMemo(() => {
    if (!activeSeq) return []
    const ids = new Set<string>()
    for (const t of activeSeq.tracks) {
      if (t.targetNodeId && t.targetNodeId !== '__picture__') ids.add(t.targetNodeId)
    }
    return Array.from(ids)
  }, [activeSeq])

  const pictureTracks = useMemo(
    () => activeSeq?.tracks.filter(t => !t.targetNodeId || t.targetNodeId === '__picture__') ?? [],
    [activeSeq],
  )

  // 计算每一条属性轨道在时间轴上的行索引（用于框选坐标命中）
  const laneTrackOrder = useMemo(() => {
    const rows: Array<{ type: 'camera' | 'event' | 'group' | 'track'; track?: CutsceneTrack }> = [
      { type: 'camera' },
      { type: 'event' },
      { type: 'group' },
    ]
    for (const t of pictureTracks) rows.push({ type: 'track', track: t })
    for (const nid of boundNodeIds) {
      rows.push({ type: 'group' })
      for (const t of (activeSeq?.tracks.filter(tr => tr.targetNodeId === nid) ?? [])) {
        rows.push({ type: 'track', track: t })
      }
    }
    return rows
  }, [activeSeq?.tracks, boundNodeIds, pictureTracks])

  const cameraNodes = useMemo(
    () => Object.values(nodes).filter(n => n.kind === 'camera'),
    [nodes],
  )

  // 关键帧复制 / 粘贴 / 批量删除
  const copySelectedKeys = useCallback(() => {
    if (!activeSeq || selectedKeys.length === 0) return
    const items: Array<{ trackId: string; key: CutscenePropertyKey }> = []
    for (const ref of selectedKeys) {
      const tr = activeSeq.tracks.find(t => t.id === ref.trackId)
      const k = tr?.keys?.find(item => item.id === ref.keyId)
      if (tr && k) items.push({ trackId: tr.id, key: k })
    }
    if (items.length === 0) return
    const minT = Math.min(...items.map(i => i.key.time))
    setCopiedKeys(items.map(i => ({
      trackId: i.trackId,
      offset: i.key.time - minT,
      value: structuredClone(i.key.value),
      ease: i.key.ease,
    })))
  }, [activeSeq, selectedKeys])

  const pasteCopiedKeys = useCallback(() => {
    if (!activeSeq || copiedKeys.length === 0) return
    const newlySelected: KeyRef[] = []
    updateActiveSeq(seq => ({
      ...seq,
      tracks: seq.tracks.map(track => {
        const toInsert = copiedKeys.filter(c => c.trackId === track.id)
        if (toInsert.length === 0) return track
        let nextKeys = [...(track.keys ?? [])]
        for (const item of toInsert) {
          const t = Number(Math.max(0, currentTime + item.offset).toFixed(3))
          const newId = crypto.randomUUID()
          nextKeys = nextKeys.filter(k => Math.abs(k.time - t) > 0.01)
          nextKeys.push({
            id: newId,
            time: t,
            value: structuredClone(item.value),
            ease: item.ease ?? 'smooth',
          })
          newlySelected.push({ trackId: track.id, keyId: newId })
        }
        nextKeys.sort((a, b) => a.time - b.time)
        return { ...track, keys: nextKeys }
      }),
    }))
    if (newlySelected.length > 0) setSelectedKeys(newlySelected)
  }, [activeSeq, copiedKeys, currentTime, updateActiveSeq])

  const deleteSelectedKeys = useCallback(() => {
    if (!activeSeq || selectedKeys.length === 0) return
    const byTrack = new Map<string, Set<string>>()
    for (const ref of selectedKeys) {
      let set = byTrack.get(ref.trackId)
      if (!set) { set = new Set(); byTrack.set(ref.trackId, set) }
      set.add(ref.keyId)
    }
    updateActiveSeq(seq => ({
      ...seq,
      tracks: seq.tracks.map(t => {
        const ids = byTrack.get(t.id)
        if (!ids) return t
        return { ...t, keys: (t.keys ?? []).filter(k => !ids.has(k.id)) }
      }),
    }))
    setSelectedKeys([])
  }, [activeSeq, selectedKeys, updateActiveSeq])

  const applyEaseToSelectedKeys = useCallback((ease: CutsceneKeyEase) => {
    if (!activeSeq || selectedKeys.length === 0) return
    const byTrack = new Map<string, Set<string>>()
    for (const ref of selectedKeys) {
      let set = byTrack.get(ref.trackId)
      if (!set) { set = new Set(); byTrack.set(ref.trackId, set) }
      set.add(ref.keyId)
    }
    updateActiveSeq(seq => ({
      ...seq,
      tracks: seq.tracks.map(t => {
        const ids = byTrack.get(t.id)
        if (!ids) return t
        return {
          ...t,
          keys: (t.keys ?? []).map(k => (ids.has(k.id) ? { ...k, ease } : k)),
        }
      }),
    }))
  }, [activeSeq, selectedKeys, updateActiveSeq])

  const multiSelectedEase = useMemo<CutsceneKeyEase | 'mixed'>(() => {
    if (!activeSeq || selectedKeys.length <= 1) return 'smooth'
    let first: CutsceneKeyEase | null = null
    for (const ref of selectedKeys) {
      const track = activeSeq.tracks.find(t => t.id === ref.trackId)
      const k = track?.keys?.find(item => item.id === ref.keyId)
      if (!k) continue
      const ease: CutsceneKeyEase = k.ease ?? 'smooth'
      if (first === null) first = ease
      else if (first !== ease) return 'mixed'
    }
    return first ?? 'smooth'
  }, [activeSeq, selectedKeys])

  const allKeyframeTimes = useMemo(() => {
    if (!activeSeq) return [] as number[]
    const times = new Set<number>()
    for (const track of activeSeq.tracks) {
      for (const k of track.keys ?? []) times.add(Number(k.time.toFixed(4)))
      for (const c of track.clips ?? []) times.add(Number(c.startTime.toFixed(4)))
    }
    for (const ev of activeSeq.eventTrack) times.add(Number(ev.time.toFixed(4)))
    for (const shot of activeSeq.cameraTrack) times.add(Number(shot.startTime.toFixed(4)))
    return Array.from(times).sort((a, b) => a - b)
  }, [activeSeq])

  const prevKeyframeTime = useMemo(() => {
    for (let i = allKeyframeTimes.length - 1; i >= 0; i--) {
      if (allKeyframeTimes[i] < currentTime - 0.001) return allKeyframeTimes[i]
    }
    return null
  }, [allKeyframeTimes, currentTime])

  const nextKeyframeTime = useMemo(() => {
    for (let i = 0; i < allKeyframeTimes.length; i++) {
      if (allKeyframeTimes[i] > currentTime + 0.001) return allKeyframeTimes[i]
    }
    return null
  }, [allKeyframeTimes, currentTime])

  const jumpToPrevKeyframe = useCallback(() => {
    if (prevKeyframeTime === null) return
    if (playState === 'stopped') setPreviewActive(true)
    setPreviewPlaying(false)
    setCurrentTime(prevKeyframeTime)
  }, [playState, prevKeyframeTime])

  const jumpToNextKeyframe = useCallback(() => {
    if (nextKeyframeTime === null) return
    if (playState === 'stopped') setPreviewActive(true)
    setPreviewPlaying(false)
    setCurrentTime(nextKeyframeTime)
  }, [nextKeyframeTime, playState])

  // 键盘快捷键：Ctrl+C / Ctrl+V / Delete / 上下关键帧 (, / .)
  useEffect(() => {
    const el = panelRef.current
    if (!el) return
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        if (selectedKeys.length > 0) {
          e.preventDefault()
          copySelectedKeys()
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        if (copiedKeys.length > 0) {
          e.preventDefault()
          pasteCopiedKeys()
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedKeys.length > 0) {
          e.preventDefault()
          deleteSelectedKeys()
        }
      } else if (e.key === ',' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (prevKeyframeTime !== null) {
          e.preventDefault()
          jumpToPrevKeyframe()
        }
      } else if (e.key === '.' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (nextKeyframeTime !== null) {
          e.preventDefault()
          jumpToNextKeyframe()
        }
      }
    }
    el.addEventListener('keydown', onKeyDown)
    return () => el.removeEventListener('keydown', onKeyDown)
  }, [
    copiedKeys.length,
    copySelectedKeys,
    deleteSelectedKeys,
    jumpToNextKeyframe,
    jumpToPrevKeyframe,
    nextKeyframeTime,
    pasteCopiedKeys,
    prevKeyframeTime,
    selectedKeys.length,
  ])

  // 创建新的独立 CutsceneAsset 资产并挂载到当前场景
  const createSequence = () => {
    const name = `过场序列 ${allSequenceEntries.length + 1}`
    const id = crypto.randomUUID()
    const seq = createEmptySequence(name, id)
    useAssetStore.getState().add({ id, name, kind: 'cutscene', sequence: seq })
    useAssetStore.getState().place(id)
    writeDoc({
      ...doc,
      activeAssetId: id,
      directors: [...doc.directors, { id: crypto.randomUUID(), assetId: id, autoPlay: false, loop: false, lockPlayerInput: true }],
    })
    setCurrentTime(0)
    setSelectedKeys([])
  }

  const removeActiveSequence = () => {
    if (!activeEntry) return
    if (activeEntry.isAsset) {
      const nextDirs = doc.directors.filter(d => d.assetId !== activeEntry.id)
      useAssetStore.getState().remove(activeEntry.id)
      writeDoc({ ...doc, directors: nextDirs, activeAssetId: nextDirs[0]?.assetId ?? '' })
    } else {
      const next = doc.sequences.filter(s => s.id !== activeEntry.id)
      writeDoc({ ...doc, sequences: next, activeSequenceId: next[0]?.id ?? '' })
    }
    setPreviewPlaying(false)
    setPreviewActive(false)
    setSelectedKeys([])
  }

  const bindNodeToSequence = useCallback((targetId: string, openMenu = false) => {
    if (!activeSeq) return
    const node = nodes[targetId]
    if (!node) return
    const already = activeSeq.tracks.some(t => t.targetNodeId === targetId)
    if (already) {
      if (openMenu) setAddMenuNodeId(targetId)
      return
    }
    let defaultTrack: CutsceneTrack
    if (node.kind === 'model') {
      defaultTrack = {
        id: crypto.randomUUID(),
        kind: 'animation',
        targetNodeId: targetId,
        label: '骨骼动作 (Body)',
        animLayer: 'body',
        clips: [],
      }
    } else if (node.kind.endsWith('-light')) {
      defaultTrack = {
        id: crypto.randomUUID(),
        kind: 'property',
        targetNodeId: targetId,
        label: '灯光强度 (Intensity)',
        propertyPath: 'intensity',
        valueType: 'number',
        keys: [{ id: crypto.randomUUID(), time: 0, value: node.intensity, ease: 'smooth' }],
      }
    } else if (node.kind === 'camera') {
      defaultTrack = {
        id: crypto.randomUUID(),
        kind: 'property',
        targetNodeId: targetId,
        label: '视场角 (FOV)',
        propertyPath: 'fov',
        valueType: 'number',
        keys: [{ id: crypto.randomUUID(), time: 0, value: node.fov, ease: 'smooth' }],
      }
    } else {
      defaultTrack = {
        id: crypto.randomUUID(),
        kind: 'property',
        targetNodeId: targetId,
        label: '位置 (Position)',
        propertyPath: 'position',
        valueType: 'vec3',
        keys: [{ id: crypto.randomUUID(), time: 0, value: [...node.position], ease: 'smooth' }],
      }
    }
    updateActiveSeq(seq => ({ ...seq, tracks: [...seq.tracks, defaultTrack] }))
    if (openMenu) setAddMenuNodeId(targetId)
  }, [activeSeq, nodes, updateActiveSeq])

  const addSelectedNodeToSequence = () => {
    if (selection.length === 0) return
    bindNodeToSequence(selection[0], true)
  }

  const handleDropNodeOnTimeline = (e: React.DragEvent) => {
    if (!isNodeDrag(e.dataTransfer)) return
    const nodeId = e.dataTransfer.getData(NODE_MIME)
    setDragOverPanel(false)
    if (!nodeId || !nodes[nodeId]) return
    e.preventDefault()
    e.stopPropagation()
    bindNodeToSequence(nodeId, true)
  }

  const addPropertyTrack = (targetNodeId: string, path: string, label: string, valueType: CutsceneValueType, currentVal: CutscenePropertyKey['value']) => {
    if (!activeSeq) return
    const exists = activeSeq.tracks.find(
      t => t.kind === 'property' && t.targetNodeId === targetNodeId && t.propertyPath === path,
    )
    if (exists) {
      setAddMenuNodeId(null)
      return
    }
    const newTrack: CutsceneTrack = {
      id: crypto.randomUUID(),
      kind: 'property',
      targetNodeId,
      label,
      propertyPath: path,
      valueType,
      keys: [{ id: crypto.randomUUID(), time: currentTime, value: currentVal, ease: 'smooth' }],
    }
    updateActiveSeq(seq => ({ ...seq, tracks: [...seq.tracks, newTrack] }))
    setAddMenuNodeId(null)
  }

  const addAnimTrack = (targetNodeId: string) => {
    if (!activeSeq) return
    const track: CutsceneTrack = {
      id: crypto.randomUUID(),
      kind: 'animation',
      targetNodeId,
      label: '骨骼动作 (Body)',
      animLayer: 'body',
      clips: [],
    }
    updateActiveSeq(seq => ({ ...seq, tracks: [...seq.tracks, track] }))
    setAddMenuNodeId(null)
  }

  const addCameraShot = () => {
    if (!activeSeq) return
    const firstCam = cameraNodes[0]?.id ?? ''
    const shot: CutsceneCameraShot = {
      id: crypto.randomUUID(),
      cameraNodeId: firstCam,
      label: cameraNodes[0]?.name || '镜头片段',
      startTime: Math.min(currentTime, Math.max(0, activeSeq.duration - 1)),
      duration: 2,
      blendIn: 0.35,
    }
    updateActiveSeq(seq => ({ ...seq, cameraTrack: [...seq.cameraTrack, shot] }))
    setSelectedItem({ kind: 'shot', shotId: shot.id })
    setSelectedKeys([])
  }

  const addEventMarker = () => {
    if (!activeSeq) return
    const ev: CutsceneEventKey = {
      id: crypto.randomUUID(),
      time: currentTime,
      kind: 'message',
      name: 'onCutsceneCue',
      volume: 1,
    }
    updateActiveSeq(seq => ({ ...seq, eventTrack: [...seq.eventTrack, ev].sort((a, b) => a.time - b.time) }))
    setSelectedItem({ kind: 'event', eventId: ev.id })
    setSelectedKeys([])
  }

  const insertKeyAtCursor = (track: CutsceneTrack) => {
    if (!activeSeq) return
    let value: CutscenePropertyKey['value'] = 0
    if (track.targetNodeId === '__picture__' || !track.targetNodeId) {
      value = (readCutscenePictureProperty(picture, track.propertyPath ?? '') as CutscenePropertyKey['value']) ?? 0
    } else {
      const node = nodes[track.targetNodeId]
      if (!node) return
      value = (readCutsceneNodeProperty(node, null, track.propertyPath ?? '') as CutscenePropertyKey['value']) ?? 0
    }
    const key: CutscenePropertyKey = {
      id: crypto.randomUUID(),
      time: Number(currentTime.toFixed(3)),
      value,
      ease: 'smooth',
    }
    updateActiveSeq(seq => ({
      ...seq,
      tracks: seq.tracks.map(t => (
        t.id === track.id
          ? { ...t, keys: [...(t.keys ?? []).filter(k => Math.abs(k.time - key.time) > 0.01), key].sort((a, b) => a.time - b.time) }
          : t
      )),
    }))
    setSelectedKeys([{ trackId: track.id, keyId: key.id }])
    setSelectedItem(null)
  }

  const scrubFromPointer = (clientX: number) => {
    const el = scrollRef.current
    if (!el || !activeSeq) return
    const rect = el.getBoundingClientRect()
    const x = clientX - rect.left + el.scrollLeft
    const next = Math.max(0, Math.min(activeSeq.duration, x / PX_PER_SEC))
    setPreviewPlaying(false)
    setPreviewActive(true)
    setCurrentTime(next)
  }

  const startDrag = (onMove: (dxSec: number) => void) => (e: React.PointerEvent) => {
    e.stopPropagation()
    const startX = e.clientX
    const move = (ev: PointerEvent) => onMove((ev.clientX - startX) / PX_PER_SEC)
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // 点击或批量拖动关键帧
  const handleKeyPointerDown = (trackId: string, keyId: string, e: React.PointerEvent) => {
    e.stopPropagation()
    if (!activeSeq) return
    const additive = e.shiftKey || e.ctrlKey || e.metaKey
    const alreadySelected = selectedKeys.some(k => k.trackId === trackId && k.keyId === keyId)

    let activeGroup: KeyRef[]
    if (additive) {
      activeGroup = alreadySelected
        ? selectedKeys.filter(k => !(k.trackId === trackId && k.keyId === keyId))
        : [...selectedKeys, { trackId, keyId }]
      setSelectedKeys(activeGroup)
    } else if (!alreadySelected) {
      activeGroup = [{ trackId, keyId }]
      setSelectedKeys(activeGroup)
    } else {
      activeGroup = selectedKeys
    }
    setSelectedItem(null)

    if (activeGroup.length === 0) return

    // 记录被拖动群组里每一帧的初始时间
    const baseTimes = new Map<string, number>()
    for (const ref of activeGroup) {
      const tr = activeSeq.tracks.find(t => t.id === ref.trackId)
      const k = tr?.keys?.find(item => item.id === ref.keyId)
      if (k) baseTimes.set(`${ref.trackId}:${ref.keyId}`, k.time)
    }

    const startX = e.clientX
    const move = (ev: PointerEvent) => {
      const dxSec = (ev.clientX - startX) / PX_PER_SEC
      if (Math.abs(dxSec) < 0.005) return
      updateActiveSeq(seq => ({
        ...seq,
        tracks: seq.tracks.map(t => {
          const keys = t.keys
          if (!keys) return t
          let touched = false
          const nextKeys = keys.map(k => {
            const baseT = baseTimes.get(`${t.id}:${k.id}`)
            if (baseT === undefined) return k
            touched = true
            return { ...k, time: Math.max(0, Number((baseT + dxSec).toFixed(2))) }
          })
          return touched ? { ...t, keys: nextKeys.sort((a, b) => a.time - b.time) } : t
        }),
      }))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // 在时间轴空白处拖拽框选关键帧
  const handleTimelineBlankPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !scrollRef.current || !activeSeq) return
    const target = e.target as HTMLElement
    if (target.closest('.cutscene-clip, .cutscene-key, .cutscene-ruler')) return
    const el = scrollRef.current
    const rect = el.getBoundingClientRect()
    const x0 = e.clientX - rect.left + el.scrollLeft
    const y0 = e.clientY - rect.top + el.scrollTop
    const additive = e.shiftKey || e.ctrlKey || e.metaKey
    const prevSelected = additive ? selectedKeys : []

    const updateMarquee = (x1: number, y1: number) => {
      setMarquee({ x0, y0, x1, y1 })
      const minX = Math.min(x0, x1)
      const maxX = Math.max(x0, x1)
      const minY = Math.min(y0, y1)
      const maxY = Math.max(y0, y1)
      const hits: KeyRef[] = [...prevSelected]
      laneTrackOrder.forEach((row, idx) => {
        if (row.type !== 'track' || !row.track?.keys) return
        const rowTop = RULER_H + idx * ROW_H
        const rowBottom = rowTop + ROW_H
        if (rowBottom < minY || rowTop > maxY) return
        for (const k of row.track.keys) {
          const kx = k.time * PX_PER_SEC
          if (kx >= minX && kx <= maxX) {
            if (!hits.some(h => h.trackId === row.track!.id && h.keyId === k.id)) {
              hits.push({ trackId: row.track!.id, keyId: k.id })
            }
          }
        }
      })
      setSelectedKeys(hits)
    }

    const move = (ev: PointerEvent) => {
      const x1 = ev.clientX - rect.left + el.scrollLeft
      const y1 = ev.clientY - rect.top + el.scrollTop
      updateMarquee(x1, y1)
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const x1 = ev.clientX - rect.left + el.scrollLeft
      const y1 = ev.clientY - rect.top + el.scrollTop
      if (Math.hypot(x1 - x0, y1 - y0) < 4 && !additive) {
        setSelectedKeys([])
        setSelectedItem(null)
      }
      setMarquee(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  if (!activeSeq) {
    return (
      <div
        className={`cutscene-panel${dragOverPanel ? ' is-drop-over' : ''}`}
        tabIndex={0}
        ref={panelRef}
      >
        <div className="cutscene-toolbar">
          <button type="button" className="cutscene-btn" onClick={createSequence}>
            <Plus size={13} /> 新建过场资产 (.seq)
          </button>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            className="cutscene-btn"
            onClick={() => (isFloating ? dockToBottom() : openFloating())}
            title={isFloating ? '停靠回底部面板' : '弹出为独立窗口'}
          >
            {isFloating ? <Minimize2 size={12} /> : <ExternalLink size={12} />}
            {isFloating ? '停靠' : '独立窗口'}
          </button>
        </div>
        <div className="cutscene-empty">
          <Film size={28} />
          <div>当前工程暂无过场序列资产，点击「新建过场资产」创建独立序列文件。</div>
        </div>
      </div>
    )
  }

  const timelineWidth = Math.max(700, activeSeq.duration * PX_PER_SEC + 80)
  const ticks = Array.from({ length: Math.ceil(activeSeq.duration) + 1 }, (_, i) => i)

  const singleKeyRef = selectedKeys.length === 1 ? selectedKeys[0] : null
  const singleKeyTrack = singleKeyRef ? activeSeq.tracks.find(t => t.id === singleKeyRef.trackId) ?? null : null
  const singleKey = singleKeyRef ? singleKeyTrack?.keys?.find(k => k.id === singleKeyRef.keyId) ?? null : null

  const selectedTrack = selectedItem && ('trackId' in selectedItem)
    ? activeSeq.tracks.find(t => t.id === selectedItem.trackId) ?? null
    : null
  const selectedClip = selectedItem?.kind === 'clip'
    ? selectedTrack?.clips?.find(c => c.id === selectedItem.clipId) ?? null
    : null
  const selectedShot = selectedItem?.kind === 'shot'
    ? activeSeq.cameraTrack.find(s => s.id === selectedItem.shotId) ?? null
    : null
  const selectedEvent = selectedItem?.kind === 'event'
    ? activeSeq.eventTrack.find(e => e.id === selectedItem.eventId) ?? null
    : null

  return (
    <div
      ref={panelRef}
      tabIndex={0}
      className={`cutscene-panel${dragOverPanel ? ' is-drop-over' : ''}`}
      onDragOver={e => {
        if (isNodeDrag(e.dataTransfer)) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          if (!dragOverPanel) setDragOverPanel(true)
        }
      }}
      onDragLeave={e => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setDragOverPanel(false)
        }
      }}
      onDrop={handleDropNodeOnTimeline}
    >
      <div className="cutscene-toolbar">
        <select
          value={activeEntry?.id ?? ''}
          onChange={e => {
            const val = e.target.value
            const entry = allSequenceEntries.find(item => item.id === val)
            if (entry?.isAsset) writeDoc({ ...doc, activeAssetId: val })
            else writeDoc({ ...doc, activeSequenceId: val, activeAssetId: '' })
            setSelectedKeys([])
            setSelectedItem(null)
          }}
        >
          {allSequenceEntries.map(item => (
            <option key={item.id} value={item.id}>{item.name}</option>
          ))}
        </select>
        <input
          type="text"
          style={{ width: 112 }}
          value={activeSeq.name}
          onChange={e => updateActiveSeq(s => ({ ...s, name: e.target.value }))}
          title="过场序列名称"
        />
        <button type="button" className="cutscene-btn" onClick={createSequence} title="新建独立过场资产">
          <Plus size={13} /> 新建
        </button>
        <button type="button" className="cutscene-btn" onClick={removeActiveSequence} title="删除当前序列">
          <Trash2 size={13} />
        </button>

        <span style={{ width: 1, height: 16, background: 'var(--border)' }} />

        <button
          type="button"
          className="cutscene-btn"
          onClick={() => { setPreviewPlaying(false); setPreviewActive(true); setCurrentTime(0) }}
          title="回到起点"
        >
          <SkipBack size={13} />
        </button>
        <button
          type="button"
          className="cutscene-btn"
          disabled={prevKeyframeTime === null}
          onClick={jumpToPrevKeyframe}
          title="跳转到上个关键帧 (,)"
        >
          <ChevronLeft size={13} /> 上一帧
        </button>
        <button
          type="button"
          className="cutscene-btn"
          disabled={nextKeyframeTime === null}
          onClick={jumpToNextKeyframe}
          title="跳转到下个关键帧 (.)"
        >
          下一帧 <ChevronRight size={13} />
        </button>
        <button
          type="button"
          className={`cutscene-btn${previewPlaying ? ' is-active' : ''}`}
          onClick={() => {
            if (playState !== 'stopped') return
            setPreviewActive(true)
            setPreviewPlaying(p => !p)
          }}
          title="在视口实时预览过场"
        >
          {previewPlaying ? <Pause size={13} /> : <Play size={13} />}
          {previewPlaying ? '暂停' : '预览'}
        </button>
        <button
          type="button"
          className="cutscene-btn"
          onClick={() => { setPreviewPlaying(false); setPreviewActive(false); setCurrentTime(0) }}
          title="停止预览并恢复场景初始状态"
        >
          <Square size={12} /> 停止
        </button>
        <button
          type="button"
          className={`cutscene-btn${recording ? ' is-rec' : ''}`}
          onClick={() => setRecording(r => !r)}
          title="开启录制后，修改视口物体位置或 Inspector 属性将自动在当前时间打帧"
        >
          <Circle size={11} fill={recording ? '#f44336' : 'none'} /> 录制
        </button>
        <button
          type="button"
          className={`cutscene-btn${activeSeq.loop ? ' is-active' : ''}`}
          onClick={() => updateActiveSeq(s => ({ ...s, loop: !s.loop }))}
          title="循环播放"
        >
          <Repeat size={13} />
        </button>

        <span style={{ width: 1, height: 16, background: 'var(--border)' }} />

        <button
          type="button"
          className="cutscene-btn"
          disabled={selectedKeys.length === 0}
          onClick={copySelectedKeys}
          title="复制选中关键帧 (Ctrl+C)"
        >
          <Copy size={12} />
        </button>
        <button
          type="button"
          className="cutscene-btn"
          disabled={copiedKeys.length === 0}
          onClick={pasteCopiedKeys}
          title="粘贴到当前播放头 (Ctrl+V)"
        >
          <ClipboardPaste size={12} />
        </button>
        <button
          type="button"
          className="cutscene-btn"
          disabled={selectedKeys.length === 0}
          onClick={deleteSelectedKeys}
          title="删除选中关键帧 (Delete)"
        >
          删帧{selectedKeys.length > 0 ? `(${selectedKeys.length})` : ''}
        </button>

        <span className="cutscene-timecode">
          {formatTime(currentTime)} / {formatTime(activeSeq.duration)}
        </span>

        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-secondary)' }}>
          时长
          <input
            type="number"
            min={0.5}
            max={600}
            step={0.5}
            style={{ width: 52 }}
            value={activeSeq.duration}
            onChange={e => updateActiveSeq(s => ({ ...s, duration: Math.max(0.5, Number(e.target.value) || 8) }))}
          />
          s
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-secondary)' }}>
          <input
            type="checkbox"
            checked={activeSeq.autoPlay === true}
            onChange={e => updateActiveSeq(s => ({ ...s, autoPlay: e.target.checked }))}
          />
          开局自动播
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-secondary)' }}>
          <input
            type="checkbox"
            checked={activeSeq.lockPlayerInput !== false}
            onChange={e => updateActiveSeq(s => ({ ...s, lockPlayerInput: e.target.checked }))}
          />
          锁控制
        </label>

        <div style={{ flex: 1 }} />
        <button
          type="button"
          className="cutscene-btn"
          disabled={selection.length === 0}
          onClick={addSelectedNodeToSequence}
        >
          <Plus size={13} /> 添加选中物体
        </button>
        <button
          type="button"
          className="cutscene-btn"
          onClick={() => (isFloating ? dockToBottom() : openFloating())}
          title={isFloating ? '停靠回底部面板' : '弹出为独立浮动窗口'}
        >
          {isFloating ? <Minimize2 size={12} /> : <ExternalLink size={12} />}
        </button>
      </div>

      <div className="cutscene-body">
        {/* 左侧轨道列表 */}
        <div className="cutscene-sidebar">
          <div style={{ height: RULER_H, borderBottom: '1px solid var(--border)', padding: '0 8px', display: 'flex', alignItems: 'center', color: 'var(--text-muted)', fontSize: 11 }}>
            轨道层级
          </div>

          <div className="cutscene-section-header">
            <span>全局与导演</span>
          </div>

          {/* 导演镜头轨 */}
          <div className="cutscene-row-header is-global is-camera">
            <span className="cutscene-row-header__label"><Camera size={12} color="var(--color-image)" /> 导演镜头轨</span>
            <button type="button" className="cutscene-btn" style={{ height: 20, padding: '0 5px' }} onClick={addCameraShot} title="添加镜头切片">
              <Plus size={11} />
            </button>
          </div>

          {/* 事件轨 */}
          <div className="cutscene-row-header is-global is-event">
            <span className="cutscene-row-header__label"><Flag size={12} color="var(--color-object)" /> 事件 / 音效 / UI 轨</span>
            <button type="button" className="cutscene-btn" style={{ height: 20, padding: '0 5px' }} onClick={addEventMarker} title="添加事件点">
              <Plus size={11} />
            </button>
          </div>

          {/* 场景画面与环境轨 */}
          <div className="cutscene-row-header is-global is-picture">
            <button
              type="button"
              className="cutscene-collapse-btn"
              onClick={() => toggleGroupCollapse('__picture__')}
              title={collapsedGroups['__picture__'] ? '展开场景画面轨道' : '折叠场景画面轨道'}
            >
              {collapsedGroups['__picture__'] ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            </button>
            <span
              className="cutscene-row-header__label"
              style={{ cursor: 'pointer' }}
              onClick={() => toggleGroupCollapse('__picture__')}
            >
              🌐 场景画面与环境{pictureTracks.length > 0 ? ` (${pictureTracks.length})` : ''}
            </span>
            <button
              type="button"
              className="cutscene-btn"
              style={{ height: 20, padding: '0 5px' }}
              onClick={() => {
                if (collapsedGroups['__picture__']) setCollapsedGroups(prev => ({ ...prev, __picture__: false }))
                setAddMenuNodeId(prev => (prev === '__picture__' ? null : '__picture__'))
              }}
            >
              <Plus size={11} />
            </button>
          </div>
          {!collapsedGroups['__picture__'] && addMenuNodeId === '__picture__' && (
            <div className="cutscene-menu-pop">
              {listAnimatablePropertiesForPicture(picture).map(p => (
                <div
                  key={p.path}
                  className="cutscene-menu-item"
                  onClick={() => addPropertyTrack('__picture__', p.path, p.label, p.valueType, p.currentValue)}
                >
                  {p.label}
                </div>
              ))}
            </div>
          )}
          {!collapsedGroups['__picture__'] && pictureTracks.map(track => (
            <div key={track.id} className="cutscene-row-header is-child">
              <span className="cutscene-row-header__label">{track.label || track.propertyPath}</span>
              <button type="button" className="cutscene-btn" style={{ height: 18, padding: '0 4px' }} onClick={() => insertKeyAtCursor(track)} title="在当前时间打帧">◆</button>
              <button
                type="button"
                className="cutscene-btn"
                style={{ height: 18, padding: '0 4px' }}
                onClick={() => updateActiveSeq(s => ({ ...s, tracks: s.tracks.filter(t => t.id !== track.id) }))}
              >
                <Trash2 size={10} />
              </button>
            </div>
          ))}

          {/* 绑定节点轨道组 */}
          <div className="cutscene-section-header">
            <span>物体动画 ({boundNodeIds.length})</span>
            {boundNodeIds.length > 0 && (() => {
              const allCollapsed = boundNodeIds.every(id => collapsedGroups[id])
              return (
                <button
                  type="button"
                  className="cutscene-section-action"
                  onClick={() => {
                    const next: Record<string, boolean> = { ...collapsedGroups }
                    for (const id of boundNodeIds) next[id] = !allCollapsed
                    setCollapsedGroups(next)
                  }}
                >
                  {allCollapsed ? '全部展开' : '全部折叠'}
                </button>
              )
            })()}
          </div>
          {boundNodeIds.map(nodeId => {
            const node = nodes[nodeId]
            const nodeTracks = activeSeq.tracks.filter(t => t.targetNodeId === nodeId)
            const isCollapsed = collapsedGroups[nodeId] === true
            const customShaderId = node?.shader?.startsWith('custom:') ? node.shader.slice('custom:'.length) : ''
            return (
              <div key={nodeId}>
                <div className={`cutscene-row-header is-node-group${node ? '' : ' is-missing'}`}>
                  <button
                    type="button"
                    className="cutscene-collapse-btn"
                    onClick={() => toggleGroupCollapse(nodeId)}
                    title={isCollapsed ? '展开轨道' : '折叠轨道'}
                  >
                    {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                  </button>
                  <span
                    className="cutscene-row-header__label"
                    style={{ cursor: 'pointer' }}
                    onClick={() => toggleGroupCollapse(nodeId)}
                  >
                    📦 {node ? node.name : <span style={{ color: 'var(--text-error)' }}>{`(已删除 ${nodeId.slice(0, 6)})`}</span>}
                    {isCollapsed && nodeTracks.length > 0 && (
                      <span style={{ color: 'var(--text-muted)', fontSize: 10, fontWeight: 400 }}>
                        ({nodeTracks.length})
                      </span>
                    )}
                  </span>
                  {node ? (
                    <button
                      type="button"
                      className="cutscene-btn"
                      style={{ height: 20, padding: '0 5px' }}
                      onClick={() => {
                        if (isCollapsed) setCollapsedGroups(prev => ({ ...prev, [nodeId]: false }))
                        setAddMenuNodeId(prev => (prev === nodeId ? null : nodeId))
                      }}
                      title="添加属性/动作轨道"
                    >
                      <Plus size={11} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="cutscene-btn"
                      style={{ height: 20, padding: '0 5px', color: 'var(--text-error)' }}
                      onClick={() => updateActiveSeq(s => ({ ...s, tracks: s.tracks.filter(t => t.targetNodeId !== nodeId) }))}
                      title="移除该已删除物体的所有轨道"
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
                {!isCollapsed && addMenuNodeId === nodeId && node && (
                  <div className="cutscene-menu-pop">
                    {node.kind === 'model' && (
                      <div
                        className="cutscene-menu-item"
                        style={{ color: 'var(--accent)', fontWeight: 600 }}
                        onClick={() => addAnimTrack(nodeId)}
                      >
                        + 骨骼动作轨 (Animation)
                      </div>
                    )}
                    {listAnimatablePropertiesForNode(
                      node,
                      null,
                      customShaderId ? shaderParamMetaMap[customShaderId] : undefined,
                      scriptSchemaMap,
                    ).map(p => (
                      <div
                        key={p.path}
                        className="cutscene-menu-item"
                        onClick={() => addPropertyTrack(nodeId, p.path, p.label, p.valueType, p.currentValue)}
                      >
                        {p.label}
                      </div>
                    ))}
                  </div>
                )}
                {!isCollapsed && nodeTracks.map(track => (
                  <div key={track.id} className="cutscene-row-header is-child">
                    <span className="cutscene-row-header__label">{track.label || track.propertyPath || track.kind}</span>
                    {track.kind === 'property' && (
                      <button type="button" className="cutscene-btn" style={{ height: 18, padding: '0 4px' }} onClick={() => insertKeyAtCursor(track)} title="在当前时间打帧">◆</button>
                    )}
                    {track.kind === 'animation' && (
                      <button
                        type="button"
                        className="cutscene-btn"
                        style={{ height: 18, padding: '0 4px' }}
                        onClick={() => {
                          const firstClip = clipNamesFor(node?.assetId ?? null)[0] ?? ''
                          const newClip: CutsceneAnimClip = {
                            id: crypto.randomUUID(),
                            name: firstClip || '动作片段',
                            clipAssetId: null,
                            clipName: firstClip,
                            startTime: currentTime,
                            duration: 1.5,
                            speed: 1,
                            loop: false,
                          }
                          updateActiveSeq(s => ({
                            ...s,
                            tracks: s.tracks.map(t => (t.id === track.id ? { ...t, clips: [...(t.clips ?? []), newClip] } : t)),
                          }))
                          setSelectedItem({ kind: 'clip', trackId: track.id, clipId: newClip.id })
                          setSelectedKeys([])
                        }}
                        title="在游标处插入动画片段"
                      >
                        +Clip
                      </button>
                    )}
                    <button
                      type="button"
                      className="cutscene-btn"
                      style={{ height: 18, padding: '0 4px' }}
                      onClick={() => updateActiveSeq(s => ({ ...s, tracks: s.tracks.filter(t => t.id !== track.id) }))}
                    >
                      <Trash2 size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )
          })}
        </div>

        {/* 右侧时间轴画布 */}
        <div
          className="cutscene-timeline-scroll"
          ref={scrollRef}
          onPointerDown={handleTimelineBlankPointerDown}
        >
          <div style={{ width: timelineWidth, position: 'relative', minHeight: '100%' }}>
            {/* 标尺 */}
            <div
              className="cutscene-ruler"
              onPointerDown={e => {
                scrubFromPointer(e.clientX)
                const move = (ev: PointerEvent) => scrubFromPointer(ev.clientX)
                const up = () => {
                  window.removeEventListener('pointermove', move)
                  window.removeEventListener('pointerup', up)
                }
                window.addEventListener('pointermove', move)
                window.addEventListener('pointerup', up)
              }}
            >
              {ticks.map(sec => (
                <div key={sec} className="cutscene-ruler-tick" style={{ left: sec * PX_PER_SEC }}>
                  {sec}s
                </div>
              ))}
            </div>

            {/* 框选矩形 */}
            {marquee && (
              <div
                className="cutscene-marquee"
                style={{
                  left: Math.min(marquee.x0, marquee.x1),
                  top: Math.min(marquee.y0, marquee.y1),
                  width: Math.abs(marquee.x1 - marquee.x0),
                  height: Math.abs(marquee.y1 - marquee.y0),
                }}
              />
            )}

            {/* 播放头 */}
            <div className="cutscene-playhead" style={{ left: currentTime * PX_PER_SEC }} />

            {/* 全局与导演分组分隔行 */}
            <div className="cutscene-section-lane" />

            {/* 导演镜头轨 */}
            <div
              className="cutscene-row-lane is-global"
              onDragOver={e => {
                if (isNodeDrag(e.dataTransfer)) {
                  e.preventDefault()
                  e.stopPropagation()
                }
              }}
              onDrop={e => {
                if (!isNodeDrag(e.dataTransfer)) return
                const nodeId = e.dataTransfer.getData(NODE_MIME)
                const dropped = nodeId ? nodes[nodeId] : undefined
                setDragOverPanel(false)
                if (!dropped || dropped.kind !== 'camera' || !scrollRef.current) return
                e.preventDefault()
                e.stopPropagation()
                const rect = scrollRef.current.getBoundingClientRect()
                const dropTime = Math.max(0, Number(((e.clientX - rect.left + scrollRef.current.scrollLeft) / PX_PER_SEC).toFixed(2)))
                const shot: CutsceneCameraShot = {
                  id: crypto.randomUUID(),
                  cameraNodeId: dropped.id,
                  label: dropped.name,
                  startTime: dropTime,
                  duration: 2,
                  blendIn: 0.35,
                }
                updateActiveSeq(s => ({ ...s, cameraTrack: [...s.cameraTrack, shot] }))
                setSelectedItem({ kind: 'shot', shotId: shot.id })
                setSelectedKeys([])
              }}
            >
              {activeSeq.cameraTrack.map(shot => {
                const isSel = selectedItem?.kind === 'shot' && selectedItem.shotId === shot.id
                const camName = nodes[shot.cameraNodeId]?.name || shot.label || '未指定相机'
                const baseStart = shot.startTime
                const baseDur = shot.duration
                return (
                  <div
                    key={shot.id}
                    className={`cutscene-clip is-camera${isSel ? ' is-selected' : ''}`}
                    style={{ left: shot.startTime * PX_PER_SEC, width: Math.max(20, shot.duration * PX_PER_SEC) }}
                    onClick={() => { setSelectedItem({ kind: 'shot', shotId: shot.id }); setSelectedKeys([]) }}
                    onPointerDown={startDrag(dx => {
                      updateActiveSeq(s => ({
                        ...s,
                        cameraTrack: s.cameraTrack.map(item => (
                          item.id === shot.id ? { ...item, startTime: Math.max(0, Number((baseStart + dx).toFixed(2))) } : item
                        )),
                      }))
                    })}
                  >
                    {camName}
                    <div
                      className="cutscene-clip__resize"
                      onPointerDown={startDrag(dx => {
                        updateActiveSeq(s => ({
                          ...s,
                          cameraTrack: s.cameraTrack.map(item => (
                            item.id === shot.id ? { ...item, duration: Math.max(0.1, Number((baseDur + dx).toFixed(2))) } : item
                          )),
                        }))
                      })}
                    />
                  </div>
                )
              })}
            </div>

            {/* 事件轨 */}
            <div className="cutscene-row-lane is-global">
              {activeSeq.eventTrack.map(ev => {
                const isSel = selectedItem?.kind === 'event' && selectedItem.eventId === ev.id
                const baseTime = ev.time
                return (
                  <div
                    key={ev.id}
                    className={`cutscene-key is-event${isSel ? ' is-selected' : ''}`}
                    style={{ left: ev.time * PX_PER_SEC }}
                    title={`${ev.kind}: ${ev.name || ev.assetId || ''}`}
                    onClick={() => { setSelectedItem({ kind: 'event', eventId: ev.id }); setSelectedKeys([]) }}
                    onPointerDown={startDrag(dx => {
                      updateActiveSeq(s => ({
                        ...s,
                        eventTrack: s.eventTrack.map(item => (
                          item.id === ev.id ? { ...item, time: Math.max(0, Number((baseTime + dx).toFixed(2))) } : item
                        )),
                      }))
                    })}
                  />
                )
              })}
            </div>

            {/* 场景画面与环境轨 */}
            <GroupSummaryLane
              className="cutscene-row-lane is-global"
              collapsed={collapsedGroups['__picture__'] === true}
              tracks={pictureTracks}
            />
            {!collapsedGroups['__picture__'] && pictureTracks.map(track => (
              <PropertyLane
                key={track.id}
                track={track}
                selectedKeys={selectedKeys}
                onKeyPointerDown={handleKeyPointerDown}
              />
            ))}

            {/* 物体动画分组分隔行 */}
            <div className="cutscene-section-lane" />

            {/* 各绑定节点轨道 */}
            {boundNodeIds.map(nodeId => {
              const nodeTracks = activeSeq.tracks.filter(t => t.targetNodeId === nodeId)
              const isCollapsed = collapsedGroups[nodeId] === true
              return (
                <div key={nodeId}>
                  <GroupSummaryLane
                    className="cutscene-row-lane is-node-group"
                    collapsed={isCollapsed}
                    tracks={nodeTracks}
                  />
                  {!isCollapsed && nodeTracks.map(track => {
                    if (track.kind === 'animation') {
                      return (
                        <div
                          key={track.id}
                          className="cutscene-row-lane"
                          onDragOver={e => {
                            if (e.dataTransfer.types.includes(CLIP_MIME)) e.preventDefault()
                          }}
                          onDrop={e => {
                            const raw = e.dataTransfer.getData(CLIP_MIME)
                            const drag = readClipDrag(raw)
                            if (!drag || !scrollRef.current) return
                            e.preventDefault()
                            const rect = scrollRef.current.getBoundingClientRect()
                            const dropTime = Math.max(0, Number(((e.clientX - rect.left + scrollRef.current.scrollLeft) / PX_PER_SEC).toFixed(2)))
                            const clip: CutsceneAnimClip = {
                              id: crypto.randomUUID(),
                              name: drag.clip,
                              clipAssetId: drag.assetId === nodes[nodeId]?.assetId ? null : drag.assetId,
                              clipName: drag.clip,
                              startTime: dropTime,
                              duration: 1.5,
                              speed: 1,
                              loop: false,
                            }
                            updateActiveSeq(s => ({
                              ...s,
                              tracks: s.tracks.map(t => (t.id === track.id ? { ...t, clips: [...(t.clips ?? []), clip] } : t)),
                            }))
                            setSelectedItem({ kind: 'clip', trackId: track.id, clipId: clip.id })
                            setSelectedKeys([])
                          }}
                        >
                          {(track.clips ?? []).map(clip => {
                            const isSel = selectedItem?.kind === 'clip' && selectedItem.clipId === clip.id
                            const baseStart = clip.startTime
                            const baseDur = clip.duration
                            return (
                              <div
                                key={clip.id}
                                className={`cutscene-clip${isSel ? ' is-selected' : ''}`}
                                style={{ left: clip.startTime * PX_PER_SEC, width: Math.max(20, clip.duration * PX_PER_SEC) }}
                                onClick={() => { setSelectedItem({ kind: 'clip', trackId: track.id, clipId: clip.id }); setSelectedKeys([]) }}
                                onPointerDown={startDrag(dx => {
                                  updateActiveSeq(s => ({
                                    ...s,
                                    tracks: s.tracks.map(t => (
                                      t.id === track.id
                                        ? {
                                            ...t,
                                            clips: (t.clips ?? []).map(c => (
                                              c.id === clip.id ? { ...c, startTime: Math.max(0, Number((baseStart + dx).toFixed(2))) } : c
                                            )),
                                          }
                                        : t
                                    )),
                                  }))
                                })}
                              >
                                {clip.clipName || clip.name || 'Clip'}
                                <div
                                  className="cutscene-clip__resize"
                                  onPointerDown={startDrag(dx => {
                                    updateActiveSeq(s => ({
                                      ...s,
                                      tracks: s.tracks.map(t => (
                                        t.id === track.id
                                          ? {
                                              ...t,
                                              clips: (t.clips ?? []).map(c => (
                                                c.id === clip.id ? { ...c, duration: Math.max(0.1, Number((baseDur + dx).toFixed(2))) } : c
                                              )),
                                            }
                                          : t
                                      )),
                                    }))
                                  })}
                                />
                              </div>
                            )
                          })}
                        </div>
                      )
                    }
                    return (
                      <PropertyLane
                        key={track.id}
                        track={track}
                        selectedKeys={selectedKeys}
                        onKeyPointerDown={handleKeyPointerDown}
                      />
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* 底部选中项微调栏 */}
      {(singleKey || selectedKeys.length > 1 || selectedClip || selectedShot || selectedEvent) && (
        <div className="cutscene-inspector-bar">
          {selectedKeys.length > 1 && (
            <>
              <span style={{ color: 'var(--accent)', fontWeight: 600 }}>已多选 {selectedKeys.length} 个关键帧</span>
              <label>
                批量缓动
                <select
                  value={multiSelectedEase === 'mixed' ? '' : multiSelectedEase}
                  onChange={e => {
                    if (!e.target.value) return
                    applyEaseToSelectedKeys(e.target.value as CutsceneKeyEase)
                  }}
                >
                  {multiSelectedEase === 'mixed' && <option value="">(混合)</option>}
                  {EASE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              {multiSelectedEase !== 'mixed' && <EaseCurvePreview ease={multiSelectedEase} />}
              <span style={{ color: 'var(--text-muted)' }}>拖动可批量平移 · Ctrl+C/V 复制粘贴 · Delete 删除</span>
            </>
          )}

          {singleKey && singleKeyTrack && (
            <>
              <span style={{ color: 'var(--accent)', fontWeight: 600 }}>关键帧 ({singleKeyTrack.label})</span>
              <label>
                时间(s)
                <input
                  type="number"
                  step={0.05}
                  min={0}
                  style={{ width: 62 }}
                  value={singleKey.time}
                  onChange={e => {
                    const tVal = Math.max(0, Number(e.target.value) || 0)
                    updateActiveSeq(s => ({
                      ...s,
                      tracks: s.tracks.map(t => (
                        t.id === singleKeyTrack.id
                          ? { ...t, keys: (t.keys ?? []).map(k => (k.id === singleKey.id ? { ...k, time: tVal } : k)).sort((a, b) => a.time - b.time) }
                          : t
                      )),
                    }))
                  }}
                />
              </label>
              <label>
                缓动
                <select
                  value={singleKey.ease ?? 'smooth'}
                  onChange={e => {
                    const ease = e.target.value as CutsceneKeyEase
                    updateActiveSeq(s => ({
                      ...s,
                      tracks: s.tracks.map(t => (
                        t.id === singleKeyTrack.id
                          ? { ...t, keys: (t.keys ?? []).map(k => (k.id === singleKey.id ? { ...k, ease } : k)) }
                          : t
                      )),
                    }))
                  }}
                >
                  {EASE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <EaseCurvePreview ease={singleKey.ease ?? 'smooth'} />
              <KeyValueEditor
                valueType={singleKeyTrack.valueType ?? 'number'}
                value={singleKey.value}
                onChange={nextVal => {
                  updateActiveSeq(s => ({
                    ...s,
                    tracks: s.tracks.map(t => (
                      t.id === singleKeyTrack.id
                        ? { ...t, keys: (t.keys ?? []).map(k => (k.id === singleKey.id ? { ...k, value: nextVal } : k)) }
                        : t
                    )),
                  }))
                }}
              />
              <button type="button" className="cutscene-btn" onClick={deleteSelectedKeys}>
                <Trash2 size={11} /> 删除帧
              </button>
            </>
          )}

          {selectedClip && selectedTrack && (
            <>
              <span style={{ color: 'var(--accent)', fontWeight: 600 }}>动作片段</span>
              <label>
                片段
                <select
                  value={selectedClip.clipName}
                  onChange={e => {
                    const clipName = e.target.value
                    updateActiveSeq(s => ({
                      ...s,
                      tracks: s.tracks.map(t => (
                        t.id === selectedTrack.id
                          ? { ...t, clips: (t.clips ?? []).map(c => (c.id === selectedClip.id ? { ...c, clipName, name: clipName } : c)) }
                          : t
                      )),
                    }))
                  }}
                >
                  <option value="">(选择片段)</option>
                  {clipNamesFor(nodes[selectedTrack.targetNodeId]?.assetId ?? null).map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </label>
              <label>
                倍速
                <input
                  type="number"
                  step={0.1}
                  min={0.1}
                  style={{ width: 52 }}
                  value={selectedClip.speed ?? 1}
                  onChange={e => {
                    const speed = Math.max(0.05, Number(e.target.value) || 1)
                    updateActiveSeq(s => ({
                      ...s,
                      tracks: s.tracks.map(t => (
                        t.id === selectedTrack.id
                          ? { ...t, clips: (t.clips ?? []).map(c => (c.id === selectedClip.id ? { ...c, speed } : c)) }
                          : t
                      )),
                    }))
                  }}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={selectedClip.loop === true}
                  onChange={e => {
                    const loop = e.target.checked
                    updateActiveSeq(s => ({
                      ...s,
                      tracks: s.tracks.map(t => (
                        t.id === selectedTrack.id
                          ? { ...t, clips: (t.clips ?? []).map(c => (c.id === selectedClip.id ? { ...c, loop } : c)) }
                          : t
                      )),
                    }))
                  }}
                /> 循环
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={selectedClip.inPlace === true}
                  onChange={e => {
                    const inPlace = e.target.checked
                    updateActiveSeq(s => ({
                      ...s,
                      tracks: s.tracks.map(t => (
                        t.id === selectedTrack.id
                          ? { ...t, clips: (t.clips ?? []).map(c => (c.id === selectedClip.id ? { ...c, inPlace } : c)) }
                          : t
                      )),
                    }))
                  }}
                /> 锁根
              </label>
              <button
                type="button"
                className="cutscene-btn"
                onClick={() => {
                  updateActiveSeq(s => ({
                    ...s,
                    tracks: s.tracks.map(t => (
                      t.id === selectedTrack.id
                        ? { ...t, clips: (t.clips ?? []).filter(c => c.id !== selectedClip.id) }
                        : t
                    )),
                  }))
                  setSelectedItem(null)
                }}
              >
                <Trash2 size={11} /> 删除
              </button>
            </>
          )}

          {selectedShot && (
            <>
              <span style={{ color: 'var(--color-image)', fontWeight: 600 }}>导演镜头</span>
              <label>
                相机节点
                <select
                  value={selectedShot.cameraNodeId}
                  onChange={e => {
                    const cameraNodeId = e.target.value
                    updateActiveSeq(s => ({
                      ...s,
                      cameraTrack: s.cameraTrack.map(item => (item.id === selectedShot.id ? { ...item, cameraNodeId } : item)),
                    }))
                  }}
                >
                  <option value="">(选择相机)</option>
                  {cameraNodes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              <label>
                切入过渡(s)
                <input
                  type="number"
                  step={0.05}
                  min={0}
                  style={{ width: 54 }}
                  value={selectedShot.blendIn ?? 0}
                  onChange={e => {
                    const blendIn = Math.max(0, Number(e.target.value) || 0)
                    updateActiveSeq(s => ({
                      ...s,
                      cameraTrack: s.cameraTrack.map(item => (item.id === selectedShot.id ? { ...item, blendIn } : item)),
                    }))
                  }}
                />
              </label>
              <button
                type="button"
                className="cutscene-btn"
                onClick={() => {
                  updateActiveSeq(s => ({ ...s, cameraTrack: s.cameraTrack.filter(item => item.id !== selectedShot.id) }))
                  setSelectedItem(null)
                }}
              >
                <Trash2 size={11} /> 删除
              </button>
            </>
          )}

          {selectedEvent && (
            <>
              <span style={{ color: 'var(--color-object)', fontWeight: 600 }}>事件点</span>
              <label>
                类型
                <select
                  value={selectedEvent.kind}
                  onChange={e => {
                    const kind = e.target.value as CutsceneEventKey['kind']
                    updateActiveSeq(s => ({
                      ...s,
                      eventTrack: s.eventTrack.map(item => (item.id === selectedEvent.id ? { ...item, kind } : item)),
                    }))
                  }}
                >
                  <option value="message">律令/脚本消息</option>
                  <option value="sound">播放音效</option>
                  <option value="showUi">显示 UI</option>
                  <option value="hideUi">隐藏 UI</option>
                </select>
              </label>
              <label>
                名称/消息
                <input
                  type="text"
                  style={{ width: 140 }}
                  value={selectedEvent.name}
                  onChange={e => {
                    const name = e.target.value
                    updateActiveSeq(s => ({
                      ...s,
                      eventTrack: s.eventTrack.map(item => (item.id === selectedEvent.id ? { ...item, name } : item)),
                    }))
                  }}
                />
              </label>
              <button
                type="button"
                className="cutscene-btn"
                onClick={() => {
                  updateActiveSeq(s => ({ ...s, eventTrack: s.eventTrack.filter(item => item.id !== selectedEvent.id) }))
                  setSelectedItem(null)
                }}
              >
                <Trash2 size={11} /> 删除
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function PropertyLane({
  track,
  selectedKeys,
  onKeyPointerDown,
}: {
  track: CutsceneTrack
  selectedKeys: KeyRef[]
  onKeyPointerDown: (trackId: string, keyId: string, e: React.PointerEvent) => void
}) {
  return (
    <div className="cutscene-row-lane">
      {(track.keys ?? []).map(k => {
        const isSel = selectedKeys.some(ref => ref.trackId === track.id && ref.keyId === k.id)
        const ease = k.ease ?? 'smooth'
        return (
          <div
            key={k.id}
            className={`cutscene-key${isSel ? ' is-selected' : ''}`}
            data-ease={ease}
            style={{ left: k.time * PX_PER_SEC }}
            title={`t=${k.time}s, ease=${ease}, val=${JSON.stringify(k.value)}`}
            onPointerDown={e => onKeyPointerDown(track.id, k.id, e)}
          />
        )
      })}
    </div>
  )
}

function KeyValueEditor({
  valueType,
  value,
  onChange,
}: {
  valueType: CutsceneValueType
  value: CutscenePropertyKey['value']
  onChange: (next: CutscenePropertyKey['value']) => void
}) {
  if (valueType === 'boolean') {
    return (
      <label>
        值
        <input type="checkbox" checked={Boolean(value)} onChange={e => onChange(e.target.checked)} />
      </label>
    )
  }
  if (valueType === 'color') {
    return (
      <label>
        颜色
        <input type="color" value={typeof value === 'string' ? value : '#ffffff'} onChange={e => onChange(e.target.value)} />
      </label>
    )
  }
  if (valueType === 'vec2' || valueType === 'vec3' || valueType === 'vec4') {
    const len = valueType === 'vec2' ? 2 : valueType === 'vec3' ? 3 : 4
    const arr = Array.isArray(value) ? value : Array.from({ length: len }, () => 0)
    return (
      <label>
        数值
        {Array.from({ length: len }, (_, i) => (
          <input
            key={i}
            type="number"
            step={0.1}
            style={{ width: 54 }}
            value={Number(arr[i]) || 0}
            onChange={e => {
              const next = arr.slice()
              next[i] = Number(e.target.value) || 0
              onChange(next)
            }}
          />
        ))}
      </label>
    )
  }
  if (valueType === 'string') {
    return (
      <label>
        值
        <input type="text" value={String(value ?? '')} onChange={e => onChange(e.target.value)} />
      </label>
    )
  }
  return (
    <label>
      数值
      <input
        type="number"
        step={0.05}
        style={{ width: 70 }}
        value={Number(value) || 0}
        onChange={e => onChange(Number(e.target.value) || 0)}
      />
    </label>
  )
}

function EaseCurvePreview({ ease }: { ease: CutsceneKeyEase }) {
  const w = 48
  const h = 24
  const padX = 4
  const padY = 5
  const innerW = w - padX * 2
  const innerH = h - padY * 2

  const path = useMemo(() => {
    if (ease === 'step') {
      const x0 = padX
      const x1 = padX + innerW
      const y0 = padY + innerH
      const y1 = padY
      return `M ${x0} ${y0} L ${x1} ${y0} L ${x1} ${y1}`
    }
    const steps = 24
    const pts: string[] = []
    for (let i = 0; i <= steps; i += 1) {
      const u = i / steps
      const v = evalEaseFactor(ease, u)
      const x = padX + u * innerW
      const y = padY + (1 - v) * innerH
      pts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`)
    }
    return pts.join(' ')
  }, [ease, innerH, innerW])

  return (
    <span className="cutscene-ease-preview" title={`过渡曲线预览: ${ease}`}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        <line
          x1={padX}
          y1={padY + innerH}
          x2={padX + innerW}
          y2={padY}
          stroke="rgba(255,255,255,0.14)"
          strokeWidth={1}
          strokeDasharray="2 2"
        />
        <path
          d={path}
          fill="none"
          stroke={ease === 'step' ? '#f59e0b' : ease === 'linear' ? '#38bdf8' : 'var(--accent)'}
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  )
}

function GroupSummaryLane({
  className,
  collapsed,
  tracks,
}: {
  className: string
  collapsed: boolean
  tracks: readonly CutsceneTrack[]
}) {
  const summary = useMemo(() => {
    if (!collapsed) return null
    const times = new Set<number>()
    const spans: Array<{ id: string; start: number; dur: number }> = []
    for (const track of tracks) {
      for (const k of track.keys ?? []) times.add(Number(k.time.toFixed(3)))
      for (const c of track.clips ?? []) spans.push({ id: c.id, start: c.startTime, dur: c.duration })
    }
    return { times: Array.from(times), spans }
  }, [collapsed, tracks])

  return (
    <div className={className}>
      {summary && summary.spans.map(sp => (
        <div
          key={sp.id}
          className="cutscene-summary-span"
          style={{ left: sp.start * PX_PER_SEC, width: Math.max(8, sp.dur * PX_PER_SEC) }}
        />
      ))}
      {summary && summary.times.map(t => (
        <div
          key={t}
          className="cutscene-summary-dot"
          style={{ left: t * PX_PER_SEC }}
        />
      ))}
    </div>
  )
}
