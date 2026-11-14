import { useEffect } from 'react'
import { X } from 'lucide-react'
import { useI18n } from '../i18n'
import { usePrefsStore, type LanguageSetting, type UiScale } from './store'
import './SettingsDialog.css'

export default function SettingsDialog() {
  const open = usePrefsStore(state => state.settingsOpen)
  const language = usePrefsStore(state => state.language)
  const autoSave = usePrefsStore(state => state.autoSave)
  const uiScale = usePrefsStore(state => state.uiScale)
  const { t } = useI18n()

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') usePrefsStore.getState().closeSettings()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null
  return (
    <div className="settings-backdrop" onMouseDown={() => usePrefsStore.getState().closeSettings()}>
      <section className="settings-dialog" role="dialog" aria-label={t('settings.title')} onMouseDown={event => event.stopPropagation()}>
        <header className="settings-dialog__header">
          <h2>{t('settings.title')}</h2>
          <button type="button" title={t('settings.close')} onClick={() => usePrefsStore.getState().closeSettings()}><X size={14} /></button>
        </header>
        <div className="settings-dialog__body">
          <h3>{t('settings.general')}</h3>
          <label className="settings-row">
            <span>{t('settings.language')}</span>
            <select value={language} onChange={event => usePrefsStore.getState().setLanguage(event.target.value as LanguageSetting)}>
              <option value="system">{t('settings.languageSystem')}</option>
              <option value="zh">{t('settings.languageZh')}</option>
              <option value="en">{t('settings.languageEn')}</option>
            </select>
          </label>
          <label className="settings-row">
            <span>{t('settings.autoSave')}</span>
            <input type="checkbox" checked={autoSave} onChange={event => usePrefsStore.getState().setAutoSave(event.target.checked)} />
          </label>
          <p className="settings-note">{t('settings.autoSaveNote')}</p>
          <label className="settings-row">
            <span>{t('settings.uiScale')}</span>
            <select value={String(uiScale)} onChange={event => usePrefsStore.getState().setUiScale(Number(event.target.value) as UiScale)}>
              <option value="1">100%</option>
              <option value="1.25">125%</option>
              <option value="1.5">150%</option>
            </select>
          </label>
        </div>
      </section>
    </div>
  )
}
