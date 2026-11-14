import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
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
  },
  server: {
    port: 5180,
    strictPort: true,
  },
  preview: {
    port: 5180,
  },
})
