import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Activity,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  FileDown,
  GitBranch,
  Layers,
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
import { useEditorStore } from '../../editor/scene/store'
import { listEnabledTableSchemas, tableRows } from '../../gameplay/registry'
import { exportWebPlayerBundle } from '../../player/exporter'
import { installPackBundle, listAllRecipes, sedimentProjectToPack, trustAndActivatePack, uninstallPack, usePackStore } from '../packs/manager'
import type { PackBundle, PackTier } from '../packs/types'
import { DEFAULT_PERFORMANCE_BUDGET, diagnoseProject } from '../query/diagnose'
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

  const installedPacks = usePackStore(s => s.installed)
  const assets = useAssetStore(s => s.assets)
  const activeSceneId = useEditorStore(s => s.activeSceneId)
  const gameplayPacks = useEditorStore(s => s.gameplayPacks)
  const gameDatabase = useEditorStore(s => s.gameDatabase)
  useCheckpointUiStore(s => s.revision)

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
    useEditorStore.getState().notify('设计蓝图 design.md 已保存')
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
      useEditorStore.getState().notify(res.ok ? `能力包 ${res.bundle?.manifest.id} 已沉淀并注册` : (res.error || '沉淀失败'))
    } finally {
      setPackBusy(false)
    }
  }

  const handleImportPackFile = async (file: File | undefined) => {
    if (!file) return
    try {
      const bundle = JSON.parse(await file.text()) as PackBundle
      if (!bundle?.manifest?.id) throw new Error('无效的 pack.json 清单格式')
      const res = await installPackBundle({ ...bundle, manifest: { ...bundle.manifest, trust: 'imported' } })
      useEditorStore.getState().notify(
        res.needsTrustConfirmation
          ? `已导入「${bundle.manifest.name}」，请点击「信任并启用脚本」后激活`
          : `已导入并激活能力包「${bundle.manifest.name}」`,
      )
    } catch (err) {
      useEditorStore.getState().notify(`导入失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const handleExport = async () => {
    const bridge = electronBridge()
    if (!bridge) {
      setExportMsg('当前为浏览器模式，请在 Electron 桌面端导出 Web 播放包。')
      return
    }
    const dir = await bridge.dialog.showOpenDirectoryDialog()
    if (!dir) return
    const res = await exportWebPlayerBundle(dir)
    setExportMsg(res.message)
  }

  const tabs: Array<{ id: ManagerTabId; label: string; icon: typeof BookOpen; badge?: string; warn?: boolean }> = [
    { id: 'design', label: '立项与流图', icon: BookOpen, badge: scenes.length > 0 ? `${scenes.length}场景` : undefined },
    { id: 'packs', label: '策划表与能力包', icon: Package, badge: Object.keys(installedPacks).length > 0 ? `${Object.keys(installedPacks).length}` : undefined },
    { id: 'diagnose', label: '体检与预算', icon: Activity, badge: report.issues.length > 0 ? `${report.issues.length}` : 'OK', warn: report.errorCount > 0 },
    { id: 'branches', label: '快照与分支', icon: GitBranch, badge: branches.length > 1 ? `${branches.length}` : undefined },
    { id: 'publish', label: '验证与发布', icon: FileDown },
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
            <span>T3D 工程管理中心</span>
          </div>
          <span className="pm-header__badge">分支：{currentBranch?.name ?? '主线 (main)'}</span>
          <span className={`pm-header__badge ${report.errorCount > 0 ? 'is-warn' : ''}`}>
            {report.errorCount === 0 ? '体检健康' : `${report.errorCount} 阻塞错误`}
          </span>
          <button type="button" className="pm-header__close" onClick={closeModal} aria-label="关闭">
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
                    <h3>立项蓝图与关卡流转 (design.md)</h3>
                    <p>全局设计记忆会随每轮对话自动注入 AI 上下文，保证多轮协作风格与玩法不跑偏</p>
                  </div>
                  <div className="pm-actions">
                    <button type="button" className="pm-btn pm-btn--ai" onClick={() => askAi(`请根据当前 design.md（${title}）检查并补全场景关卡与玩法组件。`)}>
                      <Sparkles size={13} /> 按蓝图交办 AI
                    </button>
                    <button type="button" className="pm-btn pm-btn--primary" onClick={() => void saveDesign()}>
                      保存蓝图
                    </button>
                  </div>
                </div>

                <div className="pm-card">
                  <div className="pm-card__title">
                    <span>多场景关卡流转图 (Scene Flow)</span>
                    <span className="pm-pill">{scenes.length} 个场景</span>
                  </div>
                  {scenes.length === 0 ? (
                    <div style={{ fontSize: 12, color: '#71717a' }}>当前工程仅含默认临时场景，保存或新建场景资产后将在此展示关卡流。</div>
                  ) : (
                    <div className="pm-flow">
                      {scenes.map((sc, idx) => {
                        const active = sc.id === activeSceneId
                        return (
                          <div key={sc.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div className={`pm-flow__node ${active ? 'is-active' : ''}`}>
                              <div className="pm-row__title">
                                <span>{sc.name}</span>
                                {active && <span className="pm-pill pm-pill--ok">当前</span>}
                              </div>
                              <div className="pm-row__sub">节点数: {Object.keys(sc.nodes).length}</div>
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
                                    切入编辑
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
                                  <Play size={10} /> 跳关试玩
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
                  <div className="pm-card__title">项目设定与美术规范</div>
                  <div className="pm-grid-3">
                    <label className="pm-field">
                      <span>项目名称</span>
                      <input className="pm-input" value={title} onChange={e => setTitle(e.target.value)} />
                    </label>
                    <label className="pm-field">
                      <span>游戏类型</span>
                      <input className="pm-input" value={genre} onChange={e => setGenre(e.target.value)} placeholder="如：平台跳跃 / RTS / TPS" />
                    </label>
                    <label className="pm-field">
                      <span>镜头视角</span>
                      <input className="pm-input" value={perspective} onChange={e => setPerspective(e.target.value)} placeholder="如：第三人称追尾 / 俯视角" />
                    </label>
                  </div>
                  <div className="pm-grid-2">
                    <label className="pm-field">
                      <span>美术风格关键词</span>
                      <input className="pm-input" value={artStyle} onChange={e => setArtStyle(e.target.value)} placeholder="低多边形、赛博霓虹、高对比光影" />
                    </label>
                    <label className="pm-field">
                      <span>色彩板 (逗号分隔)</span>
                      <input className="pm-input" value={paletteText} onChange={e => setPaletteText(e.target.value)} placeholder="#1e293b, #38bdf8, #f59e0b" />
                    </label>
                  </div>
                  <div className="pm-grid-2">
                    <label className="pm-field">
                      <span>核心玩法循环</span>
                      <textarea className="pm-textarea" value={coreLoop} onChange={e => setCoreLoop(e.target.value)} />
                    </label>
                    <label className="pm-field">
                      <span>胜负条件与操控说明</span>
                      <textarea className="pm-textarea" value={winLose || controls} onChange={e => setWinLose(e.target.value)} />
                    </label>
                  </div>
                  <label className="pm-field">
                    <span>补充备注</span>
                    <textarea className="pm-textarea" value={notes} onChange={e => setNotes(e.target.value)} />
                  </label>
                </div>
              </>
            )}

            {tab === 'packs' && (
              <>
                <div className="pm-section-head">
                  <div>
                    <h3>策划数值表、能力包沉淀与配方库</h3>
                    <p>支持将本工程脚本与着色器沉淀为标准能力包，或导入外部 pack.json 并进行安全信任确认</p>
                  </div>
                  <label className="pm-btn" style={{ cursor: 'pointer' }}>
                    <Upload size={13} /> 导入 pack.json
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
                  <div className="pm-card__title">一键沉淀当前工程为能力包（自动规整 __project__ 脚本）</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 150px auto', gap: 8, alignItems: 'center' }}>
                    <input className="pm-input" value={packId} onChange={e => setPackId(e.target.value)} placeholder="包 ID (如 user.my-rts)" />
                    <input className="pm-input" value={packName} onChange={e => setPackName(e.target.value)} placeholder="显示名称" />
                    <select className="pm-select" value={packTier} onChange={e => setPackTier(e.target.value as PackTier)}>
                      <option value="content">内容包 (content)</option>
                      <option value="gameplay">玩法包 (gameplay)</option>
                      <option value="effect">效果包 (effect)</option>
                    </select>
                    <button type="button" className="pm-btn pm-btn--primary" disabled={packBusy} onClick={() => void handleSediment()}>
                      {packBusy ? '沉淀中…' : '一键沉淀'}
                    </button>
                  </div>
                </div>

                <div className="pm-card">
                  <div className="pm-card__title">
                    <span>工程策划数据表概览</span>
                    <button type="button" className="pm-btn pm-btn--ai" style={{ height: 22, fontSize: 11 }} onClick={() => askAi('请检查当前工程策划数据表（tables）的数值平衡性并给出优化建议。')}>
                      <Sparkles size={11} /> 让 AI 平衡数值
                    </button>
                  </div>
                  {tableSchemas.length === 0 ? (
                    <div style={{ fontSize: 12, color: '#71717a' }}>当前无已启用的策划数据表。</div>
                  ) : (
                    <div className="pm-grid-3">
                      {tableSchemas.map(tb => {
                        const rows = tableRows(gameDatabase, tb.tableId)
                        return (
                          <div key={tb.tableId} className="pm-meter">
                            <div className="pm-meter__top">
                              <strong style={{ color: '#e4e4e7' }}>{tb.title}</strong>
                              <span>{rows.length} 行</span>
                            </div>
                            <div className="pm-row__sub">{tb.tableId}</div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                <div className="pm-card">
                  <div className="pm-card__title">已安装用户能力包 ({Object.keys(installedPacks).length})</div>
                  {Object.keys(installedPacks).length === 0 ? (
                    <div style={{ fontSize: 12, color: '#71717a' }}>暂未安装用户沉淀包。</div>
                  ) : (
                    Object.values(installedPacks).map(rec => (
                      <div key={rec.bundle.manifest.id} className="pm-row">
                        <div className="pm-row__main">
                          <div className="pm-row__title">
                            <span>{rec.bundle.manifest.name}</span>
                            <span className="pm-pill">{rec.bundle.manifest.tier}</span>
                            <span className={`pm-pill ${rec.trusted ? 'pm-pill--ok' : 'pm-pill--warn'}`}>
                              {rec.trusted ? '已信任' : '待信任确认'}
                            </span>
                          </div>
                          <div className="pm-row__sub">
                            {rec.bundle.manifest.id}@{rec.bundle.manifest.version} · 脚本 {rec.bundle.scripts.length} · 着色器 {rec.bundle.shaders.length} · 组件 {rec.bundle.components.length}
                          </div>
                        </div>
                        <div className="pm-actions">
                          {!rec.trusted && (
                            <button type="button" className="pm-btn pm-btn--primary" onClick={() => void trustAndActivatePack(rec.bundle.manifest.id)}>
                              <ShieldCheck size={12} /> 信任并启用
                            </button>
                          )}
                          <button type="button" className="pm-btn" onClick={() => uninstallPack(rec.bundle.manifest.id)}>
                            <Trash2 size={12} /> 卸载
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="pm-card">
                  <div className="pm-card__title">可用官方与用户配方 ({recipes.length})</div>
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
                        <Play size={12} /> 按配方搭建
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
                    <h3>工程体检与性能预算看板</h3>
                    <p>实时监控场景规模、DrawCall、三角面数与引用完整性，异常项可直接交办 AI 修复</p>
                  </div>
                  <button
                    type="button"
                    className="pm-btn pm-btn--ai"
                    onClick={() => askAi('请执行 query__project_diagnose 检查当前工程的问题与性能预算超标项，并逐一修复。')}
                  >
                    <Sparkles size={13} /> 全部交办 AI 自检修复
                  </button>
                </div>

                {m && (
                  <div className="pm-grid-2">
                    <BudgetMeter label="DrawCall" value={m.drawCalls ?? 0} max={budget.maxDrawCalls} unit="" />
                    <BudgetMeter label="三角面数" value={m.triangles ?? 0} max={budget.maxTriangles} unit="" />
                    <BudgetMeter label="阴影光源" value={m.shadowLights} max={budget.maxShadowLights} unit=" 盏" />
                    <BudgetMeter label="资产总体积" value={assetMb} max={maxMb} unit=" MB" />
                  </div>
                )}

                <div className="pm-card">
                  <div className="pm-card__title">
                    <span>体检明细</span>
                    <span>{report.errorCount} 错误 · {report.warningCount} 警告</span>
                  </div>
                  {report.issues.length === 0 ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#4ade80', fontSize: 12 }}>
                      <CheckCircle2 size={16} /> 工程体检与性能预算全部通过！
                    </div>
                  ) : (
                    report.issues.map((issue, idx) => (
                      <div key={idx} className="pm-row">
                        <div className="pm-row__main">
                          <div className="pm-row__title">
                            <span className={`pm-pill ${issue.severity === 'error' ? 'pm-pill--err' : 'pm-pill--warn'}`}>
                              {issue.severity === 'error' ? '错误' : '警告'} · {issue.category}
                            </span>
                            <span>{issue.message}</span>
                          </div>
                          {issue.hint && <div className="pm-row__sub">建议：{issue.hint}</div>}
                        </div>
                        <button
                          type="button"
                          className="pm-btn pm-btn--ai"
                          onClick={() => askAi(`请修复以下工程体检问题：[${issue.category}] ${issue.message}${issue.target ? `（目标对象 ID: ${issue.target}）` : ''}。建议：${issue.hint}`)}
                        >
                          <Sparkles size={12} /> 交给 AI 修
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
                    <h3>版本快照与轻量实验分支</h3>
                    <p>可从任意节点拉出实验分支进行 A/B 方案试玩对比，确认效果后一键设为主线</p>
                  </div>
                </div>

                <div className="pm-card">
                  <div className="pm-card__title">实验分支 (Branches)</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      className="pm-input"
                      value={branchName}
                      onChange={e => setBranchName(e.target.value)}
                      placeholder="新实验分支名称（如：方案B-快节奏手感）"
                    />
                    <button
                      type="button"
                      className="pm-btn pm-btn--primary"
                      disabled={!playStopped}
                      onClick={() => {
                        const res = createBranch(branchName || '实验分支')
                        if (res.ok) setBranchName('')
                        else useEditorStore.getState().notify(res.error || '创建失败')
                      }}
                    >
                      拉出实验分支
                    </button>
                  </div>

                  {branches.map(b => {
                    const diff = b.id !== 'main' ? diffBranchWithMain(b.id) : null
                    return (
                      <div key={b.id} className="pm-row">
                        <div className="pm-row__main">
                          <div className="pm-row__title">
                            <span>{b.name}</span>
                            {b.isActive && <span className="pm-pill pm-pill--ok">当前激活</span>}
                          </div>
                          <div className="pm-row__sub">
                            节点 {b.nodeCount}
                            {diff ? ` · 相对主线：+${diff.added.length} 新增 / ~${diff.modified.length} 修改 / -${diff.removed.length} 删除` : ''}
                          </div>
                        </div>
                        <div className="pm-actions">
                          {!b.isActive && (
                            <button type="button" className="pm-btn" disabled={!playStopped} onClick={() => switchBranch(b.id)}>
                              切换对比
                            </button>
                          )}
                          {b.id !== 'main' && (
                            <button type="button" className="pm-btn pm-btn--primary" disabled={!playStopped} onClick={() => promoteBranchToMain(b.id)}>
                              设为主线
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
                  <div className="pm-card__title">版本快照 (Checkpoints)</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      className="pm-input"
                      value={cpLabel}
                      onChange={e => setCpLabel(e.target.value)}
                      placeholder="里程碑快照备注…"
                    />
                    <button
                      type="button"
                      className="pm-btn"
                      onClick={() => {
                        void createCheckpoint(cpLabel || '手动里程碑', true).then(() => setCpLabel(''))
                      }}
                    >
                      保存里程碑
                    </button>
                  </div>
                  {checkpoints.length === 0 ? (
                    <div style={{ fontSize: 12, color: '#71717a' }}>暂无快照记录。</div>
                  ) : (
                    checkpoints.map(cp => (
                      <div key={cp.id} className="pm-row">
                        <div className="pm-row__main">
                          <div className="pm-row__title">{cp.label}</div>
                          <div className="pm-row__sub">{new Date(cp.createdAt).toLocaleTimeString()} · 节点 {cp.nodeCount}</div>
                        </div>
                        <div className="pm-actions">
                          <button type="button" className="pm-btn" onClick={() => toggleCheckpointStar(cp.id)}>
                            <Star size={12} color={cp.starred ? '#facc15' : '#a1a1aa'} fill={cp.starred ? '#facc15' : 'none'} />
                          </button>
                          <button type="button" className="pm-btn" disabled={!playStopped} onClick={() => createBranch(`${cp.label}-分支`, cp.id)}>
                            拉出分支
                          </button>
                          <button type="button" className="pm-btn" disabled={!playStopped} onClick={() => restoreCheckpoint(cp.id)}>
                            恢复
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}

            {tab === 'publish' && (
              <>
                <div className="pm-section-head">
                  <div>
                    <h3>发布前验证与 Web 播放包导出</h3>
                    <p>导出零编辑器依赖的独立 Web 播放包（复用 WebGPURenderer 与 WebGL2 回退）</p>
                  </div>
                </div>
                <div className="pm-card">
                  <div className="pm-card__title">发布前门禁检查</div>
                  <div style={{ fontSize: 12, color: report.errorCount === 0 ? '#4ade80' : '#fca5a5' }}>
                    {report.errorCount === 0
                      ? '✓ 体检无阻塞错误，可以导出独立 Web 播放包。'
                      : `✕ 当前存在 ${report.errorCount} 个体检错误，建议先处理后再发布。`}
                  </div>
                  <div className="pm-actions">
                    <button type="button" className="pm-btn pm-btn--primary" onClick={() => void handleExport()}>
                      <FileDown size={13} /> 选择目录并导出 Web 播放包
                    </button>
                    <button type="button" className="pm-btn pm-btn--ai" onClick={() => askAi('请先运行一次冒烟试玩验证与体检，确认无误后提示我导出。')}>
                      <Play size={13} /> 让 AI 跑冒烟验证
                    </button>
                  </div>
                  {exportMsg && <div style={{ fontSize: 12, color: '#93c5fd' }}>{exportMsg}</div>}
                </div>
              </>
            )}
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
