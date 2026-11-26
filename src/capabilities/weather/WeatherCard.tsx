import { useEffect, useRef } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useI18n } from '../../editor/i18n'
import { CardReset } from '../../editor/panels/CardReset'
import { useInspectorCardOpen } from '../../editor/panels/inspectorMemory'
import { useEditorStore } from '../../editor/scene/store'
import { capabilityEnabled } from '../registry'
import {
  WEATHER_CAPABILITY_ID,
  defaultWeatherSettings,
  normalizeWeatherSettings,
  weatherPresetPatch,
  type PrecipitationType,
  type WeatherPreset,
  type WeatherSettings,
} from './defaults'

const PRESET_LIST: Array<Exclude<WeatherPreset, 'custom'>> = ['clear', 'cloudy', 'rain', 'storm', 'snow', 'sandstorm']

export function WeatherCard() {
  const { t } = useI18n()
  const enabled = useEditorStore((state) => capabilityEnabled(state.capabilities, WEATHER_CAPABILITY_ID))
  const stored = useEditorStore((state) => state.picture.capabilities?.[WEATHER_CAPABILITY_ID])
  const [open, setOpen] = useInspectorCardOpen('weather')
  const weather = normalizeWeatherSettings(stored)
  const wetnessActive = Boolean(enabled && weather.enabled && weather.wetnessEnabled)
  const prevWetnessRef = useRef<boolean | null>(null)

  useEffect(() => {
    if (prevWetnessRef.current === wetnessActive) return
    prevWetnessRef.current = wetnessActive
    const store = useEditorStore.getState()
    if (wetnessActive && !store.picture.ssr) {
      store.setPicture({ ssr: true })
    }
  }, [wetnessActive])

  if (!enabled) return null

  const write = (patch: Partial<WeatherSettings>, keepPreset = false) => {
    const store = useEditorStore.getState()
    const picture = store.picture
    const current = normalizeWeatherSettings(picture.capabilities?.[WEATHER_CAPABILITY_ID])
    const next: WeatherSettings = {
      ...current,
      ...patch,
      ...(!keepPreset && !('preset' in patch) ? { preset: 'custom' } : {}),
    }
    const syncSsr = 'wetnessEnabled' in patch || 'enabled' in patch || 'preset' in patch
    const nextWet = Boolean(next.enabled && next.wetnessEnabled)
    if (syncSsr) prevWetnessRef.current = nextWet
    store.setPicture({
      ...(syncSsr ? { ssr: nextWet } : {}),
      capabilities: {
        ...picture.capabilities,
        [WEATHER_CAPABILITY_ID]: next,
      },
    })
  }

  const edit = (patch: Partial<WeatherSettings>, keepPreset = false) => {
    const store = useEditorStore.getState()
    store.beginGesture(t('weather.title'))
    write(patch, keepPreset)
    store.endGesture()
  }

  return (
    <section className="iv2-card iv2-card--wide">
      <header className="iv2-card__header" onClick={() => setOpen(!open)}>
        <span className="iv2-card__dot" style={{ background: '#60a5fa' }} />
        <span>{t('weather.title')}</span>
        <span className="iv2-card__actions" onClick={(event) => event.stopPropagation()}>
          <CardReset onReset={() => edit(defaultWeatherSettings(), true)} />
        </span>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </header>
      {open && (
        <div className="iv2-card__body">
          <section className="iv2-section">
            <div className="iv2-section__title" style={{ color: '#60a5fa' }}>
              <i />
              <span>{t('weather.general')}</span>
            </div>
            <WeatherCheck label={t('inspector.enabled')} checked={weather.enabled} onChange={(val) => edit({ enabled: val }, true)} />
            {weather.enabled && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                {PRESET_LIST.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className={weather.preset === preset ? 'btn btn--accent' : 'btn'}
                    style={{ fontSize: 11, padding: '2px 7px' }}
                    onClick={() => edit(weatherPresetPatch(preset), true)}
                  >
                    {t(`weather.preset.${preset}`)}
                  </button>
                ))}
              </div>
            )}
          </section>

          {weather.enabled && (
            <>
              <section className="iv2-section">
                <div className="iv2-section__title" style={{ color: '#93c5fd' }}>
                  <i />
                  <span>{t('weather.cloudsGroup')}</span>
                </div>
                <WeatherCheck label={t('weather.cloudsEnabled')} checked={weather.cloudsEnabled} onChange={(val) => edit({ cloudsEnabled: val })} />
                {weather.cloudsEnabled && (
                  <>
                    <WeatherCheck label={t('weather.lowCloudsEnabled')} checked={weather.lowCloudsEnabled} onChange={(val) => edit({ lowCloudsEnabled: val })} />
                    <WeatherCheck label={t('weather.midCloudsEnabled')} checked={weather.midCloudsEnabled} onChange={(val) => edit({ midCloudsEnabled: val })} />
                    <WeatherCheck label={t('weather.highCloudsEnabled')} checked={weather.highCloudsEnabled} onChange={(val) => edit({ highCloudsEnabled: val, cirrusEnabled: val })} />
                    {weather.highCloudsEnabled && (
                      <WeatherNumber label={t('weather.cirrusCoverage')} value={weather.cirrusCoverage} min={0} max={1} step={0.01} onChange={(cirrusCoverage) => write({ cirrusCoverage })} />
                    )}
                    <div className="iv2-pair">
                      <WeatherNumber label={t('weather.cloudCoverage')} value={weather.cloudCoverage} min={0} max={1} step={0.01} onChange={(cloudCoverage) => write({ cloudCoverage })} />
                      <WeatherNumber label={t('weather.cloudDensity')} value={weather.cloudDensity} min={0} max={2} step={0.02} onChange={(cloudDensity) => write({ cloudDensity })} />
                    </div>
                    <div className="iv2-pair">
                      <WeatherNumber label={t('weather.cloudAltitude')} value={weather.cloudAltitude} min={100} max={3000} sliderMin={200} sliderMax={1500} step={10} onChange={(cloudAltitude) => write({ cloudAltitude })} />
                      <WeatherNumber label={t('weather.cloudScale')} value={weather.cloudScale} min={0.2} max={4} step={0.05} onChange={(cloudScale) => write({ cloudScale })} />
                    </div>
                    <div className="iv2-pair">
                      <WeatherNumber label={t('weather.cloudWindSpeed')} value={weather.cloudWindSpeed} min={0} max={30} step={0.2} onChange={(cloudWindSpeed) => write({ cloudWindSpeed })} />
                      <WeatherNumber label={t('weather.cloudWindAngle')} value={weather.cloudWindAngle} min={0} max={360} step={1} onChange={(cloudWindAngle) => write({ cloudWindAngle })} />
                    </div>
                    <div className="iv2-pair">
                      <WeatherNumber label={t('weather.cloudSilverLining')} value={weather.cloudSilverLining} min={0} max={2} step={0.05} onChange={(cloudSilverLining) => write({ cloudSilverLining })} />
                      <WeatherNumber label={t('weather.cloudShadowStrength')} value={weather.cloudShadowStrength} min={0} max={1} step={0.02} onChange={(cloudShadowStrength) => write({ cloudShadowStrength })} />
                    </div>
                    <WeatherColor label={t('weather.cloudTint')} value={weather.cloudTint} onChange={(cloudTint) => write({ cloudTint })} />
                  </>
                )}
              </section>

              <section className="iv2-section">
                <div className="iv2-section__title" style={{ color: '#7dd3fc' }}>
                  <i />
                  <span>{t('weather.precipGroup')}</span>
                </div>
                <label className="field">
                  <span>{t('weather.precipType')}</span>
                  <select
                    value={weather.precipitationType}
                    onChange={(event) => edit({ precipitationType: event.target.value as PrecipitationType })}
                  >
                    <option value="none">{t('weather.precip.none')}</option>
                    <option value="rain">{t('weather.precip.rain')}</option>
                    <option value="snow">{t('weather.precip.snow')}</option>
                    <option value="sand">{t('weather.precip.sand')}</option>
                  </select>
                </label>
                {weather.precipitationType !== 'none' && (
                  <>
                    <div className="iv2-pair">
                      <WeatherNumber label={t('weather.precipIntensity')} value={weather.precipitationIntensity} min={0} max={1} step={0.01} onChange={(precipitationIntensity) => write({ precipitationIntensity })} />
                      <WeatherNumber label={t('weather.precipSpeed')} value={weather.precipitationSpeed} min={0.2} max={3} step={0.05} onChange={(precipitationSpeed) => write({ precipitationSpeed })} />
                    </div>
                    <div className="iv2-pair">
                      <WeatherNumber label={t('weather.precipWind')} value={weather.precipitationWind} min={0} max={20} step={0.2} onChange={(precipitationWind) => write({ precipitationWind })} />
                      <WeatherNumber label={t('weather.precipBoxSize')} value={weather.precipitationBoxSize} min={12} max={60} step={1} onChange={(precipitationBoxSize) => write({ precipitationBoxSize })} />
                    </div>
                    {weather.precipitationType === 'rain' && (
                      <>
                        <div className="iv2-pair">
                          <WeatherNumber label={t('weather.rainStreakLength')} value={weather.rainStreakLength} min={0.05} max={1} step={0.01} onChange={(rainStreakLength) => write({ rainStreakLength })} />
                          <WeatherNumber label={t('weather.rainStreakIntensity')} value={weather.rainStreakIntensity} min={0.2} max={3} step={0.05} onChange={(rainStreakIntensity) => write({ rainStreakIntensity })} />
                        </div>
                        <WeatherCheck label={t('weather.rainRefractionEnabled')} checked={weather.rainRefractionEnabled} onChange={(val) => edit({ rainRefractionEnabled: val })} />
                      </>
                    )}
                    {weather.precipitationType === 'snow' && (
                      <div className="iv2-pair">
                        <WeatherNumber label={t('weather.snowParticleSize')} value={weather.snowParticleSize} min={0.05} max={2} step={0.05} onChange={(snowParticleSize) => write({ snowParticleSize })} />
                        <WeatherNumber label={t('weather.snowSway')} value={weather.snowSway} min={0} max={3} step={0.05} onChange={(snowSway) => write({ snowSway })} />
                      </div>
                    )}
                    {weather.precipitationType === 'sand' && (
                      <WeatherNumber label={t('weather.sandstormHaze')} value={weather.sandstormHaze} min={0} max={1} step={0.02} onChange={(sandstormHaze) => write({ sandstormHaze })} />
                    )}
                    <WeatherColor label={t('weather.precipColor')} value={weather.precipitationColor} onChange={(precipitationColor) => write({ precipitationColor })} />
                  </>
                )}
              </section>

              <section className="iv2-section">
                <div className="iv2-section__title" style={{ color: '#38bdf8' }}>
                  <i />
                  <span>{t('weather.surfaceGroup')}</span>
                </div>
                <WeatherCheck label={t('weather.wetnessEnabled')} checked={weather.wetnessEnabled} onChange={(val) => edit({ wetnessEnabled: val })} />
                {weather.wetnessEnabled && (
                  <>
                    <div className="iv2-pair">
                      <WeatherNumber label={t('weather.wetness')} value={weather.wetness} min={0} max={1} step={0.01} onChange={(wetness) => write({ wetness })} />
                      <WeatherNumber label={t('weather.puddleAmount')} value={weather.puddleAmount} min={0} max={1} step={0.01} onChange={(puddleAmount) => write({ puddleAmount })} />
                    </div>
                    <WeatherCheck label={t('weather.ripplesEnabled')} checked={weather.ripplesEnabled} onChange={(val) => edit({ ripplesEnabled: val })} />
                    {weather.ripplesEnabled && (
                      <div className="iv2-pair">
                        <WeatherNumber label={t('weather.rippleDensity')} value={weather.rippleDensity} min={0.05} max={1} step={0.01} onChange={(rippleDensity) => write({ rippleDensity })} />
                        <WeatherNumber label={t('weather.rippleIntensity')} value={weather.rippleIntensity} min={0} max={2} step={0.05} onChange={(rippleIntensity) => write({ rippleIntensity })} />
                      </div>
                    )}
                    <WeatherCheck label={t('weather.rainDripsEnabled')} checked={weather.rainDripsEnabled} onChange={(val) => edit({ rainDripsEnabled: val })} />
                    {weather.rainDripsEnabled && (
                      <>
                        <div className="iv2-pair">
                          <WeatherNumber label={t('weather.rainDripsDensity')} value={weather.rainDripsDensity} min={0.05} max={3} step={0.05} onChange={(rainDripsDensity) => write({ rainDripsDensity })} />
                          <WeatherNumber label={t('weather.rainDripsIntensity')} value={weather.rainDripsIntensity} min={0} max={2} step={0.05} onChange={(rainDripsIntensity) => write({ rainDripsIntensity })} />
                        </div>
                        <div className="iv2-pair">
                          <WeatherNumber label={t('weather.rainDripsScale')} value={weather.rainDripsScale} min={0.3} max={2.5} step={0.05} onChange={(rainDripsScale) => write({ rainDripsScale })} />
                          <WeatherNumber label={t('weather.rainDripsSpeed')} value={weather.rainDripsSpeed} min={0.2} max={3} step={0.05} onChange={(rainDripsSpeed) => write({ rainDripsSpeed })} />
                        </div>
                      </>
                    )}
                  </>
                )}
                <WeatherCheck label={t('weather.snowCoverEnabled')} checked={weather.snowCoverEnabled} onChange={(val) => edit({ snowCoverEnabled: val })} />
                {weather.snowCoverEnabled && (
                  <>
                    <WeatherNumber label={t('weather.snowCover')} value={weather.snowCover} min={0} max={1} step={0.01} onChange={(snowCover) => write({ snowCover })} />
                    <WeatherColor label={t('weather.snowColor')} value={weather.snowColor} onChange={(snowColor) => write({ snowColor })} />
                  </>
                )}
              </section>

              <section className="iv2-section">
                <div className="iv2-section__title" style={{ color: '#facc15' }}>
                  <i />
                  <span>{t('weather.lightningGroup')}</span>
                </div>
                <WeatherCheck label={t('weather.lightningEnabled')} checked={weather.lightningEnabled} onChange={(val) => edit({ lightningEnabled: val })} />
                {weather.lightningEnabled && (
                  <div className="iv2-pair">
                    <WeatherNumber label={t('weather.lightningFrequency')} value={weather.lightningFrequency} min={0.1} max={2} step={0.05} onChange={(lightningFrequency) => write({ lightningFrequency })} />
                    <WeatherNumber label={t('weather.lightningIntensity')} value={weather.lightningIntensity} min={0.5} max={5} step={0.1} onChange={(lightningIntensity) => write({ lightningIntensity })} />
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      )}
    </section>
  )
}

function WeatherColor({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const { t } = useI18n()
  const gesture = t('weather.title')
  const safe = /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#ffffff'
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="color"
        value={safe}
        onFocus={() => useEditorStore.getState().beginGesture(gesture)}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => useEditorStore.getState().endGesture()}
      />
    </label>
  )
}

function WeatherCheck({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  )
}

function WeatherNumber({
  label,
  value,
  min,
  max,
  sliderMin,
  sliderMax,
  step,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  sliderMin?: number
  sliderMax?: number
  step: number
  onChange: (value: number) => void
}) {
  const { t } = useI18n()
  const begin = () => useEditorStore.getState().beginGesture(t('weather.title'))
  const end = () => useEditorStore.getState().endGesture()
  const sMin = sliderMin ?? min
  const sMax = sliderMax ?? max
  return (
    <label className="field">
      <span>{label}</span>
      <span className="field__range">
        <input
          type="range"
          min={sMin}
          max={sMax}
          step={step}
          value={Math.min(sMax, Math.max(sMin, value))}
          onPointerDown={begin}
          onChange={(event) => onChange(Number(event.target.value))}
          onPointerUp={end}
          onBlur={end}
        />
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={Number.isFinite(value) ? value : 0}
          onFocus={begin}
          onChange={(event) => {
            const next = Number(event.target.value)
            if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)))
          }}
          onBlur={end}
        />
      </span>
    </label>
  )
}
