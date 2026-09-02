import assert from 'node:assert/strict'
import test from 'node:test'

import { applyFineTuneLaunchConfig } from './fine-tune-config.js'

test('full fine-tune config honors the shared launch hyperparameters', () => {
  const config = applyFineTuneLaunchConfig({
    training_mode: 'lora',
    optim: 'adafactor',
    gguf_conversion: { intermediate_type: 'f16' },
  }, {
    base_model: 'ignored/profile-model',
    num_train_epochs: 7,
    max_samples: 5000,
    lora_rank: 0,
    lora_alpha: 0,
    learning_rate: 0.00001,
    per_device_train_batch_size: 2,
    gradient_accumulation_steps: 24,
    max_seq_length: 4096,
    quantization: 'Q5_K_M',
    skipGguf: false,
  }, 'explicit/base-model')

  assert.equal(config.training_mode, 'full_finetune')
  assert.equal(config.base_model, 'explicit/base-model')
  assert.equal(config.num_train_epochs, 7)
  assert.equal(config.learning_rate, 0.00001)
  assert.equal(config.per_device_train_batch_size, 2)
  assert.equal(config.gradient_accumulation_steps, 24)
  assert.equal(config.max_seq_length, 4096)
  assert.equal(config.optim, 'adafactor')
  assert.deepEqual(config.gguf_conversion, {
    intermediate_type: 'f16',
    enabled: true,
    quantization_type: 'Q5_K_M',
  })
})
