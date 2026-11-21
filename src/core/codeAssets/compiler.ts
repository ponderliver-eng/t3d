import ts from 'typescript'

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
  if (message.includes("t3d/shader") || message.includes("t3d/runtime")) {
    return '请确保从 "t3d/shader" 或 "t3d/runtime" 导入白名单 API'
  }
  if (code === 2304) return '存在未定义的标识符，请检查拼写或从 t3d/runtime / t3d/shader 导入'
  if (code === 2322 || code === 2345) return '类型不匹配，请检查参数或返回值类型是否符合契约'
  return '请根据报错行号修正语法或类型错误'
}

export function checkAndTranspileTs(fileName: string, source: string): CompileResult {
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

  const diagnostics: CodeDiagnostic[] = (output.diagnostics ?? []).map((diag) => {
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
  })

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
    const fn = new Function('require', 'module', 'exports', jsCode)
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
