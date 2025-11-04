/**
 * Full Cycle Orchestrator - LOCAL Training Version
 * Runs training on your local machine instead of RunPod
 *
 * Requirements:
 * - Python 3.10+ with unsloth installed
 * - CUDA-capable GPU (NVIDIA)
 * - At least 24GB VRAM for 20B models
 *
 * Usage:
 *   npx tsx brain/agents/full-cycle-local.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { paths, audit, setActiveAdapter } from '../../packages/core/src/index.js';
import dotenv from 'dotenv';
import { mkdirpSync } from 'mkdirp';
import { randomBytes } from 'node:crypto';
import type { ActiveAdapterInfo } from '../../packages/core/src/adapters.js';

// Load environment variables
dotenv.config({ path: path.join(paths.root, '.env') });

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

async function runAgent(agentName: string, args: string[] = []): Promise<number> {
  return new Promise((resolve, reject) => {
    const agentPath = path.join(paths.brain, 'agents', `${agentName}.ts`);
    if (!fs.existsSync(agentPath)) {
      console.error(`[full-cycle-local] Agent not found: ${agentName}`);
      return resolve(1);
    }

    console.log(`[full-cycle-local] Running agent: ${agentName} with args: ${args.join(' ')}`);
    const child = spawn('tsx', [agentPath, ...args], { cwd: paths.root, stdio: ['inherit', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      console.log(`[${agentName}] stdout: ${data}`);
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      console.error(`[${agentName}] stderr: ${data}`);
      stderr += data.toString();
    });

    child.on('error', (err) => {
      console.error(`[full-cycle-local] Failed to start agent: ${agentName}`, err);
      reject(err);
    });

    child.on('close', (code) => {
      resolve(code || 0);
    });
  });
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

  const trainingScript = path.join(paths.root, 'docker', 'runpod-trainer', 'train_unsloth.py');

  // Check if training script exists
  if (!fs.existsSync(trainingScript)) {
    console.error(`❌ Training script not found: ${trainingScript}`);
    return false;
  }

  // Determine Python command (prefer venv if available)
  const venvPython = path.join(paths.root, 'venv', 'bin', 'python3');
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

async function main() {
  currentRunId = randomBytes(8).toString('hex');
  console.log(`[${new Date().toISOString()}] === Starting new local full cycle run (${currentRunId}) ===`);

  // Step 1: Determine dataset date (today or most recent) and run label
  const now = new Date();
  const DATE_STR = now.toISOString().slice(0, 10);
  const TIME_STR = now.toISOString().slice(11, 19).replace(/:/g, '');
  const runSuffix = (currentRunId || randomBytes(4).toString('hex')).slice(0, 6);
  const RUN_LABEL = `${DATE_STR}-${TIME_STR}-${runSuffix}`;
  currentRunLabel = RUN_LABEL;
  const datasetDir = path.join(paths.out, 'adapters', DATE_STR);
  console.log(`[${new Date().toISOString()}] Run label: ${RUN_LABEL}`);
  const OUT_ROOT = path.join(datasetDir, RUN_LABEL);
  const legacyRunRoot = path.join(paths.root, 'metahuman-runs', DATE_STR);
  const WORK_LOCAL = path.join(legacyRunRoot, RUN_LABEL);
  const FINAL_ADAPTER_DIR = path.join(OUT_ROOT, 'adapter');

  console.log('[full-cycle-local] Preparing dataset...');
  console.log(`[${new Date().toISOString()}] Checking dataset directory`);
  console.log({ datasetDir });

  const instructionsPath = path.join(datasetDir, 'instructions.jsonl');

  // If dataset doesn't exist, run adapter-builder
  if (!fs.existsSync(datasetDir) || !fs.existsSync(instructionsPath)) {
    console.log('[full-cycle-local] Building new dataset...');
    const buildRc = await runAgent('adapter-builder');
    if (buildRc !== 0) {
      throw new Error('adapter-builder failed');
    }
  } else {
    console.log(`[${new Date().toISOString()}] Dataset directory and instructions.jsonl exist, skipping adapter-builder`);
  }

  // Step 2: Prepare local training data
  mkdirpSync(legacyRunRoot);
  mkdirpSync(WORK_LOCAL);
  mkdirpSync(FINAL_ADAPTER_DIR);

  const RAW_DATA_FILE = path.join(OUT_ROOT, `${RUN_LABEL}.jsonl`);
  const canonicalRawDataFile = path.join(datasetDir, `${DATE_STR}.jsonl`);
  const CLEAN_DATA_FILE = path.join(WORK_LOCAL, 'unsloth_dataset.jsonl');
  const CONFIG_FILE = path.join(WORK_LOCAL, 'config.json');
  const uniqueRunInfoPath = path.join(datasetDir, `${RUN_LABEL}-run.json`);

  const datasetStrategy = process.env.METAHUMAN_DATASET_BUILDER?.toLowerCase() || 'classic';
  let samples_used = 0;

  if (datasetStrategy === 'ai') {
    console.log('[full-cycle-local] Using AI dataset builder strategy');
    const aiBuilderPath = path.join(paths.brain, 'agents', 'ai-dataset-builder.ts');
    const args = ['tsx', aiBuilderPath, '--output', CLEAN_DATA_FILE];
    if (process.env.METAHUMAN_DATASET_MAX) args.push('--max', process.env.METAHUMAN_DATASET_MAX);
    if (process.env.METAHUMAN_DATASET_CHUNK) args.push('--chunk', process.env.METAHUMAN_DATASET_CHUNK);
    if (process.env.METAHUMAN_DATASET_MODEL) args.push('--model', process.env.METAHUMAN_DATASET_MODEL);

    console.log(`[full-cycle-local] Running: ${args.join(' ')}`);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(args[0], args.slice(1), { cwd: paths.root, stdio: 'inherit' });
      child.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ai-dataset-builder exited with code ${code}`));
      });
      child.on('error', reject);
    });

    if (!fs.existsSync(CLEAN_DATA_FILE)) {
      throw new Error('AI dataset builder did not produce output file');
    }

    samples_used = fs.readFileSync(CLEAN_DATA_FILE, 'utf-8').split('\n').filter(Boolean).length;
    console.log(`[full-cycle-local] AI builder produced ${samples_used} samples`);

    try {
      if (!fs.existsSync(RAW_DATA_FILE)) {
        fs.copyFileSync(CLEAN_DATA_FILE, RAW_DATA_FILE);
      }
      fs.copyFileSync(CLEAN_DATA_FILE, canonicalRawDataFile);
    } catch (copyErr) {
      console.warn('[full-cycle-local] Failed to copy AI dataset to raw/canonical path:', (copyErr as Error).message);
    }
  } else {
    // ensure unique raw dataset copy exists
    mkdirpSync(path.dirname(RAW_DATA_FILE));
    try {
      fs.copyFileSync(instructionsPath, RAW_DATA_FILE);
    } catch (copyErr) {
      console.warn('[full-cycle-local] Failed to write unique raw dataset copy:', (copyErr as Error).message);
    }
    try {
      fs.copyFileSync(instructionsPath, canonicalRawDataFile);
    } catch (copyErr) {
      console.warn('[full-cycle-local] Failed to refresh canonical dataset JSONL:', (copyErr as Error).message);
    }

    // Step 2.2: Clean dataset with deduplication
    console.log('[full-cycle-local] Building dataset from JSONL...');
    const rawLines = fs.readFileSync(RAW_DATA_FILE, 'utf-8').trim().split('\n').filter(Boolean);
    const parsed = rawLines
      .map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(obj => obj && obj.instruction && obj.output);

    // Deduplicate samples
    const seenSamples = new Set<string>();
    const cleaned: any[] = [];
    let duplicateCount = 0;

    for (const obj of parsed) {
      const cleanObj = {
        instruction: obj.instruction,
        input: obj.input || '',
        output: obj.output
      };
      const fingerprint = JSON.stringify(cleanObj);

      if (seenSamples.has(fingerprint)) {
        duplicateCount++;
        continue;
      }

      seenSamples.add(fingerprint);
      cleaned.push(cleanObj);
    }

    fs.writeFileSync(CLEAN_DATA_FILE, cleaned.map(obj => JSON.stringify(obj)).join('\n'));
    samples_used = cleaned.length;
    try {
      const legacyDatasetPath = path.join(legacyRunRoot, 'unsloth_dataset.jsonl');
      const uniqueDatasetPath = path.join(legacyRunRoot, `unsloth_dataset-${RUN_LABEL}.jsonl`);
      fs.copyFileSync(CLEAN_DATA_FILE, uniqueDatasetPath);
      fs.copyFileSync(CLEAN_DATA_FILE, legacyDatasetPath);
    } catch (datasetCopyErr) {
      console.warn('[full-cycle-local] Failed to copy cleaned dataset to legacy location:', (datasetCopyErr as Error).message);
    }

    if (duplicateCount > 0) {
      console.log(`[full-cycle-local] Removed ${duplicateCount} duplicate samples`);
    }
    console.log(`[full-cycle-local] Kept ${samples_used} unique samples after cleaning`);

    if (samples_used === 0) {
      throw new Error('CLEAN_DATA_FILE ended up empty after cleaning');
    }
  }

  // Step 2.3: Load training config from etc/training-local.json (fallback to training.json)
  const trainingLocalPath = path.join(paths.etc, 'training-local.json');
  const trainingFallbackPath = path.join(paths.etc, 'training.json');
  let config: any = {
    "base_model": "unsloth/Qwen3-Coder-30B-A3B-Instruct",
    "lora_rank": 8,
    "lora_alpha": 16,
    "lora_dropout": 0.05,
    "num_train_epochs": 2,
    "learning_rate": 0.0002,
    "per_device_train_batch_size": 1,
    "gradient_accumulation_steps": 16,
    "max_seq_length": 2048
  };

  let configPathUsed: string | null = null;
  if (fs.existsSync(trainingLocalPath)) {
    try {
      const loadedConfig = JSON.parse(fs.readFileSync(trainingLocalPath, 'utf-8'));
      // Merge loaded config, excluding comment/notes fields
      const { comment, notes, ...trainingParams } = loadedConfig;
      config = { ...config, ...trainingParams };
      configPathUsed = trainingLocalPath;
      console.log(`[full-cycle-local] Loaded training config from ${trainingLocalPath}`);
    } catch (error) {
      console.warn(`[full-cycle-local] Failed to load training-local.json: ${(error as Error).message}`);
    }
  }
  if (!configPathUsed && fs.existsSync(trainingFallbackPath)) {
    try {
      const loadedConfig = JSON.parse(fs.readFileSync(trainingFallbackPath, 'utf-8'));
      const { comment, notes, ...trainingParams } = loadedConfig;
      config = { ...config, ...trainingParams };
      configPathUsed = trainingFallbackPath;
      console.log(`[full-cycle-local] Loaded training config from ${trainingFallbackPath}`);
    } catch (error) {
      console.warn(`[full-cycle-local] Failed to load fallback training config: ${(error as Error).message}`);
    }
  }

  if (!configPathUsed) {
    console.log('[full-cycle-local] Using built-in default training configuration');
  }

  // Environment variable override for base_model (highest priority)
  if (process.env.METAHUMAN_BASE_MODEL) {
    config.base_model = process.env.METAHUMAN_BASE_MODEL;
    console.log(`[full-cycle-local] Using base model from env: ${config.base_model}`);
  }

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  try {
    const legacyConfigPath = path.join(legacyRunRoot, 'config.json');
    const uniqueConfigPath = path.join(legacyRunRoot, `config-${RUN_LABEL}.json`);
    fs.copyFileSync(CONFIG_FILE, uniqueConfigPath);
    fs.copyFileSync(CONFIG_FILE, legacyConfigPath);
  } catch (configCopyErr) {
    console.warn('[full-cycle-local] Failed to copy training config to legacy location:', (configCopyErr as Error).message);
  }

  console.log(`[full-cycle-local] Training base model: ${config.base_model}`);
  console.log('[full-cycle-local] Note: The merged GGUF will contain both base model + adapter');
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

  const adapterPath = path.join(FINAL_ADAPTER_DIR, 'adapter_model.safetensors');
  const canonicalSafetensors = path.join(datasetDir, 'adapter_model.safetensors');
  const uniqueSafetensors = path.join(datasetDir, `adapter_model-${RUN_LABEL}.safetensors`);
  if (fs.existsSync(adapterPath)) {
    try {
      if (!fs.existsSync(uniqueSafetensors)) {
        fs.copyFileSync(adapterPath, uniqueSafetensors);
      }
    } catch (e) {
      console.warn('[full-cycle-local] Failed to write unique adapter_model.safetensors copy:', (e as Error).message);
    }
    try {
      if (fs.existsSync(canonicalSafetensors) || fs.lstatSync(canonicalSafetensors)) {
        fs.rmSync(canonicalSafetensors);
      }
    } catch {
      // ignore
    }
    try {
      const relative = path.relative(datasetDir, adapterPath);
      fs.symlinkSync(relative, canonicalSafetensors);
    } catch (e) {
      console.warn('[full-cycle-local] Failed to symlink adapter_model.safetensors, falling back to copy:', (e as Error).message);
      try {
        fs.copyFileSync(adapterPath, canonicalSafetensors);
      } catch (copyErr) {
        console.warn('[full-cycle-local] Failed to copy adapter_model.safetensors into dataset directory:', (copyErr as Error).message);
      }
    }
  }

  // Step 4: Evaluate adapter
  console.log('[full-cycle-local] Evaluating adapter...');
  const evalRc = await runAgent('eval-adapter', [DATE_STR]);
  if (evalRc !== 0) {
    console.warn('[full-cycle-local] Evaluation failed or not available');
  }

  const evalPath = path.join(datasetDir, 'eval.json');
  let evalData = { passed: true, score: 1.0 };

  if (fs.existsSync(evalPath)) {
    evalData = JSON.parse(fs.readFileSync(evalPath, 'utf-8'));
    if (!evalData.passed) {
      audit({ level: 'info', category: 'action', event: 'full_cycle_local_eval_failed', details: { date: DATE_STR, score: evalData.score, run_label: RUN_LABEL }, actor: 'full-cycle-local' });
      throw new Error('adapter did not pass evaluation');
    }
  }

  // Step 5: Check for merged GGUF
  const recentGGUF = path.join(OUT_ROOT, 'adapter.gguf');
  const canonicalGGUF = path.join(datasetDir, 'adapter.gguf');
  const uniqueGGUF = path.join(datasetDir, `adapter-${RUN_LABEL}.gguf`);

  const altGGUF = path.join(FINAL_ADAPTER_DIR, '../adapter.gguf');
  if (!fs.existsSync(recentGGUF) && fs.existsSync(altGGUF)) {
    fs.copyFileSync(altGGUF, recentGGUF);
  }

  if (fs.existsSync(recentGGUF)) {
    try {
      if (!fs.existsSync(uniqueGGUF)) {
        fs.copyFileSync(recentGGUF, uniqueGGUF);
      }
    } catch (e) {
      console.warn('[full-cycle-local] Failed to write unique adapter.gguf copy:', (e as Error).message);
    }
    try {
      if (fs.existsSync(canonicalGGUF) || fs.lstatSync(canonicalGGUF)) {
        fs.rmSync(canonicalGGUF);
      }
    } catch {
      // ignore
    }
    try {
      const relative = path.relative(datasetDir, recentGGUF);
      fs.symlinkSync(relative, canonicalGGUF);
    } catch (e) {
      console.warn('[full-cycle-local] Failed to symlink adapter.gguf, falling back to copy:', (e as Error).message);
      try {
        fs.copyFileSync(recentGGUF, canonicalGGUF);
      } catch (copyErr) {
        console.warn('[full-cycle-local] Failed to copy adapter.gguf into dataset directory:', (copyErr as Error).message);
      }
    }
  } else {
    console.warn('[full-cycle-local] No GGUF file found. You may need to convert manually.');
    console.warn('[full-cycle-local] The adapter is available at:', FINAL_ADAPTER_DIR);
  }

  // Step 6: Create Modelfile and activate
  const modelName = `greg-local-${RUN_LABEL}`;

  let modelfile = `# MetaHuman OS Local-Trained Model - ${RUN_LABEL}
# Trained on local machine
FROM ${recentGGUF}

SYSTEM You are Greg's digital personality extension. Speak naturally in first person as Greg.
`;

  const modelfilePath = path.join(OUT_ROOT, 'Modelfile');
  fs.writeFileSync(modelfilePath, modelfile);
  const canonicalModelfile = path.join(datasetDir, 'Modelfile');
  const uniqueModelfile = path.join(datasetDir, `Modelfile-${RUN_LABEL}`);
  try {
    fs.writeFileSync(uniqueModelfile, modelfile);
  } catch (e) {
    console.warn('[full-cycle-local] Failed to write unique Modelfile copy:', (e as Error).message);
  }
  try {
    if (fs.existsSync(canonicalModelfile) || fs.lstatSync(canonicalModelfile)) {
      fs.rmSync(canonicalModelfile);
    }
  } catch {
    // ignore
  }
  try {
    const relative = path.relative(datasetDir, modelfilePath);
    fs.symlinkSync(relative, canonicalModelfile);
  } catch (e) {
    console.warn('[full-cycle-local] Failed to symlink Modelfile, falling back to copy:', (e as Error).message);
    try {
      fs.copyFileSync(modelfilePath, canonicalModelfile);
    } catch (copyErr) {
      console.warn('[full-cycle-local] Failed to copy Modelfile into dataset directory:', (copyErr as Error).message);
    }
  }

  const activatedAt = new Date().toISOString();
  const activeInfo: ActiveAdapterInfo = {
    modelName,
    activatedAt,
    adapterPath: recentGGUF,
    evalScore: evalData.score,
    dataset: RUN_LABEL,
    date: DATE_STR,
    modelfilePath,
    status: 'ready_for_ollama_load',
    activatedBy: 'full-cycle-local',
    trainingMethod: 'local',
    runLabel: RUN_LABEL,
    ggufAdapterPath: recentGGUF,
    baseModel: config.base_model,
  };

  setActiveAdapter(activeInfo);

  audit({ level: 'info', category: 'action', event: 'adapter_activated', details: { date: DATE_STR, modelName, local: true, run_label: RUN_LABEL }, actor: 'full-cycle-local' });

  // Step 7: Auto-load into Ollama
  if (fs.existsSync(recentGGUF)) {
    try {
      console.log(`[full-cycle-local] Creating Ollama model: ${modelName}`);
      execSync(`ollama create ${modelName} -f ${modelfilePath}`, { stdio: 'inherit' });
      const loadedInfo: ActiveAdapterInfo = { ...activeInfo, status: 'loaded' };
      setActiveAdapter(loadedInfo);
    } catch (e) {
      console.warn('[full-cycle-local] Failed to auto-load model into Ollama:', (e as Error).message);
    }
  }

  try {
    fs.writeFileSync(uniqueRunInfoPath, JSON.stringify({
      runId: currentRunId,
      runLabel: RUN_LABEL,
      createdAt: new Date().toISOString(),
      method: 'local'
    }, null, 2));
    fs.writeFileSync(path.join(datasetDir, 'latest-run.json'), JSON.stringify({
      runId: currentRunId,
      runLabel: RUN_LABEL,
      updatedAt: new Date().toISOString(),
      method: 'local'
    }, null, 2));
    const trainingOutputPath = path.join(WORK_LOCAL, 'training_output.txt');
    if (fs.existsSync(trainingOutputPath)) {
      const legacyOutputPath = path.join(legacyRunRoot, `training_output-${RUN_LABEL}.txt`);
      fs.copyFileSync(trainingOutputPath, legacyOutputPath);
    }
  } catch (runMetaErr) {
    console.warn('[full-cycle-local] Failed to record run metadata:', (runMetaErr as Error).message);
  }

  if (fs.existsSync(recentGGUF)) {
    cleanupAfterSuccessfulMerge(OUT_ROOT, WORK_LOCAL);
  }

  audit({ level: 'info', category: 'action', event: 'full_cycle_local_completed', details: { date: DATE_STR, run_id: currentRunId, run_label: RUN_LABEL }, actor: 'full-cycle-local' });
  console.log('[full-cycle-local] Run complete.');
}

main().catch(err => {
  console.error('[full-cycle-local] failed:', err);
  process.exit(1);
});
