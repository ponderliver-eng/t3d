import { ChevronDown, ChevronRight } from 'lucide-react'
import { CardReset } from '../../editor/panels/CardReset'
import { useInspectorCardOpen } from '../../editor/panels/inspectorMemory'
import { useEditorStore } from '../../editor/scene/store'
import { useI18n } from '../../editor/i18n'
import { capabilityEnabled } from '../registry'
import { SKY_CAPABILITY_ID, defaultSkySettings, normalizeSkySettings, type SkyNorthSetting, type SkySettings } from './defaults'

export function SkyCard() {
  const { t } = useI18n()
  const enabled = useEditorStore(state => capabilityEnabled(state.capabilities, SKY_CAPABILITY_ID))
  const stored = useEditorStore(state => state.picture.capabilities?.[SKY_CAPABILITY_ID])
  const [open, setOpen] = useInspectorCardOpen('sky')
  if (!enabled) return null
  const sky = normalizeSkySettings(stored)
  const write = (patch: Partial<SkySettings>) => {
    const store = useEditorStore.getState()
    const picture = store.picture
    const current = normalizeSkySettings(picture.capabilities?.[SKY_CAPABILITY_ID])
    store.setPicture({
      capabilities: {
        ...picture.capabilities,
        [SKY_CAPABILITY_ID]: { ...current, ...patch },
      },
    })
  }
  const edit = (patch: Partial<SkySettings>) => {
    const store = useEditorStore.getState()
    store.beginGesture(t('sky.title'))
    write(patch)
    store.endGesture()
  }
  return (
    <section className="iv2-card iv2-card--wide">
      <header className="iv2-card__header" onClick={() => setOpen(!open)}>
        <span className="iv2-card__dot" style={{ background: '#4a9eff' }} />
        <span>{t('sky.title')}</span>
        <span className="iv2-card__actions" onClick={event => event.stopPropagation()}>
          <CardReset onReset={() => edit(defaultSkySettings())} />
        </span>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </header>
      {open && (
        <div className="iv2-card__body">
          <section className="iv2-section">
            <div className="iv2-section__title" style={{ color: '#4a9eff' }}><i /><span>{t('sky.time')}</span></div>
            <SkyNumber label={t('sky.time')} value={sky.timeOfDay} min={0} max={24} step={0.05} onChange={timeOfDay => write({ timeOfDay })} />
            <div className="iv2-pair">
              <SkyNumber label={t('sky.latitude')} value={sky.latitude} min={-90} max={90} step={0.5} onChange={latitude => write({ latitude })} />
              <SkyNumber label={t('sky.day')} value={sky.dayOfYear} min={1} max={365} step={1} onChange={dayOfYear => write({ dayOfYear })} />
            </div>
            <label className="field">
              <span>{t('sky.north')}</span>
              <select value={sky.north} onChange={event => edit({ north: event.target.value as SkyNorthSetting })}>
                <option value="+Z">{t('sky.northPosZ')}</option>
                <option value="-Z">{t('sky.northNegZ')}</option>
                <option value="+X">{t('sky.northPosX')}</option>
                <option value="-X">{t('sky.northNegX')}</option>
              </select>
            </label>
          </section>
          <section className="iv2-section">
            <div className="iv2-section__title" style={{ color: '#8ec5ff' }}><i /><span>{t('sky.atmosphere')}</span></div>
            <SkyNumber label={t('sky.exposure')} value={sky.exposure} min={0} max={80} step={0.1} onChange={exposure => write({ exposure })} />
            <div className="iv2-pair">
              <SkyNumber label={t('sky.turbidity')} value={sky.turbidity} min={0} max={8} step={0.05} onChange={turbidity => write({ turbidity })} />
              <SkyNumber label={t('sky.albedo')} value={sky.groundAlbedo} min={0} max={1} step={0.01} onChange={groundAlbedo => write({ groundAlbedo })} />
            </div>
            <Check label={t('sky.mirror')} checked={sky.mirrorBelowHorizon} onChange={mirrorBelowHorizon => edit({ mirrorBelowHorizon })} />
            <Check label={t('sky.haze')} checked={sky.haze} onChange={haze => edit({ haze })} />
            {sky.haze && (
              <SkyNumber label={t('sky.hazeStrength')} value={sky.hazeStrength} min={0} max={2} step={0.05} onChange={hazeStrength => write({ hazeStrength })} />
            )}
          </section>
          <section className="iv2-section">
            <div className="iv2-section__title" style={{ color: '#ffd36b' }}><i /><span>{t('sky.sun')}</span></div>
            <Check label={t('sky.sunDisc')} checked={sky.sunDisc} onChange={sunDisc => edit({ sunDisc })} />
            <SkyNumber label={t('sky.angularSize')} value={sky.sunAngularDiameter} min={0.05} max={8} step={0.01} onChange={sunAngularDiameter => write({ sunAngularDiameter })} />
            <SkyNumber label={t('sky.sunIntensity')} value={sky.sunIntensity} min={0} max={2} step={0.01} onChange={sunIntensity => write({ sunIntensity })} />
            <Check label={t('sky.sunShadow')} checked={sky.sunShadow} onChange={sunShadow => edit({ sunShadow })} />
          </section>
          <section className="iv2-section">
            <div className="iv2-section__title" style={{ color: '#90a4ae' }}><i /><span>{t('sky.fog')}</span></div>
            <Check label={t('sky.fog')} checked={sky.fog} onChange={fog => edit({ fog })} />
            {sky.fog && (
              <>
                <Check label={t('sky.fogSkyColor')} checked={sky.fogSkyColor} onChange={fogSkyColor => edit({ fogSkyColor })} />
                {!sky.fogSkyColor && (
                  <SkyColor label={t('sky.fogColor')} value={sky.fogColor} onChange={fogColor => write({ fogColor })} />
                )}
                <div className="iv2-pair">
                  <SkyNumber label={t('sky.fogDensity')} value={sky.fogDensity} min={0} max={8} step={0.05} onChange={fogDensity => write({ fogDensity })} />
                  <SkyNumber label={t('sky.fogFalloff')} value={sky.fogHeightFalloff} min={10} max={4000} step={10} onChange={fogHeightFalloff => write({ fogHeightFalloff })} />
                  <SkyNumber label={t('sky.fogBase')} value={sky.fogBaseHeight} min={-200} max={2000} step={1} onChange={fogBaseHeight => write({ fogBaseHeight })} />
                  <SkyNumber label={t('sky.fogOpacity')} value={sky.fogMaxOpacity} min={0} max={1} step={0.01} onChange={fogMaxOpacity => write({ fogMaxOpacity })} />
                </div>
              </>
            )}
          </section>
          <section className="iv2-section">
            <div className="iv2-section__title" style={{ color: '#9fb4d8' }}><i /><span>{t('sky.night')}</span></div>
            <Check label={t('sky.stars')} checked={sky.stars} onChange={stars => edit({ stars })} />
            {sky.stars && (
              <div className="iv2-pair">
                <SkyNumber label={t('sky.starIntensity')} value={sky.starIntensity} min={0} max={4} step={0.05} onChange={starIntensity => write({ starIntensity })} />
                <SkyNumber label={t('sky.starSize')} value={sky.starSize} min={0.2} max={3} step={0.05} onChange={starSize => write({ starSize })} />
                <SkyNumber label={t('sky.milkyWay')} value={sky.milkyWay} min={0} max={2} step={0.05} onChange={milkyWay => write({ milkyWay })} />
              </div>
            )}
            <Check label={t('sky.moon')} checked={sky.moon} onChange={moon => edit({ moon })} />
            {sky.moon && (
              <div className="iv2-pair">
                <SkyNumber label={t('sky.angularSize')} value={sky.moonAngularDiameter} min={0.05} max={8} step={0.01} onChange={moonAngularDiameter => write({ moonAngularDiameter })} />
                <SkyNumber label={t('sky.moonPhase')} value={sky.moonPhase} min={0} max={1} step={0.01} onChange={moonPhase => write({ moonPhase })} />
                <SkyNumber label={t('sky.moonLight')} value={sky.moonLight} min={0} max={3} step={0.05} onChange={moonLight => write({ moonLight })} />
              </div>
            )}
          </section>
        </div>
      )}
    </section>
  )
}

function SkyColor({ label, value, onChange }: { label: string, value: string, onChange: (value: string) => void }) {
  const { t } = useI18n()
  const gesture = t('sky.title')
  const safe = /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#c9d6e6'
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="color"
        value={safe}
        onFocus={() => useEditorStore.getState().beginGesture(gesture)}
        onChange={event => onChange(event.target.value)}
        onBlur={() => useEditorStore.getState().endGesture()}
      />
    </label>
  )
}

function Check({ label, checked, onChange }: { label: string, checked: boolean, onChange: (value: boolean) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} />
    </label>
  )
}

function SkyNumber({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}) {
  const { t } = useI18n()
  const begin = () => useEditorStore.getState().beginGesture(t('sky.title'))
  const end = () => useEditorStore.getState().endGesture()
  return (
    <label className="field">
      <span>{label}</span>
      <span className="field__range">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={Math.min(max, Math.max(min, value))}
          onPointerDown={begin}
          onChange={event => onChange(Number(event.target.value))}
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
          onChange={event => {
            const next = Number(event.target.value)
            if (Number.isFinite(next)) onChange(next)
          }}
          onBlur={end}
        />
      </span>
    </label>
  )
}
