import { useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import type { UiLayer, UiNode, UiStyle } from './spec'
import { resolveUiTree } from './bindings'
import type { UiValues } from './bindings'
import './dom.css'

export interface UiDomProps {
  root: UiNode
  pickable?: boolean
  selectedId?: string
  previewState?: 'hover' | 'pressed' | 'disabled'
  resolveImageUrl?: (imageId: string) => string | undefined
  onSelect?: (id: string) => void
  onActivate?: (node: UiNode) => void
  onDragStart?: (id: string, event: ReactPointerEvent<HTMLElement>) => void
  onResizeStart?: (id: string, event: ReactPointerEvent<HTMLElement>) => void
}

export function UiDomDocument({ root, ...props }: UiDomProps) {
  return (
    <div className={props.pickable ? 'ui-dom-preview ui-dom-preview--pick' : 'ui-dom-preview'} onPointerDown={() => props.onSelect?.(root.id)}>
      <UiDomNode node={root} pickable={props.pickable} selectedId={props.selectedId} previewState={props.previewState} resolveImageUrl={props.resolveImageUrl} onSelect={props.onSelect} onActivate={props.onActivate} onDragStart={props.onDragStart} onResizeStart={props.onResizeStart} />
    </div>
  )
}

export function UiScreenStack({
  mounts,
  values,
  resolveImageUrl,
  onActivate,
}: {
  mounts: Array<{ nodeId: string; layer: UiLayer; root: UiNode }>
  values: UiValues
  resolveImageUrl?: (imageId: string) => string | undefined
  onActivate?: (node: UiNode) => void
}) {
  const order: Record<UiLayer, number> = { hud: 1, menu: 2, popup: 3, modal: 4 }
  const visible = [...mounts].sort((a, b) => order[a.layer] - order[b.layer])
  return (
    <div className="ui-screen-stack">
      {visible.map(mount => {
        const capture = mount.layer === 'popup' || mount.layer === 'modal'
        return (
          <div
            key={mount.nodeId}
            className={capture ? 'ui-screen-layer ui-screen-layer--capture' : 'ui-screen-layer'}
            style={{ zIndex: order[mount.layer] }}
          >
            <UiDomDocument
              root={resolveUiTree(mount.root, values)}
              resolveImageUrl={resolveImageUrl}
              onActivate={onActivate}
            />
          </div>
        )
      })}
    </div>
  )
}

function UiDomNode({
  node,
  pickable,
  selectedId,
  previewState,
  resolveImageUrl,
  onSelect,
  onActivate,
  onDragStart,
  onResizeStart,
}: Omit<UiDomProps, 'root'> & { node: UiNode }) {
  const [pointer, setPointer] = useState<'normal' | 'hover' | 'pressed'>('normal')
  if (node.visible === false) return null
  const forced = previewState && selectedId === node.id ? previewState : undefined
  const state = forced ?? (node.enabled === false ? 'disabled' : pointer)
  const imageUrl = node.imageId ? resolveImageUrl?.(node.imageId) : undefined
  const hit = pickable || isHitTarget(node)
  const style = nodeStyle(node, state, imageUrl)
  const selected = selectedId === node.id
  const className = [
    'ui-dom-node',
    `ui-dom-node--${node.type}`,
    hit ? 'ui-dom-node--hit' : '',
    selected ? 'ui-dom-node--selected' : '',
  ].filter(Boolean).join(' ')
  const handlers = {
    className,
    style,
    'data-ui-node-id': node.id,
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      if (!pickable && !hit) return
      event.stopPropagation()
      onSelect?.(node.id)
      if (node.enabled === false) return
      setPointer('pressed')
      if (pickable) onDragStart?.(node.id, event)
    },
    onPointerEnter: () => { if (node.enabled !== false) setPointer('hover') },
    onPointerLeave: () => setPointer('normal'),
    onPointerUp: () => { if (node.enabled !== false) setPointer('hover') },
    onClick: (event: React.MouseEvent) => {
      event.stopPropagation()
      if (node.enabled === false) return
      if (node.type === 'button') onActivate?.(node)
    },
  }
  const resize = selected && pickable && onResizeStart ? (
    <span
      className="ui-dom-node__resize"
      onPointerDown={event => {
        event.stopPropagation()
        onResizeStart(node.id, event)
      }}
    />
  ) : null
  if (node.type === 'text') return <div {...handlers}>{node.text}{resize}</div>
  if (node.type === 'button') {
    return (
      <button type="button" {...handlers} aria-disabled={node.enabled === false || undefined}>
        {node.text || node.name}
        {resize}
      </button>
    )
  }
  if (node.type === 'progress') {
    const min = node.progress?.min ?? 0
    const max = node.progress?.max ?? 100
    const value = node.progress?.value ?? min
    const ratio = max === min ? 0 : Math.max(0, Math.min(1, (value - min) / (max - min)))
    const tint = mergedStyle(node, state).tintColor ?? '#52c873'
    return (
      <div {...handlers}>
        <div className="ui-dom-node__fill" style={{ width: `${ratio * 100}%`, background: tint }} />
        {resize}
      </div>
    )
  }
  if (node.type === 'image') {
    return <div {...handlers}>{resize}</div>
  }
  return (
    <div {...handlers}>
      {node.children?.map(child => (
        <UiDomNode
          key={child.id}
          node={child}
          pickable={pickable}
          selectedId={selectedId}
          previewState={previewState}
          resolveImageUrl={resolveImageUrl}
          onSelect={onSelect}
          onActivate={onActivate}
          onDragStart={onDragStart}
          onResizeStart={onResizeStart}
        />
      ))}
      {resize}
    </div>
  )
}

function isHitTarget(node: UiNode): boolean {
  if (node.type === 'button' || node.type === 'text' || node.type === 'image' || node.type === 'progress') return true
  const background = node.style?.backgroundColor
  if (background && background !== 'transparent') return true
  return (node.style?.borderWidth ?? 0) > 0
}

function mergedStyle(node: UiNode, state: 'normal' | 'hover' | 'pressed' | 'disabled'): UiStyle {
  const extra = state === 'normal' ? undefined : node.stateStyles?.[state]
  return { ...(node.style ?? {}), ...(extra ?? {}) }
}

function nodeStyle(node: UiNode, state: 'normal' | 'hover' | 'pressed' | 'disabled', imageUrl?: string): CSSProperties {
  const layout = node.layout
  const style = mergedStyle(node, state)
  const css: CSSProperties = {
    color: style.color,
    fontSize: px(style.fontSize),
    textAlign: style.align,
    opacity: style.opacity,
    backgroundColor: style.backgroundColor === 'transparent' ? 'transparent' : style.backgroundColor,
    backgroundImage: imageUrl ? `url("${imageUrl}")` : undefined,
    backgroundPosition: imageUrl ? 'center' : undefined,
    backgroundRepeat: imageUrl ? 'no-repeat' : undefined,
    backgroundSize: imageUrl ? 'contain' : undefined,
    borderColor: style.borderColor,
    borderWidth: px(style.borderWidth),
    borderStyle: style.borderWidth ? 'solid' : undefined,
    borderRadius: px(style.borderRadius),
    width: px(layout?.width),
    height: px(layout?.height),
    paddingTop: px(layout?.padding?.top),
    paddingRight: px(layout?.padding?.right),
    paddingBottom: px(layout?.padding?.bottom),
    paddingLeft: px(layout?.padding?.left),
  }
  if (layout?.mode === 'flex' || node.type === 'stack') {
    css.display = 'flex'
    css.position = 'relative'
    css.flexDirection = layout?.flexDirection ?? 'column'
    css.gap = px(layout?.gap)
    css.alignItems = flexAlign(layout?.align)
    css.justifyContent = flexJustify(layout?.justify)
  }
  if (layout?.mode === 'anchor') {
    const anchorMin = layout.anchorMin ?? { x: 0.5, y: 0.5 }
    const anchorMax = layout.anchorMax ?? anchorMin
    const pivot = layout.pivot ?? { x: 0.5, y: 0.5 }
    css.position = 'absolute'
    css.left = edge(anchorMin.x, layout.x ?? 0)
    css.top = edge(anchorMin.y, layout.y ?? 0)
    css.transform = `translate(${-pivot.x * 100}%, ${-pivot.y * 100}%)`
    if (anchorMin.x !== anchorMax.x) {
      css.right = inverseEdge(anchorMax.x, layout.x ?? 0)
      css.width = undefined
      css.transform = anchorMin.y === anchorMax.y ? `translateY(${-pivot.y * 100}%)` : undefined
    }
    if (anchorMin.y !== anchorMax.y) {
      css.bottom = inverseEdge(anchorMax.y, layout.y ?? 0)
      css.height = undefined
      if (anchorMin.x === anchorMax.x) css.transform = `translateX(${-pivot.x * 100}%)`
    }
  }
  return css
}

function flexAlign(value: 'start' | 'center' | 'end' | 'stretch' | undefined): CSSProperties['alignItems'] {
  if (value === 'start') return 'flex-start'
  if (value === 'end') return 'flex-end'
  return value ?? 'stretch'
}

function flexJustify(value: NonNullable<UiNode['layout']>['justify']): CSSProperties['justifyContent'] {
  if (value === 'start') return 'flex-start'
  if (value === 'end') return 'flex-end'
  return value
}

function px(value: number | undefined): string | undefined {
  return typeof value === 'number' ? `${value}px` : undefined
}

function edge(percent: number, offset: number): string {
  return offset === 0 ? `${percent * 100}%` : `calc(${percent * 100}% + ${offset}px)`
}

function inverseEdge(percent: number, offset: number): string {
  return offset === 0 ? `${(1 - percent) * 100}%` : `calc(${(1 - percent) * 100}% - ${offset}px)`
}
