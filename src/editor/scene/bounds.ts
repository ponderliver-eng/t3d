import { Box3, Matrix4, Sphere, Vector3, type Object3D, type SkinnedMesh } from 'three'

type SkinnedBounds = Omit<SkinnedMesh, 'boundingBox' | 'boundingSphere'> & {
  boundingBox: Box3 | null
  boundingSphere: Sphere | null
}

const vertex = new Vector3()
const inverse = new Matrix4()
const boneBox = new Box3()
const vertexBox = new Box3()

/**
 * 射线先用包围球把网格丢掉。导入时的球是没蒙皮的，蹲下后身体会露在外面，点击就穿过角色打到地面。
 * 肉的厚度只量一次；之后每次拾取只用骨骼关节更新包围盒，不逐顶点蒙皮。
 */
export function prepareSkinnedPickBounds(root: Object3D) {
  let skinned = false
  root.traverse(child => {
    if ((child as SkinnedMesh).isSkinnedMesh) skinned = true
  })
  if (!skinned) return
  root.updateMatrixWorld(true)
  root.traverse(child => {
    const mesh = child as SkinnedBounds
    if (!mesh.isSkinnedMesh || !mesh.skeleton || !Array.isArray(mesh.skeleton.bones)) return
    const hasNullBone = mesh.skeleton.bones.some(bone => !bone)
    if (!hasNullBone) {
      try {
        mesh.skeleton.update()
      } catch {
        // 忽略异常骨骼矩阵更新，继续用有效骨骼估算包围盒
      }
    }
    inverse.copy(mesh.matrixWorld).invert()
    boneBox.makeEmpty()
    for (const bone of mesh.skeleton.bones) {
      if (!bone) continue
      bone.updateWorldMatrix(true, false)
      bone.getWorldPosition(vertex).applyMatrix4(inverse)
      boneBox.expandByPoint(vertex)
    }
    if (boneBox.isEmpty()) return
    const pad = skinPad(mesh, boneBox)
    const box = mesh.boundingBox ?? new Box3()
    box.copy(boneBox).expandByScalar(pad)
    mesh.boundingBox = box
    mesh.boundingSphere = box.getBoundingSphere(mesh.boundingSphere ?? new Sphere())
  })
}

function skinPad(mesh: SkinnedBounds, bones: Box3): number {
  const cached = mesh.userData.t3dSkinPad
  if (typeof cached === 'number') return cached
  const position = mesh.geometry?.getAttribute('position')
  if (!position || position.count === 0) return 0.05
  vertexBox.makeEmpty()
  const step = position.count > 24000 ? Math.ceil(position.count / 12000) : 1
  for (let i = 0; i < position.count; i += step) {
    mesh.getVertexPosition(i, vertex)
    vertexBox.expandByPoint(vertex)
  }
  const pad = vertexBox.isEmpty()
    ? 0.05
    : Math.max(
      bones.min.x - vertexBox.min.x,
      vertexBox.max.x - bones.max.x,
      bones.min.y - vertexBox.min.y,
      vertexBox.max.y - bones.max.y,
      bones.min.z - vertexBox.min.z,
      vertexBox.max.z - bones.max.z,
      0.02,
    )
  mesh.userData.t3dSkinPad = pad
  return pad
}

export function boundsOf(root: Object3D): Box3 {
  prepareSkinnedPickBounds(root)
  try {
    return new Box3().setFromObject(root)
  } catch {
    root.updateMatrixWorld(true)
    const fallback = new Box3()
    const itemBox = new Box3()
    root.traverse(child => {
      const geo = (child as { geometry?: { boundingBox?: Box3 | null; computeBoundingBox?: () => void } }).geometry
      if (!geo) return
      if (!geo.boundingBox) geo.computeBoundingBox?.()
      if (!geo.boundingBox) return
      itemBox.copy(geo.boundingBox).applyMatrix4(child.matrixWorld)
      fallback.union(itemBox)
    })
    return fallback
  }
}
