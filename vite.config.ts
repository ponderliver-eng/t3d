import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig(({ mode }) => ({
  worker: {
    format: 'es',
  },
  plugins: [
    react(),
    ...(mode === 'web'
      ? []
      : [
          electron({
            main: {
              entry: 'electron/main.ts',
              vite: {
                build: {
                  target: 'node20',
                  outDir: 'dist-electron',
                  rollupOptions: {
                    external: ['electron', 'node:url', 'node:path', 'node:fs/promises', 'node:child_process'],
                    output: {
                      format: 'es',
                      inlineDynamicImports: true,
                      entryFileNames: 'main.mjs',
                    },
                  },
                },
              },
            },
            preload: {
              input: path.join(rootDir, 'electron/preload.ts'),
              vite: {
                build: {
                  ssr: 'electron/preload.ts',
                  target: 'node20',
                  outDir: 'dist-electron',
                  rollupOptions: {
                    external: ['electron'],
                    output: {
                      format: 'cjs',
                      entryFileNames: 'preload.cjs',
                    },
                  },
                },
              },
            },
          }),
        ]),
  ],
  optimizeDeps: {
    include: [
      'three',
      'three/webgpu',
      'three/tsl',
      'three/addons/controls/TransformControls.js',
      'three/addons/controls/OrbitControls.js',
      'three/addons/loaders/GLTFLoader.js',
      'three/addons/loaders/OBJLoader.js',
      'three/addons/loaders/STLLoader.js',
      'three/addons/loaders/FBXLoader.js',
      'three/addons/loaders/ColladaLoader.js',
      'three/addons/loaders/TDSLoader.js',
      'three/addons/loaders/RGBELoader.js',
      'three/addons/loaders/EXRLoader.js',
      'three/addons/exporters/GLTFExporter.js',
      'three/addons/loaders/KTX2Loader.js',
      'three/addons/utils/SkeletonUtils.js',
      'three/addons/libs/meshopt_decoder.module.js',
      'meshoptimizer',
      '@gltf-transform/core',
      '@gltf-transform/functions',
      '@gltf-transform/extensions',
      'three/addons/tsl/display/BloomNode.js',
      'three/addons/tsl/display/SSAONode.js',
      'three/addons/tsl/display/DepthOfFieldNode.js',
    ],
    exclude: ['@dimforge/rapier3d-compat', 'recast-navigation', '@recast-navigation/core', '@recast-navigation/wasm'],
  },
  server: {
    port: 5180,
    strictPort: true,
  },
  preview: {
    port: 5180,
  },
}))
