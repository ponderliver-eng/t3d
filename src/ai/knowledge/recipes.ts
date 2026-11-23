/**
 * AI 范例库：一组可直接改写的完整脚本 + 场景搭建步骤。
 *
 * 设计约束：
 * - 这不是积木/拼装系统。范例只是「可读、可改的参考源码」，AI 通过 kb__read 取回后
 *   用 script__create 落成工程里的普通 .ts 脚本，之后与手写脚本无任何区别。
 * - 每份源码都必须通过 tests/ai-knowledge.test.ts（真实编译 + 静态反模式检查）。
 *   新增或修改范例后请运行 npm run test:ai。
 * - 源码里不要使用反引号与 ${}（本文件用模板字符串承载源码）。
 */

export interface RecipeFile {
  /** 建议的脚本 ID（script__create 的 id） */
  scriptId: string
  /** 挂载对象说明 */
  attachTo: string
  source: string
}

export interface Recipe {
  id: string
  title: string
  /** 一句话说明解决什么问题（出现在系统提示的目录里） */
  summary: string
  /** 场景搭建与挂载步骤（按顺序执行） */
  setup: string[]
  files: RecipeFile[]
  /** 验收方式：可直接改写后传给 playtest__run_smoke 的步骤说明 */
  verify: string
  /** 常见坑 */
  pitfalls?: string[]
}

const THIRD_PERSON_CONTROLLER = `import { defineBehavior } from "t3d/runtime"

export default defineBehavior({
  name: "第三人称角色控制",
  description: "WASD 相对相机移动、空格跳跃、Shift 奔跑，并按速度切换待机/行走/奔跑动画",
  params: {
    idleClip: { type: "ref", target: "clip", label: "待机剪辑", default: null },
    walkClip: { type: "ref", target: "clip", label: "行走剪辑", default: null },
    runClip: { type: "ref", target: "clip", label: "奔跑剪辑", default: null },
    walkSpeed: { type: "number", label: "行走速度", default: 3.2 },
    runSpeed: { type: "number", label: "奔跑速度", default: 6.5 },
    turnSpeed: { type: "number", label: "转身速度", default: 12 },
    jumpSpeed: { type: "number", label: "跳跃初速", default: 5.2 },
    gravity: { type: "number", label: "重力加速度", default: 14 },
    groundY: { type: "number", label: "地面高度", default: 0 },
  },
  state: () => ({ velY: 0, grounded: true, clip: "" }),
  onStart(self) {
    self.addTag("player")
  },
  onUpdate(self, dt) {
    const p = self.params
    const s = self.state
    const pos = self.position

    // 1) 输入：moveDirection 直接给出「相对当前相机」的世界水平方向（W = 画面远处），
    //    方位角由引擎按相机视线算好，不要自己从相机旋转里推
    const dir = self.input.moveDirection("Move")
    let mx = dir.x
    let mz = dir.z
    const mLen = Math.hypot(mx, mz)
    const moving = mLen > 0.05
    const sprinting = moving && self.input.isPressed("Sprint")
    const speed = sprinting ? p.runSpeed : p.walkSpeed
    if (moving) {
      mx /= mLen
      mz /= mLen
    }

    // 3) 跳跃与重力（手动积分，不依赖物理能力包）
    if (s.grounded && self.input.justPressed("Jump")) {
      s.velY = p.jumpSpeed
      s.grounded = false
    }
    s.velY -= p.gravity * dt
    let y = pos.y + s.velY * dt
    if (y <= p.groundY) {
      y = p.groundY
      s.velY = 0
      s.grounded = true
    }

    // 4) 位置必须整体赋值
    self.position = {
      x: pos.x + (moving ? mx * speed * dt : 0),
      y,
      z: pos.z + (moving ? mz * speed * dt : 0),
    }

    // 5) 平滑转向移动方向（self.rotation 为弧度；yaw=0 时朝 +Z）
    if (moving) {
      const targetYaw = Math.atan2(mx, mz)
      const rot = self.rotation
      let diff = targetYaw - rot.y
      while (diff > Math.PI) diff -= Math.PI * 2
      while (diff < -Math.PI) diff += Math.PI * 2
      const k = Math.min(1, p.turnSpeed * dt)
      self.rotation = { x: rot.x, y: rot.y + diff * k, z: rot.z }
    }

    // 6) 只在目标剪辑变化时切换动画，避免每帧重播
    const next = moving ? (sprinting ? p.runClip || p.walkClip : p.walkClip) : p.idleClip
    if (next && next !== s.clip) {
      s.clip = next
      self.anim.playBody(next, { loop: true, fade: 0.15 })
    }
  },
})
`

const FOLLOW_CAMERA = `import { defineBehavior } from "t3d/runtime"

export default defineBehavior({
  name: "跟随相机",
  description: "平滑跟随目标并始终看向它；按住鼠标右键拖动可环绕",
  params: {
    target: { type: "ref", target: "node", label: "跟随目标", default: null },
    distance: { type: "number", label: "水平距离", default: 6 },
    height: { type: "number", label: "相机高度", default: 3.2 },
    lookHeight: { type: "number", label: "注视点高度", default: 1.2 },
    smooth: { type: "number", label: "跟随平滑度", default: 8 },
    orbitSpeed: { type: "number", label: "环绕灵敏度", default: 0.005 },
  },
  state: () => ({ yaw: 0 }),
  onUpdate(self, dt) {
    const p = self.params
    const s = self.state
    if (!p.target) return

    if (self.input.isMouseButtonPressed(2)) {
      s.yaw -= self.input.pointerDelta().x * p.orbitSpeed
    }

    const t = p.target.position
    // yaw=0 时相机位于目标的 -Z 侧，看向 +Z（与角色默认朝向一致）
    const want = {
      x: t.x - Math.sin(s.yaw) * p.distance,
      y: t.y + p.height,
      z: t.z - Math.cos(s.yaw) * p.distance,
    }
    const k = 1 - Math.exp(-p.smooth * dt)
    const cur = self.position
    self.position = {
      x: cur.x + (want.x - cur.x) * k,
      y: cur.y + (want.y - cur.y) * k,
      z: cur.z + (want.z - cur.z) * k,
    }
    self.lookAt({ x: t.x, y: t.y + p.lookHeight, z: t.z })
  },
})
`

const WAVE_SPAWNER = `import { defineBehavior } from "t3d/runtime"

export default defineBehavior({
  name: "波次刷怪",
  description: "按波次从隐藏模板节点池化生成敌人，并把当前波次写入界面变量",
  params: {
    template: { type: "ref", target: "node", label: "敌人模板（隐藏节点）", default: null },
    spawnRadius: { type: "number", label: "生成半径", default: 12 },
    firstWaveCount: { type: "number", label: "首波数量", default: 3 },
    countPerWave: { type: "number", label: "每波递增", default: 2 },
    spawnInterval: { type: "number", label: "单只间隔(秒)", default: 0.6 },
    waveGap: { type: "number", label: "波次间隔(秒)", default: 4 },
    maxAlive: { type: "number", label: "同屏上限", default: 20 },
    waveVar: { type: "string", label: "波次界面变量", default: "wave" },
  },
  state: () => ({ wave: 0, toSpawn: 0, spawnTimer: 0, gapTimer: 1 }),
  onStart(self) {
    if (self.params.template) self.pool.preload(self.params.template, 6)
    self.ui.setVar(self.params.waveVar, 0)
  },
  onUpdate(self, dt) {
    const p = self.params
    const s = self.state
    if (!p.template) return
    const alive = self.pool.stats(p.template).active

    // 本波已刷完且场上清空 -> 倒计时进入下一波
    if (s.toSpawn <= 0) {
      if (alive > 0) return
      s.gapTimer -= dt
      if (s.gapTimer > 0) return
      s.wave += 1
      s.toSpawn = p.firstWaveCount + (s.wave - 1) * p.countPerWave
      s.spawnTimer = 0
      s.gapTimer = p.waveGap
      self.ui.setVar(p.waveVar, s.wave)
      self.broadcast("waveStarted", { wave: s.wave })
      return
    }

    s.spawnTimer -= dt
    if (s.spawnTimer > 0 || alive >= p.maxAlive) return
    s.spawnTimer = p.spawnInterval
    s.toSpawn -= 1

    const angle = Math.random() * Math.PI * 2
    const center = self.position
    self.pool.acquire(p.template, {
      position: {
        x: center.x + Math.cos(angle) * p.spawnRadius,
        y: center.y,
        z: center.z + Math.sin(angle) * p.spawnRadius,
      },
      payload: { wave: s.wave },
    })
  },
})
`

const CHASE_ENEMY = `import { defineBehavior } from "t3d/runtime"

export default defineBehavior({
  name: "追击敌人",
  description: "追向带指定标签的目标，贴身后按间隔造成伤害；收到 hit 消息扣血，死亡后回池",
  params: {
    targetTag: { type: "string", label: "目标标签", default: "player" },
    speed: { type: "number", label: "移动速度", default: 2.4 },
    maxHp: { type: "number", label: "生命值", default: 3 },
    damage: { type: "number", label: "攻击伤害", default: 10 },
    attackRange: { type: "number", label: "攻击距离", default: 1.3 },
    attackInterval: { type: "number", label: "攻击间隔(秒)", default: 0.8 },
    score: { type: "number", label: "击杀得分", default: 10 },
  },
  state: () => ({ hp: 1, cooldown: 0, alive: false }),
  onStart(self) {
    // 隐藏的模板节点自身也会执行脚本：不可见时不要激活、更不要打标签
    if (!self.visible) return
    self.state.hp = self.params.maxHp
    self.state.alive = true
    self.addTag("enemy")
  },
  onUpdate(self, dt) {
    const p = self.params
    const s = self.state
    if (!s.alive || !self.visible) return

    const target = self.findNodesByTag(p.targetTag)[0]
    if (!target || !target.visible) return

    s.cooldown -= dt
    const dist = self.distanceTo(target)
    if (dist > p.attackRange) {
      self.moveToward(target, p.speed * dt, { faceTarget: true, planeXZ: true })
      return
    }
    self.lookAt(target, { yOnly: true })
    if (s.cooldown <= 0) {
      s.cooldown = p.attackInterval
      target.sendMessage("damage", { amount: p.damage })
    }
  },
  onMessage(self, msg) {
    const s = self.state
    if (msg.name !== "hit" || !s.alive) return
    const payload = msg.payload
    const amount = payload && typeof payload === "object" && "damage" in payload ? Number(payload.damage) : 1
    s.hp -= amount
    self.tween.punchScale(0.25, 0.15)
    if (s.hp > 0) return
    s.alive = false
    self.broadcast("enemyKilled", { score: self.params.score })
    // 池化对象调用 destroy 会自动回池
    self.node.destroy()
  },
})
`

const PLAYER_SHOOTER = `import { defineBehavior } from "t3d/runtime"

export default defineBehavior({
  name: "玩家射击",
  description: "按住攻击键沿角色朝向连续发射池化子弹",
  params: {
    bullet: { type: "ref", target: "node", label: "子弹模板（隐藏节点）", default: null },
    fireInterval: { type: "number", label: "射击间隔(秒)", default: 0.18 },
    muzzleHeight: { type: "number", label: "枪口高度", default: 1.1 },
    muzzleForward: { type: "number", label: "枪口前伸", default: 0.7 },
  },
  state: () => ({ cooldown: 0 }),
  onStart(self) {
    if (self.params.bullet) self.pool.preload(self.params.bullet, 12)
  },
  onUpdate(self, dt) {
    const p = self.params
    const s = self.state
    s.cooldown -= dt
    if (!p.bullet || s.cooldown > 0) return
    if (!self.input.isPressed("Attack") && !self.input.isMouseButtonPressed(0)) return
    s.cooldown = p.fireInterval

    const pos = self.position
    const dir = self.forward
    self.pool.acquire(p.bullet, {
      position: {
        x: pos.x + dir.x * p.muzzleForward,
        y: pos.y + p.muzzleHeight,
        z: pos.z + dir.z * p.muzzleForward,
      },
      rotation: self.rotation,
      payload: { dir },
    })
  },
})
`

const BULLET = `import { defineBehavior } from "t3d/runtime"

export default defineBehavior({
  name: "子弹",
  description: "沿发射方向直线飞行，命中带目标标签的节点后发送 hit 消息并回池",
  params: {
    speed: { type: "number", label: "飞行速度", default: 22 },
    life: { type: "number", label: "存活时间(秒)", default: 2 },
    damage: { type: "number", label: "伤害", default: 1 },
    hitRadius: { type: "number", label: "命中半径", default: 0.7 },
    targetTag: { type: "string", label: "目标标签", default: "enemy" },
  },
  state: () => ({ dx: 0, dz: 1, age: 0, live: false }),
  onSpawn(self, payload) {
    const s = self.state
    const dir = payload && typeof payload === "object" && "dir" in payload ? payload.dir : null
    const fallback = self.forward
    s.dx = dir && typeof dir === "object" && "x" in dir ? Number(dir.x) : fallback.x
    s.dz = dir && typeof dir === "object" && "z" in dir ? Number(dir.z) : fallback.z
    s.age = 0
    s.live = true
  },
  onUpdate(self, dt) {
    const p = self.params
    const s = self.state
    // 模板节点本身不可见且从未被 onSpawn 激活，直接跳过
    if (!s.live || !self.visible) return

    self.translate({ x: s.dx * p.speed * dt, y: 0, z: s.dz * p.speed * dt }, "world")
    s.age += dt

    const hit = self.findNodesInRadius(self.position, p.hitRadius, p.targetTag)[0]
    if (hit) {
      hit.sendMessage("hit", { damage: p.damage })
      s.live = false
      self.node.destroy()
      return
    }
    if (s.age >= p.life) {
      s.live = false
      self.node.destroy()
    }
  },
})
`

const PLAYER_HEALTH = `import { defineBehavior } from "t3d/runtime"

export default defineBehavior({
  name: "玩家生命",
  description: "接收 damage 消息扣血并同步到界面进度条（0~1），死亡时广播 playerDied",
  params: {
    maxHp: { type: "number", label: "最大生命", default: 100 },
    hpVar: { type: "string", label: "生命界面变量(0~1)", default: "hp" },
    invincibleTime: { type: "number", label: "受击无敌(秒)", default: 0.4 },
  },
  state: () => ({ hp: 100, invincible: 0, dead: false }),
  onStart(self) {
    self.addTag("player")
    self.state.hp = self.params.maxHp
    self.ui.setVar(self.params.hpVar, 1)
  },
  onUpdate(self, dt) {
    if (self.state.invincible > 0) self.state.invincible -= dt
  },
  onMessage(self, msg) {
    const p = self.params
    const s = self.state
    if (msg.name !== "damage" || s.dead || s.invincible > 0) return
    const payload = msg.payload
    const amount = payload && typeof payload === "object" && "amount" in payload ? Number(payload.amount) : 10
    s.hp = Math.max(0, s.hp - amount)
    s.invincible = p.invincibleTime
    // HUD 模板的进度条量程是 0~1
    self.ui.setVar(p.hpVar, s.hp / p.maxHp)
    self.tween.shakePosition(0.12, 0.2)
    if (s.hp > 0) return
    s.dead = true
    self.visible = false
    self.broadcast("playerDied")
  },
})
`

const GAME_MANAGER = `import { defineBehavior } from "t3d/runtime"

export default defineBehavior({
  name: "对局管理",
  description: "汇总得分、处理胜负并控制结算界面的显示",
  params: {
    scoreVar: { type: "string", label: "得分界面变量", default: "score" },
    targetScore: { type: "number", label: "胜利所需得分(0=无上限)", default: 0 },
    resultScreen: { type: "string", label: "结算界面屏幕名称", default: "结算界面" },
    resultTitleVar: { type: "string", label: "结算标题界面变量", default: "resultTitle" },
  },
  state: () => ({ score: 0, over: false }),
  onStart(self) {
    self.ui.setVar(self.params.scoreVar, 0)
    self.ui.hideScreen(self.params.resultScreen)
  },
  onMessage(self, msg) {
    const p = self.params
    const s = self.state
    if (s.over) return

    if (msg.name === "enemyKilled" || msg.name === "collected") {
      const payload = msg.payload
      const gain = payload && typeof payload === "object" && "score" in payload ? Number(payload.score) : 1
      s.score += gain
      self.ui.setVar(p.scoreVar, s.score)
      if (p.targetScore > 0 && s.score >= p.targetScore) {
        s.over = true
        self.ui.setVar(p.resultTitleVar, "胜利！")
        self.ui.showScreen(p.resultScreen)
        self.broadcast("gameOver", { win: true })
      }
      return
    }

    if (msg.name === "playerDied") {
      s.over = true
      self.ui.setVar(p.resultTitleVar, "失败")
      self.ui.showScreen(p.resultScreen)
      self.broadcast("gameOver", { win: false })
    }
  },
})
`

const COLLECTIBLE = `import { defineBehavior } from "t3d/runtime"

export default defineBehavior({
  name: "可拾取物",
  description: "原地旋转浮动，带指定标签的节点靠近后广播 collected 并消失",
  params: {
    pickerTag: { type: "string", label: "拾取者标签", default: "player" },
    radius: { type: "number", label: "拾取半径", default: 1.1 },
    score: { type: "number", label: "得分", default: 1 },
    spinSpeed: { type: "number", label: "旋转速度(弧度/秒)", default: 2.2 },
    bobHeight: { type: "number", label: "浮动幅度", default: 0.18 },
  },
  state: () => ({ baseY: 0, taken: false }),
  onStart(self) {
    self.state.baseY = self.position.y
  },
  onUpdate(self, dt) {
    const p = self.params
    const s = self.state
    if (s.taken) return

    self.rotateY(p.spinSpeed * dt)
    const pos = self.position
    self.position = { x: pos.x, y: s.baseY + Math.sin(self.elapsedTime * 3) * p.bobHeight, z: pos.z }

    const picker = self.findNodesInRadius(self.position, p.radius, p.pickerTag)[0]
    if (!picker) return
    s.taken = true
    self.broadcast("collected", { score: p.score })
    self.node.destroy()
  },
})
`

export const RECIPES: Recipe[] = [
  {
    id: 'third-person-controller',
    title: '第三人称角色控制（移动 / 跳跃 / 动画切换）',
    summary: 'WASD 相对相机移动、空格跳跃、Shift 奔跑，按状态切换待机/行走/奔跑剪辑',
    setup: [
      '角色节点：已有蒙皮模型就用 kind:"model"；没有模型就用 kind:"capsule"（此时三个剪辑参数留空即可）。',
      '场景里要有一个相机节点（建议同时挂 follow-camera 范例）。',
      'script__create 写入源码后，script__attach 到角色，params 传三个剪辑名（来自模型或动画资产的 clips 列表）。移动方向自动相对当前相机，不需要传相机。',
      '地面不在 y=0 时把 groundY 设为地面高度。',
    ],
    files: [{ scriptId: 'ThirdPersonController', attachTo: '玩家角色节点', source: THIRD_PERSON_CONTROLLER }],
    verify:
      'playtest__run_smoke：先 input 注入 {type:"axis",action:"Move",x:0,y:1}，step 1 秒，再 assert nodeMoved（from 为角色初始位置，minDistance 1）。',
    pitfalls: [
      '剪辑参数必须是 ref(target:"clip")，直接把参数值传给 self.anim.playBody，引擎会自动在模型与外部动画资产里找同名剪辑。',
      '不要每帧调用 playBody，只在目标剪辑变化时调用。',
      '相对相机的移动一律用 self.input.moveDirection()；不要读相机的 rotation 自己算方位角，欧拉角在相机有俯仰时会算偏。',
      '只需要标准的走/跑/跳加动画切换时，直接用内置组件 character（gameplay__setCoreComponent）更省事；需要自定义移动手感才用这份脚本。',
    ],
  },
  {
    id: 'follow-camera',
    title: '跟随相机（平滑跟随 + 右键环绕）',
    summary: '相机平滑跟在目标身后并始终注视目标',
    setup: [
      '创建 kind:"camera" 节点，初始位置放在目标后上方即可（脚本会接管位置与朝向）。',
      'script__attach 到相机节点，params.target 传被跟随的节点。',
    ],
    files: [{ scriptId: 'FollowCamera', attachTo: '相机节点', source: FOLLOW_CAMERA }],
    verify: 'viewport__capture({ playSeconds: 0.8 })：确认目标位于画面中下部且没有被地面或墙体遮挡。',
    pitfalls: ['相机朝向一律用 self.lookAt，不要手算欧拉角。'],
  },
  {
    id: 'enemy-wave',
    title: '波次刷怪 + 追击敌人（对象池）',
    summary: '从一个隐藏模板节点池化生成敌人，敌人追击并攻击玩家，可被 hit 消息击杀',
    setup: [
      '敌人模板：创建一个敌人节点（模型或基础几何体），挂 ChaseEnemy，然后把模板的 visible 设为 false 并放在场景外侧。',
      '刷怪点：创建 kind:"empty" 节点放在战场中心，挂 WaveSpawner，params.template 传敌人模板节点。',
      '玩家节点需要带 "player" 标签（third-person-controller 与 health-score-hud 范例都会在 onStart 自动打）。',
    ],
    files: [
      { scriptId: 'ChaseEnemy', attachTo: '敌人模板节点（隐藏）', source: CHASE_ENEMY },
      { scriptId: 'WaveSpawner', attachTo: '战场中心的空节点', source: WAVE_SPAWNER },
    ],
    verify:
      'playtest__run_smoke：step 3 秒后 assert uiVarEquals {name:"wave",value:1}，并用 nodeCountAtLeast 断言节点数比编辑态多（已生成敌人）。',
    pitfalls: [
      '隐藏的模板节点自身也会执行脚本，所以脚本里要用 if (!self.visible) return 跳过，且只在可见实例上打标签。',
      '池化对象用 self.node.destroy() 即可自动回池，不要手建一堆节点充当对象池。',
    ],
  },
  {
    id: 'shooting',
    title: '射击（玩家开火 + 池化子弹）',
    summary: '按住攻击键沿角色朝向发射子弹，子弹命中带 "enemy" 标签的节点后发送 hit 消息',
    setup: [
      '子弹模板：创建一个小球/小胶囊节点，挂 Bullet，visible 设为 false。',
      'script__attach PlayerShooter 到玩家节点，params.bullet 传子弹模板节点。',
      '被击中的对象需要带 "enemy" 标签并在 onMessage 里处理 "hit"（见 enemy-wave 范例的 ChaseEnemy）。',
    ],
    files: [
      { scriptId: 'Bullet', attachTo: '子弹模板节点（隐藏）', source: BULLET },
      { scriptId: 'PlayerShooter', attachTo: '玩家节点', source: PLAYER_SHOOTER },
    ],
    verify:
      'playtest__run_smoke：input 注入 {type:"actionDown",action:"Attack"}，step 0.5 秒，用 nodeCountAtLeast 断言节点数增加（已生成子弹）。',
  },
  {
    id: 'health-score-hud',
    title: '生命值 + 得分 + HUD / 结算界面',
    summary: '玩家受击扣血、击杀与拾取加分，数据驱动 HUD，死亡或达标时弹出结算界面',
    setup: [
      'HUD：ui__createFromTemplate({ template:"hud", varKey:"hp", scoreVarKey:"score" })。',
      '结算：ui__createFromTemplate({ template:"result", name:"结算界面", scoreVarKey:"score" })，标题文本可用 ui__patchNode 绑定到变量 resultTitle。',
      'script__attach PlayerHealth 到玩家节点；创建一个空节点 GameManager 并挂 GameManager 脚本（resultScreen 传结算界面屏幕节点的名称）。',
    ],
    files: [
      { scriptId: 'PlayerHealth', attachTo: '玩家节点', source: PLAYER_HEALTH },
      { scriptId: 'GameManager', attachTo: '空节点 GameManager', source: GAME_MANAGER },
    ],
    verify: 'playtest__run_smoke：step 0.5 秒后 assert uiVarEquals {name:"hp",value:1} 与 {name:"score",value:0}。',
    pitfalls: [
      'HUD 模板的进度条量程是 0~1，写入界面变量时要除以最大值。',
      '跨节点通信用 self.broadcast / node.sendMessage + onMessage，不要互相直接改对方的 state。',
    ],
  },
  {
    id: 'collectible',
    title: '可拾取物（金币 / 道具）',
    summary: '旋转浮动的拾取物，玩家靠近后加分并消失',
    setup: [
      '创建拾取物节点（球体/圆柱或模型），挂 Collectible；需要多个时直接复制节点或做成预制体。',
      '配合 health-score-hud 范例的 GameManager 统计得分（它会处理 collected 消息）。',
    ],
    files: [{ scriptId: 'Collectible', attachTo: '拾取物节点', source: COLLECTIBLE }],
    verify:
      'playtest__run_smoke：把玩家放在拾取物旁，注入朝向拾取物的 Move 输入并 step 1.5 秒，assert nodeMissing（拾取物名称）与 uiVarEquals score。',
  },
]

export function findRecipe(id: string): Recipe | null {
  const key = id.trim().toLowerCase()
  if (!key) return null
  return (
    RECIPES.find((r) => r.id === key) ??
    RECIPES.find((r) => r.files.some((f) => f.scriptId.toLowerCase() === key)) ??
    null
  )
}

export function listRecipeIndex(): Array<{ id: string; title: string; summary: string }> {
  return RECIPES.map((r) => ({ id: r.id, title: r.title, summary: r.summary }))
}

/** 系统提示里的范例目录（静态文本，保持稳定以命中提示缓存） */
export function formatRecipeIndexForPrompt(): string {
  return RECIPES.map((r) => `   - ${r.id}：${r.summary}`).join('\n')
}
