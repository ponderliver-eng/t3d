import { defineBehavior } from 't3d/runtime'

export const HealthBehavior = defineBehavior({
  name: '生命值',
  params: {
    maxHp: { type: 'number', default: 100, min: 1, max: 10000, label: '最大生命' },
    uiVarKey: { type: 'string', default: 'playerHp', label: '绑定界面变量' },
    hitFx: { type: 'ref', target: 'asset', kinds: ['effect'], label: '受击特效' },
  },
  createState: () => ({ hp: 100 }),
  onStart(self) {
    self.state.hp = self.params.maxHp
    if (self.params.uiVarKey) {
      self.ui.setVar(self.params.uiVarKey, self.state.hp)
    }
  },
  methods: {
    takeDamage(self, amount: number) {
      self.state.hp = Math.max(0, self.state.hp - amount)
      if (self.params.uiVarKey) {
        self.ui.setVar(self.params.uiVarKey, self.state.hp)
      }
      if (self.params.hitFx) {
        self.fx.spawn(self.params.hitFx, self.position)
      }
      if (self.state.hp <= 0) {
        self.broadcast('entityDied', { nodeId: self.node.id })
        self.node.destroy()
      }
    },
  },
})

export const ShooterBehavior = defineBehavior({
  name: '射击与存档示例',
  params: {
    damage: { type: 'number', default: 25, min: 1, max: 500, label: '伤害' },
    range: { type: 'number', default: 30, min: 1, max: 200, label: '射程' },
    nextScene: { type: 'string', default: '', label: '通关切换场景' },
  },
  createState: () => ({ shotsFired: 0 }),
  onStart(self) {
    const saved = self.storage.get<number>('totalShots')
    if (typeof saved === 'number') {
      self.state.shotsFired = saved
    }
  },
  onStep(self) {
    if (!self.input.justPressed('Fire')) return
    self.state.shotsFired += 1
    self.storage.set('totalShots', self.state.shotsFired)

    const hit = self.physics.raycast(self.position, { x: 0, y: 0, z: -1 }, self.params.range)
    if (!hit) return
    const targetHealth = hit.node.getBehavior(HealthBehavior)
    targetHealth?.takeDamage(self.params.damage)
  },
  onMessage(self, message) {
    if (message.name === 'levelClear' && self.params.nextScene) {
      self.scene.load(self.params.nextScene)
    }
  },
})
