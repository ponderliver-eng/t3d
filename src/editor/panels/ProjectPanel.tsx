import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { Box, ChevronRight, Clapperboard, Component, Folder, FolderOpen, FolderPlus, Globe, Image, LayoutGrid, List, Minus, Music, Palette, Plus, Rows3, Search, Sun, Trash2, Upload, X } from 'lucide-react'
import { CLIP_MIME } from '../animation/playback'
import { ASSET_MIME, assignClip, bindImportInput, createDefaultMaterial, deleteAsset, duplicateAsset, importFiles, openAsset, openImport, reimportModel, reportAssetUsers } from '../assets/import'
import { savePrefabFromSelection } from '../assets/import'
import { readPrefab } from '../assets/prefab'
import { ASSETS_ROOT, directoryTree, findDir, isWithin, parentDir, type DirNode } from '../assets/folders'
import { assetDirectory, useAssetStore, type ProjectAsset } from '../assets/library'
import { useEditorStore } from '../scene/store'
import { translate, useI18n, type MessageKey } from '../i18n'
import { openAssetPreview, type PreviewKind } from '../preview/previewStore'
import './ProjectPanel.css'

const PILLS = [
  { id: 'all' },
  { id: 'model' },
  { id: 'image' },
  { id: 'audio' },
  { id: 'scene' },
  { id: 'used' },
  { id: 'unused' },
] as const

type PillId = (typeof PILLS)[number]['id']
type BrowseView = 'list' | 'grid' | 'details'
type BrowseMenu = { x: number; y: number; target: 'asset'; id: string } | { x: number; y: number; target: 'dir'; path: string }

const KIND_ICON = {
  scene: Globe,
  model: Box,
  texture: Image,
  environment: Sun,
  material: Palette,
  animation: Clapperboard,
  audio: Music,
  prefab: Component,
} as const

const KIND_COLOR: Record<string, string> = {
  scene: '#4a9eff',
  model: 'var(--color-model)',
  texture: 'var(--color-image)',
  environment: '#ffd36b',
  material: 'var(--color-material)',
  animation: 'var(--text-accent)',
  audio: 'var(--color-sound)',
  prefab: '#a966d3',
}

function kindLabel(kind: string): string {
  const key = `asset.${kind}` as MessageKey
  const known = ['scene', 'model', 'texture', 'environment', 'material', 'animation', 'audio', 'prefab']
  return known.includes(kind) ? translate(key) : kind
}

export default function ProjectPanel() {
  const { t } = useI18n()
  const [pill, setPill] = useState<PillId>('all')
  const [view, setView] = useState<BrowseView>('list')
  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState<BrowseMenu | null>(null)
  const [renameId, setRenameId] = useState<string | null>(null)
  const [renamePath, setRenamePath] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ [ASSETS_ROOT]: true })
  const [over, setOver] = useState(false)
  const [dropPath, setDropPath] = useState<string | null>(null)
  const [clipOpen, setClipOpen] = useState<Record<string, boolean>>({})
  const renameTimer = useRef<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const assets = useAssetStore(state => state.assets)
  const folders = useAssetStore(state => state.folders)
  const assetDirs = useAssetStore(state => state.assetDirs)
  const browseDir = useAssetStore(state => state.browseDir)
  const activeSceneId = useEditorStore(state => state.activeSceneId)
  const inspectedAssetId = useEditorStore(state => state.inspectedAssetId)
  const nodes = useEditorStore(state => state.nodes)
  const q = query.trim().toLowerCase()
  const referenced = useMemo(() => referencedIds(nodes, assets), [nodes, assets])
  const tree = useMemo(() => directoryTree(folders, assetDirs), [folders, assetDirs])
  const items = useMemo(() => {
    const matchesPill = (asset: ProjectAsset) => {
      if (pill === 'model' && asset.kind !== 'model' && asset.kind !== 'prefab') return false
      if (pill === 'image' && asset.kind !== 'texture' && asset.kind !== 'material' && asset.kind !== 'environment') return false
      if (pill === 'audio' && asset.kind !== 'audio' && asset.kind !== 'animation') return false
      if (pill === 'scene' && asset.kind !== 'scene') return false
      if (pill === 'used' && !referenced.has(asset.id)) return false
      if (pill === 'unused' && referenced.has(asset.id)) return false
      return true
    }
    const byName = (a: ProjectAsset, b: ProjectAsset) => a.name.localeCompare(b.name, 'zh')
    if (q) {
      const dirs = flattenDirs(tree).filter(dir => dir.path !== ASSETS_ROOT && dir.name.toLowerCase().includes(q))
      const found = Object.values(assets).filter(asset => (asset.name.toLowerCase().includes(q) || clipEntries(asset).some(clip => clip.name.toLowerCase().includes(q))) && matchesPill(asset)).sort(byName)
      return [...dirs.map(dirItem), ...found.map(assetItem)]
    }
    if (pill !== 'all') {
      return Object.values(assets)
        .filter(asset => isWithin(assetDirectory(asset.id, assetDirs), browseDir) && matchesPill(asset))
        .sort(byName)
        .map(assetItem)
    }
    const children = findDir(tree, browseDir)?.children ?? []
    const here = Object.values(assets).filter(asset => assetDirectory(asset.id, assetDirs) === browseDir).sort(byName)
    return [...children.map(dirItem), ...here.map(assetItem)]
  }, [assets, assetDirs, browseDir, pill, q, referenced, tree])

  useEffect(() => {
    setExpanded(current => {
      const next = { ...current }
      let cursor: string | null = browseDir
      let changed = false
      while (cursor) {
        if (!next[cursor]) {
          next[cursor] = true
          changed = true
        }
        cursor = parentDir(cursor)
      }
      return changed ? next : current
    })
  }, [browseDir])

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
        <div className="project-browse__tree-tools">
          <button type="button" title={t('project.newFolder')} onClick={() => setRenamePath(useAssetStore.getState().createFolder(browseDir))}>
            <FolderPlus size={12} />
          </button>
        </div>
        <DirNodeView
          node={tree}
          depth={0}
          browseDir={browseDir}
          expanded={expanded}
          renamePath={renamePath}
          dropPath={dropPath}
          onToggle={path => setExpanded(current => ({ ...current, [path]: !current[path] }))}
          onOpen={path => {
            useAssetStore.getState().setBrowseDir(path)
            useEditorStore.getState().inspectAsset(null)
          }}
          onRenameDone={name => {
            if (renamePath && name) useAssetStore.getState().renameFolder(renamePath, name)
            setRenamePath(null)
          }}
          onMenu={(event, path) => {
            event.preventDefault()
            event.stopPropagation()
            setMenu({ x: event.clientX, y: event.clientY, target: 'dir', path })
          }}
          onDropPath={setDropPath}
        />
      </aside>
      <div className="project-browse__split" />
      <section className="project-browse__main">
        <div className="project-browse__toolbar">
          <div className="project-panel__search">
            <Search size={12} />
            <input value={query} placeholder={t('project.search')} onChange={event => setQuery(event.target.value)} />
            {query && <button type="button" onClick={() => setQuery('')} title={t('project.clear')}><X size={12} /></button>}
          </div>
          <button type="button" onClick={openImport} title={t('project.import')}><Upload size={12} /></button>
          <button type="button" title={t('project.newScene')} onClick={() => useEditorStore.getState().createScene()}><Plus size={12} /></button>
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
            <button key={item.id} type="button" className={pill === item.id ? 'is-on' : ''} onClick={() => setPill(item.id)}>{t(`project.${item.id}` as MessageKey)}</button>
          ))}
          <span>{t('project.count', { count: items.length })}</span>
          <button type="button" className={view === 'list' ? 'is-on' : ''} title={t('project.list')} onClick={() => setView('list')}><List size={13} /></button>
          <button type="button" className={view === 'details' ? 'is-on' : ''} title={t('project.details')} onClick={() => setView('details')}><Rows3 size={13} /></button>
          <button type="button" className={view === 'grid' ? 'is-on' : ''} title={t('project.grid')} onClick={() => setView('grid')}><LayoutGrid size={13} /></button>
        </div>
        <div
          className={`project-browse__assets ${view === 'grid' ? 'is-grid' : ''} ${view === 'details' ? 'is-details' : ''} ${over ? 'is-over' : ''}`}
          data-asset-dir={browseDir}
          onDragOver={event => {
            const types = [...event.dataTransfer.types]
            if (!types.includes('Files') && !types.includes(ASSET_MIME)) return
            event.preventDefault()
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={event => {
            const assetId = event.dataTransfer.getData(ASSET_MIME)
            const files = [...event.dataTransfer.files]
            if (!assetId && !files.length) return
            event.preventDefault()
            setOver(false)
            if (assetId) useAssetStore.getState().place(assetId, browseDir)
            else void importFiles(files, browseDir)
          }}
          onClick={event => {
            if ((event.target as HTMLElement).closest('.project-asset')) return
            useEditorStore.getState().inspectAsset(null)
          }}
          onContextMenu={event => {
            if ((event.target as HTMLElement).closest('.project-asset')) return
            event.preventDefault()
            useEditorStore.getState().inspectAsset(null)
            setMenu({ x: event.clientX, y: event.clientY, target: 'dir', path: browseDir })
          }}
        >
          {view === 'details' && items.length > 0 && (
            <div className="project-browse__detail-head"><span>{t('project.name')}</span><span>{t('project.type')}</span><span>{t('project.detail')}</span></div>
          )}
          {items.length === 0 && <p className="project-panel__hint-note">{over ? t('project.drop') : t('project.empty')}</p>}
          {items.map(item => item.kind === 'dir' ? (
            <DirRow
              key={item.path}
              path={item.path}
              name={item.name}
              view={view}
              renaming={renamePath === item.path}
              dropping={dropPath === item.path}
              onOpen={() => useAssetStore.getState().setBrowseDir(item.path)}
              onRenameDone={name => {
                if (name) useAssetStore.getState().renameFolder(item.path, name)
                setRenamePath(null)
              }}
              onMenu={event => {
                event.preventDefault()
                event.stopPropagation()
                setMenu({ x: event.clientX, y: event.clientY, target: 'dir', path: item.path })
              }}
              onDropPath={setDropPath}
            />
          ) : (
            <AssetRow
              key={item.asset.id}
              asset={item.asset}
              view={view}
              picked={inspectedAssetId === item.asset.id}
              used={referenced.has(item.asset.id)}
              renaming={renameId === item.asset.id}
              onRenameDone={name => {
                if (name) useAssetStore.getState().rename(item.asset.id, name)
                setRenameId(null)
              }}
              onClick={event => {
                event.stopPropagation()
                const asset = item.asset
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
                const asset = item.asset
                if (asset.kind === 'scene') return
                if (asset.kind === 'prefab') {
                  useEditorStore.getState().openPrefab(asset.id)
                  return
                }
                const preview = previewKind(asset.kind)
                if (preview) openAssetPreview(preview, asset.id, asset.name)
                else void openAsset(asset.id)
              }}
              onMenu={event => {
                event.preventDefault()
                event.stopPropagation()
                setMenu({ x: event.clientX, y: event.clientY, target: 'asset', id: item.asset.id })
              }}
              onDelete={event => {
                event.stopPropagation()
                if (item.asset.kind === 'scene' && !window.confirm(t('project.deleteScene', { name: item.asset.name }))) return
                deleteAsset(item.asset.id)
              }}
              clipsOpen={clipOpen[item.asset.id] === true || (q.length > 0 && clipEntries(item.asset).some(clip => clip.name.toLowerCase().includes(q)))}
              onToggleClips={() => setClipOpen(current => ({ ...current, [item.asset.id]: !current[item.asset.id] }))}
            />
          ))}
        </div>
      </section>
      {menu?.target === 'asset' && (
        <div className="project-panel__menu" style={{ left: menu.x, top: menu.y }} onPointerDown={event => event.stopPropagation()}>
          <CreateMenu dir={assetDirectory(menu.id, useAssetStore.getState().assetDirs)} onDone={() => setMenu(null)} onNewFolder={path => setRenamePath(path)} />
          <div className="project-panel__sep" />
          <button type="button" onClick={() => {
            const asset = useAssetStore.getState().assets[menu.id]
            const preview = asset ? previewKind(asset.kind) : null
            if (asset?.kind === 'scene') {
              useEditorStore.getState().inspectAsset(asset.id)
              useEditorStore.getState().openScene(asset.id)
            } else if (asset?.kind === 'prefab') {
              useEditorStore.getState().openPrefab(asset.id)
            } else if (asset) {
              useEditorStore.getState().inspectAsset(asset.id)
              if (preview) openAssetPreview(preview, asset.id, asset.name)
            } else void openAsset(menu.id)
            setMenu(null)
          }}>{t('project.open')}</button>
          {(assetKind(menu.id) === 'model' || assetKind(menu.id) === 'prefab') && (
            <button type="button" onClick={() => { void openAsset(menu.id); setMenu(null) }}>{t('project.place')}</button>
          )}
          {(assetKind(menu.id) === 'model' || assetKind(menu.id) === 'animation') && (
            <button type="button" onClick={() => { void reimportModel(menu.id); setMenu(null) }}>{t('preview.reimport')}</button>
          )}
          {(assetKind(menu.id) === 'material' || assetKind(menu.id) === 'scene' || assetKind(menu.id) === 'prefab') && (
            <button type="button" onClick={() => { duplicateAsset(menu.id); setMenu(null) }}>{t('project.duplicate')}</button>
          )}
          <button type="button" onClick={() => { reportAssetUsers(menu.id); setMenu(null) }}>{t('project.findRefs')}</button>
          <button type="button" onClick={() => { setRenameId(menu.id); setMenu(null) }}>{t('project.rename')}</button>
          <div className="project-panel__sep" />
          <button type="button" onClick={() => {
            if (assetKind(menu.id) === 'scene') {
              const asset = useAssetStore.getState().assets[menu.id]
              if (asset && !window.confirm(t('project.deleteScene', { name: asset.name }))) return
            }
            deleteAsset(menu.id)
            setMenu(null)
          }}>{t('project.delete')}</button>
        </div>
      )}
      {menu?.target === 'dir' && (
        <div className="project-panel__menu" style={{ left: menu.x, top: menu.y }} onPointerDown={event => event.stopPropagation()}>
          <CreateMenu dir={menu.path} onDone={() => setMenu(null)} onNewFolder={path => setRenamePath(path)} />
          <div className="project-panel__sep" />
          <button type="button" onClick={() => { useAssetStore.getState().setBrowseDir(menu.path); setMenu(null) }}>{t('project.open')}</button>
          {menu.path !== ASSETS_ROOT && <button type="button" onClick={() => { setRenamePath(menu.path); setMenu(null) }}>{t('project.rename')}</button>}
          {menu.path !== ASSETS_ROOT && (
            <button type="button" onClick={() => {
              const name = menu.path.slice(menu.path.lastIndexOf('/') + 1)
              if (window.confirm(t('project.deleteFolder', { name }))) useAssetStore.getState().deleteFolder(menu.path)
              setMenu(null)
            }}>{t('project.delete')}</button>
          )}
        </div>
      )}
    </div>
  )
}

function CreateMenu({ dir, onDone, onNewFolder }: { dir: string, onDone: () => void, onNewFolder: (path: string) => void }) {
  const { t } = useI18n()
  const hasSelection = useEditorStore(state => state.selection.length > 0)
  return (
    <div className="project-panel__submenu">
      <button type="button">{t('project.create')}<ChevronRight size={12} /></button>
      <div className="project-panel__submenu-pop">
        <button type="button" onClick={() => { onNewFolder(useAssetStore.getState().createFolder(dir)); onDone() }}>{t('project.newFolderMenu')}</button>
        <button type="button" onClick={() => { useAssetStore.getState().setBrowseDir(dir); useEditorStore.getState().createScene(); onDone() }}>{t('project.createScene')}</button>
        <button type="button" onClick={() => { createDefaultMaterial(dir); onDone() }}>{t('project.createMaterial')}</button>
        <button type="button" disabled={!hasSelection} onClick={() => { useAssetStore.getState().setBrowseDir(dir); savePrefabFromSelection(); onDone() }}>{t('project.createPrefab')}</button>
      </div>
    </div>
  )
}

function clipEntries(asset: ProjectAsset) {
  return 'clipCatalog' in asset && asset.clipCatalog ? asset.clipCatalog : []
}

function AssetRow({
  asset, view, picked, used, renaming, onRenameDone, onClick, onDoubleClick, onMenu, onDelete, clipsOpen, onToggleClips,
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
  clipsOpen: boolean
  onToggleClips: () => void
}) {
  const Icon = KIND_ICON[asset.kind] ?? Folder
  const clips = clipEntries(asset)
  return (
    <div className="project-asset-block">
    <div
      className={`project-asset ${view === 'grid' ? 'project-asset--grid' : ''} ${view === 'details' ? 'project-asset--details' : ''} ${picked ? 'project-asset--picked' : ''}`}
      draggable={!renaming}
      title={assetTitle(asset)}
      onDragStart={event => {
        event.dataTransfer.setData(ASSET_MIME, asset.id)
        event.dataTransfer.effectAllowed = 'copy'
      }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onMenu}
    >
      <div className="project-asset__lead">
        <Thumb asset={asset} icon={Icon} color={KIND_COLOR[asset.kind]} large={view === 'grid'} />
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
        {clips.length > 0 && (
          <button type="button" className="project-clip-toggle" title={translate('project.clips')} onClick={event => { event.stopPropagation(); onToggleClips() }}>
            <ChevronRight size={12} style={{ transform: clipsOpen ? 'rotate(90deg)' : undefined }} />
          </button>
        )}
      </div>
      {view === 'details' && <em>{kindLabel(asset.kind)}</em>}
      {view === 'details' && <em>{detailOf(asset, used)}</em>}
      {view !== 'grid' && (
        <button type="button" title={translate('project.delete')} onClick={onDelete}><Trash2 size={12} /></button>
      )}
    </div>
    {clipsOpen && clips.map(clip => (
      <div
        key={`${asset.id}:${clip.name}`}
        className="project-clip"
        draggable
        onDragStart={event => {
          event.stopPropagation()
          event.dataTransfer.setData(CLIP_MIME, JSON.stringify({ assetId: asset.id, clip: clip.name }))
          event.dataTransfer.effectAllowed = 'copy'
        }}
        onDoubleClick={event => {
          event.stopPropagation()
          const selected = useEditorStore.getState().selection.at(-1)
          if (selected) assignClip(selected, asset.id, clip.name)
        }}
      >
        <span>{clip.name}</span>
        <em>{clip.duration.toFixed(2)}s</em>
      </div>
    ))}
    </div>
  )
}

function detailOf(asset: ProjectAsset, used: boolean): string {
  if (asset.kind === 'scene') return translate('project.objects', { count: Object.keys(asset.nodes).length })
  if (asset.kind === 'prefab') return translate('project.objects', { count: Object.keys(readPrefab(asset).nodes).length })
  if (asset.kind === 'material') return asset.slot.color
  if ('fileName' in asset) return asset.fileName.split('.').pop()?.toUpperCase() ?? ''
  return used ? translate('project.inUse') : ''
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
    <span className={large ? 'project-asset__type project-asset__type--large' : 'project-asset__type'} style={{ color }} title={kindLabel(asset.kind)}>
      <Icon size={large ? 28 : 14} />
    </span>
  )
}

function assetTitle(asset: ProjectAsset): string {
  if (asset.kind === 'scene') return translate('project.sceneHint')
  if (asset.kind === 'model' || asset.kind === 'prefab') return translate('project.modelHint')
  if (asset.kind === 'environment') return translate('project.envHint')
  if (asset.kind === 'texture' || asset.kind === 'material') return translate('project.textureHint')
  if (asset.kind === 'animation') return translate('project.animHint')
  return translate('project.audioHint')
}

function referencedIds(nodes: Record<string, { assetId?: string | null, clipAssetId?: string | null, materialAssetId?: string | null, mapAssetId?: string | null, slots?: { materialAssetId?: string | null, mapAssetId: string | null }[] }>, assets: Record<string, ProjectAsset>): Set<string> {
  const ids = new Set<string>()
  const picture = useEditorStore.getState().picture
  if (picture.envAssetId) ids.add(picture.envAssetId)
  for (const node of Object.values(nodes)) collect(node, ids)
  for (const asset of Object.values(assets)) {
    if (asset.kind === 'material') collect(asset.slot, ids)
    if (asset.kind === 'scene') {
      if (asset.picture.envAssetId) ids.add(asset.picture.envAssetId)
      for (const node of Object.values(asset.nodes)) collect(node, ids)
    }
    if (asset.kind === 'prefab') for (const node of Object.values(readPrefab(asset).nodes)) collect(node, ids)
  }
  return ids
}

function collect(node: { assetId?: string | null, clipAssetId?: string | null, materialAssetId?: string | null, mapAssetId?: string | null, normalAssetId?: string | null, roughnessAssetId?: string | null, metalnessAssetId?: string | null, emissiveAssetId?: string | null, aoAssetId?: string | null, prefabAssetId?: string | null, nestedPrefabId?: string | null, slots?: Array<{ materialAssetId?: string | null, mapAssetId?: string | null, normalAssetId?: string | null, roughnessAssetId?: string | null, metalnessAssetId?: string | null, emissiveAssetId?: string | null, aoAssetId?: string | null }> }, ids: Set<string>) {
  if (node.assetId) ids.add(node.assetId)
  if (node.prefabAssetId) ids.add(node.prefabAssetId)
  if (node.nestedPrefabId) ids.add(node.nestedPrefabId)
  if (node.clipAssetId) ids.add(node.clipAssetId)
  if (node.materialAssetId) ids.add(node.materialAssetId)
  for (const id of [node.mapAssetId, node.normalAssetId, node.roughnessAssetId, node.metalnessAssetId, node.emissiveAssetId, node.aoAssetId]) {
    if (id) ids.add(id)
  }
  for (const slot of node.slots ?? []) {
    if (slot.materialAssetId) ids.add(slot.materialAssetId)
    for (const id of [slot.mapAssetId, slot.normalAssetId, slot.roughnessAssetId, slot.metalnessAssetId, slot.emissiveAssetId, slot.aoAssetId]) {
      if (id) ids.add(id)
    }
  }
}

type BrowseEntry = { kind: 'dir'; path: string; name: string } | { kind: 'asset'; asset: ProjectAsset }

function dirItem(node: DirNode): BrowseEntry {
  return { kind: 'dir', path: node.path, name: node.name }
}

function assetItem(asset: ProjectAsset): BrowseEntry {
  return { kind: 'asset', asset }
}

function flattenDirs(node: DirNode): DirNode[] {
  return [node, ...node.children.flatMap(flattenDirs)]
}

function DirNodeView({
  node, depth, browseDir, expanded, renamePath, dropPath, onToggle, onOpen, onRenameDone, onMenu, onDropPath,
}: {
  node: DirNode
  depth: number
  browseDir: string
  expanded: Record<string, boolean>
  renamePath: string | null
  dropPath: string | null
  onToggle: (path: string) => void
  onOpen: (path: string) => void
  onRenameDone: (name: string) => void
  onMenu: (event: MouseEvent, path: string) => void
  onDropPath: (path: string | null) => void
}) {
  const open = expanded[node.path] ?? false
  const active = browseDir === node.path
  const Icon = active || open ? FolderOpen : Folder
  return (
    <>
      <div
        className={`project-browse__tree-item ${active ? 'is-active' : ''} ${dropPath === node.path ? 'is-drop' : ''}`}
        data-asset-dir={node.path}
        style={{ paddingLeft: 6 + depth * 12 }}
        role="button"
        tabIndex={0}
        onClick={() => onOpen(node.path)}
        onContextMenu={event => onMenu(event, node.path)}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') onOpen(node.path)
        }}
        onDragOver={event => {
          const types = [...event.dataTransfer.types]
          if (!types.includes(ASSET_MIME) && !types.includes('Files')) return
          event.preventDefault()
          event.stopPropagation()
          onDropPath(node.path)
        }}
        onDragLeave={() => onDropPath(null)}
        onDrop={event => {
          const assetId = event.dataTransfer.getData(ASSET_MIME)
          const files = [...event.dataTransfer.files]
          event.preventDefault()
          event.stopPropagation()
          onDropPath(null)
          if (assetId) useAssetStore.getState().place(assetId, node.path)
          else if (files.length) void importFiles(files, node.path)
          onOpen(node.path)
        }}
      >
        <button
          type="button"
          className={`project-browse__tree-toggle ${node.children.length === 0 ? 'is-empty' : ''}`}
          disabled={node.children.length === 0}
          onClick={event => {
            event.stopPropagation()
            onToggle(node.path)
          }}
        >
          {node.children.length > 0 && (open ? <Minus size={10} /> : <Plus size={10} />)}
        </button>
        <Icon size={13} />
        {renamePath === node.path ? (
          <input
            className="project-asset__rename"
            autoFocus
            defaultValue={node.name}
            onClick={event => event.stopPropagation()}
            onBlur={event => onRenameDone(event.currentTarget.value.trim())}
            onKeyDown={event => {
              event.stopPropagation()
              if (event.key === 'Enter') event.currentTarget.blur()
              if (event.key === 'Escape') { event.currentTarget.value = node.name; event.currentTarget.blur() }
            }}
          />
        ) : <span>{node.name}</span>}
      </div>
      {open && node.children.map(child => (
        <DirNodeView
          key={child.path}
          node={child}
          depth={depth + 1}
          browseDir={browseDir}
          expanded={expanded}
          renamePath={renamePath}
          dropPath={dropPath}
          onToggle={onToggle}
          onOpen={onOpen}
          onRenameDone={onRenameDone}
          onMenu={onMenu}
          onDropPath={onDropPath}
        />
      ))}
    </>
  )
}

function DirRow({
  path, name, view, renaming, dropping, onOpen, onRenameDone, onMenu, onDropPath,
}: {
  path: string
  name: string
  view: BrowseView
  renaming: boolean
  dropping: boolean
  onOpen: () => void
  onRenameDone: (name: string) => void
  onMenu: (event: MouseEvent) => void
  onDropPath: (path: string | null) => void
}) {
  return (
    <div
      className={`project-asset ${view === 'grid' ? 'project-asset--grid' : ''} ${view === 'details' ? 'project-asset--details' : ''} ${dropping ? 'is-drop' : ''}`}
      data-asset-dir={path}
      title={translate('project.openFolder')}
      onClick={event => event.stopPropagation()}
      onDoubleClick={onOpen}
      onContextMenu={onMenu}
      onDragOver={event => {
        const types = [...event.dataTransfer.types]
        if (!types.includes(ASSET_MIME) && !types.includes('Files')) return
        event.preventDefault()
        event.stopPropagation()
        onDropPath(path)
      }}
      onDragLeave={() => onDropPath(null)}
      onDrop={event => {
        const assetId = event.dataTransfer.getData(ASSET_MIME)
        const files = [...event.dataTransfer.files]
        event.preventDefault()
        event.stopPropagation()
        onDropPath(null)
        if (assetId) useAssetStore.getState().place(assetId, path)
        else if (files.length) void importFiles(files, path)
      }}
    >
      <div className="project-asset__lead">
        <span className={view === 'grid' ? 'project-asset__type project-asset__type--large' : 'project-asset__type'} title={translate('project.folder')}>
          <Folder size={view === 'grid' ? 28 : 14} />
        </span>
        {renaming ? (
          <input
            className="project-asset__rename"
            autoFocus
            defaultValue={name}
            onClick={event => event.stopPropagation()}
            onBlur={event => onRenameDone(event.currentTarget.value.trim())}
            onKeyDown={event => {
              if (event.key === 'Enter') event.currentTarget.blur()
              if (event.key === 'Escape') { event.currentTarget.value = name; event.currentTarget.blur() }
            }}
          />
        ) : <span>{name}</span>}
      </div>
      {view === 'details' && <em>{translate('project.folder')}</em>}
      {view === 'details' && <em>{path}</em>}
    </div>
  )
}
