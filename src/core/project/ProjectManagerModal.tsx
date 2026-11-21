import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Activity, BookOpen, CheckCircle2, FileDown, GitBranch, Package, Play, ShieldCheck, Sparkles, Star, Trash2, X } from 'lucide-react'
import { create } from 'zustand'
import { useAgentStore } from '../../ai/agentLoop'
import { electronBridge } from '../../editor/project/electronBridge'
import { useEditorStore } from '../../editor/scene/store'
import { exportWebPlayerBundle } from '../../player/exporter'
import { listAllRecipes, sedimentProjectToPack, trustAndActivatePack, uninstallPack, usePackStore } from '../packs/manager'
import type { PackTier } from '../packs/types'
import { diagnoseProject } from '../query'
import {
  createBranch,
  createCheckpoint,
  deleteBranch,
  listBranches,
  listCheckpoints,
  promoteBranchToMain,
  restoreCheckpoint,
  switchBranch,
  toggleCheckpointStar,
  useCheckpointUiStore,
} from './checkpoints'
import { getDesignDoc, updateDesignDoc } from './designMemory'

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

  const [designSummary, setDesignSummary] = useState('')
  const [designTitle, setDesignTitle] = useState('')
  const [designLoop, setDesignLoop] = useState('')
  const [designStyle, setDesignStyle] = useState('')

  const [packId, setPackId] = useState('user.my-pack')
  const [packName, setPackName] = useState('我的玩法包')
  const [packTier, setPackTier] = useState<PackTier>('gameplay')
  const [packBusy, setPackBusy] = useState(false)
  const [branchName, setBranchName] = useState('')
  const [cpLabel, setCpLabel] = useState('')
  const [exportMsg, setExportMsg] = useState('')

  const installedPacks = usePackStore(s => s.installed)
  useCheckpointUiStore(s => s.revision)

  useEffect(() => {
    if (!open) return
    const doc = getDesignDoc()
    setDesignTitle(doc.title)
    setDesignSummary(doc.notes)
    setDesignLoop(doc.coreLoop)
    setDesignStyle(doc.artStyle)
  }, [open])

  if (!open) return null

  const report = diagnoseProject()
  const branches = listBranches()
  const checkpoints = listCheckpoints()
  const recipes = listAllRecipes()
  const playStopped = useEditorStore.getState().playState === 'stopped'

  const saveDesign = async () => {
    await updateDesignDoc({
      title: designTitle.trim() || undefined,
      notes: designSummary,
      coreLoop: designLoop,
      artStyle: designStyle,
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
      if (res.ok) {
        useEditorStore.getState().notify(`能力包 ${res.bundle?.manifest.id} 已沉淀并注册`)
      } else {
        useEditorStore.getState().notify(res.error || '沉淀失败')
      }
    } finally {
      setPackBusy(false)
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

  const tabs: Array<{ id: ManagerTabId; label: string; icon: typeof BookOpen }> = [
    { id: 'design', label: '立项蓝图', icon: BookOpen },
    { id: 'packs', label: '能力包与配方', icon: Package },
    { id: 'diagnose', label: '体检与预算', icon: Activity },
    { id: 'branches', label: '快照与分支', icon: GitBranch },
    { id: 'publish', label: '验证与发布', icon: FileDown },
  ]

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 900,
        background: 'rgba(0, 0, 0, 0.65)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onPointerDown={(e) => { if (e.target === e.currentTarget) closeModal() }}
    >
      <div
        style={{
          width: 'min(920px, 92vw)',
          height: 'min(640px, 86vh)',
          background: '#16181d',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 8,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          color: '#e4e4e7',
          boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.08)', background: '#1b1e24' }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>工程管理中心</span>
          <div style={{ display: 'flex', gap: 4, marginLeft: 12 }}>
            {tabs.map((item) => {
              const Icon = item.icon
              const active = tab === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    height: 26,
                    padding: '0 10px',
                    borderRadius: 5,
                    border: active ? '1px solid rgba(96,165,250,0.5)' : '1px solid transparent',
                    background: active ? 'rgba(59,130,246,0.18)' : 'transparent',
                    color: active ? '#93c5fd' : '#a1a1aa',
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  <Icon size={13} />
                  {item.label}
                </button>
              )
            })}
          </div>
          <button
            type="button"
            onClick={closeModal}
            style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: '#a1a1aa', cursor: 'pointer', display: 'inline-flex' }}
          >
            <X size={16} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {tab === 'design' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 12, color: '#a1a1aa' }}>全局设计记忆（design.md）会随每轮对话自动注入 AI 上下文，确保制作方向一致。</div>
              <label style={labelStyle}>
                <span>项目标题</span>
                <input style={inputStyle} value={designTitle} onChange={e => setDesignTitle(e.target.value)} />
              </label>
              <label style={labelStyle}>
                <span>风格关键词（逗号分隔）</span>
                <input style={inputStyle} value={designStyle} onChange={e => setDesignStyle(e.target.value)} />
              </label>
              <label style={labelStyle}>
                <span>核心玩法循环</span>
                <textarea style={{ ...inputStyle, height: 68, padding: 8 }} value={designLoop} onChange={e => setDesignLoop(e.target.value)} />
              </label>
              <label style={labelStyle}>
                <span>设计概要</span>
                <textarea style={{ ...inputStyle, height: 120, padding: 8 }} value={designSummary} onChange={e => setDesignSummary(e.target.value)} />
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" style={primaryBtnStyle} onClick={() => void saveDesign()}>保存 design.md</button>
                <button type="button" style={btnStyle} onClick={() => askAi(`请根据当前 design.md 设计蓝图（${designTitle}）检查并补全场景关卡与玩法组件。`)}>
                  <Sparkles size={13} /> 交办 AI 按蓝图搭建
                </button>
              </div>
            </div>
          )}

          {tab === 'packs' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={cardStyle}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>沉淀当前工程为能力包（自动规整 __project__ 脚本）</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 140px auto', gap: 8, alignItems: 'center' }}>
                  <input style={inputStyle} value={packId} onChange={e => setPackId(e.target.value)} placeholder="包 ID (如 user.my-rts)" />
                  <input style={inputStyle} value={packName} onChange={e => setPackName(e.target.value)} placeholder="显示名称" />
                  <select style={inputStyle} value={packTier} onChange={e => setPackTier(e.target.value as PackTier)}>
                    <option value="content">内容包 (content)</option>
                    <option value="gameplay">玩法包 (gameplay)</option>
                    <option value="effect">效果包 (effect)</option>
                  </select>
                  <button type="button" style={primaryBtnStyle} disabled={packBusy} onClick={() => void handleSediment()}>
                    {packBusy ? '沉淀中…' : '一键沉淀'}
                  </button>
                </div>
              </div>

              <div style={cardStyle}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>已安装用户能力包 ({Object.keys(installedPacks).length})</div>
                {Object.keys(installedPacks).length === 0 ? (
                  <div style={{ fontSize: 12, color: '#71717a' }}>暂未安装用户沉淀包。</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {Object.values(installedPacks).map(rec => (
                      <div key={rec.bundle.manifest.id} style={rowStyle}>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600 }}>
                            {rec.bundle.manifest.name} <span style={{ color: '#71717a', fontWeight: 400 }}>({rec.bundle.manifest.id}@{rec.bundle.manifest.version})</span>
                          </div>
                          <div style={{ fontSize: 11, color: '#a1a1aa' }}>
                            层级: {rec.bundle.manifest.tier} · 脚本 {rec.bundle.scripts.length} · 着色器 {rec.bundle.shaders.length} · 组件 {rec.bundle.components.length}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {!rec.trusted && (
                            <button type="button" style={primaryBtnStyle} onClick={() => void trustAndActivatePack(rec.bundle.manifest.id)}>
                              <ShieldCheck size={12} /> 信任并启用脚本
                            </button>
                          )}
                          <button type="button" style={btnStyle} onClick={() => uninstallPack(rec.bundle.manifest.id)}>
                            <Trash2 size={12} /> 卸载
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={cardStyle}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>可用官方与用户配方 ({recipes.length})</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {recipes.map(recipe => (
                    <div key={recipe.id} style={rowStyle}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600 }}>{recipe.name} <span style={{ color: '#a1a1aa', fontWeight: 400 }}>[{recipe.tier}]</span></div>
                        <div style={{ fontSize: 11, color: '#a1a1aa' }}>{recipe.description}</div>
                      </div>
                      <button type="button" style={btnStyle} onClick={() => askAi(`请按照配方「${recipe.name}」的步骤搭建示例场景：\n${recipe.steps.join('\n')}`)}>
                        <Play size={12} /> 让 AI 按配方搭建
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === 'diagnose' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  体检结果：{report.errorCount} 个错误 · {report.warningCount} 个警告
                </div>
                <button
                  type="button"
                  style={btnStyle}
                  onClick={() => askAi(`请执行 query__project_diagnose 检查当前工程的问题与性能预算超标项，并逐一修复。`)}
                >
                  <Sparkles size={12} /> 交办 AI 自检修复
                </button>
              </div>
              {report.issues.length === 0 ? (
                <div style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: 8, color: '#4ade80' }}>
                  <CheckCircle2 size={16} /> 工程体检与性能预算全部通过！
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {report.issues.map((issue, idx) => (
                    <div key={idx} style={{ ...cardStyle, borderColor: issue.severity === 'error' ? 'rgba(248,113,113,0.4)' : 'rgba(250,204,21,0.3)' }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: issue.severity === 'error' ? '#fca5a5' : '#fde047' }}>
                        [{issue.category}] {issue.message}
                      </div>
                      {issue.hint && <div style={{ fontSize: 11, color: '#a1a1aa', marginTop: 4 }}>建议：{issue.hint}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'branches' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={cardStyle}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>轻量实验分支（A/B 方案试玩对比）</div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  <input
                    style={{ ...inputStyle, flex: 1 }}
                    value={branchName}
                    onChange={e => setBranchName(e.target.value)}
                    placeholder="新实验分支名称（如：方案B-快节奏手感）"
                  />
                  <button
                    type="button"
                    style={primaryBtnStyle}
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {branches.map(b => (
                    <div key={b.id} style={rowStyle}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: b.isActive ? '#93c5fd' : '#e4e4e7' }}>
                          {b.name} {b.isActive ? '（当前激活）' : ''}
                        </div>
                        <div style={{ fontSize: 11, color: '#a1a1aa' }}>节点数: {b.nodeCount}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {!b.isActive && (
                          <button type="button" style={btnStyle} disabled={!playStopped} onClick={() => switchBranch(b.id)}>
                            切换对比
                          </button>
                        )}
                        {b.id !== 'main' && (
                          <button type="button" style={btnStyle} disabled={!playStopped} onClick={() => promoteBranchToMain(b.id)}>
                            设为主线
                          </button>
                        )}
                        {b.id !== 'main' && !b.isActive && (
                          <button type="button" style={btnStyle} onClick={() => deleteBranch(b.id)}>
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={cardStyle}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>版本快照（Checkpoints）</div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  <input
                    style={{ ...inputStyle, flex: 1 }}
                    value={cpLabel}
                    onChange={e => setCpLabel(e.target.value)}
                    placeholder="里程碑快照备注…"
                  />
                  <button
                    type="button"
                    style={btnStyle}
                    onClick={() => {
                      void createCheckpoint(cpLabel || '手动里程碑', true).then(() => setCpLabel(''))
                    }}
                  >
                    保存里程碑快照
                  </button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {checkpoints.length === 0 ? (
                    <div style={{ fontSize: 12, color: '#71717a' }}>暂无快照记录。</div>
                  ) : (
                    checkpoints.map(cp => (
                      <div key={cp.id} style={rowStyle}>
                        <div>
                          <div style={{ fontSize: 12 }}>{cp.label}</div>
                          <div style={{ fontSize: 11, color: '#a1a1aa' }}>
                            {new Date(cp.createdAt).toLocaleTimeString()} · 节点 {cp.nodeCount}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button type="button" style={btnStyle} onClick={() => toggleCheckpointStar(cp.id)}>
                            <Star size={12} color={cp.starred ? '#facc15' : '#a1a1aa'} fill={cp.starred ? '#facc15' : 'none'} />
                          </button>
                          <button type="button" style={btnStyle} disabled={!playStopped} onClick={() => restoreCheckpoint(cp.id)}>
                            恢复
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {tab === 'publish' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={cardStyle}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>发布前门禁状态</div>
                <div style={{ fontSize: 12, color: report.errorCount === 0 ? '#4ade80' : '#fca5a5' }}>
                  {report.errorCount === 0
                    ? '✓ 体检无阻塞错误，可以导出独立 Web 播放包。'
                    : `✕ 当前存在 ${report.errorCount} 个体检错误，建议先处理后再发布。`}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button type="button" style={primaryBtnStyle} onClick={() => void handleExport()}>
                  <FileDown size={13} /> 选择目录并导出 Web 播放包
                </button>
                <button type="button" style={btnStyle} onClick={() => askAi('请先运行一次冒烟试玩验证与体检，确认无误后提示我导出。')}>
                  <Play size={13} /> 让 AI 跑冒烟验证
                </button>
              </div>
              {exportMsg && <div style={{ fontSize: 12, color: '#93c5fd' }}>{exportMsg}</div>}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

const labelStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#d4d4d8' }
const inputStyle: React.CSSProperties = {
  height: 28,
  padding: '0 8px',
  borderRadius: 4,
  border: '1px solid rgba(255,255,255,0.14)',
  background: '#101216',
  color: '#f4f4f5',
  fontSize: 12,
}
const cardStyle: React.CSSProperties = {
  padding: 12,
  borderRadius: 6,
  border: '1px solid rgba(255,255,255,0.08)',
  background: 'rgba(255,255,255,0.03)',
}
const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '6px 8px',
  borderRadius: 4,
  background: 'rgba(0,0,0,0.22)',
}
const btnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  height: 28,
  padding: '0 10px',
  borderRadius: 4,
  border: '1px solid rgba(255,255,255,0.14)',
  background: 'rgba(255,255,255,0.06)',
  color: '#e4e4e7',
  fontSize: 12,
  cursor: 'pointer',
}
const primaryBtnStyle: React.CSSProperties = {
  ...btnStyle,
  background: '#2563eb',
  borderColor: '#2563eb',
  color: '#fff',
}
