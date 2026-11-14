/** 模型上的播放状态机。参数决定切到哪一段；直接指定片段是另一条通道。 */

export interface AnimatorParam {
  id: string
  name: string
  type: 'bool' | 'number' | 'trigger'
  value: boolean | number
}

export interface AnimatorState {
  id: string
  name: string
  clip: string
  clipAssetId: string | null
  loop: boolean
  speed: number
  mask?: 'full' | 'upper' | 'lower'
  inPlace?: boolean
}

export interface AnimatorTransition {
  id: string
  from: string
  to: string
  param: string
  mode: 'equals' | 'greater' | 'less' | 'triggered'
  value?: boolean | number
  fade: number
  exitTime?: number
}

export interface AnimatorController {
  enabled: boolean
  stateId: string
  defaultStateId?: string
  parameters: AnimatorParam[]
  states: AnimatorState[]
  transitions: AnimatorTransition[]
}

export function emptyAnimator(): AnimatorController {
  const idle = crypto.randomUUID()
  return {
    enabled: false,
    stateId: idle,
    defaultStateId: idle,
    parameters: [],
    states: [{ id: idle, name: 'Idle', clip: '', clipAssetId: null, loop: true, speed: 1, mask: 'full' }],
    transitions: [],
  }
}

function conditionMet(controller: AnimatorController, transition: AnimatorTransition, normalized: number): boolean {
  if (transition.exitTime !== undefined && normalized < transition.exitTime) return false
  const param = controller.parameters.find(item => item.name === transition.param)
  if (!param) return false
  if (transition.mode === 'triggered') return param.type === 'trigger' && param.value === true
  if (transition.mode === 'greater') return typeof param.value === 'number' && typeof transition.value === 'number' && param.value > transition.value
  if (transition.mode === 'less') return typeof param.value === 'number' && typeof transition.value === 'number' && param.value < transition.value
  return param.value === transition.value
}

export function stepAnimator(
  controller: AnimatorController,
  elapsed: number,
  duration: number,
): { controller: AnimatorController; changed: boolean; fade: number } {
  const state = controller.states.find(item => item.id === controller.stateId) ?? controller.states[0]
  if (!state) return { controller, changed: false, fade: 0 }
  const loopDuration = duration > 0 ? duration : 1
  const normalized = state.loop ? (elapsed % loopDuration) / loopDuration : Math.min(1, elapsed / loopDuration)
  const transition = controller.transitions.find(item => item.from === state.id && conditionMet(controller, item, normalized))
  if (!transition || !controller.states.some(item => item.id === transition.to)) {
    return { controller, changed: false, fade: 0 }
  }
  const parameters = controller.parameters.map(param => (
    param.type === 'trigger' && param.name === transition.param ? { ...param, value: false } : param
  ))
  return {
    controller: { ...controller, stateId: transition.to, parameters },
    changed: true,
    fade: transition.fade,
  }
}

export function activeAnimatorState(controller: AnimatorController): AnimatorState | undefined {
  return controller.states.find(item => item.id === controller.stateId) ?? controller.states[0]
}
