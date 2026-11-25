// 资产导入与内存治理测试入口：流式资源包索引（主进程代码）+ 扫描器 + 显存预算
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { build } from 'esbuild'

const entry = 'tests/asset-import-memory.test.ts'
const outfile = '.cache/asset-import-memory.test.mjs'

fs.mkdirSync('.cache', { recursive: true })
await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  packages: 'external',
})
execFileSync(process.execPath, ['--test', outfile], { stdio: 'inherit' })
