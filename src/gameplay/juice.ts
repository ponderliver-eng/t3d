import type { SceneRuntimeHost } from '../runtime/sceneRuntime'
import { playSound } from '../runtime/audio'
import { getRuntimeWorld } from '../runtime/world'
import { armJuice } from './juiceClock'
import { findRow } from './registry'

export function playJuice(id: string, nodeId: string, host: SceneRuntimeHost): boolean {
  const world = getRuntimeWorld()
  const row = findRow(world.getGameDatabase(), 'juice', id)
  if (!row) {
    if (id.trim()) world.log('warn', `打击感缺少一行：${id}`)
    return false
  }
  const fields = row.fields ?? {}
  const now = performance.now() / 1000
  const color = typeof fields.rimFlashColor === 'string' ? fields.rimFlashColor : ''
  armJuice(numberField(fields.hitStopSec), numberField(fields.cameraShake), color, now)
  const sound = typeof fields.sound === 'string' ? fields.sound.trim() : ''
  if (sound) {
    playSound({
      assetId: sound,
      volume: fields.soundVolume === undefined ? 1 : numberField(fields.soundVolume),
      parent: host.resolveObject(nodeId),
    })
  }
  const knock = numberField(fields.knockbackMeters)
  if (knock > 0) knockBack(nodeId, host, knock)
  return true
}

function knockBack(nodeId: string, host: SceneRuntimeHost, meters: number) {
  const object = host.resolveObject(nodeId)
  if (!object) return
  const yaw = Math.atan2(2 * object.quaternion.w * object.quaternion.y, 1 - 2 * object.quaternion.y * object.quaternion.y)
  object.position.x -= Math.sin(yaw) * meters
  object.position.z -= Math.cos(yaw) * meters
}

function numberField(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : 0
}
