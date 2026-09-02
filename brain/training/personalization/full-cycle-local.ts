/**
 * User-Aware Full Cycle Orchestrator - LOCAL Training Version
 * Runs training on your local machine for a specific user's profile
 *
 * Requirements:
 * - Python 3.10+ with unsloth installed
 * - CUDA-capable GPU (NVIDIA)
 * - At least 24GB VRAM for 20B models
 *
 * Usage:
 *   pnpm exec tsx brain/training/personalization/full-cycle-local.ts --username <username>
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { systemPaths, audit, loadUserConfig, setActiveAdapter } from '@metahuman/core';
import { withUserContext, getUserContext } from '@metahuman/core/context';
import { requireUserInfo } from '@metahuman/core/user-resolver';
const mkdirpSync = (dir: string) => fs.mkdirSync(dir, { recursive: true });
import { randomBytes } from 'node:crypto';
import type { ActiveAdapterInfo } from '@metahuman/core/adapters';
import { DEFAULT_TRAINING_MODEL } from '@metahuman/core/model-defaults';
import {
  parsePositiveInteger,
  preparePersonalizationDataset,
} from './dataset-pipeline';

// Load environment variables
const environmentPath = path.join(systemPaths.root, '.env');
if (fs.existsSync(environmentPath)) process.loadEnvFile(environmentPath);

let currentRunId: string | null = null;
let currentRunLabel: string | null = null;

function safeRemove(target: string) {
  try {
    if (!fs.existsSync(target)) return;
    const stats = fs.lstatSync(target);
    if (stats.isDirectory()) {
      fs.rmSync(target, { recursive: true, force: true });
    } else {
      fs.rmSync(target, { force: true });
    }
  } catch (err) {
    console.warn(`[full-cycle-local] Failed to remove ${target}: ${(err as Error).message}`);
  }
}

function cleanupAfterSuccessfulMerge(runRoot: string, workLocal: string) {
  safeRemove(path.join(runRoot, "merged_gguf_output"));
  safeRemove(path.join(workLocal, "adapter_base64.txt"));
  safeRemove(path.join(workLocal, "temp_adapter_download"));
}

async function runLocalTraining(opts: {
  DATE_STR: string;
  RUN_LABEL: string;
  WORK_LOCAL: string;
  FINAL_ADAPTER_DIR: string;
  CLEAN_DATA_FILE: string;
  CONFIG_FILE: string;
}): Promise<boolean> {
  console.log('\n🚀 ====== LOCAL LORA TRAINING STARTED ======');
  console.log(`📅 Date: ${opts.DATE_STR}`);
  console.log(`🏷️  Run: ${opts.RUN_LABEL}`);
  console.log(`📁 Work directory: ${opts.WORK_LOCAL}`);
  console.log(`📊 Training locally with your GPU\n`);

  const trainingScript = path.join(systemPaths.root, 'docker', 'runpod-trainer', 'train_unsloth.py');

  // Check if training script exists
  if (!fs.existsSync(trainingScript)) {
    console.error(`❌ Training script not found: ${trainingScript}`);
    return false;
  }

  // Determine Python command (prefer venv if available)
  const venvPython = path.join(systemPaths.root, 'venv', 'bin', 'python3');
  const pythonCmd = fs.existsSync(venvPython) ? venvPython : 'python3';

  if (fs.existsSync(venvPython)) {
    console.log(`📦 Using venv python: ${venvPython}`);
  } else {
    console.log('⚠️  No venv found, using system python');
    console.log('   Recommended: Run ./bin/setup-local-training first');
  }

  // Check if Python/unsloth environment is available
  try {
    execSync(`${pythonCmd} -c "import unsloth"`, { stdio: 'ignore' });
  } catch (e) {
    console.error('❌ Unsloth not found.');
    console.error('   Run: ./bin/setup-local-training');
    return false;
  }

  // Create output directory
  mkdirpSync(opts.FINAL_ADAPTER_DIR);

  return new Promise((resolve) => {
    console.log('🔥 Starting local training...\n');

    const env = {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      UNSLOTH_SKIP_SYSTEM_INSTALL: '1',
    };

    const args = [
      trainingScript,
      '--data', opts.CLEAN_DATA_FILE,
      '--config', opts.CONFIG_FILE,
      '--output', opts.FINAL_ADAPTER_DIR,
    ];

    const child = spawn(pythonCmd, args, {
      cwd: opts.WORK_LOCAL,
      stdio: 'inherit',
      env,
    });

    child.on('error', (err) => {
      console.error('❌ Training process failed to start:', err);
      resolve(false);
    });

    child.on('close', (code) => {
      if (code === 0) {
        console.log('\n✅ ====== LOCAL TRAINING COMPLETED ======\n');
        resolve(true);
      } else {
        console.error(`\n❌ Training failed with exit code ${code}\n`);
        resolve(false);
      }
    });
  });
}

async function mainWithContext() {
  const ctx = getUserContext();

  if (!ctx) {
    console.error('[full-cycle-local] ERROR: No user context found.');
    console.error('[full-cycle-local] This must be run with withUserContext()');
    process.exit(1);
  }

  currentRunId = randomBytes(8).toString('hex');
  console.log(`[${new Date().toISOString()}] === Starting local full cycle for user: ${ctx.username} (${currentRunId}) ===`);

  // User-specific paths
  if (!ctx.profilePaths) {
    console.error('[full-cycle-local] ERROR: User context missing profilePaths');
    process.exit(1);
  }
  const profileRoot = ctx.profilePaths.root;
  const profileTrainingConfig = loadUserConfig<Record<string, any>>(
    'training.json',
    {},
    ctx.username,
  );

  // Step 1: Determine dataset date and run label
  const now = new Date();
  const DATE_STR = now.toISOString().slice(0, 10);
  const TIME_STR = now.toISOString().slice(11, 19).replace(/:/g, '');
  const runSuffix = (currentRunId || randomBytes(4).toString('hex')).slice(0, 6);
  const RUN_LABEL = `${DATE_STR}-${TIME_STR}-${runSuffix}`;
  currentRunLabel = RUN_LABEL;

  // User-specific dataset directory
  const datasetDir = path.join(profileRoot, 'out', 'adapters', DATE_STR);
  console.log(`[${new Date().toISOString()}] Run label: ${RUN_LABEL}`);
  console.log(`[${new Date().toISOString()}] Dataset dir: ${datasetDir}`);

  const OUT_ROOT = path.join(datasetDir, RUN_LABEL);
  const workRoot = path.join(systemPaths.root, 'metahuman-runs', ctx.username, DATE_STR);
  const WORK_LOCAL = path.join(workRoot, RUN_LABEL);
  const FINAL_ADAPTER_DIR = path.join(OUT_ROOT, 'adapter');

  // Step 2: Prepare local training data
  mkdirpSync(workRoot);
  mkdirpSync(WORK_LOCAL);
  mkdirpSync(FINAL_ADAPTER_DIR);

  const RAW_DATA_FILE = path.join(OUT_ROOT, `${RUN_LABEL}.jsonl`);
  const canonicalRawDataFile = path.join(datasetDir, `${DATE_STR}.jsonl`);
  const CLEAN_DATA_FILE = path.join(WORK_LOCAL, 'unsloth_dataset.jsonl');
  const CONFIG_FILE = path.join(WORK_LOCAL, 'config.json');

  mkdirpSync(path.dirname(RAW_DATA_FILE));

  const baseModel = process.env.METAHUMAN_BASE_MODEL
    || profileTrainingConfig.base_model
    || DEFAULT_TRAINING_MODEL;
  const maxSamples = process.env.METAHUMAN_MAX_SAMPLES
    ? parsePositiveInteger(process.env.METAHUMAN_MAX_SAMPLES, 'METAHUMAN_MAX_SAMPLES')
    : undefined;
  const dataset = await preparePersonalizationDataset({
    actor: ctx.username,
    baseModel,
    captureProgramOutput: true,
    datasetPaths: [CLEAN_DATA_FILE, RAW_DATA_FILE, canonicalRawDataFile],
    format: 'instruction',
    logPrefix: 'full-cycle-local',
    maxSamples,
    outputRoot: OUT_ROOT,
    skipPreprocessing: process.env.METAHUMAN_SKIP_PREPROCESSING === '1',
    username: ctx.username,
  });
  const samples_used = dataset.sampleCount;
  console.log(`[full-cycle-local] Curation complete: ${samples_used} high-quality samples`);

  // Step 2.3: Merge the local engine baseline and profile configuration.
  const trainingLocalPath = path.join(systemPaths.etc, 'training-local.json');
  let config: any = {
    "base_model": DEFAULT_TRAINING_MODEL,
    "lora_rank": 8,
    "lora_alpha": 16,
    "lora_dropout": 0,
    "num_train_epochs": 2,
    "learning_rate": 0.0002,
    "per_device_train_batch_size": 1,
    "gradient_accumulation_steps": 16,
    "max_seq_length": 2048,
    "load_in_4bit": false,
    "load_in_16bit": true
  };

  if (fs.existsSync(trainingLocalPath)) {
    try {
      const loadedConfig = JSON.parse(fs.readFileSync(trainingLocalPath, 'utf-8'));
      const { comment, notes, ...trainingParams } = loadedConfig;
      config = { ...config, ...trainingParams };
      console.log(`[full-cycle-local] Loaded training config from ${trainingLocalPath}`);
    } catch (error) {
      console.warn(`[full-cycle-local] Failed to load training-local.json: ${(error as Error).message}`);
    }
  }
  const { comment, notes, ...profileTrainingParams } = profileTrainingConfig;
  config = { ...config, ...profileTrainingParams };
  console.log(`[full-cycle-local] Loaded profile config from ${path.join(ctx.profilePaths.etc, 'training.json')}`);

  // Environment variable override for base_model
  if (process.env.METAHUMAN_BASE_MODEL) {
    config.base_model = process.env.METAHUMAN_BASE_MODEL;
    console.log(`[full-cycle-local] Using base model from env: ${config.base_model}`);
  }

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));

  console.log(`[full-cycle-local] Training base model: ${config.base_model}`);
  console.log('[full-cycle-local] Training will run on your local GPU\n');

  // Step 3: Run LOCAL training
  const success = await runLocalTraining({
    DATE_STR,
    RUN_LABEL,
    WORK_LOCAL,
    FINAL_ADAPTER_DIR,
    CLEAN_DATA_FILE,
    CONFIG_FILE,
  });

  if (!success) {
    throw new Error('Local training failed');
  }

  // Step 4: Link adapter files
  const adapterPath = path.join(FINAL_ADAPTER_DIR, 'adapter_model.safetensors');
  const canonicalSafetensors = path.join(datasetDir, 'adapter_model.safetensors');

  if (fs.existsSync(adapterPath)) {
    try {
      if (fs.existsSync(canonicalSafetensors)) {
        fs.rmSync(canonicalSafetensors);
      }
      const relative = path.relative(datasetDir, adapterPath);
      fs.symlinkSync(relative, canonicalSafetensors);
    } catch (e) {
      console.warn('[full-cycle-local] Failed to symlink adapter, copying instead:', (e as Error).message);
      fs.copyFileSync(adapterPath, canonicalSafetensors);
    }
  }

  // Step 5: Check for merged GGUF
  const trainedGGUF = path.join(OUT_ROOT, 'adapter.gguf');
  const canonicalGGUF = path.join(datasetDir, 'adapter.gguf');

  if (fs.existsSync(trainedGGUF)) {
    try {
      if (fs.existsSync(canonicalGGUF)) {
        fs.rmSync(canonicalGGUF);
      }
      const relative = path.relative(datasetDir, trainedGGUF);
      fs.symlinkSync(relative, canonicalGGUF);
    } catch (e) {
      console.warn('[full-cycle-local] Failed to symlink GGUF, copying instead:', (e as Error).message);
      fs.copyFileSync(trainedGGUF, canonicalGGUF);
    }
  } else {
    console.warn('[full-cycle-local] No GGUF file found. You may need to convert manually.');
  }

  // Step 6: Create Modelfile
  const modelName = `${ctx.username}-local-${DATE_STR}`;
  const personaName = ctx.username.charAt(0).toUpperCase() + ctx.username.slice(1);

  const modelfile = `# MetaHuman OS Model - ${ctx.username} - ${RUN_LABEL}
# Trained locally
FROM ${trainedGGUF}

SYSTEM You are ${personaName}'s digital personality extension. Speak naturally in first person as ${personaName}.
`;

  const modelfilePath = path.join(OUT_ROOT, 'Modelfile');
  fs.writeFileSync(modelfilePath, modelfile);

  const canonicalModelfile = path.join(datasetDir, 'Modelfile');
  try {
    if (fs.existsSync(canonicalModelfile)) {
      fs.rmSync(canonicalModelfile);
    }
    const relative = path.relative(datasetDir, modelfilePath);
    fs.symlinkSync(relative, canonicalModelfile);
  } catch (e) {
    console.warn('[full-cycle-local] Failed to symlink Modelfile, copying instead:', (e as Error).message);
    fs.copyFileSync(modelfilePath, canonicalModelfile);
  }

  // Step 7: Set active adapter
  const activatedAt = new Date().toISOString();
  const activeInfo: ActiveAdapterInfo = {
    modelName,
    activatedAt,
    adapterPath: trainedGGUF,
    dataset: RUN_LABEL,
    date: DATE_STR,
    modelfilePath,
    status: 'ready_for_ollama_load',
    activatedBy: 'full-cycle-local',
    trainingMethod: 'local',
    runLabel: RUN_LABEL,
    ggufAdapterPath: trainedGGUF,
    baseModel: config.base_model,
  };

  setActiveAdapter(activeInfo);

  await audit({
    level: 'info',
    category: 'action',
    event: 'adapter_activated',
    actor: ctx.username,
    details: { date: DATE_STR, modelName, local: true, run_label: RUN_LABEL, username: ctx.username },
  });

  // Step 8: Auto-load into Ollama
  if (fs.existsSync(trainedGGUF)) {
    try {
      console.log(`[full-cycle-local] Creating Ollama model: ${modelName}`);
      execSync(`ollama create ${modelName} -f ${modelfilePath}`, { stdio: 'inherit' });
      const loadedInfo: ActiveAdapterInfo = { ...activeInfo, status: 'loaded' };
      setActiveAdapter(loadedInfo);
    } catch (e) {
      console.warn('[full-cycle-local] Failed to auto-load model into Ollama:', (e as Error).message);
    }
  }

  cleanupAfterSuccessfulMerge(OUT_ROOT, WORK_LOCAL);

  // Auto-cleanup: Archive old training runs
  try {
    const { autoCleanupTrainingRuns, cleanupOldWorkDirectories } = await import('@metahuman/core');
    await autoCleanupTrainingRuns(ctx.username, RUN_LABEL, false); // false = LoRA adapter
    cleanupOldWorkDirectories(ctx.username);
  } catch (err) {
    console.warn('[full-cycle-local] Auto-cleanup failed (non-critical):', (err as Error).message);
  }

  await audit({
    level: 'info',
    category: 'action',
    event: 'full_cycle_local_completed',
    actor: ctx.username,
    details: { date: DATE_STR, run_id: currentRunId, run_label: RUN_LABEL, username: ctx.username },
  });

  console.log(`\n✅ [full-cycle-local] Training complete for user: ${ctx.username}`);
  console.log(`   Model name: ${modelName}`);
  console.log(`   Dataset: ${datasetDir}`);
}

async function main() {
  // Parse CLI arguments
  const args = process.argv.slice(2);
  let username: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--username' && i + 1 < args.length) {
      username = args[i + 1];
      break;
    }
  }

  if (!username) {
    console.error('[full-cycle-local] ERROR: --username <name> is required');
    console.error('\nUsage: pnpm exec tsx brain/training/personalization/full-cycle-local.ts --username <username>');
    console.error('\nExample: pnpm exec tsx brain/training/personalization/full-cycle-local.ts --username greggles');
    process.exit(1);
  }

  // Resolve user info
  const userInfo = requireUserInfo(username);

  console.log(`[full-cycle-local] Starting local training for user: ${username}`);

  // Run with user context
  await withUserContext(userInfo, mainWithContext);
}

main().catch(err => {
  console.error('[full-cycle-local] failed:', err);
  process.exit(1);
});
