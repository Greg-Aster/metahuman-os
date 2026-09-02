import type { TrainingLaunchConfig } from '@metahuman/core'

/** Apply only supported profile controls to the full-fine-tune engine config. */
export function applyFineTuneLaunchConfig(
  engineConfig: Record<string, unknown>,
  launchConfig: TrainingLaunchConfig,
  baseModel: string,
): Record<string, unknown> {
  const existingGguf = engineConfig.gguf_conversion
  const ggufConversion = existingGguf && typeof existingGguf === 'object' && !Array.isArray(existingGguf)
    ? existingGguf as Record<string, unknown>
    : {}

  return {
    ...engineConfig,
    base_model: baseModel,
    training_mode: 'full_finetune',
    learning_rate: launchConfig.learning_rate,
    num_train_epochs: launchConfig.num_train_epochs,
    per_device_train_batch_size: launchConfig.per_device_train_batch_size,
    gradient_accumulation_steps: launchConfig.gradient_accumulation_steps,
    max_seq_length: launchConfig.max_seq_length,
    gguf_conversion: {
      ...ggufConversion,
      enabled: launchConfig.skipGguf !== true,
      quantization_type: launchConfig.quantization,
    },
  }
}
