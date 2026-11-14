import { create } from 'zustand'

export type LanguageSetting = 'system' | 'zh' | 'en'
export type UiScale = 1 | 1.25 | 1.5

const KEY = 't3d-editor-prefs'

interface PrefsState {
  language: LanguageSetting
  autoSave: boolean
  uiScale: UiScale
  settingsOpen: boolean
  setLanguage: (language: LanguageSetting) => void
  setAutoSave: (autoSave: boolean) => void
  setUiScale: (uiScale: UiScale) => void
  openSettings: () => void
  closeSettings: () => void
}

function readPrefs(): Pick<PrefsState, 'language' | 'autoSave' | 'uiScale'> {
  const fallback = { language: 'system' as const, autoSave: true, uiScale: 1 as const }
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<PrefsState>
    const language = parsed.language === 'zh' || parsed.language === 'en' || parsed.language === 'system' ? parsed.language : 'system'
    const uiScale = parsed.uiScale === 1.25 || parsed.uiScale === 1.5 ? parsed.uiScale : 1
    return { language, autoSave: parsed.autoSave !== false, uiScale }
  } catch {
    return fallback
  }
}

function persist(state: Pick<PrefsState, 'language' | 'autoSave' | 'uiScale'>) {
  localStorage.setItem(KEY, JSON.stringify(state))
  document.documentElement.style.zoom = String(state.uiScale)
}

const initial = readPrefs()
persist(initial)

export const usePrefsStore = create<PrefsState>(set => ({
  ...initial,
  settingsOpen: false,
  setLanguage: language => set(state => {
    const next = { language, autoSave: state.autoSave, uiScale: state.uiScale }
    persist(next)
    return next
  }),
  setAutoSave: autoSave => set(state => {
    const next = { language: state.language, autoSave, uiScale: state.uiScale }
    persist(next)
    return next
  }),
  setUiScale: uiScale => set(state => {
    const next = { language: state.language, autoSave: state.autoSave, uiScale }
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
