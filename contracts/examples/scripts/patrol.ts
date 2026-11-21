import { defineBehavior } from 't3d/runtime'

export default defineBehavior({
  name: '巡逻',
  params: {
    speed: { type: 'number', default: 2.5, min: 0, max: 20, label: '速度' },
    points: {
      type: 'list',
      item: { type: 'ref', target: 'node', label: '巡逻点' },
      label: '巡逻路径',
    },
  },
  createState: () => ({ index: 0 }),
  onStart(self) {
    self.state.index = 0
  },
  onStep(self, dt) {
    const points = self.params.points
    if (points.length === 0) return
    const target = points[self.state.index]
    if (!target) return
    self.lookAt(target.position)
    if (self.moveToward(target.position, self.params.speed * dt)) {
      self.state.index = (self.state.index + 1) % points.length
    }
  },
  onMessage(self, message) {
    if (message.name === 'resetPatrol') {
      self.state.index = 0
    }
  },
})
