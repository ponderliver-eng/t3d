import { useEffect, useRef, useState } from 'react'
import { Bot, Check, RotateCcw, Send, Settings, Sparkles, Square, Trash2, X } from 'lucide-react'
import { useEditorStore } from '../editor/scene/store'
import { useAgentStore } from './agentLoop'

export default function AiWorkbenchPanel() {
  const panelOpen = useAgentStore((s) => s.panelOpen)
  const setPanelOpen = useAgentStore((s) => s.setPanelOpen)
  const status = useAgentStore((s) => s.status)
  const turns = useAgentStore((s) => s.turns)
  const streamingText = useAgentStore((s) => s.streamingText)
  const providers = useAgentStore((s) => s.providers)
  const activeProviderId = useAgentStore((s) => s.activeProviderId)
  const pendingConfirm = useAgentStore((s) => s.pendingConfirm)
  const refreshProviders = useAgentStore((s) => s.refreshProviders)
  const saveProvider = useAgentStore((s) => s.saveProvider)
  const setActiveProvider = useAgentStore((s) => s.setActiveProvider)
  const sendPrompt = useAgentStore((s) => s.sendPrompt)
  const abort = useAgentStore((s) => s.abort)
  const rollbackTurn = useAgentStore((s) => s.rollbackTurn)
  const clearTurns = useAgentStore((s) => s.clearTurns)

  const selection = useEditorStore((s) => s.selection)
  const nodes = useEditorStore((s) => s.nodes)

  const [input, setInput] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [editBaseUrl, setEditBaseUrl] = useState('')
  const [editModel, setEditModel] = useState('')
  const [editApiKey, setEditApiKey] = useState('')
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (panelOpen) {
      void refreshProviders()
    }
  }, [panelOpen, refreshProviders])

  useEffect(() => {
    const active = providers.find((p) => p.id === activeProviderId)
    if (active) {
      setEditBaseUrl(active.baseUrl)
      setEditModel(active.model)
      setEditApiKey('')
    }
  }, [providers, activeProviderId])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [turns, streamingText])

  if (!panelOpen) return null

  const activeProvider = providers.find((p) => p.id === activeProviderId)
  const selectedNodes = selection.map((id) => nodes[id]).filter(Boolean)

  const handleSend = () => {
    if (!input.trim() || status !== 'idle') return
    const text = input
    setInput('')
    void sendPrompt(text)
  }

  return (
    <aside
      style={{
        width: '360px',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        background: '#18181b',
        borderLeft: '1px solid rgba(255,255,255,0.08)',
        color: '#e4e4e7',
        fontSize: '12px',
        zIndex: 20,
      }}
    >
      {/* 头部 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 10px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          background: '#1f1f23',
        }}
      >
        <Sparkles size={14} color="#60a5fa" />
        <span style={{ fontWeight: 600, fontSize: '12px' }}>AI 指挥台</span>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: '11px',
            color: activeProvider?.hasApiKey ? '#a1a1aa' : '#f59e0b',
            maxWidth: '140px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={activeProvider ? `${activeProvider.label} (${activeProvider.model})` : '未配置'}
        >
          {activeProvider ? (activeProvider.hasApiKey ? activeProvider.model : '未设密钥') : '桌面端可用'}
        </span>
        <button
          type="button"
          title="模型与 API 设置"
          onClick={() => setSettingsOpen((v) => !v)}
          style={iconBtnStyle}
        >
          <Settings size={13} />
        </button>
        <button
          type="button"
          title="清空对话"
          onClick={clearTurns}
          disabled={status !== 'idle'}
          style={iconBtnStyle}
        >
          <Trash2 size={13} />
        </button>
        <button
          type="button"
          title="收起 AI 指挥台"
          onClick={() => setPanelOpen(false)}
          style={iconBtnStyle}
        >
          <X size={13} />
        </button>
      </div>

      {/* 模型设置抽屉 */}
      {settingsOpen && (
        <div
          style={{
            padding: '10px',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
            background: '#141417',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          }}
        >
          <div style={{ fontWeight: 600, color: '#d4d4d8', marginBottom: '2px' }}>模型 API 设置（密钥仅存主进程）</div>
          <select
            value={activeProviderId}
            onChange={(e) => void setActiveProvider(e.target.value)}
            style={fieldInputStyle}
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} {p.hasApiKey ? '✓' : '(未设密钥)'}
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Base URL"
            value={editBaseUrl}
            onChange={(e) => setEditBaseUrl(e.target.value)}
            style={fieldInputStyle}
          />
          <input
            type="text"
            placeholder="模型名称（如 deepseek-chat / gpt-4o）"
            value={editModel}
            onChange={(e) => setEditModel(e.target.value)}
            style={fieldInputStyle}
          />
          <input
            type="password"
            placeholder={activeProvider?.hasApiKey ? '已保存密钥（留空表示不修改）' : '输入 API Key'}
            value={editApiKey}
            onChange={(e) => setEditApiKey(e.target.value)}
            style={fieldInputStyle}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
            <button type="button" onClick={() => setSettingsOpen(false)} style={smallBtnStyle}>关闭</button>
            <button
              type="button"
              onClick={() => {
                void saveProvider({
                  id: activeProviderId,
                  baseUrl: editBaseUrl,
                  model: editModel,
                  ...(editApiKey.trim() ? { apiKey: editApiKey.trim() } : {}),
                  setActive: true,
                }).then(() => setSettingsOpen(false))
              }}
              style={{ ...smallBtnStyle, background: '#2563eb', color: '#fff', borderColor: '#2563eb' }}
            >
              保存
            </button>
          </div>
        </div>
      )}

      {/* 对话与结构化执行流 */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '10px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}
      >
        {turns.length === 0 && (
          <div style={{ color: '#71717a', lineHeight: 1.6, padding: '12px 4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#a1a1aa', marginBottom: '6px' }}>
              <Bot size={14} />
              <span>AI 已就绪，可直接下达创作指令</span>
            </div>
            <div>示例：「新建一个平台跳跃关卡，带地面、主角出生点、几个台阶、一盏方向光和相机，最后做一次体检。」</div>
          </div>
        )}

        {turns.map((turn) => (
          <div
            key={turn.id}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              padding: '8px 10px',
              borderRadius: '6px',
              background: turn.role === 'user' ? 'rgba(59,130,246,0.12)' : 'rgba(255,255,255,0.03)',
              border: turn.role === 'user'
                ? '1px solid rgba(59,130,246,0.28)'
                : '1px solid rgba(255,255,255,0.06)',
            }}
          >
            {turn.refs && turn.refs.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {turn.refs.map((r) => (
                  <span key={r.id} style={refPillStyle}>@{r.label}</span>
                ))}
              </div>
            )}

            {turn.text && (
              <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{turn.text}</div>
            )}

            {turn.actions && turn.actions.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {turn.actions.map((act) => (
                  <button
                    key={act.id}
                    type="button"
                    onClick={() => {
                      if (act.targetNodeId && useEditorStore.getState().nodes[act.targetNodeId]) {
                        useEditorStore.getState().setSelection([act.targetNodeId])
                        useEditorStore.getState().requestFocus()
                      }
                    }}
                    title={act.targetNodeId ? '点击在视口中聚焦该节点' : act.toolName}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      textAlign: 'left',
                      padding: '4px 7px',
                      borderRadius: '4px',
                      border: '1px solid rgba(255,255,255,0.08)',
                      background: 'rgba(0,0,0,0.25)',
                      color: act.ok ? '#d4d4d8' : '#fca5a5',
                      fontSize: '11px',
                      cursor: act.targetNodeId ? 'pointer' : 'default',
                    }}
                  >
                    <span style={{ color: act.ok ? '#4ade80' : '#f87171', fontWeight: 700 }}>
                      {act.ok ? '✓' : '✕'}
                    </span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {act.label}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {turn.error && (
              <div style={{ color: '#fca5a5', fontSize: '11px', lineHeight: 1.4 }}>{turn.error}</div>
            )}

            {turn.role === 'assistant' && (turn.usage?.model || turn.checkpointId) && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginTop: '2px',
                  paddingTop: '4px',
                  borderTop: '1px solid rgba(255,255,255,0.05)',
                  fontSize: '11px',
                  color: '#71717a',
                }}
              >
                <span>
                  {turn.usage?.model
                    ? `${turn.usage.model} · ${(turn.usage.inputTokens ?? 0) + (turn.usage.outputTokens ?? 0)} tok`
                    : ''}
                </span>
                {turn.checkpointId && status === 'idle' && (
                  <button
                    type="button"
                    onClick={() => rollbackTurn(turn.checkpointId!)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '3px',
                      background: 'transparent',
                      border: 'none',
                      color: '#93c5fd',
                      cursor: 'pointer',
                      fontSize: '11px',
                      padding: 0,
                    }}
                  >
                    <RotateCcw size={11} />
                    <span>回退本轮</span>
                  </button>
                )}
              </div>
            )}
          </div>
        ))}

        {status !== 'idle' && streamingText && (
          <div style={{ padding: '8px 10px', color: '#d4d4d8', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
            {streamingText}
          </div>
        )}
      </div>

      {/* 高风险确认栏 */}
      {pendingConfirm && (
        <div
          style={{
            margin: '0 10px 8px',
            padding: '8px 10px',
            borderRadius: '6px',
            background: 'rgba(245,158,11,0.12)',
            border: '1px solid rgba(245,158,11,0.4)',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          }}
        >
          <div style={{ fontWeight: 600, color: '#fcd34d' }}>{pendingConfirm.label}</div>
          <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => pendingConfirm.resolve(false)} style={smallBtnStyle}>
              拒绝
            </button>
            <button
              type="button"
              onClick={() => pendingConfirm.resolve(true)}
              style={{ ...smallBtnStyle, background: '#d97706', color: '#fff', borderColor: '#d97706' }}
            >
              <Check size={11} /> 允许执行
            </button>
          </div>
        </div>
      )}

      {/* 底部输入区 */}
      <div style={{ padding: '8px 10px', borderTop: '1px solid rgba(255,255,255,0.08)', background: '#1f1f23' }}>
        {selectedNodes.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '6px' }}>
            {selectedNodes.slice(0, 4).map((n) => (
              <span key={n.id} style={refPillStyle}>@{n.name}</span>
            ))}
            {selectedNodes.length > 4 && (
              <span style={refPillStyle}>+{selectedNodes.length - 4}</span>
            )}
          </div>
        )}
        <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-end' }}>
          <textarea
            rows={2}
            value={input}
            placeholder="描述你想做的游戏或改动（Enter 发送，Shift+Enter 换行）"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            style={{
              flex: 1,
              resize: 'none',
              padding: '6px 8px',
              borderRadius: '4px',
              border: '1px solid rgba(255,255,255,0.14)',
              background: '#111113',
              color: '#f4f4f5',
              fontSize: '12px',
              lineHeight: 1.4,
            }}
          />
          {status === 'idle' ? (
            <button
              type="button"
              onClick={handleSend}
              disabled={!input.trim()}
              title="发送"
              style={{
                height: '34px',
                padding: '0 10px',
                borderRadius: '4px',
                border: 'none',
                background: input.trim() ? '#2563eb' : '#27272a',
                color: '#fff',
                cursor: input.trim() ? 'pointer' : 'default',
              }}
            >
              <Send size={13} />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void abort()}
              title="安全停止"
              style={{
                height: '34px',
                padding: '0 10px',
                borderRadius: '4px',
                border: '1px solid rgba(239,68,68,0.5)',
                background: 'rgba(239,68,68,0.18)',
                color: '#fca5a5',
                cursor: 'pointer',
              }}
            >
              <Square size={12} />
            </button>
          )}
        </div>
      </div>
    </aside>
  )
}

const iconBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#a1a1aa',
  cursor: 'pointer',
  padding: '4px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
}

const fieldInputStyle: React.CSSProperties = {
  width: '100%',
  height: '26px',
  padding: '0 8px',
  borderRadius: '4px',
  border: '1px solid rgba(255,255,255,0.14)',
  background: '#1c1c21',
  color: '#f4f4f5',
  fontSize: '12px',
  boxSizing: 'border-box',
}

const smallBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  padding: '4px 10px',
  borderRadius: '4px',
  border: '1px solid rgba(255,255,255,0.14)',
  background: '#27272a',
  color: '#e4e4e7',
  fontSize: '11px',
  cursor: 'pointer',
}

const refPillStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '1px 6px',
  borderRadius: '999px',
  background: 'rgba(59,130,246,0.2)',
  border: '1px solid rgba(59,130,246,0.38)',
  color: '#93c5fd',
  fontSize: '11px',
}
