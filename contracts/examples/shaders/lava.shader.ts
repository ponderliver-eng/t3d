import { defineShader, color, mix, sin, texture } from 't3d/shader'

export default defineShader({
  name: '流动岩浆',
  mode: 'lit',
  params: {
    baseMap: { type: 'texture', label: '底色贴图' },
    glowColor: { type: 'color', default: '#ff5a1e', label: '发光颜色' },
    flowSpeed: { type: 'number', default: 0.3, min: 0, max: 2, label: '流动速度' },
  },
  surface({ params, uv, time }) {
    const flowUv = uv.add(time.mul(params.flowSpeed))
    const base = texture(params.baseMap, flowUv)
    const pulse = sin(time.mul(2)).mul(0.5).add(0.5)
    return {
      baseColor: base.rgb,
      emissive: mix(color(0, 0, 0), params.glowColor, pulse),
      roughness: 0.8,
    }
  },
})
