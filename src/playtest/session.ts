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
import { readScriptStateSnapshot } from '../core/codeAssets/scriptRuntime'
import { stepSceneRuntime, type SceneRuntimeHost } from '../runtime/sceneRuntime'
import type { UiNode } from '../runtime/ui/spec'
import { dispatchUiClick, uiValues } from '../runtime/ui/values'
import { getRuntimeWorld } from '../runtime/world'

export type PlaytestReadQuery =
  | { kind: 'nodePose'; nodeIdOrName: string }
  | { kind: 'scriptState'; nodeIdOrName: string }
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
  /** 脚本 self.log 等普通日志（已去重） */
  logs: string[]
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

/** 日志游标：store.logs 是 300 条的环形窗口，不能用数组下标做基线，只能用最后一条日志的 id */
export function captureLogCursor(): string | null {
  const logs = useEditorStore.getState().logs
  return logs.length > 0 ? logs[logs.length - 1].id : null
}

export function readLogsSince(cursor: string | null) {
  const logs = useEditorStore.getState().logs
  if (!cursor) return logs
  const idx = logs.findIndex((item) => item.id === cursor)
  // 游标已被挤出窗口，说明窗口内全部是游标之后产生的日志
  return idx >= 0 ? logs.slice(idx + 1) : logs
}

/** 把逐帧重复的运行时报错去重计数，避免同一条异常刷满返回值 */
export function summarizeRuntimeLogs(
  logs: ReadonlyArray<{ level: string; message: string }>,
  maxEach = 8,
): { errorCount: number; warningCount: number; errors: string[]; warnings: string[] } {
  const collect = (level: string) => {
    const counts = new Map<string, number>()
    for (const item of logs) {
      if (item.level !== level) continue
      counts.set(item.message, (counts.get(item.message) ?? 0) + 1)
    }
    const total = Array.from(counts.values()).reduce((sum, n) => sum + n, 0)
    const lines = Array.from(counts.entries())
      .slice(0, maxEach)
      .map(([message, n]) => (n > 1 ? `${message}（重复 ${n} 次）` : message))
    if (counts.size > maxEach) lines.push(`…另有 ${counts.size - maxEach} 种不同消息未列出`)
    return { total, lines }
  }
  const errors = collect('error')
  const warnings = collect('warn')
  return { errorCount: errors.total, warningCount: warnings.total, errors: errors.lines, warnings: warnings.lines }
}

/**
 * 脚本 self.log(...) 输出的普通日志（info 级），按首次出现顺序去重计数。
 * 逐帧打印的日志会折叠成一行「（重复 N 次）」，保证有限篇幅内能看到尽量多不同的内容。
 */
export function summarizeInfoLogs(
  logs: ReadonlyArray<{ level: string; message: string }>,
  maxLines = 40,
): string[] {
  const counts = new Map<string, number>()
  for (const item of logs) {
    if (item.level === 'error' || item.level === 'warn') continue
    counts.set(item.message, (counts.get(item.message) ?? 0) + 1)
  }
  const lines = Array.from(counts.entries())
    .slice(0, maxLines)
    .map(([message, n]) => {
      const text = message.length > 300 ? `${message.slice(0, 300)}…` : message
      return n > 1 ? `${text}（重复 ${n} 次）` : text
    })
  if (counts.size > maxLines) lines.push(`…另有 ${counts.size - maxLines} 种不同日志未列出`)
  return lines
}

export interface PlaytestNodePose {
  id: string
  name: string
  position: [number, number, number]
  /** 欧拉角（度）。rotation[1] 即朝向 yaw，0 表示朝 +Z */
  rotation: [number, number, number]
  visible: boolean
}

export class PlaytestSession {
  private active = false
  private startedFromStopped = false
  private elapsedSec = 0
  private stepsSimulated = 0
  private logCursor: string | null = null
  private sampler: { every: number; next: number; onSample: (elapsedSec: number) => void } | null = null
  private readonly screenshots: string[] = []
  private readonly assertions: Array<{ passed: boolean; message: string }> = []
  private readonly headlessObjects = new Map<string, Group>()

  start(options?: { autoPlayEditor?: boolean }): void {
    const autoPlay = options?.autoPlayEditor !== false
    const store = useEditorStore.getState()
    this.logCursor = captureLogCursor()
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
      if (this.sampler && this.elapsedSec + 1e-6 >= this.sampler.next) {
        this.sampler.next += this.sampler.every
        this.sampler.onSample(Number(this.elapsedSec.toFixed(3)))
      }
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
      const logs = readLogsSince(this.logCursor)
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
    if (query.kind === 'scriptState') {
      return readScriptStateSnapshot(target.id)
    }
    const obj = getViewportBridge()?.resolveObject(target.id) ?? this.headlessObjects.get(target.id)
    if (obj) {
      const deg = 180 / Math.PI
      const pose: PlaytestNodePose = {
        id: target.id,
        name: target.name,
        position: [obj.position.x, obj.position.y, obj.position.z],
        rotation: [obj.rotation.x * deg, obj.rotation.y * deg, obj.rotation.z * deg],
        visible: obj.visible,
      }
      return pose
    }
    const pose: PlaytestNodePose = {
      id: target.id,
      name: target.name,
      position: [...target.position] as [number, number, number],
      rotation: [...target.rotation] as [number, number, number],
      visible: target.visible,
    }
    return pose
  }

  /** 每推进 everySec 游戏秒回调一次，用于采样节点轨迹等过程数据 */
  setSampler(everySec: number, onSample: (elapsedSec: number) => void): void {
    this.sampler = { every: Math.max(1 / 60, everySec), next: 0, onSample }
  }

  evaluateCondition(condition: PlaytestWaitCondition): boolean {
    if (condition.kind === 'elapsed') {
      return this.elapsedSec >= condition.seconds
    }
    if (condition.kind === 'logContains') {
      const logs = readLogsSince(this.logCursor)
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
    const logs = readLogsSince(this.logCursor)
    const errors = logs.filter((item) => item.level === 'error').map((item) => item.message)
    const warnings = logs.filter((item) => item.level === 'warn').map((item) => item.message)
    const infoLogs = summarizeInfoLogs(logs)
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
      logs: infoLogs,
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
