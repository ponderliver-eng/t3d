// AI 模块测试入口：范例库（真实运行时仿真）+ 模型适配层（模拟流式响应）
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { build } from 'esbuild'

const entries = ['tests/ai-knowledge.test.ts', 'tests/ai-providers.test.ts']
const banner = [
  'if(typeof globalThis.localStorage==="undefined"){const m=new Map();globalThis.localStorage={get length(){return m.size},clear:()=>m.clear(),getItem:k=>m.get(k)??null,key:i=>[...m.keys()][i]??null,removeItem:k=>{m.delete(k)},setItem:(k,v)=>{m.set(k,String(v))}};}',
  'if(typeof globalThis.document==="undefined"){globalThis.document={documentElement:{style:{}}};}',
].join('')

fs.mkdirSync('.cache', { recursive: true })
const outfiles = []
for (const entry of entries) {
  const outfile = `.cache/${entry.replace(/^tests\//, '').replace(/\.ts$/, '.mjs')}`
  await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
    packages: 'external',
    // 主进程代码依赖 electron 的 net.fetch；测试里换成桩，让适配层回落到 globalThis.fetch
    alias: { electron: './tests/stubs/electron.ts' },
    banner: { js: banner },
  })
  outfiles.push(outfile)
}
execFileSync(process.execPath, ['--test', ...outfiles], { stdio: 'inherit' })
