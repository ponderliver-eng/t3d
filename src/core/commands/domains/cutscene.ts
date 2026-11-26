import {
  CUTSCENE_CAPABILITY_ID,
  createEmptySequence,
  normalizeCutsceneDocument,
  normalizeCutsceneSequence,
  type CutsceneDocument,
  type CutsceneSequence,
} from '../../../capabilities/cutscene/schema'
import { useAssetStore, type CutsceneAsset } from '../../../editor/assets/library'
import { useEditorStore } from '../../../editor/scene/store'
import { commandBus } from '../bus'
import type { CommandDef } from '../types'

function readCutsceneDoc(): CutsceneDocument {
  const picture = useEditorStore.getState().picture
  return normalizeCutsceneDocument(picture.capabilities?.[CUTSCENE_CAPABILITY_ID])
}

function writeCutsceneDoc(doc: CutsceneDocument) {
  const state = useEditorStore.getState()
  state.setPicture({
    capabilities: {
      ...(state.picture.capabilities ?? {}),
      [CUTSCENE_CAPABILITY_ID]: doc,
    },
  })
}

const listCutscenesCmd: CommandDef<Record<string, never>, { sequences: CutsceneSequence[]; activeAssetId: string }> = {
  id: 'cutscene.list',
  title: '列出过场动画序列',
  description: '获取工程中的独立 Cutscene 资产与当前场景挂载的过场序列',
  risk: 'safe',
  params: { type: 'object', fields: {} },
  run() {
    const doc = readCutsceneDoc()
    const assets = Object.values(useAssetStore.getState().assets).filter((a): a is CutsceneAsset => a.kind === 'cutscene')
    const list: CutsceneSequence[] = assets.map(a => ({ ...a.sequence, id: a.id, name: a.name }))
    for (const s of doc.sequences) {
      if (!list.some(item => item.id === s.id)) list.push(s)
    }
    return {
      ok: true,
      value: {
        sequences: list,
        activeAssetId: doc.activeAssetId ?? '',
      },
      changed: { summary: `共 ${list.length} 个过场序列` },
    }
  },
}

interface UpsertSequenceParams {
  sequence: Record<string, unknown>
}

const upsertSequenceCmd: CommandDef<UpsertSequenceParams, { assetId: string; sequence: CutsceneSequence }> = {
  id: 'cutscene.upsertSequence',
  title: '新建或更新过场动画序列资产',
  description: '创建或覆盖一条独立 Cutscene 资产（包含 cameraTrack、eventTrack 与节点 tracks）并挂载到当前场景',
  risk: 'safe',
  params: {
    type: 'object',
    fields: {
      sequence: { type: 'object', fields: {}, label: '序列定义对象 (CutsceneSequence)' },
    },
  },
  run(_ctx, p) {
    const base = createEmptySequence()
    const merged = normalizeCutsceneSequence({ ...base, ...p.sequence })
    if (!merged) {
      return {
        ok: false,
        code: 'cutscene.invalid',
        message: '过场序列格式无效',
      }
    }
    const assetStore = useAssetStore.getState()
    const existing = Object.values(assetStore.assets).find(
      (a): a is CutsceneAsset => a.kind === 'cutscene' && (a.id === merged.id || a.name === merged.name),
    )
    const assetId = existing?.id ?? merged.id
    const finalSeq: CutsceneSequence = { ...merged, id: assetId }
    if (existing) {
      useAssetStore.setState(state => ({
        assets: { ...state.assets, [assetId]: { ...existing, name: finalSeq.name, sequence: finalSeq } },
        revision: state.revision + 1,
      }))
    } else {
      assetStore.add({ id: assetId, name: finalSeq.name, kind: 'cutscene', sequence: finalSeq })
      assetStore.place(assetId)
    }

    const doc = readCutsceneDoc()
    const hasDir = doc.directors.some(d => d.assetId === assetId)
    const directors = hasDir
      ? doc.directors.map(d => (d.assetId === assetId ? { ...d, autoPlay: finalSeq.autoPlay, loop: finalSeq.loop, lockPlayerInput: finalSeq.lockPlayerInput } : d))
      : [...doc.directors, { id: crypto.randomUUID(), assetId, autoPlay: finalSeq.autoPlay, loop: finalSeq.loop, lockPlayerInput: finalSeq.lockPlayerInput }]
    writeCutsceneDoc({ ...doc, directors, activeAssetId: assetId })

    return {
      ok: true,
      value: { assetId, sequence: finalSeq },
      changed: { projectChanged: true, summary: `${existing ? '更新' : '新建'}过场资产 ${finalSeq.name}` },
    }
  },
}

interface RemoveSequenceParams {
  sequenceId: string
}

const removeSequenceCmd: CommandDef<RemoveSequenceParams, { sequenceId: string }> = {
  id: 'cutscene.removeSequence',
  title: '删除过场动画序列',
  description: '按 ID 删除指定过场资产或场景内嵌序列',
  risk: 'confirm',
  params: {
    type: 'object',
    fields: {
      sequenceId: { type: 'string', minLength: 1, default: '', label: '序列/资产 ID' },
    },
  },
  run(_ctx, p) {
    const doc = readCutsceneDoc()
    const asset = useAssetStore.getState().assets[p.sequenceId]
    if (asset && asset.kind === 'cutscene') {
      useAssetStore.getState().remove(p.sequenceId)
      const directors = doc.directors.filter(d => d.assetId !== p.sequenceId)
      writeCutsceneDoc({ ...doc, directors, activeAssetId: doc.activeAssetId === p.sequenceId ? (directors[0]?.assetId ?? '') : doc.activeAssetId })
      return {
        ok: true,
        value: { sequenceId: p.sequenceId },
        changed: { projectChanged: true, summary: `删除过场资产 ${asset.name}` },
      }
    }
    const next = doc.sequences.filter(s => s.id !== p.sequenceId)
    if (next.length === doc.sequences.length) {
      return {
        ok: false,
        code: 'cutscene.notFound',
        message: `过场序列 "${p.sequenceId}" 不存在`,
      }
    }
    const activeSequenceId = doc.activeSequenceId === p.sequenceId ? (next[0]?.id ?? '') : doc.activeSequenceId
    writeCutsceneDoc({ ...doc, sequences: next, activeSequenceId })
    return {
      ok: true,
      value: { sequenceId: p.sequenceId },
      changed: { projectChanged: true, summary: `删除过场序列 ${p.sequenceId}` },
    }
  },
}

export function registerCutsceneCommands(): () => void {
  const unsubs = [
    commandBus.register(listCutscenesCmd),
    commandBus.register(upsertSequenceCmd),
    commandBus.register(removeSequenceCmd),
  ]
  return () => unsubs.forEach(fn => fn())
}
