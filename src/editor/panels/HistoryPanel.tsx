import { useEditorStore } from '../scene/store'
import './HistoryPanel.css'

export default function HistoryPanel() {
  const past = useEditorStore(state => state.past)
  const future = useEditorStore(state => state.future)

  return (
    <div className="history-panel">
      {past.length === 0 && future.length === 0 && (
        <div className="history-panel__empty">还没有可撤销的操作。移动、创建和删除都会记在这里。</div>
      )}
      {past.map((entry, index) => (
        <div key={`${entry.label}-${index}`} className={`history-row ${index === past.length - 1 ? 'history-row--current' : ''}`}>
          <span>{entry.label}</span>
          {index === past.length - 1 && <em>当前</em>}
        </div>
      ))}
      {future.slice().reverse().map((entry, index) => (
        <div key={`future-${entry.label}-${index}`} className="history-row history-row--future">
          <span>{entry.label}</span>
        </div>
      ))}
    </div>
  )
}
