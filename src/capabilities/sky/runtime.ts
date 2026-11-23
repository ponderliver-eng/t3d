import type { Camera, Scene } from 'three'
import { Color, OrthographicCamera } from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import { mix, uniform, vec4 } from 'three/tsl'
import { Sky, type SkyMoonlight, type SkyNight, type SkySun } from '@pmndrs/sky'
import { EDITOR_HELPER_LAYER } from '../../core/layers'
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
  private night: SkyNight | null = null
  private starLook: SkySettings | null = null
  private readonly fogTint = uniform(new Color('#c9d6e6'))
  private readonly fogUseColor = uniform(0)
  private hazeOn = false
  private fogOn = false
  private apKey = ''
  private apFrame = 0
  private apWarned = false
  private readonly applyFogNode = (colorNode: unknown, scenePass: unknown) => {
    let node = colorNode
    if (this.hazeOn && this.sky.aerialPerspectiveTexture) {
      this.sky.setHazePolicy('ap')
      node = this.sky.applyHaze(node, {
        scenePass,
        policy: 'ap',
        raymarchFallback: false,
        // 编辑器远平面只有两千米。不传这个的话，远处地面的深度会被当成天空，雾气在合成时被减掉。
        useCameraFar: true,
      })
    }
    if (!this.fogOn) return node
    const skyFog = this.sky.applyFog(node, { scenePass }) as { rgb: unknown, a: unknown }
    const amount = this.sky.applyFog(node, { scenePass, debugMode: 'fog-amount' }) as { r: unknown }
    const base = node as { rgb: unknown }
    const flat = mix(base.rgb as never, this.fogTint, amount.r as never)
    return vec4(mix(skyFog.rgb as never, flat, this.fogUseColor), skyFog.a as never)
  }

  constructor(renderer: WebGPURenderer, private readonly scene: Scene) {
    this.sky = new Sky(renderer, {
      preset: 'earth',
      sunColor: 'bruneton',
      enableAerialPerspective: true,
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

  hazeReady() {
    return Boolean(this.sky.aerialPerspectiveTexture)
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
    if (!prev || prev.hazeStrength !== settings.hazeStrength) this.sky.setHazeStrength(settings.hazeStrength)
    if (!prev || prev.hazeNear !== settings.hazeNear) this.sky.setAerialPerspectiveDistanceScale(settings.hazeNear)
    this.hazeOn = settings.haze
    this.fogOn = settings.fog
    this.syncMoon(settings)
    this.syncStars(settings)
    this.applied = settings
    this.sky.update(camera)
    this.applyCelestialFade(settings, prev)
    if (settings.haze && this.hazeReady()) {
      const e = camera.matrixWorld.elements
      const nextApKey = `${e[0].toFixed(3)},${e[4].toFixed(3)},${e[8].toFixed(3)},${e[12].toFixed(2)},${e[13].toFixed(2)},${e[14].toFixed(2)}|${settings.timeOfDay}|${settings.latitude}|${settings.dayOfYear}|${settings.north}|${settings.turbidity}|${settings.groundAlbedo}`
      if (nextApKey !== this.apKey) {
        this.apKey = nextApKey
        this.scheduleAerialPerspective()
      }
    } else {
      this.apKey = ''
    }
    const atmosphere = settings.fog || settings.haze
    setSkyViewState({
      owns: true,
      fog: atmosphere,
      apply: atmosphere ? this.applyFogNode : null,
      signature: `${settings.haze ? 1 : 0}${settings.fog ? 1 : 0}`,
    })
  }

  private scheduleAerialPerspective() {
    if (this.apFrame) return
    this.apFrame = requestAnimationFrame(() => {
      this.apFrame = 0
      void this.sky.updateAerialPerspective().catch((error: unknown) => {
        if (this.apWarned) return
        this.apWarned = true
        console.warn('[sky] 大气透视更新失败', error)
      })
    })
  }

  dispose() {
    if (this.apFrame) cancelAnimationFrame(this.apFrame)
    this.apFrame = 0
    this.starToken += 1
    this.starsWanted = false
    if (this.starsReady) this.sky.disableStars()
    this.starsReady = false
    this.night = null
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
      this.moon.setIntensity(settings.moonLight)
      this.moon.moon.setDiscIntensity(3)
      return
    }
    const prev = this.applied
    if (!prev || prev.moonLight !== settings.moonLight) this.moon.setIntensity(settings.moonLight)
    if (!prev || prev.moonPhase !== settings.moonPhase) this.moon.setPhase(settings.moonPhase)
    if (!prev || prev.moonAngularDiameter !== settings.moonAngularDiameter) {
      this.moon.moon.setDiscAngularDiameter(degreesToRadians(settings.moonAngularDiameter))
    }
    this.moon.moon.setDiscIntensity(3)
  }

  private syncStars(settings: SkySettings) {
    const enabled = settings.stars
    if (enabled) this.starLook = settings
    if (enabled === this.starsWanted && (!enabled || this.starsReady || this.starsPending)) {
      if (enabled && this.night) this.applyStarLook(settings)
      return
    }
    this.starsWanted = enabled
    this.starToken += 1
    if (!enabled) {
      if (this.starsReady) this.sky.disableStars()
      this.starsReady = false
      this.starsPending = false
      this.night = null
      return
    }
    const token = this.starToken
    this.starsPending = true
    void this.sky.enableStars({
      intensity: settings.starIntensity,
      size: settings.starSize,
      milkyWay: settings.milkyWay,
    }).then(night => {
      if (token !== this.starToken) {
        this.sky.disableStars()
        this.starsReady = false
        this.starsPending = false
        this.night = null
        return
      }
      this.night = night
      this.starsPending = false
      this.starsReady = true
      if (this.starLook) this.applyStarLook(this.starLook, true)
    }).catch(error => {
      if (token === this.starToken) this.starsPending = false
      console.warn('[sky] 星空加载失败', error)
    })
  }

  private applyStarLook(settings: SkySettings, force = false) {
    const night = this.night
    if (!night) return
    const prev = force ? null : this.applied
    if (!prev || prev.starIntensity !== settings.starIntensity) night.setIntensity(settings.starIntensity)
    if (!prev || prev.starSize !== settings.starSize) night.setSize(settings.starSize)
    if (!prev || prev.milkyWay !== settings.milkyWay) night.setMilkyWay(settings.milkyWay)
    this.applyStarContrast(settings, prev)
  }

  /**
   * 星星按天空亮度淡出，和夜空示例一样。
   * 库的阈值按曝光 40 调过。这里曝光低得多，要按同样比例放大，否则白天也看得见。
   * 月面不要再乘太阳高度：那会在白天把月盘亮度写成 0。月亮跟着月相转到地平线以下时，本来就看不到。
   */
  private applyCelestialFade(settings: SkySettings, prev: SkySettings | null) {
    this.applyStarContrast(settings, prev)
  }

  private applyStarContrast(settings: SkySettings, prev: SkySettings | null) {
    const night = this.night
    if (!night || (prev && prev.exposure === settings.exposure)) return
    const scale = 40 / Math.max(settings.exposure, 0.05)
    night.setContrast(40 * scale)
    night.setMilkyWayContrast(20 * scale)
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
