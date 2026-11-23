import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Activity,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BookOpen,
  CheckCircle2,
  FileDown,
  GitBranch,
  Globe,
  Layers,
  Monitor,
  Package,
  Play,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { create } from 'zustand'
import { useAgentStore } from '../../ai/agentLoop'
import { useAssetStore } from '../../editor/assets/library'
import { electronBridge } from '../../editor/project/electronBridge'
import { useI18n } from '../../editor/i18n'
import { useEditorStore } from '../../editor/scene/store'
import { listEnabledTableSchemas, tableRows } from '../../gameplay/registry'
import { installPackBundle, listAllRecipes, sedimentProjectToPack, trustAndActivatePack, uninstallPack, usePackStore } from '../packs/manager'
import type { PackBundle, PackTier } from '../packs/types'
import { DEFAULT_PERFORMANCE_BUDGET, diagnoseProject } from '../query/diagnose'
import {
  exportWebPlayerBundle,
  resolveScenesForBuild,
  type BuildProgressInfo,
} from '../../player/exporter'
import {
  loadBuildSettingsFromProject,
  normalizeBuildSettings,
  saveBuildSettingsToProject,
  useBuildSettingsStore,
  type BuildSettings,
  type PreloadMode,
  type TextureBuildMode,
  type TextureMaxSize,
} from './buildSettings'
import {
  activeBranchId,
  createBranch,
  createCheckpoint,
  deleteBranch,
  diffBranchWithMain,
  listBranches,
  listCheckpoints,
  promoteBranchToMain,
  restoreCheckpoint,
  switchBranch,
  toggleCheckpointStar,
  useCheckpointUiStore,
} from './checkpoints'
import { getDesignDoc, updateDesignDoc } from './designMemory'
import './ProjectManagerModal.css'

export type ManagerTabId = 'design' | 'packs' | 'diagnose' | 'branches' | 'publish'

interface ManagerModalState {
  open: boolean
  tab: ManagerTabId
  openModal: (tab?: ManagerTabId) => void
  closeModal: () => void
  setTab: (tab: ManagerTabId) => void
}

export const useManagerModalStore = create<ManagerModalState>((set) => ({
  open: false,
  tab: 'design',
  openModal: (tab = 'design') => set({ open: true, tab }),
  closeModal: () => set({ open: false }),
  setTab: (tab) => set({ tab }),
}))

export function ProjectManagerModal() {
  const { t } = useI18n()
  const open = useManagerModalStore(s => s.open)
  const tab = useManagerModalStore(s => s.tab)
  const setTab = useManagerModalStore(s => s.setTab)
  const closeModal = useManagerModalStore(s => s.closeModal)

  const [title, setTitle] = useState('')
  const [genre, setGenre] = useState('')
  const [perspective, setPerspective] = useState('')
  const [coreLoop, setCoreLoop] = useState('')
  const [winLose, setWinLose] = useState('')
  const [artStyle, setArtStyle] = useState('')
  const [paletteText, setPaletteText] = useState('')
  const [controls, setControls] = useState('')
  const [notes, setNotes] = useState('')

  const [packId, setPackId] = useState('user.my-pack')
  const [packName, setPackName] = useState('我的玩法包')
  const [packTier, setPackTier] = useState<PackTier>('gameplay')
  const [packBusy, setPackBusy] = useState(false)
  const [branchName, setBranchName] = useState('')
  const [cpLabel, setCpLabel] = useState('')
  const [exportMsg, setExportMsg] = useState('')
  const [buildBusy, setBuildBusy] = useState(false)
  const [buildProgress, setBuildProgress] = useState<BuildProgressInfo | null>(null)
  const buildSettings = useBuildSettingsStore((s) => s.settings)
  const setBuildSettings = useBuildSettingsStore((s) => s.setSettings)

  const installedPacks = usePackStore(s => s.installed)
  const assets = useAssetStore(s => s.assets)
  const activeSceneId = useEditorStore(s => s.activeSceneId)
  const editorNodes = useEditorStore(s => s.nodes)
  const gameplayPacks = useEditorStore(s => s.gameplayPacks)
  const gameDatabase = useEditorStore(s => s.gameDatabase)
  useCheckpointUiStore(s => s.revision)

  const sceneIdsKey = Object.values(assets).filter((a) => a.kind === 'scene').map((a) => a.id).join(',')
  useEffect(() => {
    if (!open || tab !== 'publish') return
    const ids = sceneIdsKey ? sceneIdsKey.split(',') : []
    void loadBuildSettingsFromProject(ids, activeSceneId)
  }, [open, tab, sceneIdsKey, activeSceneId])

  const updateBuild = (updater: (prev: BuildSettings) => BuildSettings) => {
    const ids = Object.values(assets).filter((a) => a.kind === 'scene').map((a) => a.id)
    const next = normalizeBuildSettings(updater(buildSettings), ids, activeSceneId)
    setBuildSettings(next)
    void saveBuildSettingsToProject(next)
  }

  useEffect(() => {
    if (!open) return
    const doc = getDesignDoc()
    setTitle(doc.title)
    setGenre(doc.genre)
    setPerspective(doc.perspective)
    setCoreLoop(doc.coreLoop)
    setWinLose(doc.winLose)
    setArtStyle(doc.artStyle)
    setPaletteText(doc.colorPalette.join(', '))
    setControls(doc.controls)
    setNotes(doc.notes)
  }, [open])

  if (!open) return null

  const report = diagnoseProject()
  const branches = listBranches()
  const currentBranch = branches.find(b => b.id === activeBranchId())
  const checkpoints = listCheckpoints()
  const recipes = listAllRecipes()
  const scenes = Object.values(assets).filter(a => a.kind === 'scene')
  const tableSchemas = listEnabledTableSchemas(gameplayPacks)
  const playStopped = useEditorStore.getState().playState === 'stopped'

  const saveDesign = async () => {
    await updateDesignDoc({
      title: title.trim() || undefined,
      genre: genre.trim(),
      perspective: perspective.trim(),
      coreLoop,
      winLose,
      artStyle,
      colorPalette: paletteText.split(/[,，]/).map(s => s.trim()).filter(Boolean),
      controls,
      notes,
    })
    useEditorStore.getState().notify(t('pm.savedDesign'))
  }

  const askAi = (prompt: string) => {
    closeModal()
    useAgentStore.getState().setPanelOpen(true)
    void useAgentStore.getState().sendPrompt(prompt)
  }

  const handleSediment = async () => {
    setPackBusy(true)
    try {
      const res = await sedimentProjectToPack({
        id: packId,
        name: packName,
        tier: packTier,
        migrateProjectScripts: true,
      })
      useEditorStore.getState().notify(res.ok ? t('pm.sedimentOk', { id: res.bundle?.manifest.id ?? '' }) : (res.error || t('pm.sedimentFail')))
    } finally {
      setPackBusy(false)
    }
  }

  const handleImportPackFile = async (file: File | undefined) => {
    if (!file) return
    try {
      const bundle = JSON.parse(await file.text()) as PackBundle
      if (!bundle?.manifest?.id) throw new Error(t('pm.packInvalid'))
      const res = await installPackBundle({ ...bundle, manifest: { ...bundle.manifest, trust: 'imported' } })
      useEditorStore.getState().notify(
        res.needsTrustConfirmation
          ? t('pm.importedTrust', { name: bundle.manifest.name })
          : t('pm.importedActive', { name: bundle.manifest.name }),
      )
    } catch (err) {
      useEditorStore.getState().notify(t('pm.importFail', { message: err instanceof Error ? err.message : String(err) }))
    }
  }

  const handleExport = async () => {
    const bridge = electronBridge()
    if (!bridge) {
      setExportMsg(t('pm.exportBrowser'))
      return
    }
    const dir = await bridge.dialog.showOpenDirectoryDialog()
    if (!dir) return
    setBuildBusy(true)
    setExportMsg('')
    setBuildProgress({ phase: 'prepare', current: 0, total: 1, label: '正在准备构建…' })
    try {
      const res = await exportWebPlayerBundle(dir, {
        settings: buildSettings,
        onProgress: (info) => setBuildProgress(info),
      })
      setExportMsg(res.message)
      if (res.ok) {
        await bridge.shell?.openPath(res.outputDir).catch(() => undefined)
      }
    } finally {
      setBuildBusy(false)
      setBuildProgress(null)
    }
  }

  const tabs: Array<{ id: ManagerTabId; label: string; icon: typeof BookOpen; badge?: string; warn?: boolean }> = [
    { id: 'design', label: t('pm.tab.design'), icon: BookOpen, badge: scenes.length > 0 ? t('pm.sceneCount', { count: scenes.length }) : undefined },
    { id: 'packs', label: t('pm.tab.packs'), icon: Package, badge: Object.keys(installedPacks).length > 0 ? `${Object.keys(installedPacks).length}` : undefined },
    { id: 'diagnose', label: t('pm.tab.diagnose'), icon: Activity, badge: report.issues.length > 0 ? `${report.issues.length}` : 'OK', warn: report.errorCount > 0 },
    { id: 'branches', label: t('pm.tab.branches'), icon: GitBranch, badge: branches.length > 1 ? `${branches.length}` : undefined },
    { id: 'publish', label: t('pm.tab.publish'), icon: FileDown },
  ]

  const m = report.metrics
  const budget = DEFAULT_PERFORMANCE_BUDGET
  const assetMb = m ? +(m.assetBytes / (1024 * 1024)).toFixed(2) : 0
  const maxMb = +(budget.maxAssetBytes / (1024 * 1024)).toFixed(0)

  return createPortal(
    <div className="pm-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) closeModal() }}>
      <div className="pm-modal">
        <header className="pm-header">
          <div className="pm-header__title">
            <Layers size={15} style={{ color: '#60a5fa' }} />
            <span>{t('pm.title')}</span>
          </div>
          <span className="pm-header__badge">{t('pm.branch', { name: currentBranch?.name ?? t('pm.main') })}</span>
          <span className={`pm-header__badge ${report.errorCount > 0 ? 'is-warn' : ''}`}>
            {report.errorCount === 0 ? t('pm.healthy') : t('pm.errors', { count: report.errorCount })}
          </span>
          <button type="button" className="pm-header__close" onClick={closeModal} aria-label={t('pm.close')}>
            <X size={16} />
          </button>
        </header>

        <div className="pm-body">
          <nav className="pm-nav">
            {tabs.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`pm-nav__item ${tab === item.id ? 'is-active' : ''}`}
                  onClick={() => setTab(item.id)}
                >
                  <Icon size={14} />
                  <span>{item.label}</span>
                  {item.badge && (
                    <span className={`pm-nav__count ${item.warn ? 'is-err' : ''}`}>{item.badge}</span>
                  )}
                </button>
              )
            })}
          </nav>

          <main className="pm-content">
            {tab === 'design' && (
              <>
                <div className="pm-section-head">
                  <div>
                    <h3>{t('pm.designTitle')}</h3>
                    <p>{t('pm.designLead')}</p>
                  </div>
                  <div className="pm-actions">
                    <button type="button" className="pm-btn pm-btn--ai" onClick={() => askAi(`请根据当前 design.md（${title}）检查并补全场景关卡与玩法组件。`)}>
                      <Sparkles size={13} /> {t('pm.askDesign')}
                    </button>
                    <button type="button" className="pm-btn pm-btn--primary" onClick={() => void saveDesign()}>
                      {t('pm.saveDesign')}
                    </button>
                  </div>
                </div>

                <div className="pm-card">
                  <div className="pm-card__title">
                    <span>{t('pm.flow')}</span>
                    <span className="pm-pill">{t('pm.scenes', { count: scenes.length })}</span>
                  </div>
                  {scenes.length === 0 ? (
                    <div style={{ fontSize: 12, color: '#71717a' }}>{t('pm.flowEmpty')}</div>
                  ) : (
                    <div className="pm-flow">
                      {scenes.map((sc, idx) => {
                        const active = sc.id === activeSceneId
                        return (
                          <div key={sc.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div className={`pm-flow__node ${active ? 'is-active' : ''}`}>
                              <div className="pm-row__title">
                                <span>{sc.name}</span>
                                {active && <span className="pm-pill pm-pill--ok">{t('pm.current')}</span>}
                              </div>
                              <div className="pm-row__sub">{t('pm.nodeCount', { count: Object.keys(sc.nodes).length })}</div>
                              <div className="pm-actions">
                                {!active && (
                                  <button
                                    type="button"
                                    className="pm-btn"
                                    style={{ height: 22, fontSize: 11 }}
                                    onClick={() => {
                                      useEditorStore.getState().openScene(sc.id)
                                      closeModal()
                                    }}
                                  >
                                    {t('pm.openEdit')}
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="pm-btn pm-btn--primary"
                                  style={{ height: 22, fontSize: 11 }}
                                  onClick={() => {
                                    if (!active) useEditorStore.getState().openScene(sc.id)
                                    useEditorStore.getState().play()
                                    closeModal()
                                  }}
                                >
                                  <Play size={10} /> {t('pm.playScene')}
                                </button>
                              </div>
                            </div>
                            {idx < scenes.length - 1 && <ArrowRight size={14} style={{ color: '#64748b' }} />}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                <div className="pm-card">
                  <div className="pm-card__title">{t('pm.settings')}</div>
                  <div className="pm-grid-3">
                    <label className="pm-field">
                      <span>{t('pm.projectName')}</span>
                      <input className="pm-input" value={title} onChange={e => setTitle(e.target.value)} />
                    </label>
                    <label className="pm-field">
                      <span>{t('pm.genre')}</span>
                      <input className="pm-input" value={genre} onChange={e => setGenre(e.target.value)} placeholder={t('pm.genrePh')} />
                    </label>
                    <label className="pm-field">
                      <span>{t('pm.camera')}</span>
                      <input className="pm-input" value={perspective} onChange={e => setPerspective(e.target.value)} placeholder={t('pm.cameraPh')} />
                    </label>
                  </div>
                  <div className="pm-grid-2">
                    <label className="pm-field">
                      <span>{t('pm.art')}</span>
                      <input className="pm-input" value={artStyle} onChange={e => setArtStyle(e.target.value)} placeholder={t('pm.artPh')} />
                    </label>
                    <label className="pm-field">
                      <span>{t('pm.palette')}</span>
                      <input className="pm-input" value={paletteText} onChange={e => setPaletteText(e.target.value)} placeholder="#1e293b, #38bdf8, #f59e0b" />
                    </label>
                  </div>
                  <div className="pm-grid-2">
                    <label className="pm-field">
                      <span>{t('pm.loop')}</span>
                      <textarea className="pm-textarea" value={coreLoop} onChange={e => setCoreLoop(e.target.value)} />
                    </label>
                    <label className="pm-field">
                      <span>{t('pm.win')}</span>
                      <textarea className="pm-textarea" value={winLose || controls} onChange={e => setWinLose(e.target.value)} />
                    </label>
                  </div>
                  <label className="pm-field">
                    <span>{t('pm.notes')}</span>
                    <textarea className="pm-textarea" value={notes} onChange={e => setNotes(e.target.value)} />
                  </label>
                </div>
              </>
            )}

            {tab === 'packs' && (
              <>
                <div className="pm-section-head">
                  <div>
                    <h3>{t('pm.packsTitle')}</h3>
                    <p>{t('pm.packsLead')}</p>
                  </div>
                  <label className="pm-btn" style={{ cursor: 'pointer' }}>
                    <Upload size={13} /> {t('pm.importPack')}
                    <input
                      type="file"
                      accept=".json"
                      style={{ display: 'none' }}
                      onChange={e => {
                        void handleImportPackFile(e.target.files?.[0])
                        e.currentTarget.value = ''
                      }}
                    />
                  </label>
                </div>

                <div className="pm-card">
                  <div className="pm-card__title">{t('pm.sedimentTitle')}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 150px auto', gap: 8, alignItems: 'center' }}>
                    <input className="pm-input" value={packId} onChange={e => setPackId(e.target.value)} placeholder={t('pm.packIdPh')} />
                    <input className="pm-input" value={packName} onChange={e => setPackName(e.target.value)} placeholder={t('pm.packNamePh')} />
                    <select className="pm-select" value={packTier} onChange={e => setPackTier(e.target.value as PackTier)}>
                      <option value="content">{t('pm.tier.content')}</option>
                      <option value="gameplay">{t('pm.tier.gameplay')}</option>
                      <option value="effect">{t('pm.tier.effect')}</option>
                    </select>
                    <button type="button" className="pm-btn pm-btn--primary" disabled={packBusy} onClick={() => void handleSediment()}>
                      {packBusy ? t('pm.sedimentBusy') : t('pm.sediment')}
                    </button>
                  </div>
                </div>

                <div className="pm-card">
                  <div className="pm-card__title">
                    <span>{t('pm.tables')}</span>
                    <button type="button" className="pm-btn pm-btn--ai" style={{ height: 22, fontSize: 11 }} onClick={() => askAi('请检查当前项目策划数据表（tables）的数值平衡性并给出优化建议。')}>
                      <Sparkles size={11} /> {t('pm.balance')}
                    </button>
                  </div>
                  {tableSchemas.length === 0 ? (
                    <div style={{ fontSize: 12, color: '#71717a' }}>{t('pm.noTables')}</div>
                  ) : (
                    <div className="pm-grid-3">
                      {tableSchemas.map(tb => {
                        const rows = tableRows(gameDatabase, tb.tableId)
                        return (
                          <div key={tb.tableId} className="pm-meter">
                            <div className="pm-meter__top">
                              <strong style={{ color: '#e4e4e7' }}>{tb.title}</strong>
                              <span>{t('pm.rows', { count: rows.length })}</span>
                            </div>
                            <div className="pm-row__sub">{tb.tableId}</div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                <div className="pm-card">
                  <div className="pm-card__title">{t('pm.installed', { count: Object.keys(installedPacks).length })}</div>
                  {Object.keys(installedPacks).length === 0 ? (
                    <div style={{ fontSize: 12, color: '#71717a' }}>{t('pm.noPacks')}</div>
                  ) : (
                    Object.values(installedPacks).map(rec => (
                      <div key={rec.bundle.manifest.id} className="pm-row">
                        <div className="pm-row__main">
                          <div className="pm-row__title">
                            <span>{rec.bundle.manifest.name}</span>
                            <span className="pm-pill">{rec.bundle.manifest.tier}</span>
                            <span className={`pm-pill ${rec.trusted ? 'pm-pill--ok' : 'pm-pill--warn'}`}>
                              {rec.trusted ? t('pm.trusted') : t('pm.untrusted')}
                            </span>
                          </div>
                          <div className="pm-row__sub">
                            {t('pm.packMeta', { id: rec.bundle.manifest.id, version: rec.bundle.manifest.version, scripts: rec.bundle.scripts.length, shaders: rec.bundle.shaders.length, components: rec.bundle.components.length })}
                          </div>
                        </div>
                        <div className="pm-actions">
                          {!rec.trusted && (
                            <button type="button" className="pm-btn pm-btn--primary" onClick={() => void trustAndActivatePack(rec.bundle.manifest.id)}>
                              <ShieldCheck size={12} /> {t('pm.trust')}
                            </button>
                          )}
                          <button type="button" className="pm-btn" onClick={() => uninstallPack(rec.bundle.manifest.id)}>
                            <Trash2 size={12} /> {t('pm.uninstall')}
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="pm-card">
                  <div className="pm-card__title">{t('pm.recipes', { count: recipes.length })}</div>
                  {recipes.map(recipe => (
                    <div key={recipe.id} className="pm-row">
                      <div className="pm-row__main">
                        <div className="pm-row__title">
                          <span>{recipe.name}</span>
                          <span className="pm-pill">{recipe.tier}</span>
                        </div>
                        <div className="pm-row__sub">{recipe.description}</div>
                      </div>
                      <button
                        type="button"
                        className="pm-btn pm-btn--ai"
                        onClick={() => askAi(`请按照配方「${recipe.name}」的步骤搭建示例场景：\n${recipe.steps.join('\n')}`)}
                      >
                        <Play size={12} /> {t('pm.buildRecipe')}
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}

            {tab === 'diagnose' && (
              <>
                <div className="pm-section-head">
                  <div>
                    <h3>{t('pm.diagnoseTitle')}</h3>
                    <p>{t('pm.diagnoseLead')}</p>
                  </div>
                  <button
                    type="button"
                    className="pm-btn pm-btn--ai"
                    onClick={() => askAi('请执行 query__project_diagnose 检查当前项目的问题与性能预算超标项，并逐一修复。')}
                  >
                    <Sparkles size={13} /> {t('pm.fixAll')}
                  </button>
                </div>

                {m && (
                  <div className="pm-grid-2">
                    <BudgetMeter label="DrawCall" value={m.drawCalls ?? 0} max={budget.maxDrawCalls} unit="" />
                    <BudgetMeter label={t('pm.triangles')} value={m.triangles ?? 0} max={budget.maxTriangles} unit="" />
                    <BudgetMeter label={t('pm.shadowLights')} value={m.shadowLights} max={budget.maxShadowLights} unit={t('pm.lightUnit')} />
                    <BudgetMeter label={t('pm.assetSize')} value={assetMb} max={maxMb} unit=" MB" />
                  </div>
                )}

                <div className="pm-card">
                  <div className="pm-card__title">
                    <span>{t('pm.issues')}</span>
                    <span>{t('pm.issueCounts', { errors: report.errorCount, warnings: report.warningCount })}</span>
                  </div>
                  {report.issues.length === 0 ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#4ade80', fontSize: 12 }}>
                      <CheckCircle2 size={16} /> {t('pm.allClear')}
                    </div>
                  ) : (
                    report.issues.map((issue, idx) => (
                      <div key={idx} className="pm-row">
                        <div className="pm-row__main">
                          <div className="pm-row__title">
                            <span className={`pm-pill ${issue.severity === 'error' ? 'pm-pill--err' : 'pm-pill--warn'}`}>
                              {issue.severity === 'error' ? t('pm.error') : t('pm.warning')} · {issue.category}
                            </span>
                            <span>{issue.message}</span>
                          </div>
                          {issue.hint && <div className="pm-row__sub">{t('pm.hint', { hint: issue.hint })}</div>}
                        </div>
                        <button
                          type="button"
                          className="pm-btn pm-btn--ai"
                          onClick={() => askAi(`请修复以下项目体检问题：[${issue.category}] ${issue.message}${issue.target ? `（目标对象 ID: ${issue.target}）` : ''}。建议：${issue.hint}`)}
                        >
                          <Sparkles size={12} /> {t('pm.fix')}
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}

            {tab === 'branches' && (
              <>
                <div className="pm-section-head">
                  <div>
                    <h3>{t('pm.branchTitle')}</h3>
                    <p>{t('pm.branchLead')}</p>
                  </div>
                </div>

                <div className="pm-card">
                  <div className="pm-card__title">{t('pm.branches')}</div>
                  <div className="pm-inline">
                    <input
                      className="pm-input"
                      value={branchName}
                      onChange={e => setBranchName(e.target.value)}
                      placeholder={t('pm.branchPh')}
                    />
                    <button
                      type="button"
                      className="pm-btn pm-btn--primary"
                      disabled={!playStopped}
                      onClick={() => {
                        const res = createBranch(branchName || t('pm.branchDefault'))
                        if (res.ok) setBranchName('')
                        else useEditorStore.getState().notify(res.error || t('pm.branchFail'))
                      }}
                    >
                      {t('pm.createBranch')}
                    </button>
                  </div>

                  {branches.map(b => {
                    const diff = b.id !== 'main' ? diffBranchWithMain(b.id) : null
                    return (
                      <div key={b.id} className="pm-row">
                        <div className="pm-row__main">
                          <div className="pm-row__title">
                            <span>{b.name}</span>
                            {b.isActive && <span className="pm-pill pm-pill--ok">{t('pm.active')}</span>}
                          </div>
                          <div className="pm-row__sub">
                            {t('pm.branchDiff', {
                              count: b.nodeCount,
                              diff: diff ? t('pm.diff', { added: diff.added.length, modified: diff.modified.length, removed: diff.removed.length }) : '',
                            })}
                          </div>
                        </div>
                        <div className="pm-actions">
                          {!b.isActive && (
                            <button type="button" className="pm-btn" disabled={!playStopped} onClick={() => switchBranch(b.id)}>
                              {t('pm.switch')}
                            </button>
                          )}
                          {b.id !== 'main' && (
                            <button type="button" className="pm-btn pm-btn--primary" disabled={!playStopped} onClick={() => promoteBranchToMain(b.id)}>
                              {t('pm.promote')}
                            </button>
                          )}
                          {b.id !== 'main' && !b.isActive && (
                            <button type="button" className="pm-btn" onClick={() => deleteBranch(b.id)}>
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>

                <div className="pm-card">
                  <div className="pm-card__title">{t('pm.checkpoints')}</div>
                  <div className="pm-inline">
                    <input
                      className="pm-input"
                      value={cpLabel}
                      onChange={e => setCpLabel(e.target.value)}
                      placeholder={t('pm.checkpointPh')}
                    />
                    <button
                      type="button"
                      className="pm-btn"
                      onClick={() => {
                        void createCheckpoint(cpLabel || t('pm.checkpointDefault'), true).then(() => setCpLabel(''))
                      }}
                    >
                      {t('pm.saveCheckpoint')}
                    </button>
                  </div>
                  {checkpoints.length === 0 ? (
                    <div style={{ fontSize: 12, color: '#71717a' }}>{t('pm.noCheckpoints')}</div>
                  ) : (
                    checkpoints.map(cp => (
                      <div key={cp.id} className="pm-row">
                        <div className="pm-row__main">
                          <div className="pm-row__title">{cp.label}</div>
                          <div className="pm-row__sub">{t('pm.checkpointMeta', { time: new Date(cp.createdAt).toLocaleTimeString(), count: cp.nodeCount })}</div>
                        </div>
                        <div className="pm-actions">
                          <button type="button" className="pm-btn" onClick={() => toggleCheckpointStar(cp.id)}>
                            <Star size={12} color={cp.starred ? '#facc15' : '#a1a1aa'} fill={cp.starred ? '#facc15' : 'none'} />
                          </button>
                          <button type="button" className="pm-btn" disabled={!playStopped} onClick={() => createBranch(t('pm.branchSuffix', { label: cp.label }), cp.id)}>
                            {t('pm.branchFrom')}
                          </button>
                          <button type="button" className="pm-btn" disabled={!playStopped} onClick={() => restoreCheckpoint(cp.id)}>
                            {t('pm.restore')}
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}

            {tab === 'publish' && (() => {
              const builtPreview = resolveScenesForBuild(buildSettings)
              const depCount = new Set(builtPreview.flatMap((s) => s.requiredAssetIds)).size
              const totalNonSceneAssets = Object.values(assets).filter((a) => a.kind !== 'scene').length
              const textureAssets = Object.values(assets).filter((a) => a.kind === 'texture')
              const logoTex = buildSettings.loading.logoAssetId ? assets[buildSettings.loading.logoAssetId] : undefined
              const logoUrl = logoTex && 'url' in logoTex ? logoTex.url : undefined

              return (
                <>
                  <div className="pm-section-head">
                    <div>
                      <h3>{t('pm.publishTitle')}</h3>
                      <p>配置目标平台、参与打包的场景与初始场景、资源优化与预加载策略，以及自定义 Loading 画面。</p>
                    </div>
                  </div>

                  {/* 目标平台 */}
                  <div className="pm-card">
                    <div className="pm-card__title">目标平台（Build Target）</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        className={`pm-btn ${buildSettings.target === 'web' ? 'pm-btn--primary' : ''}`}
                        onClick={() => updateBuild((p) => ({ ...p, target: 'web' }))}
                      >
                        <Globe size={13} /> Web 播放包（静态托管）
                      </button>
                      <button
                        type="button"
                        className={`pm-btn ${buildSettings.target === 'electron' ? 'pm-btn--primary' : ''}`}
                        onClick={() => updateBuild((p) => ({ ...p, target: 'electron' }))}
                      >
                        <Monitor size={13} /> Electron 桌面端（独立 EXE）
                      </button>
                    </div>
                    {buildSettings.target === 'electron' && (
                      <div className="pm-grid-2" style={{ marginTop: 10 }}>
                        <label className="pm-field">
                          <span>应用名称（EXE 名称）</span>
                          <input
                            value={buildSettings.electron.appName}
                            onChange={(e) => updateBuild((p) => ({ ...p, electron: { ...p.electron, appName: e.target.value } }))}
                          />
                        </label>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                          <label className="pm-field">
                            <span>窗口宽度</span>
                            <input
                              type="number"
                              min={320}
                              value={buildSettings.electron.width}
                              onChange={(e) => updateBuild((p) => ({ ...p, electron: { ...p.electron, width: Number(e.target.value) || 1280 } }))}
                            />
                          </label>
                          <label className="pm-field">
                            <span>窗口高度</span>
                            <input
                              type="number"
                              min={240}
                              value={buildSettings.electron.height}
                              onChange={(e) => updateBuild((p) => ({ ...p, electron: { ...p.electron, height: Number(e.target.value) || 720 } }))}
                            />
                          </label>
                        </div>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                          <input
                            type="checkbox"
                            checked={buildSettings.electron.fullscreen}
                            onChange={(e) => updateBuild((p) => ({ ...p, electron: { ...p.electron, fullscreen: e.target.checked } }))}
                          />
                          默认全屏启动
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                          <input
                            type="checkbox"
                            checked={buildSettings.electron.resizable}
                            onChange={(e) => updateBuild((p) => ({ ...p, electron: { ...p.electron, resizable: e.target.checked } }))}
                          />
                          允许调整窗口大小
                        </label>
                      </div>
                    )}
                  </div>

                  {/* 场景配置 */}
                  <div className="pm-card">
                    <div className="pm-card__title">构建场景（Scenes In Build）</div>
                    <div className="pm-list" style={{ gap: 4 }}>
                      {buildSettings.scenes.map((entry, idx) => {
                        const sc = assets[entry.sceneId]
                        if (!sc || sc.kind !== 'scene') return null
                        const isEntry = buildSettings.entrySceneId === entry.sceneId
                        const nodeCount = entry.sceneId === activeSceneId ? Object.keys(editorNodes).length : Object.keys(sc.nodes).length
                        return (
                          <div
                            key={entry.sceneId}
                            className="pm-row"
                            style={{
                              padding: '6px 8px',
                              borderRadius: 6,
                              border: isEntry ? '1px solid rgba(74,158,255,0.45)' : '1px solid rgba(255,255,255,0.06)',
                              background: entry.enabled ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.18)',
                              opacity: entry.enabled ? 1 : 0.65,
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <input
                                type="checkbox"
                                checked={entry.enabled}
                                onChange={(e) => updateBuild((p) => ({
                                  ...p,
                                  scenes: p.scenes.map((s) => (s.sceneId === entry.sceneId ? { ...s, enabled: e.target.checked } : s)),
                                }))}
                              />
                              <span style={{ fontSize: 11, color: '#94a3b8', minWidth: 18 }}>#{idx}</span>
                              <strong style={{ fontSize: 12 }}>{sc.name}</strong>
                              <span className="pm-pill">{nodeCount} 节点</span>
                              {isEntry && <span className="pm-pill" style={{ background: 'rgba(34,197,94,0.16)', color: '#86efac' }}>初始场景</span>}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              {entry.enabled && !isEntry && (
                                <button
                                  type="button"
                                  className="pm-btn"
                                  style={{ padding: '2px 8px', fontSize: 11 }}
                                  onClick={() => updateBuild((p) => ({ ...p, entrySceneId: entry.sceneId }))}
                                >
                                  设为初始
                                </button>
                              )}
                              <button
                                type="button"
                                className="pm-btn"
                                style={{ padding: '2px 5px' }}
                                disabled={idx === 0}
                                onClick={() => updateBuild((p) => {
                                  const next = [...p.scenes]
                                  const [item] = next.splice(idx, 1)
                                  next.splice(idx - 1, 0, item)
                                  return { ...p, scenes: next }
                                })}
                              >
                                <ArrowUp size={12} />
                              </button>
                              <button
                                type="button"
                                className="pm-btn"
                                style={{ padding: '2px 5px' }}
                                disabled={idx === buildSettings.scenes.length - 1}
                                onClick={() => updateBuild((p) => {
                                  const next = [...p.scenes]
                                  const [item] = next.splice(idx, 1)
                                  next.splice(idx + 1, 0, item)
                                  return { ...p, scenes: next }
                                })}
                              >
                                <ArrowDown size={12} />
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  {/* 资源管理与预加载 */}
                  <div className="pm-card">
                    <div className="pm-card__title">资源烘焙与预加载策略</div>
                    <div className="pm-grid-2">
                      <label className="pm-field">
                        <span>预加载策略</span>
                        <select
                          value={buildSettings.preloadMode}
                          onChange={(e) => updateBuild((p) => ({ ...p, preloadMode: e.target.value as PreloadMode }))}
                        >
                          <option value="entry-scene">仅预加载初始场景（后台静默预热其余场景）</option>
                          <option value="all-scenes">首屏预加载全部打包场景</option>
                          <option value="minimal">按需流式加载（最快进场）</option>
                        </select>
                      </label>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <label className="pm-field">
                          <span>贴图压缩格式</span>
                          <select
                            value={buildSettings.textureMode}
                            onChange={(e) => updateBuild((p) => ({ ...p, textureMode: e.target.value as TextureBuildMode }))}
                          >
                            <option value="webp">高压缩 WebP（推荐）</option>
                            <option value="original">保持原始格式</option>
                          </select>
                        </label>
                        <label className="pm-field">
                          <span>贴图最大尺寸</span>
                          <select
                            value={buildSettings.textureMaxSize}
                            onChange={(e) => updateBuild((p) => ({ ...p, textureMaxSize: Number(e.target.value) as TextureMaxSize }))}
                          >
                            <option value={0}>不限制</option>
                            <option value={2048}>2048 px</option>
                            <option value={1024}>1024 px</option>
                            <option value={512}>512 px</option>
                          </select>
                        </label>
                      </div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                        <input
                          type="checkbox"
                          checked={buildSettings.bakeModelsToGlb}
                          onChange={(e) => updateBuild((p) => ({ ...p, bakeModelsToGlb: e.target.checked }))}
                        />
                        模型烘焙为 Meshopt 压缩二进制 (.glb)
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                        <input
                          type="checkbox"
                          checked={buildSettings.stripUnusedAssets}
                          onChange={(e) => updateBuild((p) => ({ ...p, stripUnusedAssets: e.target.checked }))}
                        />
                        剔除未引用资源（预计打包 {buildSettings.stripUnusedAssets ? depCount : totalNonSceneAssets} / {totalNonSceneAssets} 个）
                      </label>
                    </div>
                  </div>

                  {/* Loading 画面自定义 */}
                  <div className="pm-card">
                    <div className="pm-card__title">Loading 画面配置</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 14, alignItems: 'start' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 12 }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <input
                              type="checkbox"
                              checked={buildSettings.loading.enabled}
                              onChange={(e) => updateBuild((p) => ({ ...p, loading: { ...p.loading, enabled: e.target.checked } }))}
                            />
                            开启 Loading 画面
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <input
                              type="checkbox"
                              checked={buildSettings.loading.showProgressBar}
                              onChange={(e) => updateBuild((p) => ({ ...p, loading: { ...p.loading, showProgressBar: e.target.checked } }))}
                            />
                            显示进度条
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <input
                              type="checkbox"
                              checked={buildSettings.loading.showOnSceneSwitch}
                              onChange={(e) => updateBuild((p) => ({ ...p, loading: { ...p.loading, showOnSceneSwitch: e.target.checked } }))}
                            />
                            切场景时显示
                          </label>
                        </div>
                        <div className="pm-grid-2">
                          <label className="pm-field">
                            <span>标题</span>
                            <input
                              value={buildSettings.loading.title}
                              onChange={(e) => updateBuild((p) => ({ ...p, loading: { ...p.loading, title: e.target.value } }))}
                            />
                          </label>
                          <label className="pm-field">
                            <span>提示副标题</span>
                            <input
                              value={buildSettings.loading.subtitle}
                              onChange={(e) => updateBuild((p) => ({ ...p, loading: { ...p.loading, subtitle: e.target.value } }))}
                            />
                          </label>
                          <label className="pm-field">
                            <span>Logo 贴图</span>
                            <select
                              value={buildSettings.loading.logoAssetId ?? ''}
                              onChange={(e) => updateBuild((p) => ({ ...p, loading: { ...p.loading, logoAssetId: e.target.value || null } }))}
                            >
                              <option value="">无</option>
                              {textureAssets.map((tex) => (
                                <option key={tex.id} value={tex.id}>{tex.name}</option>
                              ))}
                            </select>
                          </label>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                            <label className="pm-field">
                              <span>背景色</span>
                              <input
                                type="color"
                                value={buildSettings.loading.backgroundColor}
                                onChange={(e) => updateBuild((p) => ({ ...p, loading: { ...p.loading, backgroundColor: e.target.value } }))}
                                style={{ height: 28, padding: 2 }}
                              />
                            </label>
                            <label className="pm-field">
                              <span>进度条颜色</span>
                              <input
                                type="color"
                                value={buildSettings.loading.accentColor}
                                onChange={(e) => updateBuild((p) => ({ ...p, loading: { ...p.loading, accentColor: e.target.value } }))}
                                style={{ height: 28, padding: 2 }}
                              />
                            </label>
                          </div>
                        </div>
                      </div>
                      {/* Loading 实时预览 */}
                      <div
                        style={{
                          borderRadius: 8,
                          padding: 16,
                          minHeight: 140,
                          backgroundColor: buildSettings.loading.backgroundColor,
                          border: '1px solid rgba(255,255,255,0.1)',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 8,
                          textAlign: 'center',
                          opacity: buildSettings.loading.enabled ? 1 : 0.4,
                        }}
                      >
                        {logoUrl && <img src={logoUrl} alt="" style={{ maxWidth: 64, maxHeight: 36, objectFit: 'contain' }} />}
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9' }}>
                          {buildSettings.loading.title || 'Tact3D'}
                        </div>
                        <div style={{ fontSize: 10, color: '#94a3b8' }}>
                          {buildSettings.loading.subtitle || '正在加载资源…'}
                        </div>
                        {buildSettings.loading.showProgressBar && (
                          <div style={{ width: '80%', height: 5, borderRadius: 999, background: 'rgba(255,255,255,0.14)', overflow: 'hidden' }}>
                            <div style={{ width: '64%', height: '100%', background: buildSettings.loading.accentColor }} />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 构建门禁与执行 */}
                  <div className="pm-card">
                    <div className="pm-card__title">{t('pm.gate')}</div>
                    <div style={{ fontSize: 12, color: report.errorCount === 0 ? '#4ade80' : '#fca5a5' }}>
                      {report.errorCount === 0
                        ? t('pm.gateOk')
                        : t('pm.gateBad', { count: report.errorCount })}
                    </div>
                    <div className="pm-actions">
                      <button
                        type="button"
                        className="pm-btn pm-btn--primary"
                        disabled={buildBusy}
                        onClick={() => void handleExport()}
                      >
                        <FileDown size={13} />
                        {buildBusy
                          ? '正在构建…'
                          : buildSettings.target === 'electron'
                            ? '选择目录并构建桌面端'
                            : t('pm.export')}
                      </button>
                      <button type="button" className="pm-btn pm-btn--ai" disabled={buildBusy} onClick={() => askAi('请先运行一次冒烟试玩验证与体检，确认无误后提示我构建。')}>
                        <Play size={13} /> {t('pm.smoke')}
                      </button>
                    </div>
                    {buildProgress && (
                      <div style={{ fontSize: 11, color: '#93c5fd', marginTop: 6 }}>
                        {buildProgress.label}
                      </div>
                    )}
                    {exportMsg && <div style={{ fontSize: 12, color: '#93c5fd', marginTop: 6 }}>{exportMsg}</div>}
                  </div>
                </>
              )
            })()}
          </main>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function BudgetMeter({ label, value, max, unit }: { label: string; value: number; max: number; unit: string }) {
  const ratio = max > 0 ? Math.min(1, value / max) : 0
  const state = ratio >= 1 ? 'is-err' : ratio >= 0.8 ? 'is-warn' : ''
  return (
    <div className="pm-meter">
      <div className="pm-meter__top">
        <span>{label}</span>
        <strong style={{ color: state === 'is-err' ? '#fca5a5' : state === 'is-warn' ? '#fde68a' : '#e4e4e7' }}>
          {value}{unit} / {max}{unit}
        </strong>
      </div>
      <div className="pm-meter__bar">
        <div className={`pm-meter__fill ${state}`} style={{ width: `${Math.round(ratio * 100)}%` }} />
      </div>
    </div>
  )
}
