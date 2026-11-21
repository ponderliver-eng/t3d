import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { CommandBus } from '../src/core/commands/bus.ts'
import {
  defaultForSchema,
  fieldSchemaToJsonSchema,
  normalizeBySchema,
  validateBySchema,
  type ObjectFieldSchema,
} from '../src/core/schema/fieldSchema.ts'
import { PathGuard } from '../electron/services/pathGuard.ts'

test('FieldSchema: 默认值、校验、可选字段与 JSON Schema 转换', () => {
  const schema: ObjectFieldSchema = {
    type: 'object',
    fields: {
      speed: { type: 'number', default: 5, min: 0, max: 20, label: '速度' },
      color: { type: 'color', default: '#ffffff', label: '颜色' },
      offset: { type: 'vec3', default: [0, 1, 0], optional: true, label: '偏移' },
      mode: {
        type: 'enum',
        options: [
          { value: 'lit', label: '受光' },
          { value: 'unlit', label: '不受光' },
        ],
        default: 'lit',
        label: '模式',
      },
    },
  }

  const defaults = defaultForSchema(schema) as Record<string, unknown>
  assert.equal(defaults.speed, 5)
  assert.deepEqual(defaults.offset, [0, 1, 0])

  const normalized = normalizeBySchema<Record<string, unknown>>(schema, { speed: 99, color: 'bad', mode: 'unknown' })
  assert.equal(normalized.speed, 20)
  assert.equal(normalized.color, '#ffffff')
  assert.equal(normalized.mode, 'lit')

  const valid = validateBySchema<Record<string, unknown>>(schema, { speed: 12 })
  assert.equal(valid.ok, true)
  if (valid.ok) {
    assert.equal(valid.value.speed, 12)
    assert.equal('offset' in valid.value, false)
  }

  const invalid = validateBySchema(schema, { speed: -3 })
  assert.equal(invalid.ok, false)

  const jsonSchema = fieldSchemaToJsonSchema(schema) as { properties: Record<string, { enum?: string[] }> }
  assert.deepEqual(jsonSchema.properties.mode.enum, ['lit', 'unlit'])
})

test('CommandBus: 参数校验、试玩拦截、嵌套事务与磁盘文件回滚', async () => {
  const bus = new CommandBus()
  let playing = false
  let count = 0
  const undoSteps: Array<{ label: string; before: unknown }> = []
  const disk = new Map<string, string>([['scripts/a.ts', 'old']])

  bus.setAdapter({
    isPlaying: () => playing,
    captureSnapshot: () => count,
    restoreSnapshot: (snap) => {
      count = snap as number
    },
    commitUndoStep: (label, before) => {
      undoSteps.push({ label, before })
    },
    restoreFiles: (files) => {
      for (const f of files) {
        if (f.previousContent === null) disk.delete(f.relativePath)
        else disk.set(f.relativePath, f.previousContent)
      }
    },
  })

  bus.register<{ delta: number }, number>({
    id: 'test.add',
    title: '累加计数',
    risk: 'safe',
    params: {
      type: 'object',
      fields: {
        delta: { type: 'number', default: 1, min: 1, max: 10, label: '增量' },
      },
    },
    run(ctx, p) {
      ctx.recordFileBeforeChange?.('scripts/a.ts', disk.get('scripts/a.ts') ?? null)
      disk.set('scripts/a.ts', `updated:${count + p.delta}`)
      count += p.delta
      return { ok: true, value: count, changed: { nodesUpdated: ['n1'], filesChanged: ['scripts/a.ts'] } }
    },
  })

  const badParams = await bus.dispatch('test.add', { delta: 99 })
  assert.equal(badParams.ok, false)
  if (!badParams.ok) assert.equal(badParams.code, 'params.invalid')

  playing = true
  const locked = await bus.dispatch('test.add', { delta: 2 })
  assert.equal(locked.ok, false)
  if (!locked.ok) assert.equal(locked.code, 'play.locked')
  playing = false

  bus.beginTransaction('AI 一轮操作')
  const step1 = await bus.dispatch('test.add', { delta: 3 })
  assert.equal(step1.ok, true)
  bus.beginTransaction('子步骤')
  await bus.dispatch('test.add', { delta: 4 })
  assert.equal(count, 7)
  await bus.rollbackTransaction()
  assert.equal(count, 3)
  assert.equal(disk.get('scripts/a.ts'), 'updated:3')
  await bus.rollbackTransaction()
  assert.equal(count, 0)
  assert.equal(disk.get('scripts/a.ts'), 'old')
  assert.equal(undoSteps.length, 0)

  bus.beginTransaction('正常提交')
  await bus.dispatch('test.add', { delta: 2 })
  await bus.dispatch('test.add', { delta: 3 })
  const merged = bus.commitTransaction()
  assert.equal(count, 5)
  assert.deepEqual(merged.nodesUpdated, ['n1'])
  assert.equal(undoSteps.length, 1)
  assert.equal(undoSteps[0].before, 0)
})

test('PathGuard: 仅允许已授权工程与用户库目录', () => {
  const projectDir = path.resolve('e:/Temp/MyGame')
  const libDir = path.resolve('e:/Temp/UserData/T3D')
  const guard = new PathGuard([libDir])
  guard.authorizeRoot(projectDir)

  assert.equal(guard.isAllowed(path.join(projectDir, 'scripts/patrol.ts')), true)
  assert.equal(guard.isAllowed(path.join(libDir, 'library/packs/rts.zip')), true)
  assert.equal(guard.isAllowed(path.join(projectDir, '../OtherProject/secret.txt')), false)
  assert.equal(guard.isAllowed(path.resolve('C:/Windows/System32/drivers/etc/hosts')), false)
  assert.throws(() => guard.assertAllowed(path.resolve('C:/Windows/win.ini')))
})
