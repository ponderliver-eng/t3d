import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react'
import { useI18n } from '../../editor/i18n'
import { CardReset } from '../../editor/panels/CardReset'
import { useInspectorCardOpen } from '../../editor/panels/inspectorMemory'
import { useEditorStore } from '../../editor/scene/store'
import type { SceneNode } from '../../editor/scene/types'
import { capabilityEnabled } from '../registry'
import {
  WATER_CAPABILITY_ID,
  WATER_QUALITY_PRESETS,
  WATER_STYLE_PRESETS,
  defaultWater,
  normalizeWater,
  type WaterPresetId,
  type WaterQuality,
  type WaterSpec,
} from './defaults'

const STYLE_KEYS: WaterPresetId[] = ['tropical', 'ocean', 'lake', 'pool', 'stylized']
const QUALITY_KEYS: WaterQuality[] = ['fast', 'balanced', 'ultra']

export function WaterCard({ node, disabled }: { node: SceneNode, disabled: boolean }) {
  const { t } = useI18n()
  const capEnabled = useEditorStore(state => capabilityEnabled(state.capabilities, WATER_CAPABILITY_ID))
  const [open, setOpen] = useInspectorCardOpen('water')
  const raw = node.capabilities?.[WATER_CAPABILITY_ID]
  if (!capEnabled || !raw || (node.kind !== 'empty' && node.kind !== 'plane' && node.kind !== 'model')) return null
  const spec = normalizeWater(raw)

  const commit = (next: WaterSpec | null) => {
    const store = useEditorStore.getState()
    store.beginGesture(t('water.title'))
    const capabilities = { ...(node.capabilities ?? {}) }
    if (next) capabilities[WATER_CAPABILITY_ID] = next
    else delete capabilities[WATER_CAPABILITY_ID]
    store.updateNode(node.id, {
      capabilities: Object.keys(capabilities).length > 0 ? capabilities : null,
    })
    store.endGesture()
  }

  const write = (patch: Partial<WaterSpec>) => {
    commit({ ...spec, ...patch })
  }

  const applyPreset = (preset: WaterPresetId) => {
    const style = WATER_STYLE_PRESETS[preset]
    write({
      enabled: true,
      preset,
      ...style,
      waveHeight: spec.quality === 'fast' ? 0 : style.waveHeight,
    })
  }

  const applyQuality = (quality: WaterQuality) => {
    const qual = WATER_QUALITY_PRESETS[quality]
    const style = WATER_STYLE_PRESETS[spec.preset]
    write({
      quality,
      reflectionScale: qual.reflectionScale,
      waveHeight: quality === 'fast' ? 0 : style.waveHeight,
    })
  }

  return (
    <section className="iv2-card iv2-card--wide">
      <header className="iv2-card__header" onClick={() => setOpen(!open)}>
        <span className="iv2-card__dot" style={{ background: '#38bdf8' }} />
        <span>{t('water.title')}</span>
        <span className="iv2-card__actions" onClick={event => event.stopPropagation()}>
          <CardReset disabled={disabled} onReset={() => commit({ ...defaultWater(), enabled: true })} />
          <button
            type="button"
            className="iv2-card__remove"
            title={t('component.remove')}
            disabled={disabled}
            onClick={() => commit(null)}
          >
            <Trash2 size={12} />
          </button>
        </span>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </header>
      {open && (
        <div className="iv2-card__body">
          <section className="iv2-section">
            <label className="field field--check">
              <span>{t('water.enable')}</span>
              <input type="checkbox" checked={spec.enabled} disabled={disabled} onChange={event => write({ enabled: event.target.checked })} />
            </label>
            <label className="field">
              <span>{t('water.style')}</span>
              <select value={spec.preset} disabled={disabled} onChange={event => applyPreset(event.target.value as WaterPresetId)}>
                {STYLE_KEYS.map(key => <option key={key} value={key}>{t(`water.preset.${key}` as 'water.title')}</option>)}
              </select>
            </label>
            <label className="field">
              <span>{t('water.quality')}</span>
              <select value={spec.quality} disabled={disabled} onChange={event => applyQuality(event.target.value as WaterQuality)}>
                {QUALITY_KEYS.map(key => <option key={key} value={key}>{t(`water.quality.${key}` as 'water.title')}</option>)}
              </select>
            </label>
          </section>

          <section className="iv2-section">
            <div className="iv2-section__title" style={{ color: '#38bdf8' }}><i /><span>{t('water.groupColor')}</span></div>
            <label className="field">
              <span>{t('water.shallow')}</span>
              <input type="color" value={spec.shallowColor} disabled={disabled} onChange={event => write({ shallowColor: event.target.value })} />
            </label>
            <label className="field">
              <span>{t('water.deep')}</span>
              <input type="color" value={spec.deepColor} disabled={disabled} onChange={event => write({ deepColor: event.target.value })} />
            </label>
            <RangeField label={t('water.absorption')} value={spec.depthAbsorption} min={0.2} max={15} step={0.1} disabled={disabled} onChange={depthAbsorption => write({ depthAbsorption })} />
            <RangeField label={t('water.opacity')} value={spec.opacity} min={0.05} max={1} step={0.02} disabled={disabled} onChange={opacity => write({ opacity })} />
          </section>

          <section className="iv2-section">
            <div className="iv2-section__title" style={{ color: '#38bdf8' }}><i /><span>{t('water.groupWaves')}</span></div>
            <RangeField label={t('water.waveScale')} value={spec.waveScale} min={0.04} max={2} step={0.02} disabled={disabled} onChange={waveScale => write({ waveScale })} />
            <RangeField label={t('water.flowSpeed')} value={spec.flowSpeed} min={0} max={3} step={0.05} disabled={disabled} onChange={flowSpeed => write({ flowSpeed })} />
            <RangeField label={t('water.normalScale')} value={spec.normalScale} min={0} max={2} step={0.05} disabled={disabled} onChange={normalScale => write({ normalScale })} />
            <RangeField label={t('water.waveHeight')} value={spec.waveHeight} min={0} max={0.8} step={0.01} disabled={disabled} onChange={waveHeight => write({ waveHeight })} />
          </section>

          <section className="iv2-section">
            <div className="iv2-section__title" style={{ color: '#38bdf8' }}><i /><span>{t('water.groupOptics')}</span></div>
            <RangeField label={t('water.reflectivity')} value={spec.reflectivity} min={0} max={1} step={0.02} disabled={disabled} onChange={reflectivity => write({ reflectivity })} />
            <RangeField label={t('water.specular')} value={spec.specularStrength} min={0} max={4} step={0.05} disabled={disabled} onChange={specularStrength => write({ specularStrength })} />
            <RangeField label={t('water.specularSize')} value={spec.specularSize} min={0.02} max={1} step={0.02} disabled={disabled} onChange={specularSize => write({ specularSize })} />
            <RangeField label={t('water.sss')} value={spec.sssStrength} min={0} max={2} step={0.05} disabled={disabled} onChange={sssStrength => write({ sssStrength })} />
            <RangeField label={t('water.foamWidth')} value={spec.foamWidth} min={0} max={2} step={0.05} disabled={disabled} onChange={foamWidth => write({ foamWidth })} />
            <RangeField label={t('water.foamIntensity')} value={spec.foamIntensity} min={0} max={2} step={0.05} disabled={disabled} onChange={foamIntensity => write({ foamIntensity })} />
            <RangeField label={t('water.crestFoam')} value={spec.crestFoam} min={0} max={2} step={0.05} disabled={disabled} onChange={crestFoam => write({ crestFoam })} />
          </section>
        </div>
      )}
    </section>
  )
}

function RangeField({
  label,
  value,
  min,
  max,
  step,
  disabled,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  disabled: boolean
  onChange: (value: number) => void
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
        <input
          type="range"
          style={{ flex: 1, minWidth: 0 }}
          value={value}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={event => onChange(Number(event.target.value))}
        />
        <span style={{ width: 34, textAlign: 'right', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
          {value.toFixed(2).replace(/\.00$/, '')}
        </span>
      </div>
    </label>
  )
}
