import ts from 'typescript'
import { CORE_ES_LIB_DTS, RUNTIME_DTS_SUMMARY, SHADER_DTS_SUMMARY } from './typeDefs'

export interface CodeDiagnostic {
  file: string
  line: number
  column: number
  severity: 'error' | 'warning'
  message: string
  hint: string
}

export interface CompileResult<T = unknown> {
  ok: boolean
  diagnostics: CodeDiagnostic[]
  jsCode?: string
  exports?: T
}

function diagnosticHint(code: number, message: string): string {
  if (message.includes('t3d/shader') || message.includes('t3d/runtime')) {
    return '请确保从 "t3d/shader" 或 "t3d/runtime" 导入白名单 API'
  }
  if (code === 2304) return '存在未定义的标识符，请检查拼写或从 t3d/runtime / t3d/shader 导入'
  if (code === 2339) return '访问了对象上不存在的属性或方法，请对照 .t3d/runtime.d.ts / .t3d/shader.d.ts 检查 API 名称'
  if (code === 2322 || code === 2345) return '类型不匹配，请检查参数或返回值类型是否符合契约'
  if (code === 2554 || code === 2555) return '函数调用参数数量不匹配，请检查必填参数'
  return '请根据报错行号修正语法或类型错误'
}

const LIB_PATH = '/__lib.d.ts'
const RUNTIME_DTS_PATH = '/node_modules/t3d/runtime.d.ts'
const SHADER_DTS_PATH = '/node_modules/t3d/shader.d.ts'

function toCodeDiagnostic(diag: ts.Diagnostic, fileName: string): CodeDiagnostic {
  const start = diag.start ?? 0
  const pos = diag.file
    ? diag.file.getLineAndCharacterOfPosition(start)
    : { line: 0, character: 0 }
  const msg = ts.flattenDiagnosticMessageText(diag.messageText, '\n')
  return {
    file: fileName,
    line: pos.line + 1,
    column: pos.character + 1,
    severity: diag.category === ts.DiagnosticCategory.Warning ? 'warning' : 'error',
    message: msg,
    hint: diagnosticHint(diag.code, msg),
  }
}

function runSemanticTypeCheck(fileName: string, source: string): CodeDiagnostic[] {
  const entryPath = `/__user__/${fileName.replace(/^\/+/, '')}`
  const virtualFiles = new Map<string, string>([
    [LIB_PATH, CORE_ES_LIB_DTS],
    [RUNTIME_DTS_PATH, RUNTIME_DTS_SUMMARY],
    [SHADER_DTS_PATH, SHADER_DTS_SUMMARY],
    [entryPath, source],
  ])

  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noImplicitAny: false,
    skipLibCheck: true,
    noEmit: true,
    baseUrl: '/',
    paths: {
      't3d/runtime': [RUNTIME_DTS_PATH],
      't3d/shader': [SHADER_DTS_PATH],
    },
  }

  const host: ts.CompilerHost = {
    getSourceFile: (name, languageVersion) => {
      const content = virtualFiles.get(name)
      if (content === undefined) return undefined
      return ts.createSourceFile(name, content, languageVersion, true)
    },
    getDefaultLibFileName: () => LIB_PATH,
    writeFile: () => {},
    getCurrentDirectory: () => '/',
    getDirectories: () => [],
    fileExists: (name) => virtualFiles.has(name),
    readFile: (name) => virtualFiles.get(name),
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    resolveModuleNames: (moduleNames) =>
      moduleNames.map((mod) => {
        if (mod === 't3d/runtime') return { resolvedFileName: RUNTIME_DTS_PATH, isExternalLibraryImport: true }
        if (mod === 't3d/shader') return { resolvedFileName: SHADER_DTS_PATH, isExternalLibraryImport: true }
        return undefined
      }),
  }

  const program = ts.createProgram([entryPath], compilerOptions, host)
  const sourceFile = program.getSourceFile(entryPath)
  if (!sourceFile) return []

  const rawDiags = [
    ...program.getSyntacticDiagnostics(sourceFile),
    ...program.getSemanticDiagnostics(sourceFile),
  ]

  return rawDiags.map((d) => toCodeDiagnostic(d, fileName))
}

export function checkAndTranspileTs(fileName: string, source: string): CompileResult {
  const semanticDiagnostics = runSemanticTypeCheck(fileName, source)

  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    esModuleInterop: true,
    strict: true,
    skipLibCheck: true,
    isolatedModules: true,
  }

  const output = ts.transpileModule(source, {
    fileName,
    reportDiagnostics: true,
    compilerOptions,
  })

  const transpileDiags = (output.diagnostics ?? []).map((diag) => toCodeDiagnostic(diag, fileName))
  const seen = new Set<string>()
  const diagnostics: CodeDiagnostic[] = []
  for (const d of [...semanticDiagnostics, ...transpileDiags]) {
    const key = `${d.line}:${d.column}:${d.message}`
    if (seen.has(key)) continue
    seen.add(key)
    diagnostics.push(d)
  }

  const hasError = diagnostics.some((d) => d.severity === 'error')
  if (hasError) {
    return { ok: false, diagnostics }
  }

  return {
    ok: true,
    diagnostics,
    jsCode: output.outputText,
  }
}

export function evaluateTranspiledModule<T = unknown>(
  fileName: string,
  jsCode: string,
  injectedModules: Record<string, unknown>,
): CompileResult<T> {
  const moduleObj: { exports: Record<string, unknown> } = { exports: {} }
  const customRequire = (specifier: string) => {
    if (specifier in injectedModules) {
      return injectedModules[specifier]
    }
    throw new Error(`不允许导入未授权模块 "${specifier}"（仅允许 ${Object.keys(injectedModules).join(', ')}）`)
  }

  try {
    const safeUrl = fileName.replace(/[\r\n]/g, '_')
    const fn = new Function('require', 'module', 'exports', `${jsCode}\n//# sourceURL=t3d:///${safeUrl}`)
    fn(customRequire, moduleObj, moduleObj.exports)
    const exported = (moduleObj.exports.default ?? moduleObj.exports) as T
    return {
      ok: true,
      diagnostics: [],
      jsCode,
      exports: exported,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      diagnostics: [
        {
          file: fileName,
          line: 1,
          column: 1,
          severity: 'error',
          message: `模块执行失败：${message}`,
          hint: '请检查顶层代码是否存在运行时异常或非法模块导入',
        },
      ],
    }
  }
}
