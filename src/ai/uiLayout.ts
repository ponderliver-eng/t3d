import type { UiNode } from '../runtime/ui/spec'

/**
 * UI「计算后布局」读取：直接量已渲染的 DOM（试玩叠加层或 UI 编辑器预览），
 * 让 AI 不必靠截图目测就能知道每个节点的实际矩形、是否溢出父容器或被裁切。
 */
export interface UiLayoutEntry {
  id: string
  name?: string
  type: string
  /** 相对界面根节点左上角的 [x, y, width, height]（像素，取整） */
  rect: [number, number, number, number]
  issues?: string[]
}

export interface UiLayoutReport {
  rendered: boolean
  /** 界面根节点的实际像素尺寸 */
  rootSize?: [number, number]
  nodes?: UiLayoutEntry[]
  issueCount?: number
  note?: string
}

const NOT_RENDERED_NOTE =
  '该界面当前没有渲染，拿不到计算布局。试玩中（viewport__capture({ playSeconds }) 会自动附带 uiLayoutIssues，或 playtest__control play 之后再查询）或在 UI 编辑器里打开该界面时可用。'

function findRenderedElement(nodeId: string): HTMLElement | null {
  if (typeof document === 'undefined') return null
  const selector = `[data-ui-node-id="${nodeId.replace(/["\\]/g, '\\$&')}"]`
  // 试玩叠加层优先：那里是玩家实际看到的尺寸
  return (
    document.querySelector<HTMLElement>(`.ui-screen-stack ${selector}`)
    ?? document.querySelector<HTMLElement>(`.ui-dom-preview ${selector}`)
  )
}

export function measureUiLayout(root: UiNode, options?: { issuesOnly?: boolean }): UiLayoutReport {
  const rootEl = findRenderedElement(root.id)
  if (!rootEl) return { rendered: false, note: NOT_RENDERED_NOTE }
  const rootRect = rootEl.getBoundingClientRect()
  if (rootRect.width <= 0 || rootRect.height <= 0) return { rendered: false, note: NOT_RENDERED_NOTE }

  const entries: UiLayoutEntry[] = []
  const visit = (node: UiNode, parentRect: DOMRect | null) => {
    const el = node.id === root.id
      ? rootEl
      : rootEl.querySelector<HTMLElement>(`[data-ui-node-id="${node.id.replace(/["\\]/g, '\\$&')}"]`)
    if (!el) return
    const rect = el.getBoundingClientRect()
    const issues: string[] = []
    const hidden = node.visible === false || getComputedStyle(el).display === 'none'
    if (!hidden) {
      if (rect.width < 1 || rect.height < 1) {
        issues.push('尺寸为 0，不可见')
      } else {
        const outside =
          rect.right <= rootRect.left || rect.left >= rootRect.right || rect.bottom <= rootRect.top || rect.top >= rootRect.bottom
        if (outside) {
          issues.push('完全在界面范围之外')
        } else if (
          rect.left < rootRect.left - 1 || rect.top < rootRect.top - 1
          || rect.right > rootRect.right + 1 || rect.bottom > rootRect.bottom + 1
        ) {
          issues.push('部分超出界面边界')
        }
        if (parentRect && node.id !== root.id) {
          const dx = Math.max(parentRect.left - rect.left, rect.right - parentRect.right)
          const dy = Math.max(parentRect.top - rect.top, rect.bottom - parentRect.bottom)
          if (dx > 1 || dy > 1) {
            issues.push(`超出父容器（横向 ${Math.max(0, Math.round(dx))}px，纵向 ${Math.max(0, Math.round(dy))}px）`)
          }
        }
        if ((node.type === 'text' || node.type === 'button') && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)) {
          issues.push('文字内容超出自身矩形，可能被裁切或溢出')
        }
      }
    }
    entries.push({
      id: node.id,
      ...(node.name ? { name: node.name } : {}),
      type: node.type,
      rect: [
        Math.round(rect.left - rootRect.left),
        Math.round(rect.top - rootRect.top),
        Math.round(rect.width),
        Math.round(rect.height),
      ],
      ...(hidden ? { issues: ['当前隐藏'] } : issues.length > 0 ? { issues } : {}),
    })
    if (hidden) return
    for (const child of node.children ?? []) visit(child, rect)
  }
  visit(root, null)

  const withIssues = entries.filter((item) => item.issues && item.issues[0] !== '当前隐藏')
  return {
    rendered: true,
    rootSize: [Math.round(rootRect.width), Math.round(rootRect.height)],
    nodes: options?.issuesOnly ? withIssues : entries,
    issueCount: withIssues.length,
  }
}
