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
 *   npx tsx brain/agents/full-cycle-local.ts --username <username>
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { systemPaths, audit, setActiveAdapter } from '../../packages/core/src/index.js';
import { withUserContext, getUserContext } from '../../packages/core/src/context.js';
import { requireUserInfo } from '../../packages/core/src/user-resolver.js';
import dotenv from 'dotenv';
import { mkdirpSync } from 'mkdirp';
import { randomBytes } from 'node:crypto';
import type { ActiveAdapterInfo } from '../../packages/core/src/adapters.js';

// Load environment variables
dotenv.config({ path: path.join(systemPaths.root, '.env') });

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
    const agentPath = path.join(systemPaths.brain, 'agents', `${agentName}.ts`);
    if (!fs.existsSync(agentPath)) {
      console.error(`[full-cycle-local] Agent not found: ${agentName}`);
      return resolve(1);
    }

    console.log(`[full-cycle-local] Running agent: ${agentName} with args: ${args.join(' ')}`);
    const child = spawn('tsx', [agentPath, ...args], { cwd: systemPaths.root, stdio: ['inherit', 'pipe', 'pipe'] });

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
  const profileRoot = path.dirname(ctx.profilePaths.personaCore);

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
  const legacyRunRoot = path.join(systemPaths.root, 'metahuman-runs', ctx.username, DATE_STR);
  const WORK_LOCAL = path.join(legacyRunRoot, RUN_LABEL);
  const FINAL_ADAPTER_DIR = path.join(OUT_ROOT, 'adapter');

  console.log('[full-cycle-local] Preparing dataset...');
  const instructionsPath = path.join(datasetDir, 'instructions.jsonl');

  // If dataset doesn't exist, run adapter-builder
  if (!fs.existsSync(datasetDir) || !fs.existsSync(instructionsPath)) {
    console.log('[full-cycle-local] Building new dataset with adapter-builder...');
    const buildRc = await runAgent('adapter-builder');
    if (buildRc !== 0) {
      throw new Error('adapter-builder failed');
    }
  } else {
    console.log(`[${new Date().toISOString()}] Dataset already exists, skipping adapter-builder`);
  }

  // Step 2: Prepare local training data
  mkdirpSync(legacyRunRoot);
  mkdirpSync(WORK_LOCAL);
  mkdirpSync(FINAL_ADAPTER_DIR);

  const RAW_DATA_FILE = path.join(OUT_ROOT, `${RUN_LABEL}.jsonl`);
  const canonicalRawDataFile = path.join(datasetDir, `${DATE_STR}.jsonl`);
  const CLEAN_DATA_FILE = path.join(WORK_LOCAL, 'unsloth_dataset.jsonl');
  const CONFIG_FILE = path.join(WORK_LOCAL, 'config.json');

  // Copy instructions to raw dataset file
  mkdirpSync(path.dirname(RAW_DATA_FILE));
  try {
    fs.copyFileSync(instructionsPath, RAW_DATA_FILE);
    fs.copyFileSync(instructionsPath, canonicalRawDataFile);
  } catch (copyErr) {
    console.warn('[full-cycle-local] Failed to copy dataset:', (copyErr as Error).message);
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
  const samples_used = cleaned.length;

  if (duplicateCount > 0) {
    console.log(`[full-cycle-local] Removed ${duplicateCount} duplicate samples`);
  }
  console.log(`[full-cycle-local] Kept ${samples_used} unique samples after cleaning`);

  if (samples_used === 0) {
    throw new Error('CLEAN_DATA_FILE ended up empty after cleaning');
  }

  // Step 2.3: Load training config
  const trainingLocalPath = path.join(systemPaths.etc, 'training-local.json');
  const trainingFallbackPath = path.join(systemPaths.etc, 'training.json');
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
  const recentGGUF = path.join(OUT_ROOT, 'adapter.gguf');
  const canonicalGGUF = path.join(datasetDir, 'adapter.gguf');

  if (fs.existsSync(recentGGUF)) {
    try {
      if (fs.existsSync(canonicalGGUF)) {
        fs.rmSync(canonicalGGUF);
      }
      const relative = path.relative(datasetDir, recentGGUF);
      fs.symlinkSync(relative, canonicalGGUF);
    } catch (e) {
      console.warn('[full-cycle-local] Failed to symlink GGUF, copying instead:', (e as Error).message);
      fs.copyFileSync(recentGGUF, canonicalGGUF);
    }
  } else {
    console.warn('[full-cycle-local] No GGUF file found. You may need to convert manually.');
  }

  // Step 6: Create Modelfile
  const modelName = `${ctx.username}-local-${DATE_STR}`;
  const personaName = ctx.username.charAt(0).toUpperCase() + ctx.username.slice(1);

  const modelfile = `# MetaHuman OS Model - ${ctx.username} - ${RUN_LABEL}
# Trained locally
FROM ${recentGGUF}

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
    adapterPath: recentGGUF,
    evalScore: 1.0,
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

  await audit({
    level: 'info',
    category: 'action',
    event: 'adapter_activated',
    actor: ctx.username,
    details: { date: DATE_STR, modelName, local: true, run_label: RUN_LABEL, username: ctx.username },
  });

  // Step 8: Auto-load into Ollama
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

  cleanupAfterSuccessfulMerge(OUT_ROOT, WORK_LOCAL);

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
    console.error('\nUsage: npx tsx brain/agents/full-cycle-local.ts --username <username>');
    console.error('\nExample: npx tsx brain/agents/full-cycle-local.ts --username greggles');
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
