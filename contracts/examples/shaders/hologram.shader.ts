import { defineShader, fresnel, fract, sin, step, mix, clamp } from 't3d/shader'

export default defineShader({
  name: '全息投影',
  mode: 'unlit',
  params: {
    mainColor: { type: 'color', default: '#22e6ff', label: '主色调' },
    scanDensity: { type: 'number', default: 24, min: 4, max: 120, label: '扫描线密度' },
    scrollSpeed: { type: 'number', default: 1.5, min: 0, max: 10, label: '滚动速度' },
    rimPower: { type: 'number', default: 2.5, min: 0.5, max: 8, label: '边缘强度' },
  },
  surface({ params, positionWorld, normalWorld, viewDirection, time }) {
    const rim = fresnel(normalWorld, viewDirection, params.rimPower)
    const scanPhase = fract(positionWorld.y.mul(params.scanDensity).sub(time.mul(params.scrollSpeed)))
    const scanLine = step(0.5, scanPhase).mul(0.45).add(0.55)
    const flicker = sin(time.mul(18)).mul(0.08).add(0.92)
    const alpha = clamp(rim.mul(scanLine).mul(flicker).add(0.15), 0, 1)
    return {
      baseColor: mix(params.mainColor, params.mainColor.mul(1.6), rim),
      opacity: alpha,
    }
  },
})
