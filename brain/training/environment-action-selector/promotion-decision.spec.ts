import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { compareEnvironmentSpecialistReports } from '@metahuman/core'
import { replaceStartupAdapter, withTrainingGpuCapacity } from './serve-promotion.js'

function report() {
  return {
    owner: 'environment-action-selector', specialist: 'task' as const, split: 'evaluation',
    coverage: { expected: 20, recordsDigest: 'frozen-cases' },
    providers: ['transformers'], devices: ['cuda:0'], batchSizes: [4],
    aggregate: { total: 20, coreValid: { count: 19 }, acceptableRouting: { count: 15 },
      missedPhysicalActions: 1, unsafeActionAuthorityErrors: 0, wrongPhysicalActions: 1,
      falseCompletions: 0, p95LatencyMs: 100 },
  }
}

test('promotion requires a measured improvement without validity or physical-action regression', () => {
  const current = report()
  const improved = report()
  improved.aggregate.acceptableRouting.count = 16
  assert.equal(compareEnvironmentSpecialistReports(current, improved).promote, true)
  improved.aggregate.missedPhysicalActions = 2
  assert.equal(compareEnvironmentSpecialistReports(current, improved).promote, false)
  improved.aggregate.missedPhysicalActions = 1
  improved.aggregate.acceptableRouting.count = 15
  improved.aggregate.p95LatencyMs = 90
  assert.equal(compareEnvironmentSpecialistReports(current, improved).promote, true)
  improved.devices = ['cpu']
  assert.throws(() => compareEnvironmentSpecialistReports(current, improved), /not comparable/)
})

test('service rewrite changes only one LoRA while preserving the other adapter and server options', () => {
  const unit = '[Service]\nExecStart=/repo/llama-server --model /base.gguf --lora-scaled /old-intent.gguf:0,/task.gguf:0 --port 8081\n'
  assert.equal(replaceStartupAdapter(unit, '/old-intent.gguf', '/new-intent.gguf'),
    '[Service]\nExecStart=/repo/llama-server --model /base.gguf --lora-scaled /new-intent.gguf:0,/task.gguf:0 --port 8081\n')
  assert.throws(() => replaceStartupAdapter(unit, '/missing.gguf', '/new.gguf'), /zero or multiple/)
})

test('manual GPU training restores the prior service activity after a failed fit', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-training-services-'))
  const oldPath = process.env.PATH
  const oldLog = process.env.TRAINING_TEST_LOG
  const log = path.join(directory, 'systemctl.log')
  fs.writeFileSync(path.join(directory, 'systemctl'), [
    '#!/bin/sh',
    'if [ "$2" = "is-active" ]; then',
    '  if [ "$3" = "llama-cpp-environment-2b.service" ] && [ -f "$TRAINING_TEST_LOG.inactive" ]; then echo inactive; exit 3; fi',
    '  echo active; exit 0;',
    'fi',
    'shift; echo "$*" >> "$TRAINING_TEST_LOG"',
  ].join('\n'), { mode: 0o755 })
  process.env.PATH = `${directory}:${oldPath}`
  process.env.TRAINING_TEST_LOG = log
  try {
    await assert.rejects(() => withTrainingGpuCapacity(async () => {
      fs.appendFileSync(log, 'fit attempted\n')
      throw new Error('fit failed')
    }), /fit failed/)
    assert.deepEqual(fs.readFileSync(log, 'utf8').trim().split('\n'), [
      'stop llama-cpp.service llama-cpp-environment-intent.service llama-cpp-environment-2b.service',
      'fit attempted',
      'start llama-cpp.service llama-cpp-environment-intent.service llama-cpp-environment-2b.service',
    ])
    fs.writeFileSync(`${log}.inactive`, '')
    fs.writeFileSync(log, '')
    await withTrainingGpuCapacity(async () => { fs.appendFileSync(log, 'fit completed\n') })
    assert.deepEqual(fs.readFileSync(log, 'utf8').trim().split('\n'), [
      'stop llama-cpp.service llama-cpp-environment-intent.service',
      'fit completed',
      'start llama-cpp.service llama-cpp-environment-intent.service',
    ], 'an inactive optional 2B service must not be started after training')
  } finally {
    process.env.PATH = oldPath
    if (oldLog === undefined) delete process.env.TRAINING_TEST_LOG
    else process.env.TRAINING_TEST_LOG = oldLog
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('2B activation and rollback touch only its existing service and preserve the paired adapter', async () => {
  const { activateReviewedLora } = await import('./serve-promotion.js')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'specialist-promotion-'))
  const originalPath = process.env.PATH
  const originalConfig = process.env.XDG_CONFIG_HOME
  const originalFetch = globalThis.fetch
  const log = path.join(directory, 'calls')
  const unitPath = path.join(directory, 'systemd/user/llama-cpp-environment-2b.service')
  const unit = '[Service]\nExecStart=server --lora-scaled /old.gguf:0,/paired.gguf:0 --port 8086\n'
  fs.mkdirSync(path.dirname(unitPath), { recursive: true })
  fs.writeFileSync(unitPath, unit)
  fs.writeFileSync(path.join(directory, 'systemctl'), `#!/bin/sh\necho "$*" >> '${log}'\n`, { mode: 0o755 })
  process.env.PATH = `${directory}:${originalPath}`
  process.env.XDG_CONFIG_HOME = directory
  globalThis.fetch = async () => new Response(JSON.stringify([{ path: fs.readFileSync(unitPath, 'utf8').includes('/new.gguf') ? '/new.gguf' : '/old.gguf' }]))
  try {
    const input = { baseModel: 'unsloth/Qwen3.5-2B', previousPath: '/old.gguf', nextPath: '/new.gguf', endpoint: 'http://fixture:8086' }
    await assert.rejects(activateReviewedLora({ ...input, commit: async () => { throw new Error('commit failed') } }), /commit failed/)
    assert.equal(fs.readFileSync(unitPath, 'utf8'), unit)
    assert.equal(await activateReviewedLora({ ...input, commit: async () => 'committed' }), 'committed')
    assert.equal(fs.readFileSync(unitPath, 'utf8'), unit.replace('/old.gguf', '/new.gguf'))
    assert.deepEqual(fs.readFileSync(log, 'utf8').trim().split('\n'), Array.from({ length: 3 }, () => ['--user daemon-reload', '--user restart llama-cpp-environment-2b.service']).flat())
  } finally {
    globalThis.fetch = originalFetch
    process.env.PATH = originalPath
    if (originalConfig === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = originalConfig
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
