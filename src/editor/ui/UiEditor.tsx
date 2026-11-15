import { useEffect, useMemo, useRef, useState } from 'react'
import { useAssetStore } from '../assets/library'
import { translate, useI18n } from '../i18n'
import type { UiLayout, UiNode, UiStyle, UiStateKind } from '../../runtime/ui/spec'
import { UI_NODE_TYPES } from '../../runtime/ui/spec'
import { resolveUiTree } from '../../runtime/ui/bindings'
import { EMPTY_UI_VALUES } from '../../runtime/ui/bindings'
import { UiDomDocument } from '../../runtime/ui/dom'
import { collectUiBindings, findUiNode, flattenUi } from '../../runtime/ui/tree'
import { patchSelected, readDocument, useUiEditor } from './session'
import './UiEditor.css'

const SIZES = [
  { id: '1080', width: 1920, height: 1080 },
  { id: '720', width: 1280, height: 720 },
  { id: 'phone', width: 390, height: 844 },
]

const ANCHORS = [
  { id: 'top', x: 0.5, y: 0, pivotX: 0.5, pivotY: 0 },
  { id: 'center', x: 0.5, y: 0.5, pivotX: 0.5, pivotY: 0.5 },
  { id: 'bottom', x: 0.5, y: 1, pivotX: 0.5, pivotY: 1 },
  { id: 'left', x: 0, y: 0.5, pivotX: 0, pivotY: 0.5 },
  { id: 'right', x: 1, y: 0.5, pivotX: 1, pivotY: 0.5 },
]

export function UiEditor() {
  const { t } = useI18n()
  const assetId = useUiEditor(state => state.assetId)
  const selectedId = useUiEditor(state => state.selectedId)
  const overrides = useUiEditor(state => state.overrides)
  const canUndo = useUiEditor(state => state.past.length > 0)
  const canRedo = useUiEditor(state => state.future.length > 0)
  const revision = useAssetStore(state => state.revision)
  const document = assetId ? readDocument(assetId) : null
  const [sizeId, setSizeId] = useState('720')
  const [zoom, setZoom] = useState(0.55)
  const [styleState, setStyleState] = useState<'normal' | UiStateKind>('normal')
  const [addType, setAddType] = useState<typeof UI_NODE_TYPES[number]>('text')
  const [notice, setNotice] = useState('')
  const [live, setLive] = useState<Record<string, Partial<UiLayout>>>({})
  const liveRef = useRef<Record<string, Partial<UiLayout>>>({})
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom

  useEffect(() => {
    if (assetId && !document) useUiEditor.getState().close()
  }, [assetId, document])

  const size = SIZES.find(item => item.id === sizeId) ?? SIZES[1]
  const selected = document ? (findUiNode(document.root, selectedId) ?? document.root) : null
  const preview = useMemo(() => {
    if (!document) return null
    return applyLive(resolveUiTree(document.root, EMPTY_UI_VALUES, overrides), live)
  }, [document, overrides, live, revision])

  if (!assetId || !document || !preview || !selected) return null

  const startDrag = (id: string, event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || id === document.root.id) return
    const node = findUiNode(document.root, id)
    if (!node || node.layout?.mode !== 'anchor') return
    const origin = { x: node.layout.x ?? 0, y: node.layout.y ?? 0, width: node.layout.width ?? 80, height: node.layout.height ?? 32 }
    const pointer = { x: event.clientX, y: event.clientY }
    const move = (next: PointerEvent) => {
      const scale = zoomRef.current || 1
      const patch = {
        x: Math.round(origin.x + (next.clientX - pointer.x) / scale),
        y: Math.round(origin.y + (next.clientY - pointer.y) / scale),
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

  const bindings = collectUiBindings(document.root)

  return (
    <section className="ui-editor">
      <header className="ui-editor__bar">
        <strong>{useAssetStore.getState().assets[assetId]?.name}</strong>
        <select value={sizeId} onChange={event => setSizeId(event.target.value)}>
          {SIZES.map(item => <option key={item.id} value={item.id}>{item.width}×{item.height}</option>)}
        </select>
        <label>{t('ui.zoom')}<input type="number" min={0.25} max={1.5} step={0.05} value={zoom} onChange={event => setZoom(Number(event.target.value) || 0.55)} /></label>
        <button type="button" disabled={!canUndo} onClick={() => useUiEditor.getState().undo()}>{t('ui.undo')}</button>
        <button type="button" disabled={!canRedo} onClick={() => useUiEditor.getState().redo()}>{t('ui.redo')}</button>
        <span className="ui-editor__notice">{notice}</span>
        <button type="button" onClick={() => useUiEditor.getState().close()}>{t('ui.close')}</button>
      </header>
      <div className="ui-editor__body">
        <aside className="ui-editor__tree">
          <div className="ui-editor__tools">
            <select value={addType} onChange={event => setAddType(event.target.value as typeof addType)}>
              {UI_NODE_TYPES.map(type => <option key={type} value={type}>{t(`ui.type.${type}`)}</option>)}
            </select>
            <button type="button" onClick={() => useUiEditor.getState().addNode(addType)}>{t('ui.add')}</button>
            <button type="button" onClick={() => useUiEditor.getState().shiftSelected(-1)}>{t('ui.up')}</button>
            <button type="button" onClick={() => useUiEditor.getState().shiftSelected(1)}>{t('ui.down')}</button>
            <button type="button" onClick={() => useUiEditor.getState().removeSelected()}>{t('ui.delete')}</button>
          </div>
          {flattenUi(document.root).map(item => (
            <button
              key={item.node.id}
              type="button"
              className={item.node.id === selectedId ? 'ui-editor__row ui-editor__row--on' : 'ui-editor__row'}
              style={{ paddingLeft: 8 + item.depth * 14 }}
              onClick={() => useUiEditor.getState().select(item.node.id)}
            >
              {item.node.name || t(`ui.type.${item.node.type}`)}
            </button>
          ))}
        </aside>
        <div className="ui-editor__stage">
          <div className="ui-editor__scaler" style={{ width: size.width * zoom, height: size.height * zoom }}>
            <div className="ui-editor__frame" style={{ width: size.width, height: size.height, transform: `scale(${zoom})` }}>
              <UiDomDocument
                root={preview}
                pickable
                selectedId={selectedId}
                previewState={styleState === 'normal' ? undefined : styleState}
                resolveImageUrl={textureUrl}
                onSelect={id => useUiEditor.getState().select(id)}
                onActivate={node => setNotice(node.click ? translate('ui.previewClick', { name: node.name || node.text || node.id, detail: clickDetail(node) }) : '')}
                onDragStart={startDrag}
                onResizeStart={startResize}
              />
            </div>
          </div>
        </div>
        <aside className="ui-editor__inspector">
          <NodeFields node={selected} styleState={styleState} onStyleState={setStyleState} />
          {bindings.length > 0 && (
            <div className="ui-editor__block">
              <h3>{t('ui.fake')}</h3>
              {bindings.map(item => (
                <label key={item.binding.id} className="field">
                  <span>{item.node.name || item.binding.target}</span>
                  <input
                    value={String(overrides[item.binding.id] ?? '')}
                    placeholder={item.binding.source.kind === 'variable' ? item.binding.source.varId : item.binding.source.field}
                    onChange={event => useUiEditor.getState().setOverride(item.binding.id, event.target.value)}
                  />
                </label>
              ))}
            </div>
          )}
        </aside>
      </div>
    </section>
  )
}

function NodeFields({
  node,
  styleState,
  onStyleState,
}: {
  node: UiNode
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
      <label className="field"><span>{t('ui.name')}</span><input defaultValue={node.name ?? ''} key={`${node.id}:name:${node.name ?? ''}`} onBlur={event => patchSelected({ name: event.target.value })} /></label>
      <label className="field"><span>{t('inspector.type')}</span><span>{t(`ui.type.${node.type}`)}</span></label>
      {(node.type === 'text' || node.type === 'button') && (
        <label className="field"><span>{t('ui.text')}</span><input defaultValue={node.text ?? ''} key={`${node.id}:text:${node.text ?? ''}`} onBlur={event => patchSelected({ text: event.target.value })} /></label>
      )}
      {node.type === 'image' && (
        <label className="field">
          <span>{t('ui.image')}</span>
          <select value={node.imageId ?? ''} onChange={event => patchSelected({ imageId: event.target.value || undefined })}>
            <option value="">{t('picker.none')}</option>
            {textures.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
          </select>
        </label>
      )}
      {node.type === 'progress' && (
        <>
          <NumberField label={t('ui.min')} value={node.progress?.min ?? 0} onCommit={min => patchSelected({ progress: { min, max: node.progress?.max ?? 100, value: node.progress?.value ?? 0 } })} />
          <NumberField label={t('ui.max')} value={node.progress?.max ?? 100} onCommit={max => patchSelected({ progress: { min: node.progress?.min ?? 0, max, value: node.progress?.value ?? 0 } })} />
          <NumberField label={t('ui.value')} value={node.progress?.value ?? 0} onCommit={value => patchSelected({ progress: { min: node.progress?.min ?? 0, max: node.progress?.max ?? 100, value } })} />
        </>
      )}
      <div className="ui-editor__block">
        <h3>{t('ui.layout')}</h3>
        <label className="field">
          <span>{t('ui.layout')}</span>
          <select value={layout.mode} onChange={event => setLayout({ mode: event.target.value as UiLayout['mode'] })}>
            <option value="anchor">{t('ui.anchor')}</option>
            <option value="flex">{t('ui.flex')}</option>
          </select>
        </label>
        {layout.mode === 'anchor' && (
          <>
            <label className="field">
              <span>{t('ui.anchorPreset')}</span>
              <select value="" onChange={event => {
                const preset = ANCHORS.find(item => item.id === event.target.value)
                if (!preset) return
                setLayout({ mode: 'anchor', anchorMin: { x: preset.x, y: preset.y }, anchorMax: { x: preset.x, y: preset.y }, pivot: { x: preset.pivotX, y: preset.pivotY }, x: 0, y: 0 })
              }}>
                <option value="">{t('ui.custom')}</option>
                {ANCHORS.map(item => <option key={item.id} value={item.id}>{anchorLabel(item.id)}</option>)}
              </select>
            </label>
            <NumberField label="X" value={layout.x ?? 0} onCommit={x => setLayout({ x })} />
            <NumberField label="Y" value={layout.y ?? 0} onCommit={y => setLayout({ y })} />
          </>
        )}
        {layout.mode === 'flex' && (
          <>
            <label className="field">
              <span>{t('ui.direction')}</span>
              <select value={layout.flexDirection ?? 'column'} onChange={event => setLayout({ flexDirection: event.target.value as UiLayout['flexDirection'] })}>
                <option value="column">{t('ui.column')}</option>
                <option value="row">{t('ui.row')}</option>
              </select>
            </label>
            <NumberField label={t('ui.gap')} value={layout.gap ?? 0} onCommit={gap => setLayout({ gap })} />
          </>
        )}
        <NumberField label={t('ui.width')} value={layout.width ?? 0} onCommit={width => setLayout({ width })} />
        <NumberField label={t('ui.height')} value={layout.height ?? 0} onCommit={height => setLayout({ height })} />
      </div>
      <div className="ui-editor__block">
        <h3>{t('ui.style')}</h3>
        <label className="field">
          <span>{t('ui.state')}</span>
          <select value={styleState} onChange={event => onStyleState(event.target.value as 'normal' | UiStateKind)}>
            <option value="normal">{t('ui.state.normal')}</option>
            <option value="hover">{t('ui.state.hover')}</option>
            <option value="pressed">{t('ui.state.pressed')}</option>
            <option value="disabled">{t('ui.state.disabled')}</option>
          </select>
        </label>
        <ColorField label={t('ui.color')} value={activeStyle.color} onCommit={color => setStyle({ color })} />
        <NumberField label={t('ui.fontSize')} value={activeStyle.fontSize ?? 16} onCommit={fontSize => setStyle({ fontSize })} />
        <label className="field">
          <span>{t('ui.align')}</span>
          <select value={activeStyle.align ?? 'left'} onChange={event => setStyle({ align: event.target.value as UiStyle['align'] })}>
            <option value="left">{t('ui.align.left')}</option>
            <option value="center">{t('ui.align.center')}</option>
            <option value="right">{t('ui.align.right')}</option>
          </select>
        </label>
        <label className="field"><span>{t('ui.background')}</span><input defaultValue={activeStyle.backgroundColor ?? ''} key={`${node.id}:${styleState}:bg`} onBlur={event => setStyle({ backgroundColor: event.target.value || undefined })} /></label>
        <NumberField label={t('ui.opacity')} value={activeStyle.opacity ?? 1} onCommit={opacity => setStyle({ opacity })} />
        <NumberField label={t('ui.radius')} value={activeStyle.borderRadius ?? 0} onCommit={borderRadius => setStyle({ borderRadius })} />
        <ColorField label={t('ui.border')} value={activeStyle.borderColor} onCommit={borderColor => setStyle({ borderColor })} />
        <NumberField label={t('ui.borderWidth')} value={activeStyle.borderWidth ?? 0} onCommit={borderWidth => setStyle({ borderWidth })} />
        <ColorField label={t('ui.tint')} value={activeStyle.tintColor} onCommit={tintColor => setStyle({ tintColor })} />
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
    <div className="ui-editor__block">
      <h3>{t('ui.binding')}</h3>
      <label className="field">
        <span>{t('ui.binding')}</span>
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
          <label className="field">
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
              <label className="field"><span>{t('ui.node')}</span><input defaultValue={source.nodeId} key={`${binding.id}:node`} onBlur={event => write([{ ...binding, source: { kind: 'component', nodeId: event.target.value, field: source.field } }])} /></label>
              <label className="field"><span>{t('ui.field')}</span><input defaultValue={source.field} key={`${binding.id}:field`} onBlur={event => write([{ ...binding, source: { kind: 'component', nodeId: source.nodeId, field: event.target.value } }])} /></label>
            </>
          ) : (
            <label className="field"><span>{t('ui.variable')}</span><input defaultValue={source?.kind === 'variable' ? source.varId : ''} key={`${binding.id}:var`} onBlur={event => write([{ ...binding, source: { kind: 'variable', varId: event.target.value } }])} /></label>
          )}
        </>
      )}
    </div>
  )
}

function ClickFields({ node }: { node: UiNode }) {
  const { t } = useI18n()
  const click = node.click
  return (
    <div className="ui-editor__block">
      <h3>{t('ui.click')}</h3>
      <label className="field">
        <span>{t('ui.click')}</span>
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
        <label className="field"><span>{t('ui.message')}</span><input defaultValue={click.message} key={`${node.id}:msg`} onBlur={event => patchSelected({ click: { kind: 'sendMessage', message: event.target.value } })} /></label>
      )}
      {click?.kind === 'setVariable' && (
        <>
          <label className="field"><span>{t('ui.variable')}</span><input defaultValue={click.varId} key={`${node.id}:cvar`} onBlur={event => patchSelected({ click: { ...click, varId: event.target.value } })} /></label>
          <label className="field"><span>{t('ui.value')}</span><input defaultValue={click.value} key={`${node.id}:cval`} onBlur={event => patchSelected({ click: { ...click, value: event.target.value } })} /></label>
        </>
      )}
    </div>
  )
}

function ColorField({ label, value, onCommit }: { label: string; value?: string; onCommit: (value: string) => void }) {
  const shown = toColor(value)
  const [draft, setDraft] = useState(shown)
  useEffect(() => setDraft(shown), [shown])
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="color"
        value={draft}
        onChange={event => setDraft(event.target.value)}
        onBlur={event => { if (event.target.value !== shown) onCommit(event.target.value) }}
      />
    </label>
  )
}

function NumberField({ label, value, onCommit }: { label: string; value: number; onCommit: (value: number) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
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

function anchorLabel(id: string): string {
  if (id === 'top') return translate('ui.anchor.top')
  if (id === 'bottom') return translate('ui.anchor.bottom')
  if (id === 'left') return translate('ui.anchor.left')
  if (id === 'right') return translate('ui.anchor.right')
  return translate('ui.anchor.center')
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

function replaceLayout(root: UiNode, id: string, layout: UiLayout): UiNode {
  if (root.id === id) return { ...root, layout }
  if (!root.children) return root
  return { ...root, children: root.children.map(child => replaceLayout(child, id, layout)) }
}
