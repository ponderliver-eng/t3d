import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { ASSET_MIME } from '../../editor/assets/import'
import { useAssetStore } from '../../editor/assets/library'
import { normalizeSlot } from '../../editor/assets/materials'
import { useEditorStore } from '../../editor/scene/store'
import { useI18n, type MessageKey } from '../../editor/i18n'
import { useInspectorCardOpen } from '../../editor/panels/inspectorMemory'
import type { NodeEffect, ParticleBlend, SceneNode } from '../../editor/scene/types'
import { isKnownShape, readSystem, systemSlots, writeSystem, type SystemView } from './simulationForm'

export function EffectModules({
  simulation,
  disabled,
  onChange,
}: {
  simulation: unknown
  disabled: boolean
  onChange: (simulation: unknown) => void
}) {
  const { t } = useI18n()
  const slots = systemSlots(simulation)
  const [index, setIndex] = useState(0)
  const slot = slots[Math.min(index, Math.max(0, slots.length - 1))]
  const view = slot ? readSystem(simulation, slot.path) : null
  if (!slot || !view) {
    return <p className="settings-note">{t('particles.noEmitter')}</p>
  }
  const edit = (patch: Partial<SystemView>) => {
    onChange(writeSystem(simulation, slot.path, { ...view, ...patch }))
  }
  return (
    <>
      {slots.length > 1 && (
        <section className="iv2-card">
          <div className="iv2-card__body">
            <label className="field">
              <span>{t('particles.emitter')}</span>
              <select disabled={disabled} value={Math.min(index, slots.length - 1)} onChange={event => setIndex(Number(event.target.value))}>
                {slots.map((item, itemIndex) => <option key={item.path.join('.')} value={itemIndex}>{item.label}</option>)}
              </select>
            </label>
          </div>
        </section>
      )}
      <Card id="particle-main" title={t('particles.main')}>
        <Num label={t('particles.duration')} value={view.duration} step={0.1} min={0.05} disabled={disabled} onChange={duration => edit({ duration })} />
        <div className="particle-checks">
          <Check label={t('particles.looping')} checked={view.looping} disabled={disabled} onChange={looping => edit({ looping })} />
          <Check label={t('particles.prewarm')} checked={view.prewarm} disabled={disabled} onChange={prewarm => edit({ prewarm })} />
          <Check label={t('particles.worldSpace')} checked={view.worldSpace} disabled={disabled} onChange={worldSpace => edit({ worldSpace })} />
        </div>
        <label className="field">
          <span>{t('particles.renderMode')}</span>
          <select disabled={disabled} value={view.renderMode} onChange={event => edit({ renderMode: Number(event.target.value) })}>
            <option value={0}>{t('particles.billboard')}</option>
            <option value={1}>{t('particles.stretched')}</option>
            <option value={4}>{t('particles.horizontal')}</option>
            <option value={5}>{t('particles.vertical')}</option>
            <option value={2}>{t('particles.mesh')}</option>
            <option value={3}>{t('particles.trail')}</option>
          </select>
        </label>
        {view.renderMode === 1 && (
          <>
            <Num label={t('particles.speedFactor')} value={view.speedFactor} step={0.05} min={0} disabled={disabled} onChange={speedFactor => edit({ speedFactor })} />
            <Num label={t('particles.lengthFactor')} value={view.lengthFactor} step={0.05} disabled={disabled} onChange={lengthFactor => edit({ lengthFactor })} />
          </>
        )}
        {view.renderMode === 3 && (
          <Num label={t('particles.trailLength')} value={view.trailLength} step={1} min={2} disabled={disabled} onChange={trailLength => edit({ trailLength })} />
        )}
      </Card>
      <Card id="particle-emission" title={t('particles.emission')}>
        <Pair label={t('particles.rate')} min={view.rateMin} max={view.rateMax} step={1} disabled={disabled || view.rateCurve} curve={view.rateCurve} onChange={(rateMin, rateMax) => edit({ rateMin, rateMax })} />
        {view.burstLocked
          ? <p className="settings-note">{t('particles.burstsLocked')}</p>
          : <Num label={t('particles.burst')} value={view.burst} step={1} min={0} disabled={disabled} onChange={burst => edit({ burst })} />}
      </Card>
      <Card id="particle-start" title={t('particles.start')}>
        <div className="particle-pair particle-pair--head"><span /><span>{t('particles.min')}</span><span>{t('particles.max')}</span></div>
        <Pair label={t('particles.life')} min={view.lifeMin} max={view.lifeMax} step={0.05} disabled={disabled || view.lifeCurve} curve={view.lifeCurve} onChange={(lifeMin, lifeMax) => edit({ lifeMin, lifeMax })} />
        <Pair label={t('particles.speed')} min={view.speedMin} max={view.speedMax} step={0.1} disabled={disabled || view.speedCurve} curve={view.speedCurve} onChange={(speedMin, speedMax) => edit({ speedMin, speedMax })} />
        <Pair label={t('particles.size')} min={view.sizeMin} max={view.sizeMax} step={0.01} disabled={disabled || view.sizeCurve} curve={view.sizeCurve} onChange={(sizeMin, sizeMax) => edit({ sizeMin, sizeMax })} />
        <Num label={t('particles.rotation')} value={view.rotationDeg} step={1} disabled={disabled || view.rotationCurve} onChange={rotationDeg => edit({ rotationDeg })} />
        {view.rotationCurve && <p className="settings-note">{t('particles.curve')}</p>}
        <label className="field">
          <span>{t('particles.color')}</span>
          <input type="color" disabled={disabled || view.colorCurve} value={view.color} onChange={event => edit({ color: event.target.value })} />
        </label>
        <Num label={t('particles.alpha')} value={view.colorAlpha} step={0.05} min={0} max={1} disabled={disabled || view.colorCurve} onChange={colorAlpha => edit({ colorAlpha })} />
        {view.colorCurve && <p className="settings-note">{t('particles.curve')}</p>}
        {view.modules.length > 0 && <p className="settings-note">{t('particles.modules')}：{view.modules.map(module => moduleLabel(module, t)).join('、')}</p>}
      </Card>
      <Card id="particle-shape" title={t('particles.shape')}>
        <label className="field">
          <span>{t('particles.shapeType')}</span>
          {isKnownShape(view.shape) ? (
            <select disabled={disabled} value={view.shape} onChange={event => edit({ shape: event.target.value })}>
              <option value="point">{t('particles.shapePoint')}</option>
              <option value="cone">{t('particles.shapeCone')}</option>
              <option value="sphere">{t('particles.shapeSphere')}</option>
              <option value="hemisphere">{t('particles.shapeHemisphere')}</option>
              <option value="circle">{t('particles.shapeCircle')}</option>
              <option value="donut">{t('particles.shapeDonut')}</option>
              <option value="rectangle">{t('particles.shapeRectangle')}</option>
            </select>
          ) : <span>{view.shape}</span>}
        </label>
        {view.shape !== 'point' && view.shape !== 'rectangle' && isKnownShape(view.shape) && (
          <Num label={t('particles.radius')} value={view.radius} step={0.01} min={0} disabled={disabled} onChange={radius => edit({ radius })} />
        )}
        {view.shape === 'cone' && <Num label={t('particles.angle')} value={view.angleDeg} step={1} min={0} max={90} disabled={disabled} onChange={angleDeg => edit({ angleDeg })} />}
        {(view.shape === 'cone' || view.shape === 'circle' || view.shape === 'sphere' || view.shape === 'hemisphere' || view.shape === 'donut') && (
          <Num label={t('particles.arc')} value={view.arcDeg} step={1} min={0} max={360} disabled={disabled} onChange={arcDeg => edit({ arcDeg })} />
        )}
        {(view.shape === 'cone' || view.shape === 'donut' || view.shape === 'rectangle' || view.shape === 'sphere' || view.shape === 'hemisphere') && (
          <Num label={t('particles.thickness')} value={view.thickness} step={0.05} min={0} max={1} disabled={disabled} onChange={thickness => edit({ thickness })} />
        )}
        {view.shape === 'rectangle' && (
          <>
            <Num label={t('particles.width')} value={view.width} step={0.01} min={0} disabled={disabled} onChange={width => edit({ width })} />
            <Num label={t('particles.height')} value={view.height} step={0.01} min={0} disabled={disabled} onChange={height => edit({ height })} />
          </>
        )}
        <Num label={t('particles.tilesX')} value={view.tilesX} step={1} min={1} disabled={disabled} onChange={tilesX => edit({ tilesX })} />
        <Num label={t('particles.tilesY')} value={view.tilesY} step={1} min={1} disabled={disabled} onChange={tilesY => edit({ tilesY })} />
      </Card>
      <Card id="particle-force" title={t('particles.force')}>
        <Num label={t('particles.gravity')} value={view.gravity} step={0.1} disabled={disabled || view.gravityLocked} onChange={gravity => edit({ gravity })} />
        {view.gravityLocked && <p className="settings-note">{t('particles.gravityLocked')}</p>}
      </Card>
    </>
  )
}

export function commitSimulation(node: SceneNode, simulation: unknown) {
  const effect = node.effect
  if (!effect) return
  if (effect.assetId) {
    useAssetStore.getState().updateEffect(effect.assetId, { simulation })
    return
  }
  useEditorStore.getState().updateNode(node.id, { effect: { ...effect, simulation } })
}

export function createParticleMaterial(effect: NodeEffect, name: string): string {
  const id = crypto.randomUUID()
  useAssetStore.getState().add({
    id,
    name,
    kind: 'material',
    slot: normalizeSlot({
      name,
      color: '#ff8c33',
      metalness: 0,
      roughness: 1,
      emissive: '#000000',
      emissiveIntensity: 1,
      opacity: 1,
      ao: 1,
      mapAssetId: null,
      normalAssetId: null,
      metallicRoughnessAssetId: null,
      emissiveAssetId: null,
      aoAssetId: null,
      shader: 'particle-unlit',
      particleBlend: 'additive',
      alphaMode: 'blend',
      depthWrite: false,
      cull: 'off',
    }),
  })
  useAssetStore.getState().place(id)
  if (effect.assetId) {
    const asset = useAssetStore.getState().assets[effect.assetId]
    if (asset?.kind === 'effect' && !asset.materialAssetId && !effect.materialAssetId) {
      useAssetStore.getState().updateEffect(effect.assetId, { simulation: asset.simulation, materialAssetId: id })
    }
  }
  return id
}

function moduleLabel(type: string, t: (key: MessageKey, vars?: Record<string, string | number>) => string): string {
  if (type === 'ColorOverLife') return t('particles.moduleColor')
  if (type === 'SizeOverLife') return t('particles.moduleSize')
  if (type === 'Noise') return t('particles.moduleNoise')
  return t('particles.moduleOther', { name: type })
}

function Card({ id, title, children }: { id: string, title: string, children: ReactNode }) {
  const [open, setOpen] = useInspectorCardOpen(id)
  return (
    <section className="iv2-card">
      <header className="iv2-card__header" onClick={() => setOpen(!open)}>
        <span className="iv2-card__dot" style={{ background: '#ffb25a' }} />
        <span>{title}</span>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </header>
      {open && <div className="iv2-card__body">{children}</div>}
    </section>
  )
}

function Check({ label, checked, disabled, onChange }: { label: string, checked: boolean, disabled: boolean, onChange: (value: boolean) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="checkbox" disabled={disabled} checked={checked} onChange={event => onChange(event.target.checked)} />
    </label>
  )
}

function Num({ label, value, step, min, max, disabled, onChange }: { label: string, value: number, step: number, min?: number, max?: number, disabled: boolean, onChange: (value: number) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <Draft value={value} step={step} min={min} max={max} disabled={disabled} onChange={onChange} />
    </label>
  )
}

function Pair({
  label, min, max, step, disabled, curve, onChange,
}: {
  label: string
  min: number
  max: number
  step: number
  disabled: boolean
  curve: boolean
  onChange: (min: number, max: number) => void
}) {
  const { t } = useI18n()
  return (
    <div className="particle-pair">
      <span>{label}</span>
      <Draft value={min} step={step} disabled={disabled} title={t('particles.min')} onChange={next => onChange(next, max)} />
      <Draft value={max} step={step} disabled={disabled} title={t('particles.max')} onChange={next => onChange(min, next)} />
      {curve && <em className="particle-note">{t('particles.curve')}</em>}
    </div>
  )
}

function Draft({
  value, step, min, max, disabled, title, onChange,
}: {
  value: number
  step: number
  min?: number
  max?: number
  disabled: boolean
  title?: string
  onChange: (value: number) => void
}) {
  const [text, setText] = useState<string | null>(null)
  return (
    <input
      type="number"
      title={title}
      disabled={disabled}
      value={text ?? (Number.isFinite(value) ? round(value) : 0)}
      step={step}
      min={min}
      max={max}
      onFocus={() => setText(String(round(value)))}
      onChange={event => {
        setText(event.target.value)
        const next = Number(event.target.value)
        if (event.target.value.trim() !== '' && Number.isFinite(next)) onChange(next)
      }}
      onBlur={() => setText(null)}
    />
  )
}

export function MaterialDrop({
  materialId,
  disabled,
  onMaterial,
  onMap,
  onBlend,
  onColor,
  onOpacity,
  onDepthWrite,
}: {
  materialId: string | null
  disabled: boolean
  onMaterial: (id: string | null) => void
  onMap: (id: string | null) => void
  onBlend: (blend: ParticleBlend) => void
  onColor: (color: string) => void
  onOpacity: (opacity: number) => void
  onDepthWrite: (depthWrite: boolean) => void
}) {
  const { t } = useI18n()
  const asset = useAssetStore(state => materialId ? state.assets[materialId] : undefined)
  const slot = asset?.kind === 'material' ? asset.slot : null
  const particle = (slot?.shader ?? 'lit') === 'particle-unlit'
  return (
    <>
      <label
        className="field"
        onDragOver={event => {
          if ([...event.dataTransfer.types].includes(ASSET_MIME)) event.preventDefault()
        }}
        onDrop={event => {
          const id = event.dataTransfer.getData(ASSET_MIME)
          const dropped = id ? useAssetStore.getState().assets[id] : undefined
          if (!dropped) return
          event.preventDefault()
          if (dropped.kind === 'material') onMaterial(dropped.id)
          if (dropped.kind === 'texture' && particle && materialId) onMap(dropped.id)
        }}
      >
        <span>{t('particles.material')}</span>
        <span>{asset?.kind === 'material' ? asset.name : t('particles.materialEmpty')}</span>
      </label>
      {slot && !particle && <p className="settings-note">{t('particles.badMaterial')}</p>}
      {slot && particle && (
        <>
          <label className="field">
            <span>{t('particles.tint')}</span>
            <input type="color" disabled={disabled} value={/^#[0-9a-fA-F]{6}$/.test(slot.color) ? slot.color : '#ff8c33'} onChange={event => onColor(event.target.value)} />
          </label>
          <label className="field">
            <span>{t('material.particleBlend')}</span>
            <select disabled={disabled} value={slot.particleBlend ?? 'additive'} onChange={event => onBlend(event.target.value as ParticleBlend)}>
              <option value="alpha">{t('material.blendAlpha')}</option>
              <option value="premultiply">{t('material.blendPremultiply')}</option>
              <option value="additive">{t('material.blendAdditive')}</option>
              <option value="multiply">{t('material.blendMultiply')}</option>
            </select>
          </label>
          <Num label={t('material.opacity')} value={slot.opacity} step={0.05} min={0} max={1} disabled={disabled} onChange={onOpacity} />
          <Check label={t('material.depthWrite')} checked={slot.depthWrite ?? false} disabled={disabled} onChange={onDepthWrite} />
          <label className="field">
            <span>{t('material.baseMap')}</span>
            <span>{mapName(slot.mapAssetId ?? null)}</span>
          </label>
        </>
      )}
    </>
  )
}

function mapName(id: string | null): string {
  if (!id) return '—'
  const asset = useAssetStore.getState().assets[id]
  return asset?.name ?? '—'
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}
