import { Box3, type Object3D, type SkinnedMesh } from 'three'

type SkinnedBounds = Omit<SkinnedMesh, 'boundingBox'> & { boundingBox: Box3 | null }

/**
 * 蒙皮包围盒依赖骨骼的世界矩阵，以及网格上的绑定逆矩阵。
 * 只调用 updateWorldMatrix 不会刷新绑定逆矩阵，缩放会被算两次。
 * 算完后清掉缓存，否则下一次仍用旧盒子。
 */
export function refreshObjectBounds(root: Object3D) {
  root.updateMatrixWorld(true)
  root.traverse(child => {
    const skinned = child as SkinnedBounds
    if (!skinned.isSkinnedMesh || !skinned.skeleton) return
    skinned.boundingBox = null
  })
}

export function boundsOf(root: Object3D): Box3 {
  refreshObjectBounds(root)
  return new Box3().setFromObject(root)
}
