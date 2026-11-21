import { defineShader, fresnel, smoothstep, mix, texture } from 't3d/shader'

export default defineShader({
  name: '卡通表面',
  mode: 'lit',
  params: {
    albedoMap: { type: 'texture', label: '漫反射贴图' },
    tint: { type: 'color', default: '#ffffff', label: '染色' },
    rimColor: { type: 'color', default: '#ffe8a3', label: '轮廓高光色' },
    rimThreshold: { type: 'number', default: 0.6, min: 0.1, max: 0.95, label: '边缘阈值' },
  },
  surface({ params, uv, normalWorld, viewDirection }) {
    const base = texture(params.albedoMap, uv).rgb.mul(params.tint)
    const rimFactor = smoothstep(
      params.rimThreshold,
      params.rimThreshold.add(0.08),
      fresnel(normalWorld, viewDirection, 2),
    )
    return {
      baseColor: base,
      emissive: mix(base.mul(0), params.rimColor, rimFactor.mul(0.5)),
      roughness: 0.95,
      metalness: 0,
    }
  },
})
