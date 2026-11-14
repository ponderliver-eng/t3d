import type { NodeKind } from '../../editor/scene/types'
import type { NodePhysics } from '../../editor/scene/types'

const SHARED = {
  trigger: false,
  mass: 1,
  friction: 0.7,
  restitution: 0.05,
  linearDamping: 0.1,
  angularDamping: 0.1,
  gravityScale: 1,
} as const

export function defaultNodePhysics(kind: NodeKind): NodePhysics {
  if (kind === 'plane') {
    return { ...SHARED, body: 'static', shape: 'box', size: [1, 1, 0.05] }
  }
  if (kind === 'sphere') {
    return { ...SHARED, body: 'dynamic', shape: 'sphere', size: [0.5, 0.5, 0.5] }
  }
  if (kind === 'capsule') {
    return { ...SHARED, body: 'dynamic', shape: 'capsule', size: [0.3, 1.1, 0.3] }
  }
  if (kind === 'cylinder' || kind === 'cone') {
    return { ...SHARED, body: 'dynamic', shape: 'capsule', size: [0.5, 1, 0.5] }
  }
  return { ...SHARED, body: 'dynamic', shape: 'box', size: [1, 1, 1] }
}
