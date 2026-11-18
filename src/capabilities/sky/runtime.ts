import type { Camera, Scene } from 'three'
import { Color, OrthographicCamera } from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import { mix, uniform, vec4 } from 'three/tsl'
import { Sky, type SkyMoonlight, type SkySun } from '@pmndrs/sky'
import { EDITOR_HELPER_LAYER } from '../../editor/project/taxonomy'
import type { SkySettings } from './defaults'
import { setSkyViewState } from './session'

/**
 * 唯一允许 import `@pmndrs/sky` 的文件。
 * 天空在主绘制前更新：烘焙要看到本帧相机，并赶在画面后期之前写好背景和环境贴图。
 */
export function createSkyDriver(renderer: WebGPURenderer, scene: Scene) {
  return new SkyRuntime(renderer, scene)
}

class SkyRuntime {
  private readonly sky: Sky
  private readonly sun: SkySun
  private moon: SkyMoonlight | null = null
  private applied: SkySettings | null = null
  private starsWanted = false
  private starsReady = false
  private starsPending = false
  private starToken = 0
  private readonly fogTint = uniform(new Color('#c9d6e6'))
  private readonly fogUseColor = uniform(0)
  private readonly applyFogNode = (colorNode: unknown, scenePass: unknown) => {
    const skyFog = this.sky.applyFog(colorNode, { scenePass }) as { rgb: unknown, a: unknown }
    const amount = this.sky.applyFog(colorNode, { scenePass, debugMode: 'fog-amount' }) as { r: unknown }
    const base = colorNode as { rgb: unknown }
    const flat = mix(base.rgb as never, this.fogTint, amount.r as never)
    return vec4(mix(skyFog.rgb as never, flat, this.fogUseColor), skyFog.a as never)
  }

  constructor(renderer: WebGPURenderer, private readonly scene: Scene) {
    this.sky = new Sky(renderer, {
      preset: 'earth',
      sunColor: 'bruneton',
      enableAerialPerspective: false,
    })
    this.sky.attach(scene)
    this.sun = this.sky.createSun({
      physical: true,
      intensity: 0.12,
      castShadow: true,
      horizonFade: true,
    })
    lightUserLayers(this.sun.light)
    configureShadow(this.sun.light)
    this.sun.attach(scene)
  }

  /** 构造时库自己已经开始编译。这里只取那一份 Promise，避免和主绘制抢渲染器。 */
  compile() {
    return this.sky.compileAsync()
  }

  sync(settings: SkySettings, camera: Camera) {
    const prev = this.applied
    if (!prev || prev.timeOfDay !== settings.timeOfDay) this.sky.setTimeOfDay(settings.timeOfDay)
    if (!prev || prev.latitude !== settings.latitude) this.sky.setLatitude(settings.latitude)
    if (!prev || prev.dayOfYear !== settings.dayOfYear) this.sky.setDayOfYear(settings.dayOfYear)
    if (!prev || prev.north !== settings.north) this.sky.setNorth(settings.north)
    if (!prev || prev.exposure !== settings.exposure) this.sky.setExposure(settings.exposure)
    if (!prev || prev.turbidity !== settings.turbidity) this.sky.setTurbidity(settings.turbidity)
    if (!prev || prev.groundAlbedo !== settings.groundAlbedo) this.sky.setGroundAlbedo(settings.groundAlbedo)
    if (!prev || prev.sunDisc !== settings.sunDisc || prev.sunAngularDiameter !== settings.sunAngularDiameter) {
      this.sky.setSunDisc({
        visible: settings.sunDisc,
        angularDiameter: degreesToRadians(settings.sunAngularDiameter),
      })
    }
    if (!prev || prev.mirrorBelowHorizon !== settings.mirrorBelowHorizon) this.sky.setMirrorBelowHorizon(settings.mirrorBelowHorizon)
    if (!prev || prev.sunIntensity !== settings.sunIntensity) this.sun.setIntensity(settings.sunIntensity)
    if (!prev || prev.sunShadow !== settings.sunShadow) this.sun.castShadow = settings.sunShadow
    if (!prev || fogChanged(prev, settings)) {
      this.sky.setFog({
        density: settings.fogDensity,
        heightFalloff: settings.fogHeightFalloff,
        baseHeight: settings.fogBaseHeight,
        maxOpacity: settings.fog ? settings.fogMaxOpacity : 0,
      })
    }
    this.fogTint.value.set(settings.fogColor)
    this.fogUseColor.value = settings.fogSkyColor ? 0 : 1
    this.syncMoon(settings)
    this.syncStars(settings.stars)
    this.applied = settings
    this.sky.update(camera)
    setSkyViewState({
      owns: true,
      fog: settings.fog,
      apply: settings.fog ? this.applyFogNode : null,
    })
  }

  dispose() {
    this.starToken += 1
    this.starsWanted = false
    if (this.starsReady) this.sky.disableStars()
    this.starsReady = false
    this.moon?.dispose()
    this.moon = null
    this.sun.dispose()
    this.sky.detach()
    this.sky.dispose()
    setSkyViewState({ owns: false, fog: false, apply: null })
  }

  private syncMoon(settings: SkySettings) {
    if (!settings.moon) {
      this.moon?.dispose()
      this.moon = null
      return
    }
    if (!this.moon) {
      this.moon = this.sky.createMoonlight({
        skyFill: false,
        castShadow: false,
        phase: settings.moonPhase,
        discAngularDiameter: degreesToRadians(settings.moonAngularDiameter),
      })
      lightUserLayers(this.moon.moon.light)
      this.moon.attach(this.scene)
      return
    }
    const prev = this.applied
    if (!prev || prev.moonPhase !== settings.moonPhase) this.moon.setPhase(settings.moonPhase)
    if (!prev || prev.moonAngularDiameter !== settings.moonAngularDiameter) {
      this.moon.moon.setDiscAngularDiameter(degreesToRadians(settings.moonAngularDiameter))
    }
  }

  private syncStars(enabled: boolean) {
    if (enabled === this.starsWanted && (!enabled || this.starsReady || this.starsPending)) return
    this.starsWanted = enabled
    this.starToken += 1
    if (!enabled) {
      if (this.starsReady) this.sky.disableStars()
      this.starsReady = false
      this.starsPending = false
      return
    }
    const token = this.starToken
    this.starsPending = true
    void this.sky.enableStars().then(() => {
      if (token !== this.starToken) {
        this.sky.disableStars()
        this.starsReady = false
        this.starsPending = false
        return
      }
      this.starsPending = false
      this.starsReady = true
    }).catch(error => {
      if (token === this.starToken) this.starsPending = false
      console.warn('[sky] 星空加载失败', error)
    })
  }
}

function degreesToRadians(degrees: number) {
  return degrees * Math.PI / 180
}

function fogChanged(prev: SkySettings, next: SkySettings) {
  return prev.fog !== next.fog
    || prev.fogDensity !== next.fogDensity
    || prev.fogHeightFalloff !== next.fogHeightFalloff
    || prev.fogBaseHeight !== next.fogBaseHeight
    || prev.fogMaxOpacity !== next.fogMaxOpacity
}

function lightUserLayers(light: { layers: { disableAll: () => void, enable: (channel: number) => void } }) {
  light.layers.disableAll()
  for (let bit = 0; bit < EDITOR_HELPER_LAYER; bit += 1) light.layers.enable(bit)
}

function configureShadow(light: SkySun['light']) {
  light.shadow.mapSize.set(2048, 2048)
  light.shadow.bias = -0.00015
  light.shadow.normalBias = 0.04
  const camera = light.shadow.camera
  if (camera instanceof OrthographicCamera) {
    camera.near = 0.5
    camera.far = 160
    camera.left = -40
    camera.right = 40
    camera.top = 40
    camera.bottom = -40
    camera.updateProjectionMatrix()
  }
}
