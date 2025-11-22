/**
 * Fine-Tune Cycle Orchestrator
 *
 * Coordinates the full fine-tuning pipeline:
 * 1. Curate memories (clean, assign modes)
 * 2. Format samples (apply mode tags)
 * 3. Apply schema (model-family wrappers)
 * 4. Export JSONL (training dataset)
 * 5. Validate dataset
 * 6. Run remote fine-tuning (RunPod)
 * 7. Load fine-tuned model to Ollama
 *
 * Usage:
 *   tsx brain/agents/fine-tune-cycle.ts --username greggles --base-model qwen3-coder:30b
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { systemPaths, audit } from '../../packages/core/src/index.js';
import { withUserContext, getUserContext } from '../../packages/core/src/context.js';
import { requireUserInfo } from '../../packages/core/src/user-resolver.js';
import { applySchemaBatch } from '../../packages/core/src/schema-manager.js';
import type { FormattedSample } from '../../packages/core/src/schema-manager.js';
import { getCurrentBaseModel, registerTrainingRun } from '../../packages/core/src/model-registry.js';

const mkdirpSync = (dir: string) => fs.mkdirSync(dir, { recursive: true });

interface FineTuneOptions {
  baseModel: string;
  maxSamples?: number;
  modeFilter?: 'dual' | 'emulation' | 'agent';
  skipValidation?: boolean;
  daysRecent?: number;
  oldSamples?: number;
  monthlyTraining?: boolean; // Enable monthly training defaults
}

/**
 * Run an agent subprocess
 */
async function runAgent(agentName: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const agentPath = path.join(systemPaths.brain, 'agents', `${agentName}.ts`);

    if (!fs.existsSync(agentPath)) {
      console.error(`[fine-tune-cycle] Agent not found: ${agentName}`);
      return resolve(1);
    }

    console.log(`[fine-tune-cycle] Running: tsx ${agentName}.ts ${args.join(' ')}`);
    const child = spawn('tsx', [agentPath, ...args], {
      cwd: systemPaths.root,
      stdio: 'inherit',
    });

    child.on('error', (err) => {
      console.error(`[fine-tune-cycle] Failed to start agent: ${agentName}`, err);
      reject(err);
    });

    child.on('close', (code) => {
      if (code !== 0) {
        console.error(`[fine-tune-cycle] Agent ${agentName} exited with code ${code}`);
      }
      resolve(code || 0);
    });
  });
}

/**
 * Main orchestrator with user context
 */
async function mainWithContext(options: FineTuneOptions) {
  const ctx = getUserContext();

  if (!ctx || !ctx.profilePaths) {
    console.error('[fine-tune-cycle] ERROR: No user context found');
    process.exit(1);
  }

  const runId = randomBytes(8).toString('hex');
  const now = new Date();
  const DATE_STR = now.toISOString().slice(0, 10); // 2025-11-21
  const TIME_STR = now.toISOString().slice(11, 19).replace(/:/g, ''); // 214500
  const RUN_LABEL = `${DATE_STR}-${TIME_STR}-${runId.slice(0, 6)}`;

  console.log(`[fine-tune-cycle] Starting fine-tuning cycle for user: ${ctx.username}`);
  console.log(`[fine-tune-cycle] Run ID: ${runId}`);
  console.log(`[fine-tune-cycle] Base model: ${options.baseModel}`);

  // Create run directory
  const runDir = path.join(
    ctx.profilePaths.root,
    'out',
    'fine-tuned-models',
    DATE_STR,
    RUN_LABEL
  );
  mkdirpSync(runDir);

  console.log(`[fine-tune-cycle] Run directory: ${runDir}`);

  // Define output paths
  const CURATED_PATH = path.join(runDir, 'curated_memories.json');
  const FORMATTED_PATH = path.join(runDir, 'formatted_samples.json');
  const SCHEMA_PATH = path.join(runDir, 'schema_applied.json');
  const DATASET_PATH = path.join(runDir, 'fine_tune_dataset.jsonl');
  const SUMMARY_PATH = path.join(runDir, 'run-summary.json');

  audit({
    level: 'info',
    category: 'action',
    event: 'fine_tune_cycle_started',
    details: {
      runId,
      runLabel: RUN_LABEL,
      username: ctx.username,
      baseModel: options.baseModel,
      modeFilter: options.modeFilter,
      maxSamples: options.maxSamples,
    },
    actor: ctx.username,
  });

  try {
    // Step 1: Curate memories
    console.log('\n[fine-tune-cycle] ===== STEP 1: CURATING MEMORIES =====');
    const curatorArgs = [
      '--username', ctx.username,
      '--output', CURATED_PATH,
    ];

    // Monthly training strategy
    if (options.monthlyTraining || (options.daysRecent && options.oldSamples)) {
      const daysRecent = options.daysRecent || 30;
      const oldSamples = options.oldSamples || 3000;
      curatorArgs.push('--days-recent', String(daysRecent));
      curatorArgs.push('--old-samples', String(oldSamples));
      console.log(`[fine-tune-cycle] Using monthly training strategy (${daysRecent} days recent + ${oldSamples} old)`);
    }

    if (options.maxSamples) {
      curatorArgs.push('--max', String(options.maxSamples));
    }
    if (options.modeFilter) {
      curatorArgs.push('--mode', options.modeFilter);
    }

    const curatorCode = await runAgent('memory-curator', curatorArgs);
    if (curatorCode !== 0) {
      throw new Error('Memory curation failed');
    }

    // Step 2: Format samples
    console.log('\n[fine-tune-cycle] ===== STEP 2: FORMATTING SAMPLES =====');
    const formatterArgs = [
      '--input', CURATED_PATH,
      '--output', FORMATTED_PATH,
    ];

    const formatterCode = await runAgent('mode-formatter', formatterArgs);
    if (formatterCode !== 0) {
      throw new Error('Mode formatting failed');
    }

    // Step 3: Apply schema (in-process, no separate agent needed)
    console.log('\n[fine-tune-cycle] ===== STEP 3: APPLYING SCHEMA =====');
    const formattedContent = fs.readFileSync(FORMATTED_PATH, 'utf-8');
    const formattedSamples = JSON.parse(formattedContent) as FormattedSample[];

    console.log(`[fine-tune-cycle] Applying schema for base model: ${options.baseModel}`);
    const schemaAppliedSamples = applySchemaBatch(formattedSamples, options.baseModel);

    fs.writeFileSync(SCHEMA_PATH, JSON.stringify(schemaAppliedSamples, null, 2));
    console.log(`[fine-tune-cycle] Wrote ${schemaAppliedSamples.length} schema-applied samples`);

    // Step 4: Export to JSONL
    console.log('\n[fine-tune-cycle] ===== STEP 4: EXPORTING TO JSONL =====');
    const exporterArgs = [
      '--input', SCHEMA_PATH,
      '--output', DATASET_PATH,
    ];
    if (options.skipValidation) {
      exporterArgs.push('--skip-validation');
    }

    const exporterCode = await runAgent('training-exporter', exporterArgs);
    if (exporterCode !== 0) {
      throw new Error('Training export failed');
    }

    // Step 5: Validate dataset
    console.log('\n[fine-tune-cycle] ===== STEP 5: VALIDATION COMPLETE =====');
    const datasetStats = fs.statSync(DATASET_PATH);
    const datasetLines = fs.readFileSync(DATASET_PATH, 'utf-8').split('\n').filter(Boolean).length;

    console.log(`[fine-tune-cycle] Dataset ready:`);
    console.log(`  - Samples: ${datasetLines}`);
    console.log(`  - Size: ${(datasetStats.size / 1024).toFixed(2)} KB`);
    console.log(`  - Path: ${DATASET_PATH}`);

    // Step 6: Run remote fine-tuning on RunPod
    console.log('\n[fine-tune-cycle] ===== STEP 6: REMOTE FINE-TUNING =====');
    console.log(`[fine-tune-cycle] Starting RunPod training...`);
    console.log(`[fine-tune-cycle] This may take 2-6 hours depending on dataset size`);

    // Create work directory structure (matching lora-trainer expectations)
    const WORK_LOCAL = path.join(systemPaths.root, 'metahuman-runs', ctx.username, DATE_STR, RUN_LABEL);
    mkdirpSync(WORK_LOCAL);

    // Copy dataset to expected location (lora-trainer expects unsloth_dataset.jsonl)
    const CLEAN_DATA_FILE = path.join(WORK_LOCAL, 'unsloth_dataset.jsonl');
    fs.copyFileSync(DATASET_PATH, CLEAN_DATA_FILE);
    console.log(`[fine-tune-cycle] Copied dataset to work directory`);

    // Create config file with mode-specific settings
    const CONFIG_FILE = path.join(WORK_LOCAL, 'config.json');

    // Always start by loading the base fine-tune config
    const baseConfigPath = path.join(systemPaths.etc, 'fine-tune-config.json');
    let config: any = {
      base_model: options.baseModel,
      training_mode: 'full_finetune', // Default to full fine-tuning
      learning_rate: 5e-6,
      num_train_epochs: 3,
      per_device_train_batch_size: 1,
      gradient_accumulation_steps: 32,
      max_seq_length: 2048,
    };

    // Load base fine-tune config if it exists
    if (fs.existsSync(baseConfigPath)) {
      try {
        const loadedConfig = JSON.parse(fs.readFileSync(baseConfigPath, 'utf-8'));
        const { comment, notes, dataset_requirements, ...trainingParams } = loadedConfig;
        config = { ...config, ...trainingParams };
        console.log(`[fine-tune-cycle] Loaded base config: fine-tune-config.json`);
      } catch (error) {
        console.warn(`[fine-tune-cycle] Failed to load base config: ${(error as Error).message}`);
      }
    }

    // Override with mode-specific config if provided
    if (options.modeFilter) {
      const modeConfigPath = path.join(systemPaths.etc, 'modes', `${options.modeFilter}-config.json`);
      if (fs.existsSync(modeConfigPath)) {
        try {
          const loadedConfig = JSON.parse(fs.readFileSync(modeConfigPath, 'utf-8'));
          const { comment, notes, dataset_requirements, ...trainingParams } = loadedConfig;
          config = { ...config, ...trainingParams };
          console.log(`[fine-tune-cycle] Loaded mode-specific config: ${options.modeFilter}-config.json`);
          console.log(`[fine-tune-cycle] Training mode: ${config.training_mode}`);
        } catch (error) {
          console.warn(`[fine-tune-cycle] Failed to load mode config: ${(error as Error).message}`);
        }
      }
    }

    // Ensure base model is set
    config.base_model = options.baseModel;

    console.log(`[fine-tune-cycle] Final config optimizer: ${config.optim || config.optimizer || 'NOT SET'}`);
    console.log(`[fine-tune-cycle] Final config load_in_8bit: ${config.load_in_8bit}`);

    // Write config file
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    console.log(`[fine-tune-cycle] Wrote config file: ${CONFIG_FILE}`);

    // Create summary file path
    const SUMMARY_FILE = path.join(WORK_LOCAL, 'run-summary.json');

    // Call lora-trainer directly (it will detect training_mode from config)
    const { runRemoteTraining } = await import('./lora-trainer.js');

    const OUT_ROOT = runDir;
    const FINAL_MODEL_DIR = path.join(OUT_ROOT, 'model');
    mkdirpSync(FINAL_MODEL_DIR);

    const RAW_DATA_FILE = path.join(OUT_ROOT, `${RUN_LABEL}.jsonl`);
    fs.copyFileSync(CLEAN_DATA_FILE, RAW_DATA_FILE);

    const trainingResult = await runRemoteTraining({
      DATE_STR,
      RUN_LABEL,
      run_id: runId,
      WORK_LOCAL,
      OUT_ROOT,
      FINAL_ADAPTER_DIR: FINAL_MODEL_DIR, // Will be used for model output
      RAW_DATA_FILE,
      CLEAN_DATA_FILE,
      CONFIG_FILE,
      SUMMARY_FILE,
      samples_used: datasetLines,
    });

    console.log(`[fine-tune-cycle] Training result: success=${trainingResult.success}`);

    // Write run summary
    const summary = {
      runId,
      runLabel: RUN_LABEL,
      username: ctx.username,
      baseModel: options.baseModel,
      modeFilter: options.modeFilter || null,
      maxSamples: options.maxSamples || null,
      datasetPath: DATASET_PATH,
      totalSamples: datasetLines,
      datasetSizeKB: Math.round(datasetStats.size / 1024),
      createdAt: new Date().toISOString(),
      status: trainingResult.success ? 'training_complete' : 'training_failed',
      trainingSuccess: trainingResult.success,
      podId: trainingResult.pod_id,
      sshUser: trainingResult.ssh_user,
      sshHost: trainingResult.ssh_host,
      modelPath: trainingResult.modelPath,
      error: trainingResult.error || null,
    };

    fs.writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2));

    if (!trainingResult.success) {
      throw new Error(`Training failed: ${trainingResult.error || 'Unknown error'}`);
    }

    // Register successful training run in model registry
    try {
      const modelDir = path.join(runDir, 'model');
      const ggufPath = path.join(runDir, 'model.gguf');

      registerTrainingRun({
        run_id: runId,
        run_label: RUN_LABEL,
        timestamp: new Date().toISOString(),
        base_model_used: options.baseModel,
        output_model_path: modelDir, // Unquantized model for future training
        gguf_path: ggufPath, // Quantized GGUF for Ollama
        samples_trained: datasetLines,
        mode_filter: options.modeFilter,
        training_success: true,
      });

      console.log(`[fine-tune-cycle] Registered training run in model registry`);
      console.log(`[fine-tune-cycle] Next fine-tune will build on this model (continuous learning)`);
    } catch (registryError) {
      console.warn(`[fine-tune-cycle] Failed to update model registry: ${(registryError as Error).message}`);
      console.warn(`[fine-tune-cycle] Training succeeded but registry not updated`);
    }

    console.log('\n[fine-tune-cycle] ===== PIPELINE COMPLETE =====');
    console.log(`[fine-tune-cycle] Fine-tuned model ready!`);
    console.log(`[fine-tune-cycle] Model path: ${trainingResult.modelPath}`);
    console.log(`[fine-tune-cycle] Next step: Load to Ollama`);

    audit({
      level: 'info',
      category: 'action',
      event: 'fine_tune_cycle_completed',
      details: summary,
      actor: ctx.username,
    });

  } catch (error) {
    console.error('\n[fine-tune-cycle] ===== PIPELINE FAILED =====');
    console.error(`[fine-tune-cycle] Error: ${(error as Error).message}`);

    const failureSummary = {
      runId,
      runLabel: RUN_LABEL,
      username: ctx.username,
      baseModel: options.baseModel,
      status: 'failed',
      error: (error as Error).message,
      failedAt: new Date().toISOString(),
    };

    fs.writeFileSync(SUMMARY_PATH, JSON.stringify(failureSummary, null, 2));

    audit({
      level: 'error',
      category: 'action',
      event: 'fine_tune_cycle_failed',
      details: failureSummary,
      actor: ctx.username,
    });

    throw error;
  }
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2);
  let username: string | null = null;
  let baseModel: string | null = null; // User-provided override (null = use registry)
  let maxSamples: number | undefined = undefined;
  let modeFilter: 'dual' | 'emulation' | 'agent' | undefined = undefined;
  let skipValidation = false;
  let daysRecent: number | undefined = undefined;
  let oldSamples: number | undefined = undefined;
  let monthlyTraining = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--username' && i + 1 < args.length) {
      username = args[i + 1];
    } else if (args[i] === '--base-model' && i + 1 < args.length) {
      baseModel = args[i + 1]; // User explicitly provided base model
    } else if (args[i] === '--max' && i + 1 < args.length) {
      maxSamples = parseInt(args[i + 1], 10);
    } else if (args[i] === '--mode' && i + 1 < args.length) {
      const mode = args[i + 1];
      if (['dual', 'emulation', 'agent'].includes(mode)) {
        modeFilter = mode as 'dual' | 'emulation' | 'agent';
      }
    } else if (args[i] === '--skip-validation') {
      skipValidation = true;
    } else if (args[i] === '--days-recent' && i + 1 < args.length) {
      daysRecent = parseInt(args[i + 1], 10);
    } else if (args[i] === '--old-samples' && i + 1 < args.length) {
      oldSamples = parseInt(args[i + 1], 10);
    } else if (args[i] === '--monthly') {
      monthlyTraining = true;
    }
  }

  // Determine base model: user override → model registry → hardcoded default
  let finalBaseModel: string;
  let modelSource: 'user' | 'registry' | 'default';

  if (baseModel) {
    finalBaseModel = baseModel;
    modelSource = 'user';
  } else {
    try {
      const registryModel = getCurrentBaseModel();
      finalBaseModel = registryModel.model;
      modelSource = 'registry';
      console.log(`[fine-tune-cycle] Using base model from registry: ${finalBaseModel}`);
      if (registryModel.type === 'local') {
        console.log(`[fine-tune-cycle] Building on previously trained model (continuous learning)`);
      }
    } catch (error) {
      // Registry not found or error reading, use default
      finalBaseModel = 'unsloth/Qwen3-14B-Instruct';
      modelSource = 'default';
      console.log(`[fine-tune-cycle] Registry not available, using default: ${finalBaseModel}`);
    }
  }

  if (!username) {
    console.error('[fine-tune-cycle] ERROR: --username <name> is required');
    console.error('\nUsage: tsx brain/agents/fine-tune-cycle.ts --username <username> [options]');
    console.error('\nOptions:');
    console.error('  --base-model <model>     Base model to fine-tune (default: from registry)');
    console.error('  --max <count>            Maximum samples to process');
    console.error('  --mode <dual|emulation|agent>  Filter by cognitive mode');
    console.error('  --skip-validation        Skip validation checks');
    console.error('\nMonthly Training Strategy:');
    console.error('  --monthly                Use monthly defaults (30 days recent + 3000 old)');
    console.error('  --days-recent <days>     Use N days of recent memories');
    console.error('  --old-samples <count>    Mix in N random old samples');
    console.error('\nExamples:');
    console.error('  # Full dataset (initial training)');
    console.error('  tsx brain/agents/fine-tune-cycle.ts --username greggles');
    console.error('\n  # Monthly update (recommended after foundation model)');
    console.error('  tsx brain/agents/fine-tune-cycle.ts --username greggles --monthly');
    console.error('\n  # Custom monthly strategy');
    console.error('  tsx brain/agents/fine-tune-cycle.ts --username greggles --days-recent 45 --old-samples 4000');
    process.exit(1);
  }

  const userInfo = requireUserInfo(username);

  const options: FineTuneOptions = {
    baseModel: finalBaseModel, // Use resolved base model
    maxSamples,
    modeFilter,
    skipValidation,
    daysRecent,
    oldSamples,
    monthlyTraining,
  };

  await withUserContext(userInfo, () => mainWithContext(options));
}

main().catch(err => {
  console.error('[fine-tune-cycle] Fatal error:', err);
  process.exit(1);
});
