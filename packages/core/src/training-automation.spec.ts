import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { registerProfileStorageConfigGetter } from './path-builder.js'
import {
  DEFAULT_AUTOMATIC_TRAINING_CONFIG,
  automaticTrainingLaunchRequest,
  evaluateAutomaticTrainingReadiness,
  parseAutomaticTrainingConfig,
  saveAutomaticTrainingConfig,
  runAutomaticTrainingForSleep,
} from './training-automation.js'

function selection(count = 300, evaluation = 30) {
  return { train: Array.from({ length: count }, (_, index) => ({ id: 'sample-' + index })),
    evaluation: Array.from({ length: evaluation }, (_, index) => ({ id: 'eval-' + index })) }
}

test('automatic training is disabled by default and shares trainer target support', () => {
  assert.equal(parseAutomaticTrainingConfig(undefined).enabled, false)
  assert.equal(parseAutomaticTrainingConfig({ ...DEFAULT_AUTOMATIC_TRAINING_CONFIG, method: 'local-lora', trainingTarget: 'vllm' }).trainingTarget, 'vllm')
  assert.throws(
    () => parseAutomaticTrainingConfig({ ...DEFAULT_AUTOMATIC_TRAINING_CONFIG, learningRate: 0 }),
    /learning_rate/,
  )
})

test('Sleep admission requires the active owner, successful preparation, new data and one finite launch', async () => {
  const controller = new AbortController()
  const startedAt = '2026-09-09T01:00:00.000Z'
  const now = Date.parse('2026-09-09T01:10:00.000Z')
  const session = { id: 'sleep-fixture', username: 'fixture', state: 'running', currentStageId: 'train-personalization', startedAt,
    stages: [{ id: 'organize-memory', state: 'completed' }, { id: 'curate-memory', state: 'completed' }] }
  const input = { config: { ...DEFAULT_AUTOMATIC_TRAINING_CONFIG, enabled: true, maxRuntimeMinutes: 25 },
    selection: selection(), history: { assignments: {}, completedSampleIds: [] }, runs: [], runningProcesses: [], remoteCredentialsConfigured: false }
  let launches = 0
  let waits = 0
  const dependencies = {
    sleep: () => ({ currentSession: session }) as any,
    runtime: (username: string, cutoff?: number) => {
      assert.equal(username, 'fixture')
      assert.equal(cutoff, Date.parse(startedAt))
      return input as any
    },
    now: () => now,
    launch: (username: string, request: any, admission: any) => {
      launches++
      assert.equal(username, 'fixture')
      assert.equal(request.advancedSettings.enablePreprocessing, false)
      assert.deepEqual(admission, { sessionId: session.id, cutoff: startedAt, deadline: '2026-09-09T01:35:00.000Z' })
      return { success: true as const, status: 200 as const, pid: 123, runLabel: 'fixture-run', logFile: 'fixture.log', agentName: 'full-cycle-local' as const, message: 'started' }
    },
    wait: async (username: string, pid: number, label: string, signal: AbortSignal) => {
      waits++
      assert.deepEqual([username, pid, label, signal], ['fixture', 123, 'fixture-run', controller.signal])
    },
  }
  await assert.rejects(runAutomaticTrainingForSleep('other', session.id, controller.signal, dependencies), /active Sleep stage/)
  session.stages[1].state = 'failed'
  assert.equal((await runAutomaticTrainingForSleep('fixture', session.id, controller.signal, dependencies)).skipped, true)
  session.stages[1].state = 'completed'
  input.config.enabled = false
  assert.equal((await runAutomaticTrainingForSleep('fixture', session.id, controller.signal, dependencies)).skipped, true)
  assert.equal(launches, 0)
  input.config.enabled = true
  assert.deepEqual(await runAutomaticTrainingForSleep('fixture', session.id, controller.signal, dependencies), {
    trained: true, runLabel: 'fixture-run', activation: 'review-required',
  })
  assert.equal(launches, 1)
  assert.equal(waits, 1)
  await assert.rejects(runAutomaticTrainingForSleep('fixture', session.id, controller.signal, {
    ...dependencies, wait: async () => { throw new Error('worker cancelled after wake') },
  }), /worker cancelled after wake/)
  controller.abort(new Error('sleep was interrupted'))
  await assert.rejects(runAutomaticTrainingForSleep('fixture', session.id, controller.signal, dependencies), /sleep was interrupted/)
  assert.equal(launches, 2)
})

test('automatic policy persists in the shared profile training config without deleting manual settings', t => {
  const username = `automatic-training-${process.pid}`
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-automatic-training-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  registerProfileStorageConfigGetter(candidate => candidate === username
    ? { path: root, type: 'internal' }
    : undefined)
  fs.mkdirSync(path.join(root, 'etc'), { recursive: true })
  fs.writeFileSync(path.join(root, 'etc', 'training.json'), JSON.stringify({
    base_model: 'profile-model',
    data: { includePersona: true },
  }))

  const automatic = saveAutomaticTrainingConfig(
    username,
    { ...DEFAULT_AUTOMATIC_TRAINING_CONFIG, enabled: true },
    new Date('2026-01-03T00:00:00.000Z'),
  )
  const persisted = JSON.parse(fs.readFileSync(path.join(root, 'etc', 'training.json'), 'utf8'))
  assert.equal(automatic.updatedAt, '2026-01-03T00:00:00.000Z')
  assert.equal(persisted.base_model, 'profile-model')
  assert.deepEqual(persisted.data, { includePersona: true })
  assert.deepEqual(persisted.automatic, automatic)
})

test('readiness requires refined, valid, sufficiently new data', () => {
  const config = { ...DEFAULT_AUTOMATIC_TRAINING_CONFIG, enabled: true }
  const ready = evaluateAutomaticTrainingReadiness(config, selection(), [], [], false, Date.parse('2026-01-03T00:00:00.000Z'))
  assert.equal(ready.eligible, true)

  const blocked = evaluateAutomaticTrainingReadiness(
    config,
    selection(0, 0),
    [],
    [],
    false,
    Date.parse('2026-01-03T00:00:00.000Z'),
  )
  assert.equal(blocked.eligible, false)
  assert.equal(blocked.blockers.length, 3)
})

test('readiness enforces new-sample and cooldown thresholds after a completed run', () => {
  const config = { ...DEFAULT_AUTOMATIC_TRAINING_CONFIG, enabled: true }
  const data = selection()
  const readiness = evaluateAutomaticTrainingReadiness(
    config,
    data,
    [{
      startTime: '2026-01-01T00:00:00.000Z',
      endTime: '2026-01-01T01:00:00.000Z',
      status: 'completed',
    }],
    [],
    false,
    Date.parse('2026-01-02T00:00:00.000Z'),
    { assignments: {}, completedSampleIds: data.train.slice(0, 280).map(row => row.id) },
  )
  assert.equal(readiness.eligible, false)
  assert.equal(readiness.newSamplesSinceLastRun, 20)
  assert.match(readiness.blockers.join(' '), /more new samples/)
  assert.match(readiness.blockers.join(' '), /Cooldown/)
})

test('automatic policy maps every launch control into the shared training request', t => {
  const username = `automatic-launch-${process.pid}`
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-automatic-launch-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  registerProfileStorageConfigGetter(candidate => candidate === username
    ? { path: root, type: 'internal' }
    : undefined)
  fs.mkdirSync(path.join(root, 'etc'), { recursive: true })
  fs.writeFileSync(path.join(root, 'etc', 'runpod.json'), JSON.stringify({
    apiKey: 'saved-secret',
    templateId: 'manual-template',
    gpuType: 'manual-gpu',
  }))

  const configured = {
    ...DEFAULT_AUTOMATIC_TRAINING_CONFIG,
    method: 'remote-lora' as const,
    trainingTarget: 'vllm' as const,
    baseModel: 'custom/model',
    epochs: 9,
    maxSamples: null,
    useRollingWindow: true,
    recentDays: 45,
    olderSamples: 678,
    loraRank: 32,
    loraAlpha: 64,
    learningRate: 0.0001,
    batchSize: 2,
    gradientAccumulationSteps: 12,
    maxSequenceLength: 4096,
    quantization: 'Q5_K_M',
    runpodTemplateId: 'automatic-template',
    runpodGpuType: 'automatic-gpu',
    enableS3Upload: true,
  }
  const request = automaticTrainingLaunchRequest(username, configured)

  assert.deepEqual(request.runpodConfig, {
    apiKey: 'saved-secret',
    templateId: 'automatic-template',
    gpuType: 'automatic-gpu',
  })
  assert.deepEqual(request.trainingConfig, {
    base_model: 'custom/model',
    num_train_epochs: 9,
    max_samples: null,
    monthly_training: true,
    days_recent: 45,
    old_samples: 678,
    lora_rank: 32,
    lora_alpha: 64,
    learning_rate: 0.0001,
    per_device_train_batch_size: 2,
    gradient_accumulation_steps: 12,
    max_seq_length: 4096,
    quantization: 'Q5_K_M',
    skipGguf: true,
  })
  assert.deepEqual(request.advancedSettings, {
    enablePreprocessing: false,
    enableS3Upload: true,
  })
})
