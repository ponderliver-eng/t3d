import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Clapperboard, Component, Folder, Image, Music, Palette, Search, Sun, Trash2, Upload, X } from 'lucide-react'
import { ASSET_MIME, bindImportInput, deleteAsset, importFiles, openAsset, openImport } from '../assets/import'
import { useAssetStore, type ProjectAsset } from '../assets/library'
import './ProjectPanel.css'

const FOLDERS = [
  { id: 'models', name: '模型', kinds: ['model'], icon: Box, color: 'var(--color-model)', hint: '双击或拖进视口。支持 glTF、GLB、OBJ、FBX、STL。' },
  { id: 'textures', name: '贴图', kinds: ['texture'], icon: Image, color: 'var(--color-image)', hint: '拖到物体上，或在属性里指定贴图槽。支持 PNG、JPG、WebP、KTX2。' },
  { id: 'environments', name: '环境', kinds: ['environment'], icon: Sun, color: '#ffd36b', hint: '双击或拖进视口，用 HDR 作为环境反射和天空。' },
  { id: 'materials', name: '材质', kinds: ['material'], icon: Palette, color: 'var(--color-material)', hint: '在属性里把当前材质存下来，再拖到别的物体上。' },
  { id: 'animations', name: '动画', kinds: ['animation'], icon: Clapperboard, color: 'var(--text-accent)', hint: '只含动画的文件。拖到模型上播放。' },
  { id: 'audio', name: '音频', kinds: ['audio'], icon: Music, color: 'var(--color-sound)', hint: '双击试听。' },
  { id: 'prefabs', name: '预制体', kinds: ['prefab'], icon: Component, color: '#a966d3', hint: '把选中物体存成预制体，再拖进场景生成一份。' },
] as const

export default function ProjectPanel() {
  const [active, setActive] = useState<(typeof FOLDERS)[number]['id']>('models')
  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  const [renameId, setRenameId] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const assets = useAssetStore(state => state.assets)
  const inputRef = useRef<HTMLInputElement>(null)
  const folder = FOLDERS.find(item => item.id === active) ?? FOLDERS[0]
  const q = query.trim().toLowerCase()
  const items = useMemo(
    () => Object.values(assets).filter(asset => (folder.kinds as readonly string[]).includes(asset.kind) && (!q || asset.name.toLowerCase().includes(q))),
    [assets, folder, q],
  )

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
    <div className="project-panel">
      <div className="project-panel__list">
        {FOLDERS.map(item => {
          const Icon = item.icon
          const count = Object.values(assets).filter(asset => (item.kinds as readonly string[]).includes(asset.kind)).length
          return (
            <button
              key={item.id}
              type="button"
              className={`project-panel__folder ${item.id === active ? 'project-panel__folder--active' : ''}`}
              onClick={() => setActive(item.id)}
            >
              <Folder size={13} className="project-panel__folder-mark" />
              <Icon size={13} color={item.color} />
              <span>{item.name}</span>
              {count > 0 && <em>{count}</em>}
            </button>
          )
        })}
      </div>
      <div className="project-panel__toolbar">
        <div className="project-panel__search">
          <Search size={12} />
          <input value={query} placeholder="搜索资源" onChange={event => setQuery(event.target.value)} />
          {query && <button type="button" onClick={() => setQuery('')} title="清除"><X size={12} /></button>}
        </div>
        <button type="button" onClick={openImport} title="导入"><Upload size={12} /></button>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          accept=".gltf,.glb,.obj,.fbx,.stl,.png,.jpg,.jpeg,.webp,.ktx2,.hdr,.mp3,.wav,.ogg"
          onChange={event => {
            const files = [...(event.target.files ?? [])]
            event.target.value = ''
            if (files.length) void importFiles(files)
          }}
        />
      </div>
      <div
        className={`project-panel__assets ${over ? 'project-panel__assets--over' : ''}`}
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
        onContextMenu={event => event.preventDefault()}
      >
        {items.length === 0 && <p className="project-panel__hint-note">{over ? '松开即可导入' : folder.hint}</p>}
        {items.map(asset => (
          <div
            key={asset.id}
            className="project-asset"
            draggable={renameId !== asset.id}
            onDragStart={event => {
              event.dataTransfer.setData(ASSET_MIME, asset.id)
              event.dataTransfer.effectAllowed = 'copy'
            }}
            onDoubleClick={() => void openAsset(asset.id)}
            onContextMenu={event => {
              event.preventDefault()
              event.stopPropagation()
              setMenu({ x: event.clientX, y: event.clientY, id: asset.id })
            }}
            title={assetTitle(asset)}
          >
            <Thumb asset={asset} />
            {renameId === asset.id ? (
              <input
                className="project-asset__rename"
                autoFocus
                defaultValue={asset.name}
                onBlur={event => {
                  const name = event.currentTarget.value.trim()
                  if (name) useAssetStore.getState().rename(asset.id, name)
                  setRenameId(null)
                }}
                onKeyDown={event => {
                  if (event.key === 'Enter') event.currentTarget.blur()
                  if (event.key === 'Escape') {
                    event.currentTarget.value = asset.name
                    event.currentTarget.blur()
                  }
                }}
              />
            ) : (
              <span>{asset.name}</span>
            )}
            <button type="button" title="删除" onClick={() => deleteAsset(asset.id)}><Trash2 size={12} /></button>
          </div>
        ))}
      </div>
      {menu && (
        <div className="project-panel__menu" style={{ left: menu.x, top: menu.y }} onPointerDown={event => event.stopPropagation()}>
          <button type="button" onClick={() => { void openAsset(menu.id); setMenu(null) }}>打开</button>
          <button type="button" onClick={() => { setRenameId(menu.id); setMenu(null) }}>重命名</button>
          <button type="button" onClick={() => { deleteAsset(menu.id); setMenu(null) }}>删除</button>
        </div>
      )}
    </div>
  )
}

function Thumb({ asset }: { asset: ProjectAsset }) {
  if (asset.kind === 'texture' && !asset.fileName.toLowerCase().endsWith('.ktx2')) {
    return <img className="project-asset__thumb" src={asset.url} alt="" />
  }
  if (asset.kind === 'material') {
    return <i className="project-asset__swatch" style={{ background: asset.slot.color }} />
  }
  return null
}

function assetTitle(asset: ProjectAsset): string {
  if (asset.kind === 'model' || asset.kind === 'prefab') return '双击放入场景，或拖进视口'
  if (asset.kind === 'environment') return '双击设为环境'
  if (asset.kind === 'texture' || asset.kind === 'material') return '拖到物体上'
  if (asset.kind === 'animation') return '拖到模型上播放'
  return '双击试听'
}
