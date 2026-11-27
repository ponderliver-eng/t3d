import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { createPortal } from 'react-dom'
import {
  Box,
  ChevronRight,
  Clapperboard,
  ClipboardPaste,
  Component,
  Copy,
  CopyPlus,
  FileCode2,
  FileText,
  Film,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  FolderSearch,
  Globe,
  Image,
  Layers,
  LayoutGrid,
  List,
  ListTree,
  MapPin,
  Minus,
  Music,
  PackageOpen,
  Palette,
  PanelsTopLeft,
  Pencil,
  Plus,
  RefreshCw,
  Rows3,
  Scaling,
  Scissors,
  Search,
  Sparkles,
  Sun,
  Trash2,
  Unlink,
  Upload,
  Wand2,
  X,
} from 'lucide-react'
import { CLIP_MIME } from '../animation/playback'
import {
  ASSET_MIME,
  FOLDER_MIME,
  PROJECT_ITEMS_MIME,
  assignClip,
  bindImportInput,
  createDefaultCutscene,
  createDefaultDocument,
  createDefaultMaterial,
  createDefaultUi,
  duplicateAsset,
  importFiles,
  isNodeDrag,
  NODE_MIME,
  openAsset,
  openImport,
  reimportModel,
  reportAssetUsers,
} from '../assets/import'
import { savePrefabFromSelection } from '../assets/import'
import {
  analyzeDeleteSelection,
  canMoveProjectItems,
  duplicateProjectItems,
  executeDeleteSelection,
  moveProjectItems,
  type DeleteSelectionPlan,
} from '../assets/batchOps'
import {
  assetItemKey,
  beginProjectDrag,
  bindProjectSelectionSync,
  codeItemKey,
  computeNextSelectionOnClick,
  dirItemKey,
  getActiveProjectDragKeys,
  parseProjectItemKey,
  readDraggedProjectKeys,
  useProjectSelectionStore,
  type ProjectItemKey,
} from '../assets/projectSelection'
import { readPrefab } from '../assets/prefab'
import { ASSETS_ROOT, directoryTree, dirName, findDir, isWithin, joinDir, parentDir, type DirNode } from '../assets/folders'
import { MaterialBall } from '../assets/materialBall'
import { assetDirectory, sceneNodeCount, useAssetStore, type ProjectAsset } from '../assets/library'
import { assetDiskPath, folderDiskPath, projectDirectoryPath } from '../project/disk'
import { libraryAssetDiskPath } from '../project/libraryFiles'
import { electronBridge, joinProjectPath } from '../project/electronBridge'
import { clipDuration, clipNamesFor, subscribeModels } from '../assets/models'
import { useEditorStore } from '../scene/store'
import { translate, useI18n, type MessageKey } from '../i18n'
import { openAssetPreview, type PreviewKind } from '../preview/previewStore'
import { openPackagePicker, usePackageImportStore } from '../assets/packageImportStore'
import { TextureResizeDialog } from './TextureResizeDialog'
import { openCodeAssetModal } from '../../core/codeAssets/CodeAssetModal'
import {
  codeAssetDirKey,
  defaultTemplateFor,
  normalizeCodeAssetId,
  saveAndCompileCodeAsset,
  useCodeAssetStore,
} from '../../core/codeAssets/workspace'
import './ProjectPanel.css'

const PILLS = [
  { id: 'all', icon: Layers },
  { id: 'model', icon: Box },
  { id: 'image', icon: Image },
  { id: 'audio', icon: Music },
  { id: 'animation', icon: Clapperboard },
  { id: 'document', icon: FileText },
  { id: 'scene', icon: Globe },
  { id: 'used', icon: MapPin },
  { id: 'unused', icon: Unlink },
] as const

type PillId = (typeof PILLS)[number]['id']
type BrowseView = 'list' | 'grid' | 'details'
type BrowseMenu =
  | { x: number; y: number; target: 'asset'; id: string }
  | { x: number; y: number; target: 'dir'; path: string }
  | { x: number; y: number; target: 'code'; id: string }
  | { x: number; y: number; target: 'batch'; keys: ProjectItemKey[] }

interface MarqueeRect {
  left: number
  top: number
  width: number
  height: number
}

const KIND_ICON = {
  scene: Globe,
  model: Box,
  texture: Image,
  environment: Sun,
  material: Palette,
  animation: Clapperboard,
  audio: Music,
  document: FileText,
  prefab: Component,
  effect: Sparkles,
  ui: PanelsTopLeft,
  cutscene: Film,
} as const

const KIND_COLOR: Record<string, string> = {
  scene: '#4a9eff',
  model: 'var(--color-model)',
  texture: 'var(--color-image)',
  environment: '#ffd36b',
  material: 'var(--color-material)',
  animation: 'var(--text-accent)',
  audio: 'var(--color-sound)',
  document: '#7dd3fc',
  prefab: '#a966d3',
  effect: '#ffb25a',
  ui: '#4a9eff',
}

function kindLabel(kind: string): string {
  const key = `asset.${kind}` as MessageKey
  const known = ['scene', 'model', 'texture', 'environment', 'material', 'animation', 'audio', 'document', 'prefab', 'effect', 'ui', 'cutscene']
  return known.includes(kind) ? translate(key) : kind
}

function extractFallbackDragKeys(dataTransfer: DataTransfer): ProjectItemKey[] {
  const multi = readDraggedProjectKeys(dataTransfer)
  if (multi.length > 0) return multi
  const folder = dataTransfer.getData(FOLDER_MIME)
  if (folder) return [dirItemKey(folder)]
  const assetOrCode = dataTransfer.getData(ASSET_MIME)
  if (assetOrCode) {
    if (assetOrCode.startsWith('code:')) {
      const parsed = parseProjectItemKey(assetOrCode)
      return parsed ? [parsed.key] : []
    }
    return [assetItemKey(assetOrCode)]
  }
  return []
}

function canAcceptProjectDrop(dataTransfer: DataTransfer, targetDir: string): boolean {
  if (isNodeDrag(dataTransfer)) return false
  const types = [...dataTransfer.types]
  if (types.includes('Files')) return true
  if (!types.includes(PROJECT_ITEMS_MIME) && !types.includes(FOLDER_MIME) && !types.includes(ASSET_MIME)) {
    return false
  }
  const activeKeys = getActiveProjectDragKeys()
  if (activeKeys.length > 0) {
    return canMoveProjectItems(activeKeys, targetDir)
  }
  return true
}

function handleProjectDrop(dataTransfer: DataTransfer, targetDir: string) {
  const dragKeys = extractFallbackDragKeys(dataTransfer)
  if (dragKeys.length > 0) {
    moveProjectItems(dragKeys, targetDir)
    return
  }
  const files = [...dataTransfer.files]
  if (files.length === 0) return
  const packages = files.filter(file => file.name.toLowerCase().endsWith('.unitypackage'))
  const rest = files.filter(file => !file.name.toLowerCase().endsWith('.unitypackage'))
  if (packages[0]) usePackageImportStore.getState().open(packages[0])
  if (rest.length) void importFiles(rest, targetDir)
}

export default function ProjectPanel() {
  const { t } = useI18n()
  const [pill, setPill] = useState<PillId>('all')
  const [view, setView] = useState<BrowseView>('list')
  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState<BrowseMenu | null>(null)
  const [renameId, setRenameId] = useState<string | null>(null)
  const [renamePath, setRenamePath] = useState<string | null>(null)
  const expanded = useAssetStore(state => state.expanded)
  const [over, setOver] = useState(false)
  const [dropPath, setDropPath] = useState<string | null>(null)
  const [clipOpen, setClipOpen] = useState<Record<string, boolean>>({})
  const [deletePlan, setDeletePlan] = useState<DeleteSelectionPlan | null>(null)
  const [resizeTargets, setResizeTargets] = useState<string[] | null>(null)
  const [marquee, setMarquee] = useState<MarqueeRect | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const assetsAreaRef = useRef<HTMLDivElement>(null)
  const suppressClickClearRef = useRef(false)

  const selectedKeys = useProjectSelectionStore(state => state.selectedKeys)
  const clipboard = useProjectSelectionStore(state => state.clipboard)

  const selectedSet = useMemo(() => new Set<ProjectItemKey>(selectedKeys), [selectedKeys])
  const cutSet = useMemo(
    () => new Set<ProjectItemKey>(clipboard?.mode === 'cut' ? clipboard.keys : []),
    [clipboard],
  )

  useEffect(() => {
    bindProjectSelectionSync()
  }, [])

  const assets = useAssetStore(state => state.assets)
  const codeAssets = useCodeAssetStore(state => state.assets)
  const folders = useAssetStore(state => state.folders)
  const assetDirs = useAssetStore(state => state.assetDirs)
  const browseDir = useAssetStore(state => state.browseDir)
  const activeSceneId = useEditorStore(state => state.activeSceneId)
  const inspectedAssetId = useEditorStore(state => state.inspectedAssetId)
  const assetPing = useEditorStore(state => state.assetPing)
  const [pingedId, setPingedId] = useState<string | null>(null)
  const [modelVersion, setModelVersion] = useState(0)
  useEffect(() => subscribeModels(() => setModelVersion(value => value + 1)), [])
  const nodes = useEditorStore(state => state.nodes)
  const q = query.trim().toLowerCase()
  const referenced = useMemo(() => referencedIds(nodes, assets), [nodes, assets])

  const filteredCodeAssets = useMemo(() => {
    return Object.values(codeAssets)
      .filter(item => {
        const dir = assetDirectory(codeAssetDirKey(item.kind, item.id), assetDirs)
        if (q) {
          const matchText = item.name.toLowerCase().includes(q) || item.relativePath.toLowerCase().includes(q)
          if (!matchText) return false
        } else {
          if (pill === 'all') {
            if (dir !== browseDir) return false
          } else if (!isWithin(dir, browseDir)) {
            return false
          }
        }
        if (pill === 'used') return countCodeAssetReferences(item, assets, nodes, activeSceneId) > 0
        if (pill === 'unused') return countCodeAssetReferences(item, assets, nodes, activeSceneId) === 0
        return pill === 'all'
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  }, [activeSceneId, assetDirs, assets, browseDir, codeAssets, nodes, pill, q])

  const tree = useMemo(() => directoryTree(folders, assetDirs), [folders, assetDirs])
  const allDirs = useMemo(() => flattenDirs(tree), [tree])

  const items = useMemo(() => {
    const matchesPill = (asset: ProjectAsset) => {
      if (pill === 'model' && asset.kind !== 'model' && asset.kind !== 'prefab') return false
      if (pill === 'image' && asset.kind !== 'texture' && asset.kind !== 'material' && asset.kind !== 'environment') return false
      if (pill === 'audio' && asset.kind !== 'audio') return false
      if (pill === 'document' && asset.kind !== 'document') return false
      if (pill === 'animation' && asset.kind !== 'animation' && clipEntries(asset).length === 0) return false
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
  }, [assets, assetDirs, browseDir, modelVersion, pill, q, referenced, tree])

  const visibleKeys = useMemo<ProjectItemKey[]>(() => {
    const keys: ProjectItemKey[] = []
    for (const item of items) {
      keys.push(item.kind === 'dir' ? dirItemKey(item.path) : assetItemKey(item.asset.id))
    }
    for (const code of filteredCodeAssets) {
      keys.push(codeItemKey(code.kind, code.id))
    }
    return keys
  }, [items, filteredCodeAssets])

  useEffect(() => {
    const current = useAssetStore.getState().expanded
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
    if (changed) useAssetStore.getState().setExpanded(next)
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

  useEffect(() => {
    document.querySelector('.project-browse__tree-item.is-active')?.scrollIntoView({ block: 'nearest' })
  }, [browseDir])

  useEffect(() => {
    if (!assetPing) return
    if (assetPing.id.startsWith('code:')) {
      const shown = filteredCodeAssets.some(item => codeAssetDirKey(item.kind, item.id) === assetPing.id)
      if (!shown) {
        if (pill !== 'all') setPill('all')
        if (q) setQuery('')
        return
      }
      const node = document.querySelector(`[data-code-id="${CSS.escape(assetPing.id)}"]`)
      node?.scrollIntoView({ block: 'nearest' })
      setPingedId(assetPing.id)
      const timer = window.setTimeout(() => setPingedId(current => current === assetPing.id ? null : current), 1400)
      return () => window.clearTimeout(timer)
    }
    if (!assets[assetPing.id]) return
    const shown = items.some(item => item.kind === 'asset' && item.asset.id === assetPing.id)
    if (!shown) {
      if (pill !== 'all') setPill('all')
      if (q) setQuery('')
      return
    }
    const node = document.querySelector(`[data-asset-id="${CSS.escape(assetPing.id)}"]`)
    node?.scrollIntoView({ block: 'nearest' })
    setPingedId(assetPing.id)
    const timer = window.setTimeout(() => setPingedId(current => current === assetPing.id ? null : current), 1400)
    return () => window.clearTimeout(timer)
  }, [assetPing, assets, filteredCodeAssets, items, pill, q])

  useEffect(() => {
    if (!inspectedAssetId || !assets[inspectedAssetId]) return
    const shown = items.some(item => item.kind === 'asset' && item.asset.id === inspectedAssetId)
    if (!shown) {
      if (pill !== 'all') setPill('all')
      if (q) setQuery('')
      return
    }
    document.querySelector(`[data-asset-id="${CSS.escape(inspectedAssetId)}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [assets, inspectedAssetId, items, pill, q])

  const requestDeleteKeys = (keys: readonly ProjectItemKey[]) => {
    const plan = analyzeDeleteSelection(keys)
    if (plan && (plan.assets.length > 0 || plan.codes.length > 0 || plan.dirs.length > 0)) {
      setDeletePlan(plan)
    } else if (plan?.keptLastSceneName) {
      useEditorStore.getState().log('warn', translate('log.keepScene'))
    }
  }

  const pasteIntoDir = (targetDir: string) => {
    const clip = useProjectSelectionStore.getState().clipboard
    if (!clip || clip.keys.length === 0) return
    if (clip.mode === 'cut') {
      if (canMoveProjectItems(clip.keys, targetDir)) {
        moveProjectItems(clip.keys, targetDir)
      }
      useProjectSelectionStore.getState().setClipboard(null)
    } else {
      void duplicateProjectItems(clip.keys, targetDir)
    }
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const root = panelRef.current
      const target = event.target as HTMLElement | null
      if (!root || !target || !root.contains(target)) return
      const tag = target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return

      const sel = useProjectSelectionStore.getState().selectedKeys
      const mod = event.ctrlKey || event.metaKey
      const lower = event.key.toLowerCase()

      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (sel.length === 0) return
        event.preventDefault()
        event.stopPropagation()
        requestDeleteKeys(sel)
        return
      }

      if (mod && lower === 'a') {
        event.preventDefault()
        event.stopPropagation()
        useProjectSelectionStore.getState().setSelectedKeys(visibleKeys)
        return
      }

      if (mod && lower === 'd') {
        if (sel.length === 0) return
        event.preventDefault()
        event.stopPropagation()
        void duplicateProjectItems(sel)
        return
      }

      if (mod && lower === 'c') {
        if (sel.length === 0) return
        event.preventDefault()
        event.stopPropagation()
        useProjectSelectionStore.getState().setClipboard({ mode: 'copy', keys: sel })
        return
      }

      if (mod && lower === 'x') {
        if (sel.length === 0) return
        event.preventDefault()
        event.stopPropagation()
        useProjectSelectionStore.getState().setClipboard({ mode: 'cut', keys: sel })
        return
      }

      if (mod && lower === 'v') {
        const clip = useProjectSelectionStore.getState().clipboard
        if (!clip || clip.keys.length === 0) return
        event.preventDefault()
        event.stopPropagation()
        pasteIntoDir(useAssetStore.getState().browseDir)
        return
      }

      if (event.key === 'F2' && sel.length === 1) {
        const parsed = parseProjectItemKey(sel[0]!)
        if (!parsed) return
        event.preventDefault()
        event.stopPropagation()
        if (parsed.type === 'asset') setRenameId(parsed.id)
        else if (parsed.type === 'dir' && parsed.path !== ASSETS_ROOT) setRenamePath(parsed.path)
        return
      }

      if (event.key === 'Escape') {
        const clip = useProjectSelectionStore.getState().clipboard
        if (clip?.mode === 'cut') {
          event.preventDefault()
          useProjectSelectionStore.getState().setClipboard(null)
        } else if (sel.length > 0) {
          event.preventDefault()
          useProjectSelectionStore.getState().clearSelection()
        }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [visibleKeys])

  useEffect(() => {
    if (!deletePlan) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setDeletePlan(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [deletePlan])

  const handleItemClick = (key: ProjectItemKey, event: MouseEvent) => {
    event.stopPropagation()
    const state = useProjectSelectionStore.getState()
    const next = computeNextSelectionOnClick(key, visibleKeys, state.selectedKeys, state.anchorKey, {
      ctrlOrMeta: event.ctrlKey || event.metaKey,
      shift: event.shiftKey,
    })
    state.setSelectedKeys(next.keys, next.anchor)
  }

  const handleItemContextMenu = (key: ProjectItemKey, event: MouseEvent, singleMenu: BrowseMenu) => {
    event.preventDefault()
    event.stopPropagation()
    const state = useProjectSelectionStore.getState()
    if (state.selectedKeys.includes(key) && state.selectedKeys.length > 1) {
      setMenu({ x: event.clientX, y: event.clientY, target: 'batch', keys: state.selectedKeys })
      return
    }
    if (!state.selectedKeys.includes(key) || state.selectedKeys.length !== 1) {
      state.setSelectedKeys([key], key)
    }
    setMenu(singleMenu)
  }

  const handleItemDragStart = (
    key: ProjectItemKey,
    event: ReactDragEvent,
    fallback: { mime: string; value: string },
  ) => {
    event.stopPropagation()
    const state = useProjectSelectionStore.getState()
    const keys = state.selectedKeys.includes(key) ? state.selectedKeys : [key]
    if (!state.selectedKeys.includes(key)) {
      state.setSelectedKeys([key], key)
    }
    beginProjectDrag(keys, event)
    event.dataTransfer.setData(fallback.mime, fallback.value)
    event.dataTransfer.effectAllowed = 'copyMove'
  }

  const handleMarqueePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const target = event.target as HTMLElement
    if (target.closest('.project-asset') || target.closest('.project-clip') || target.closest('button') || target.closest('input')) {
      return
    }
    const container = assetsAreaRef.current
    if (!container) return

    const startClientX = event.clientX
    const startClientY = event.clientY
    const additive = event.ctrlKey || event.metaKey || event.shiftKey
    const baseSelection = additive ? [...useProjectSelectionStore.getState().selectedKeys] : []
    let started = false

    const updateMarquee = (clientX: number, clientY: number) => {
      const rect = container.getBoundingClientRect()
      const x1 = startClientX - rect.left + container.scrollLeft
      const y1 = startClientY - rect.top + container.scrollTop
      const x2 = clientX - rect.left + container.scrollLeft
      const y2 = clientY - rect.top + container.scrollTop
      const left = Math.min(x1, x2)
      const top = Math.min(y1, y2)
      const width = Math.abs(x2 - x1)
      const height = Math.abs(y2 - y1)
      setMarquee({ left, top, width, height })

      const vLeft = Math.min(startClientX, clientX)
      const vRight = Math.max(startClientX, clientX)
      const vTop = Math.min(startClientY, clientY)
      const vBottom = Math.max(startClientY, clientY)

      const hitKeys: ProjectItemKey[] = []
      const elements = container.querySelectorAll<HTMLElement>('[data-project-key]')
      elements.forEach(el => {
        const key = el.dataset.projectKey as ProjectItemKey | undefined
        if (!key) return
        const r = el.getBoundingClientRect()
        const intersects = r.left <= vRight && r.right >= vLeft && r.top <= vBottom && r.bottom >= vTop
        if (intersects) hitKeys.push(key)
      })
      const merged = additive ? [...new Set([...baseSelection, ...hitKeys])] : hitKeys
      useProjectSelectionStore.getState().setSelectedKeys(merged)
    }

    const onMove = (moveEvent: PointerEvent) => {
      if (!started) {
        if (Math.hypot(moveEvent.clientX - startClientX, moveEvent.clientY - startClientY) < 5) return
        started = true
        suppressClickClearRef.current = true
      }
      updateMarquee(moveEvent.clientX, moveEvent.clientY)
    }

    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      if (started) {
        setMarquee(null)
        window.setTimeout(() => {
          suppressClickClearRef.current = false
        }, 0)
      }
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  return (
    <div
      ref={panelRef}
      className="project-panel project-browse"
      data-asset-dir={browseDir}
      tabIndex={-1}
      onMouseDown={event => {
        const tag = (event.target as HTMLElement).tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
        panelRef.current?.focus({ preventScroll: true })
      }}
      onDragOver={event => {
        if (!isNodeDrag(event.dataTransfer)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
        const folder = (event.target as HTMLElement).closest<HTMLElement>('[data-asset-dir]')
        document.querySelectorAll('.is-prefab-drop').forEach(element => {
          if (element !== folder) element.classList.remove('is-prefab-drop')
        })
        folder?.classList.add('is-prefab-drop')
      }}
      onDragLeave={event => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return
        document.querySelectorAll('.is-prefab-drop').forEach(element => element.classList.remove('is-prefab-drop'))
      }}
      onDrop={event => {
        if (!isNodeDrag(event.dataTransfer)) return
        event.preventDefault()
        event.stopPropagation()
        document.querySelectorAll('.is-prefab-drop').forEach(element => element.classList.remove('is-prefab-drop'))
        const id = event.dataTransfer.getData(NODE_MIME)
        const node = useEditorStore.getState().nodes[id]
        if (!node || useEditorStore.getState().playState !== 'stopped') return
        if (node.prefabInstanceId === node.id) {
          useEditorStore.getState().log('warn', translate('prefab.alreadyInstance'))
          return
        }
        const dir = (event.target as HTMLElement).closest<HTMLElement>('[data-asset-dir]')?.dataset.assetDir || browseDir
        useEditorStore.getState().createPrefabFromSelection(node.name, node.id, dir)
      }}
    >
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
          onToggle={path => {
            const current = useAssetStore.getState().expanded
            useAssetStore.getState().setExpanded({ ...current, [path]: !current[path] })
          }}
          onOpen={path => {
            useAssetStore.getState().setBrowseDir(path)
            useProjectSelectionStore.getState().clearSelection()
          }}
          onRenameDone={name => {
            if (renamePath && name) {
              const parent = parentDir(renamePath)
              useAssetStore.getState().renameFolder(renamePath, name)
              if (parent) {
                const nextPath = joinDir(parent, name.trim().replace(/[\\/]/g, ''))
                if (selectedSet.has(dirItemKey(renamePath))) {
                  useProjectSelectionStore.getState().setSelectedKeys([dirItemKey(nextPath)])
                }
              }
            }
            setRenamePath(null)
          }}
          onMenu={(event, path) => {
            event.preventDefault()
            event.stopPropagation()
            if (path !== ASSETS_ROOT) {
              const k = dirItemKey(path)
              const sel = useProjectSelectionStore.getState().selectedKeys
              if (sel.includes(k) && sel.length > 1) {
                setMenu({ x: event.clientX, y: event.clientY, target: 'batch', keys: sel })
                return
              }
              useProjectSelectionStore.getState().setSelectedKeys([k], k)
            }
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
            accept=".gltf,.glb,.obj,.fbx,.dae,.3ds,.stl,.png,.jpg,.jpeg,.webp,.svg,.ktx2,.hdr,.exr,.env,.mp3,.wav,.ogg,.md,.markdown,.txt,.json,.yaml,.yml,.csv,.tsv,.xml,.ini,.cfg,.conf,.toml,.log,.unitypackage"
            onChange={event => {
              const files = [...(event.target.files ?? [])]
              event.target.value = ''
              const packages = files.filter(file => file.name.toLowerCase().endsWith('.unitypackage'))
              const rest = files.filter(file => !file.name.toLowerCase().endsWith('.unitypackage'))
              if (packages[0]) usePackageImportStore.getState().open(packages[0])
              if (rest.length) void importFiles(rest)
            }}
          />
        </div>
        <div className="project-browse__filters">
          {PILLS.map(item => {
            const Icon = item.icon
            const label = t(`project.${item.id}` as MessageKey)
            return (
              <button key={item.id} type="button" className={pill === item.id ? 'is-on' : ''} title={label} aria-label={label} onClick={() => setPill(item.id)}>
                <Icon size={13} />
              </button>
            )
          })}
          <span title={t('project.count', { count: items.length + filteredCodeAssets.length })}>
            {selectedKeys.length > 1
              ? `${selectedKeys.length} / ${items.length + filteredCodeAssets.length}`
              : items.length + filteredCodeAssets.length}
          </span>
          <button type="button" className={view === 'list' ? 'is-on' : ''} title={t('project.list')} onClick={() => setView('list')}><List size={13} /></button>
          <button type="button" className={view === 'details' ? 'is-on' : ''} title={t('project.details')} onClick={() => setView('details')}><Rows3 size={13} /></button>
          <button type="button" className={view === 'grid' ? 'is-on' : ''} title={t('project.grid')} onClick={() => setView('grid')}><LayoutGrid size={13} /></button>
        </div>
        <div
          ref={assetsAreaRef}
          className={`project-browse__assets ${view === 'grid' ? 'is-grid' : ''} ${view === 'details' ? 'is-details' : ''} ${over ? 'is-over' : ''}`}
          data-asset-dir={browseDir}
          onPointerDown={handleMarqueePointerDown}
          onDragOver={event => {
            if (!canAcceptProjectDrop(event.dataTransfer, browseDir)) return
            event.preventDefault()
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={event => {
            if (!canAcceptProjectDrop(event.dataTransfer, browseDir)) return
            event.preventDefault()
            setOver(false)
            handleProjectDrop(event.dataTransfer, browseDir)
          }}
          onClick={event => {
            if (suppressClickClearRef.current) return
            if ((event.target as HTMLElement).closest('.project-asset')) return
            if (event.ctrlKey || event.metaKey || event.shiftKey) return
            useProjectSelectionStore.getState().clearSelection()
          }}
          onContextMenu={event => {
            if ((event.target as HTMLElement).closest('.project-asset')) return
            event.preventDefault()
            useProjectSelectionStore.getState().clearSelection()
            setMenu({ x: event.clientX, y: event.clientY, target: 'dir', path: browseDir })
          }}
        >
          {marquee && (
            <div
              className="project-marquee"
              style={{
                left: marquee.left,
                top: marquee.top,
                width: marquee.width,
                height: marquee.height,
              }}
            />
          )}
          {view === 'details' && (items.length > 0 || filteredCodeAssets.length > 0) && (
            <div className="project-browse__detail-head"><span>{t('project.name')}</span><span>{t('project.type')}</span><span>{t('project.detail')}</span></div>
          )}
          {items.length === 0 && filteredCodeAssets.length === 0 && (
            <p className="project-panel__hint-note">{over ? t('project.drop') : t('project.empty')}</p>
          )}
          {items.map(item => {
            if (item.kind === 'dir') {
              const key = dirItemKey(item.path)
              return (
                <DirRow
                  key={item.path}
                  itemKey={key}
                  path={item.path}
                  name={item.name}
                  view={view}
                  picked={selectedSet.has(key)}
                  cut={cutSet.has(key)}
                  renaming={renamePath === item.path}
                  dropping={dropPath === item.path}
                  onClick={event => handleItemClick(key, event)}
                  onOpen={() => {
                    useAssetStore.getState().setBrowseDir(item.path)
                    useProjectSelectionStore.getState().clearSelection()
                  }}
                  onDragStart={event => handleItemDragStart(key, event, { mime: FOLDER_MIME, value: item.path })}
                  onRenameDone={name => {
                    if (name) {
                      const parent = parentDir(item.path)
                      useAssetStore.getState().renameFolder(item.path, name)
                      if (parent) {
                        const nextPath = joinDir(parent, name.trim().replace(/[\\/]/g, ''))
                        if (selectedSet.has(key)) {
                          useProjectSelectionStore.getState().setSelectedKeys([dirItemKey(nextPath)])
                        }
                      }
                    }
                    setRenamePath(null)
                  }}
                  onMenu={event => handleItemContextMenu(key, event, { x: event.clientX, y: event.clientY, target: 'dir', path: item.path })}
                  onDelete={event => {
                    event.stopPropagation()
                    requestDeleteKeys([key])
                  }}
                  onDropPath={setDropPath}
                />
              )
            }

            const key = assetItemKey(item.asset.id)
            return (
              <AssetRow
                key={item.asset.id}
                itemKey={key}
                asset={item.asset}
                view={view}
                picked={selectedSet.has(key)}
                cut={cutSet.has(key)}
                pinged={pingedId === item.asset.id}
                used={referenced.has(item.asset.id)}
                renaming={renameId === item.asset.id}
                onRenameDone={name => {
                  if (name) useAssetStore.getState().rename(item.asset.id, name)
                  setRenameId(null)
                }}
                onClick={event => handleItemClick(key, event)}
                onDragStart={event => handleItemDragStart(key, event, { mime: ASSET_MIME, value: item.asset.id })}
                onDoubleClick={() => {
                  const asset = item.asset
                  if (asset.kind === 'scene') {
                    if (activeSceneId !== asset.id) {
                      useEditorStore.getState().openScene(asset.id)
                    }
                    return
                  }
                  if (asset.kind === 'prefab') {
                    useEditorStore.getState().openPrefab(asset.id)
                    return
                  }
                  const preview = previewKind(asset.kind)
                  if (preview) openAssetPreview(preview, asset.id, asset.name)
                  else void openAsset(asset.id)
                }}
                onMenu={event => handleItemContextMenu(key, event, { x: event.clientX, y: event.clientY, target: 'asset', id: item.asset.id })}
                onDelete={event => {
                  event.stopPropagation()
                  requestDeleteKeys([key])
                }}
                clipsOpen={clipOpen[item.asset.id] === true || (q.length > 0 && clipEntries(item.asset).some(clip => clip.name.toLowerCase().includes(q)))}
                onToggleClips={() => setClipOpen(current => ({ ...current, [item.asset.id]: !current[item.asset.id] }))}
              />
            )
          })}
          {filteredCodeAssets.map(item => {
            const Icon = item.kind === 'shader' ? Wand2 : FileCode2
            const iconColor = item.kind === 'shader' ? '#c084fc' : '#38bdf8'
            const fileName = item.relativePath.split('/').pop() ?? item.relativePath
            const key = codeItemKey(item.kind, item.id)
            const dirKey = codeAssetDirKey(item.kind, item.id)
            return (
              <div key={`code:${item.id}`} className="project-asset-block">
                <div
                  data-project-key={key}
                  data-code-id={dirKey}
                  className={`project-asset ${view === 'grid' ? 'project-asset--grid' : ''} ${view === 'details' ? 'project-asset--details' : ''} ${selectedSet.has(key) ? 'project-asset--picked' : ''} ${cutSet.has(key) ? 'project-asset--cut' : ''} ${pingedId === dirKey ? 'project-asset--ping' : ''}`}
                  title={`${item.name} (${item.relativePath})`}
                  draggable
                  onDragStart={event => handleItemDragStart(key, event, { mime: ASSET_MIME, value: dirKey })}
                  onClick={event => handleItemClick(key, event)}
                  onDoubleClick={() => openCodeAssetModal(item.kind, item.id)}
                  onContextMenu={event => handleItemContextMenu(key, event, { x: event.clientX, y: event.clientY, target: 'code', id: item.id })}
                >
                  <div className="project-asset__lead">
                    <Icon size={view === 'grid' ? 28 : 14} style={{ color: iconColor, flexShrink: 0 }} />
                    <span>{fileName}</span>
                    <span
                      className={`project-code-badge ${item.ok ? 'is-ok' : 'is-err'}`}
                      title={item.ok ? '编译通过' : `${item.diagnostics.length} 个编译错误`}
                    >
                      {item.ok ? '' : `${item.diagnostics.length}错`}
                    </span>
                  </div>
                  {view === 'details' && <em>{item.kind === 'shader' ? '着色器' : '脚本'}</em>}
                  {view === 'details' && <em>{item.ok ? item.name : `${item.diagnostics.length} 个错误`}</em>}
                  {view !== 'grid' && (
                    <button
                      type="button"
                      title="移除代码资产"
                      onClick={event => {
                        event.stopPropagation()
                        requestDeleteKeys([key])
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {menu?.target === 'asset' && (() => {
        const key = assetItemKey(menu.id)
        const itemDir = assetDirectory(menu.id, useAssetStore.getState().assetDirs)
        return (
          <div className="project-panel__menu" style={{ left: menu.x, top: menu.y }} onPointerDown={event => event.stopPropagation()}>
            <CreateMenu dir={itemDir} onDone={() => setMenu(null)} onNewFolder={path => setRenamePath(path)} />
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
                else void openAsset(menu.id)
              }
              setMenu(null)
            }}><FolderOpen size={12} />{t('project.open')}</button>
            {(assetKind(menu.id) === 'model' || assetKind(menu.id) === 'prefab') && (
              <button type="button" onClick={() => { void openAsset(menu.id); setMenu(null) }}><Box size={12} />{t('project.place')}</button>
            )}
            {(assetKind(menu.id) === 'model' || assetKind(menu.id) === 'animation') && (
              <button type="button" onClick={() => { void reimportModel(menu.id); setMenu(null) }}><RefreshCw size={12} />{t('preview.reimport')}</button>
            )}
            {assetKind(menu.id) === 'texture' && (
              <button type="button" onClick={() => { setResizeTargets([menu.id]); setMenu(null) }}><Scaling size={12} />{t('project.resizeTextures')}</button>
            )}
            <button type="button" onClick={() => { duplicateAsset(menu.id); setMenu(null) }}>
              <CopyPlus size={12} />{t('project.duplicate')}
              <span className="project-panel__menu-badge">Ctrl+D</span>
            </button>
            <button type="button" onClick={() => { useProjectSelectionStore.getState().setClipboard({ mode: 'copy', keys: [key] }); setMenu(null) }}>
              <Copy size={12} />复制
              <span className="project-panel__menu-badge">Ctrl+C</span>
            </button>
            <button type="button" onClick={() => { useProjectSelectionStore.getState().setClipboard({ mode: 'cut', keys: [key] }); setMenu(null) }}>
              <Scissors size={12} />剪切
              <span className="project-panel__menu-badge">Ctrl+X</span>
            </button>
            <MoveToMenu keys={[key]} dirs={allDirs} onDone={() => setMenu(null)} />
            <button type="button" onClick={() => { void revealOnDisk(assetDiskPath(menu.id) ?? libraryAssetDiskPath(menu.id)); setMenu(null) }}><FolderSearch size={12} />{t('project.reveal')}</button>
            <div className="project-panel__sep" />
            <button type="button" onClick={() => { reportAssetUsers(menu.id); setMenu(null) }}><ListTree size={12} />{t('project.findRefs')}</button>
            <button type="button" onClick={() => { setRenameId(menu.id); setMenu(null) }}><Pencil size={12} />{t('project.rename')}</button>
            <div className="project-panel__sep" />
            <button type="button" onClick={() => {
              requestDeleteKeys([key])
              setMenu(null)
            }}><Trash2 size={12} />{t('project.delete')}</button>
          </div>
        )
      })()}

      {menu?.target === 'code' && (() => {
        const codeItem = useCodeAssetStore.getState().assets[menu.id]
        if (!codeItem) return null
        const key = codeItemKey(codeItem.kind, codeItem.id)
        const dir = projectDirectoryPath()
        const diskTarget = dir ? joinProjectPath(dir, codeItem.relativePath) : null
        const openExternal = (editor: 'cursor' | 'code') => {
          const bridge = electronBridge()
          if (diskTarget && bridge?.codeAssets?.openInEditor) {
            void bridge.codeAssets.openInEditor(diskTarget, editor)
          }
          setMenu(null)
        }
        return (
          <div className="project-panel__menu" style={{ left: menu.x, top: menu.y }} onPointerDown={event => event.stopPropagation()}>
            <CreateMenu dir={assetDirectory(codeAssetDirKey(codeItem.kind, codeItem.id), assetDirs)} onDone={() => setMenu(null)} onNewFolder={path => setRenamePath(path)} />
            <div className="project-panel__sep" />
            <button type="button" onClick={() => { openCodeAssetModal(codeItem.kind, codeItem.id); setMenu(null) }}>
              <FolderOpen size={12} />{t('project.open')}
            </button>
            {diskTarget && electronBridge()?.codeAssets?.openInEditor && (
              <>
                <button type="button" onClick={() => openExternal('cursor')}>
                  <FileCode2 size={12} />在 Cursor 中打开
                </button>
                <button type="button" onClick={() => openExternal('code')}>
                  <FileCode2 size={12} />在 VS Code 中打开
                </button>
              </>
            )}
            <button type="button" onClick={() => { void duplicateProjectItems([key]); setMenu(null) }}>
              <CopyPlus size={12} />{t('project.duplicate')}
              <span className="project-panel__menu-badge">Ctrl+D</span>
            </button>
            <button type="button" onClick={() => { useProjectSelectionStore.getState().setClipboard({ mode: 'copy', keys: [key] }); setMenu(null) }}>
              <Copy size={12} />复制
              <span className="project-panel__menu-badge">Ctrl+C</span>
            </button>
            <button type="button" onClick={() => { useProjectSelectionStore.getState().setClipboard({ mode: 'cut', keys: [key] }); setMenu(null) }}>
              <Scissors size={12} />剪切
              <span className="project-panel__menu-badge">Ctrl+X</span>
            </button>
            <MoveToMenu keys={[key]} dirs={allDirs} onDone={() => setMenu(null)} />
            <button type="button" onClick={() => { revealOnDisk(diskTarget); setMenu(null) }}>
              <FolderSearch size={12} />{t('project.reveal')}
            </button>
            <div className="project-panel__sep" />
            <button type="button" onClick={() => {
              requestDeleteKeys([key])
              setMenu(null)
            }}>
              <Trash2 size={12} />{t('project.delete')}
            </button>
          </div>
        )
      })()}

      {menu?.target === 'dir' && (() => {
        const isRoot = menu.path === ASSETS_ROOT
        const key = dirItemKey(menu.path)
        return (
          <div className="project-panel__menu" style={{ left: menu.x, top: menu.y }} onPointerDown={event => event.stopPropagation()}>
            <CreateMenu dir={menu.path} onDone={() => setMenu(null)} onNewFolder={path => setRenamePath(path)} />
            {clipboard && clipboard.keys.length > 0 && (
              <button type="button" onClick={() => { pasteIntoDir(menu.path); setMenu(null) }}>
                <ClipboardPaste size={12} />粘贴 ({clipboard.keys.length})
                <span className="project-panel__menu-badge">Ctrl+V</span>
              </button>
            )}
            <div className="project-panel__sep" />
            <button type="button" onClick={() => { useAssetStore.getState().setBrowseDir(menu.path); setMenu(null) }}><FolderOpen size={12} />{t('project.open')}</button>
            <button type="button" onClick={() => { void revealOnDisk(folderDiskPath(menu.path), true); setMenu(null) }}><FolderSearch size={12} />{t('project.reveal')}</button>
            <button type="button" onClick={() => {
              const store = useAssetStore.getState()
              const ids = Object.values(store.assets)
                .filter(asset => asset.kind === 'texture' && isWithin(assetDirectory(asset.id, store.assetDirs), menu.path))
                .map(asset => asset.id)
              setResizeTargets(ids)
              setMenu(null)
            }}><Scaling size={12} />{t('project.resizeTextures')}</button>
            <button type="button" onClick={() => { setMenu(null); openPackagePicker() }}><PackageOpen size={12} />{t('menu.extractPackage')}</button>
            {!isRoot && (
              <>
                <div className="project-panel__sep" />
                <button type="button" onClick={() => { void duplicateProjectItems([key]); setMenu(null) }}>
                  <CopyPlus size={12} />{t('project.duplicate')}
                  <span className="project-panel__menu-badge">Ctrl+D</span>
                </button>
                <button type="button" onClick={() => { useProjectSelectionStore.getState().setClipboard({ mode: 'copy', keys: [key] }); setMenu(null) }}>
                  <Copy size={12} />复制
                  <span className="project-panel__menu-badge">Ctrl+C</span>
                </button>
                <button type="button" onClick={() => { useProjectSelectionStore.getState().setClipboard({ mode: 'cut', keys: [key] }); setMenu(null) }}>
                  <Scissors size={12} />剪切
                  <span className="project-panel__menu-badge">Ctrl+X</span>
                </button>
                <MoveToMenu keys={[key]} dirs={allDirs} onDone={() => setMenu(null)} />
                <button type="button" onClick={() => { setRenamePath(menu.path); setMenu(null) }}><Pencil size={12} />{t('project.rename')}</button>
                <div className="project-panel__sep" />
                <button type="button" onClick={() => {
                  requestDeleteKeys([key])
                  setMenu(null)
                }}><Trash2 size={12} />{t('project.delete')}</button>
              </>
            )}
          </div>
        )
      })()}

      {menu?.target === 'batch' && (() => {
        const batchKeys = menu.keys
        const store = useAssetStore.getState()
        const textureIds = collectTextureIdsFromSelection(batchKeys, store.assets, store.assetDirs)
        const modelIds = collectModelIdsFromSelection(batchKeys, store.assets, store.assetDirs)
        const placeableIds = collectPlaceableIdsFromSelection(batchKeys, store.assets)
        return (
          <div className="project-panel__menu" style={{ left: menu.x, top: menu.y }} onPointerDown={event => event.stopPropagation()}>
            {placeableIds.length > 0 && (
              <button type="button" onClick={() => {
                void (async () => {
                  for (const id of placeableIds) await openAsset(id)
                })()
                setMenu(null)
              }}>
                <Box size={12} />{t('project.place')} ({placeableIds.length})
              </button>
            )}
            <MoveToMenu keys={batchKeys} dirs={allDirs} onDone={() => setMenu(null)} />
            <button type="button" onClick={() => { void duplicateProjectItems(batchKeys); setMenu(null) }}>
              <CopyPlus size={12} />{t('project.duplicate')} ({batchKeys.length})
              <span className="project-panel__menu-badge">Ctrl+D</span>
            </button>
            <button type="button" onClick={() => { useProjectSelectionStore.getState().setClipboard({ mode: 'copy', keys: batchKeys }); setMenu(null) }}>
              <Copy size={12} />复制 ({batchKeys.length})
              <span className="project-panel__menu-badge">Ctrl+C</span>
            </button>
            <button type="button" onClick={() => { useProjectSelectionStore.getState().setClipboard({ mode: 'cut', keys: batchKeys }); setMenu(null) }}>
              <Scissors size={12} />剪切 ({batchKeys.length})
              <span className="project-panel__menu-badge">Ctrl+X</span>
            </button>
            {(textureIds.length > 0 || modelIds.length > 0) && <div className="project-panel__sep" />}
            {textureIds.length > 0 && (
              <button type="button" onClick={() => { setResizeTargets(textureIds); setMenu(null) }}>
                <Scaling size={12} />{t('project.resizeTextures')} ({textureIds.length})
              </button>
            )}
            {modelIds.length > 0 && (
              <button type="button" onClick={() => {
                void (async () => {
                  for (const id of modelIds) await reimportModel(id)
                })()
                setMenu(null)
              }}>
                <RefreshCw size={12} />{t('preview.reimport')} ({modelIds.length})
              </button>
            )}
            <div className="project-panel__sep" />
            <button type="button" onClick={() => {
              requestDeleteKeys(batchKeys)
              setMenu(null)
            }}>
              <Trash2 size={12} />{t('project.delete')} ({batchKeys.length})
            </button>
          </div>
        )
      })()}

      {resizeTargets !== null && (
        <TextureResizeDialog initialAssetIds={resizeTargets} onClose={() => setResizeTargets(null)} />
      )}

      {deletePlan && createPortal(
        <div className="project-confirm__backdrop" onMouseDown={() => setDeletePlan(null)}>
          <div className="project-confirm" role="dialog" aria-modal="true" onMouseDown={event => event.stopPropagation()}>
            <h2>{t('project.delete')}</h2>
            <p>{formatDeletePlanMessage(deletePlan, t)}</p>
            {deletePlan.referencedItems.length > 0 && (
              <ul className="project-confirm__refs">
                {deletePlan.referencedItems.slice(0, 8).map(item => (
                  <li key={item.key}>
                    <strong>{item.name}</strong> — 被 {item.users.slice(0, 3).join('、')}{item.users.length > 3 ? '…' : ''} 使用
                  </li>
                ))}
                {deletePlan.referencedItems.length > 8 && (
                  <li>…以及另外 {deletePlan.referencedItems.length - 8} 项被引用资源</li>
                )}
              </ul>
            )}
            <div className="project-confirm__actions">
              <button type="button" onClick={() => setDeletePlan(null)}>{t('project.cancel')}</button>
              {deletePlan.referencedItems.length === 0 ? (
                <button
                  type="button"
                  className="is-danger"
                  onClick={() => {
                    const plan = deletePlan
                    setDeletePlan(null)
                    void executeDeleteSelection(plan, 'safe-only')
                  }}
                >
                  {t('project.delete')}
                </button>
              ) : (
                <>
                  {(deletePlan.safeAssetIds.size + deletePlan.safeCodeIds.size > 0) && (
                    <button
                      type="button"
                      onClick={() => {
                        const plan = deletePlan
                        setDeletePlan(null)
                        void executeDeleteSelection(plan, 'safe-only')
                      }}
                    >
                      仅删除未引用的 {deletePlan.safeAssetIds.size + deletePlan.safeCodeIds.size} 项
                    </button>
                  )}
                  <button
                    type="button"
                    className="is-danger"
                    onClick={() => {
                      const plan = deletePlan
                      setDeletePlan(null)
                      void executeDeleteSelection(plan, 'force-all')
                    }}
                  >
                    强制全部删除
                  </button>
                </>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

function collectTextureIdsFromSelection(
  keys: readonly ProjectItemKey[],
  assets: Record<string, ProjectAsset>,
  assetDirs: Record<string, string>,
): string[] {
  const out = new Set<string>()
  const selectedDirs: string[] = []
  for (const key of keys) {
    const parsed = parseProjectItemKey(key)
    if (!parsed) continue
    if (parsed.type === 'dir') selectedDirs.push(parsed.path)
    else if (parsed.type === 'asset' && assets[parsed.id]?.kind === 'texture') out.add(parsed.id)
  }
  if (selectedDirs.length > 0) {
    for (const asset of Object.values(assets)) {
      if (asset.kind !== 'texture') continue
      const dir = assetDirectory(asset.id, assetDirs)
      if (selectedDirs.some(d => isWithin(dir, d))) out.add(asset.id)
    }
  }
  return [...out]
}

function collectModelIdsFromSelection(
  keys: readonly ProjectItemKey[],
  assets: Record<string, ProjectAsset>,
  assetDirs: Record<string, string>,
): string[] {
  const out = new Set<string>()
  const selectedDirs: string[] = []
  for (const key of keys) {
    const parsed = parseProjectItemKey(key)
    if (!parsed) continue
    if (parsed.type === 'dir') selectedDirs.push(parsed.path)
    else if (parsed.type === 'asset') {
      const k = assets[parsed.id]?.kind
      if (k === 'model' || k === 'animation') out.add(parsed.id)
    }
  }
  if (selectedDirs.length > 0) {
    for (const asset of Object.values(assets)) {
      if (asset.kind !== 'model' && asset.kind !== 'animation') continue
      const dir = assetDirectory(asset.id, assetDirs)
      if (selectedDirs.some(d => isWithin(dir, d))) out.add(asset.id)
    }
  }
  return [...out]
}

function collectPlaceableIdsFromSelection(
  keys: readonly ProjectItemKey[],
  assets: Record<string, ProjectAsset>,
): string[] {
  const out: string[] = []
  for (const key of keys) {
    const parsed = parseProjectItemKey(key)
    if (parsed?.type !== 'asset') continue
    const a = assets[parsed.id]
    if (a && (a.kind === 'model' || a.kind === 'prefab' || a.kind === 'effect')) out.push(a.id)
  }
  return out
}

function formatDeletePlanMessage(
  plan: DeleteSelectionPlan,
  t: (key: MessageKey, vars?: Record<string, string | number>) => string,
): string {
  if (plan.topKeys.length === 1 && plan.referencedItems.length === 0) {
    const single = parseProjectItemKey(plan.topKeys[0]!)
    if (single?.type === 'dir') {
      return t('project.deleteFolder', { name: dirName(single.path) })
    }
    if (single?.type === 'code') {
      const code = plan.codes[0]
      if (code) {
        const label = code.kind === 'shader' ? '着色器' : '脚本'
        return `确定删除${label}“${code.name}”吗？`
      }
    }
    if (single?.type === 'asset') {
      const asset = plan.assets[0]
      if (asset) {
        return asset.kind === 'scene'
          ? t('project.deleteScene', { name: asset.name })
          : t('project.deleteAsset', { name: asset.name })
      }
    }
  }

  const parts: string[] = []
  const topDirCount = plan.topKeys.filter(k => k.startsWith('dir:')).length
  if (topDirCount > 0) parts.push(`${topDirCount} 个目录`)
  if (plan.assets.length > 0) parts.push(`${plan.assets.length} 个资源`)
  if (plan.codes.length > 0) parts.push(`${plan.codes.length} 个代码资产`)
  const summary = parts.join('、') || `${plan.topKeys.length} 项`

  if (plan.referencedItems.length > 0) {
    return `拟删除 ${summary}，其中有 ${plan.referencedItems.length} 项正在被场景或其他资源引用。请选择跳过被引用项，或强制全部删除（自动断开引用）：`
  }
  return `确定删除选中的 ${summary} 吗？删除后无法撤销。`
}

function MoveToMenu({
  keys,
  dirs,
  onDone,
}: {
  keys: readonly ProjectItemKey[]
  dirs: readonly DirNode[]
  onDone: () => void
}) {
  const validTargets = useMemo(
    () => dirs.filter(d => canMoveProjectItems(keys, d.path)),
    [dirs, keys],
  )
  if (validTargets.length === 0) return null
  return (
    <div className="project-panel__submenu">
      <button type="button">
        <span><FolderInput size={12} />移动到文件夹…</span>
        <ChevronRight size={12} />
      </button>
      <div className="project-panel__submenu-pop project-panel__submenu-pop--scroll">
        {validTargets.map(dir => {
          const depth = dir.path === ASSETS_ROOT ? 0 : dir.path.split('/').length - 1
          return (
            <button
              key={dir.path}
              type="button"
              style={{ paddingLeft: 8 + depth * 10 }}
              title={dir.path}
              onClick={() => {
                moveProjectItems(keys, dir.path)
                onDone()
              }}
            >
              <Folder size={12} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {dir.path === ASSETS_ROOT ? 'Assets (根目录)' : dir.name}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function countCodeAssetReferences(
  item: import('../../core/codeAssets/workspace').CodeAssetRecord,
  assets: Record<string, ProjectAsset>,
  nodes: Record<string, import('../scene/types').SceneNode>,
  activeSceneId: string,
): number {
  let count = 0
  if (item.kind === 'shader') {
    const target = `custom:${item.id}`
    for (const node of Object.values(nodes)) {
      if (node.shader === target || node.slots?.some(slot => slot.shader === target)) count += 1
    }
    for (const asset of Object.values(assets)) {
      if (asset.kind === 'material' && asset.slot.shader === target) {
        count += 1
      } else if (asset.kind === 'scene' && asset.unloaded) {
        count += asset.summary?.shaders[target] ?? 0
      } else if ((asset.kind === 'scene' && asset.id !== activeSceneId) || asset.kind === 'prefab') {
        for (const node of Object.values(asset.nodes)) {
          if (node.shader === target || node.slots?.some(slot => slot.shader === target)) count += 1
        }
      }
    }
    return count
  }

  for (const node of Object.values(nodes)) {
    const projectScripts = node.gameplay?.packs?.__project__ as Record<string, unknown> | undefined
    if (projectScripts?.[item.id] !== undefined) count += 1
  }
  for (const asset of Object.values(assets)) {
    if (asset.kind === 'scene' && asset.unloaded) {
      count += asset.summary?.scripts[item.id] ?? 0
    } else if ((asset.kind === 'scene' && asset.id !== activeSceneId) || asset.kind === 'prefab') {
      for (const node of Object.values(asset.nodes)) {
        const projectScripts = node.gameplay?.packs?.__project__ as Record<string, unknown> | undefined
        if (projectScripts?.[item.id] !== undefined) count += 1
      }
    }
  }
  return count
}

function CreateMenu({ dir, onDone, onNewFolder }: { dir: string, onDone: () => void, onNewFolder: (path: string) => void }) {
  const { t } = useI18n()
  const hasSelection = useEditorStore(state => state.selection.length > 0)
  return (
    <div className="project-panel__submenu">
      <button type="button"><span><Plus size={12} />{t('project.create')}</span><ChevronRight size={12} /></button>
      <div className="project-panel__submenu-pop">
        <button type="button" onClick={() => { onNewFolder(useAssetStore.getState().createFolder(dir)); onDone() }}><FolderPlus size={12} />{t('project.newFolderMenu')}</button>
        <div className="project-panel__sep" />
        <button type="button" onClick={() => { useAssetStore.getState().setBrowseDir(dir); useEditorStore.getState().createScene(); onDone() }}><Globe size={12} />{t('project.createScene')}</button>
        <button type="button" onClick={() => { createDefaultMaterial(dir); onDone() }}><Palette size={12} />{t('project.createMaterial')}</button>
        <button type="button" onClick={() => { createDefaultUi(dir); onDone() }}><PanelsTopLeft size={12} />{t('project.createUi')}</button>
        <button type="button" onClick={() => { createDefaultCutscene(dir); onDone() }}><Film size={12} />{t('project.createCutscene')}</button>
        <button type="button" onClick={() => {
          void createDefaultDocument(dir, 'md').then(id => {
            const created = id ? useAssetStore.getState().assets[id] : null
            if (created) openAssetPreview('document', created.id, created.name)
          })
          onDone()
        }}><FileText size={12} />Markdown 文档</button>
        <button type="button" onClick={() => {
          void createDefaultDocument(dir, 'txt').then(id => {
            const created = id ? useAssetStore.getState().assets[id] : null
            if (created) openAssetPreview('document', created.id, created.name)
          })
          onDone()
        }}><FileText size={12} />文本文档</button>
        <button type="button" disabled={!hasSelection} onClick={() => { useAssetStore.getState().setBrowseDir(dir); savePrefabFromSelection(); onDone() }}><Component size={12} />{t('project.createPrefab')}</button>
        <div className="project-panel__sep" />
        <button
          type="button"
          onClick={() => {
            const count = Object.values(useCodeAssetStore.getState().assets).filter(a => a.kind === 'script').length + 1
            const id = normalizeCodeAssetId('script', `behavior_${count}`)
            void saveAndCompileCodeAsset('script', id, defaultTemplateFor('script', id), dir).then(() => {
              openCodeAssetModal('script', id)
            })
            onDone()
          }}
        >
          <FileCode2 size={12} />脚本
        </button>
        <button
          type="button"
          onClick={() => {
            const count = Object.values(useCodeAssetStore.getState().assets).filter(a => a.kind === 'shader').length + 1
            const id = normalizeCodeAssetId('shader', `surface_${count}`)
            void saveAndCompileCodeAsset('shader', id, defaultTemplateFor('shader', id), dir).then(() => {
              openCodeAssetModal('shader', id)
            })
            onDone()
          }}
        >
          <Wand2 size={12} />Shader
        </button>
      </div>
    </div>
  )
}

function revealOnDisk(target: string | null, folder = false) {
  const desktop = electronBridge()
  if (!desktop?.shell || !target) {
    useEditorStore.getState().log('warn', translate('project.revealMissing'))
    return
  }
  const opened = folder ? desktop.shell.openPath(target) : desktop.shell.showItemInFolder(target)
  void opened.catch(error => {
    const message = error instanceof Error ? error.message : String(error)
    useEditorStore.getState().log('error', translate('project.revealFailed', { message }))
  })
}

function clipEntries(asset: ProjectAsset) {
  if ('clipCatalog' in asset && asset.clipCatalog?.length) return asset.clipCatalog
  if (asset.kind !== 'model' && asset.kind !== 'animation') return []
  return clipNamesFor(asset.id).map(name => ({ name, duration: clipDuration(asset.id, name) }))
}

function AssetRow({
  itemKey,
  asset,
  view,
  picked,
  cut,
  pinged,
  used,
  renaming,
  onRenameDone,
  onClick,
  onDragStart,
  onDoubleClick,
  onMenu,
  onDelete,
  clipsOpen,
  onToggleClips,
}: {
  itemKey: ProjectItemKey
  asset: ProjectAsset
  view: BrowseView
  picked: boolean
  cut: boolean
  pinged: boolean
  used: boolean
  renaming: boolean
  onRenameDone: (name: string) => void
  onClick: (event: MouseEvent) => void
  onDragStart: (event: ReactDragEvent) => void
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
        className={`project-asset ${view === 'grid' ? 'project-asset--grid' : ''} ${view === 'details' ? 'project-asset--details' : ''} ${picked ? 'project-asset--picked' : ''} ${cut ? 'project-asset--cut' : ''} ${pinged ? 'project-asset--ping' : ''}`}
        data-project-key={itemKey}
        data-asset-id={asset.id}
        draggable={!renaming}
        title={assetTitle(asset)}
        onDragStart={onDragStart}
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
          title={`${clip.name}  ${clip.duration.toFixed(2)}s`}
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
  if (asset.kind === 'scene') return translate('project.objects', { count: sceneNodeCount(asset) })
  if (asset.kind === 'prefab') return translate('project.objects', { count: Object.keys(readPrefab(asset).nodes).length })
  if (asset.kind === 'material') return asset.slot.color
  if ('fileName' in asset) return asset.fileName.split('.').pop()?.toUpperCase() ?? ''
  return used ? translate('project.inUse') : ''
}

function previewKind(kind: string): PreviewKind | null {
  if (kind === 'model' || kind === 'texture' || kind === 'material' || kind === 'environment' || kind === 'animation' || kind === 'audio' || kind === 'document') return kind
  return null
}

function assetKind(id: string) {
  return useAssetStore.getState().assets[id]?.kind
}

function Thumb({ asset, icon: Icon, color, large = false }: { asset: ProjectAsset, icon: typeof Folder, color?: string, large?: boolean }) {
  const className = large ? 'project-asset__thumb project-asset__thumb--large' : 'project-asset__thumb'
  if ((asset.kind === 'model' || asset.kind === 'texture') && 'thumb' in asset && asset.thumb) return <img className={className} src={asset.thumb} alt="" />
  if (asset.kind === 'texture' && asset.url && !asset.fileName.toLowerCase().endsWith('.ktx2')) return <img className={className} src={asset.url} alt="" />
  if (asset.kind === 'material') return <MaterialBall slot={asset.slot} size={large ? 'md' : 'sm'} />
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
  if (asset.kind === 'document') return translate('project.docHint')
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
      if (asset.unloaded) for (const id of asset.summary?.assets ?? []) ids.add(id)
      for (const node of Object.values(asset.nodes)) collect(node, ids)
    }
    if (asset.kind === 'prefab') for (const node of Object.values(readPrefab(asset).nodes)) collect(node, ids)
  }
  return ids
}

function collect(node: { assetId?: string | null, clipAssetId?: string | null, overlayAssetId?: string | null, animator?: { states: Array<{ clipAssetId?: string | null }> } | null, materialAssetId?: string | null, mapAssetId?: string | null, normalAssetId?: string | null, metallicRoughnessAssetId?: string | null, roughnessAssetId?: string | null, metalnessAssetId?: string | null, emissiveAssetId?: string | null, aoAssetId?: string | null, prefabAssetId?: string | null, nestedPrefabId?: string | null, slots?: Array<{ materialAssetId?: string | null, mapAssetId: string | null, normalAssetId?: string | null, metallicRoughnessAssetId?: string | null, roughnessAssetId?: string | null, metalnessAssetId?: string | null, emissiveAssetId?: string | null, aoAssetId?: string | null }> }, ids: Set<string>) {
  if (node.assetId) ids.add(node.assetId)
  if (node.prefabAssetId) ids.add(node.prefabAssetId)
  if (node.nestedPrefabId) ids.add(node.nestedPrefabId)
  if (node.clipAssetId) ids.add(node.clipAssetId)
  if (node.overlayAssetId) ids.add(node.overlayAssetId)
  for (const state of node.animator?.states ?? []) {
    if (state.clipAssetId) ids.add(state.clipAssetId)
  }
  if (node.materialAssetId) ids.add(node.materialAssetId)
  for (const id of [node.mapAssetId, node.normalAssetId, node.metallicRoughnessAssetId, node.roughnessAssetId, node.metalnessAssetId, node.emissiveAssetId, node.aoAssetId]) {
    if (id) ids.add(id)
  }
  for (const slot of node.slots ?? []) {
    if (slot.materialAssetId) ids.add(slot.materialAssetId)
    for (const id of [slot.mapAssetId, slot.normalAssetId, slot.metallicRoughnessAssetId, slot.roughnessAssetId, slot.metalnessAssetId, slot.emissiveAssetId, slot.aoAssetId]) {
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
  const isRoot = node.path === ASSETS_ROOT
  return (
    <>
      <div
        className={`project-browse__tree-item ${active ? 'is-active' : ''} ${dropPath === node.path ? 'is-drop' : ''}`}
        data-asset-dir={node.path}
        style={{ paddingLeft: 6 + depth * 12 }}
        role="button"
        tabIndex={0}
        draggable={!isRoot && renamePath !== node.path}
        onDragStart={event => {
          if (isRoot) return
          event.stopPropagation()
          const key = dirItemKey(node.path)
          const sel = useProjectSelectionStore.getState().selectedKeys
          const keys = sel.includes(key) ? sel : [key]
          beginProjectDrag(keys, event)
          event.dataTransfer.setData(FOLDER_MIME, node.path)
          event.dataTransfer.effectAllowed = 'copyMove'
        }}
        onClick={() => onOpen(node.path)}
        onContextMenu={event => onMenu(event, node.path)}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') onOpen(node.path)
        }}
        onDragOver={event => {
          if (!canAcceptProjectDrop(event.dataTransfer, node.path)) return
          event.preventDefault()
          event.stopPropagation()
          onDropPath(node.path)
        }}
        onDragLeave={() => onDropPath(null)}
        onDrop={event => {
          if (!canAcceptProjectDrop(event.dataTransfer, node.path)) return
          event.preventDefault()
          event.stopPropagation()
          onDropPath(null)
          handleProjectDrop(event.dataTransfer, node.path)
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
          {node.children.length > 0 && (open ? <Minus size={11} strokeWidth={2.75} /> : <Plus size={11} strokeWidth={2.75} />)}
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
  itemKey,
  path,
  name,
  view,
  picked,
  cut,
  renaming,
  dropping,
  onClick,
  onOpen,
  onDragStart,
  onRenameDone,
  onMenu,
  onDelete,
  onDropPath,
}: {
  itemKey: ProjectItemKey
  path: string
  name: string
  view: BrowseView
  picked: boolean
  cut: boolean
  renaming: boolean
  dropping: boolean
  onClick: (event: MouseEvent) => void
  onOpen: () => void
  onDragStart: (event: ReactDragEvent) => void
  onRenameDone: (name: string) => void
  onMenu: (event: MouseEvent) => void
  onDelete: (event: MouseEvent) => void
  onDropPath: (path: string | null) => void
}) {
  return (
    <div
      className={`project-asset ${view === 'grid' ? 'project-asset--grid' : ''} ${view === 'details' ? 'project-asset--details' : ''} ${picked ? 'project-asset--picked' : ''} ${cut ? 'project-asset--cut' : ''} ${dropping ? 'is-drop' : ''}`}
      data-project-key={itemKey}
      data-asset-dir={path}
      draggable={!renaming}
      onDragStart={onDragStart}
      title={translate('project.openFolder')}
      onClick={onClick}
      onDoubleClick={onOpen}
      onContextMenu={onMenu}
      onDragOver={event => {
        if (!canAcceptProjectDrop(event.dataTransfer, path)) return
        event.preventDefault()
        event.stopPropagation()
        onDropPath(path)
      }}
      onDragLeave={() => onDropPath(null)}
      onDrop={event => {
        if (!canAcceptProjectDrop(event.dataTransfer, path)) return
        event.preventDefault()
        event.stopPropagation()
        onDropPath(null)
        handleProjectDrop(event.dataTransfer, path)
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
      {view !== 'grid' && (
        <button type="button" title={translate('project.delete')} onClick={onDelete}><Trash2 size={12} /></button>
      )}
    </div>
  )
}
