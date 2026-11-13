import { useEffect, useState, type ReactNode } from 'react'
import { clipNamesFor, subscribeModels } from '../assets/models'
import { saveMaterialFromSelection, savePrefabFromSelection } from '../assets/import'
import { primaryId, useEditorStore } from '../scene/store'
import { isLight, isMesh, KIND_LABEL } from '../scene/kinds'
import { slotFromNode } from '../assets/materials'
import { useAssetStore } from '../assets/library'
import type { NodeKind, PbrSlot, SceneNode, ScenePicture, Vec3 } from '../scene/types'
import './InspectorPanel.css'

const AXES = [
  { key: 0 as const, label: 'X', color: 'var(--axis-x)' },
  { key: 1 as const, label: 'Y', color: 'var(--axis-y)' },
  { key: 2 as const, label: 'Z', color: 'var(--axis-z)' },
]

export default function InspectorPanel() {
  const selection = useEditorStore(state => state.selection)
  const nodes = useEditorStore(state => state.nodes)
  const playing = useEditorStore(state => state.playState !== 'stopped')
  const id = primaryId({ selection })
  const node = id ? nodes[id] : undefined

  if (!node || selection.length === 0) {
    return (
      <div className="inspector">
        <PictureCard />
        <div className="inspector__empty">未选择物体。从资源面板导入模型，或用创建菜单摆基本几何体。</div>
      </div>
    )
  }

  const locked = node.locked

  return (
    <div className="inspector">
      <PictureCard />
      {playing && <div className="inspector__banner inspector__banner--play">试玩中可以改参数。停止后会回到试玩前。</div>}
      {selection.length > 1 && (
        <div className="inspector__banner">已选择 {selection.length} 个物体。这里改的是主选中项，手柄会作用到全部未锁定物体。</div>
      )}
      <div className="inspector__title">
        <div className="inspector__kind">{KIND_LABEL[node.kind]}{locked ? ' · 已锁定' : ''}</div>
        {selection.length === 1 ? (
          <input
            value={node.name}
            disabled={false}
            onFocus={() => useEditorStore.getState().beginGesture('重命名')}
            onChange={event => useEditorStore.getState().updateNode(node.id, { name: event.target.value })}
            onBlur={event => {
              const name = event.target.value.trim() || node.name
              useEditorStore.getState().updateNode(node.id, { name })
              useEditorStore.getState().endGesture()
            }}
          />
        ) : (
          <div className="inspector__multi">{node.name}</div>
        )}
      </div>

      <Card title="变换" color={kindColor(node.kind)}>
        <Vec3Fields
          label="位置"
          value={node.position}
          step={0.02}
          disabled={locked}
          gesture="修改位移"
          onChange={position => useEditorStore.getState().updateNode(node.id, { position })}
        />
        <Vec3Fields
          label="旋转"
          value={node.rotation}
          step={0.4}
          disabled={locked}
          gesture="修改旋转"
          onChange={rotation => useEditorStore.getState().updateNode(node.id, { rotation })}
        />
        <Vec3Fields
          label="缩放"
          value={node.scale}
          step={0.01}
          reset={1}
          disabled={locked}
          gesture="修改缩放"
          onChange={scale => useEditorStore.getState().updateNode(node.id, { scale })}
        />
        <div className="inspector__resets">
          <button type="button" disabled={locked} onClick={() => resetTransform(node.id, { position: [0, 0, 0] })}>重置位置</button>
          <button type="button" disabled={locked} onClick={() => resetTransform(node.id, { rotation: [0, 0, 0] })}>重置旋转</button>
          <button type="button" disabled={locked} onClick={() => resetTransform(node.id, { scale: [1, 1, 1] })}>重置缩放</button>
        </div>
      </Card>

      {(isMesh(node.kind) || node.kind === 'model') && (
        <Card title="渲染" color={kindColor(node.kind)}>
          <label className="field">
            <span>投射</span>
            <input type="checkbox" checked={node.castShadow} onChange={event => commitNode(node.id, '修改阴影', { castShadow: event.target.checked })} />
          </label>
          <label className="field">
            <span>接收</span>
            <input type="checkbox" checked={node.receiveShadow} onChange={event => commitNode(node.id, '修改阴影', { receiveShadow: event.target.checked })} />
          </label>
        </Card>
      )}

      {isMesh(node.kind) && (
        <Card title="材质" color={kindColor(node.kind)}>
          <PbrEditor
            slot={slotFromNode(node)}
            onChange={patch => useEditorStore.getState().updateNode(node.id, patch)}
          />
          <button type="button" className="inspector__action" onClick={saveMaterialFromSelection}>存为材质</button>
        </Card>
      )}

      {node.kind === 'model' && (
        <Card title="模型" color={kindColor(node.kind)}>
          <AnimationCard nodeId={node.id} assetId={node.assetId} clipAssetId={node.clipAssetId} clip={node.clip} clipTime={node.clipTime} clipPlaying={node.clipPlaying} />
          <button type="button" className="inspector__action" onClick={savePrefabFromSelection}>存为预制体</button>
        </Card>
      )}

      {node.kind === 'model' && node.slots.map((slot, index) => (
        <Card key={`${slot.name}-${index}`} title={slot.name} color="#ab47bc">
          <PbrEditor
            slot={slot}
            onChange={patch => {
              const slots = node.slots.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item)
              useEditorStore.getState().updateNode(node.id, { slots })
            }}
          />
        </Card>
      ))}

      {isLight(node.kind) && (
        <Card title="光源" color={kindColor(node.kind)}>
          <ColorField
            label="颜色"
            value={node.color}
            gesture="修改光源"
            onChange={color => useEditorStore.getState().updateNode(node.id, { color })}
          />
          <NumberRow
            label="强度"
            value={node.intensity}
            step={0.05}
            gesture="修改光源"
            onChange={intensity => useEditorStore.getState().updateNode(node.id, { intensity })}
          />
          {node.kind === 'spot-light' && (
            <NumberRow
              label="角度"
              value={node.spotAngle}
              step={0.2}
              gesture="修改光源"
              onChange={spotAngle => useEditorStore.getState().updateNode(node.id, { spotAngle })}
            />
          )}
          {node.kind === 'hemisphere-light' && (
            <ColorField
              label="地面"
              value={node.groundColor}
              gesture="修改光源"
              onChange={groundColor => useEditorStore.getState().updateNode(node.id, { groundColor })}
            />
          )}
          {node.kind !== 'hemisphere-light' && node.kind !== 'directional-light' && (
            <>
              <NumberRow label="范围" value={node.range} step={0.2} gesture="修改光源" onChange={range => useEditorStore.getState().updateNode(node.id, { range })} />
              <NumberRow label="衰减" value={node.decay} step={0.05} gesture="修改光源" onChange={decay => useEditorStore.getState().updateNode(node.id, { decay })} />
            </>
          )}
          {node.kind === 'directional-light' && (
            <NumberRow label="范围" value={node.range} step={0.5} gesture="修改光源" onChange={range => useEditorStore.getState().updateNode(node.id, { range })} />
          )}
          {node.kind === 'spot-light' && (
            <NumberRow label="半影" value={node.penumbra} step={0.01} gesture="修改光源" onChange={penumbra => useEditorStore.getState().updateNode(node.id, { penumbra })} />
          )}
          {node.kind !== 'hemisphere-light' && (
            <>
              <label className="field">
                <span>阴影</span>
                <input type="checkbox" checked={node.castShadow} onChange={event => commitNode(node.id, '修改光源', { castShadow: event.target.checked })} />
              </label>
              <NumberRow label="偏移" value={node.shadowBias} step={0.0001} gesture="修改光源" onChange={shadowBias => useEditorStore.getState().updateNode(node.id, { shadowBias })} />
              <NumberRow label="法线偏移" value={node.shadowNormalBias} step={0.001} gesture="修改光源" onChange={shadowNormalBias => useEditorStore.getState().updateNode(node.id, { shadowNormalBias })} />
            </>
          )}
        </Card>
      )}

      {node.kind === 'camera' && (
        <Card title="相机" color={kindColor(node.kind)}>
          <NumberRow
            label="视野"
            value={node.fov}
            step={0.2}
            gesture="修改相机"
            onChange={fov => useEditorStore.getState().updateNode(node.id, { fov })}
          />
          <NumberRow label="近裁" value={node.near} step={0.01} gesture="修改相机" onChange={near => useEditorStore.getState().updateNode(node.id, { near })} />
          <NumberRow label="远裁" value={node.far} step={1} gesture="修改相机" onChange={far => useEditorStore.getState().updateNode(node.id, { far })} />
        </Card>
      )}
    </div>
  )
}

function PictureCard() {
  const picture = useEditorStore(state => state.picture)
  const set = (patch: Partial<ScenePicture>) => useEditorStore.getState().setPicture(patch)
  return (
    <Card title="画面" color="#4a9eff">
      <ColorField label="背景" value={picture.background} gesture="修改画面" onChange={background => set({ background })} />
      <NumberRow label="曝光" value={picture.exposure} step={0.01} gesture="修改画面" onChange={exposure => set({ exposure })} />
      <label className="field"><span>雾</span><input type="checkbox" checked={picture.fog} onChange={event => set({ fog: event.target.checked })} /></label>
      {picture.fog && (
        <>
          <ColorField label="雾色" value={picture.fogColor} gesture="修改画面" onChange={fogColor => set({ fogColor })} />
          <NumberRow label="雾近" value={picture.fogNear} step={0.5} gesture="修改画面" onChange={fogNear => set({ fogNear })} />
          <NumberRow label="雾远" value={picture.fogFar} step={0.5} gesture="修改画面" onChange={fogFar => set({ fogFar })} />
        </>
      )}
      <label className="field"><span>泛光</span><input type="checkbox" checked={picture.bloom} onChange={event => set({ bloom: event.target.checked })} /></label>
      {picture.bloom && (
        <>
          <NumberRow label="强度" value={picture.bloomStrength} step={0.01} gesture="修改画面" onChange={bloomStrength => set({ bloomStrength })} />
          <NumberRow label="半径" value={picture.bloomRadius} step={0.01} gesture="修改画面" onChange={bloomRadius => set({ bloomRadius })} />
          <NumberRow label="阈值" value={picture.bloomThreshold} step={0.01} gesture="修改画面" onChange={bloomThreshold => set({ bloomThreshold })} />
        </>
      )}
      <label className="field"><span>遮蔽</span><input type="checkbox" checked={picture.ao} onChange={event => set({ ao: event.target.checked })} /></label>
      <label className="field"><span>景深</span><input type="checkbox" checked={picture.dof} onChange={event => set({ dof: event.target.checked })} /></label>
      {picture.dof && (
        <>
          <NumberRow label="对焦" value={picture.dofFocus} step={0.1} gesture="修改画面" onChange={dofFocus => set({ dofFocus })} />
          <NumberRow label="焦段" value={picture.dofFocal} step={0.05} gesture="修改画面" onChange={dofFocal => set({ dofFocal })} />
          <NumberRow label="散景" value={picture.dofBokeh} step={0.05} gesture="修改画面" onChange={dofBokeh => set({ dofBokeh })} />
        </>
      )}
      <NumberRow label="色相" value={picture.hue} step={0.01} gesture="修改画面" onChange={hue => set({ hue })} />
      <NumberRow label="饱和" value={picture.saturation} step={0.01} gesture="修改画面" onChange={saturation => set({ saturation })} />
      <EnvField value={picture.envAssetId} onChange={envAssetId => set({ envAssetId })} />
    </Card>
  )
}

function PbrEditor({ slot, onChange }: { slot: PbrSlot, onChange: (patch: Partial<PbrSlot>) => void }) {
  return (
    <>
      <ColorField label="颜色" value={slot.color} gesture="修改材质" onChange={color => onChange({ color })} />
      <NumberRow label="金属" value={slot.metalness} step={0.01} gesture="修改材质" onChange={metalness => onChange({ metalness })} />
      <NumberRow label="粗糙" value={slot.roughness} step={0.01} gesture="修改材质" onChange={roughness => onChange({ roughness })} />
      <ColorField label="发光" value={slot.emissive} gesture="修改材质" onChange={emissive => onChange({ emissive })} />
      <NumberRow label="发光强度" value={slot.emissiveIntensity} step={0.05} gesture="修改材质" onChange={emissiveIntensity => onChange({ emissiveIntensity })} />
      <NumberRow label="不透明度" value={slot.opacity} step={0.01} gesture="修改材质" onChange={opacity => onChange({ opacity })} />
      <NumberRow label="遮挡" value={slot.ao} step={0.01} gesture="修改材质" onChange={ao => onChange({ ao })} />
      <MapField label="底色" value={slot.mapAssetId} onChange={mapAssetId => onChange({ mapAssetId })} />
      <MapField label="法线" value={slot.normalAssetId} onChange={normalAssetId => onChange({ normalAssetId })} />
      <MapField label="粗糙图" value={slot.roughnessAssetId} onChange={roughnessAssetId => onChange({ roughnessAssetId })} />
      <MapField label="金属图" value={slot.metalnessAssetId} onChange={metalnessAssetId => onChange({ metalnessAssetId })} />
      <MapField label="发光图" value={slot.emissiveAssetId} onChange={emissiveAssetId => onChange({ emissiveAssetId })} />
      <MapField label="遮挡图" value={slot.aoAssetId} onChange={aoAssetId => onChange({ aoAssetId })} />
    </>
  )
}

function AnimationCard({
  nodeId, assetId, clipAssetId, clip, clipTime, clipPlaying,
}: {
  nodeId: string
  assetId: string | null
  clipAssetId: string | null
  clip: string
  clipTime: number
  clipPlaying: boolean
}) {
  const [version, setVersion] = useState(0)
  useEffect(() => subscribeModels(() => setVersion(value => value + 1)), [])
  void version
  const names = [...new Set([...clipNamesFor(assetId), ...clipNamesFor(clipAssetId)])]
  return (
    <>
      <label className="field">
        <span>片段</span>
        <select
          value={clip}
          onChange={event => useEditorStore.getState().updateNode(nodeId, { clip: event.target.value, clipTime: 0 })}
        >
          <option value="">无</option>
          {names.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>
      <label className="field">
        <span>播放</span>
        <input type="checkbox" checked={clipPlaying} onChange={event => useEditorStore.getState().updateNode(nodeId, { clipPlaying: event.target.checked })} />
      </label>
      <NumberRow label="时间" value={clipTime} step={0.01} gesture="预览动画" onChange={time => useEditorStore.getState().updateNode(nodeId, { clipTime: time, clipPlaying: false })} />
    </>
  )
}

function MapField({ label, value, onChange }: { label: string; value: string | null; onChange: (id: string | null) => void }) {
  const assets = useAssetStore(state => state.assets)
  const textures = Object.values(assets).filter(asset => asset.kind === 'texture')
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value ?? ''} onChange={event => onChange(event.target.value || null)}>
        <option value="">无</option>
        {textures.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
      </select>
    </label>
  )
}

function EnvField({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const assets = useAssetStore(state => state.assets)
  const environments = Object.values(assets).filter(asset => asset.kind === 'environment')
  return (
    <label className="field">
      <span>环境</span>
      <select value={value ?? ''} onChange={event => onChange(event.target.value || null)}>
        <option value="">无</option>
        {environments.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
      </select>
    </label>
  )
}

function commitNode(id: string, label: string, patch: Partial<SceneNode>) {
  const store = useEditorStore.getState()
  store.beginGesture(label)
  store.updateNode(id, patch)
  store.endGesture()
}

function resetTransform(id: string, patch: Partial<SceneNode>) {
  commitNode(id, '重置变换', patch)
}

function Card({ title, color, children }: { title: string; color: string; children: ReactNode }) {
  return (
    <section className="iv2-card">
      <header className="iv2-card__header">
        <span className="iv2-card__dot" style={{ background: color }} />
        <span>{title}</span>
      </header>
      <div className="iv2-card__body">{children}</div>
    </section>
  )
}

function Vec3Fields({
  label,
  value,
  step,
  reset = 0,
  disabled,
  gesture,
  onChange,
}: {
  label: string
  value: Vec3
  step: number
  disabled?: boolean
  reset?: number
  gesture: string
  onChange: (value: Vec3) => void
}) {
  return (
    <div className="vec3">
      <span className="vec3__label">{label}</span>
      {AXES.map(axis => (
        <label key={axis.label} className="vec3__cell">
          <span
            className="vec3__axis"
            style={{ color: axis.color }}
            onPointerDown={event => {
              if (disabled || event.button !== 0) return
              event.preventDefault()
              useEditorStore.getState().beginGesture(gesture)
              const origin: Vec3 = [...value]
              let current = value[axis.key]
              let last = event.clientX
              const move = (ev: PointerEvent) => {
                const dx = ev.clientX - last
                last = ev.clientX
                const speed = ev.shiftKey ? 0.1 : 1
                current += dx * step * speed
                const next: Vec3 = [...origin]
                next[axis.key] = current
                onChange(next)
              }
              const up = () => {
                window.removeEventListener('pointermove', move)
                window.removeEventListener('pointerup', up)
                useEditorStore.getState().endGesture()
              }
              window.addEventListener('pointermove', move)
              window.addEventListener('pointerup', up)
            }}
            onDoubleClick={() => {
              if (disabled) return
              const store = useEditorStore.getState()
              store.beginGesture(gesture)
              const copy: Vec3 = [...value]
              copy[axis.key] = reset
              onChange(copy)
              store.endGesture()
            }}
          >
            {axis.label}
          </span>
          <NumberField
            value={value[axis.key]}
            disabled={disabled}
            onBegin={() => useEditorStore.getState().beginGesture(gesture)}
            onChange={next => {
              const copy: Vec3 = [...value]
              copy[axis.key] = next
              onChange(copy)
            }}
            onEnd={() => useEditorStore.getState().endGesture()}
          />
        </label>
      ))}
    </div>
  )
}

function NumberRow({
  label,
  value,
  step,
  gesture,
  onChange,
}: {
  label: string
  value: number
  step: number
  gesture: string
  onChange: (value: number) => void
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <NumberField
        value={value}
        step={step}
        onBegin={() => useEditorStore.getState().beginGesture(gesture)}
        onChange={onChange}
        onEnd={() => useEditorStore.getState().endGesture()}
      />
    </label>
  )
}

function NumberField({
  value,
  disabled,
  step,
  onBegin,
  onChange,
  onEnd,
}: {
  value: number
  disabled?: boolean
  step?: number
  onBegin: () => void
  onChange: (value: number) => void
  onEnd: () => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <input
      type="number"
      step={step ?? 0.1}
      disabled={disabled}
      value={draft ?? formatNum(value)}
      onFocus={() => {
        setDraft(formatNum(value))
        onBegin()
      }}
      onChange={event => {
        setDraft(event.target.value)
        const next = Number(event.target.value)
        if (event.target.value.trim() !== '' && Number.isFinite(next)) onChange(next)
      }}
      onBlur={() => {
        setDraft(null)
        onEnd()
      }}
    />
  )
}

function ColorField({
  label,
  value,
  gesture = '修改颜色',
  onChange,
}: {
  label: string
  value: string
  gesture?: string
  onChange: (value: string) => void
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="color"
        value={toColorInput(value)}
        onFocus={() => useEditorStore.getState().beginGesture(gesture)}
        onChange={event => onChange(event.target.value)}
        onBlur={() => useEditorStore.getState().endGesture()}
      />
    </label>
  )
}

function formatNum(value: number): string {
  if (!Number.isFinite(value)) return '0'
  const rounded = Math.round(value * 1000) / 1000
  return String(rounded)
}

function toColorInput(value: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#cccccc'
}

function kindColor(kind: NodeKind): string {
  if (isLight(kind)) return '#ffd36b'
  if (kind === 'camera') return '#4a9eff'
  if (isMesh(kind)) return '#f5a623'
  return '#999999'
}
