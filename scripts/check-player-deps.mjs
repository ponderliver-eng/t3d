import { build } from 'esbuild'

const result = await build({
  entryPoints: ['src/player/main.ts'],
  bundle: true,
  write: false,
  metafile: true,
  format: 'esm',
  platform: 'browser',
  loader: { '.css': 'empty' },
  external: ['three', 'three/webgpu', 'three/tsl', '@dimforge/rapier3d-compat', 'recast-navigation'],
})

const inputs = Object.keys(result.metafile?.inputs ?? {})
const editorImports = inputs.filter((p) => p.replace(/\\/g, '/').includes('src/editor/'))

if (editorImports.length > 0) {
  console.error('❌ 播放包依赖图中发现 src/editor/ 模块，违反运行时独立原则:')
  for (const item of editorImports) console.error(`  - ${item}`)
  process.exit(1)
}

console.log(`✅ 播放包依赖图校验通过（共分析 ${inputs.length} 个模块，0 个 src/editor/ 依赖）`)
