import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildTrainingEnvironmentOverrides,
  validateTrainingLaunchConfig,
  validateTrainingLaunchRequest,
  type TrainingLaunchConfig,
} from './training-launch.js'

const config: TrainingLaunchConfig = {
  base_model: 'Qwen/Qwen3.5-9B',
  num_train_epochs: 2,
  max_samples: 3000,
  lora_rank: 16,
  lora_alpha: 32,
  learning_rate: 0.0003,
  per_device_train_batch_size: 1,
  gradient_accumulation_steps: 16,
  max_seq_length: 2048,
  quantization: 'Q4_K_M',
}

test('current manual launch configuration passes the canonical validator', () => {
  assert.equal(validateTrainingLaunchConfig(config), null)
  assert.equal(validateTrainingLaunchRequest({
    method: 'local-lora',
    trainingTarget: 'ollama',
    trainingConfig: config,
  }), null)
})

test('remote training requires credentials and vLLM requires remote LoRA', () => {
  assert.match(validateTrainingLaunchRequest({
    method: 'remote-lora',
    trainingTarget: 'vllm',
    trainingConfig: config,
  }) || '', /RunPod/)

  assert.match(validateTrainingLaunchRequest({
    method: 'local-lora',
    trainingTarget: 'vllm',
    trainingConfig: config,
  }) || '', /remote LoRA/)
})

test('LoRA alpha is part of the launch contract', () => {
  assert.match(validateTrainingLaunchConfig({ ...config, lora_alpha: undefined }) || '', /lora_alpha/)
})

test('shared launch environment carries dataset, pipeline, persona, and RunPod controls', () => {
  const overrides = buildTrainingEnvironmentOverrides({
    method: 'remote-lora',
    trainingTarget: 'ollama',
    runpodConfig: {
      apiKey: 'secret',
      templateId: 'template-custom',
      gpuType: 'NVIDIA A100 80GB PCIe',
    },
    trainingConfig: { ...config, max_samples: 4321 },
    advancedSettings: {
      enablePreprocessing: false,
      enableS3Upload: false,
    },
  }, false)

  assert.deepEqual(overrides, {
    METAHUMAN_INCLUDE_PERSONA: '0',
    METAHUMAN_BASE_MODEL: 'Qwen/Qwen3.5-9B',
    METAHUMAN_MAX_SAMPLES: '4321',
    METAHUMAN_DISABLE_S3: '1',
    METAHUMAN_SKIP_PREPROCESSING: '1',
    RUNPOD_GPU_TYPE: 'NVIDIA A100 80GB PCIe',
    RUNPOD_API_KEY: 'secret',
    RUNPOD_TEMPLATE_ID: 'template-custom',
  })
})

test('all-samples launch clears inherited per-run restrictions', () => {
  const overrides = buildTrainingEnvironmentOverrides({
    method: 'local-lora',
    trainingTarget: 'ollama',
    trainingConfig: { ...config, max_samples: null },
  }, true)

  assert.equal(overrides.METAHUMAN_INCLUDE_PERSONA, '1')
  assert.equal(overrides.METAHUMAN_BASE_MODEL, 'Qwen/Qwen3.5-9B')
  assert.equal(overrides.METAHUMAN_MAX_SAMPLES, '')
  assert.equal(overrides.METAHUMAN_DISABLE_S3, '0')
  assert.equal(overrides.METAHUMAN_SKIP_PREPROCESSING, '0')
})
