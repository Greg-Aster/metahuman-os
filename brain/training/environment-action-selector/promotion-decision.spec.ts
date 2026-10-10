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
    'if [ "$2" = "is-active" ]; then echo active; exit 0; fi',
    'echo "$2 $3 $4" >> "$TRAINING_TEST_LOG"',
  ].join('\n'), { mode: 0o755 })
  process.env.PATH = `${directory}:${oldPath}`
  process.env.TRAINING_TEST_LOG = log
  try {
    await assert.rejects(() => withTrainingGpuCapacity(async () => {
      fs.appendFileSync(log, 'fit attempted\n')
      throw new Error('fit failed')
    }), /fit failed/)
    assert.deepEqual(fs.readFileSync(log, 'utf8').trim().split('\n'), [
      'stop llama-cpp.service llama-cpp-environment-intent.service',
      'fit attempted',
      'start llama-cpp.service llama-cpp-environment-intent.service',
    ])
  } finally {
    process.env.PATH = oldPath
    if (oldLog === undefined) delete process.env.TRAINING_TEST_LOG
    else process.env.TRAINING_TEST_LOG = oldLog
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
