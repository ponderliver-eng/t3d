import { defineBehavior } from 't3d/runtime'

export default defineBehavior({
  name: '往返移动平台',
  params: {
    offset: { type: 'vec3', default: [0, 3, 0], label: '往返偏移' },
    speed: { type: 'number', default: 1.2, min: 0.1, max: 10, label: '周期速度' },
    waitSeconds: { type: 'number', default: 0.5, min: 0, max: 5, label: '两端停顿(秒)' },
  },
  createState: () => ({
    startX: 0,
    startY: 0,
    startZ: 0,
    goingForward: true,
    pauseTimer: 0,
  }),
  onStart(self) {
    self.state.startX = self.position.x
    self.state.startY = self.position.y
    self.state.startZ = self.position.z
  },
  onStep(self, dt) {
    if (self.state.pauseTimer > 0) {
      self.state.pauseTimer = Math.max(0, self.state.pauseTimer - dt)
      return
    }
    const target = self.state.goingForward
      ? {
          x: self.state.startX + self.params.offset.x,
          y: self.state.startY + self.params.offset.y,
          z: self.state.startZ + self.params.offset.z,
        }
      : {
          x: self.state.startX,
          y: self.state.startY,
          z: self.state.startZ,
        }

    if (self.moveToward(target, self.params.speed * dt)) {
      self.state.goingForward = !self.state.goingForward
      self.state.pauseTimer = self.params.waitSeconds
    }
  },
})
