import { Box3, Sphere, Vector3, type Object3D, type SkinnedMesh } from 'three'

type SkinnedBounds = Omit<SkinnedMesh, 'boundingBox' | 'boundingSphere'> & {
  boundingBox: Box3 | null
  boundingSphere: Sphere | null
}

const vertex = new Vector3()

/**
 * 蒙皮包围盒依赖骨骼的世界矩阵，以及网格上的绑定逆矩阵。
 * 先刷新整棵子树的世界矩阵，再在首次缺失时按局部空间缓存蒙皮包围盒，避免每帧在 CPU 上逐顶点蒙皮。
 */
export function refreshObjectBounds(root: Object3D) {
  root.updateMatrixWorld(true)
  root.traverse(child => {
    const skinned = child as SkinnedBounds
    if (!skinned.isSkinnedMesh || !skinned.skeleton) return
    if (skinned.boundingBox && !skinned.boundingBox.isEmpty()) return
    const position = skinned.geometry?.getAttribute('position')
    if (!position || position.count === 0) return
    const box = new Box3()
    const step = Math.max(1, Math.floor(position.count / 2048))
    for (let i = 0; i < position.count; i += step) {
      skinned.getVertexPosition(i, vertex)
      box.expandByPoint(vertex)
    }
    skinned.boundingBox = box
    if (!skinned.boundingSphere) {
      skinned.boundingSphere = box.getBoundingSphere(new Sphere())
    }
  })
}

export function boundsOf(root: Object3D): Box3 {
  refreshObjectBounds(root)
  return new Box3().setFromObject(root)
}
