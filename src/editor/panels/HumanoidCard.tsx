import { useEffect, useRef, useState } from 'react'
import { buildModelHumanoidAvatar, type ModelHumanoidAvatar } from '../animation/humanoidAvatar'
import { normalizeHumanoidRetargetAdjust, humanoidRetargetAdjustIsDefault, type NormalizedHumanoidRetargetAdjust } from '../animation/humanoidAdjust'
import { saveHumanoidSettings } from '../animation/humanoidPlayback'
import { CORE_HUMANOID_SLOTS, type HumanoidBoneSlot } from '../animation/humanoidSlots'
import { useAssetStore } from '../assets/library'
import { getModelTemplate, subscribeModels } from '../assets/models'
import { useI18n, type MessageKey } from '../i18n'

const SLOT_LABEL: Partial<Record<HumanoidBoneSlot, MessageKey>> = {
  Hips: 'humanoid.slotHips',
  Spine: 'humanoid.slotSpine',
  Head: 'humanoid.slotHead',
  LeftUpperArm: 'humanoid.slotLeftUpperArm',
  LeftLowerArm: 'humanoid.slotLeftLowerArm',
  RightUpperArm: 'humanoid.slotRightUpperArm',
  RightLowerArm: 'humanoid.slotRightLowerArm',
  LeftUpperLeg: 'humanoid.slotLeftUpperLeg',
  LeftLowerLeg: 'humanoid.slotLeftLowerLeg',
  RightUpperLeg: 'humanoid.slotRightUpperLeg',
  RightLowerLeg: 'humanoid.slotRightLowerLeg',
}

const FIELDS: Array<{ key: keyof NormalizedHumanoidRetargetAdjust; label: MessageKey; min: number; max: number; step: number }> = [
  { key: 'shoulderWidthRatio', label: 'humanoid.shoulderWidth', min: -1, max: 1, step: 0.05 },
  { key: 'shoulderSpreadDeg', label: 'humanoid.shoulderRotate', min: -90, max: 35, step: 1 },
  { key: 'armSpreadDeg', label: 'humanoid.armSpread', min: -35, max: 35, step: 1 },
  { key: 'elbowBendDeg', label: 'humanoid.elbowBend', min: -35, max: 35, step: 1 },
  { key: 'hipSpreadDeg', label: 'humanoid.hipSpread', min: -35, max: 35, step: 1 },
  { key: 'kneeBendDeg', label: 'humanoid.kneeBend', min: -35, max: 35, step: 1 },
  { key: 'footPitchDeg', label: 'humanoid.footPitch', min: -35, max: 35, step: 1 },
  { key: 'hipsHeightLegRatio', label: 'humanoid.hipsHeight', min: -0.5, max: 0.5, step: 0.01 },
  { key: 'strideScale', label: 'humanoid.stride', min: 0.25, max: 2.5, step: 0.05 },
]

function formatValue(key: keyof NormalizedHumanoidRetargetAdjust, value: number): string {
  if (key === 'hipsHeightLegRatio' || key === 'shoulderWidthRatio') return `${Math.round(value * 100)}%`
  if (key === 'strideScale') return `${value.toFixed(2)}x`
  return `${Math.round(value)}°`
}

export function HumanoidCard({ assetId }: { assetId: string }) {
  const { t } = useI18n()
  const asset = useAssetStore(state => state.assets[assetId])
  const [version, setVersion] = useState(0)
  useEffect(() => subscribeModels(() => setVersion(value => value + 1)), [])
  void version
  const template = getModelTemplate(assetId)
  const humanoid = template?.humanoid
  const bones = [...new Set((humanoid?.skeletons ?? []).flatMap(skeleton => skeleton.bones.map(bone => bone.name)).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'zh'))
  const avatar = (asset && 'fileName' in asset ? asset.humanoidAvatar : null) ?? humanoid?.avatar ?? null
  const adjust = normalizeHumanoidRetargetAdjust(asset && 'fileName' in asset ? asset.humanoidRetarget : null)
  const draft = useRef(adjust)
  draft.current = adjust
  if (!avatar && bones.length === 0) return null
  const motion = !avatar
    ? t('humanoid.motionUnknown')
    : avatar.rootMotion === 'inPlace'
      ? t('humanoid.inPlace')
      : avatar.rootMotion === 'rootMotion'
        ? avatar.rootBoneName ? `${t('humanoid.rootMotion')} · ${avatar.rootBoneName}` : t('humanoid.rootMotion')
        : t('humanoid.motionUnknown')
  const missing = avatar?.missingCoreSlots.map(slot => t(SLOT_LABEL[slot] ?? 'humanoid.slotHips')).join('、') ?? ''
  const commitSlot = (slot: HumanoidBoneSlot, boneName: string) => {
    const previous = avatar
    const overrides = { ...(previous?.overrides ?? {}) }
    if (!boneName) delete overrides[slot]
    else overrides[slot] = boneName
    const rebuilt = buildModelHumanoidAvatar({
      skeletons: humanoid?.skeletons ?? [],
      hasTrueBindPose: previous?.hasTrueBindPose ?? true,
      overrides,
    })
    const next: ModelHumanoidAvatar | null = rebuilt
      ? {
          ...rebuilt,
          ...(previous ? {
            rootMotion: previous.rootMotion,
            ...(previous.rootBoneName ? { rootBoneName: previous.rootBoneName } : {}),
            restConflictBones: previous.restConflictBones,
            hasTrueBindPose: previous.hasTrueBindPose,
          } : {}),
          ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
        }
      : previous
    if (!next?.slots.Hips) return
    saveHumanoidSettings(assetId, { humanoidAvatar: next })
  }
  const setAdjust = (next: NormalizedHumanoidRetargetAdjust, persist: boolean) => {
    saveHumanoidSettings(assetId, { humanoidRetarget: humanoidRetargetAdjustIsDefault(next) ? null : next }, persist)
  }
  return (
    <div className="humanoid-card">
      <p className="humanoid-card__summary">
        {avatar
          ? t('humanoid.summary', {
              skins: avatar.skinCount,
              bind: avatar.hasTrueBindPose ? t('humanoid.bind') : t('humanoid.noBind'),
              motion,
            })
          : t('humanoid.noHips')}
      </p>
      {avatar && missing ? <p className="humanoid-card__warn">{t('humanoid.missing', { names: missing })}</p> : null}
      {avatar && !missing ? <p className="humanoid-card__ok">{t('humanoid.coreOk', { count: CORE_HUMANOID_SLOTS.length })}</p> : null}
      {avatar && avatar.restConflictBones.length > 0 ? <p className="humanoid-card__warn">{t('humanoid.restConflict', { names: avatar.restConflictBones.join('、') })}</p> : null}
      {bones.length > 0 && (
        <details className="humanoid-card__fold">
          <summary>{t('humanoid.slots')}</summary>
          <p>{t('humanoid.slotsHint')}</p>
          {CORE_HUMANOID_SLOTS.map(slot => (
            <label key={slot} className="field">
              <span>{t(SLOT_LABEL[slot] ?? 'humanoid.slotHips')}</span>
              <select value={avatar?.overrides?.[slot] ?? avatar?.slots?.[slot] ?? ''} onChange={event => commitSlot(slot, event.target.value)}>
                <option value="">{t('humanoid.auto')}</option>
                {bones.map(name => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
          ))}
        </details>
      )}
      <details className="humanoid-card__fold">
        <summary>{t('humanoid.adjust')}</summary>
        <p>{t('humanoid.adjustHint')}</p>
        <button type="button" disabled={humanoidRetargetAdjustIsDefault(adjust)} onClick={() => setAdjust(normalizeHumanoidRetargetAdjust(null), true)}>{t('humanoid.reset')}</button>
        {FIELDS.map(field => (
          <label key={field.key} className="humanoid-card__slider">
            <span>{t(field.label)}</span>
            <input
              type="range"
              min={field.min}
              max={field.max}
              step={field.step}
              value={adjust[field.key]}
              onChange={event => {
                const next = { ...draft.current, [field.key]: Number(event.target.value) }
                draft.current = next
                setAdjust(next, false)
              }}
              onPointerUp={() => setAdjust(draft.current, true)}
              onBlur={() => setAdjust(draft.current, true)}
            />
            <em>{formatValue(field.key, adjust[field.key])}</em>
          </label>
        ))}
      </details>
    </div>
  )
}
