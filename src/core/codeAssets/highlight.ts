export type HighlightTokenKind =
  | 'plain'
  | 'comment'
  | 'string'
  | 'color'
  | 'number'
  | 'keyword'
  | 'api'
  | 'type'
  | 'fn'

export interface HighlightToken {
  kind: HighlightTokenKind
  text: string
}

const KEYWORDS = new Set([
  'import', 'export', 'default', 'from', 'as', 'const', 'let', 'var',
  'function', 'return', 'if', 'else', 'for', 'while', 'switch', 'case',
  'break', 'continue', 'new', 'typeof', 'instanceof', 'in', 'of',
  'true', 'false', 'null', 'undefined', 'void', 'type', 'interface',
  'readonly', 'async', 'await', 'try', 'catch', 'finally', 'throw',
])

const T3D_APIS = new Set([
  'defineBehavior', 'defineSystem', 'defineShader',
  'self', 'gizmos', 'params', 'state', 'dt',
  'onStart', 'onUpdate', 'onDestroy', 'onMessage', 'onDrawGizmos', 'surface',
  'vec2', 'vec3', 'vec4', 'float', 'int', 'color', 'time', 'uv',
  'normalLocal', 'normalWorld', 'positionLocal', 'positionWorld', 'cameraPosition',
  'sin', 'cos', 'abs', 'fract', 'floor', 'ceil', 'min', 'max', 'clamp',
  'mix', 'smoothstep', 'step', 'pow', 'sqrt', 'dot', 'cross', 'normalize', 'length',
  'Math', 'console',
])

export function tokenizeCode(source: string): HighlightToken[] {
  const tokens: HighlightToken[] = []
  const len = source.length
  let i = 0

  const push = (kind: HighlightTokenKind, text: string) => {
    const last = tokens[tokens.length - 1]
    if (last && last.kind === kind) {
      last.text += text
    } else {
      tokens.push({ kind, text })
    }
  }

  while (i < len) {
    const ch = source[i]

    // 单行注释 //
    if (ch === '/' && source[i + 1] === '/') {
      let end = source.indexOf('\n', i)
      if (end === -1) end = len
      push('comment', source.slice(i, end))
      i = end
      continue
    }

    // 多行注释 /* ... */
    if (ch === '/' && source[i + 1] === '*') {
      let end = source.indexOf('*/', i + 2)
      end = end === -1 ? len : end + 2
      push('comment', source.slice(i, end))
      i = end
      continue
    }

    // 字符串 '...' "..." `...`
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch
      let j = i + 1
      while (j < len) {
        if (source[j] === '\\') {
          j += 2
          continue
        }
        if (source[j] === quote) {
          j += 1
          break
        }
        if (quote !== '`' && source[j] === '\n') break
        j += 1
      }
      const literal = source.slice(i, j)
      const isHexColor = /^(['"`])#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\1$/.test(literal)
      push(isHexColor ? 'color' : 'string', literal)
      i = j
      continue
    }

    // 数字
    if ((ch >= '0' && ch <= '9') || (ch === '.' && source[i + 1] >= '0' && source[i + 1] <= '9')) {
      const match = source.slice(i).match(/^(?:0x[0-9a-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/)
      if (match) {
        push('number', match[0])
        i += match[0].length
        continue
      }
    }

    // 标识符 / 关键字 / API / 类型 / 函数调用
    if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_' || ch === '$') {
      let j = i + 1
      while (j < len) {
        const c = source[j]
        if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c === '_' || c === '$') {
          j += 1
        } else {
          break
        }
      }
      const word = source.slice(i, j)
      if (KEYWORDS.has(word)) {
        push('keyword', word)
      } else if (T3D_APIS.has(word)) {
        push('api', word)
      } else if (word[0] >= 'A' && word[0] <= 'Z') {
        push('type', word)
      } else {
        // 检查后面是否紧跟 '(' 判断函数调用
        let k = j
        while (k < len && (source[k] === ' ' || source[k] === '\t')) k += 1
        push(source[k] === '(' ? 'fn' : 'plain', word)
      }
      i = j
      continue
    }

    push('plain', ch)
    i += 1
  }

  return tokens
}
