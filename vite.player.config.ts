import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  base: './',
  worker: {
    format: 'es',
  },
  build: {
    outDir: 'dist-player',
    emptyOutDir: true,
    rollupOptions: {
      input: path.join(rootDir, 'player.html'),
    },
  },
})
