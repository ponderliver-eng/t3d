import { Euler, Quaternion } from 'three'
import type { ModelTreeNode } from '../models'
import { makeNode } from '../../scene/kinds'
import type { ModelPartOverride, PbrSlot, SceneNode, ScenePicture, Vec3 } from '../../scene/types'
import { DEFAULT_PICTURE } from '../../scene/types'

const UNITY_BUILTIN_RESOURCES_GUID = '0000000000000000e000000000000000'
const MAX_PREFAB_DEPTH = 10
const INT63_MASK = BigInt('0x7fffffffffffffff')

/** 已导入模型的结构信息：用来把 Unity 的 Renderer 对应到模型里的部位。 */
export interface UnityModelInfo {
  name: string
  tree: ModelTreeNode[]
  slots: PbrSlot[]
}

export interface UnitySceneParseContext {
  /** 已导入的模型资产映射：Unity GUID -> T3D ModelAsset.id */
  guidToModel: Map<string, string>
  /** 已导入的材质资产映射：Unity GUID -> T3D MaterialAsset.id */
  guidToMaterial: Map<string, string>
  /** 模型 meta 映射：Unity GUID -> (fileID -> 名称) */
  modelMeshNamesByGuid: Map<string, Map<string, string>>
  /** 已导入模型的部位树与默认材质槽：T3D ModelAsset.id -> 信息。缺失时整模型显示，不做部位隐藏。 */
  modelInfoByAssetId?: Map<string, UnityModelInfo>
  /** 包内所有 .prefab 文本源码：Unity GUID -> YAML text */
  prefabTextsByGuid: Map<string, string>
}

export interface UnitySceneParseResult {
  ok: true
  nodes: Record<string, SceneNode>
  picture: ScenePicture
  stats: {
    totalNodes: number
    models: number
    primitives: number
    lights: number
    groups: number
    missingAssets: number
    inactiveNodes: number
    /** 并进同一个模型节点的 Renderer 数（不再各自生成一份整模型）。 */
    mergedRenderers: number
    /** 没有生成节点的骨骼与模型内部节点数。 */
    skippedModelTransforms: number
  }
  warnings: string[]
}

export interface UnitySceneParseFailure {
  ok: false
  reason: 'binary-scene' | 'empty-scene'
  warning: string
}

interface RawGameObject {
  fileId: string
  name: string
  isActive: boolean
}

interface RawTransform {
  fileId: string
  gameObjectId: string
  position: [number, number, number]
  rotation: [number, number, number, number]
  scale: [number, number, number]
  fatherId: string
  childrenIds: string[]
}

interface RawMeshRef {
  fileId: string
  guid: string
}

interface RawMeshFilter {
  gameObjectId: string
  mesh: RawMeshRef | null
}

interface RawRenderer {
  fileId: string
  gameObjectId: string
  materials: RawMeshRef[]
  mesh: RawMeshRef | null
  castShadows: boolean
  enabled: boolean
  skinned: boolean
  rootBoneId?: string
}

interface RawLight {
  gameObjectId: string
  lightType: number // 0=Spot, 1=Directional, 2=Point
  color: [number, number, number]
  intensity: number
  range: number
  spotAngle: number
  shadows: boolean
}

interface RawPrefabModification {
  targetFileId: string
  targetGuid: string
  propertyPath: string
  value: string
  objectReference: RawMeshRef | null
}

interface RawPrefabInstance {
  fileId: string
  transformParentId: string
  sourcePrefabGuid: string
  modifications: RawPrefabModification[]
}

interface RawStrippedTransform {
  fileId: string
  prefabInstanceId: string
  sourceId: string
}

interface ParsedUnityYaml {
  gameObjects: Map<string, RawGameObject>
  transforms: Map<string, RawTransform>
  meshFilters: Map<string, RawMeshFilter>
  renderers: Map<string, RawRenderer>
  lights: Map<string, RawLight>
  terrains: Set<string> // gameObjectIds
  /** gameObjectId -> Avatar 所在模型的 GUID（没有 Avatar 时为空串） */
  animators: Map<string, string>
  /** 被 SkinnedMeshRenderer 当作骨骼引用的 Transform */
  boneIds: Set<string>
  /** 挂了 LODGroup 组件的 GameObject */
  lodGroups: Set<string>
  /** LODGroup 中属于 LOD1+ 的 Renderer fileID（只保留 LOD0） */
  lodCulledRenderers: Set<string>
  /** 挂了 Unity Collider 组件的 GameObject */
  colliders: Set<string>
  prefabInstances: Map<string, RawPrefabInstance>
  /** 挂在 Prefab 实例内部节点下时，场景里留下的占位 Transform */
  strippedTransforms: Map<string, RawStrippedTransform>
  strippedByInstance: Map<string, RawStrippedTransform[]>
  transformByGameObject: Map<string, RawTransform>
  childrenOf: Map<string, RawTransform[]>
}

type ModsByTarget = Map<string, RawPrefabModification[]>

interface MeshPart {
  path: string
  slotIndices: number[]
  /** 归一化后的匹配名：自身名，以及上一级普通节点名（多材质网格会被拆成同一节点下的多个子网格）。 */
  keys: string[]
}

interface ClusterMember {
  go: RawGameObject
  renderer: RawRenderer
  meshRef: RawMeshRef
  materials: RawMeshRef[]
  active: boolean
}

/** 同一个模型根下、来自同一个模型文件的所有 Renderer，合成一个模型节点。 */
interface ModelCluster {
  rootId: string
  guid: string
  assetId: string
  members: ClusterMember[]
}

interface ClusterPlan {
  byRoot: Map<string, ModelCluster[]>
  /** 已并进别的模型节点、自己不再生成模型的 Transform */
  absorbed: Set<string>
  /** 不生成节点的 Transform（骨骼、已被合并且没有其他内容的子树） */
  pruned: Set<string>
}

interface BuildResult {
  rootId: string | null
  map: Map<string, string> | null
}

const parsedPrefabCache = new WeakMap<Map<string, string>, Map<string, ParsedUnityYaml>>()

/**
 * 解析 Unity YAML（.unity 或 .prefab）为 T3D `SceneNode` 字典。
 */
export function parseUnitySceneText(
  text: string,
  sceneName: string,
  ctx: UnitySceneParseContext,
): UnitySceneParseResult | UnitySceneParseFailure {
  const trimmed = text.trimStart()
  if (!trimmed.startsWith('%YAML')) {
    return {
      ok: false,
      reason: 'binary-scene',
      warning: `${sceneName}.unity 为二进制格式（Unity Force Text 未开启），已跳过场景解析。`,
    }
  }

  const parsed = parseUnityYamlDocument(text)
  if (parsed.transforms.size === 0 && parsed.prefabInstances.size === 0) {
    return {
      ok: false,
      reason: 'empty-scene',
      warning: `${sceneName}.unity 中未检测到任何场景节点。`,
    }
  }

  const nodes: Record<string, SceneNode> = {}
  const warnings: string[] = []
  const stats: UnitySceneParseResult['stats'] = {
    totalNodes: 0,
    models: 0,
    primitives: 0,
    lights: 0,
    groups: 0,
    missingAssets: 0,
    inactiveNodes: 0,
    mergedRenderers: 0,
    skippedModelTransforms: 0,
  }

  const orderByParent = new Map<string | null, number>()
  const nextOrder = (parentId: string | null): number => {
    const order = orderByParent.get(parentId) ?? 0
    orderByParent.set(parentId, order + 1)
    return order
  }

  const meshPartsCache = new Map<string, MeshPart[]>()
  const meshPartsOf = (assetId: string): MeshPart[] => {
    let parts = meshPartsCache.get(assetId)
    if (!parts) {
      parts = collectMeshParts(ctx.modelInfoByAssetId?.get(assetId)?.tree ?? [])
      meshPartsCache.set(assetId, parts)
    }
    return parts
  }

  let prefabDocs = parsedPrefabCache.get(ctx.prefabTextsByGuid)
  if (!prefabDocs) {
    prefabDocs = new Map()
    parsedPrefabCache.set(ctx.prefabTextsByGuid, prefabDocs)
  }
  const prefabDocOf = (guid: string): ParsedUnityYaml | null => {
    const hit = prefabDocs.get(guid)
    if (hit) return hit
    const prefabText = ctx.prefabTextsByGuid.get(guid)
    if (!prefabText || !prefabText.trimStart().startsWith('%YAML')) return null
    const doc = parseUnityYamlDocument(prefabText)
    prefabDocs.set(guid, doc)
    return doc
  }

  function registerNode(node: SceneNode): SceneNode {
    nodes[node.id] = node
    stats.totalNodes += 1
    if (!node.visible) stats.inactiveNodes += 1
    if (node.kind === 'model') stats.models += 1
    else if (node.kind === 'box' || node.kind === 'sphere' || node.kind === 'cylinder' || node.kind === 'capsule' || node.kind === 'plane') stats.primitives += 1
    else if (node.kind === 'directional-light' || node.kind === 'point-light' || node.kind === 'spot-light') stats.lights += 1
    else stats.groups += 1
    return node
  }

  /** 把 Renderer 的材质写入模型材质槽；同一槽位被不同部位赋予不同材质时再回退到部位级覆盖。 */
  function assignModelMaterials(
    slots: PbrSlot[],
    slotAssigned: Map<number, string>,
    matched: MeshPart[],
    refs: ReadonlyArray<RawMeshRef | undefined>,
    overrides: Record<string, ModelPartOverride>,
    singleMemberFallback: boolean,
  ): void {
    if (refs.length === 0) return

    const bindSlotOrOverride = (slotIdx: number, materialId: string, partPath?: string) => {
      const prev = slotAssigned.get(slotIdx)
      if (prev && prev !== materialId) {
        if (partPath) overrides[partPath] = { materialAssetId: materialId }
        return
      }
      slotAssigned.set(slotIdx, materialId)
      const target = slots[slotIdx]
      if (!target) {
        if (partPath) overrides[partPath] = { materialAssetId: materialId }
        return
      }
      if (target.materialAssetId !== materialId) {
        slots[slotIdx] = {
          ...target,
          materialAssetId: materialId,
          mapAssetId: null,
          normalAssetId: null,
          metallicRoughnessAssetId: null,
          emissiveAssetId: null,
          aoAssetId: null,
        }
      }
    }

    if (matched.length === 0) {
      if (singleMemberFallback && slots.length > 0) {
        refs.forEach((ref, idx) => {
          const materialId = ref?.guid ? ctx.guidToMaterial.get(ref.guid) : undefined
          if (materialId && idx < slots.length) bindSlotOrOverride(idx, materialId)
        })
      }
      return
    }

    if (matched.length === 1 && matched[0]!.slotIndices.length > 1) {
      const part = matched[0]!
      part.slotIndices.forEach((slotIdx, subIdx) => {
        const ref = refs[subIdx] ?? (refs.length === 1 ? refs[0] : undefined)
        const materialId = ref?.guid ? ctx.guidToMaterial.get(ref.guid) : undefined
        if (materialId) bindSlotOrOverride(slotIdx, materialId, part.path)
      })
      return
    }

    matched.forEach((part, index) => {
      let ref: RawMeshRef | undefined
      if (refs.length === 1) ref = refs[0]
      else if (matched.length > 1) ref = refs[index]
      else if (part.slotIndices.length <= 1) ref = refs[0]
      const materialId = ref?.guid ? ctx.guidToMaterial.get(ref.guid) : undefined
      if (!materialId) return
      if (part.slotIndices.length === 1) {
        bindSlotOrOverride(part.slotIndices[0]!, materialId, part.path)
      } else {
        overrides[part.path] = { materialAssetId: materialId }
      }
    })
  }

  function clusterNodeProps(cluster: ModelCluster): Partial<SceneNode> & { anyActive: boolean } {
    const parts = meshPartsOf(cluster.assetId)
    const slots = structuredClone(ctx.modelInfoByAssetId?.get(cluster.assetId)?.slots ?? [])
    const slotAssigned = new Map<number, string>()
    const names = ctx.modelMeshNamesByGuid.get(cluster.guid)
    const shown = new Set<string>()
    const hidden = new Set<string>()
    const overrides: Record<string, ModelPartOverride> = {}
    const singleMember = cluster.members.length === 1
    let allMatched = true
    let anyActive = false
    let castShadow = false
    for (const member of cluster.members) {
      const matched = matchMeshParts(parts, [names?.get(member.meshRef.fileId), member.go.name])
      if (!member.active) {
        for (const part of matched) hidden.add(part.path)
        continue
      }
      anyActive = true
      if (member.renderer.castShadows) castShadow = true
      assignModelMaterials(slots, slotAssigned, matched, member.materials, overrides, singleMember)
      if (matched.length === 0) {
        allMatched = false
        continue
      }
      for (const part of matched) shown.add(part.path)
    }
    // 模型文件里有、但这个物体没用到的网格（一个文件装多套外观时很常见）也要藏起来
    if (allMatched && shown.size > 0) {
      for (const part of parts) if (!shown.has(part.path)) hidden.add(part.path)
    }
    for (const path of shown) hidden.delete(path)
    return {
      anyActive,
      castShadow: anyActive ? castShadow : true,
      ...(slots.length > 0 ? { slots } : {}),
      ...(hidden.size > 0 ? { hiddenParts: [...hidden] } : {}),
      ...(Object.keys(overrides).length > 0 ? { partOverrides: overrides } : {}),
    }
  }

  // 递归展开文档中的节点树
  function buildFromParsedDoc(
    doc: ParsedUnityYaml,
    parentNodeId: string | null,
    mods: ModsByTarget | null,
    prefabStack: Set<string>,
  ): BuildResult {
    // Transform fileID -> 本次展开生成的节点（不同文件的 fileID 会撞，不能跨文档共用）
    const map = new Map<string, string>()
    const plan = planModelClusters(doc, mods, ctx)
    stats.skippedModelTransforms += plan.pruned.size
    let rootId: string | null = null

    const emit = (tr: RawTransform, currentParentId: string | null): void => {
      if (plan.pruned.has(tr.fileId)) return
      const go = doc.gameObjects.get(tr.gameObjectId)
      if (!go) return

      const state = gameObjectState(go, mods)
      const name = state.name
      let pos = tr.position
      let rot = tr.rotation
      let scl = tr.scale
      const trMods = mods?.get(tr.fileId)
      if (trMods) {
        pos = applyVec3Mod(pos, trMods, 'm_LocalPosition')
        rot = applyQuatMod(rot, trMods, 'm_LocalRotation')
        scl = applyVec3Mod(scl, trMods, 'm_LocalScale')
      }

      const renderer = doc.renderers.get(go.fileId)
      const light = doc.lights.get(go.fileId)
      const clusters = plan.byRoot.get(tr.fileId) ?? []

      const nodeId = crypto.randomUUID()
      map.set(tr.fileId, nodeId)
      const base = {
        id: nodeId,
        parentId: currentParentId,
        order: nextOrder(currentParentId),
        visible: state.active,
        position: unityPosToThree(pos),
        rotation: unityQuatToThreeEulerDeg(rot),
        scale: [scl[0], scl[1], scl[2]] as Vec3,
      }

      let created: SceneNode
      let usedClusters = 0
      if (doc.terrains.has(go.fileId)) {
        stats.missingAssets += 1
        created = makeNode({ ...base, name: `[Unsupported: Terrain] ${name}`, kind: 'empty' })
      } else if (light) {
        created = createLightNode(base, name, light)
      } else if (clusters.length > 0) {
        const cluster = clusters[0]!
        const { anyActive, ...props } = clusterNodeProps(cluster)
        stats.mergedRenderers += cluster.members.length - 1
        created = makeNode({ ...base, name, kind: 'model', assetId: cluster.assetId, ...props, visible: base.visible && anyActive })
        usedClusters = 1
      } else {
        const meshRef = renderer ? (doc.meshFilters.get(go.fileId)?.mesh ?? renderer.mesh) : null
        if (renderer && meshRef?.guid && !plan.absorbed.has(tr.fileId)) {
          created = createPrimitiveOrMissingNode(
            { ...base, visible: base.visible && renderer.enabled },
            name,
            meshRef,
            rendererMaterials(renderer, mods),
            renderer.castShadows,
            ctx,
            () => { stats.missingAssets += 1 },
          )
        } else {
          created = makeNode({ ...base, name, kind: 'empty' })
        }
      }
      registerNode(created)

      // 同一个根下还挂着别的模型文件的网格（比如换装部件）：各自作为子模型节点
      for (const cluster of clusters.slice(usedClusters)) {
        const { anyActive, ...props } = clusterNodeProps(cluster)
        stats.mergedRenderers += cluster.members.length - 1
        registerNode(makeNode({
          id: crypto.randomUUID(),
          name: ctx.modelInfoByAssetId?.get(cluster.assetId)?.name ?? cluster.members[0]?.go.name ?? 'Model',
          kind: 'model',
          assetId: cluster.assetId,
          parentId: nodeId,
          order: nextOrder(nodeId),
          ...props,
          visible: anyActive,
        }))
      }

      for (const child of doc.childrenOf.get(tr.fileId) ?? []) emit(child, nodeId)
    }

    const runInstance = (pi: RawPrefabInstance, parentId: string | null): void => {
      const result = expandPrefabInstance(pi, parentId, mods, prefabStack)
      rootId ??= result.rootId
      // 场景里挂在这个实例内部节点下的物体，靠占位 Transform 找回父节点
      for (const stripped of doc.strippedByInstance.get(pi.fileId) ?? []) {
        const target = result.map?.get(stripped.sourceId) ?? result.rootId
        if (target) map.set(stripped.fileId, target)
      }
    }

    // 1. 当前文档内的顶层 Transform；父节点是 Prefab 实例内部节点的先留着
    let pendingOrphans: RawTransform[] = []
    for (const tr of doc.transforms.values()) {
      if (tr.fatherId !== '0' && doc.transforms.has(tr.fatherId)) continue
      if (tr.fatherId !== '0' && doc.strippedTransforms.has(tr.fatherId)) {
        pendingOrphans.push(tr)
        continue
      }
      emit(tr, parentNodeId)
      rootId ??= map.get(tr.fileId) ?? null
    }

    // 2. Prefab 实例与挂在实例下的物体互相依赖，按能确定父节点的顺序逐轮展开
    let pendingInstances = [...doc.prefabInstances.values()]
    for (;;) {
      let progressed = false
      const laterInstances: RawPrefabInstance[] = []
      for (const pi of pendingInstances) {
        const parentRef = pi.transformParentId
        if (parentRef === '0') runInstance(pi, parentNodeId)
        else if (map.has(parentRef)) runInstance(pi, map.get(parentRef)!)
        else if (!doc.strippedTransforms.has(parentRef)) runInstance(pi, parentNodeId)
        else {
          laterInstances.push(pi)
          continue
        }
        progressed = true
      }
      pendingInstances = laterInstances
      const laterOrphans: RawTransform[] = []
      for (const tr of pendingOrphans) {
        const parentId = map.get(tr.fatherId)
        if (parentId) {
          emit(tr, parentId)
          progressed = true
        } else {
          laterOrphans.push(tr)
        }
      }
      pendingOrphans = laterOrphans
      if (!progressed) break
    }
    for (const pi of pendingInstances) runInstance(pi, parentNodeId)
    for (const tr of pendingOrphans) emit(tr, parentNodeId)

    return { rootId, map }
  }

  function expandPrefabInstance(
    pi: RawPrefabInstance,
    parentId: string | null,
    outerMods: ModsByTarget | null,
    prefabStack: Set<string>,
  ): BuildResult {
    const mods = mergeInstanceMods(pi, outerMods)

    // 1. 包内 .prefab
    const prefabDoc = prefabStack.has(pi.sourcePrefabGuid) || prefabStack.size >= MAX_PREFAB_DEPTH
      ? null
      : prefabDocOf(pi.sourcePrefabGuid)
    if (prefabDoc) {
      const nextStack = new Set(prefabStack)
      nextStack.add(pi.sourcePrefabGuid)
      return buildFromParsedDoc(prefabDoc, parentId, mods, nextStack)
    }

    // 根物体上的修改：只认根 Transform / 根 GameObject，子物体的改动不能算到根上
    const findTarget = (path: string): string | undefined => {
      for (const [target, list] of mods) {
        if (list.some(mod => mod.propertyPath === path)) return target
      }
      return undefined
    }
    const rootTransformTarget = findTarget('m_RootOrder') ?? findTarget('m_LocalPosition.x')
    const rootObjectTarget = findTarget('m_Name')
    const rootTransformMods = (rootTransformTarget ? mods.get(rootTransformTarget) : undefined) ?? []
    const rootObjectMods = (rootObjectTarget ? mods.get(rootObjectTarget) : undefined) ?? []
    let rootName: string | undefined
    let rootActive = true
    for (const mod of rootObjectMods) {
      if (mod.propertyPath === 'm_Name' && mod.value) rootName = mod.value
      else if (mod.propertyPath === 'm_IsActive') rootActive = mod.value !== '0'
    }
    const base = {
      id: crypto.randomUUID(),
      parentId,
      order: nextOrder(parentId),
      position: unityPosToThree(applyVec3Mod([0, 0, 0], rootTransformMods, 'm_LocalPosition')),
      rotation: unityQuatToThreeEulerDeg(applyQuatMod([0, 0, 0, 1], rootTransformMods, 'm_LocalRotation')),
      scale: applyVec3Mod([1, 1, 1], rootTransformMods, 'm_LocalScale') as Vec3,
    }

    // 2. 模型文件直接拖进场景（m_SourcePrefab 指向模型本身）：整个实例就是一个模型节点
    const modelAssetId = ctx.guidToModel.get(pi.sourcePrefabGuid)
    if (modelAssetId) {
      const parts = meshPartsOf(modelAssetId)
      const slots = structuredClone(ctx.modelInfoByAssetId?.get(modelAssetId)?.slots ?? [])
      const slotAssigned = new Map<number, string>()
      const names = ctx.modelMeshNamesByGuid.get(pi.sourcePrefabGuid)
      const hidden = new Set<string>()
      const overrides: Record<string, ModelPartOverride> = {}
      for (const [target, targetMods] of mods) {
        const targetName = names?.get(target)
        const matched = targetName ? matchMeshParts(parts, [targetName]) : []
        const materialRefs: Array<RawMeshRef | undefined> = []
        for (const mod of targetMods) {
          if (mod.propertyPath === 'm_IsActive' && mod.value === '0' && target !== rootObjectTarget) {
            for (const part of matched) hidden.add(part.path)
          }
          const slot = /^m_Materials\.Array\.data\[(\d+)\]$/.exec(mod.propertyPath)
          if (slot && mod.objectReference) materialRefs[Number(slot[1])] = mod.objectReference
        }
        if (materialRefs.length > 0) {
          const targets = matched.length > 0 ? matched : (parts.length === 1 ? parts : [])
          assignModelMaterials(slots, slotAssigned, targets, materialRefs, overrides, parts.length <= 1)
        }
      }
      registerNode(makeNode({
        ...base,
        name: rootName || ctx.modelInfoByAssetId?.get(modelAssetId)?.name || 'Model',
        kind: 'model',
        assetId: modelAssetId,
        visible: rootActive,
        ...(slots.length > 0 ? { slots } : {}),
        ...(hidden.size > 0 ? { hiddenParts: [...hidden] } : {}),
        ...(Object.keys(overrides).length > 0 ? { partOverrides: overrides } : {}),
      }))
      return { rootId: base.id, map: null }
    }

    // 3. 缺失或跨包 Prefab -> 空物体占位
    stats.missingAssets += 1
    registerNode(makeNode({
      ...base,
      name: `[Missing Prefab] ${rootName ?? pi.sourcePrefabGuid.slice(0, 8)}`,
      kind: 'empty',
      visible: rootActive,
    }))
    return { rootId: base.id, map: null }
  }

  buildFromParsedDoc(parsed, null, null, new Set())

  if (stats.missingAssets > 0) {
    warnings.push(`${sceneName}.unity 有 ${stats.missingAssets} 个节点引用的资源缺失或暂不支持，已降级为空物体占位。`)
  }

  return {
    ok: true,
    nodes,
    picture: structuredClone(DEFAULT_PICTURE),
    stats,
    warnings,
  }
}

/**
 * 从 `.unity` 或 `.prefab` 文本中扫描所有外部资源 GUID（用于导入依赖自动补全）。
 */
export function collectUnityAssetGuids(text: string): Set<string> {
  const guids = new Set<string>()
  const regex = /\bguid:\s*([a-f0-9]{32})/gi
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    const guid = match[1].toLowerCase()
    if (guid !== UNITY_BUILTIN_RESOURCES_GUID) guids.add(guid)
  }
  return guids
}

// ---------------------------------------------------------------------------
// 模型合并：一个模型文件在 Unity 里展开成「根 + 骨骼 + 若干 Renderer」，
// 在 T3D 里只对应一个模型节点。
// ---------------------------------------------------------------------------

const COLLISION_MESH_RE = /^(?:ucx|ubx|usp|ucp|mcdcx)_|(?:^|[_.\s-])(?:convexhulls?|collisionmesh|colmesh)(?:[_.\s-]?\d+)?$/i
const PURE_COLLIDER_GO_RE = /^(?:box|mesh|sphere|capsule)?collider(?:object)?(?:\s*\(\d+\))?$/i

function isCollisionMeshName(name: string): boolean {
  return COLLISION_MESH_RE.test(name.trim())
}

function parseSceneLodName(name: string): { stem: string; level: number } | null {
  const trimmed = name.trim()
  const bare = /^lod_?(\d+)$/i.exec(trimmed)
  if (bare) return { stem: '', level: Number(bare[1]) }
  const sep = /^(.*?)[_.\s-]+lod_?(\d+)$/i.exec(trimmed)
  if (sep) return { stem: normalizePartName(sep[1]!), level: Number(sep[2]) }
  const camel = /^(.*[a-z0-9])LOD_?(\d+)$/.exec(trimmed)
  if (camel) return { stem: normalizePartName(camel[1]!), level: Number(camel[2]) }
  return null
}

function isIdentityLocalTransform(tr: RawTransform, mods: ModsByTarget | null): boolean {
  let pos = tr.position
  let rot = tr.rotation
  let scl = tr.scale
  const trMods = mods?.get(tr.fileId)
  if (trMods) {
    pos = applyVec3Mod(pos, trMods, 'm_LocalPosition')
    rot = applyQuatMod(rot, trMods, 'm_LocalRotation')
    scl = applyVec3Mod(scl, trMods, 'm_LocalScale')
  }
  const eps = 1e-4
  return Math.abs(pos[0]) <= eps
    && Math.abs(pos[1]) <= eps
    && Math.abs(pos[2]) <= eps
    && Math.abs(rot[0]) <= eps
    && Math.abs(rot[1]) <= eps
    && Math.abs(rot[2]) <= eps
    && Math.abs(Math.abs(rot[3]) - 1) <= eps
    && Math.abs(scl[0] - 1) <= eps
    && Math.abs(scl[1] - 1) <= eps
    && Math.abs(scl[2] - 1) <= eps
}

function computeCulledRenderers(
  doc: ParsedUnityYaml,
  mods: ModsByTarget | null,
  ctx: UnitySceneParseContext,
): Set<string> {
  const culled = new Set<string>(doc.lodCulledRenderers)

  for (const renderer of doc.renderers.values()) {
    const go = doc.gameObjects.get(renderer.gameObjectId)
    if (!go) continue
    const goName = gameObjectState(go, mods).name
    const meshRef = doc.meshFilters.get(go.fileId)?.mesh ?? renderer.mesh
    const meshName = meshRef?.guid ? ctx.modelMeshNamesByGuid.get(meshRef.guid)?.get(meshRef.fileId) : undefined
    if (isCollisionMeshName(goName) || (meshName && isCollisionMeshName(meshName))) {
      culled.add(renderer.fileId)
    }
  }

  // 同一个父节点下存在 LOD0 时，把同组兄弟 LOD1~LOD9 Renderer 一并剔除（兼容没有挂 LODGroup 或已拆开的场景）
  const byParent = new Map<string, Array<{ renderer: RawRenderer; lod: { stem: string; level: number } }>>()
  for (const renderer of doc.renderers.values()) {
    if (culled.has(renderer.fileId)) continue
    const go = doc.gameObjects.get(renderer.gameObjectId)
    const tr = doc.transformByGameObject.get(renderer.gameObjectId)
    if (!go || !tr || tr.fatherId === '0') continue
    const meshRef = doc.meshFilters.get(go.fileId)?.mesh ?? renderer.mesh
    const meshName = meshRef?.guid ? ctx.modelMeshNamesByGuid.get(meshRef.guid)?.get(meshRef.fileId) : undefined
    const lod = parseSceneLodName(meshName ?? '') ?? parseSceneLodName(gameObjectState(go, mods).name)
    if (!lod) continue
    const list = byParent.get(tr.fatherId)
    if (list) list.push({ renderer, lod })
    else byParent.set(tr.fatherId, [{ renderer, lod }])
  }

  for (const siblings of byParent.values()) {
    const lod0Stems = new Set<string>()
    for (const item of siblings) {
      if (item.lod.level === 0) lod0Stems.add(item.lod.stem)
    }
    if (lod0Stems.size === 0) continue
    for (const item of siblings) {
      if (item.lod.level >= 1 && (lod0Stems.has(item.lod.stem) || lod0Stems.has(''))) {
        culled.add(item.renderer.fileId)
      }
    }
  }

  return culled
}

function planModelClusters(doc: ParsedUnityYaml, mods: ModsByTarget | null, ctx: UnitySceneParseContext): ClusterPlan {
  const byRoot = new Map<string, ModelCluster[]>()
  const absorbed = new Set<string>()
  const pruned = new Set<string>()
  const culledRenderers = computeCulledRenderers(doc, mods, ctx)

  for (const renderer of doc.renderers.values()) {
    const go = doc.gameObjects.get(renderer.gameObjectId)
    const tr = doc.transformByGameObject.get(renderer.gameObjectId)
    if (!go || !tr) continue
    if (culledRenderers.has(renderer.fileId)) {
      absorbed.add(tr.fileId)
      continue
    }
    const meshRef = doc.meshFilters.get(go.fileId)?.mesh ?? renderer.mesh
    if (!meshRef?.guid) continue
    const assetId = ctx.guidToModel.get(meshRef.guid)
    if (!assetId) continue

    const root = findClusterRoot(doc, mods, culledRenderers, tr, renderer, meshRef.guid)
    let active = renderer.enabled && gameObjectState(go, mods).active
    if (tr.fileId !== root.fileId) {
      absorbed.add(tr.fileId)
      // 根到这个 Renderer 之间有物体被关掉，这块网格也不显示
      let cursor = doc.transforms.get(tr.fatherId)
      while (active && cursor && cursor.fileId !== root.fileId) {
        const between = doc.gameObjects.get(cursor.gameObjectId)
        if (between && !gameObjectState(between, mods).active) active = false
        cursor = doc.transforms.get(cursor.fatherId)
      }
    }

    let clusters = byRoot.get(root.fileId)
    if (!clusters) {
      clusters = []
      byRoot.set(root.fileId, clusters)
    }
    let cluster = clusters.find(item => item.guid === meshRef.guid)
    if (!cluster) {
      cluster = { rootId: root.fileId, guid: meshRef.guid, assetId, members: [] }
      clusters.push(cluster)
    }
    cluster.members.push({ go, renderer, meshRef, materials: rendererMaterials(renderer, mods), active })
  }

  const instanceParents = new Set<string>()
  for (const pi of doc.prefabInstances.values()) instanceParents.add(pi.transformParentId)

  const isPureColliderObject = (tr: RawTransform): boolean => {
    if (doc.colliders.has(tr.gameObjectId)) return true
    const go = doc.gameObjects.get(tr.gameObjectId)
    return Boolean(go && PURE_COLLIDER_GO_RE.test(gameObjectState(go, mods).name.trim()))
  }

  const hasOwnContent = (tr: RawTransform): boolean => {
    if (byRoot.has(tr.fileId) || instanceParents.has(tr.fileId)) return true
    if (doc.lights.has(tr.gameObjectId) || doc.terrains.has(tr.gameObjectId)) return true
    if (absorbed.has(tr.fileId)) return false
    const renderer = doc.renderers.get(tr.gameObjectId)
    if (!renderer || culledRenderers.has(renderer.fileId)) return false
    return Boolean((doc.meshFilters.get(tr.gameObjectId)?.mesh ?? renderer.mesh)?.guid)
  }

  const visited = new Set<string>()
  const resultOf = new Map<string, boolean>()
  // 返回这棵子树能不能整个省掉：骨骼、已合并/剔除的 LOD 网格节点、纯碰撞体子节点，以及只装着它们的中间节点
  const visit = (tr: RawTransform): boolean => {
    const cached = resultOf.get(tr.fileId)
    if (cached !== undefined) return cached
    if (visited.has(tr.fileId)) return false
    visited.add(tr.fileId)
    const children = doc.childrenOf.get(tr.fileId) ?? []
    let allPruned = true
    for (const child of children) if (!visit(child)) allPruned = false
    const removable = allPruned
      && !hasOwnContent(tr)
      && (doc.boneIds.has(tr.fileId) || absorbed.has(tr.fileId) || isPureColliderObject(tr) || children.length > 0)
    if (removable) pruned.add(tr.fileId)
    resultOf.set(tr.fileId, removable)
    return removable
  }
  for (const rootId of byRoot.keys()) {
    for (const child of doc.childrenOf.get(rootId) ?? []) visit(child)
  }
  for (const goId of doc.lodGroups) {
    const lodTr = doc.transformByGameObject.get(goId)
    if (lodTr) {
      for (const child of doc.childrenOf.get(lodTr.fileId) ?? []) visit(child)
    }
  }
  for (const trId of absorbed) {
    const tr = doc.transforms.get(trId)
    if (tr) visit(tr)
  }
  for (const goId of doc.colliders) {
    const tr = doc.transformByGameObject.get(goId)
    if (tr && !doc.renderers.has(goId)) visit(tr)
  }
  return { byRoot, absorbed, pruned }
}

function findClusterRoot(
  doc: ParsedUnityYaml,
  mods: ModsByTarget | null,
  culledRenderers: ReadonlySet<string>,
  tr: RawTransform,
  renderer: RawRenderer,
  modelGuid: string,
): RawTransform {
  const chain: RawTransform[] = []
  for (let cursor: RawTransform | undefined = tr; cursor && chain.length < 256; cursor = doc.transforms.get(cursor.fatherId)) {
    chain.push(cursor)
  }
  // Animator 的 Avatar 来自同一个模型文件：那个物体就是模型根
  for (const item of chain) {
    if (doc.animators.get(item.gameObjectId) === modelGuid) return item
  }
  if (!renderer.skinned) {
    const parentTr = tr.fatherId !== '0' ? doc.transforms.get(tr.fatherId) : undefined
    if (
      parentTr
      && !doc.renderers.has(parentTr.gameObjectId)
      && !doc.lights.has(parentTr.gameObjectId)
      && !doc.terrains.has(parentTr.gameObjectId)
      && isIdentityLocalTransform(tr, mods)
    ) {
      const siblings = doc.childrenOf.get(parentTr.fileId) ?? []
      let hasCulledOrColliderSibling = doc.lodGroups.has(parentTr.gameObjectId)
      let otherActiveRendererConflict = false
      for (const sib of siblings) {
        if (sib.fileId === tr.fileId) continue
        const sibRenderer = doc.renderers.get(sib.gameObjectId)
        if (sibRenderer) {
          if (culledRenderers.has(sibRenderer.fileId)) {
            hasCulledOrColliderSibling = true
          } else {
            const sibMesh = doc.meshFilters.get(sib.gameObjectId)?.mesh ?? sibRenderer.mesh
            if (sibMesh?.guid !== modelGuid || !isIdentityLocalTransform(sib, mods)) {
              otherActiveRendererConflict = true
            }
          }
        } else if (doc.colliders.has(sib.gameObjectId)) {
          hasCulledOrColliderSibling = true
        }
      }
      if (hasCulledOrColliderSibling && !otherActiveRendererConflict) {
        return parentTr
      }
    }
    return tr
  }
  for (const item of chain) {
    if (doc.animators.has(item.gameObjectId)) return item
  }
  // 没有 Animator：取网格节点和根骨骼的共同祖先
  const inChain = new Set(chain.map(item => item.fileId))
  let bone = renderer.rootBoneId ? doc.transforms.get(renderer.rootBoneId) : undefined
  for (let guard = 0; bone && guard < 256; guard += 1) {
    if (inChain.has(bone.fileId)) return bone
    bone = doc.transforms.get(bone.fatherId)
  }
  return chain[1] ?? tr
}

function gameObjectState(go: RawGameObject, mods: ModsByTarget | null): { name: string; active: boolean } {
  let name = go.name || 'GameObject'
  let active = go.isActive
  const goMods = mods?.get(go.fileId)
  if (goMods) {
    for (const mod of goMods) {
      if (mod.propertyPath === 'm_Name' && mod.value) name = mod.value
      else if (mod.propertyPath === 'm_IsActive') active = mod.value !== '0'
    }
  }
  return { name, active }
}

/** Renderer 的材质列表，叠上 Prefab 实例对这个 Renderer 的材质覆盖。 */
function rendererMaterials(renderer: RawRenderer, mods: ModsByTarget | null): RawMeshRef[] {
  const rendererMods = mods?.get(renderer.fileId)
  if (!rendererMods) return renderer.materials
  let materials = renderer.materials
  for (const mod of rendererMods) {
    const slot = /^m_Materials\.Array\.data\[(\d+)\]$/.exec(mod.propertyPath)
    if (!slot || !mod.objectReference) continue
    if (materials === renderer.materials) materials = [...materials]
    materials[Number(slot[1])] = mod.objectReference
  }
  return materials
}

/**
 * 实例自身的修改，再叠上外层对它的修改。
 * 外层（场景或上一级 Prefab）引用嵌套实例里的物体时，fileID 是「实例 fileID 异或 源物体 fileID」。
 */
function mergeInstanceMods(pi: RawPrefabInstance, outerMods: ModsByTarget | null): ModsByTarget {
  const merged: ModsByTarget = new Map()
  const push = (target: string, mod: RawPrefabModification) => {
    const list = merged.get(target)
    if (list) list.push(mod)
    else merged.set(target, [mod])
  }
  for (const mod of pi.modifications) push(mod.targetFileId, mod)
  if (outerMods) {
    let instanceId: bigint
    try {
      instanceId = BigInt(pi.fileId)
    } catch {
      return merged
    }
    for (const [target, list] of outerMods) {
      let inner: string
      try {
        inner = ((BigInt(target) ^ instanceId) & INT63_MASK).toString()
      } catch {
        continue
      }
      for (const mod of list) push(inner, mod)
    }
  }
  return merged
}

function normalizePartName(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '')
}

function collectMeshParts(tree: ModelTreeNode[]): MeshPart[] {
  const parts: MeshPart[] = []
  const walk = (node: ModelTreeNode, parent: ModelTreeNode | null) => {
    if (node.kind === 'mesh') {
      const keys = [normalizePartName(node.name)]
      if (parent?.kind === 'node') keys.push(normalizePartName(parent.name))
      parts.push({ path: node.path, slotIndices: node.slotIndices, keys })
    }
    for (const child of node.children) walk(child, node)
  }
  for (const node of tree) walk(node, null)
  return parts
}

/** 按名字找模型里的网格部位：先精确匹配网格自身，再匹配上一级节点。 */
function matchMeshParts(parts: MeshPart[], names: ReadonlyArray<string | undefined>): MeshPart[] {
  for (const name of names) {
    const key = name ? normalizePartName(name) : ''
    if (!key) continue
    const exact = parts.filter(part => part.keys[0] === key)
    if (exact.length > 0) return exact
    const grouped = parts.filter(part => part.keys.includes(key))
    if (grouped.length > 0) return grouped
  }
  return []
}

type NodeBase = Pick<SceneNode, 'id' | 'parentId' | 'order' | 'visible' | 'position' | 'rotation' | 'scale'>

function createLightNode(base: NodeBase, name: string, light: RawLight): SceneNode {
  const hex = rgbToHex(light.color[0], light.color[1], light.color[2])
  const kind = light.lightType === 1
    ? 'directional-light'
    : light.lightType === 0
      ? 'spot-light'
      : 'point-light'

  // Unity DirectionalLight 默认朝 +Z，T3D 灯光默认朝 -Y，绕 X 转 +90° 对齐
  let finalRot = base.rotation
  if (kind === 'directional-light' || kind === 'spot-light') {
    finalRot = composeEulerDeg(base.rotation, Math.PI / 2)
  }

  return makeNode({
    ...base,
    name,
    kind,
    rotation: finalRot,
    color: hex,
    intensity: Math.max(0, light.intensity),
    range: kind === 'directional-light' ? 0 : Math.max(0.1, light.range),
    spotAngle: kind === 'spot-light' ? Math.max(5, Math.min(175, light.spotAngle)) : 45,
    // 点光源实时阴影在 WebGPU 下每盏需要 6 次立方体贴图渲染，批量导入场景默认关闭，保留平行光与聚光灯阴影
    castShadow: kind === 'point-light' ? false : light.shadows,
  })
}

function createPrimitiveOrMissingNode(
  base: NodeBase,
  name: string,
  meshRef: RawMeshRef,
  materialRefs: RawMeshRef[],
  castShadow: boolean,
  ctx: UnitySceneParseContext,
  onMissing: () => void,
): SceneNode {
  // Unity 内置基础几何体
  const builtinKind = meshRef.guid === UNITY_BUILTIN_RESOURCES_GUID ? mapUnityBuiltinMesh(meshRef.fileId) : null
  if (builtinKind) {
    let rotation = base.rotation
    let scale = base.scale
    if (meshRef.fileId === '10209') {
      // Unity Plane 默认是 10x10 水平面（朝 +Y），T3D Plane 默认是 1x1 竖直面（朝 +Z）
      rotation = composeEulerDeg(base.rotation, -Math.PI / 2)
      scale = [base.scale[0] * 10, base.scale[2] * 10, base.scale[1]]
    }
    return makeNode({
      ...base,
      name,
      kind: builtinKind,
      rotation,
      scale,
      castShadow,
      materialAssetId: resolveMaterialAssetId(materialRefs, ctx) ?? null,
    })
  }

  // 缺失模型或跨包资产 -> 空物体占位
  onMissing()
  return makeNode({ ...base, name: `[Missing Mesh] ${name}`, kind: 'empty' })
}

function resolveMaterialAssetId(materialRefs: RawMeshRef[], ctx: UnitySceneParseContext): string | undefined {
  for (const ref of materialRefs) {
    if (!ref?.guid) continue
    const matId = ctx.guidToMaterial.get(ref.guid)
    if (matId) return matId
  }
  return undefined
}

function mapUnityBuiltinMesh(fileId: string): 'box' | 'sphere' | 'cylinder' | 'capsule' | 'plane' | null {
  switch (fileId) {
    case '10202': return 'box'      // Cube
    case '10207': return 'sphere'   // Sphere
    case '10206': return 'cylinder' // Cylinder
    case '10208': return 'capsule'  // Capsule
    case '10209':                   // Plane
    case '10210': return 'plane'    // Quad
    default: return null
  }
}

function unityPosToThree(pos: [number, number, number]): Vec3 {
  return [-pos[0], pos[1], pos[2]]
}

function unityQuatToThreeEulerDeg(quat: [number, number, number, number]): Vec3 {
  const q = new Quaternion(quat[0], -quat[1], -quat[2], quat[3]).normalize()
  const euler = new Euler().setFromQuaternion(q, 'XYZ')
  return [
    euler.x * 180 / Math.PI,
    euler.y * 180 / Math.PI,
    euler.z * 180 / Math.PI,
  ]
}

/** 在已有旋转（角度制欧拉角）后面再绕本地 X 轴转一个角度（弧度）。 */
function composeEulerDeg(rotation: Vec3, extraXRadians: number): Vec3 {
  const q = new Quaternion().setFromEuler(new Euler(
    rotation[0] * Math.PI / 180,
    rotation[1] * Math.PI / 180,
    rotation[2] * Math.PI / 180,
    'XYZ',
  ))
  q.multiply(new Quaternion().setFromEuler(new Euler(extraXRadians, 0, 0, 'XYZ')))
  const e = new Euler().setFromQuaternion(q, 'XYZ')
  return [e.x * 180 / Math.PI, e.y * 180 / Math.PI, e.z * 180 / Math.PI]
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)))
  const hex = (n: number) => n.toString(16).padStart(2, '0')
  return `#${hex(clamp(r))}${hex(clamp(g))}${hex(clamp(b))}`
}

function applyVec3Mod(
  base: [number, number, number],
  mods: RawPrefabModification[],
  prefix: string,
): [number, number, number] {
  let [x, y, z] = base
  for (const mod of mods) {
    if (mod.propertyPath === `${prefix}.x`) x = parseFloatOr(mod.value, x)
    else if (mod.propertyPath === `${prefix}.y`) y = parseFloatOr(mod.value, y)
    else if (mod.propertyPath === `${prefix}.z`) z = parseFloatOr(mod.value, z)
  }
  return [x, y, z]
}

function applyQuatMod(
  base: [number, number, number, number],
  mods: RawPrefabModification[],
  prefix: string,
): [number, number, number, number] {
  let [x, y, z, w] = base
  for (const mod of mods) {
    if (mod.propertyPath === `${prefix}.x`) x = parseFloatOr(mod.value, x)
    else if (mod.propertyPath === `${prefix}.y`) y = parseFloatOr(mod.value, y)
    else if (mod.propertyPath === `${prefix}.z`) z = parseFloatOr(mod.value, z)
    else if (mod.propertyPath === `${prefix}.w`) w = parseFloatOr(mod.value, w)
  }
  return [x, y, z, w]
}

function parseFloatOr(raw: string, fallback: number): number {
  const num = Number(raw)
  return raw !== '' && Number.isFinite(num) ? num : fallback
}

// ---------------------------------------------------------------------------
// Unity YAML 分块解析器
// ---------------------------------------------------------------------------

function parseUnityYamlDocument(text: string): ParsedUnityYaml {
  const result: ParsedUnityYaml = {
    gameObjects: new Map(),
    transforms: new Map(),
    meshFilters: new Map(),
    renderers: new Map(),
    lights: new Map(),
    terrains: new Set(),
    animators: new Map(),
    boneIds: new Set(),
    lodGroups: new Set(),
    lodCulledRenderers: new Set(),
    colliders: new Set(),
    prefabInstances: new Map(),
    strippedTransforms: new Map(),
    strippedByInstance: new Map(),
    transformByGameObject: new Map(),
    childrenOf: new Map(),
  }

  const blockRegex = /^--- !u!(\d+) &(-?\d+)( stripped)?.*$/gm
  const matches: { classId: string; fileId: string; stripped: boolean; headerStart: number; start: number }[] = []
  let m: RegExpExecArray | null
  while ((m = blockRegex.exec(text)) !== null) {
    matches.push({ classId: m[1], fileId: m[2], stripped: Boolean(m[3]), headerStart: m.index, start: m.index + m[0].length })
  }

  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i]
    const end = i + 1 < matches.length ? matches[i + 1].headerStart : text.length
    const body = text.slice(cur.start, end)

    if (cur.stripped) {
      // 占位块只有指回 Prefab 实例的引用，没有自己的数据
      if (cur.classId === '4' || cur.classId === '224') {
        const prefabInstanceId = readFileIdRef(body, 'm_PrefabInstance') ?? readFileIdRef(body, 'm_PrefabInternal')
        const sourceId = readFileIdRef(body, 'm_CorrespondingSourceObject') ?? readFileIdRef(body, 'm_PrefabParentObject')
        if (prefabInstanceId && prefabInstanceId !== '0') {
          const stripped: RawStrippedTransform = { fileId: cur.fileId, prefabInstanceId, sourceId: sourceId ?? '0' }
          result.strippedTransforms.set(cur.fileId, stripped)
          const list = result.strippedByInstance.get(prefabInstanceId)
          if (list) list.push(stripped)
          else result.strippedByInstance.set(prefabInstanceId, [stripped])
        }
      }
      continue
    }

    switch (cur.classId) {
      case '1': { // GameObject
        const name = readScalar(body, 'm_Name') ?? 'GameObject'
        const isActiveStr = readScalar(body, 'm_IsActive')
        result.gameObjects.set(cur.fileId, {
          fileId: cur.fileId,
          name,
          isActive: isActiveStr !== '0',
        })
        break
      }
      case '4': // Transform
      case '224': { // RectTransform
        const gameObjectId = readFileIdRef(body, 'm_GameObject')
        if (!gameObjectId) break
        const position = readVec3(body, 'm_LocalPosition') ?? [0, 0, 0]
        const rotation = readVec4(body, 'm_LocalRotation') ?? [0, 0, 0, 1]
        const scale = readVec3(body, 'm_LocalScale') ?? [1, 1, 1]
        const fatherId = readFileIdRef(body, 'm_Father') ?? '0'
        const childrenIds = readFileIdList(body, 'm_Children')
        result.transforms.set(cur.fileId, {
          fileId: cur.fileId,
          gameObjectId,
          position,
          rotation,
          scale,
          fatherId,
          childrenIds,
        })
        break
      }
      case '33': { // MeshFilter
        const gameObjectId = readFileIdRef(body, 'm_GameObject')
        if (!gameObjectId) break
        const mesh = readObjectRef(body, 'm_Mesh')
        result.meshFilters.set(gameObjectId, { gameObjectId, mesh })
        break
      }
      case '23': // MeshRenderer
      case '137': { // SkinnedMeshRenderer
        const gameObjectId = readFileIdRef(body, 'm_GameObject')
        if (!gameObjectId) break
        const skinned = cur.classId === '137'
        const rootBoneId = skinned ? readFileIdRef(body, 'm_RootBone') : undefined
        if (skinned) {
          for (const boneId of readFileIdList(body, 'm_Bones')) result.boneIds.add(boneId)
        }
        result.renderers.set(gameObjectId, {
          fileId: cur.fileId,
          gameObjectId,
          materials: readMaterialsArray(body),
          mesh: skinned ? readObjectRef(body, 'm_Mesh') : null,
          castShadows: readScalar(body, 'm_CastShadows') !== '0',
          enabled: readScalar(body, 'm_Enabled') !== '0',
          skinned,
          ...(rootBoneId && rootBoneId !== '0' ? { rootBoneId } : {}),
        })
        break
      }
      case '64': // MeshCollider
      case '65': // BoxCollider
      case '135': // SphereCollider
      case '136': { // CapsuleCollider
        const gameObjectId = readFileIdRef(body, 'm_GameObject')
        if (gameObjectId) result.colliders.add(gameObjectId)
        break
      }
      case '95': { // Animator
        const gameObjectId = readFileIdRef(body, 'm_GameObject')
        if (gameObjectId) result.animators.set(gameObjectId, readObjectRef(body, 'm_Avatar')?.guid ?? '')
        break
      }
      case '205': { // LODGroup
        const gameObjectId = readFileIdRef(body, 'm_GameObject')
        if (gameObjectId) result.lodGroups.add(gameObjectId)
        for (const rId of readLodGroupCulledRenderers(body)) {
          result.lodCulledRenderers.add(rId)
        }
        break
      }
      case '108': { // Light
        const gameObjectId = readFileIdRef(body, 'm_GameObject')
        if (!gameObjectId) break
        const lightType = Number(readScalar(body, 'm_Type') ?? '2')
        const color = readColorRgb(body, 'm_Color') ?? [1, 1, 1]
        const intensity = parseFloatOr(readScalar(body, 'm_Intensity') ?? '1', 1)
        const range = parseFloatOr(readScalar(body, 'm_Range') ?? '10', 10)
        const spotAngle = parseFloatOr(readScalar(body, 'm_SpotAngle') ?? '30', 30)
        const shadowsType = readNestedScalar(body, 'm_Shadows', 'm_Type')
        result.lights.set(gameObjectId, {
          gameObjectId,
          lightType: Number.isFinite(lightType) ? lightType : 2,
          color,
          intensity,
          range,
          spotAngle,
          shadows: shadowsType !== '0' && shadowsType !== undefined,
        })
        break
      }
      case '218': { // Terrain
        const gameObjectId = readFileIdRef(body, 'm_GameObject')
        if (gameObjectId) result.terrains.add(gameObjectId)
        break
      }
      case '1001': { // PrefabInstance
        // 旧版（2018.3 之前）的 Prefab 块只有 m_ParentPrefab，实例里的物体已经完整写在场景里，不能再展开一遍
        const sourcePrefab = readObjectRef(body, 'm_SourcePrefab')
        if (!sourcePrefab?.guid) break
        const transformParentId = readNestedFileIdRef(body, 'm_Modification', 'm_TransformParent') ?? '0'
        const modifications = readPrefabModifications(body)
        result.prefabInstances.set(cur.fileId, {
          fileId: cur.fileId,
          transformParentId,
          sourcePrefabGuid: sourcePrefab.guid,
          modifications,
        })
        break
      }
    }
  }

  // 父子索引一次建好，展开时不再反复扫全表
  const byFather = new Map<string, RawTransform[]>()
  for (const tr of result.transforms.values()) {
    result.transformByGameObject.set(tr.gameObjectId, tr)
    if (tr.fatherId === '0') continue
    const list = byFather.get(tr.fatherId)
    if (list) list.push(tr)
    else byFather.set(tr.fatherId, [tr])
  }
  for (const tr of result.transforms.values()) {
    const listed = byFather.get(tr.fileId)
    if (!listed) continue
    const ordered: RawTransform[] = []
    const seen = new Set<string>()
    for (const childId of tr.childrenIds) {
      const child = result.transforms.get(childId)
      if (!child || child.fatherId !== tr.fileId || seen.has(childId)) continue
      seen.add(childId)
      ordered.push(child)
    }
    // 只在 m_Father 里指向这里、没出现在 m_Children 的也补上
    for (const child of listed) {
      if (!seen.has(child.fileId)) ordered.push(child)
    }
    result.childrenOf.set(tr.fileId, ordered)
  }

  return result
}

function readScalar(body: string, key: string): string | undefined {
  const match = new RegExp(`^\\s*${key}:\\s*(.*)$`, 'm').exec(body)
  if (!match) return undefined
  const val = match[1].trim()
  if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
    return val.slice(1, -1)
  }
  return val
}

function readNestedScalar(body: string, parentKey: string, childKey: string): string | undefined {
  const parentMatch = new RegExp(`^(\\s*)${parentKey}:\\s*$`, 'm').exec(body)
  if (!parentMatch) return undefined
  const indent = parentMatch[1].length
  const rest = body.slice(parentMatch.index + parentMatch[0].length)
  const lines = rest.split(/\r?\n/)
  for (const line of lines) {
    if (!line.trim()) continue
    const lineIndent = line.match(/^\s*/)?.[0].length ?? 0
    if (lineIndent <= indent) break
    const m = new RegExp(`^\\s*${childKey}:\\s*(.*)$`).exec(line)
    if (m) return m[1].trim()
  }
  return undefined
}

function readFileIdRef(body: string, key: string): string | undefined {
  const match = new RegExp(`^\\s*${key}:\\s*\\{[^}]*fileID:\\s*(-?\\d+)`, 'm').exec(body)
  return match?.[1]
}

function readNestedFileIdRef(body: string, parentKey: string, childKey: string): string | undefined {
  const parentIdx = body.indexOf(`${parentKey}:`)
  if (parentIdx < 0) return undefined
  return readFileIdRef(body.slice(parentIdx), childKey)
}

function readObjectRef(body: string, key: string): RawMeshRef | null {
  const match = new RegExp(`^\\s*${key}:\\s*\\{([^}]*)\\}`, 'm').exec(body)
  if (!match) return null
  const inside = match[1]
  const fileId = /fileID:\s*(-?\d+)/.exec(inside)?.[1] ?? '0'
  const guid = /guid:\s*([a-f0-9]{32})/i.exec(inside)?.[1]?.toLowerCase() ?? ''
  if (!guid && fileId === '0') return null
  return { fileId, guid }
}

function readVec3(body: string, key: string): [number, number, number] | null {
  const match = new RegExp(`^\\s*${key}:\\s*\\{([^}]*)\\}`, 'm').exec(body)
  if (!match) return null
  const inside = match[1]
  const x = parseFloatOr(/x:\s*([^,}\s]+)/.exec(inside)?.[1] ?? '0', 0)
  const y = parseFloatOr(/y:\s*([^,}\s]+)/.exec(inside)?.[1] ?? '0', 0)
  const z = parseFloatOr(/z:\s*([^,}\s]+)/.exec(inside)?.[1] ?? '0', 0)
  return [x, y, z]
}

function readVec4(body: string, key: string): [number, number, number, number] | null {
  const match = new RegExp(`^\\s*${key}:\\s*\\{([^}]*)\\}`, 'm').exec(body)
  if (!match) return null
  const inside = match[1]
  const x = parseFloatOr(/x:\s*([^,}\s]+)/.exec(inside)?.[1] ?? '0', 0)
  const y = parseFloatOr(/y:\s*([^,}\s]+)/.exec(inside)?.[1] ?? '0', 0)
  const z = parseFloatOr(/z:\s*([^,}\s]+)/.exec(inside)?.[1] ?? '0', 0)
  const w = parseFloatOr(/w:\s*([^,}\s]+)/.exec(inside)?.[1] ?? '1', 1)
  return [x, y, z, w]
}

function readColorRgb(body: string, key: string): [number, number, number] | null {
  const match = new RegExp(`^\\s*${key}:\\s*\\{([^}]*)\\}`, 'm').exec(body)
  if (!match) return null
  const inside = match[1]
  const r = parseFloatOr(/r:\s*([^,}\s]+)/.exec(inside)?.[1] ?? '1', 1)
  const g = parseFloatOr(/g:\s*([^,}\s]+)/.exec(inside)?.[1] ?? '1', 1)
  const b = parseFloatOr(/b:\s*([^,}\s]+)/.exec(inside)?.[1] ?? '1', 1)
  return [r, g, b]
}

/** 读 `key:` 下面的 `- {fileID: N}` 列表（m_Children / m_Bones）。 */
function readFileIdList(body: string, key: string): string[] {
  const startMatch = new RegExp(`^\\s*${key}:\\s*$`, 'm').exec(body)
  if (!startMatch) return []
  const rest = body.slice(startMatch.index + startMatch[0].length)
  const ids: string[] = []
  for (const line of rest.split(/\r?\n/)) {
    if (!line.trim()) continue
    if (!/^\s*-/.test(line)) break
    const m = /fileID:\s*(-?\d+)/.exec(line)
    if (m) ids.push(m[1])
  }
  return ids
}

function readMaterialsArray(body: string): RawMeshRef[] {
  const startMatch = /^\s*m_Materials:\s*$/m.exec(body)
  if (!startMatch) return []
  const rest = body.slice(startMatch.index + startMatch[0].length)
  const refs: RawMeshRef[] = []
  for (const line of rest.split(/\r?\n/)) {
    if (!line.trim()) continue
    if (!/^\s*-/.test(line)) break
    const fileId = /fileID:\s*(-?\d+)/.exec(line)?.[1] ?? '0'
    const guid = /guid:\s*([a-f0-9]{32})/i.exec(line)?.[1]?.toLowerCase() ?? ''
    refs.push({ fileId, guid })
  }
  return refs
}

function readPrefabModifications(body: string): RawPrefabModification[] {
  const startMatch = /^\s*m_Modifications:\s*$/m.exec(body)
  if (!startMatch) return []
  const rest = body.slice(startMatch.index + startMatch[0].length)
  const lines = rest.split(/\r?\n/)
  const mods: RawPrefabModification[] = []
  let current: RawPrefabModification | null = null

  for (const line of lines) {
    if (!line.trim()) continue
    if (/^\s*m_[A-Za-z0-9_]+:/.test(line) && !/^\s*-/.test(line)) {
      // 遇到同级或更外层字段，结束 m_Modifications
      if (!line.includes('target:') && !line.includes('propertyPath:') && !line.includes('value:') && !line.includes('objectReference:')) {
        break
      }
    }
    if (/^\s*-\s*target:/.test(line)) {
      if (current) mods.push(current)
      const fileId = /fileID:\s*(-?\d+)/.exec(line)?.[1] ?? '0'
      const guid = /guid:\s*([a-f0-9]{32})/i.exec(line)?.[1]?.toLowerCase() ?? ''
      current = { targetFileId: fileId, targetGuid: guid, propertyPath: '', value: '', objectReference: null }
      continue
    }
    if (!current) continue
    const propMatch = /^\s*propertyPath:\s*(.*)$/.exec(line)
    if (propMatch) {
      current.propertyPath = propMatch[1].trim()
      continue
    }
    const valMatch = /^\s*value:\s*(.*)$/.exec(line)
    if (valMatch) {
      let v = valMatch[1].trim()
      if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) {
        v = v.slice(1, -1)
      }
      current.value = v
      continue
    }
    const objMatch = /^\s*objectReference:\s*\{([^}]*)\}/.exec(line)
    if (objMatch) {
      const inside = objMatch[1]
      const fileId = /fileID:\s*(-?\d+)/.exec(inside)?.[1] ?? '0'
      const guid = /guid:\s*([a-f0-9]{32})/i.exec(inside)?.[1]?.toLowerCase() ?? ''
      if (guid || fileId !== '0') {
        current.objectReference = { fileId, guid }
      }
    }
  }
  if (current) mods.push(current)
  return mods
}

/** 读取 LODGroup.m_LODs 中除第 0 级（LOD0）外所有低模层级的 Renderer fileID。 */
function readLodGroupCulledRenderers(body: string): string[] {
  const startMatch = /^(\s*)m_LODs:\s*$/m.exec(body)
  if (!startMatch) return []
  const baseIndent = startMatch[1]!.length
  const rest = body.slice(startMatch.index + startMatch[0].length)
  const culled: string[] = []
  let lodIndex = -1
  let itemIndent = -1

  for (const line of rest.split(/\r?\n/)) {
    if (!line.trim()) continue
    const indent = line.match(/^\s*/)?.[0].length ?? 0
    if (indent <= baseIndent && !/^\s*-/.test(line)) break
    if (/^\s*-\s*screenRelativeHeight:/.test(line)) {
      lodIndex += 1
      itemIndent = indent
      continue
    }
    if (itemIndent >= 0 && indent === itemIndent && /^\s*-\s+\w+:/.test(line)) {
      lodIndex += 1
      continue
    }
    if (lodIndex >= 1) {
      const m = /^\s*-?\s*renderer:\s*\{[^}]*fileID:\s*(-?\d+)/.exec(line)
      if (m && m[1] && m[1] !== '0') culled.push(m[1])
    }
  }
  return culled
}
