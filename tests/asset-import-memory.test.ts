// 大体积/大量资产导入：流式 tar 索引、按需读取的扫描器、显存预算、加载失败闸门
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { PackageArchiveSessions, TarIndexer } from '../electron/services/packageArchive'
import { scanPackageArchive, type PackageArchiveEntrySource } from '../src/editor/assets/package/packageAssetScanner'
import { canRestoreDegraded, chooseMipSkip, estimateRgbaBytes } from '../src/editor/assets/memoryBudget'
import { createLoadFailureGate, setLoadFailureReporter } from '../src/editor/assets/loadFailures'
import { packBc7Artifact, trimBc7ArtifactToMaxSize, unpackBc7Artifact } from '../src/runtime/engine/bc7'

function tarHeader(name: string, size: number, type = '0'): Buffer {
  const header = Buffer.alloc(512)
  header.write(name, 0, 100, 'utf-8')
  header.write('0000644\0', 100)
  header.write('0000000\0', 108)
  header.write('0000000\0', 116)
  header.write(`${size.toString(8).padStart(11, '0')}\0`, 124)
  header.write('00000000000\0', 136)
  header.write('        ', 148)
  header.write(type, 156)
  let sum = 0
  for (const byte of header) sum += byte
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148)
  return header
}

function tarFile(name: string, content: Buffer | string, type = '0'): Buffer {
  const body = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content
  const pad = (512 - (body.length % 512)) % 512
  return Buffer.concat([tarHeader(name, body.length, type), body, Buffer.alloc(pad)])
}

function buildTar(files: Array<{ name: string, content: Buffer | string, type?: string }>): Buffer {
  return Buffer.concat([...files.map(file => tarFile(file.name, file.content, file.type)), Buffer.alloc(1024)])
}

function unityRecord(guid: string, pathname: string, asset: Buffer | string, meta = `guid: ${guid}\n`) {
  return [
    { name: `${guid}/asset`, content: asset },
    { name: `${guid}/asset.meta`, content: meta },
    { name: `${guid}/pathname`, content: pathname },
  ]
}

const fbxBytes = Buffer.alloc(3000, 7)
const pngBytes = Buffer.alloc(1500, 9)
const matText = '%YAML 1.1\nMaterial:\n  m_Name: Stone\n'
const sampleTar = buildTar([
  ...unityRecord('aaaa0001', 'Assets/Models/Rock.fbx', fbxBytes),
  ...unityRecord('aaaa0002', 'Assets/Models/Rock_Albedo.png', pngBytes),
  ...unityRecord('aaaa0003', 'Assets/Materials/Stone.mat', matText),
])

test('tar 索引：任意分块喂入都能得到相同的偏移和大小，只把元数据读进内存', () => {
  const inlineLeaf = (entryPath: string) => entryPath.endsWith('/pathname') || entryPath.endsWith('/asset.meta')
  for (const chunkSize of [1, 7, 511, 512, 513, 4096, sampleTar.length]) {
    const indexer = new TarIndexer(inlineLeaf)
    for (let offset = 0; offset < sampleTar.length; offset += chunkSize) {
      indexer.write(sampleTar.subarray(offset, offset + chunkSize))
    }
    indexer.finish()
    assert.equal(indexer.entries.length, 9, `分块 ${chunkSize}`)
    const asset = indexer.entries.find(entry => entry.path === 'aaaa0001/asset')!
    assert.equal(asset.size, fbxBytes.length)
    assert.equal(asset.inline, undefined, '大文件本体不应读进内存')
    assert.deepEqual(sampleTar.subarray(asset.offset, asset.offset + asset.size), fbxBytes)
    const pathname = indexer.entries.find(entry => entry.path === 'aaaa0001/pathname')!
    assert.equal(Buffer.from(pathname.inline!).toString('utf-8'), 'Assets/Models/Rock.fbx')
  }
})

test('tar 索引：支持 GNU 长文件名，截断的包会报错', () => {
  const longName = `${'deep/'.repeat(30)}file.bin`
  const tar = buildTar([
    { name: '././@LongLink', content: `${longName}\0`, type: 'L' },
    { name: 'short', content: Buffer.alloc(10, 1) },
  ])
  const indexer = new TarIndexer()
  indexer.write(tar)
  indexer.finish()
  assert.equal(indexer.entries.length, 1)
  assert.equal(indexer.entries[0]!.path, longName)

  const truncated = new TarIndexer()
  truncated.write(sampleTar.subarray(0, 700))
  assert.throws(() => truncated.finish(), /截断/)
})

test('资源包会话：流式解压到临时文件，按偏移读取，关闭后清理', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't3d-pkg-test-'))
  const staging = path.join(dir, 'staging')
  const pkgPath = path.join(dir, 'sample.unitypackage')
  fs.writeFileSync(pkgPath, zlib.gzipSync(sampleTar))
  const sessions = new PackageArchiveSessions(staging)
  try {
    const progress: number[] = []
    const opened = await sessions.open('session_one', pkgPath, done => progress.push(done))
    assert.equal(opened.tarBytes, sampleTar.length)
    assert.ok(progress.length > 0)
    assert.equal(fs.readdirSync(staging).length, 1, '解压出的 tar 应落在临时目录')
    const asset = opened.entries.find(entry => entry.path === 'aaaa0002/asset')!
    const bytes = Buffer.from(await sessions.read('session_one', asset.offset, asset.size))
    assert.deepEqual(bytes, pngBytes)
    await assert.rejects(sessions.read('session_one', opened.tarBytes - 10, 100), /越界/)
    await sessions.close('session_one')
    assert.equal(fs.readdirSync(staging).length, 0, '关闭会话后临时文件应被删除')
    await assert.rejects(sessions.read('session_one', 0, 10), /已关闭/)

    await assert.rejects(sessions.open('session_two', path.join(dir, 'sample.zip')), /unitypackage/)
    const broken = path.join(dir, 'broken.unitypackage')
    fs.writeFileSync(broken, zlib.gzipSync(sampleTar).subarray(0, 60))
    await assert.rejects(sessions.open('session_three', broken))
    assert.equal(fs.readdirSync(staging).length, 0, '打开失败也不应留下临时文件')
  } finally {
    sessions.closeAllSync()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('扫描器：模型和贴图本体在扫描阶段一次都不读，材质文本提前读好', async () => {
  const indexer = new TarIndexer((entryPath: string) => entryPath.endsWith('/pathname') || entryPath.endsWith('/asset.meta'))
  indexer.write(sampleTar)
  indexer.finish()
  const reads: string[] = []
  const sources: PackageArchiveEntrySource[] = indexer.entries.map(entry => ({
    path: entry.path,
    type: entry.type,
    size: entry.size,
    inline: entry.inline,
    read: async () => {
      reads.push(entry.path)
      return new Uint8Array(sampleTar.subarray(entry.offset, entry.offset + entry.size))
    },
  }))
  const result = await scanPackageArchive(sources)
  assert.deepEqual(result.entries.map(entry => entry.kind).sort(), ['material', 'model', 'texture'])
  assert.deepEqual(reads, ['aaaa0003/asset'], '扫描阶段只应读材质文本')

  const model = result.entries.find(entry => entry.kind === 'model')!
  assert.equal(model.assetBytes, undefined)
  assert.equal(model.sizeBytes, fbxBytes.length)
  assert.equal(model.companionFiles.length, 1, '同目录贴图应登记为伴随文件')
  assert.deepEqual(Buffer.from(await model.readAsset()), fbxBytes)
  assert.deepEqual(Buffer.from(await model.companionFiles[0]!.read()), pngBytes)

  const material = result.entries.find(entry => entry.kind === 'material')!
  assert.equal(new TextDecoder().decode(material.assetBytes), matText)
})

test('显存预算：超预算才降级，降级后的基准级必须是 4 的倍数且不小于 256', () => {
  const levels = [2048, 1024, 512, 256, 128].map(size => ({ width: size, height: size }))
  const budget = 1000
  assert.equal(chooseMipSkip(500, budget, levels), 0)
  assert.equal(chooseMipSkip(999, budget, levels), 0)
  assert.equal(chooseMipSkip(1000, budget, levels), 1)
  assert.equal(chooseMipSkip(1300, budget, levels), 2)
  // 512 的贴图最多降到 256
  assert.equal(chooseMipSkip(5000, budget, levels.slice(2)), 1)
  // 256 的贴图不再降
  assert.equal(chooseMipSkip(5000, budget, levels.slice(3)), 0)
  // 下一级宽高不是 4 的倍数时不降
  assert.equal(chooseMipSkip(5000, budget, [{ width: 1020, height: 1020 }, { width: 510, height: 510 }]), 0)

  assert.equal(estimateRgbaBytes(1024, 1024, false), 1024 * 1024 * 4)
  assert.equal(estimateRgbaBytes(1024, 1024, true), Math.round(1024 * 1024 * 4 * 4 / 3))

  // 恢复后要留 15% 余量：降了一级的贴图恢复后是原来的 4 倍
  assert.equal(canRestoreDegraded(400, 1000, [{ bytes: 100, skip: 1 }]), true)
  assert.equal(canRestoreDegraded(700, 1000, [{ bytes: 100, skip: 1 }]), false)
  assert.equal(canRestoreDegraded(100, 1000, []), false)
})

test('加载失败闸门：隔一段时间重试，连续三次后停止并只上报一次，内容变了重新来', () => {
  let now = 0
  const reports: string[] = []
  setLoadFailureReporter(info => reports.push(`${info.kind}:${info.name}`))
  const gate = createLoadFailureGate('贴图', () => now)
  assert.equal(gate.shouldTry('a', 'h1'), true)
  gate.fail('a', 'h1', '石头', new Error('坏文件'))
  assert.equal(gate.shouldTry('a', 'h1'), false, '刚失败不应立刻重试')
  now += 2000
  assert.equal(gate.shouldTry('a', 'h1'), true)
  gate.fail('a', 'h1', '石头', new Error('坏文件'))
  now += 8000
  assert.equal(gate.shouldTry('a', 'h1'), true)
  gate.fail('a', 'h1', '石头', new Error('坏文件'))
  now += 10 * 60 * 1000
  assert.equal(gate.shouldTry('a', 'h1'), false, '三次后不再自动重试')
  assert.deepEqual(reports, ['贴图:石头'])
  assert.deepEqual(gate.failed(), [{ assetId: 'a', message: '坏文件' }])
  assert.equal(gate.shouldTry('a', 'h2'), true, '内容变了应重新尝试')
  gate.fail('a', 'h2', '石头', new Error('坏文件'))
  gate.clear('a')
  assert.equal(gate.shouldTry('a', 'h2'), true)
  setLoadFailureReporter(null)
})

test('BC7 成品打包与导出尺寸裁剪：超上限时裁掉最高级，但基准级保持 4 的倍数', () => {
  const mips = [1024, 512, 256, 4, 2, 1].map(size => ({
    width: size,
    height: size,
    data: new Uint8Array(Math.max(1, size / 4) * Math.max(1, size / 4) * 16),
  }))
  const packed = packBc7Artifact(1024, 1024, mips)
  const unpacked = unpackBc7Artifact(packed)!
  assert.equal(unpacked.width, 1024)
  assert.equal(unpacked.mips.length, 6)

  const trimmed512 = unpackBc7Artifact(trimBc7ArtifactToMaxSize(packed, 512)!)!
  assert.equal(trimmed512.width, 512)
  assert.equal(trimmed512.mips.length, 5)

  // 即使上限设得很小，基准级也不会落到小于 4 的那两级
  const trimmedTiny = unpackBc7Artifact(trimBc7ArtifactToMaxSize(packed, 1)!)!
  assert.equal(trimmedTiny.width, 4)
  assert.equal(trimmedTiny.mips.length, 3)
})

