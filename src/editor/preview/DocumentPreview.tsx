import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { readDocumentText, saveDocumentText } from '../assets/import'
import { useAssetStore } from '../assets/library'
import { useI18n } from '../i18n'
import { assetDiskPath } from '../project/disk'
import { electronBridge } from '../project/electronBridge'
import { popPreviewWindow } from './previewStore'

type ViewMode = 'edit' | 'split' | 'preview'

export function DocumentPreview({ assetId, standalone = false }: { assetId: string, standalone?: boolean }) {
  const { t } = useI18n()
  const asset = useAssetStore(state => state.assets[assetId])
  const fileName = asset && 'fileName' in asset ? asset.fileName : ''
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  const isMarkdown = ext === 'md' || ext === 'markdown'

  const [savedText, setSavedText] = useState('')
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [mode, setMode] = useState<ViewMode>(isMarkdown ? 'split' : 'edit')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const dirty = text !== savedText
  const diskPath = assetDiskPath(assetId)
  const bridge = electronBridge()

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    readDocumentText(assetId)
      .then(content => {
        if (cancelled) return
        setSavedText(content)
        setText(content)
        setLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [assetId])

  const handleSave = useCallback(async () => {
    if (saving || loading || !dirty) return
    setSaving(true)
    try {
      const ok = await saveDocumentText(assetId, text)
      if (ok) setSavedText(text)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }, [assetId, dirty, loading, saving, text])

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      void handleSave()
      return
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      const el = event.currentTarget
      const start = el.selectionStart
      const end = el.selectionEnd
      const next = `${text.slice(0, start)}  ${text.slice(end)}`
      setText(next)
      requestAnimationFrame(() => {
        if (!textareaRef.current) return
        textareaRef.current.selectionStart = start + 2
        textareaRef.current.selectionEnd = start + 2
      })
    }
  }

  const lineCount = useMemo(() => (text ? text.split('\n').length : 1), [text])
  const renderedMarkdown = useMemo(() => (isMarkdown && mode !== 'edit' ? renderMarkdown(text) : null), [isMarkdown, mode, text])

  if (!asset || asset.kind !== 'document') {
    return <div className="doc-preview doc-preview--empty">文档不存在</div>
  }

  return (
    <div
      className="doc-preview"
      onKeyDown={event => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
          event.preventDefault()
          void handleSave()
        }
      }}
    >
      <div className="doc-preview__bar">
        <div className="doc-preview__meta">
          <span className="doc-preview__badge">{ext.toUpperCase() || 'DOC'}</span>
          <span className="doc-preview__name" title={fileName}>{fileName}</span>
          {dirty ? <span className="doc-preview__dirty">● 未保存</span> : <span className="doc-preview__saved">已保存</span>}
        </div>
        <div className="doc-preview__actions">
          {isMarkdown && (
            <div className="doc-preview__modes">
              <button type="button" className={mode === 'edit' ? 'is-on' : ''} onClick={() => setMode('edit')}>编辑</button>
              <button type="button" className={mode === 'split' ? 'is-on' : ''} onClick={() => setMode('split')}>分栏</button>
              <button type="button" className={mode === 'preview' ? 'is-on' : ''} onClick={() => setMode('preview')}>预览</button>
            </div>
          )}
          <button
            type="button"
            className="doc-preview__save"
            disabled={!dirty || saving || loading}
            onClick={() => void handleSave()}
            title="Ctrl+S"
          >
            {saving ? '保存中...' : '保存'}
          </button>
          {diskPath && bridge?.codeAssets?.openInEditor && (
            <button
              type="button"
              className="doc-preview__ghost"
              onClick={() => void bridge.codeAssets?.openInEditor(diskPath, 'cursor')}
              title="在 Cursor 中打开"
            >
              外部打开
            </button>
          )}
          {!standalone && (
            <button type="button" className="doc-preview__ghost" onClick={() => popPreviewWindow('document', assetId)}>
              {t('preview.popout')}
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="doc-preview__empty">正在读取文档...</div>
      ) : error ? (
        <div className="doc-preview__empty">{error}</div>
      ) : (
        <div className={`doc-preview__body ${mode === 'split' && isMarkdown ? 'is-split' : ''}`}>
          {mode !== 'preview' && (
            <textarea
              ref={textareaRef}
              className="doc-preview__editor"
              value={text}
              spellCheck={false}
              onChange={event => setText(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder="在此输入文档内容... (Ctrl+S 保存)"
            />
          )}
          {isMarkdown && mode !== 'edit' && (
            <div className="doc-preview__md">{renderedMarkdown}</div>
          )}
        </div>
      )}

      <div className="doc-preview__foot">
        <span>{lineCount} 行 · {text.length} 字符</span>
        <span>Ctrl+S 保存 · Tab 缩进</span>
      </div>
    </div>
  )
}

function renderMarkdown(source: string): ReactNode[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  let key = 0

  while (i < lines.length) {
    const line = lines[i]!
    if (line.trim().startsWith('```')) {
      const codeLines: string[] = []
      i += 1
      while (i < lines.length && !lines[i]!.trim().startsWith('```')) {
        codeLines.push(lines[i]!)
        i += 1
      }
      i += 1
      blocks.push(<pre key={key++}><code>{codeLines.join('\n')}</code></pre>)
      continue
    }
    if (!line.trim()) {
      i += 1
      continue
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      blocks.push(<hr key={key++} />)
      i += 1
      continue
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      const level = heading[1]!.length
      const content = renderInline(heading[2]!)
      if (level === 1) blocks.push(<h1 key={key++}>{content}</h1>)
      else if (level === 2) blocks.push(<h2 key={key++}>{content}</h2>)
      else if (level === 3) blocks.push(<h3 key={key++}>{content}</h3>)
      else if (level === 4) blocks.push(<h4 key={key++}>{content}</h4>)
      else if (level === 5) blocks.push(<h5 key={key++}>{content}</h5>)
      else blocks.push(<h6 key={key++}>{content}</h6>)
      i += 1
      continue
    }
    if (line.trimStart().startsWith('>')) {
      const quoteLines: string[] = []
      while (i < lines.length && lines[i]!.trimStart().startsWith('>')) {
        quoteLines.push(lines[i]!.replace(/^\s*>\s?/, ''))
        i += 1
      }
      blocks.push(<blockquote key={key++}>{renderInline(quoteLines.join(' '))}</blockquote>)
      continue
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: ReactNode[] = []
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i]!)) {
        const raw = lines[i]!.replace(/^\s*[-*+]\s+/, '')
        const task = raw.match(/^\[( |x|X)\]\s+(.*)$/)
        if (task) {
          items.push(
            <li key={items.length} className="doc-preview__task">
              <input type="checkbox" readOnly checked={task[1]!.toLowerCase() === 'x'} />
              <span>{renderInline(task[2]!)}</span>
            </li>,
          )
        } else {
          items.push(<li key={items.length}>{renderInline(raw)}</li>)
        }
        i += 1
      }
      blocks.push(<ul key={key++}>{items}</ul>)
      continue
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: ReactNode[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i]!)) {
        items.push(<li key={items.length}>{renderInline(lines[i]!.replace(/^\s*\d+\.\s+/, ''))}</li>)
        i += 1
      }
      blocks.push(<ol key={key++}>{items}</ol>)
      continue
    }
    const para: string[] = [line]
    i += 1
    while (
      i < lines.length
      && lines[i]!.trim()
      && !lines[i]!.trim().startsWith('```')
      && !/^(#{1,6})\s+/.test(lines[i]!)
      && !lines[i]!.trimStart().startsWith('>')
      && !/^\s*([-*+]|\d+\.)\s+/.test(lines[i]!)
      && !/^(-{3,}|\*{3,}|_{3,})$/.test(lines[i]!.trim())
    ) {
      para.push(lines[i]!)
      i += 1
    }
    blocks.push(<p key={key++}>{renderInline(para.join('\n'))}</p>)
  }
  return blocks
}

function renderInline(text: string): ReactNode[] {
  const parts: ReactNode[] = []
  const token = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[([^\]]+)\]\((https?:\/\/[^)]+)\))/g
  let last = 0
  let match: RegExpExecArray | null
  let key = 0
  while ((match = token.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    const raw = match[0]!
    if (raw.startsWith('`')) {
      parts.push(<code key={key++}>{raw.slice(1, -1)}</code>)
    } else if (raw.startsWith('**')) {
      parts.push(<strong key={key++}>{raw.slice(2, -2)}</strong>)
    } else if (raw.startsWith('*')) {
      parts.push(<em key={key++}>{raw.slice(1, -1)}</em>)
    } else if (match[2] && match[3]) {
      parts.push(<a key={key++} href={match[3]} target="_blank" rel="noreferrer">{match[2]}</a>)
    }
    last = match.index + raw.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}
