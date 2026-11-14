import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { Box, ChevronDown, ChevronRight, Clapperboard, Component, Folder, Globe, Image, LayoutGrid, List, Music, Palette, Plus, Rows3, Search, Sun, Trash2, Upload, X } from 'lucide-react'
import { ASSET_MIME, bindImportInput, deleteAsset, importFiles, openAsset, openImport } from '../assets/import'
import { useAssetStore, type ProjectAsset } from '../assets/library'
import { useEditorStore } from '../scene/store'
import { openAssetPreview, type PreviewKind } from '../preview/previewStore'
import './ProjectPanel.css'

const FOLDERS = [
  { id: 'scenes', name: '场景', kinds: ['scene'], icon: Globe, color: '#4a9eff' },
  { id: 'models', name: '模型', kinds: ['model'], icon: Box, color: 'var(--color-model)' },
  { id: 'textures', name: '贴图', kinds: ['texture'], icon: Image, color: 'var(--color-image)' },
  { id: 'environments', name: '环境', kinds: ['environment'], icon: Sun, color: '#ffd36b' },
  { id: 'materials', name: '材质', kinds: ['material'], icon: Palette, color: 'var(--color-material)' },
  { id: 'animations', name: '动画', kinds: ['animation'], icon: Clapperboard, color: 'var(--text-accent)' },
  { id: 'audio', name: '音频', kinds: ['audio'], icon: Music, color: 'var(--color-sound)' },
  { id: 'prefabs', name: '预制体', kinds: ['prefab'], icon: Component, color: '#a966d3' },
] as const

const PILLS = [
  { id: 'all', label: '全部' },
  { id: 'model', label: '模型' },
  { id: 'image', label: '材质/贴图' },
  { id: 'audio', label: '音频' },
  { id: 'scene', label: '场景' },
  { id: 'used', label: '本场景' },
  { id: 'unused', label: '未引用' },
] as const

type FolderId = 'all' | (typeof FOLDERS)[number]['id']
type PillId = (typeof PILLS)[number]['id']
type BrowseView = 'list' | 'grid' | 'details'

const KIND_LABEL: Record<string, string> = {
  scene: '场景',
  model: '模型',
  texture: '贴图',
  environment: '环境',
  material: '材质',
  animation: '动画',
  audio: '音频',
  prefab: '预制体',
}

export default function ProjectPanel() {
  const [folderId, setFolderId] = useState<FolderId>('all')
  const [pill, setPill] = useState<PillId>('all')
  const [view, setView] = useState<BrowseView>('list')
  const [treeOpen, setTreeOpen] = useState(true)
  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  const [renameId, setRenameId] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const renameTimer = useRef<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const assets = useAssetStore(state => state.assets)
  const activeSceneId = useEditorStore(state => state.activeSceneId)
  const inspectedAssetId = useEditorStore(state => state.inspectedAssetId)
  const nodes = useEditorStore(state => state.nodes)
  const q = query.trim().toLowerCase()
  const referenced = useMemo(() => referencedIds(nodes, assets), [nodes, assets])
  const items = useMemo(() => {
    const folder = FOLDERS.find(item => item.id === folderId)
    return Object.values(assets).filter(asset => {
      if (folder && !(folder.kinds as readonly string[]).includes(asset.kind)) return false
      if (q && !asset.name.toLowerCase().includes(q)) return false
      if (pill === 'model' && asset.kind !== 'model' && asset.kind !== 'prefab') return false
      if (pill === 'image' && asset.kind !== 'texture' && asset.kind !== 'material' && asset.kind !== 'environment') return false
      if (pill === 'audio' && asset.kind !== 'audio' && asset.kind !== 'animation') return false
      if (pill === 'scene' && asset.kind !== 'scene') return false
      if (pill === 'used' && !referenced.has(asset.id)) return false
      if (pill === 'unused' && referenced.has(asset.id)) return false
      return true
    })
  }, [assets, folderId, pill, q, referenced])

  useEffect(() => {
    bindImportInput(inputRef.current)
    return () => bindImportInput(null)
  }, [])

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [menu])

  return (
    <div className="project-panel project-browse">
      <aside className="project-browse__tree">
        <button type="button" className={`project-browse__tree-item ${folderId === 'all' ? 'is-active' : ''}`} onClick={() => setFolderId('all')}>
          <span className="project-browse__twist" onClick={event => { event.stopPropagation(); setTreeOpen(value => !value) }}>
            {treeOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
          <Folder size={13} />
          <span>Assets</span>
        </button>
        {treeOpen && FOLDERS.map(item => {
          const Icon = item.icon
          const count = Object.values(assets).filter(asset => (item.kinds as readonly string[]).includes(asset.kind)).length
          return (
            <button
              key={item.id}
              type="button"
              className={`project-browse__tree-item project-browse__tree-item--child ${folderId === item.id ? 'is-active' : ''}`}
              onClick={() => setFolderId(item.id)}
            >
              <Icon size={13} color={item.color} />
              <span>{item.name}</span>
              {count > 0 && <em>{count}</em>}
            </button>
          )
        })}
      </aside>
      <div className="project-browse__split" />
      <section className="project-browse__main">
        <div className="project-browse__toolbar">
          <div className="project-panel__search">
            <Search size={12} />
            <input value={query} placeholder="搜索资源" onChange={event => setQuery(event.target.value)} />
            {query && <button type="button" onClick={() => setQuery('')} title="清除"><X size={12} /></button>}
          </div>
          <button type="button" onClick={openImport} title="导入"><Upload size={12} /></button>
          {(folderId === 'all' || folderId === 'scenes') && (
            <button type="button" title="新建场景" onClick={() => useEditorStore.getState().createScene()}><Plus size={12} /></button>
          )}
          <input
            ref={inputRef}
            type="file"
            multiple
            hidden
            accept=".gltf,.glb,.obj,.fbx,.dae,.3ds,.stl,.png,.jpg,.jpeg,.webp,.svg,.ktx2,.hdr,.exr,.env,.mp3,.wav,.ogg"
            onChange={event => {
              const files = [...(event.target.files ?? [])]
              event.target.value = ''
              if (files.length) void importFiles(files)
            }}
          />
        </div>
        <div className="project-browse__filters">
          {PILLS.map(item => (
            <button key={item.id} type="button" className={pill === item.id ? 'is-on' : ''} onClick={() => setPill(item.id)}>{item.label}</button>
          ))}
          <span>{items.length} 项</span>
          <button type="button" className={view === 'list' ? 'is-on' : ''} title="列表" onClick={() => setView('list')}><List size={13} /></button>
          <button type="button" className={view === 'details' ? 'is-on' : ''} title="详情" onClick={() => setView('details')}><Rows3 size={13} /></button>
          <button type="button" className={view === 'grid' ? 'is-on' : ''} title="缩略图" onClick={() => setView('grid')}><LayoutGrid size={13} /></button>
        </div>
        <div
          className={`project-browse__assets ${view === 'grid' ? 'is-grid' : ''} ${view === 'details' ? 'is-details' : ''} ${over ? 'is-over' : ''}`}
          onDragOver={event => {
            if (![...event.dataTransfer.types].includes('Files')) return
            event.preventDefault()
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={event => {
            const files = [...event.dataTransfer.files]
            if (!files.length) return
            event.preventDefault()
            setOver(false)
            void importFiles(files)
          }}
          onClick={event => {
            if ((event.target as HTMLElement).closest('.project-asset')) return
            useEditorStore.getState().inspectAsset(null)
          }}
          onContextMenu={event => {
            if ((event.target as HTMLElement).closest('.project-asset')) return
            event.preventDefault()
            useEditorStore.getState().inspectAsset(null)
          }}
        >
          {view === 'details' && items.length > 0 && (
            <div className="project-browse__detail-head"><span>名称</span><span>类型</span><span>说明</span></div>
          )}
          {items.length === 0 && <p className="project-panel__hint-note">{over ? '松开即可导入' : '这个目录里还没有资源。'}</p>}
          {items.map(asset => (
            <AssetRow
              key={asset.id}
              asset={asset}
              view={view}
              picked={inspectedAssetId === asset.id}
              used={referenced.has(asset.id)}
              renaming={renameId === asset.id}
              onRenameDone={name => {
                if (name) useAssetStore.getState().rename(asset.id, name)
                setRenameId(null)
              }}
              onClick={event => {
                event.stopPropagation()
                const already = inspectedAssetId === asset.id
                useEditorStore.getState().inspectAsset(asset.id)
                if (asset.kind === 'scene') {
                  if (activeSceneId !== asset.id) {
                    if (renameTimer.current != null) window.clearTimeout(renameTimer.current)
                    useEditorStore.getState().openScene(asset.id)
                    return
                  }
                  if (!already) return
                  if (renameTimer.current != null) window.clearTimeout(renameTimer.current)
                  renameTimer.current = window.setTimeout(() => {
                    renameTimer.current = null
                    setRenameId(asset.id)
                  }, 600)
                }
              }}
              onDoubleClick={() => {
                if (renameTimer.current != null) window.clearTimeout(renameTimer.current)
                if (asset.kind === 'scene') return
                const preview = previewKind(asset.kind)
                if (preview) openAssetPreview(preview, asset.id, asset.name)
                else void openAsset(asset.id)
              }}
              onMenu={event => {
                event.preventDefault()
                event.stopPropagation()
                setMenu({ x: event.clientX, y: event.clientY, id: asset.id })
              }}
              onDelete={event => {
                event.stopPropagation()
                if (asset.kind === 'scene' && !window.confirm(`删除场景「${asset.name}」？里面的物体也会去掉。`)) return
                deleteAsset(asset.id)
              }}
            />
          ))}
        </div>
      </section>
      {menu && (
        <div className="project-panel__menu" style={{ left: menu.x, top: menu.y }} onPointerDown={event => event.stopPropagation()}>
          <button type="button" onClick={() => {
            const asset = useAssetStore.getState().assets[menu.id]
            const preview = asset ? previewKind(asset.kind) : null
            if (asset?.kind === 'scene') {
              useEditorStore.getState().inspectAsset(asset.id)
              useEditorStore.getState().openScene(asset.id)
            } else if (asset) {
              useEditorStore.getState().inspectAsset(asset.id)
              if (preview) openAssetPreview(preview, asset.id, asset.name)
            } else void openAsset(menu.id)
            setMenu(null)
          }}>打开</button>
          {(assetKind(menu.id) === 'model' || assetKind(menu.id) === 'prefab') && (
            <button type="button" onClick={() => { void openAsset(menu.id); setMenu(null) }}>放入场景</button>
          )}
          <button type="button" onClick={() => { setRenameId(menu.id); setMenu(null) }}>重命名</button>
          <button type="button" onClick={() => {
            if (assetKind(menu.id) === 'scene') {
              const asset = useAssetStore.getState().assets[menu.id]
              if (asset && !window.confirm(`删除场景「${asset.name}」？里面的物体也会去掉。`)) return
            }
            deleteAsset(menu.id)
            setMenu(null)
          }}>删除</button>
        </div>
      )}
    </div>
  )
}

function AssetRow({
  asset, view, picked, used, renaming, onRenameDone, onClick, onDoubleClick, onMenu, onDelete,
}: {
  asset: ProjectAsset
  view: BrowseView
  picked: boolean
  used: boolean
  renaming: boolean
  onRenameDone: (name: string) => void
  onClick: (event: MouseEvent) => void
  onDoubleClick: () => void
  onMenu: (event: MouseEvent) => void
  onDelete: (event: MouseEvent) => void
}) {
  const folder = FOLDERS.find(item => (item.kinds as readonly string[]).includes(asset.kind))
  const Icon = folder?.icon ?? Folder
  return (
    <div
      className={`project-asset ${view === 'grid' ? 'project-asset--grid' : ''} ${view === 'details' ? 'project-asset--details' : ''} ${picked ? 'project-asset--picked' : ''}`}
      draggable={asset.kind !== 'scene' && !renaming}
      title={assetTitle(asset)}
      onDragStart={event => {
        if (asset.kind === 'scene') { event.preventDefault(); return }
        event.dataTransfer.setData(ASSET_MIME, asset.id)
        event.dataTransfer.effectAllowed = 'copy'
      }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onMenu}
    >
      <div className="project-asset__lead">
        <Thumb asset={asset} icon={Icon} color={folder?.color} large={view === 'grid'} />
        {renaming ? (
          <input
            className="project-asset__rename"
            autoFocus
            defaultValue={asset.name}
            onClick={event => event.stopPropagation()}
            onBlur={event => onRenameDone(event.currentTarget.value.trim())}
            onKeyDown={event => {
              if (event.key === 'Enter') event.currentTarget.blur()
              if (event.key === 'Escape') { event.currentTarget.value = asset.name; event.currentTarget.blur() }
            }}
          />
        ) : <span>{asset.name}</span>}
      </div>
      {view === 'details' && <em>{KIND_LABEL[asset.kind] ?? asset.kind}</em>}
      {view === 'details' && <em>{detailOf(asset, used)}</em>}
      {view !== 'grid' && (
        <button type="button" title="删除" onClick={onDelete}><Trash2 size={12} /></button>
      )}
    </div>
  )
}

function detailOf(asset: ProjectAsset, used: boolean): string {
  if (asset.kind === 'scene') return `${Object.keys(asset.nodes).length} 个物体`
  if (asset.kind === 'prefab') return `${asset.nodes.length} 个物体`
  if (asset.kind === 'material') return asset.slot.color
  if ('fileName' in asset) return asset.fileName.split('.').pop()?.toUpperCase() ?? ''
  return used ? '使用中' : ''
}

function previewKind(kind: string): PreviewKind | null {
  if (kind === 'model' || kind === 'texture' || kind === 'material' || kind === 'environment') return kind
  return null
}

function assetKind(id: string) {
  return useAssetStore.getState().assets[id]?.kind
}

function Thumb({ asset, icon: Icon, color, large = false }: { asset: ProjectAsset, icon: typeof Folder, color?: string, large?: boolean }) {
  const className = large ? 'project-asset__thumb project-asset__thumb--large' : 'project-asset__thumb'
  if ('thumb' in asset && asset.thumb) return <img className={className} src={asset.thumb} alt="" />
  if (asset.kind === 'texture' && !asset.fileName.toLowerCase().endsWith('.ktx2')) return <img className={className} src={asset.url} alt="" />
  if (asset.kind === 'material') return <i className={large ? 'project-asset__swatch project-asset__swatch--large' : 'project-asset__swatch'} style={{ background: asset.slot.color }} />
  return (
    <span className={large ? 'project-asset__type project-asset__type--large' : 'project-asset__type'} style={{ color }} title={KIND_LABEL[asset.kind] ?? asset.kind}>
      <Icon size={large ? 28 : 14} />
    </span>
  )
}

function assetTitle(asset: ProjectAsset): string {
  if (asset.kind === 'scene') return '单击打开。再单击当前场景可改名'
  if (asset.kind === 'model' || asset.kind === 'prefab') return '双击预览，拖进视口放入场景'
  if (asset.kind === 'environment') return '双击预览环境贴图'
  if (asset.kind === 'texture' || asset.kind === 'material') return '双击预览，也可以拖到物体上'
  if (asset.kind === 'animation') return '拖到模型上播放'
  return '双击试听'
}

function referencedIds(nodes: Record<string, { assetId?: string | null, clipAssetId?: string | null, mapAssetId?: string | null, slots?: { mapAssetId: string | null }[] }>, assets: Record<string, ProjectAsset>): Set<string> {
  const ids = new Set<string>()
  const picture = useEditorStore.getState().picture
  if (picture.envAssetId) ids.add(picture.envAssetId)
  for (const node of Object.values(nodes)) collect(node, ids)
  for (const asset of Object.values(assets)) {
    if (asset.kind === 'scene') {
      if (asset.picture.envAssetId) ids.add(asset.picture.envAssetId)
      for (const node of Object.values(asset.nodes)) collect(node, ids)
    }
    if (asset.kind === 'prefab') for (const node of asset.nodes) collect(node, ids)
  }
  return ids
}

function collect(node: { assetId?: string | null, clipAssetId?: string | null, mapAssetId?: string | null, slots?: { mapAssetId: string | null }[] }, ids: Set<string>) {
  if (node.assetId) ids.add(node.assetId)
  if (node.clipAssetId) ids.add(node.clipAssetId)
  if (node.mapAssetId) ids.add(node.mapAssetId)
  for (const slot of node.slots ?? []) if (slot.mapAssetId) ids.add(slot.mapAssetId)
}
