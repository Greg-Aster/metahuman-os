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
} from './training-automation.js'
import type { TrainingDatasetInspection } from './training-dataset.js'

function inspection(overrides: Partial<TrainingDatasetInspection['stats']> = {}): TrainingDatasetInspection {
  const stats = {
    totalMemories: 300,
    episodicMemories: 300,
    therapySessions: 0,
    chatConversations: 0,
    recentMemories: 300,
    oldestMemory: null,
    newestMemory: null,
    cognitiveModeCounts: { dual: 0, agent: 0, emulation: 0, environment: 300 },
    organizedMemories: 300,
    pendingOrganization: 0,
    curatedMemories: 300,
    pendingCuration: 0,
    curatedRecords: 300,
    validCuratedRecords: 300,
    invalidCuratedRecords: 0,
    trainableSamples: 300,
    estimatedTrainingSamples: 300,
    latestCuratedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  }
  return {
    stats,
    trainableCuratedAt: Array.from({ length: stats.trainableSamples }, () => '2026-01-02T00:00:00.000Z'),
  }
}

test('automatic training is disabled by default and validates target-method pairing', () => {
  assert.equal(parseAutomaticTrainingConfig(undefined).enabled, false)
  assert.throws(
    () => parseAutomaticTrainingConfig({ ...DEFAULT_AUTOMATIC_TRAINING_CONFIG, method: 'local-lora', trainingTarget: 'vllm' }),
    /vLLM artifacts require remote LoRA training/,
  )
  assert.throws(
    () => parseAutomaticTrainingConfig({ ...DEFAULT_AUTOMATIC_TRAINING_CONFIG, learningRate: 0 }),
    /learning_rate/,
  )
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
  const ready = evaluateAutomaticTrainingReadiness(config, inspection(), [], [], false, Date.parse('2026-01-03T00:00:00.000Z'))
  assert.equal(ready.eligible, true)

  const blocked = evaluateAutomaticTrainingReadiness(
    config,
    inspection({ pendingOrganization: 2, pendingCuration: 3, invalidCuratedRecords: 1 }),
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
  const data = inspection()
  data.trainableCuratedAt = Array.from({ length: 300 }, (_, index) => (
    index < 20 ? '2026-01-02T00:00:00.000Z' : '2025-12-01T00:00:00.000Z'
  ))
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
    enablePreprocessing: false,
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
