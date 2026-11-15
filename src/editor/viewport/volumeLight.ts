import { AdditiveBlending, BoxGeometry, Color, Mesh } from 'three'
import { BlendMode, CustomBlending, OneFactor, VolumeNodeMaterial, ZeroFactor } from 'three/webgpu'
import { mrt, uniform, vec4 } from 'three/tsl'
import type { ScenePicture } from '../scene/types'

/** 体积光不要改屏幕反射用的法线和金属度，只往颜色上叠加。 */
function keepGBuffer() {
  const blend = new BlendMode(CustomBlending)
  blend.blendSrc = ZeroFactor
  blend.blendDst = OneFactor
  blend.blendSrcAlpha = ZeroFactor
  blend.blendDstAlpha = OneFactor
  const buffers = mrt({
    normal: vec4(0, 0, 0, 1),
    metalrough: vec4(0, 0, 0, 1),
  })
  buffers.setBlendMode('normal', blend)
  buffers.setBlendMode('metalrough', blend)
  return buffers
}

/** 场景里的一盒体积。只散射有距离的点光、聚光和矩形光，方向光不进入这块材质。 */
export function createVolumeLight() {
  const density = uniform(0.25)
  const color = uniform(new Color('#d7e6ff'))
  const material = new VolumeNodeMaterial()
  const gBuffer = keepGBuffer()
  let keepsGBuffer = false
  material.steps = 24
  material.blending = AdditiveBlending
  material.depthWrite = false
  material.scatteringNode = () => color.mul(density)
  const mesh = new Mesh(new BoxGeometry(1, 1, 1), material)
  mesh.name = 'volume-light'
  mesh.renderOrder = 10
  mesh.frustumCulled = false
  mesh.castShadow = false
  mesh.receiveShadow = false
  mesh.raycast = () => {}
  mesh.visible = false
  return {
    mesh,
    sync(picture: ScenePicture) {
      mesh.visible = picture.volume === true
      const screenSpace = picture.ssr || picture.ssgi || picture.ao
      if (screenSpace !== keepsGBuffer) {
        keepsGBuffer = screenSpace
        material.mrtNode = screenSpace ? gBuffer : null
        material.needsUpdate = true
      }
      if (!mesh.visible) return
      material.steps = Math.max(4, Math.round(picture.volumeSteps))
      density.value = picture.volumeDensity
      color.value.set(picture.volumeColor)
      const height = Math.max(picture.volumeHeight, 0.5)
      const size = Math.max(picture.volumeSize, 0.5)
      mesh.scale.set(size, height, size)
      mesh.position.set(0, height / 2, 0)
    },
    dispose() {
      mesh.geometry.dispose()
      material.dispose()
      mesh.removeFromParent()
    },
  }
}
