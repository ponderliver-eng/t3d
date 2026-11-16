import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Search, X } from 'lucide-react'
import { projectClips, subscribeModels, type ProjectClip } from '../assets/models'
import { useI18n } from '../i18n'
import './AssetPicker.css'

export interface ClipSelection {
  assetId: string
  name: string
}

export function ClipField({
  label,
  assetId,
  name,
  disabled,
  onChange,
}: {
  label?: string
  assetId: string
  name: string
  disabled?: boolean
  onChange: (next: ClipSelection | null) => void
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [version, setVersion] = useState(0)
  useEffect(() => subscribeModels(() => setVersion(value => value + 1)), [])
  void version
  const clips = projectClips()
  const current = clips.find(item => item.assetId === assetId && item.name === name)
    ?? clips.find(item => item.name === name)
  const shown = name
    ? (current ? `${current.assetName} / ${current.name}` : name)
    : t('picker.none')
  const button = (
    <button type="button" className="asset-ref" disabled={disabled} onClick={() => setOpen(true)}>
      <span>{shown}</span>
      <Search size={12} />
    </button>
  )
  const picker = open && (
    <ClipPicker
      selected={name ? { assetId: current?.assetId ?? assetId, name } : null}
      onSelect={next => { onChange(next); setOpen(false) }}
      onClose={() => setOpen(false)}
    />
  )
  if (!label) return <>{button}{picker}</>
  return (
    <label className="field">
      <span>{label}</span>
      {button}
      {picker}
    </label>
  )
}

export function ClipPicker({
  selected,
  onSelect,
  onClose,
}: {
  selected: ClipSelection | null
  onSelect: (next: ClipSelection | null) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [version, setVersion] = useState(0)
  useEffect(() => subscribeModels(() => setVersion(value => value + 1)), [])
  void version
  const q = query.trim().toLowerCase()
  const groups = useMemo(() => {
    const clips = projectClips().filter(item => !q || `${item.assetName} ${item.name}`.toLowerCase().includes(q))
    const map = new Map<string, ProjectClip[]>()
    for (const clip of clips) {
      const list = map.get(clip.assetId) ?? []
      list.push(clip)
      map.set(clip.assetId, list)
    }
    return [...map.values()]
  }, [q, version])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="asset-picker__backdrop" onMouseDown={onClose}>
      <section className="asset-picker" role="dialog" aria-label={t('clip.pick')} onMouseDown={event => event.stopPropagation()}>
        <header className="asset-picker__header">
          <h2>{t('clip.pick')}</h2>
          <button type="button" onClick={onClose}><X size={14} /></button>
        </header>
        <div className="asset-picker__search">
          <Search size={12} />
          <input autoFocus value={query} placeholder={t('picker.search')} onChange={event => setQuery(event.target.value)} />
        </div>
        <div className="asset-picker__list">
          <button type="button" className={!selected?.name ? 'is-on' : ''} onClick={() => onSelect(null)}>
            <i />
            <span>{t('picker.none')}</span>
          </button>
          {groups.map(clips => (
            <div key={clips[0].assetId} className="clip-picker__group">
              <span>{clips[0].assetName}</span>
              {clips.map(clip => {
                const on = selected?.assetId === clip.assetId && selected.name === clip.name
                return (
                  <button key={`${clip.assetId}:${clip.name}`} type="button" className={on ? 'is-on' : ''} onClick={() => onSelect({ assetId: clip.assetId, name: clip.name })}>
                    <i />
                    <span>{clip.name}</span>
                    <em>{clip.duration > 0 ? `${clip.duration.toFixed(2)}s` : ''}</em>
                  </button>
                )
              })}
            </div>
          ))}
          {groups.length === 0 && <p>{t('picker.empty')}</p>}
        </div>
      </section>
    </div>,
    document.body,
  )
}
