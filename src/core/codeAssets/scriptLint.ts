import type { CodeDiagnostic } from './compiler'

function lineColumnAt(source: string, index: number): { line: number; column: number } {
  let line = 1
  let lastNewline = -1
  for (let i = 0; i < index && i < source.length; i += 1) {
    if (source.charCodeAt(i) === 10) {
      line += 1
      lastNewline = i
    }
  }
  return { line, column: index - lastNewline }
}

/**
 * 轻量静态反模式扫描：在脚本落盘编译时即时拦截 T3D 高频踩坑写法，
 * 避免拖到试玩阶段才发现静默失效或运行时报错。
 */
export function lintScriptSource(source: string, file = 'script.ts'): CodeDiagnostic[] {
  const issues: CodeDiagnostic[] = []
  const text = String(source ?? '')
  if (!text.trim()) return issues

  // 1. 检查是否包含 defineBehavior / defineSystem
  if (!/\bdefine(?:Behavior|System)\s*\(/.test(text)) {
    issues.push({
      file,
      severity: 'error',
      line: 1,
      column: 1,
      message: '[T3D规范] 脚本必须从 "t3d/runtime" 导入并使用 export default defineBehavior(...) 或 defineSystem(...)',
      hint: '添加 import { defineBehavior } from "t3d/runtime" 并导出 export default defineBehavior({ ... })',
    })
  }

  // 2. 禁止分向量赋值（self.position.x = ... / self.rotation.y += ...）
  const vecAssignRe = /\bself\.(position|rotation|scale)\.[xyz]\s*(?:[+\-*/%]?=|\+\+|--)(?!=)/g
  let match: RegExpExecArray | null
  while ((match = vecAssignRe.exec(text)) !== null) {
    const pos = lineColumnAt(text, match.index)
    issues.push({
      file,
      severity: 'error',
      line: pos.line,
      column: pos.column,
      message: `[T3D规范] 禁止直接修改 self.${match[1]} 的单个分量（${match[0].trim()}），必须整体赋值`,
      hint: `改为整体赋值，例如：self.${match[1]} = { ...self.${match[1]}, x: ... }`,
    })
  }

  // 3. 误将 NodeHandle 当成包装对象访问 .node（排除 self.node）
  const wrongNodeHandleRe = /\b(?!self\b)([a-zA-Z_$][\w$]*)\.node\.(addTag|removeTag|hasTag|position|rotation|scale|destroy|sendMessage|getChildren|visible|name)\b/g
  while ((match = wrongNodeHandleRe.exec(text)) !== null) {
    const pos = lineColumnAt(text, match.index)
    issues.push({
      file,
      severity: 'error',
      line: pos.line,
      column: pos.column,
      message: `[T3D规范] pool.acquire / cloneNode / spawnPrefab / findNodeById 返回的直接就是 NodeHandle`,
      hint: `请直接写 ${match[1]}.${match[2]}，不要写 ${match[1]}.node.${match[2]}`,
    })
  }

  // 4. 禁止访问浏览器全局对象
  const forbiddenGlobalRe = /(?:^|[^\w$.])(window|document|localStorage|sessionStorage)\s*\./gm
  while ((match = forbiddenGlobalRe.exec(text)) !== null) {
    const idx = match.index + match[0].indexOf(match[1])
    const pos = lineColumnAt(text, idx)
    issues.push({
      file,
      severity: 'error',
      line: pos.line,
      column: pos.column,
      message: `[T3D规范] 严禁直接访问浏览器全局对象 "${match[1]}"`,
      hint: '请改用 self.input / self.storage / self.ui 等运行时接口',
    })
  }

  // 5. 声明了 params 字段但正文中完全未使用
  const paramsBlockMatch = /\bparams\s*:\s*\{([\s\S]*?)\n\s*\}/.exec(text)
  if (paramsBlockMatch) {
    const blockBody = paramsBlockMatch[1]
    const bodyStartIdx = paramsBlockMatch.index + paramsBlockMatch[0].length
    const restText = text.slice(bodyStartIdx)
    const keyRe = /^\s*([a-zA-Z_$][\w$]*)\s*:\s*\{/gm
    let keyMatch: RegExpExecArray | null
    while ((keyMatch = keyRe.exec(blockBody)) !== null) {
      const keyName = keyMatch[1]
      const usedRe = new RegExp(`\\b${keyName}\\b`)
      if (!usedRe.test(restText)) {
        const pos = lineColumnAt(text, paramsBlockMatch.index + keyMatch.index)
        issues.push({
          file,
          severity: 'warning',
          line: pos.line,
          column: pos.column,
          message: `[T3D提示] 声明了参数 "${keyName}" 但脚本逻辑中尚未使用`,
          hint: `请检查是否遗漏了 self.params.${keyName}`,
        })
      }
    }

    // 6. 检查资源/节点引用参数是否误用了 type: 'string' 而不是弹窗引用类型 ref / texture
    const refLikeKeyRe = /(?:^|_)(?:node|target|parent|spawn|path|prefab|model|clip|anim|animation|audio|sfx|bgm|sound|effect|fx|material|texture|tex|ui|screen|scene|asset)(?:Id|Ref|Asset)?$/i
    const stringParamRe = /^\s*([a-zA-Z_$][\w$]*)\s*:\s*\{[^}]*\btype\s*:\s*['"]string['"]/gm
    let strMatch: RegExpExecArray | null
    while ((strMatch = stringParamRe.exec(blockBody)) !== null) {
      const keyName = strMatch[1]
      if (!refLikeKeyRe.test(keyName)) continue
      const lower = keyName.toLowerCase()
      let suggest = `{ type: 'ref', target: 'asset', label: '...', default: null }`
      if (lower.includes('clip') || lower.includes('anim')) {
        suggest = `{ type: 'ref', target: 'clip', label: '...', default: null }`
      } else if (lower.includes('tex')) {
        suggest = `{ type: 'texture', label: '...', default: null }`
      } else if (lower.includes('node') || lower.includes('target') || lower.includes('parent') || lower.includes('spawn') || lower.includes('path')) {
        suggest = `{ type: 'ref', target: 'node', label: '...', default: null }`
      } else if (lower.includes('prefab')) {
        suggest = `{ type: 'ref', target: 'asset', kinds: ['prefab'], label: '...', default: null }`
      } else if (lower.includes('audio') || lower.includes('sfx') || lower.includes('bgm') || lower.includes('sound')) {
        suggest = `{ type: 'ref', target: 'asset', kinds: ['audio'], label: '...', default: null }`
      } else if (lower.includes('effect') || lower.includes('fx')) {
        suggest = `{ type: 'ref', target: 'asset', kinds: ['effect'], label: '...', default: null }`
      }
      const pos = lineColumnAt(text, paramsBlockMatch.index + strMatch.index)
      issues.push({
        file,
        severity: 'warning',
        line: pos.line,
        column: pos.column,
        message: `[T3D规范] 参数 "${keyName}" 看起来是资源或节点引用，请勿使用 type: "string" 手填 ID`,
        hint: `请改为 ${suggest}，以便属性面板渲染为弹窗选择器与拖放槽位`,
      })
    }
  }

  return issues
}
