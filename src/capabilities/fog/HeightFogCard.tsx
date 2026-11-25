import { ChevronDown, ChevronRight } from 'lucide-react'
import { useI18n } from '../../editor/i18n'
import { CardReset } from '../../editor/panels/CardReset'
import { useInspectorCardOpen } from '../../editor/panels/inspectorMemory'
import { useEditorStore } from '../../editor/scene/store'
import { capabilityEnabled } from '../registry'
import {
  HEIGHT_FOG_CAPABILITY_ID,
  defaultHeightFogSettings,
  normalizeHeightFogSettings,
  type HeightFogSettings,
} from './defaults'

export function HeightFogCard() {
  const { t } = useI18n()
  const enabled = useEditorStore((state) => capabilityEnabled(state.capabilities, HEIGHT_FOG_CAPABILITY_ID))
  const stored = useEditorStore((state) => state.picture.capabilities?.[HEIGHT_FOG_CAPABILITY_ID])
  const [open, setOpen] = useInspectorCardOpen('height-fog')
  if (!enabled) return null

  const fog = normalizeHeightFogSettings(stored)
  const write = (patch: Partial<HeightFogSettings>) => {
    const store = useEditorStore.getState()
    const picture = store.picture
    const current = normalizeHeightFogSettings(picture.capabilities?.[HEIGHT_FOG_CAPABILITY_ID])
    store.setPicture({
      capabilities: {
        ...picture.capabilities,
        [HEIGHT_FOG_CAPABILITY_ID]: { ...current, ...patch },
      },
    })
  }
  const edit = (patch: Partial<HeightFogSettings>) => {
    const store = useEditorStore.getState()
    store.beginGesture(t('fog.title'))
    write(patch)
    store.endGesture()
  }

  return (
    <section className="iv2-card iv2-card--wide">
      <header className="iv2-card__header" onClick={() => setOpen(!open)}>
        <span className="iv2-card__dot" style={{ background: '#90a4ae' }} />
        <span>{t('fog.title')}</span>
        <span className="iv2-card__actions" onClick={(event) => event.stopPropagation()}>
          <CardReset onReset={() => edit(defaultHeightFogSettings())} />
        </span>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </header>
      {open && (
        <div className="iv2-card__body">
          <section className="iv2-section">
            <div className="iv2-section__title" style={{ color: '#90a4ae' }}>
              <i />
              <span>{t('fog.general')}</span>
            </div>
            <FogCheck label={t('inspector.enabled')} checked={fog.enabled} onChange={(val) => edit({ enabled: val })} />
            {fog.enabled && (
              <>
                <FogNumber
                  label={t('fog.opacity')}
                  value={fog.opacity}
                  min={0}
                  max={1}
                  step={0.01}
                  onChange={(opacity) => write({ opacity })}
                />
                <FogCheck
                  label={t('fog.affectSky')}
                  checked={fog.affectSky}
                  onChange={(affectSky) => edit({ affectSky })}
                />
              </>
            )}
          </section>

          {fog.enabled && (
            <>
              <section className="iv2-section">
                <div className="iv2-section__title" style={{ color: '#7dd3fc' }}>
                  <i />
                  <span>{t('fog.heightGroup')}</span>
                </div>
                <FogCheck
                  label={t('fog.heightEnabled')}
                  checked={fog.heightEnabled}
                  onChange={(heightEnabled) => edit({ heightEnabled })}
                />
                {fog.heightEnabled && (
                  <>
                    <FogColor
                      label={fog.heightGradient ? t('fog.heightBottomColor') : t('fog.heightColor')}
                      value={fog.heightColor}
                      onChange={(heightColor) => write({ heightColor })}
                    />
                    <FogCheck
                      label={t('fog.heightGradient')}
                      checked={fog.heightGradient}
                      onChange={(heightGradient) => edit({ heightGradient })}
                    />
                    {fog.heightGradient && (
                      <div className="iv2-pair">
                        <FogColor
                          label={t('fog.heightMidColor')}
                          value={fog.heightMidColor}
                          onChange={(heightMidColor) => write({ heightMidColor })}
                        />
                        <FogColor
                          label={t('fog.heightTopColor')}
                          value={fog.heightTopColor}
                          onChange={(heightTopColor) => write({ heightTopColor })}
                        />
                      </div>
                    )}
                    <div className="iv2-pair">
                      <FogNumber
                        label={t('fog.heightBase')}
                        value={fog.heightBase}
                        min={-200}
                        max={500}
                        step={0.05}
                        sliderMin={-10}
                        sliderMax={20}
                        onChange={(heightBase) => write({ heightBase })}
                      />
                      <FogNumber
                        label={t('fog.heightRange')}
                        value={fog.heightRange}
                        min={0.05}
                        max={500}
                        step={0.05}
                        sliderMin={0.05}
                        sliderMax={20}
                        onChange={(heightRange) => write({ heightRange })}
                      />
                      <FogNumber
                        label={t('fog.heightDensity')}
                        value={fog.heightDensity}
                        min={0}
                        max={1}
                        step={0.01}
                        onChange={(heightDensity) => write({ heightDensity })}
                      />
                      <FogNumber
                        label={t('fog.heightFalloff')}
                        value={fog.heightFalloff}
                        min={0.2}
                        max={4}
                        step={0.05}
                        onChange={(heightFalloff) => write({ heightFalloff })}
                      />
                    </div>
                    <FogCheck
                      label={t('fog.noiseEnabled')}
                      checked={fog.heightNoiseEnabled}
                      onChange={(heightNoiseEnabled) => edit({ heightNoiseEnabled })}
                    />
                    {fog.heightNoiseEnabled && (
                      <div className="iv2-pair">
                        <FogNumber
                          label={t('fog.noiseScale')}
                          value={fog.heightNoiseScale}
                          min={0.01}
                          max={5}
                          step={0.01}
                          sliderMin={0.02}
                          sliderMax={2}
                          onChange={(heightNoiseScale) => write({ heightNoiseScale })}
                        />
                        <FogNumber
                          label={t('fog.noiseIntensity')}
                          value={fog.heightNoiseIntensity}
                          min={0}
                          max={1}
                          step={0.01}
                          onChange={(heightNoiseIntensity) => write({ heightNoiseIntensity })}
                        />
                        <FogNumber
                          label={t('fog.noiseSpeed')}
                          value={fog.heightNoiseSpeed}
                          min={0}
                          max={3}
                          step={0.05}
                          onChange={(heightNoiseSpeed) => write({ heightNoiseSpeed })}
                        />
                      </div>
                    )}
                  </>
                )}
              </section>

              <section className="iv2-section">
                <div className="iv2-section__title" style={{ color: '#a5b4fc' }}>
                  <i />
                  <span>{t('fog.distanceGroup')}</span>
                </div>
                <FogCheck
                  label={t('fog.distanceEnabled')}
                  checked={fog.distanceEnabled}
                  onChange={(distanceEnabled) => edit({ distanceEnabled })}
                />
                {fog.distanceEnabled && (
                  <>
                    <div className="iv2-pair">
                      <FogColor
                        label={t('fog.distanceNearColor')}
                        value={fog.distanceNearColor}
                        onChange={(distanceNearColor) => write({ distanceNearColor })}
                      />
                      <FogColor
                        label={t('fog.distanceFarColor')}
                        value={fog.distanceFarColor}
                        onChange={(distanceFarColor) => write({ distanceFarColor })}
                      />
                    </div>
                    <div className="iv2-pair">
                      <FogNumber
                        label={t('fog.distanceStart')}
                        value={fog.distanceStart}
                        min={0}
                        max={2000}
                        step={0.25}
                        sliderMin={0}
                        sliderMax={100}
                        onChange={(distanceStart) => write({ distanceStart })}
                      />
                      <FogNumber
                        label={t('fog.distanceEnd')}
                        value={fog.distanceEnd}
                        min={0.5}
                        max={4000}
                        step={0.5}
                        sliderMin={1}
                        sliderMax={300}
                        onChange={(distanceEnd) => write({ distanceEnd })}
                      />
                      <FogNumber
                        label={t('fog.distanceTransition')}
                        value={fog.distanceTransition}
                        min={0}
                        max={2000}
                        step={0.25}
                        sliderMin={0}
                        sliderMax={100}
                        onChange={(distanceTransition) => write({ distanceTransition })}
                      />
                      <FogNumber
                        label={t('fog.distanceDensity')}
                        value={fog.distanceDensity}
                        min={0}
                        max={1}
                        step={0.01}
                        onChange={(distanceDensity) => write({ distanceDensity })}
                      />
                    </div>
                    <FogCheck
                      label={t('fog.noiseEnabled')}
                      checked={fog.distanceNoiseEnabled}
                      onChange={(distanceNoiseEnabled) => edit({ distanceNoiseEnabled })}
                    />
                    {fog.distanceNoiseEnabled && (
                      <div className="iv2-pair">
                        <FogNumber
                          label={t('fog.noiseScale')}
                          value={fog.distanceNoiseScale}
                          min={0.005}
                          max={5}
                          step={0.005}
                          sliderMin={0.01}
                          sliderMax={1}
                          onChange={(distanceNoiseScale) => write({ distanceNoiseScale })}
                        />
                        <FogNumber
                          label={t('fog.noiseIntensity')}
                          value={fog.distanceNoiseIntensity}
                          min={0}
                          max={1}
                          step={0.01}
                          onChange={(distanceNoiseIntensity) => write({ distanceNoiseIntensity })}
                        />
                        <FogNumber
                          label={t('fog.noiseSpeed')}
                          value={fog.distanceNoiseSpeed}
                          min={0}
                          max={3}
                          step={0.05}
                          onChange={(distanceNoiseSpeed) => write({ distanceNoiseSpeed })}
                        />
                      </div>
                    )}
                  </>
                )}
              </section>
            </>
          )}
        </div>
      )}
    </section>
  )
}

function FogColor({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const { t } = useI18n()
  const gesture = t('fog.title')
  const safe = /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#8fa8c8'
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

function FogCheck({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  )
}

function FogNumber({
  label,
  value,
  min,
  max,
  step,
  sliderMin,
  sliderMax,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  sliderMin?: number
  sliderMax?: number
  onChange: (value: number) => void
}) {
  const { t } = useI18n()
  const begin = () => useEditorStore.getState().beginGesture(t('fog.title'))
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
          value={Number.isFinite(value) ? Number(value.toFixed(3)) : 0}
          onFocus={begin}
          onChange={(event) => {
            const parsed = Number(event.target.value)
            if (Number.isFinite(parsed)) onChange(parsed)
          }}
          onBlur={end}
        />
      </span>
    </label>
  )
}
