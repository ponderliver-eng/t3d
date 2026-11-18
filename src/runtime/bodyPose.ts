/** 试玩时按物理状态钉住身体动画的时间，不写进场景节点。 */
const times = new Map<string, number>()

export function poseBody(id: string, time: number) {
  times.set(id, time)
}

export function clearBodyPose(id: string) {
  times.delete(id)
}

export function clearBodyPoses() {
  times.clear()
}

export function bodyPoseOf(id: string): number | undefined {
  return times.get(id)
}
