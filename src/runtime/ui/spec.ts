export type UiNodeType = 'panel' | 'stack' | 'text' | 'image' | 'button' | 'progress'

export type UiLayoutMode = 'anchor' | 'flex'
export type UiFlexDirection = 'row' | 'column'
export type UiAlign = 'start' | 'center' | 'end' | 'stretch'
export type UiJustify = 'start' | 'center' | 'end' | 'space-between'
export type UiTextAlign = 'left' | 'center' | 'right'
export type UiLayer = 'hud' | 'menu' | 'popup' | 'modal'
export type UiStateKind = 'hover' | 'pressed' | 'disabled'
export type UiBindingTarget = 'visible' | 'enabled' | 'text' | 'progress.value' | 'opacity'

export const UI_LAYERS: readonly UiLayer[] = ['hud', 'menu', 'popup', 'modal']
export const UI_NODE_TYPES: readonly UiNodeType[] = ['panel', 'stack', 'text', 'image', 'button', 'progress']

export interface UiVec2 {
  x: number
  y: number
}

export interface UiSpacing {
  top?: number
  right?: number
  bottom?: number
  left?: number
}

export interface UiLayout {
  mode: UiLayoutMode
  x?: number
  y?: number
  width?: number
  height?: number
  anchorMin?: UiVec2
  anchorMax?: UiVec2
  pivot?: UiVec2
  flexDirection?: UiFlexDirection
  gap?: number
  align?: UiAlign
  justify?: UiJustify
  padding?: UiSpacing
}

export interface UiStyle {
  color?: string
  fontSize?: number
  align?: UiTextAlign
  backgroundColor?: string
  opacity?: number
  borderColor?: string
  borderWidth?: number
  borderRadius?: number
  tintColor?: string
}

export interface UiBinding {
  id: string
  target: UiBindingTarget
  source:
    | { kind: 'variable'; varId: string }
    | { kind: 'component'; nodeId: string; field: string }
}

export type UiClickAction =
  | { kind: 'sendMessage'; message: string }
  | { kind: 'setVariable'; varId: string; value: string }

export interface UiNode {
  id: string
  type: UiNodeType
  name?: string
  layout?: UiLayout
  style?: UiStyle
  stateStyles?: Partial<Record<UiStateKind, UiStyle>>
  text?: string
  imageId?: string
  progress?: { min: number; max: number; value: number }
  visible?: boolean
  enabled?: boolean
  bindings?: UiBinding[]
  click?: UiClickAction
  children?: UiNode[]
}

export interface UiDocument {
  schemaVersion: 1
  root: UiNode
}

export interface NodeScreen {
  documentId: string | null
  layer: UiLayer
  visibleOnPlay: boolean
}

export function defaultNodeScreen(): NodeScreen {
  return { documentId: null, layer: 'hud', visibleOnPlay: true }
}

export function createUiNode(type: UiNodeType, id = crypto.randomUUID()): UiNode {
  switch (type) {
    case 'text':
      return {
        id,
        type,
        name: 'Text',
        text: 'Text',
        layout: anchorBox(160, 32),
        style: { color: '#ffffff', fontSize: 18, align: 'center' },
      }
    case 'image':
      return {
        id,
        type,
        name: 'Image',
        layout: anchorBox(120, 80),
        style: { backgroundColor: '#2f80ed' },
      }
    case 'button':
      return {
        id,
        type,
        name: 'Button',
        text: 'Button',
        layout: anchorBox(140, 40),
        style: { backgroundColor: '#35547a', color: '#ffffff', fontSize: 16, align: 'center', borderRadius: 6 },
        click: { kind: 'sendMessage', message: 'ui.click' },
      }
    case 'progress':
      return {
        id,
        type,
        name: 'Progress',
        progress: { min: 0, max: 100, value: 65 },
        layout: anchorBox(240, 22),
        style: { backgroundColor: '#303846', tintColor: '#52c873', borderRadius: 4 },
      }
    case 'stack':
      return {
        id,
        type,
        name: 'Stack',
        layout: {
          mode: 'flex',
          flexDirection: 'column',
          width: 240,
          height: 160,
          gap: 8,
          align: 'stretch',
          justify: 'start',
          padding: { top: 8, right: 8, bottom: 8, left: 8 },
        },
        style: { backgroundColor: '#222a35', borderRadius: 6 },
        children: [],
      }
    case 'panel':
    default:
      return {
        id,
        type: 'panel',
        name: 'Panel',
        layout: anchorBox(240, 160),
        style: { backgroundColor: '#222a35', borderRadius: 6 },
        children: [],
      }
  }
}

function anchorBox(width: number, height: number): UiLayout {
  return {
    mode: 'anchor',
    width,
    height,
    anchorMin: { x: 0.5, y: 0.5 },
    anchorMax: { x: 0.5, y: 0.5 },
    pivot: { x: 0.5, y: 0.5 },
  }
}

export function createScoreDocument(): UiDocument {
  const line = (id: string, name: string, text: string, y: number, varId: string): UiNode => ({
    id,
    type: 'text',
    name,
    text,
    layout: {
      mode: 'anchor',
      width: 360,
      height: 36,
      x: 0,
      y,
      anchorMin: { x: 0.5, y: 0 },
      anchorMax: { x: 0.5, y: 0 },
      pivot: { x: 0.5, y: 0 },
    },
    style: { color: '#ffffff', fontSize: 22, align: 'center' },
    bindings: [{ id: `bind_${id}`, target: 'text', source: { kind: 'variable', varId } }],
  })
  return {
    schemaVersion: 1,
    root: {
      id: 'root',
      type: 'panel',
      name: '根',
      layout: {
        mode: 'anchor',
        anchorMin: { x: 0, y: 0 },
        anchorMax: { x: 1, y: 1 },
        pivot: { x: 0.5, y: 0.5 },
      },
      style: { backgroundColor: 'transparent' },
      children: [
        line('objective', '目标说明', '到达终点', 28, 'objective'),
        line('score', '当前分', '0', 68, 'score'),
        line('time', '剩余时间', '0', 108, 'timeLeft'),
        {
          id: 'mark',
          type: 'button',
          name: '按钮',
          text: '按钮',
          layout: {
            mode: 'anchor',
            width: 120,
            height: 36,
            y: 160,
            anchorMin: { x: 0.5, y: 0 },
            anchorMax: { x: 0.5, y: 0 },
            pivot: { x: 0.5, y: 0 },
          },
          style: { backgroundColor: '#35547a', color: '#ffffff', fontSize: 16, align: 'center', borderRadius: 6 },
          click: { kind: 'sendMessage', message: 'ui.click' },
        },
      ],
    },
  }
}

export function normalizeUiDocument(value: unknown): UiDocument {
  if (isUiDocument(value)) return value
  return createScoreDocument()
}

function isUiDocument(value: unknown): value is UiDocument {
  return Boolean(value && typeof value === 'object' && (value as UiDocument).schemaVersion === 1 && isNode((value as UiDocument).root))
}

function isNode(value: unknown): value is UiNode {
  if (!value || typeof value !== 'object') return false
  const node = value as Partial<UiNode>
  return typeof node.id === 'string' && UI_NODE_TYPES.includes(node.type as UiNodeType)
}
