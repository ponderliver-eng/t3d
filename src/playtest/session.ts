import { Group } from 'three'
import {
  clearAllVirtualInput,
  injectVirtualInput,
  type VirtualInputEvent,
} from '../core/input/actionMap'
import {
  captureMainViewport,
  getViewportBridge,
  readMainRenderMetrics,
  type CaptureViewportOptions,
} from '../core/preview/offscreenPreview'
import { DEFAULT_PERFORMANCE_BUDGET, type PerformanceBudget } from '../core/query/diagnose'
import { useAssetStore } from '../editor/assets/library'
import { useEditorStore } from '../editor/scene/store'
import { stepSceneRuntime, type SceneRuntimeHost } from '../runtime/sceneRuntime'
import type { UiNode } from '../runtime/ui/spec'
import { dispatchUiClick, uiValues } from '../runtime/ui/values'
import { getRuntimeWorld } from '../runtime/world'

export type PlaytestReadQuery =
  | { kind: 'nodePose'; nodeIdOrName: string }
  | { kind: 'uiVar'; name: string }
  | { kind: 'logs'; limit?: number }
  | { kind: 'metrics' }
  | { kind: 'nodeCount' }

export type PlaytestWaitCondition =
  | { kind: 'elapsed'; seconds: number }
  | { kind: 'nodeMoved'; nodeIdOrName: string; from: [number, number, number]; minDistance: number }
  | { kind: 'logContains'; text: string }
  | { kind: 'nodeMissing'; nodeIdOrName: string }
  | { kind: 'nodeExists'; nodeIdOrName: string }
  | { kind: 'uiVarEquals'; name: string; value: unknown }
  | { kind: 'nodeCountAtLeast'; min: number }

export type SmokeStep =
  | { action: 'input'; events: VirtualInputEvent[] }
  | { action: 'uiClick'; target: string }
  | { action: 'step'; seconds: number; fixedDt?: number }
  | { action: 'waitFor'; condition: PlaytestWaitCondition; timeoutSec?: number }
  | { action: 'assert'; condition: PlaytestWaitCondition; message?: string }
  | { action: 'capture'; options?: CaptureViewportOptions }

export interface PlaytestReport {
  ok: boolean
  elapsedSec: number
  stepsSimulated: number
  errorCount: number
  warningCount: number
  errors: string[]
  warnings: string[]
  screenshots: string[]
  assertions: Array<{ passed: boolean; message: string }>
  metrics: {
    drawCalls?: number
    triangles?: number
    geometries?: number
    textures?: number
    budgetPassed: boolean
    budgetNotes: string[]
  }
}

export class PlaytestSession {
  private active = false
  private startedFromStopped = false
  private elapsedSec = 0
  private stepsSimulated = 0
  private logBaseline = 0
  private readonly screenshots: string[] = []
  private readonly assertions: Array<{ passed: boolean; message: string }> = []
  private readonly headlessObjects = new Map<string, Group>()

  start(options?: { autoPlayEditor?: boolean }): void {
    const autoPlay = options?.autoPlayEditor !== false
    const store = useEditorStore.getState()
    this.logBaseline = store.logs.length
    this.elapsedSec = 0
    this.stepsSimulated = 0
    this.screenshots.length = 0
    this.assertions.length = 0
    this.headlessObjects.clear()
    clearAllVirtualInput()

    if (autoPlay && store.playState === 'stopped') {
      this.startedFromStopped = true
      store.play()
    } else {
      this.startedFromStopped = false
    }
    this.active = true
  }

  input(events: VirtualInputEvent | VirtualInputEvent[]): void {
    injectVirtualInput(events)
  }

  step(seconds: number, fixedDt = 1 / 60): void {
    if (!this.active) this.start()
    const total = Math.max(0, seconds)
    const dt = Math.max(1 / 240, Math.min(0.1, fixedDt))
    const count = Math.max(1, Math.round(total / dt))
    const bridge = getViewportBridge()
    for (let i = 0; i < count; i += 1) {
      if (bridge) {
        bridge.stepRuntime(dt)
      } else {
        stepSceneRuntime(dt, this.headlessHost())
      }
      this.elapsedSec += dt
      this.stepsSimulated += 1
    }
  }

  read(query: PlaytestReadQuery): unknown {
    const world = getRuntimeWorld()
    const nodes = world.getNodes()
    if (query.kind === 'nodeCount') {
      return Object.keys(nodes).length
    }
    if (query.kind === 'uiVar') {
      return uiValues().variables[query.name]
    }
    if (query.kind === 'logs') {
      const logs = useEditorStore.getState().logs.slice(this.logBaseline)
      const limit = query.limit ?? 30
      return logs.slice(-limit)
    }
    if (query.kind === 'metrics') {
      return readMainRenderMetrics()
    }
    const target = Object.values(nodes).find(
      (n) => n.id === query.nodeIdOrName || n.name === query.nodeIdOrName,
    )
    if (!target) return null
    const obj = getViewportBridge()?.resolveObject(target.id) ?? this.headlessObjects.get(target.id)
    if (obj) {
      return {
        id: target.id,
        name: target.name,
        position: [obj.position.x, obj.position.y, obj.position.z] as [number, number, number],
      }
    }
    return {
      id: target.id,
      name: target.name,
      position: [...target.position] as [number, number, number],
    }
  }

  evaluateCondition(condition: PlaytestWaitCondition): boolean {
    if (condition.kind === 'elapsed') {
      return this.elapsedSec >= condition.seconds
    }
    if (condition.kind === 'logContains') {
      const logs = useEditorStore.getState().logs.slice(this.logBaseline)
      return logs.some((item) => item.message.includes(condition.text))
    }
    if (condition.kind === 'nodeExists') {
      return Boolean(this.read({ kind: 'nodePose', nodeIdOrName: condition.nodeIdOrName }))
    }
    if (condition.kind === 'nodeMissing') {
      return !this.read({ kind: 'nodePose', nodeIdOrName: condition.nodeIdOrName })
    }
    if (condition.kind === 'uiVarEquals') {
      return this.read({ kind: 'uiVar', name: condition.name }) === condition.value
    }
    if (condition.kind === 'nodeCountAtLeast') {
      return Number(this.read({ kind: 'nodeCount' })) >= condition.min
    }
    const pose = this.read({ kind: 'nodePose', nodeIdOrName: condition.nodeIdOrName }) as {
      position: [number, number, number]
    } | null
    if (!pose) return false
    const dx = pose.position[0] - condition.from[0]
    const dy = pose.position[1] - condition.from[1]
    const dz = pose.position[2] - condition.from[2]
    return Math.hypot(dx, dy, dz) >= condition.minDistance
  }

  waitFor(condition: PlaytestWaitCondition, timeoutSec = 5, fixedDt = 1 / 60): boolean {
    const maxSteps = Math.max(1, Math.ceil(timeoutSec / fixedDt))
    for (let i = 0; i < maxSteps; i += 1) {
      if (this.evaluateCondition(condition)) return true
      this.step(fixedDt, fixedDt)
    }
    return this.evaluateCondition(condition)
  }

  capture(options?: CaptureViewportOptions): string | null {
    const dataUrl = captureMainViewport(options)
    if (dataUrl) this.screenshots.push(dataUrl)
    return dataUrl
  }

  report(budget: PerformanceBudget = DEFAULT_PERFORMANCE_BUDGET): PlaytestReport {
    const logs = useEditorStore.getState().logs.slice(this.logBaseline)
    const errors = logs.filter((item) => item.level === 'error').map((item) => item.message)
    const warnings = logs.filter((item) => item.level === 'warn').map((item) => item.message)
    const render = readMainRenderMetrics()
    const budgetNotes: string[] = []
    let budgetPassed = true
    if (render) {
      if (render.drawCalls > budget.maxDrawCalls) {
        budgetPassed = false
        budgetNotes.push(`DrawCall=${render.drawCalls} 超过预算 ${budget.maxDrawCalls}`)
      }
      if (render.triangles > budget.maxTriangles) {
        budgetPassed = false
        budgetNotes.push(`Triangles=${render.triangles} 超过预算 ${budget.maxTriangles}`)
      }
    }
    const assertionsOk = this.assertions.every((item) => item.passed)
    return {
      ok: errors.length === 0 && assertionsOk && budgetPassed,
      elapsedSec: Number(this.elapsedSec.toFixed(3)),
      stepsSimulated: this.stepsSimulated,
      errorCount: errors.length,
      warningCount: warnings.length,
      errors,
      warnings,
      screenshots: [...this.screenshots],
      assertions: [...this.assertions],
      metrics: {
        drawCalls: render?.drawCalls,
        triangles: render?.triangles,
        geometries: render?.geometries,
        textures: render?.textures,
        budgetPassed,
        budgetNotes,
      },
    }
  }

  stop(): void {
    clearAllVirtualInput()
    if (this.startedFromStopped && useEditorStore.getState().playState !== 'stopped') {
      useEditorStore.getState().stop()
    }
    this.active = false
    this.startedFromStopped = false
  }

  runSmoke(steps: SmokeStep[], options?: { autoStop?: boolean; budget?: PerformanceBudget }): PlaytestReport {
    this.start()
    try {
      const effectiveSteps: SmokeStep[] = steps.length > 0 ? steps : [{ action: 'step', seconds: 0.5 }]
      for (const step of effectiveSteps) {
        if (step.action === 'input') {
          this.input(step.events)
        } else if (step.action === 'uiClick') {
          const hit = findMountedUiButton(step.target)
          if (hit && hit.click) {
            dispatchUiClick(hit.click, hit.id)
            this.assertions.push({ passed: true, message: `已点击 UI 按钮 "${hit.name || hit.text || hit.id}"` })
          } else {
            this.assertions.push({ passed: false, message: `未找到可点击的 UI 按钮 "${step.target}"` })
          }
        } else if (step.action === 'step') {
          this.step(step.seconds, step.fixedDt)
        } else if (step.action === 'waitFor') {
          const ok = this.waitFor(step.condition, step.timeoutSec ?? 5)
          this.assertions.push({
            passed: ok,
            message: ok ? `等待条件成立: ${step.condition.kind}` : `等待条件超时: ${step.condition.kind}`,
          })
        } else if (step.action === 'assert') {
          const ok = this.evaluateCondition(step.condition)
          this.assertions.push({
            passed: ok,
            message: step.message ?? (ok ? `断言通过: ${step.condition.kind}` : `断言失败: ${step.condition.kind}`),
          })
        } else if (step.action === 'capture') {
          this.capture(step.options)
        }
      }
      if (this.stepsSimulated === 0) {
        this.step(0.25)
      }
      return this.report(options?.budget)
    } finally {
      if (options?.autoStop !== false) {
        this.stop()
      }
    }
  }

  private headlessHost(): SceneRuntimeHost {
    return {
      ready: true,
      resolveObject: (id) => {
        const node = getRuntimeWorld().getNodes()[id]
        if (!node) return null
        let obj = this.headlessObjects.get(id)
        if (!obj) {
          obj = new Group()
          obj.position.set(node.position[0], node.position[1], node.position[2])
          obj.rotation.set(
            (node.rotation[0] * Math.PI) / 180,
            (node.rotation[1] * Math.PI) / 180,
            (node.rotation[2] * Math.PI) / 180,
          )
          obj.scale.set(node.scale[0], node.scale[1], node.scale[2])
          obj.visible = node.visible
          this.headlessObjects.set(id, obj)
        }
        return obj
      },
      updateAnimations: () => {},
      yaw: () => 0,
      pitch: () => 0,
    }
  }
}

function findMountedUiButton(target: string): UiNode | null {
  const q = target.trim()
  if (!q) return null
  const nodes = getRuntimeWorld().getNodes()
  const assets = useAssetStore.getState().assets
  const searchNode = (node: UiNode): UiNode | null => {
    if (node.type === 'button' && node.click) {
      if (
        node.id === q
        || node.name === q
        || node.text === q
        || (node.click.kind === 'sendMessage' && node.click.message === q)
      ) {
        return node
      }
    }
    for (const child of node.children ?? []) {
      const found = searchNode(child)
      if (found) return found
    }
    return null
  }
  for (const sceneNode of Object.values(nodes)) {
    if (sceneNode.kind !== 'screen' || !sceneNode.visible || !sceneNode.screen?.documentId) continue
    const asset = assets[sceneNode.screen.documentId]
    if (asset?.kind === 'ui' && asset.document?.root) {
      const hit = searchNode(asset.document.root)
      if (hit) return hit
    }
  }
  return null
}
