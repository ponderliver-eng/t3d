import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ExternalLink, FileCode2, Play, Wand2, X } from 'lucide-react'
import { projectDirectoryPath } from '../../editor/project/disk'
import { electronBridge, joinProjectPath } from '../../editor/project/electronBridge'
import { defaultForSchema } from '../schema/fieldSchema'
import { SchemaForm } from '../schema/SchemaForm'
import { tokenizeCode } from './highlight'
import {
  saveAndCompileCodeAsset,
  useCodeAssetStore,
  type CodeAssetKind,
} from './workspace'
import './CodeAssetModal.css'

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
  const [previewParams, setPreviewParams] = useState<Record<string, unknown>>({})
  const highlightRef = useRef<HTMLPreElement | null>(null)
  const gutterRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    const sync = () => setTarget(activeModalTarget)
    listeners.add(sync)
    return () => { listeners.delete(sync) }
  }, [])

  useEffect(() => {
    if (record) {
      setDraft(record.source)
    }
  }, [record?.id, record?.updatedAt])

  const schemaFields = useMemo(() => {
    if (!record) return {}
    if (record.kind === 'shader') {
      return record.compiledShader?.definition.params ?? {}
    }
    return record.compiledScript?.behavior?.params ?? {}
  }, [record])

  useEffect(() => {
    const defaults: Record<string, unknown> = {}
    for (const [k, s] of Object.entries(schemaFields)) {
      defaults[k] = defaultForSchema(s)
    }
    setPreviewParams(defaults)
  }, [record?.id, schemaFields])

  const tokens = useMemo(() => tokenizeCode(draft), [draft])
  const lineCount = useMemo(() => Math.max(1, draft.split('\n').length), [draft])

  const syncScroll = () => {
    const ta = textareaRef.current
    if (!ta) return
    if (highlightRef.current) {
      highlightRef.current.scrollTop = ta.scrollTop
      highlightRef.current.scrollLeft = ta.scrollLeft
    }
    if (gutterRef.current) {
      gutterRef.current.scrollTop = ta.scrollTop
    }
  }

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

  const colorA = typeof previewParams.baseColor === 'string'
    ? previewParams.baseColor
    : typeof previewParams.a === 'string'
      ? previewParams.a
      : '#4a9eff'
  const colorB = typeof previewParams.glowColor === 'string'
    ? previewParams.glowColor
    : typeof previewParams.b === 'string'
      ? previewParams.b
      : '#93c5fd'

  return createPortal(
    <div
      className="code-modal-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) closeCodeAssetModal()
      }}
    >
      <div className="code-modal">
        <div className="code-modal__head">
          <span className={`code-modal__kind code-modal__kind--${record.kind}`}>
            {record.kind === 'shader' ? <Wand2 size={12} /> : <FileCode2 size={12} />}
            {record.kind === 'shader' ? '着色器' : '脚本'}
          </span>
          <span className="code-modal__path">{record.relativePath}</span>
          <span className={`code-modal__status ${record.ok ? 'is-ok' : 'is-err'}`}>
            {record.ok ? '● 编译通过' : `● ${record.diagnostics.length} 个错误`}
          </span>
          <div className="code-modal__spacer" />
          {projectDirectoryPath() && (
            <>
              <button type="button" className="code-modal__btn" onClick={() => void openExternal('cursor')}>
                <ExternalLink size={12} /> Cursor 打开
              </button>
              <button type="button" className="code-modal__btn" onClick={() => void openExternal('code')}>
                <ExternalLink size={12} /> VS Code
              </button>
            </>
          )}
          <button type="button" className="code-modal__btn code-modal__btn--primary" disabled={busy} onClick={() => void save()}>
            {busy ? <Play size={12} /> : <Check size={12} />} 保存并热重载
          </button>
          <button type="button" className="code-modal__close" onClick={closeCodeAssetModal}>
            <X size={15} />
          </button>
        </div>

        <div className="code-modal__body">
          <div className="code-modal__editor-wrap">
            <div ref={gutterRef} className="code-modal__gutter" aria-hidden="true">
              {Array.from({ length: lineCount }, (_, idx) => (
                <div key={idx} className="code-modal__line-num">{idx + 1}</div>
              ))}
            </div>
            <div className="code-modal__code-stage">
              <pre ref={highlightRef} className="code-modal__highlight" aria-hidden="true">
                {tokens.map((tok, idx) => (
                  tok.kind === 'plain'
                    ? tok.text
                    : <span key={idx} className={`tok-${tok.kind}`}>{tok.text}</span>
                ))}
                {draft.endsWith('\n') ? ' ' : ''}
              </pre>
              <textarea
                ref={textareaRef}
                className="code-modal__editor"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onScroll={syncScroll}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                    e.preventDefault()
                    void save()
                    return
                  }
                  if (e.key === 'Tab') {
                    e.preventDefault()
                    const el = e.currentTarget
                    const start = el.selectionStart
                    const end = el.selectionEnd
                    const next = `${draft.slice(0, start)}  ${draft.slice(end)}`
                    setDraft(next)
                    requestAnimationFrame(() => {
                      el.selectionStart = el.selectionEnd = start + 2
                      syncScroll()
                    })
                  }
                }}
                spellCheck={false}
                autoCapitalize="off"
                autoComplete="off"
                autoCorrect="off"
              />
            </div>
          </div>
          <aside className="code-modal__side">
            {record.kind === 'shader' && (
              <div>
                <div className="code-modal__section-title">表面预览</div>
                <div
                  className="code-modal__swatch"
                  style={{ background: `linear-gradient(135deg, ${colorA}, ${colorB})` }}
                >
                  <span>{record.compiledShader?.definition.name ?? record.name}</span>
                  <span>{record.compiledShader?.definition.mode ?? 'lit'}</span>
                </div>
              </div>
            )}

            <div>
              <div className="code-modal__section-title">
                {record.kind === 'shader' ? '公开参数 (params)' : '组件参数预览 (SchemaForm)'}
              </div>
              {Object.keys(schemaFields).length > 0 ? (
                <SchemaForm
                  schema={{ type: 'object', fields: schemaFields }}
                  value={previewParams}
                  onChange={(next) => setPreviewParams(next as Record<string, unknown>)}
                />
              ) : (
                <div className="code-modal__meta">当前未声明公开参数。</div>
              )}
            </div>

            <div>
              <div className="code-modal__section-title">使用方式</div>
              <div className="code-modal__meta">
                {record.kind === 'shader'
                  ? '修改 surface() 并保存后自动热重载，可在材质卡片或 Cursor 中联动编辑。'
                  : '在场景节点 Inspector 底部点击「添加组件」挂载此脚本，即可用右侧生成的表单调节参数。'}
              </div>
            </div>
          </aside>
        </div>

        {record.diagnostics.length > 0 && (
          <div className="code-modal__diag">
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
