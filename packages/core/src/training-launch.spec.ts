import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildTrainingEnvironmentOverrides,
  buildTrainingEngineConfig,
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

test('remote training requires credentials; local safetensors uses the shared trainer', () => {
  assert.match(validateTrainingLaunchRequest({
    method: 'remote-lora',
    trainingTarget: 'vllm',
    trainingConfig: config,
  }) || '', /RunPod/)

  assert.equal(validateTrainingLaunchRequest({
    method: 'local-lora',
    trainingTarget: 'vllm',
    trainingConfig: config,
  }), null)
})

test('LoRA alpha is part of the launch contract', () => {
  assert.match(validateTrainingLaunchConfig({ ...config, lora_alpha: undefined }) || '', /lora_alpha/)
})

test('transport environment carries explicit pipeline and RunPod controls', () => {
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
  })

  assert.deepEqual(overrides, {
    METAHUMAN_DISABLE_S3: '1',
    METAHUMAN_SKIP_PREPROCESSING: '1',
    RUNPOD_GPU_TYPE: 'NVIDIA A100 80GB PCIe',
    RUNPOD_API_KEY: 'secret',
    RUNPOD_TEMPLATE_ID: 'template-custom',
  })
})

test('all-samples and persona choices are frozen in the engine config without environment defaults', () => {
  const overrides = buildTrainingEnvironmentOverrides({
    method: 'local-lora',
    trainingTarget: 'ollama',
    trainingConfig: { ...config, max_samples: null },
  })

  assert.equal(overrides.METAHUMAN_DISABLE_S3, '1')
  assert.equal(overrides.METAHUMAN_SKIP_PREPROCESSING, '0')
  const frozen = buildTrainingEngineConfig({ method: 'local-lora', trainingTarget: 'vllm',
    trainingConfig: { ...config, max_samples: null, monthly_training: true, days_recent: 30, old_samples: 250 } },
  { data: { includePersona: false, objective: 'assistant-continuation' } })
  assert.equal(frozen.max_samples, null)
  assert.equal(frozen.days_recent, 30)
  assert.equal(frozen.old_samples, 250)
  assert.equal((frozen.data as Record<string, unknown>).includePersona, false)
  assert.equal((frozen.data as Record<string, unknown>).objective, 'assistant-continuation')
  assert.deepEqual(frozen.gguf_conversion, { enabled: false, quantization_type: 'Q4_K_M' })
  assert.equal(frozen.chat_template, 'native')
  assert.equal(frozen.train_on_responses_only, true)
})

test('one engine config preserves selected hyperparameters for LoRA and full fine-tuning', () => {
  for (const method of ['local-lora', 'remote-lora', 'fine-tune'] as const) {
    const frozen = buildTrainingEngineConfig({ method, trainingTarget: 'ollama',
      runpodConfig: { apiKey: 'fixture', templateId: 'fixture', gpuType: 'selected GPU' },
      trainingConfig: { ...config, num_train_epochs: 1, learning_rate: 0.00002, quantization: 'Q8_0' } }, {})
    assert.equal(frozen.training_mode, method === 'fine-tune' ? 'full_finetune' : 'lora')
    assert.equal(frozen.num_train_epochs, 1)
    assert.equal(frozen.learning_rate, 0.00002)
    assert.equal(frozen.load_in_4bit, false)
    assert.equal(frozen.load_in_16bit, true)
    assert.deepEqual(frozen.gguf_conversion, { enabled: true, quantization_type: 'Q8_0' })
  }
  assert.match(validateTrainingLaunchRequest({ method: 'local-lora', trainingConfig: { ...config, lora_rank: 0 } }) ?? '', /positive/)
  assert.match(validateTrainingLaunchRequest({ method: 'fine-tune', trainingConfig: { ...config, load_in_4bit: true } }) ?? '', /unquantized/)
})
