import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, AlertTriangle, Info, Search, Trash2, X } from 'lucide-react'
import { useI18n, type MessageKey } from '../i18n'
import { assetDirectory, useAssetStore } from '../assets/library'
import { useEditorStore } from '../scene/store'
import type { LogEntry, LogLevel } from '../scene/types'
import './ConsolePanel.css'

const FILTERS: { level: LogLevel; key: MessageKey; icon: typeof Info }[] = [
  { level: 'info', key: 'console.info', icon: Info },
  { level: 'warn', key: 'console.warn', icon: AlertTriangle },
  { level: 'error', key: 'console.error', icon: AlertCircle },
]

export default function ConsolePanel() {
  const { t } = useI18n()
  const logs = useEditorStore(state => state.logs)
  const [enabled, setEnabled] = useState<Record<LogLevel, boolean>>({ info: true, warn: true, error: true })
  const [query, setQuery] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const q = query.trim().toLowerCase()
  const visible = useMemo(
    () => logs.filter(entry => enabled[entry.level] && (!q || entry.message.toLowerCase().includes(q))),
    [logs, enabled, q],
  )
  const counts = useMemo(() => ({
    info: logs.filter(entry => entry.level === 'info').length,
    warn: logs.filter(entry => entry.level === 'warn').length,
    error: logs.filter(entry => entry.level === 'error').length,
  }), [logs])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'nearest' })
  }, [logs.length])

  return (
    <div className="console-panel">
      <div className="console-tabs">
        <div className="console-search">
          <Search size={12} />
          <input value={query} placeholder={t('console.filter')} onChange={event => setQuery(event.target.value)} />
          {query && <button type="button" onClick={() => setQuery('')}><X size={12} /></button>}
        </div>
        <div className="console-tabs__spacer" />
        <div className="console-filters">
          {FILTERS.map(filter => {
            const Icon = filter.icon
            return (
              <button
                key={filter.level}
                type="button"
                title={t(filter.key)}
                className={`console-filter ${enabled[filter.level] ? 'console-filter--on' : ''}`}
                onClick={() => setEnabled(state => ({ ...state, [filter.level]: !state[filter.level] }))}
              >
                <Icon size={11} />
                {counts[filter.level]}
              </button>
            )
          })}
        </div>
        <button type="button" className="console-clear" title={t('console.clear')} onClick={() => useEditorStore.getState().clearLogs()}>
          <Trash2 size={12} />
        </button>
      </div>
      <div className="console-list">
        {visible.map(entry => (
          <div key={entry.id} className={`console-row console-row--${entry.level}`}>
            <span>{formatTime(entry.time)}</span>
            <span>{entry.parts?.length ? <LogLine parts={entry.parts} /> : entry.message}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

function LogLine({ parts }: { parts: NonNullable<LogEntry['parts']> }) {
  return (
    <>
      {parts.map((part, index) => part.assetId ? (
        <button key={index} type="button" className="console-link" onClick={() => revealAsset(part.assetId!)}>{part.text}</button>
      ) : (
        <span key={index}>{part.text}</span>
      ))}
    </>
  )
}

function revealAsset(id: string) {
  const library = useAssetStore.getState()
  if (!library.assets[id]) return
  library.setBrowseDir(assetDirectory(id, library.assetDirs))
  useEditorStore.getState().inspectAsset(id)
}

function formatTime(time: number): string {
  const date = new Date(time)
  const part = (value: number) => String(value).padStart(2, '0')
  return `${part(date.getHours())}:${part(date.getMinutes())}:${part(date.getSeconds())}`
}
