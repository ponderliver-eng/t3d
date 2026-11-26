export type UiNodeType = 'panel' | 'stack' | 'text' | 'fps' | 'image' | 'button' | 'progress'

export type UiLayoutMode = 'anchor' | 'flex'
export type UiFlexDirection = 'row' | 'column'
export type UiAlign = 'start' | 'center' | 'end' | 'stretch'
export type UiJustify = 'start' | 'center' | 'end' | 'space-between'
export type UiTextAlign = 'left' | 'center' | 'right'
export type UiLayer = 'hud' | 'menu' | 'popup' | 'modal'
export type UiStateKind = 'hover' | 'pressed' | 'disabled'
export type UiBindingTarget = 'visible' | 'enabled' | 'text' | 'progress.value' | 'opacity'

export const UI_LAYERS: readonly UiLayer[] = ['hud', 'menu', 'popup', 'modal']
export const UI_NODE_TYPES: readonly UiNodeType[] = ['panel', 'stack', 'text', 'fps', 'image', 'button', 'progress']

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
    case 'fps':
      return {
        id,
        type,
        name: 'FPS',
        text: 'FPS: {fps}',
        layout: anchorBox(120, 30),
        style: {
          color: '#6dff8a',
          fontSize: 16,
          align: 'center',
          backgroundColor: 'rgba(15, 23, 42, 0.55)',
          borderRadius: 6,
        },
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

export type UiTemplateId = 'hud' | 'menu' | 'dialog' | 'result'

export interface UiTemplateOptions {
  title?: string
  subtitle?: string
  primaryText?: string
  secondaryText?: string
  primaryMessage?: string
  secondaryMessage?: string
  varKey?: string
  scoreVarKey?: string
  accentColor?: string
}

export function createUiTemplateDocument(template: UiTemplateId, opts: UiTemplateOptions = {}): UiDocument {
  const accent = opts.accentColor?.trim() || '#3b82f6'
  const varKey = opts.varKey?.trim() || 'hp'
  const scoreKey = opts.scoreVarKey?.trim() || 'score'

  if (template === 'hud') {
    return {
      schemaVersion: 1,
      root: {
        id: 'hud_root',
        type: 'panel',
        name: 'HUD根容器',
        layout: {
          mode: 'anchor',
          anchorMin: { x: 0, y: 0 },
          anchorMax: { x: 1, y: 1 },
          pivot: { x: 0, y: 0 },
        },
        style: { backgroundColor: 'transparent' },
        children: [
          {
            id: 'hud_top_left',
            type: 'stack',
            name: '左上角状态栏',
            layout: {
              mode: 'flex',
              flexDirection: 'column',
              gap: 8,
              align: 'stretch',
              justify: 'start',
              padding: { top: 12, right: 14, bottom: 12, left: 14 },
              x: 24,
              y: 24,
              width: 240,
              anchorMin: { x: 0, y: 0 },
              anchorMax: { x: 0, y: 0 },
              pivot: { x: 0, y: 0 },
            },
            style: {
              backgroundColor: 'rgba(15, 23, 42, 0.78)',
              borderColor: 'rgba(148, 163, 184, 0.25)',
              borderWidth: 1,
              borderRadius: 10,
            },
            children: [
              {
                id: 'hud_title',
                type: 'text',
                name: '状态标题',
                text: opts.title || '生命值',
                layout: { mode: 'flex', height: 22 },
                style: { color: '#f8fafc', fontSize: 15, align: 'left' },
              },
              {
                id: 'hud_hp_bar',
                type: 'progress',
                name: '生命值条',
                progress: { min: 0, max: 1, value: 1 },
                layout: { mode: 'flex', height: 14 },
                style: { backgroundColor: 'rgba(30, 41, 59, 0.9)', tintColor: '#22c55e', borderRadius: 7 },
                bindings: [{ id: 'b_hp', target: 'progress.value', source: { kind: 'variable', varId: varKey } }],
              },
            ],
          },
          {
            id: 'hud_top_right',
            type: 'stack',
            name: '右上角计分与操作',
            layout: {
              mode: 'flex',
              flexDirection: 'row',
              gap: 12,
              align: 'center',
              justify: 'end',
              padding: { top: 10, right: 14, bottom: 10, left: 14 },
              x: -24,
              y: 24,
              anchorMin: { x: 1, y: 0 },
              anchorMax: { x: 1, y: 0 },
              pivot: { x: 1, y: 0 },
            },
            style: {
              backgroundColor: 'rgba(15, 23, 42, 0.78)',
              borderColor: 'rgba(148, 163, 184, 0.25)',
              borderWidth: 1,
              borderRadius: 10,
            },
            children: [
              {
                id: 'hud_score_text',
                type: 'text',
                name: '分数文本',
                text: '0',
                layout: { mode: 'flex', width: 96, height: 26 },
                style: { color: '#fbbf24', fontSize: 18, align: 'right' },
                bindings: [{ id: 'b_score', target: 'text', source: { kind: 'variable', varId: scoreKey } }],
              },
              {
                id: 'hud_pause_btn',
                type: 'button',
                name: '功能按钮',
                text: opts.primaryText || '菜单',
                layout: { mode: 'flex', width: 76, height: 32 },
                style: {
                  backgroundColor: accent,
                  color: '#ffffff',
                  fontSize: 14,
                  align: 'center',
                  borderRadius: 6,
                },
                click: { kind: 'sendMessage', message: opts.primaryMessage || 'ui.menu' },
              },
            ],
          },
          {
            id: 'hud_bottom_tip',
            type: 'stack',
            name: '底部提示栏',
            layout: {
              mode: 'flex',
              flexDirection: 'row',
              gap: 10,
              align: 'center',
              justify: 'center',
              padding: { top: 8, right: 18, bottom: 8, left: 18 },
              y: -24,
              anchorMin: { x: 0.5, y: 1 },
              anchorMax: { x: 0.5, y: 1 },
              pivot: { x: 0.5, y: 1 },
            },
            style: {
              backgroundColor: 'rgba(15, 23, 42, 0.72)',
              borderColor: 'rgba(148, 163, 184, 0.2)',
              borderWidth: 1,
              borderRadius: 999,
            },
            children: [
              {
                id: 'hud_tip_text',
                type: 'text',
                name: '操作提示',
                text: opts.subtitle || 'WASD 移动 · 鼠标瞄准 · 空格跳跃',
                layout: { mode: 'flex', height: 22 },
                style: { color: '#cbd5e1', fontSize: 13, align: 'center' },
              },
            ],
          },
        ],
      },
    }
  }

  if (template === 'dialog') {
    return {
      schemaVersion: 1,
      root: {
        id: 'dialog_root',
        type: 'panel',
        name: '弹窗遮罩',
        layout: { mode: 'anchor', anchorMin: { x: 0, y: 0 }, anchorMax: { x: 1, y: 1 }, pivot: { x: 0, y: 0 } },
        style: { backgroundColor: 'rgba(2, 6, 23, 0.58)' },
        children: [
          {
            id: 'dialog_card',
            type: 'stack',
            name: '弹窗卡片',
            layout: {
              mode: 'flex',
              flexDirection: 'column',
              gap: 14,
              align: 'stretch',
              justify: 'start',
              padding: { top: 22, right: 24, bottom: 20, left: 24 },
              width: 420,
              anchorMin: { x: 0.5, y: 0.5 },
              anchorMax: { x: 0.5, y: 0.5 },
              pivot: { x: 0.5, y: 0.5 },
            },
            style: {
              backgroundColor: 'rgba(15, 23, 42, 0.94)',
              borderColor: 'rgba(148, 163, 184, 0.3)',
              borderWidth: 1,
              borderRadius: 12,
            },
            children: [
              {
                id: 'dialog_title',
                type: 'text',
                name: '弹窗标题',
                text: opts.title || '提示',
                layout: { mode: 'flex', height: 30 },
                style: { color: '#f8fafc', fontSize: 20, align: 'left' },
              },
              {
                id: 'dialog_body',
                type: 'text',
                name: '弹窗正文',
                text: opts.subtitle || '确认要执行当前操作吗？',
                layout: { mode: 'flex', height: 48 },
                style: { color: '#cbd5e1', fontSize: 14, align: 'left' },
              },
              {
                id: 'dialog_actions',
                type: 'stack',
                name: '操作栏',
                layout: { mode: 'flex', flexDirection: 'row', gap: 10, align: 'center', justify: 'end', height: 40 },
                style: { backgroundColor: 'transparent' },
                children: [
                  {
                    id: 'dialog_cancel',
                    type: 'button',
                    name: '取消按钮',
                    text: opts.secondaryText || '取消',
                    layout: { mode: 'flex', width: 96, height: 38 },
                    style: { backgroundColor: 'rgba(51, 65, 85, 0.9)', color: '#e2e8f0', fontSize: 14, align: 'center', borderRadius: 8 },
                    click: { kind: 'sendMessage', message: opts.secondaryMessage || 'ui.cancel' },
                  },
                  {
                    id: 'dialog_confirm',
                    type: 'button',
                    name: '确认按钮',
                    text: opts.primaryText || '确定',
                    layout: { mode: 'flex', width: 96, height: 38 },
                    style: { backgroundColor: accent, color: '#ffffff', fontSize: 14, align: 'center', borderRadius: 8 },
                    click: { kind: 'sendMessage', message: opts.primaryMessage || 'ui.confirm' },
                  },
                ],
              },
            ],
          },
        ],
      },
    }
  }

  // 'menu' or 'result'
  const isResult = template === 'result'
  return {
    schemaVersion: 1,
    root: {
      id: `${template}_root`,
      type: 'panel',
      name: isResult ? '结算遮罩' : '主菜单遮罩',
      layout: { mode: 'anchor', anchorMin: { x: 0, y: 0 }, anchorMax: { x: 1, y: 1 }, pivot: { x: 0, y: 0 } },
      style: { backgroundColor: 'rgba(2, 6, 23, 0.62)' },
      children: [
        {
          id: `${template}_card`,
          type: 'stack',
          name: isResult ? '结算卡片' : '菜单卡片',
          layout: {
            mode: 'flex',
            flexDirection: 'column',
            gap: 14,
            align: 'stretch',
            justify: 'center',
            padding: { top: 28, right: 32, bottom: 28, left: 32 },
            width: 360,
            anchorMin: { x: 0.5, y: 0.5 },
            anchorMax: { x: 0.5, y: 0.5 },
            pivot: { x: 0.5, y: 0.5 },
          },
          style: {
            backgroundColor: 'rgba(15, 23, 42, 0.92)',
            borderColor: 'rgba(148, 163, 184, 0.28)',
            borderWidth: 1,
            borderRadius: 14,
          },
          children: [
            {
              id: `${template}_title`,
              type: 'text',
              name: '标题',
              text: opts.title || (isResult ? '挑战完成' : '开始游戏'),
              layout: { mode: 'flex', height: 38 },
              style: { color: '#f8fafc', fontSize: 28, align: 'center' },
            },
            {
              id: `${template}_subtitle`,
              type: 'text',
              name: '副标题',
              text: opts.subtitle || (isResult ? '本局得分' : '准备好迎接挑战了吗？'),
              layout: { mode: 'flex', height: 24 },
              style: { color: '#94a3b8', fontSize: 14, align: 'center' },
              ...(isResult ? { bindings: [{ id: 'b_result_score', target: 'text' as const, source: { kind: 'variable' as const, varId: scoreKey } }] } : {}),
            },
            {
              id: `${template}_primary_btn`,
              type: 'button',
              name: '主按钮',
              text: opts.primaryText || (isResult ? '再来一局' : '开始游戏'),
              layout: { mode: 'flex', height: 44 },
              style: { backgroundColor: accent, color: '#ffffff', fontSize: 16, align: 'center', borderRadius: 8 },
              click: { kind: 'sendMessage', message: opts.primaryMessage || (isResult ? 'ui.restart' : 'ui.start') },
            },
            {
              id: `${template}_secondary_btn`,
              type: 'button',
              name: '次按钮',
              text: opts.secondaryText || (isResult ? '返回主菜单' : '游戏设置'),
              layout: { mode: 'flex', height: 40 },
              style: { backgroundColor: 'rgba(51, 65, 85, 0.85)', color: '#e2e8f0', fontSize: 14, align: 'center', borderRadius: 8 },
              click: { kind: 'sendMessage', message: opts.secondaryMessage || (isResult ? 'ui.menu' : 'ui.settings') },
            },
          ],
        },
      ],
    },
  }
}

export function validateUiDocument(doc: UiDocument): string[] {
  const warnings: string[] = []
  const root = doc.root
  const rl = root.layout
  if (
    !rl ||
    rl.mode !== 'anchor' ||
    (rl.anchorMin?.x ?? 0) !== 0 ||
    (rl.anchorMin?.y ?? 0) !== 0 ||
    (rl.anchorMax?.x ?? 1) !== 1 ||
    (rl.anchorMax?.y ?? 1) !== 1
  ) {
    warnings.push('根节点建议设为全屏锚点（mode: "anchor", anchorMin: {x:0,y:0}, anchorMax: {x:1,y:1}）以确保自适应分辨率。')
  }

  const walk = (node: UiNode, depth: number) => {
    const layout = node.layout
    if ((node.type === 'text' || node.type === 'fps') && typeof node.style?.fontSize === 'number' && node.style.fontSize < 12) {
      warnings.push(`节点 "${node.name || node.id}" 字号仅 ${node.style.fontSize}px，建议不小于 12px。`)
    }
    if ((node.type === 'button' || node.type === 'progress') && layout && typeof layout.height === 'number' && layout.height < 12) {
      warnings.push(`节点 "${node.name || node.id}" 高度仅 ${layout.height}px，可能过扁难以看清/点击。`)
    }
    if (node.type === 'stack' && layout?.mode === 'flex' && (node.children?.length ?? 0) > 1 && layout.gap === undefined) {
      warnings.push(`Flex 容器 "${node.name || node.id}" 未设置 gap，建议设置 gap: 8~16 避免子项紧贴。`)
    }
    const children = node.children ?? []
    if (depth > 0 && children.length > 1) {
      const anchorBoxes: Array<{ name: string; x: number; y: number; w: number; h: number }> = []
      for (const c of children) {
        const cl = c.layout
        if (cl?.mode === 'anchor' && typeof cl.x === 'number' && typeof cl.y === 'number') {
          anchorBoxes.push({
            name: c.name || c.id,
            x: cl.x,
            y: cl.y,
            w: cl.width ?? 100,
            h: cl.height ?? 32,
          })
        }
      }
      for (let i = 0; i < anchorBoxes.length; i += 1) {
        for (let j = i + 1; j < anchorBoxes.length; j += 1) {
          const a = anchorBoxes[i]
          const b = anchorBoxes[j]
          if (Math.abs(a.x - b.x) < Math.min(a.w, b.w) * 0.5 && Math.abs(a.y - b.y) < Math.min(a.h, b.h) * 0.5) {
            warnings.push(`同级 Anchor 节点 "${a.name}" 与 "${b.name}" 坐标过近可能重叠，建议改用 stack (mode: "flex") 自动排版。`)
            break
          }
        }
      }
    }
    for (const child of children) walk(child, depth + 1)
  }
  walk(root, 0)
  return warnings
}
