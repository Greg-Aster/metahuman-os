/**
 * Fine-Tune Trainer - RunPod Wrapper for Full Fine-Tuning
 *
 * Reuses existing lora-trainer.ts infrastructure but adapts it for full fine-tuning:
 * - Uploads fine_tune_dataset.jsonl instead of unsloth_dataset.jsonl
 * - Uploads train_full_finetune.py instead of train_unsloth.py
 * - Uses fine-tune-config.json
 * - Downloads full model instead of adapter
 */

import fs from 'node:fs';
import path from 'node:path';
import { systemPaths } from '../../packages/core/src/index.js';
import { runRemoteTraining } from './lora-trainer.js';

export interface RunFineTuneOptions {
  datasetPath: string;        // Path to fine_tune_dataset.jsonl
  baseModel: string;           // Base model to fine-tune
  runId: string;               // Unique run identifier
  outputDir: string;           // Output directory for model
  username: string;            // User profile
  modeFilter?: 'dual' | 'emulation' | 'agent';  // Cognitive mode for config selection
}

export interface RunFineTuneResult {
  success: boolean;
  pod_id: string | null;
  ssh_user: string | null;
  ssh_host: string | null;
  modelPath: string | null;
  error?: string;
}

/**
 * Run full fine-tuning on RunPod
 *
 * This wraps the existing lora-trainer infrastructure but swaps out:
 * - Dataset file name
 * - Training script
 * - Config file
 */
export async function runRemoteFineTune(
  options: RunFineTuneOptions
): Promise<RunFineTuneResult> {
  const now = new Date();
  const DATE_STR = now.toISOString().slice(0, 10); // 2025-11-21
  const TIME_STR = now.toISOString().slice(11, 19).replace(/:/g, ''); // 214500
  const RUN_LABEL = `${DATE_STR}-${TIME_STR}-${options.runId.slice(0, 6)}`;

  // Create work directory structure (matching lora-trainer expectations)
  const WORK_LOCAL = path.join(systemPaths.root, 'metahuman-runs', options.username, DATE_STR, RUN_LABEL);
  const OUT_ROOT = options.outputDir;
  const FINAL_MODEL_DIR = path.join(OUT_ROOT, 'model');

  fs.mkdirSync(WORK_LOCAL, { recursive: true });
  fs.mkdirSync(FINAL_MODEL_DIR, { recursive: true });

  // Copy dataset to expected location (lora-trainer expects unsloth_dataset.jsonl)
  const CLEAN_DATA_FILE = path.join(WORK_LOCAL, 'unsloth_dataset.jsonl');
  fs.copyFileSync(options.datasetPath, CLEAN_DATA_FILE);
  console.log(`[fine-tune-trainer] Copied dataset: ${options.datasetPath} → ${CLEAN_DATA_FILE}`);

  // Load or create config file
  const CONFIG_FILE = path.join(WORK_LOCAL, 'config.json');

  let config: any = {
    base_model: options.baseModel,
    training_mode: 'full_finetune',
    learning_rate: 5e-6,
    num_train_epochs: 3,
    per_device_train_batch_size: 1,
    gradient_accumulation_steps: 32,
    max_seq_length: 2048,
  };

  // Load config: priority order is mode-specific → general → defaults
  let configLoaded = false;

  // 1. Try mode-specific config if mode filter is provided
  if (options.modeFilter) {
    const modeConfigPath = path.join(systemPaths.etc, 'modes', `${options.modeFilter}-config.json`);
    if (fs.existsSync(modeConfigPath)) {
      try {
        const loadedConfig = JSON.parse(fs.readFileSync(modeConfigPath, 'utf-8'));
        const { comment, notes, dataset_requirements, ...trainingParams } = loadedConfig;
        config = { ...config, ...trainingParams };
        console.log(`[fine-tune-trainer] Loaded mode-specific config: ${options.modeFilter}-config.json`);
        configLoaded = true;
      } catch (error) {
        console.warn(`[fine-tune-trainer] Failed to load mode config: ${(error as Error).message}`);
      }
    }
  }

  // 2. Fall back to general fine-tune config
  if (!configLoaded) {
    const fineTuneConfigPath = path.join(systemPaths.etc, 'fine-tune-config.json');
    if (fs.existsSync(fineTuneConfigPath)) {
      try {
        const loadedConfig = JSON.parse(fs.readFileSync(fineTuneConfigPath, 'utf-8'));
        const { comment, notes, dataset_requirements, ...trainingParams } = loadedConfig;
        config = { ...config, ...trainingParams };
        console.log(`[fine-tune-trainer] Loaded general config from fine-tune-config.json`);
      } catch (error) {
        console.warn(`[fine-tune-trainer] Failed to load fine-tune config: ${(error as Error).message}`);
      }
    }
  }

  // Override base model
  config.base_model = options.baseModel;

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));

  // Count samples for summary
  const datasetContent = fs.readFileSync(CLEAN_DATA_FILE, 'utf-8');
  const samples_used = datasetContent.split('\n').filter(Boolean).length;

  console.log(`[fine-tune-trainer] Starting RunPod full fine-tuning`);
  if (options.modeFilter) {
    console.log(`[fine-tune-trainer] Cognitive mode: ${options.modeFilter}`);
  }
  console.log(`[fine-tune-trainer] Base model: ${config.base_model}`);
  console.log(`[fine-tune-trainer] Samples: ${samples_used}`);
  console.log(`[fine-tune-trainer] Run: ${RUN_LABEL}`);

  // Create temporary RAW_DATA_FILE (lora-trainer expects this)
  const RAW_DATA_FILE = path.join(OUT_ROOT, `${RUN_LABEL}.jsonl`);
  fs.copyFileSync(CLEAN_DATA_FILE, RAW_DATA_FILE);

  const SUMMARY_FILE = path.join(WORK_LOCAL, 'run-summary.json');

  try {
    // Call existing lora-trainer infrastructure
    const result = await runRemoteTraining({
      DATE_STR,
      RUN_LABEL,
      run_id: options.runId,
      WORK_LOCAL,
      OUT_ROOT,
      FINAL_ADAPTER_DIR: FINAL_MODEL_DIR, // Reuse ADAPTER_DIR for model output
      RAW_DATA_FILE,
      CLEAN_DATA_FILE,
      CONFIG_FILE,
      SUMMARY_FILE,
      samples_used,
    });

    console.log(`[fine-tune-trainer] Training result: success=${result.training_success}`);

    if (!result.training_success) {
      return {
        success: false,
        pod_id: result.pod_id,
        ssh_user: result.ssh_user,
        ssh_host: result.ssh_host,
        modelPath: null,
        error: 'Training failed on RunPod',
      };
    }

    // Check if model was downloaded
    const modelPath = path.join(FINAL_MODEL_DIR, 'model.safetensors');
    const ggufPath = path.join(OUT_ROOT, 'model.gguf');

    if (fs.existsSync(modelPath) || fs.existsSync(ggufPath)) {
      return {
        success: true,
        pod_id: result.pod_id,
        ssh_user: result.ssh_user,
        ssh_host: result.ssh_host,
        modelPath: fs.existsSync(ggufPath) ? ggufPath : modelPath,
      };
    } else {
      return {
        success: false,
        pod_id: result.pod_id,
        ssh_user: result.ssh_user,
        ssh_host: result.ssh_host,
        modelPath: null,
        error: 'Model files not found after training',
      };
    }
  } catch (error) {
    console.error(`[fine-tune-trainer] Error:`, error);
    return {
      success: false,
      pod_id: null,
      ssh_user: null,
      ssh_host: null,
      modelPath: null,
      error: (error as Error).message,
    };
  }
}
