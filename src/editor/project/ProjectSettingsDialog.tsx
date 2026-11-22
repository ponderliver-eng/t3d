import { useEffect } from 'react'
import { X } from 'lucide-react'
import { create } from 'zustand'
import { useTaxonomyUi } from './taxonomyUi'
import { useEditorStore } from '../scene/store'
import { useI18n } from '../i18n'
import '../prefs/SettingsDialog.css'

interface ProjectSettingsState {
  open: boolean
  show: () => void
  hide: () => void
}

export const useProjectSettings = create<ProjectSettingsState>(set => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}))

export function openProjectSettings() {
  useProjectSettings.getState().show()
}

export default function ProjectSettingsDialog() {
  const open = useProjectSettings(state => state.open)
  const { t } = useI18n()

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') useProjectSettings.getState().hide()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null
  return (
    <div className="settings-backdrop" onMouseDown={() => useProjectSettings.getState().hide()}>
      <section className="settings-dialog" role="dialog" aria-label={t('projectSettings.title')} onMouseDown={event => event.stopPropagation()}>
        <header className="settings-dialog__header">
          <h2>{t('projectSettings.title')}</h2>
          <button type="button" title={t('settings.close')} onClick={() => useProjectSettings.getState().hide()}><X size={14} /></button>
        </header>
        <div className="settings-dialog__body">
          <h3>{t('projectSettings.catalogs')}</h3>
          <div className="settings-row">
            <span>{t('tags.title')}</span>
            <button type="button" onClick={() => { useProjectSettings.getState().hide(); useTaxonomyUi.getState().openTags() }}>{t('projectSettings.manage')}</button>
          </div>
          <div className="settings-row">
            <span>{t('layers.title')}</span>
            <button type="button" onClick={() => { useProjectSettings.getState().hide(); useTaxonomyUi.getState().openLayers() }}>{t('projectSettings.manage')}</button>
          </div>
          <h3>{t('projectSettings.modules')}</h3>
          <div className="settings-row">
            <span>{t('library.title')}</span>
            <button type="button" onClick={() => { useProjectSettings.getState().hide(); useEditorStore.getState().setLibraryOpen(true) }}>{t('projectSettings.manage')}</button>
          </div>
          <p className="settings-note">{t('projectSettings.note')}</p>
        </div>
      </section>
    </div>
  )
}
