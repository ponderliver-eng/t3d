export type CharacterLifecycleEvent =
  | 'onFootstep'
  | 'onJump'
  | 'onLand'
  | 'onEnterWater'
  | 'onExitWater'

type FootstepListener = (nodeId: string) => void
type CharacterEventListener = (nodeId: string, event: CharacterLifecycleEvent, payload?: Record<string, unknown>) => void

const footstepListeners = new Set<FootstepListener>()
const characterEventListeners = new Set<CharacterEventListener>()

export function onFootstep(listener: FootstepListener): () => void {
  footstepListeners.add(listener)
  return () => {
    footstepListeners.delete(listener)
  }
}

export function emitFootstep(nodeId: string) {
  for (const listener of footstepListeners) {
    listener(nodeId)
  }
  emitCharacterEvent(nodeId, 'onFootstep')
}

export function onCharacterEvent(listener: CharacterEventListener): () => void {
  characterEventListeners.add(listener)
  return () => {
    characterEventListeners.delete(listener)
  }
}

export function emitCharacterEvent(
  nodeId: string,
  event: CharacterLifecycleEvent,
  payload?: Record<string, unknown>,
) {
  for (const listener of characterEventListeners) {
    listener(nodeId, event, payload)
  }
}
