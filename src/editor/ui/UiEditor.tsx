import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  Gauge,
  Grid,
  Image as ImageIcon,
  Layers,
  MousePointerClick,
  Redo2,
  Square,
  Trash2,
  Type,
  Undo2,
  X,
} from 'lucide-react'
import { useAssetStore } from '../assets/library'
import { translate, useI18n, type MessageKey } from '../i18n'
import type { UiLayout, UiNode, UiNodeType, UiStateKind, UiStyle } from '../../runtime/ui/spec'
import { UI_NODE_TYPES } from '../../runtime/ui/spec'
import { EMPTY_UI_VALUES, resolveUiTree } from '../../runtime/ui/bindings'
import { UiDomDocument } from '../../runtime/ui/dom'
import { collectUiBindings, findUiNode, flattenUi, mapUiNode, parentOf } from '../../runtime/ui/tree'
import { patchSelected, readDocument, useUiEditor } from './session'
import './UiEditor.css'

const SIZES = [
  { id: '1080', label: '1920×1080 (FHD)', width: 1920, height: 1080 },
  { id: '720', label: '1280×720 (HD)', width: 1280, height: 720 },
  { id: 'phone', label: '390×844 (Mobile)', width: 390, height: 844 },
]

const ANCHOR_GRID: { id: string, title: MessageKey, x: number, y: number, px: number, py: number }[] = [
  { id: 'tl', title: 'ui.anchor.tl', x: 0, y: 0, px: 0, py: 0 },
  { id: 'tc', title: 'ui.anchor.tc', x: 0.5, y: 0, px: 0.5, py: 0 },
  { id: 'tr', title: 'ui.anchor.tr', x: 1, y: 0, px: 1, py: 0 },
  { id: 'ml', title: 'ui.anchor.ml', x: 0, y: 0.5, px: 0, py: 0.5 },
  { id: 'mc', title: 'ui.anchor.mc', x: 0.5, y: 0.5, px: 0.5, py: 0.5 },
  { id: 'mr', title: 'ui.anchor.mr', x: 1, y: 0.5, px: 1, py: 0.5 },
  { id: 'bl', title: 'ui.anchor.bl', x: 0, y: 1, px: 0, py: 1 },
  { id: 'bc', title: 'ui.anchor.bc', x: 0.5, y: 1, px: 0.5, py: 1 },
  { id: 'br', title: 'ui.anchor.br', x: 1, y: 1, px: 1, py: 1 },
]

function nodeTypeIcon(type: UiNodeType): ReactNode {
  switch (type) {
    case 'panel': return <Square size={12} />
    case 'stack': return <Layers size={12} />
    case 'text': return <Type size={12} />
    case 'fps': return <Activity size={12} />
    case 'image': return <ImageIcon size={12} />
    case 'button': return <MousePointerClick size={12} />
    case 'progress': return <Gauge size={12} />
  }
}

export function UiEditor() {
  const { t } = useI18n()
  const assetId = useUiEditor(state => state.assetId)
  const selectedId = useUiEditor(state => state.selectedId)
  const selectedIds = useUiEditor(state => state.selectedIds)
  const overrides = useUiEditor(state => state.overrides)
  const canUndo = useUiEditor(state => state.past.length > 0)
  const canRedo = useUiEditor(state => state.future.length > 0)
  const revision = useAssetStore(state => state.revision)
  const document = assetId ? readDocument(assetId) : null
  const [sizeId, setSizeId] = useState('720')
  const [zoom, setZoom] = useState(0.55)
  const [showGrid, setShowGrid] = useState(true)
  const [styleState, setStyleState] = useState<'normal' | UiStateKind>('normal')
  const [notice, setNotice] = useState('')
  const [live, setLive] = useState<Record<string, Partial<UiLayout>>>({})
  const [marquee, setMarquee] = useState<{ x: number, y: number, w: number, h: number } | null>(null)
  const [panning, setPanning] = useState(false)
  const liveRef = useRef<Record<string, Partial<UiLayout>>>({})
  const zoomRef = useRef(zoom)
  const stageRef = useRef<HTMLDivElement>(null)
  zoomRef.current = zoom

  useEffect(() => {
    if (assetId && !document) useUiEditor.getState().close()
  }, [assetId, document])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      if (event.deltaY === 0) return
      const step = event.deltaY > 0 ? -0.05 : 0.05
      setZoom(current => Math.min(1.5, Math.max(0.25, Math.round((current + step) * 20) / 20)))
    }
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 1) return
      event.preventDefault()
      const originX = event.clientX
      const originY = event.clientY
      const scrollLeft = stage.scrollLeft
      const scrollTop = stage.scrollTop
      setPanning(true)
      const move = (next: PointerEvent) => {
        stage.scrollLeft = scrollLeft - (next.clientX - originX)
        stage.scrollTop = scrollTop - (next.clientY - originY)
      }
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        setPanning(false)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    stage.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      stage.removeEventListener('wheel', onWheel)
      stage.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [assetId, document?.root.id])

  const size = SIZES.find(item => item.id === sizeId) ?? SIZES[1]
  const selected = document ? (findUiNode(document.root, selectedId) ?? document.root) : null
  const preview = useMemo(() => {
    if (!document) return null
    return applyLive(resolveUiTree(document.root, EMPTY_UI_VALUES, overrides), live)
  }, [document, overrides, live, revision])

  if (!assetId || !document || !preview || !selected) return null

  const startMarquee = (event: { clientX: number, clientY: number, shiftKey: boolean, ctrlKey: boolean, metaKey: boolean, button: number }) => {
    const stage = stageRef.current
    if (!stage || event.button !== 0) return
    const start = { x: event.clientX, y: event.clientY }
    const additive = event.shiftKey || event.ctrlKey || event.metaKey
    const previous = additive ? useUiEditor.getState().selectedIds.filter(id => id !== document.root.id) : []
    let moved = false
    const toStage = (clientX: number, clientY: number) => {
      const rect = stage.getBoundingClientRect()
      return { x: clientX - rect.left + stage.scrollLeft, y: clientY - rect.top + stage.scrollTop }
    }
    const move = (next: PointerEvent) => {
      if (Math.hypot(next.clientX - start.x, next.clientY - start.y) < 4) return
      moved = true
      const a = toStage(start.x, start.y)
      const b = toStage(next.clientX, next.clientY)
      setMarquee({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) })
    }
    const up = (next: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setMarquee(null)
      if (!moved) {
        useUiEditor.getState().select(document.root.id)
        return
      }
      const box = {
        left: Math.min(start.x, next.clientX),
        top: Math.min(start.y, next.clientY),
        right: Math.max(start.x, next.clientX),
        bottom: Math.max(start.y, next.clientY),
      }
      const hits: string[] = []
      const seen = new Set<string>()
      stage.querySelectorAll<HTMLElement>('[data-ui-node-id]').forEach(element => {
        const id = element.dataset.uiNodeId
        if (!id || id === document.root.id || seen.has(id)) return
        const rect = element.getBoundingClientRect()
        if (rect.width < 1 || rect.height < 1) return
        const overlap = Math.min(rect.right, box.right) - Math.max(rect.left, box.left)
        const overlapY = Math.min(rect.bottom, box.bottom) - Math.max(rect.top, box.top)
        if (overlap <= 0 || overlapY <= 0) return
        seen.add(id)
        hits.push(id)
      })
      const ids = [...new Set([...previous, ...hits])]
      if (ids.length === 0) useUiEditor.getState().select(document.root.id)
      else useUiEditor.getState().selectIds(ids)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const startDrag = (id: string, event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    if (event.ctrlKey || event.metaKey || event.shiftKey) return
    const chosen = useUiEditor.getState().selectedIds.includes(id) ? useUiEditor.getState().selectedIds : [id]
    const origins = chosen.flatMap(itemId => {
      if (itemId === document.root.id) return []
      if (chosen.some(other => other !== itemId && other !== document.root.id && isInside(document.root, other, itemId))) return []
      const node = findUiNode(document.root, itemId)
      if (!node) return []
      return [{ id: itemId, x: node.layout?.x ?? 0, y: node.layout?.y ?? 0 }]
    })
    if (origins.length === 0) return
    const pointer = { x: event.clientX, y: event.clientY }
    const move = (next: PointerEvent) => {
      next.preventDefault()
      const scale = zoomRef.current || 1
      const dx = Math.round((next.clientX - pointer.x) / scale)
      const dy = Math.round((next.clientY - pointer.y) / scale)
      liveRef.current = Object.fromEntries(origins.map(item => [item.id, { x: item.x + dx, y: item.y + dy }]))
      setLive(liveRef.current)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const patches = liveRef.current
      liveRef.current = {}
      setLive({})
      const fresh = readDocument(assetId)
      if (!fresh || Object.keys(patches).length === 0) return
      let root = fresh.root
      for (const item of origins) {
        const patch = patches[item.id]
        const target = patch ? findUiNode(root, item.id) : null
        if (!patch || !target) continue
        root = replaceLayout(root, item.id, { ...(target.layout ?? { mode: 'anchor' }), ...patch })
      }
      useUiEditor.getState().commit({ ...fresh, root })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const startResize = (id: string, event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    const node = findUiNode(document.root, id)
    if (!node) return
    const origin = { x: event.clientX, y: event.clientY, width: node.layout?.width ?? 80, height: node.layout?.height ?? 32 }
    const move = (next: PointerEvent) => {
      const scale = zoomRef.current || 1
      const patch = {
        width: Math.max(8, Math.round(origin.width + (next.clientX - origin.x) / scale)),
        height: Math.max(8, Math.round(origin.height + (next.clientY - origin.y) / scale)),
      }
      liveRef.current = { [id]: patch }
      setLive(liveRef.current)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const patch = liveRef.current[id]
      liveRef.current = {}
      setLive({})
      if (!patch) return
      const fresh = readDocument(assetId)
      const target = fresh ? findUiNode(fresh.root, id) : null
      if (!fresh || !target) return
      useUiEditor.getState().commit({
        ...fresh,
        root: replaceLayout(fresh.root, id, { ...(target.layout ?? { mode: 'anchor' }), ...patch }),
      })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const toggleNodeVisible = (node: UiNode) => {
    const nextVis = node.visible === false
    useUiEditor.getState().commit({
      ...document,
      root: mapUiNode(document.root, node.id, (n) => ({ ...n, visible: nextVis })),
    })
  }

  const bindings = collectUiBindings(document.root)
  const assetName = useAssetStore.getState().assets[assetId]?.name ?? t('ui.docFallback')

  return (
    <section className="ui-editor">
      <header className="ui-editor__bar">
        <div className="ui-editor__brand">
          <span className="ui-editor__badge">UI</span>
          <strong>{assetName}</strong>
        </div>

        <div className="ui-editor__sep" />

        <select className="ui-editor__select" value={sizeId} onChange={event => setSizeId(event.target.value)} title={t('ui.canvasSize')}>
          {SIZES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>

        <div className="ui-editor__zoom-group" title={t('ui.canvasZoom')}>
          <input
            type="range"
            min={0.25}
            max={1.5}
            step={0.05}
            value={zoom}
            onChange={event => setZoom(Number(event.target.value))}
          />
          <button type="button" className="ui-editor__chip" onClick={() => setZoom(0.55)}>
            {Math.round(zoom * 100)}%
          </button>
        </div>

        <button
          type="button"
          className={`ui-editor__icon-btn ${showGrid ? 'is-on' : ''}`}
          title={t('ui.grid')}
          onClick={() => setShowGrid(v => !v)}
        >
          <Grid size={14} />
        </button>

        <div className="ui-editor__sep" />

        <div className="ui-editor__state-tabs" title={t('ui.statePreview')}>
          {(['normal', 'hover', 'pressed', 'disabled'] as const).map(st => (
            <button
              key={st}
              type="button"
              className={`ui-editor__tab ${styleState === st ? 'is-on' : ''}`}
              onClick={() => setStyleState(st)}
            >
              {t(`ui.state.${st}`)}
            </button>
          ))}
        </div>

        <div className="ui-editor__sep" />

        <button type="button" className="ui-editor__icon-btn" title={t('ui.undo')} disabled={!canUndo} onClick={() => useUiEditor.getState().undo()}>
          <Undo2 size={14} />
        </button>
        <button type="button" className="ui-editor__icon-btn" title={t('ui.redo')} disabled={!canRedo} onClick={() => useUiEditor.getState().redo()}>
          <Redo2 size={14} />
        </button>

        <span className="ui-editor__notice">{notice}</span>

        <button type="button" className="ui-editor__close" onClick={() => useUiEditor.getState().close()}>
          <X size={14} />
          <span>{t('ui.close')}</span>
        </button>
      </header>

      <div className="ui-editor__body">
        {/* 左侧：控件库与图层树 */}
        <aside className="ui-editor__tree">
          <div className="ui-editor__pane-head">
            <span>{t('ui.addControl')}</span>
          </div>
          <div className="ui-editor__palette">
            {UI_NODE_TYPES.map(type => (
              <button
                key={type}
                type="button"
                className="ui-editor__palette-btn"
                title={t('ui.addNamed', { name: t(`ui.type.${type}`) })}
                onClick={() => useUiEditor.getState().addNode(type)}
              >
                {nodeTypeIcon(type)}
                <span>{t(`ui.type.${type}`)}</span>
              </button>
            ))}
          </div>

          <div className="ui-editor__pane-head">
            <span>{t('ui.layers')}</span>
            <div className="ui-editor__tree-actions">
              <button type="button" title={t('ui.up')} disabled={selectedId === document.root.id} onClick={() => useUiEditor.getState().shiftSelected(-1)}>
                <ArrowUp size={12} />
              </button>
              <button type="button" title={t('ui.down')} disabled={selectedId === document.root.id} onClick={() => useUiEditor.getState().shiftSelected(1)}>
                <ArrowDown size={12} />
              </button>
              <button type="button" title={t('ui.delete')} disabled={!selectedIds.some(id => id !== document.root.id)} onClick={() => useUiEditor.getState().removeSelected()}>
                <Trash2 size={12} />
              </button>
            </div>
          </div>

          <div className="ui-editor__tree-list">
            {flattenUi(document.root).map(item => {
              const hidden = item.node.visible === false
              return (
                <div
                  key={item.node.id}
                  className={`ui-editor__row ${selectedIds.includes(item.node.id) ? 'ui-editor__row--on' : ''} ${hidden ? 'is-hidden' : ''}`}
                  style={{ paddingLeft: 8 + item.depth * 14 }}
                  onClick={event => {
                    if (event.shiftKey) {
                      useUiEditor.getState().selectRange(selectedId, item.node.id, flattenUi(document.root).map(row => row.node.id))
                      return
                    }
                    useUiEditor.getState().select(item.node.id, event.ctrlKey || event.metaKey ? 'toggle' : 'replace')
                  }}
                >
                  <span className="ui-editor__row-icon">{nodeTypeIcon(item.node.type)}</span>
                  <span className="ui-editor__row-label">{item.node.name || t(`ui.type.${item.node.type}`)}</span>
                  <button
                    type="button"
                    className="ui-editor__row-eye"
                    title={hidden ? t('ui.show') : t('ui.hide')}
                    onClick={e => {
                      e.stopPropagation()
                      toggleNodeVisible(item.node)
                    }}
                  >
                    {hidden ? <EyeOff size={12} /> : <Eye size={12} />}
                  </button>
                </div>
              )
            })}
          </div>
        </aside>

        {/* 中央：画布舞台 */}
        <div
          ref={stageRef}
          className={`ui-editor__stage ${showGrid ? 'has-grid' : ''} ${panning ? 'is-panning' : ''}`}
          onMouseDown={event => { if (event.button === 1) event.preventDefault() }}
          onPointerDown={event => {
            if (event.button !== 0) return
            const target = event.target as HTMLElement
            if (target.closest('[data-ui-node-id]')) return
            startMarquee(event)
          }}
        >
          <div className="ui-editor__scaler" style={{ width: size.width * zoom, height: size.height * zoom }}>
            <div className="ui-editor__frame-meta">
              {size.width} × {size.height}
            </div>
            <div className="ui-editor__frame" style={{ width: size.width, height: size.height, transform: `scale(${zoom})` }}>
              <UiDomDocument
                root={preview}
                pickable
                selectedId={selectedId}
                selectedIds={selectedIds}
                previewState={styleState === 'normal' ? undefined : styleState}
                resolveImageUrl={textureUrl}
                onSelect={(id, event) => {
                  if (id === document.root.id) return
                  if (event?.shiftKey) useUiEditor.getState().select(id, 'add')
                  else if (event?.ctrlKey || event?.metaKey) useUiEditor.getState().select(id, 'toggle')
                  else useUiEditor.getState().select(id, useUiEditor.getState().selectedIds.includes(id) ? 'keep' : 'replace')
                }}
                onActivate={node => setNotice(node.click ? translate('ui.previewClick', { name: node.name || node.text || node.id, detail: clickDetail(node) }) : '')}
                onDragStart={startDrag}
                onResizeStart={startResize}
              />
            </div>
          </div>
          {marquee && <div className="ui-editor__marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />}

          <div className="ui-editor__status-pill">
            <span>{selectedIds.length > 1 ? t('ui.selectedCount', { count: selectedIds.length }) : (selected.name || t(`ui.type.${selected.type}`))}</span>
            <em>{t(`ui.type.${selected.type}`)}</em>
            {selected.layout?.width !== undefined && selectedIds.length < 2 && (
              <span>{selected.layout.width}×{selected.layout.height ?? 0}</span>
            )}
            <span className="ui-editor__status-hint">{t('ui.stageHint')}</span>
          </div>
        </div>

        {/* 右侧：属性面板 */}
        <aside className="ui-editor__inspector">
          <NodeFields node={selected} isRoot={selected.id === document.root.id} styleState={styleState} onStyleState={setStyleState} />
          {bindings.length > 0 && (
            <div className="ui-editor__card">
              <div className="ui-editor__card-title">{t('ui.fake')}</div>
              <div className="ui-editor__card-body">
                {bindings.map(item => (
                  <label key={item.binding.id} className="ui-editor__field">
                    <span>{item.node.name || item.binding.target}</span>
                    <input
                      value={String(overrides[item.binding.id] ?? '')}
                      placeholder={item.binding.source.kind === 'variable' ? item.binding.source.varId : item.binding.source.field}
                      onChange={event => useUiEditor.getState().setOverride(item.binding.id, event.target.value)}
                    />
                  </label>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>
    </section>
  )
}

function NodeFields({
  node,
  isRoot,
  styleState,
  onStyleState,
}: {
  node: UiNode
  isRoot: boolean
  styleState: 'normal' | UiStateKind
  onStyleState: (state: 'normal' | UiStateKind) => void
}) {
  const { t } = useI18n()
  const assets = useAssetStore(state => state.assets)
  const textures = useMemo(() => Object.values(assets).filter(asset => asset.kind === 'texture'), [assets])
  const layout = node.layout ?? { mode: 'anchor' as const }
  const activeStyle = styleState === 'normal' ? (node.style ?? {}) : (node.stateStyles?.[styleState] ?? {})
  const setLayout = (patch: Partial<UiLayout>) => patchSelected({ layout: { ...layout, ...patch } })
  const setStyle = (patch: Partial<UiStyle>) => {
    if (styleState === 'normal') {
      patchSelected({ style: { ...(node.style ?? {}), ...patch } })
      return
    }
    patchSelected({ stateStyles: { ...(node.stateStyles ?? {}), [styleState]: { ...activeStyle, ...patch } } })
  }

  return (
    <>
      <div className="ui-editor__card">
        <div className="ui-editor__card-title">
          <span>{t('ui.basic')}</span>
          <em>{t(`ui.type.${node.type}`)}</em>
        </div>
        <div className="ui-editor__card-body">
          <label className="ui-editor__field">
            <span>{t('ui.name')}</span>
            <input defaultValue={node.name ?? ''} key={`${node.id}:name:${node.name ?? ''}`} onBlur={event => patchSelected({ name: event.target.value })} />
          </label>
          <div className="ui-editor__checks">
            <label>
              <input type="checkbox" checked={node.visible !== false} onChange={e => patchSelected({ visible: e.target.checked })} />
              <span>{t('ui.show')}</span>
            </label>
            <label>
              <input type="checkbox" checked={node.enabled !== false} onChange={e => patchSelected({ enabled: e.target.checked })} />
              <span>{t('ui.interact')}</span>
            </label>
          </div>
          {(node.type === 'text' || node.type === 'button' || node.type === 'fps') && (
            <label className="ui-editor__field">
              <span>{t('ui.text')}</span>
              <input defaultValue={node.text ?? ''} key={`${node.id}:text:${node.text ?? ''}`} onBlur={event => patchSelected({ text: event.target.value })} />
            </label>
          )}
          {node.type === 'image' && (
            <label className="ui-editor__field">
              <span>{t('ui.image')}</span>
              <select value={node.imageId ?? ''} onChange={event => patchSelected({ imageId: event.target.value || undefined })}>
                <option value="">{t('picker.none')}</option>
                {textures.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
              </select>
            </label>
          )}
          {node.type === 'progress' && (
            <div className="ui-editor__triple">
              <NumberField label={t('ui.min')} value={node.progress?.min ?? 0} onCommit={min => patchSelected({ progress: { min, max: node.progress?.max ?? 100, value: node.progress?.value ?? 0 } })} />
              <NumberField label={t('ui.value')} value={node.progress?.value ?? 0} onCommit={value => patchSelected({ progress: { min: node.progress?.min ?? 0, max: node.progress?.max ?? 100, value } })} />
              <NumberField label={t('ui.max')} value={node.progress?.max ?? 100} onCommit={max => patchSelected({ progress: { min: node.progress?.min ?? 0, max, value: node.progress?.value ?? 0 } })} />
            </div>
          )}
        </div>
      </div>

      <div className="ui-editor__card">
        <div className="ui-editor__card-title"><span>{t('ui.layout')}</span></div>
        <div className="ui-editor__card-body">
          <label className="ui-editor__field">
            <span>{t('ui.mode')}</span>
            <select value={layout.mode} onChange={event => setLayout({ mode: event.target.value as UiLayout['mode'] })}>
              <option value="anchor">{t('ui.anchor')}</option>
              <option value="flex">{t('ui.flex')}</option>
            </select>
          </label>
          {layout.mode === 'anchor' && !isRoot && (
            <>
              <div className="ui-editor__anchor-row">
                <span>{t('ui.anchorGrid')}</span>
                <div className="ui-editor__anchor-grid">
                  {ANCHOR_GRID.map(a => {
                    const active = layout.anchorMin?.x === a.x && layout.anchorMin?.y === a.y
                    return (
                      <button
                        key={a.id}
                        type="button"
                        className={active ? 'is-on' : ''}
                        title={t(a.title)}
                        onClick={() => setLayout({
                          mode: 'anchor',
                          anchorMin: { x: a.x, y: a.y },
                          anchorMax: { x: a.x, y: a.y },
                          pivot: { x: a.px, y: a.py },
                          x: 0,
                          y: 0,
                        })}
                      />
                    )
                  })}
                </div>
              </div>
              <div className="ui-editor__pair">
                <NumberField label="X" value={layout.x ?? 0} onCommit={x => setLayout({ x })} />
                <NumberField label="Y" value={layout.y ?? 0} onCommit={y => setLayout({ y })} />
              </div>
            </>
          )}
          {layout.mode === 'flex' && (
            <>
              <div className="ui-editor__pair">
                <label className="ui-editor__field-col">
                  <span>{t('ui.direction')}</span>
                  <select value={layout.flexDirection ?? 'column'} onChange={event => setLayout({ flexDirection: event.target.value as UiLayout['flexDirection'] })}>
                    <option value="column">{t('ui.column')}</option>
                    <option value="row">{t('ui.row')}</option>
                  </select>
                </label>
                <NumberField label={t('ui.gap')} value={layout.gap ?? 0} onCommit={gap => setLayout({ gap })} />
              </div>
              <div className="ui-editor__pair">
                <label className="ui-editor__field-col">
                  <span>{t('ui.justify')}</span>
                  <select value={layout.justify ?? 'start'} onChange={event => setLayout({ justify: event.target.value as UiLayout['justify'] })}>
                    <option value="start">{t('ui.align.start')}</option>
                    <option value="center">{t('ui.flex.center')}</option>
                    <option value="end">{t('ui.align.end')}</option>
                    <option value="space-between">{t('ui.align.between')}</option>
                  </select>
                </label>
                <label className="ui-editor__field-col">
                  <span>{t('ui.alignCross')}</span>
                  <select value={layout.align ?? 'start'} onChange={event => setLayout({ align: event.target.value as UiLayout['align'] })}>
                    <option value="start">{t('ui.align.start')}</option>
                    <option value="center">{t('ui.flex.center')}</option>
                    <option value="end">{t('ui.align.end')}</option>
                    <option value="stretch">{t('ui.align.stretch')}</option>
                  </select>
                </label>
              </div>
            </>
          )}
          <div className="ui-editor__pair">
            <NumberField label={t('ui.width')} value={layout.width ?? 0} onCommit={width => setLayout({ width })} />
            <NumberField label={t('ui.height')} value={layout.height ?? 0} onCommit={height => setLayout({ height })} />
          </div>
        </div>
      </div>

      <div className="ui-editor__card">
        <div className="ui-editor__card-title">
          <span>{t('ui.style')}</span>
          <select
            className="ui-editor__mini-select"
            value={styleState}
            onChange={event => onStyleState(event.target.value as 'normal' | UiStateKind)}
          >
            <option value="normal">{t('ui.state.normal')}</option>
            <option value="hover">{t('ui.state.hover')}</option>
            <option value="pressed">{t('ui.state.pressed')}</option>
            <option value="disabled">{t('ui.state.disabled')}</option>
          </select>
        </div>
        <div className="ui-editor__card-body">
          <ColorField label={t('ui.color')} value={activeStyle.color} onCommit={color => setStyle({ color })} />
          <div className="ui-editor__pair">
            <NumberField label={t('ui.fontSize')} value={activeStyle.fontSize ?? 16} onCommit={fontSize => setStyle({ fontSize })} />
            <label className="ui-editor__field-col">
              <span>{t('ui.align')}</span>
              <select value={activeStyle.align ?? 'left'} onChange={event => setStyle({ align: event.target.value as UiStyle['align'] })}>
                <option value="left">{t('ui.align.left')}</option>
                <option value="center">{t('ui.align.center')}</option>
                <option value="right">{t('ui.align.right')}</option>
              </select>
            </label>
          </div>
          <label className="ui-editor__field">
            <span>{t('ui.background')}</span>
            <input defaultValue={activeStyle.backgroundColor ?? ''} placeholder={t('ui.bgPlaceholder')} key={`${node.id}:${styleState}:bg`} onBlur={event => setStyle({ backgroundColor: event.target.value || undefined })} />
          </label>
          <div className="ui-editor__pair">
            <NumberField label={t('ui.opacity')} value={activeStyle.opacity ?? 1} step={0.05} onCommit={opacity => setStyle({ opacity })} />
            <NumberField label={t('ui.radius')} value={activeStyle.borderRadius ?? 0} onCommit={borderRadius => setStyle({ borderRadius })} />
          </div>
          <ColorField label={t('ui.border')} value={activeStyle.borderColor} onCommit={borderColor => setStyle({ borderColor })} />
          <div className="ui-editor__pair">
            <NumberField label={t('ui.borderWidth')} value={activeStyle.borderWidth ?? 0} onCommit={borderWidth => setStyle({ borderWidth })} />
            <ColorField label={t('ui.tint')} value={activeStyle.tintColor} compact onCommit={tintColor => setStyle({ tintColor })} />
          </div>
        </div>
      </div>

      <BindingFields node={node} />
      <ClickFields node={node} />
    </>
  )
}

function BindingFields({ node }: { node: UiNode }) {
  const { t } = useI18n()
  const binding = node.bindings?.[0]
  const source = binding?.source
  const write = (next: UiNode['bindings']) => patchSelected({ bindings: next })
  return (
    <div className="ui-editor__card">
      <div className="ui-editor__card-title"><span>{t('ui.binding')}</span></div>
      <div className="ui-editor__card-body">
        <label className="ui-editor__field">
          <span>{t('ui.targetProp')}</span>
          <select
            value={binding?.target ?? ''}
            onChange={event => {
              const target = event.target.value as NonNullable<UiNode['bindings']>[number]['target'] | ''
              if (!target) {
                write(undefined)
                return
              }
              write([{ id: binding?.id ?? crypto.randomUUID(), target, source: source ?? { kind: 'variable', varId: '' } }])
            }}
          >
            <option value="">{t('ui.none')}</option>
            <option value="text">{t('ui.target.text')}</option>
            <option value="visible">{t('ui.target.visible')}</option>
            <option value="enabled">{t('ui.target.enabled')}</option>
            <option value="progress.value">{t('ui.target.progress')}</option>
            <option value="opacity">{t('ui.target.opacity')}</option>
          </select>
        </label>
        {binding && (
          <>
            <label className="ui-editor__field">
              <span>{t('ui.source')}</span>
              <select
                value={source?.kind ?? 'variable'}
                onChange={event => {
                  const kind = event.target.value === 'component' ? 'component' : 'variable'
                  write([{
                    ...binding,
                    source: kind === 'variable' ? { kind, varId: '' } : { kind, nodeId: '', field: '' },
                  }])
                }}
              >
                <option value="variable">{t('ui.variable')}</option>
                <option value="component">{t('ui.component')}</option>
              </select>
            </label>
            {source?.kind === 'component' ? (
              <>
                <label className="ui-editor__field"><span>{t('ui.node')}</span><input defaultValue={source.nodeId} key={`${binding.id}:node`} onBlur={event => write([{ ...binding, source: { kind: 'component', nodeId: event.target.value, field: source.field } }])} /></label>
                <label className="ui-editor__field"><span>{t('ui.field')}</span><input defaultValue={source.field} key={`${binding.id}:field`} onBlur={event => write([{ ...binding, source: { kind: 'component', nodeId: source.nodeId, field: event.target.value } }])} /></label>
              </>
            ) : (
              <label className="ui-editor__field"><span>{t('ui.variable')}</span><input defaultValue={source?.kind === 'variable' ? source.varId : ''} placeholder={t('ui.varPlaceholder')} key={`${binding.id}:var`} onBlur={event => write([{ ...binding, source: { kind: 'variable', varId: event.target.value } }])} /></label>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function ClickFields({ node }: { node: UiNode }) {
  const { t } = useI18n()
  const click = node.click
  return (
    <div className="ui-editor__card">
      <div className="ui-editor__card-title"><span>{t('ui.click')}</span></div>
      <div className="ui-editor__card-body">
        <label className="ui-editor__field">
          <span>{t('ui.action')}</span>
          <select
            value={click?.kind ?? ''}
            onChange={event => {
              const kind = event.target.value
              if (kind === 'sendMessage') patchSelected({ click: { kind, message: click?.kind === 'sendMessage' ? click.message : 'ui.click' } })
              else if (kind === 'setVariable') patchSelected({ click: { kind, varId: click?.kind === 'setVariable' ? click.varId : 'score', value: click?.kind === 'setVariable' ? click.value : '1' } })
              else patchSelected({ click: undefined })
            }}
          >
            <option value="">{t('ui.none')}</option>
            <option value="sendMessage">{t('ui.sendMessage')}</option>
            <option value="setVariable">{t('ui.setVariable')}</option>
          </select>
        </label>
        {click?.kind === 'sendMessage' && (
          <label className="ui-editor__field"><span>{t('ui.message')}</span><input defaultValue={click.message} key={`${node.id}:msg`} onBlur={event => patchSelected({ click: { kind: 'sendMessage', message: event.target.value } })} /></label>
        )}
        {click?.kind === 'setVariable' && (
          <>
            <label className="ui-editor__field"><span>{t('ui.variable')}</span><input defaultValue={click.varId} key={`${node.id}:cvar`} onBlur={event => patchSelected({ click: { ...click, varId: event.target.value } })} /></label>
            <label className="ui-editor__field"><span>{t('ui.value')}</span><input defaultValue={click.value} key={`${node.id}:cval`} onBlur={event => patchSelected({ click: { ...click, value: event.target.value } })} /></label>
          </>
        )}
      </div>
    </div>
  )
}

function ColorField({
  label,
  value,
  compact = false,
  onCommit,
}: {
  label: string
  value?: string
  compact?: boolean
  onCommit: (value: string) => void
}) {
  const shown = toColor(value)
  const [draft, setDraft] = useState(shown)
  useEffect(() => setDraft(shown), [shown])
  return (
    <label className={compact ? 'ui-editor__field-col' : 'ui-editor__field'}>
      <span>{label}</span>
      <div className="ui-editor__color-wrap">
        <input
          type="color"
          value={draft}
          onChange={event => setDraft(event.target.value)}
          onBlur={event => { if (event.target.value !== shown) onCommit(event.target.value) }}
        />
        <input
          type="text"
          value={draft}
          onChange={event => setDraft(event.target.value)}
          onBlur={() => { if (/^#[0-9a-fA-F]{6}$/.test(draft) && draft !== shown) onCommit(draft) }}
        />
      </div>
    </label>
  )
}

function NumberField({
  label,
  value,
  step,
  onCommit,
}: {
  label: string
  value: number
  step?: number
  onCommit: (value: number) => void
}) {
  return (
    <label className="ui-editor__field-col">
      <span>{label}</span>
      <input
        type="number"
        step={step ?? 'any'}
        defaultValue={value}
        key={`${label}:${value}`}
        onBlur={event => {
          const next = Number(event.target.value)
          if (Number.isFinite(next) && next !== value) onCommit(next)
        }}
      />
    </label>
  )
}

function textureUrl(imageId: string): string | undefined {
  const asset = useAssetStore.getState().assets[imageId]
  return asset?.kind === 'texture' ? asset.url : undefined
}

function clickDetail(node: UiNode): string {
  if (node.click?.kind === 'sendMessage') return node.click.message
  if (node.click?.kind === 'setVariable') return node.click.varId
  return ''
}

function toColor(value: string | undefined): string {
  return value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#ffffff'
}

function applyLive(node: UiNode, live: Record<string, Partial<UiLayout>>): UiNode {
  const patch = live[node.id]
  return {
    ...node,
    layout: patch ? { mode: node.layout?.mode ?? 'anchor', ...node.layout, ...patch } : node.layout,
    children: node.children?.map(child => applyLive(child, live)),
  }
}

function isInside(root: UiNode, ancestorId: string, id: string): boolean {
  let parent = parentOf(root, id)
  while (parent) {
    if (parent.id === ancestorId) return true
    parent = parentOf(root, parent.id)
  }
  return false
}

function replaceLayout(root: UiNode, id: string, layout: UiLayout): UiNode {
  if (root.id === id) return { ...root, layout }
  if (!root.children) return root
  return { ...root, children: root.children.map(child => replaceLayout(child, id, layout)) }
}
