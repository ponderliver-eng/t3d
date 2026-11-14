import { create } from 'zustand'

export type LanguageSetting = 'system' | 'zh' | 'en'
export type UiScale = 1 | 1.25 | 1.5

const KEY = 't3d-editor-prefs'

interface PrefsState {
  language: LanguageSetting
  autoSave: boolean
  openLastProject: boolean
  uiScale: UiScale
  settingsOpen: boolean
  setLanguage: (language: LanguageSetting) => void
  setAutoSave: (autoSave: boolean) => void
  setOpenLastProject: (openLastProject: boolean) => void
  setUiScale: (uiScale: UiScale) => void
  openSettings: () => void
  closeSettings: () => void
}

type PrefsData = Pick<PrefsState, 'language' | 'autoSave' | 'openLastProject' | 'uiScale'>

function readPrefs(): PrefsData {
  const fallback: PrefsData = { language: 'system', autoSave: true, openLastProject: true, uiScale: 1 }
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<PrefsState>
    const language = parsed.language === 'zh' || parsed.language === 'en' || parsed.language === 'system' ? parsed.language : 'system'
    const uiScale = parsed.uiScale === 1.25 || parsed.uiScale === 1.5 ? parsed.uiScale : 1
    return { language, autoSave: parsed.autoSave !== false, openLastProject: parsed.openLastProject !== false, uiScale }
  } catch {
    return fallback
  }
}

function persist(state: PrefsData) {
  localStorage.setItem(KEY, JSON.stringify(state))
  document.documentElement.style.zoom = String(state.uiScale)
}

function dataOf(state: PrefsData, patch: Partial<PrefsData>): PrefsData {
  return { ...state, ...patch }
}

const initial = readPrefs()
persist(initial)

export const usePrefsStore = create<PrefsState>(set => ({
  ...initial,
  settingsOpen: false,
  setLanguage: language => set(state => {
    const next = dataOf(state, { language })
    persist(next)
    return next
  }),
  setAutoSave: autoSave => set(state => {
    const next = dataOf(state, { autoSave })
    persist(next)
    return next
  }),
  setOpenLastProject: openLastProject => set(state => {
    const next = dataOf(state, { openLastProject })
    persist(next)
    return next
  }),
  setUiScale: uiScale => set(state => {
    const next = dataOf(state, { uiScale })
    persist(next)
    return next
  }),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
}))

export function resolveLanguage(setting: LanguageSetting): 'zh' | 'en' {
  if (setting === 'zh' || setting === 'en') return setting
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}
