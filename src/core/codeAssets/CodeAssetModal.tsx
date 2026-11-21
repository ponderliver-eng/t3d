import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ExternalLink, Play, X } from 'lucide-react'
import { projectDirectoryPath } from '../../editor/project/disk'
import { electronBridge, joinProjectPath } from '../../editor/project/electronBridge'
import {
  saveAndCompileCodeAsset,
  useCodeAssetStore,
  type CodeAssetKind,
} from './workspace'

interface CodeModalTarget {
  kind: CodeAssetKind
  id: string
}

let activeModalTarget: CodeModalTarget | null = null
const listeners = new Set<() => void>()

export function openCodeAssetModal(kind: CodeAssetKind, id: string): void {
  activeModalTarget = { kind, id }
  listeners.forEach((fn) => fn())
}

export function closeCodeAssetModal(): void {
  activeModalTarget = null
  listeners.forEach((fn) => fn())
}

export function CodeAssetModalHost() {
  const [target, setTarget] = useState<CodeModalTarget | null>(activeModalTarget)
  const record = useCodeAssetStore((s) => (target ? s.assets[target.id] : undefined))
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const sync = () => setTarget(activeModalTarget)
    listeners.add(sync)
    return () => { listeners.delete(sync) }
  }, [])

  useEffect(() => {
    if (record) setDraft(record.source)
  }, [record?.id, record?.updatedAt])

  if (!target || !record) return null

  const save = async () => {
    setBusy(true)
    try {
      await saveAndCompileCodeAsset(record.kind, record.id, draft)
    } finally {
      setBusy(false)
    }
  }

  const openExternal = async (editor: 'cursor' | 'code') => {
    const dir = projectDirectoryPath()
    const bridge = electronBridge()
    if (!dir || !bridge?.codeAssets?.openInEditor) return
    await save()
    await bridge.codeAssets.openInEditor(joinProjectPath(dir, record.relativePath), editor)
  }

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 12000,
        background: 'rgba(10, 12, 16, 0.72)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) closeCodeAssetModal()
      }}
    >
      <div
        style={{
          width: 'min(920px, 92vw)',
          height: 'min(680px, 86vh)',
          background: '#1b1f27',
          border: '1px solid #2f3644',
          borderRadius: 8,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 14px',
            background: '#222731',
            borderBottom: '1px solid #2f3644',
            fontSize: 12,
          }}
        >
          <span
            style={{
              padding: '2px 6px',
              borderRadius: 4,
              background: record.kind === 'shader' ? '#3a2d5c' : '#1f3d5a',
              color: '#e2e8f0',
              fontWeight: 600,
            }}
          >
            {record.kind === 'shader' ? '着色器' : '脚本'}
          </span>
          <strong style={{ color: '#f1f5f9' }}>{record.relativePath}</strong>
          <span style={{ color: record.ok ? '#68d391' : '#f87171', fontSize: 11 }}>
            {record.ok ? '● 编译通过' : `● ${record.diagnostics.length} 个错误`}
          </span>
          <div style={{ flex: 1 }} />
          {projectDirectoryPath() && (
            <>
              <button
                type="button"
                onClick={() => void openExternal('cursor')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '4px 8px',
                  borderRadius: 4,
                  border: '1px solid #394254',
                  background: '#272d38',
                  color: '#cbd5e1',
                  cursor: 'pointer',
                  fontSize: 11,
                }}
              >
                <ExternalLink size={12} /> Cursor 打开
              </button>
              <button
                type="button"
                onClick={() => void openExternal('code')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '4px 8px',
                  borderRadius: 4,
                  border: '1px solid #394254',
                  background: '#272d38',
                  color: '#cbd5e1',
                  cursor: 'pointer',
                  fontSize: 11,
                }}
              >
                <ExternalLink size={12} /> VS Code
              </button>
            </>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => void save()}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 10px',
              borderRadius: 4,
              border: '1px solid #3b82f6',
              background: '#2563eb',
              color: '#fff',
              cursor: 'pointer',
              fontSize: 11,
            }}
          >
            {busy ? <Play size={12} /> : <Check size={12} />} 保存并热重载
          </button>
          <button
            type="button"
            onClick={closeCodeAssetModal}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              padding: 4,
            }}
          >
            <X size={15} />
          </button>
        </div>

        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          style={{
            flex: 1,
            width: '100%',
            boxSizing: 'border-box',
            padding: 14,
            border: 'none',
            outline: 'none',
            resize: 'none',
            background: '#13161c',
            color: '#e2e8f0',
            fontFamily: 'Consolas, "Fira Code", monospace',
            fontSize: 12.5,
            lineHeight: 1.55,
          }}
        />

        {record.diagnostics.length > 0 && (
          <div
            style={{
              maxHeight: 130,
              overflowY: 'auto',
              padding: '8px 14px',
              background: '#1e171a',
              borderTop: '1px solid #4c2229',
              fontSize: 11.5,
              color: '#fca5a5',
            }}
          >
            {record.diagnostics.map((d, idx) => (
              <div key={idx} style={{ marginBottom: 4 }}>
                <strong>第 {d.line} 行：</strong> {d.message} <span style={{ color: '#94a3b8' }}>（{d.hint}）</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
