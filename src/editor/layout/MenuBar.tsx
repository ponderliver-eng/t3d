import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronRight, Clock } from 'lucide-react'
import { askNewScene, useEditorStore } from '../scene/store'
import { redoActive, undoActive, useUiEditor } from '../ui/session'
import { LIGHT_KINDS, MESH_KINDS } from '../scene/kinds'
import { useI18n, translate, type MessageKey } from '../i18n'
import { usePrefsStore } from '../prefs/store'
import { openImport } from '../assets/import'
import { createDirectoryProject, notifyProjectSaved, openDirectoryProject, openRecentProject, saveProjectNow } from '../assets/project'
import { RecentProjectService, type RecentProject } from '../project/recents'
import { bindPackagePicker, openPackagePicker, usePackageImportStore } from '../assets/packageImportStore'
import { PackageExtractDialog } from '../panels/PackageExtractDialog'
import { openProjectSettings } from '../project/ProjectSettingsDialog'
import { useTaxonomyUi } from '../project/taxonomyUi'
import { resetLayout } from './events'
import type { CameraView, NodeKind } from '../scene/types'
import './MenuBar.css'

export default function MenuBar() {
  const playing = useEditorStore(state => state.playState !== 'stopped')
  const grid = useEditorStore(state => state.gridVisible)
  const snap = useEditorStore(state => state.snap)
  const sceneUndo = useEditorStore(state => state.past.length > 0 || state.gesture !== null)
  const sceneRedo = useEditorStore(state => state.future.length > 0 && state.gesture === null)
  const uiOpen = useUiEditor(state => state.assetId !== null)
  const uiUndo = useUiEditor(state => state.past.length > 0)
  const uiRedo = useUiEditor(state => state.future.length > 0)
  const canUndo = uiOpen ? uiUndo : sceneUndo
  const canRedo = uiOpen ? uiRedo : sceneRedo
  const hasSelection = useEditorStore(state => state.selection.length > 0)
  const selectedCamera = useEditorStore(state => {
    const id = state.selection[state.selection.length - 1]
    const node = id ? state.nodes[id] : undefined
    return node?.kind === 'camera' ? node : null
  })
  const canPaste = useEditorStore(state => state.canPaste)

  const { t } = useI18n()
  const packageFile = usePackageImportStore(state => state.file)
  const packageInputRef = useRef<HTMLInputElement>(null)
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>(() => RecentProjectService.getAll())
  const [recentOpen, setRecentOpen] = useState(false)
  useEffect(() => {
    bindPackagePicker(() => packageInputRef.current?.click())
    return () => bindPackagePicker(null)
  }, [])
  const create = (kind: NodeKind) => useEditorStore.getState().createNode(kind)
  const view = (next: CameraView) => useEditorStore.getState().requestView(next)
  const kindName = (kind: NodeKind) => t(`kind.${kind}` as MessageKey)

  return (
    <div className="menubar">
      <div className="menubar__logo">T3D</div>
      <div className="menubar__items">
        <Dropdown
          label={t('menu.file')}
          onOpen={() => {
            setRecentProjects(RecentProjectService.getAll())
            setRecentOpen(false)
          }}
        >
          <Item disabled={playing} onClick={() => { void createDirectoryProject() }}>{t('menu.newProject')}</Item>
          <Item disabled={playing} onClick={() => { void openDirectoryProject() }}>{t('menu.openProject')}<span className="menubar__hint">Ctrl+O</span></Item>
          {recentProjects.length > 0 && (
            <div
              className={`menubar__menu-item menubar__menu-item--submenu ${recentOpen ? 'menubar__menu-item--active' : ''}`}
              onMouseEnter={() => setRecentOpen(true)}
              onMouseLeave={() => setRecentOpen(false)}
              onClick={event => event.stopPropagation()}
            >
              <Clock size={12} />
              {t('menu.recentProjects')}
              <ChevronRight size={12} className="menubar__submenu-arrow" />
              {recentOpen && (
                <div className="menubar__submenu">
                  {recentProjects.map(item => (
                    <button
                      key={item.id}
                      type="button"
                      className="menubar__menu-item"
                      disabled={playing}
                      title={item.path ?? item.name}
                      onClick={event => {
                        event.stopPropagation()
                        void openRecentProject(item.id).finally(() => setRecentProjects(RecentProjectService.getAll()))
                        event.currentTarget.closest('.menubar__menu')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
                      }}
                    >
                      {item.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <Sep />
          <Item onClick={openProjectSettings}>{t('menu.projectSettings')}</Item>
          <Item onClick={() => useTaxonomyUi.getState().openTags()}>{t('menu.tags')}</Item>
          <Item onClick={() => useTaxonomyUi.getState().openLayers()}>{t('menu.layers')}</Item>
          <Sep />
          <Item onClick={askNewScene}>{t('menu.newScene')}<span className="menubar__hint">Ctrl+N</span></Item>
          <Item onClick={() => { void saveProjectNow().then(() => notifyProjectSaved()).catch(error => useEditorStore.getState().log('error', translate('log.projectFailed', { message: error instanceof Error ? error.message : String(error) }))) }}>{t('menu.save')}<span className="menubar__hint">Ctrl+S</span></Item>
          <Item onClick={openImport}>{t('menu.import')}</Item>
          <Item onClick={openPackagePicker}>{t('menu.extractPackage')}</Item>
        </Dropdown>
        <Dropdown label={t('menu.edit')}>
          <Item disabled={(playing && !uiOpen) || !canUndo} onClick={undoActive}>{t('menu.undo')}<span className="menubar__hint">Ctrl+Z</span></Item>
          <Item disabled={(playing && !uiOpen) || !canRedo} onClick={redoActive}>{t('menu.redo')}<span className="menubar__hint">Ctrl+Y</span></Item>
          <Sep />
          <Item disabled={playing || !hasSelection} onClick={() => useEditorStore.getState().duplicateSelection()}>{t('menu.duplicate')}<span className="menubar__hint">Ctrl+D</span></Item>
          <Item disabled={playing || !hasSelection} onClick={() => useEditorStore.getState().copySelection()}>{t('menu.copy')}<span className="menubar__hint">Ctrl+C</span></Item>
          <Item disabled={playing || !canPaste} onClick={() => useEditorStore.getState().pasteClipboard(null)}>{t('menu.paste')}<span className="menubar__hint">Ctrl+V</span></Item>
          <Item disabled={playing || !hasSelection} onClick={() => useEditorStore.getState().groupSelection()}>{t('menu.group')}<span className="menubar__hint">Ctrl+G</span></Item>
          <Item disabled={playing || !hasSelection} onClick={() => useEditorStore.getState().snapSelectionToGround()}>{t('menu.ground')}</Item>
          <Item disabled={playing || !hasSelection} onClick={() => useEditorStore.getState().deleteSelection()}>{t('menu.delete')}<span className="menubar__hint">Del</span></Item>
          <Item onClick={() => useEditorStore.getState().selectAll()}>{t('menu.selectAll')}<span className="menubar__hint">Ctrl+A</span></Item>
          <Sep />
          <Item onClick={() => usePrefsStore.getState().openSettings()}>{t('menu.settings')}<span className="menubar__hint">Ctrl+,</span></Item>
        </Dropdown>
        <Dropdown label={t('menu.create')}>
          <Item disabled={playing} onClick={() => create('empty')}>{t('menu.empty')}</Item>
          <Section label={t('menu.meshes')} />
          {MESH_KINDS.map(kind => (
            <Item key={kind} disabled={playing} onClick={() => create(kind)}>{kindName(kind)}</Item>
          ))}
          <Submenu label={t('menu.lights')}>
            {LIGHT_KINDS.map(kind => (
              <Item key={kind} disabled={playing} onClick={() => create(kind)}>{kindName(kind)}</Item>
            ))}
          </Submenu>
          <Item disabled={playing} onClick={() => create('camera')}>{t('menu.camera')}</Item>
          <Item disabled={playing} onClick={() => create('effect')}>{t('menu.effect')}</Item>
          <Item disabled={playing} onClick={() => create('screen')}>{t('menu.screen')}</Item>
        </Dropdown>
        <Dropdown label={t('menu.view')}>
          <Item disabled={!hasSelection} onClick={() => useEditorStore.getState().requestFocus()}>{t('menu.focus')}<span className="menubar__hint">F</span></Item>
          <Item disabled={playing || !selectedCamera || selectedCamera.locked} onClick={() => useEditorStore.getState().alignCameraToView()}>{t('menu.alignCamera')}<span className="menubar__hint">Ctrl+Shift+F</span></Item>
          <Item disabled={playing || !selectedCamera} onClick={() => useEditorStore.getState().alignViewToCamera()}>{t('menu.alignView')}<span className="menubar__hint">Shift+F</span></Item>
          <Sep />
          <Item onClick={() => view('top')}>{t('menu.viewTop')}</Item>
          <Item onClick={() => view('front')}>{t('menu.viewFront')}</Item>
          <Item onClick={() => view('right')}>{t('menu.viewRight')}</Item>
          <Item onClick={() => view('persp')}>{t('menu.viewPersp')}</Item>
          <Item onClick={() => view('bottom')}>{t('menu.viewBottom')}</Item>
          <Item onClick={() => view('back')}>{t('menu.viewBack')}</Item>
          <Item onClick={() => view('left')}>{t('menu.viewLeft')}</Item>
          <Item onClick={() => useEditorStore.getState().requestFocusAll()}>{t('menu.focusAll')}</Item>
          <Sep />
          <Item onClick={() => useEditorStore.getState().toggleGrid()}>{grid ? '✓ ' : ''}{t('menu.grid')}</Item>
          <Item onClick={() => useEditorStore.getState().toggleSnap()}>{snap ? '✓ ' : ''}{t('menu.snap')}</Item>
          <Sep />
          <Item onClick={resetLayout}>{t('menu.resetLayout')}</Item>
        </Dropdown>
      </div>
      <input
        ref={packageInputRef}
        type="file"
        hidden
        accept=".unitypackage"
        onChange={event => {
          const file = event.target.files?.[0] ?? null
          event.target.value = ''
          if (file) usePackageImportStore.getState().open(file)
        }}
      />
      <PackageExtractDialog file={packageFile} open={packageFile !== null} onClose={() => usePackageImportStore.getState().close()} />
    </div>
  )
}

function Dropdown({ label, children, onOpen }: { label: string; children: ReactNode; onOpen?: () => void }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="menubar__dropdown" ref={rootRef}>
      <button
        type="button"
        className={`menubar__item ${open ? 'menubar__item--open' : ''}`}
        onClick={() => setOpen(value => {
          const next = !value
          if (next) onOpen?.()
          return next
        })}
      >
        {label}
      </button>
      {open && (
        <div className="menubar__menu" onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  )
}

function Item({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      className="menubar__menu-item"
      disabled={disabled}
      onClick={event => {
        event.stopPropagation()
        if (disabled) return
        onClick?.()
        event.currentTarget.closest('.menubar__menu')?.dispatchEvent(new Event('click', { bubbles: true }))
      }}
    >
      {children}
    </button>
  )
}

function Submenu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="menubar__menu-item menubar__menu-item--sub" onClick={event => event.stopPropagation()}>
      {label}
      <ChevronRight size={12} className="menubar__arrow" />
      <div className="menubar__submenu">{children}</div>
    </div>
  )
}

function Section({ label }: { label: string }) {
  return <div className="menubar__section">{label}</div>
}

function Sep() {
  return <div className="menubar__sep" />
}
