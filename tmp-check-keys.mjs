import { readFileSync } from 'node:fs'

const src = readFileSync('src/capabilities/particles/EffectModules.tsx', 'utf8')
  + readFileSync('src/capabilities/particles/EffectCard.tsx', 'utf8')
  + readFileSync('src/editor/ui/ScreenCard.tsx', 'utf8')
const keys = [...src.matchAll(/t\('([^']+)'/g)].map(match => match[1])
const messages = readFileSync('src/editor/i18n/messages.ts', 'utf8')
const zhStart = messages.indexOf('export const zh')
const enStart = messages.indexOf('export const en')
const zh = messages.slice(zhStart, enStart)
const en = messages.slice(enStart)
const missing = []
for (const key of [...new Set(keys)]) {
  const needle = `'${key}':`
  if (!zh.includes(needle)) missing.push(`zh ${key}`)
  if (!en.includes(needle)) missing.push(`en ${key}`)
}
console.log(`keys ${new Set(keys).size}`)
console.log(missing.length ? missing.join('\n') : 'all present')
