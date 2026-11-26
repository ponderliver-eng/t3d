import type { IJsonModel } from 'flexlayout-react'

export const LAYOUT_KEY = 't3d-layout-v1'

export const PANEL = {
  PROJECT: 'project',
  SCENE: 'scene',
  VIEWPORT: 'viewport',
  CONSOLE: 'console',
  CUTSCENE: 'cutscene',
  INSPECTOR: 'inspector',
  HISTORY: 'history',
} as const

export type PanelId = typeof PANEL[keyof typeof PANEL]

export const DEFAULT_LAYOUT: IJsonModel = {
  global: {
    splitterSize: 4,
    splitterExtra: 4,
    tabSetEnableMaximize: false,
    tabSetEnableDeleteWhenEmpty: false,
    tabSetEnableClose: false,
    tabEnableRenderOnDemand: false,
    tabEnableClose: false,
    tabEnableRename: false,
  },
  layout: {
    type: 'row',
    children: [
      {
        type: 'tabset',
        weight: 16,
        minWidth: 180,
        children: [
          { type: 'tab', id: 'tab-project', name: '资源', component: PANEL.PROJECT, enableClose: false },
        ],
      },
      {
        type: 'row',
        weight: 51,
        children: [
          {
            type: 'tabset',
            weight: 78,
            minWidth: 320,
            enableTabStrip: false,
            children: [
              { type: 'tab', id: 'tab-viewport', name: '3D 视口', component: PANEL.VIEWPORT, enableClose: false },
            ],
          },
          {
            type: 'tabset',
            weight: 22,
            minHeight: 96,
            children: [
              { type: 'tab', id: 'tab-console', name: '控制台', component: PANEL.CONSOLE, enableClose: false },
              { type: 'tab', id: 'tab-cutscene', name: '过场时间轴', component: PANEL.CUTSCENE, enableClose: false },
            ],
          },
        ],
      },
      {
        type: 'tabset',
        weight: 13,
        minWidth: 180,
        children: [
          { type: 'tab', id: 'tab-scene', name: '场景', component: PANEL.SCENE, enableClose: false },
        ],
      },
      {
        type: 'tabset',
        weight: 20,
        minWidth: 240,
        children: [
          { type: 'tab', id: 'tab-inspector', name: '属性', component: PANEL.INSPECTOR, enableClose: false },
          { type: 'tab', id: 'tab-history', name: '历史', component: PANEL.HISTORY, enableClose: false },
        ],
      },
    ],
  },
}

export function loadLayout(): IJsonModel {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY)
    if (!raw || !raw.includes(`"${PANEL.VIEWPORT}"`) || !raw.includes(`"${PANEL.SCENE}"`)) return DEFAULT_LAYOUT
    const parsed = JSON.parse(raw) as IJsonModel
    if (!raw.includes(`"${PANEL.CUTSCENE}"`)) {
      const inject = (node: Record<string, unknown>): boolean => {
        if (Array.isArray(node.children)) {
          const hasConsole = (node.children as Array<Record<string, unknown>>).some(c => c.id === 'tab-console')
          if (hasConsole && node.type === 'tabset') {
            ;(node.children as Array<Record<string, unknown>>).push({
              type: 'tab',
              id: 'tab-cutscene',
              name: '过场时间轴',
              component: PANEL.CUTSCENE,
              enableClose: false,
            })
            return true
          }
          for (const child of node.children as Array<Record<string, unknown>>) {
            if (inject(child)) return true
          }
        }
        return false
      }
      inject(parsed.layout as unknown as Record<string, unknown>)
    }
    return parsed
  } catch {
    return DEFAULT_LAYOUT
  }
}
