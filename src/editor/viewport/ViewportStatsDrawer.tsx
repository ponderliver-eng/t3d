import { Activity, BarChart3, Box, X } from 'lucide-react'
import { capabilityEnabled } from '../../capabilities/registry'
import { useAssetStore } from '../assets/library'
import { useI18n } from '../i18n'
import { useEditorStore } from '../scene/store'
import { resolvePlayCamera } from './playCamera'

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(Math.round(n))
}

export function ViewportStatsDrawer({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  const stats = useEditorStore(state => state.viewportStats)
  const backend = useEditorStore(state => state.renderBackend)
  const nodes = useEditorStore(state => state.nodes)
  const selection = useEditorStore(state => state.selection)
  const playState = useEditorStore(state => state.playState)
  const cameraView = useEditorStore(state => state.cameraView)
  const capabilities = useEditorStore(state => state.capabilities)
  const tags = useEditorStore(state => state.tags)
  const assetCount = useAssetStore(state => Object.keys(state.assets).length)
  const physicsOn = capabilityEnabled(capabilities, 'physics')
  let dynamic = 0
  let kinematic = 0
  let fixed = 0
  let triggers = 0
  for (const node of Object.values(nodes)) {
    if (!node.physics) continue
    if (node.physics.trigger) triggers += 1
    if (node.physics.body === 'dynamic') dynamic += 1
    else if (node.physics.body === 'kinematic') kinematic += 1
    else fixed += 1
  }
  const selected = selection[0] ? nodes[selection[0]] : undefined
  const playCameraId = playState === 'stopped' ? null : resolvePlayCamera(nodes, tags).id
  const playCamera = playCameraId ? nodes[playCameraId] : undefined
  const fpsColor = stats.fps >= 50 ? '#34d399' : stats.fps >= 30 ? '#fbbf24' : '#f87171'
  const [x, y, z] = stats.camera
  return (
    <div className="viewport-stats-drawer" onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}>
      <div className="viewport-stats-drawer__header">
        <div className="viewport-stats-drawer__title">
          <BarChart3 size={13} />
          <span>{t('view.statsTitle')}</span>
        </div>
        <div className="viewport-stats-drawer__header-right">
          <span className="viewport-stats-drawer__fps-pill" style={{ color: fpsColor, borderColor: `${fpsColor}44`, background: `${fpsColor}14` }}>
            {stats.fps.toFixed(1)} FPS · {stats.frameMs.toFixed(1)} ms
          </span>
          <button type="button" className="viewport-stats-drawer__close" onClick={onClose}><X size={13} /></button>
        </div>
      </div>
      <div className="viewport-stats-drawer__body">
        <div className="viewport-stats-drawer__section">
          <div className="viewport-stats-drawer__section-title"><BarChart3 size={11} /> {t('view.statsRender')}</div>
          <div className="viewport-stats-drawer__grid">
            <Item k={t('view.statsBackend')} v={backend} />
            <Item k={t('view.statsCalls')} v={fmtNum(stats.calls)} />
            <Item k={t('view.statsTris')} v={fmtNum(stats.triangles)} />
            <Item k={t('view.statsMeshes')} v={`${fmtNum(stats.objects)} / ${fmtNum(stats.vertices)}`} />
            <Item k={t('view.statsMats')} v={`${stats.materials} / ${stats.textures}`} />
            <Item k={t('view.statsNodes')} v={`${Object.keys(nodes).length} / ${assetCount} ${t('view.statsAssets')}`} />
          </div>
        </div>
        <div className="viewport-stats-drawer__section">
          <div className="viewport-stats-drawer__section-title"><Activity size={11} /> {t('view.statsPhysics')}</div>
          <div className="viewport-stats-drawer__grid">
            <Item k={t('view.statsPhysics')} v={physicsOn ? (playState === 'playing' ? t('view.statsReady') : t('view.statsIdle')) : t('view.statsIdle')} />
            <Item k={t('view.statsBodies')} v={`${dynamic} / ${kinematic} / ${fixed}`} />
            <Item k={t('view.statsTriggers')} v={String(triggers)} />
            <Item k={t('view.statsPlay')} v={playState === 'stopped' ? t('view.statsEditing') : t('view.statsPlaying')} />
          </div>
        </div>
        <div className="viewport-stats-drawer__section">
          <div className="viewport-stats-drawer__section-title"><Box size={11} /> {t('view.statsCamera')}</div>
          <div className="viewport-stats-drawer__kv-list">
            <Row k={t('view.statsCamMode')} v={`${cameraView} · ${stats.orbit.toFixed(1)}`} />
            <Row k={t('view.statsCamPos')} v={`(${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})`} />
            <Row k={t('view.statsPlay')} v={playCamera?.name ?? (playState === 'stopped' ? t('view.statsEditing') : t('view.statsNone'))} />
            <Row k={t('view.statsSelected')} v={selected ? `${selected.name} · ${selected.kind}` : t('view.statsNone')} />
          </div>
        </div>
      </div>
    </div>
  )
}

function Item({ k, v }: { k: string, v: string }) {
  return (
    <div className="viewport-stats-drawer__item">
      <span className="viewport-stats-drawer__k">{k}</span>
      <span className="viewport-stats-drawer__v">{v}</span>
    </div>
  )
}

function Row({ k, v }: { k: string, v: string }) {
  return (
    <div className="viewport-stats-drawer__kv-row">
      <span className="viewport-stats-drawer__k">{k}</span>
      <span className="viewport-stats-drawer__v">{v}</span>
    </div>
  )
}
