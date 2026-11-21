interface ElectronFsLike {
  fs?: {
    readTextFile?: (path: string) => Promise<string>
    writeTextFile?: (path: string, content: string) => Promise<unknown>
  }
}

function resolveFsBridge(): ElectronFsLike['fs'] | undefined {
  return (globalThis as { electronAPI?: ElectronFsLike }).electronAPI?.fs
}

export type InputBindingType = 'button' | 'axis2d'

export interface Axis2DBinding {
  up?: string[]
  down?: string[]
  left?: string[]
  right?: string[]
}

export interface ActionBinding {
  type: InputBindingType
  label: string
  keys?: string[]
  axis?: Axis2DBinding
  gamepadButton?: number
  gamepadAxes?: { x: number; y: number; invertY?: boolean }
  touchControl?: 'joystick' | 'button'
  touchLabel?: string
}

export interface InputActionMap {
  version: 1
  deadzone: number
  actions: Record<string, ActionBinding>
}

export type VirtualInputEvent =
  | { type: 'keyDown'; code: string }
  | { type: 'keyUp'; code: string }
  | { type: 'actionDown'; action: string }
  | { type: 'actionUp'; action: string }
  | { type: 'axis'; action: string; x: number; y: number }
  | { type: 'clear' }

export const DEFAULT_INPUT_MAP: InputActionMap = {
  version: 1,
  deadzone: 0.15,
  actions: {
    Move: {
      type: 'axis2d',
      label: '移动',
      axis: {
        up: ['KeyW', 'ArrowUp'],
        down: ['KeyS', 'ArrowDown'],
        left: ['KeyA', 'ArrowLeft'],
        right: ['KeyD', 'ArrowRight'],
      },
      gamepadAxes: { x: 0, y: 1, invertY: true },
      touchControl: 'joystick',
    },
    Jump: {
      type: 'button',
      label: '跳跃',
      keys: ['Space'],
      gamepadButton: 0,
      touchControl: 'button',
      touchLabel: '跳',
    },
    Sprint: {
      type: 'button',
      label: '冲刺跑',
      keys: ['ShiftLeft', 'ShiftRight'],
      gamepadButton: 4,
    },
    Dash: {
      type: 'button',
      label: '闪避',
      keys: ['KeyC'],
      gamepadButton: 1,
      touchControl: 'button',
      touchLabel: '闪',
    },
    Interact: {
      type: 'button',
      label: '交互',
      keys: ['KeyE'],
      gamepadButton: 2,
      touchControl: 'button',
      touchLabel: '交互',
    },
    Attack: {
      type: 'button',
      label: '攻击/开火',
      keys: ['KeyJ'],
      gamepadButton: 7,
      touchControl: 'button',
      touchLabel: '攻',
    },
  },
}

const INPUT_MAP_FILE = 'input.json'

function cloneDefaultMap(): InputActionMap {
  return structuredClone(DEFAULT_INPUT_MAP)
}

export function normalizeInputMap(raw: unknown): InputActionMap {
  const base = cloneDefaultMap()
  if (!raw || typeof raw !== 'object') return base
  const record = raw as Record<string, unknown>
  const deadzone = typeof record.deadzone === 'number' && Number.isFinite(record.deadzone)
    ? Math.max(0.01, Math.min(0.6, record.deadzone))
    : base.deadzone
  const actions: Record<string, ActionBinding> = { ...base.actions }
  if (record.actions && typeof record.actions === 'object') {
    for (const [name, value] of Object.entries(record.actions as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue
      const item = value as Record<string, unknown>
      const type: InputBindingType = item.type === 'axis2d' ? 'axis2d' : 'button'
      actions[name] = {
        type,
        label: typeof item.label === 'string' && item.label.trim() ? item.label : name,
        keys: Array.isArray(item.keys) ? item.keys.filter((k): k is string => typeof k === 'string') : undefined,
        axis: item.axis && typeof item.axis === 'object' ? (item.axis as Axis2DBinding) : undefined,
        gamepadButton: typeof item.gamepadButton === 'number' ? item.gamepadButton : undefined,
        gamepadAxes: item.gamepadAxes && typeof item.gamepadAxes === 'object'
          ? (item.gamepadAxes as ActionBinding['gamepadAxes'])
          : undefined,
        touchControl: item.touchControl === 'joystick' || item.touchControl === 'button' ? item.touchControl : undefined,
        touchLabel: typeof item.touchLabel === 'string' ? item.touchLabel : undefined,
      }
    }
  }
  return { version: 1, deadzone, actions }
}

let currentMap: InputActionMap = cloneDefaultMap()

export function getInputActionMap(): InputActionMap {
  return currentMap
}

export function setInputActionMap(next: InputActionMap): void {
  currentMap = normalizeInputMap(next)
}

export async function loadProjectInputMap(projectRoot: string): Promise<InputActionMap> {
  if (!projectRoot) {
    currentMap = cloneDefaultMap()
    return currentMap
  }
  const fs = resolveFsBridge()
  const path = `${projectRoot.replace(/[\\/]+$/, '')}/${INPUT_MAP_FILE}`
  try {
    if (fs?.readTextFile) {
      const text = await fs.readTextFile(path)
      currentMap = normalizeInputMap(JSON.parse(text))
      return currentMap
    }
  } catch {
    // 工程尚无 input.json 时自动回退默认值
  }
  currentMap = cloneDefaultMap()
  return currentMap
}

export async function saveProjectInputMap(projectRoot: string, map: InputActionMap = currentMap): Promise<boolean> {
  currentMap = normalizeInputMap(map)
  if (!projectRoot) return false
  const fs = resolveFsBridge()
  if (!fs?.writeTextFile) return false
  const path = `${projectRoot.replace(/[\\/]+$/, '')}/${INPUT_MAP_FILE}`
  await fs.writeTextFile(path, `${JSON.stringify(currentMap, null, 2)}\n`)
  return true
}

const physicalKeys = new Set<string>()
const virtualKeys = new Set<string>()
const tappedKeys = new Set<string>()
const virtualActions = new Set<string>()
const tappedActions = new Set<string>()
const virtualAxes = new Map<string, { x: number; y: number }>()
let listenersBound = false

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  const tag = element?.tagName
  return Boolean(tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element?.isContentEditable)
}

export function bindGlobalInputListeners(): void {
  if (listenersBound || typeof window === 'undefined') return
  listenersBound = true
  window.addEventListener('keydown', (event) => {
    if (isTypingTarget(event.target)) return
    if (!physicalKeys.has(event.code)) tappedKeys.add(event.code)
    physicalKeys.add(event.code)
  })
  window.addEventListener('keyup', (event) => {
    physicalKeys.delete(event.code)
  })
  window.addEventListener('blur', () => {
    physicalKeys.clear()
    tappedKeys.clear()
  })
}

export function injectVirtualInput(events: VirtualInputEvent | VirtualInputEvent[]): void {
  const list = Array.isArray(events) ? events : [events]
  for (const event of list) {
    if (event.type === 'clear') {
      virtualKeys.clear()
      virtualActions.clear()
      virtualAxes.clear()
      tappedKeys.clear()
      tappedActions.clear()
      continue
    }
    if (event.type === 'keyDown') {
      if (!virtualKeys.has(event.code)) tappedKeys.add(event.code)
      virtualKeys.add(event.code)
      continue
    }
    if (event.type === 'keyUp') {
      virtualKeys.delete(event.code)
      continue
    }
    if (event.type === 'actionDown') {
      if (!virtualActions.has(event.action)) tappedActions.add(event.action)
      virtualActions.add(event.action)
      continue
    }
    if (event.type === 'actionUp') {
      virtualActions.delete(event.action)
      continue
    }
    if (event.type === 'axis') {
      virtualAxes.set(event.action, {
        x: Math.max(-1, Math.min(1, event.x)),
        y: Math.max(-1, Math.min(1, event.y)),
      })
    }
  }
}

export function clearAllVirtualInput(): void {
  injectVirtualInput({ type: 'clear' })
}

export function isKeyHeld(code: string): boolean {
  return physicalKeys.has(code) || virtualKeys.has(code)
}

export function wasKeyTapped(code: string): boolean {
  return tappedKeys.has(code)
}

function activeGamepad(): Gamepad | null {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return null
  const pads = navigator.getGamepads()
  for (const pad of pads) {
    if (pad && pad.connected) return pad
  }
  return null
}

export function isActionPressed(actionName: string): boolean {
  if (virtualActions.has(actionName)) return true
  const binding = currentMap.actions[actionName]
  if (!binding) return false
  if (binding.keys?.some((code) => isKeyHeld(code))) return true
  if (typeof binding.gamepadButton === 'number') {
    const pad = activeGamepad()
    if (pad?.buttons[binding.gamepadButton]?.pressed) return true
  }
  return false
}

export function wasActionTapped(actionName: string): boolean {
  if (tappedActions.has(actionName)) return true
  const binding = currentMap.actions[actionName]
  if (!binding) return false
  return Boolean(binding.keys?.some((code) => tappedKeys.has(code)))
}

export function getActionAxis2D(actionName: string): { x: number; y: number } {
  const vAxis = virtualAxes.get(actionName)
  let x = vAxis?.x ?? 0
  let y = vAxis?.y ?? 0
  const binding = currentMap.actions[actionName]
  if (binding?.axis) {
    if (binding.axis.right?.some((c) => isKeyHeld(c))) x += 1
    if (binding.axis.left?.some((c) => isKeyHeld(c))) x -= 1
    if (binding.axis.up?.some((c) => isKeyHeld(c))) y += 1
    if (binding.axis.down?.some((c) => isKeyHeld(c))) y -= 1
  }
  if (binding?.gamepadAxes) {
    const pad = activeGamepad()
    if (pad) {
      const gx = pad.axes[binding.gamepadAxes.x] ?? 0
      const gyRaw = pad.axes[binding.gamepadAxes.y] ?? 0
      const gy = binding.gamepadAxes.invertY ? -gyRaw : gyRaw
      if (Math.abs(gx) > currentMap.deadzone) x += gx
      if (Math.abs(gy) > currentMap.deadzone) y += gy
    }
  }
  const len = Math.hypot(x, y)
  if (len > 1) {
    x /= len
    y /= len
  }
  return { x, y }
}

export function consumeInputFrame(): void {
  tappedKeys.clear()
  tappedActions.clear()
}
