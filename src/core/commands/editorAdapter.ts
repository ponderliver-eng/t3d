import { useEditorStore } from '../../editor/scene/store'
import type { SceneNode, ScenePicture } from '../../editor/scene/types'
import type { GameDatabase } from '../../gameplay/types'
import { commandBus } from './bus'
import type { TransactionAdapter } from './types'

export interface EditorStoreSnapshot {
  nodes: Record<string, SceneNode>
  selection: string[]
  picture: ScenePicture
  gameDatabase: GameDatabase
}

export function createEditorTransactionAdapter(): TransactionAdapter {
  return {
    isPlaying: () => useEditorStore.getState().playState !== 'stopped',
    captureSnapshot: (): EditorStoreSnapshot => {
      const s = useEditorStore.getState()
      return {
        nodes: structuredClone(s.nodes),
        selection: [...s.selection],
        picture: structuredClone(s.picture),
        gameDatabase: structuredClone(s.gameDatabase),
      }
    },
    restoreSnapshot: (raw) => {
      const snap = raw as EditorStoreSnapshot | null
      if (!snap) return
      useEditorStore.setState({
        nodes: structuredClone(snap.nodes),
        selection: [...snap.selection],
        picture: structuredClone(snap.picture),
        gameDatabase: structuredClone(snap.gameDatabase),
      })
    },
    commitUndoStep: (label, rawBefore) => {
      const before = rawBefore as EditorStoreSnapshot | null
      if (!before) return
      const current = useEditorStore.getState()
      useEditorStore.setState((state) => ({
        past: [
          ...state.past,
          {
            label,
            before: before.nodes,
            after: structuredClone(current.nodes),
            beforeSelection: before.selection,
            afterSelection: [...current.selection],
            beforePicture: before.picture,
            afterPicture: structuredClone(current.picture),
            beforeDatabase: before.gameDatabase,
            afterDatabase: structuredClone(current.gameDatabase),
          },
        ].slice(-80),
        future: [],
      }))
    },
  }
}

export function bindCommandBusToEditor(): void {
  commandBus.setAdapter(createEditorTransactionAdapter())
}
