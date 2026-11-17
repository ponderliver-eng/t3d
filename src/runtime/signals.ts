type FootstepListener = (nodeId: string) => void

let footstepListener: FootstepListener | null = null

export function onFootstep(listener: FootstepListener) {
  footstepListener = listener
}

export function emitFootstep(nodeId: string) {
  footstepListener?.(nodeId)
}
