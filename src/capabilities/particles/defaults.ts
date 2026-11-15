import type { NodeEffect } from '../../editor/scene/types'

/** 与 package.json 里钉住的 three.quarks 版本一致。升级库时一起改。 */
export const QUARKS_VERSION = '0.17.1'

/** 菜单创建的特效：锥形火焰，公告板，叠加。外观不写在模拟里。 */
export const DEFAULT_SIMULATION = {
  format: 'system',
  body: {
    version: '3.0',
    autoDestroy: false,
    looping: true,
    prewarm: false,
    duration: 1.2,
    shape: { type: 'cone', radius: 0.05, arc: 6.283185307179586, thickness: 1, angle: 0.35, mode: 0, spread: 0, speed: { type: 'ConstantValue', value: 1 } },
    startLife: { type: 'IntervalValue', a: 0.4, b: 0.9 },
    startSpeed: { type: 'IntervalValue', a: 0.6, b: 1.8 },
    startRotation: { type: 'ConstantValue', value: 0 },
    startSize: { type: 'IntervalValue', a: 0.08, b: 0.22 },
    startColor: { type: 'ConstantColor', color: { r: 1, g: 0.55, b: 0.15, a: 1 } },
    emissionOverTime: { type: 'ConstantValue', value: 36 },
    emissionOverDistance: { type: 'ConstantValue', value: 0 },
    emissionBursts: [],
    onlyUsedByOther: false,
    renderOrder: 0,
    renderMode: 0,
    rendererEmitterSettings: {},
    layers: 1,
    startTileIndex: { type: 'ConstantValue', value: 0 },
    uTileCount: 1,
    vTileCount: 1,
    blendTiles: false,
    softParticles: false,
    softFarFade: 0,
    softNearFade: 0,
    behaviors: [
      {
        type: 'ColorOverLife',
        color: {
          type: 'Gradient',
          color: { type: 'CLinearFunction', subType: 'Color', keys: [{ value: { r: 1, g: 0.7, b: 0.2 }, pos: 0 }, { value: { r: 1, g: 0.2, b: 0 }, pos: 1 }] },
          alpha: { type: 'CLinearFunction', subType: 'Number', keys: [{ value: 1, pos: 0 }, { value: 0, pos: 1 }] },
        },
      },
      { type: 'SizeOverLife', size: { type: 'PiecewiseBezier', functions: [{ function: { p0: 0.4, p1: 0.7, p2: 1, p3: 0 }, start: 0 }] } },
    ],
    worldSpace: false,
  },
} as const

export function defaultNodeEffect(): NodeEffect {
  return {
    assetId: null,
    quarksVersion: QUARKS_VERSION,
    simulation: structuredClone(DEFAULT_SIMULATION),
    materialAssetId: null,
    playing: true,
  }
}
