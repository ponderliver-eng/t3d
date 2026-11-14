import { useAssetStore } from '../assets/library'
import { useI18n, type MessageKey } from '../i18n'
import { primaryId, useEditorStore } from '../scene/store'
import './StatusBar.css'

const GIZMO_KEY = { translate: 'status.move', rotate: 'status.rotate', scale: 'status.scale' } as const satisfies Record<string, MessageKey>

export default function StatusBar() {
  const count = useEditorStore(state => Object.keys(state.nodes).length)
  const selection = useEditorStore(state => state.selection)
  const nodes = useEditorStore(state => state.nodes)
  const playState = useEditorStore(state => state.playState)
  const projection = useEditorStore(state => state.projectionLabel)
  const gizmoMode = useEditorStore(state => state.gizmoMode)
  const gizmoSpace = useEditorStore(state => state.gizmoSpace)
  const snap = useEditorStore(state => state.snap)
  const snapStep = useEditorStore(state => state.snapStep)
  const origin = useEditorStore(state => state.gizmoOrigin)
  const notice = useEditorStore(state => state.notice)
  const activeSceneId = useEditorStore(state => state.activeSceneId)
  const { t } = useI18n()
  const sceneAssetName = useAssetStore(state => {
    const asset = state.assets[activeSceneId]
    return asset?.kind === 'scene' ? asset.name : ''
  })
  const sceneName = sceneAssetName || t('status.unnamed')
  const primary = primaryId({ selection })
  const selectedName = primary ? nodes[primary]?.name : null

  return (
    <div className="statusbar">
      <span className="statusbar__item">T3D</span>
      <span className="statusbar__sep" />
      <span className="statusbar__item statusbar__item--project">{sceneName}</span>
      <span className="statusbar__sep" />
      <span className="statusbar__item">{useEditorStore(state => state.renderBackend)}</span>
      <span className="statusbar__sep" />
      {playState === 'playing' && <span className="statusbar__item statusbar__item--play">● {t('status.playing')}</span>}
      {playState === 'paused' && <span className="statusbar__item statusbar__item--pause">● {t('status.paused')}</span>}
      {playState === 'stopped' && <span className="statusbar__item statusbar__item--ready">● {t('status.ready')}</span>}
      {notice && (
        <>
          <span className="statusbar__sep" />
          <span className="statusbar__item statusbar__item--notice">{notice}</span>
        </>
      )}
      <span className="statusbar__spacer" />
      <span className="statusbar__item">{t('status.objects')} {count}</span>
      <span className="statusbar__sep" />
      <span className="statusbar__item">
        {selection.length === 0 ? t('status.none') : selection.length === 1 ? selectedName : t('status.selected', { count: selection.length })}
      </span>
      <span className="statusbar__sep" />
      <span className="statusbar__item">{projection}</span>
      <span className="statusbar__sep" />
      <span className="statusbar__item">{t(GIZMO_KEY[gizmoMode])} · {gizmoSpace === 'world' ? t('status.world') : t('status.local')} · {origin === 'center' ? t('status.center') : t('status.pivot')}</span>
      <span className="statusbar__sep" />
      <span className="statusbar__item">{snap ? t('status.snapOn', { step: snapStep }) : t('status.snapOff')}</span>
    </div>
  )
}
