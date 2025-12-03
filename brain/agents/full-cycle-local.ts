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
const mkdirpSync = (dir: string) => fs.mkdirSync(dir, { recursive: true });
import { randomBytes } from 'node:crypto';
import type { ActiveAdapterInfo } from '../../packages/core/src/adapters.js';
import { applySchemaBatch } from '../../packages/core/src/schema-manager.js';
import type { FormattedSample, SchemaAppliedSample } from '../../packages/core/src/schema-manager.js';

// Load environment variables
dotenv.config({ path: path.join(systemPaths.root, '.env') });

// Resolve tsx path (installed in node_modules/.bin)
const TSX_PATH = path.join(systemPaths.root, 'node_modules', '.bin', 'tsx');

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

/**
 * ROBUSTNESS: Clean up any stuck training processes before starting
 * Prevents resource conflicts and hung processes from blocking new training runs
 */
function cleanupStuckProcesses(username: string) {
  console.log('[full-cycle-local] Checking for stuck training processes...');

  try {
    // Find all full-cycle and dataset-builder processes for this user
    const psOutput = execSync(
      `ps aux | grep -E "full-cycle.ts|full-cycle-local.ts|ai-dataset-builder.ts|adapter-builder.ts" | grep "${username}" | grep -v grep | awk '{print $2}'`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }
    ).trim();

    if (psOutput) {
      const pids = psOutput.split('\n').filter(Boolean);
      const currentPid = process.pid.toString();

      // Filter out our own PID
      const stuckPids = pids.filter(pid => pid !== currentPid);

      if (stuckPids.length > 0) {
        console.log(`[full-cycle-local] Found ${stuckPids.length} stuck process(es): ${stuckPids.join(', ')}`);
        console.log('[full-cycle-local] Killing stuck processes...');

        for (const pid of stuckPids) {
          try {
            execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
          } catch (err) {
            // Process may have already exited, ignore
          }
        }

        console.log('[full-cycle-local] Stuck processes cleaned up');
      } else {
        console.log('[full-cycle-local] No stuck processes found');
      }
    } else {
      console.log('[full-cycle-local] No stuck processes found');
    }
  } catch (err) {
    // ps command returned no results or failed - not critical
    console.log('[full-cycle-local] Process cleanup check complete');
  }

  // Unload Ollama models to free resources
  try {
    console.log('[full-cycle-local] Unloading Ollama models to free resources...');
    execSync('curl -s http://localhost:11434/api/generate -d \'{"model": "", "keep_alive": 0}\'', {
      timeout: 2000,
      stdio: 'ignore',
    });
    console.log('[full-cycle-local] Ollama models unloaded');
  } catch (err) {
    // Ollama may not be running or may timeout - not critical
    console.log('[full-cycle-local] Ollama cleanup skipped (may not be running)');
  }

  // Clean up stale PID files
  try {
    const pidFile = path.join(systemPaths.logs, 'run', `full-cycle-local-${username}.pid`);
    if (fs.existsSync(pidFile)) {
      fs.rmSync(pidFile, { force: true });
      console.log('[full-cycle-local] Removed stale PID file');
    }
  } catch (err) {
    // Not critical
  }

  console.log('[full-cycle-local] Pre-flight cleanup complete\n');
}

async function runAgent(agentName: string, args: string[] = []): Promise<number> {
  return new Promise((resolve, reject) => {
    const agentPath = path.join(systemPaths.brain, 'agents', `${agentName}.ts`);
    if (!fs.existsSync(agentPath)) {
      console.error(`[full-cycle-local] Agent not found: ${agentName}`);
      return resolve(1);
    }

    console.log(`[full-cycle-local] Running agent: ${agentName} with args: ${args.join(' ')}`);
    const child = spawn(TSX_PATH, [agentPath, ...args], { cwd: systemPaths.root, stdio: ['inherit', 'pipe', 'pipe'] });

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

  // ROBUSTNESS: Clean up stuck processes before starting
  cleanupStuckProcesses(ctx.username);

  currentRunId = randomBytes(8).toString('hex');
  console.log(`[${new Date().toISOString()}] === Starting local full cycle for user: ${ctx.username} (${currentRunId}) ===`);

  // User-specific paths
  if (!ctx.profilePaths) {
    console.error('[full-cycle-local] ERROR: User context missing profilePaths');
    process.exit(1);
  }
  const profileRoot = ctx.profilePaths.root;

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

  // Step 2: Prepare local training data
  mkdirpSync(legacyRunRoot);
  mkdirpSync(WORK_LOCAL);
  mkdirpSync(FINAL_ADAPTER_DIR);

  const RAW_DATA_FILE = path.join(OUT_ROOT, `${RUN_LABEL}.jsonl`);
  const canonicalRawDataFile = path.join(datasetDir, `${DATE_STR}.jsonl`);
  const CLEAN_DATA_FILE = path.join(WORK_LOCAL, 'unsloth_dataset.jsonl');
  const CONFIG_FILE = path.join(WORK_LOCAL, 'config.json');

  mkdirpSync(path.dirname(RAW_DATA_FILE));

  // Step 2.2: Build dataset with advanced curation or classic deduplication
  const datasetStrategy = process.env.METAHUMAN_DATASET_BUILDER?.toLowerCase() || 'advanced';
  let samples_used = 0;

  if (datasetStrategy === 'advanced') {
    // NEW: Use advanced curation pipeline (same as full-cycle.ts)
    console.log('[full-cycle-local] Using advanced curation pipeline');

    const CURATED_PATH = path.join(OUT_ROOT, 'curated_memories.json');
    const FORMATTED_PATH = path.join(OUT_ROOT, 'formatted_samples.json');
    const SCHEMA_PATH = path.join(OUT_ROOT, 'schema_applied.json');

    // Check if preprocessing should be skipped
    const skipPreprocessing = process.env.METAHUMAN_SKIP_PREPROCESSING === '1';

    if (skipPreprocessing) {
      console.log('[full-cycle-local] ⚠️ PREPROCESSING DISABLED BY USER');
      console.log('[full-cycle-local] Skipping LLM curator - will use existing curated conversations only');
    } else {
      // Step 0: Pre-curation pass - LLM curator finishes any uncurated memories
      console.log('[full-cycle-local] STEP 0/4: Pre-curation pass (LLM curator finishing uncurated memories)...');
      console.log('[full-cycle-local] Processing remaining uncurated memories before aggregation');

      try {
        const llmCuratorCode = await runAgent('curator', ['--username', ctx.username]);
        if (llmCuratorCode === 0) {
          console.log('[full-cycle-local] ✅ Pre-curation pass completed successfully');
        } else {
          console.warn(`[full-cycle-local] ⚠️  Pre-curation pass exited with code ${llmCuratorCode}, continuing...`);
        }
      } catch (curatorError) {
        console.warn('[full-cycle-local] ⚠️  Pre-curation pass failed:', (curatorError as Error).message);
        console.warn('[full-cycle-local] Continuing with available curated memories...');
      }
    }

    // Step 1: Aggregate curated conversations from curator.ts output
    console.log('[full-cycle-local] STEP 1/4: Aggregating curated conversations...');
    if (!skipPreprocessing) {
      console.log('[full-cycle-local] Using LLM-curated conversations from curator agent');
    } else {
      console.log('[full-cycle-local] Using existing curated conversations (no new curation)');
    }

    const aggregatorArgs = ['--username', ctx.username, '--output', CURATED_PATH];

    // Note: Monthly training strategy is handled by curator.ts incrementally
    // The curator processes ~50 memories per run and maintains quality over time
    // For training, we simply aggregate all available curated conversations

    if (process.env.METAHUMAN_MAX_SAMPLES) {
      aggregatorArgs.push('--max', process.env.METAHUMAN_MAX_SAMPLES);
    }

    const aggregatorCode = await runAgent('curated-aggregator', aggregatorArgs);
    if (aggregatorCode !== 0) {
      throw new Error('Curated conversation aggregation failed');
    }

    // Step 2: Format samples (add cognitive mode tags)
    console.log('[full-cycle-local] STEP 2/4: Formatting samples with mode tags...');
    const formatterArgs = ['--input', CURATED_PATH, '--output', FORMATTED_PATH];
    const formatterCode = await runAgent('mode-formatter', formatterArgs);
    if (formatterCode !== 0) {
      throw new Error('Mode formatting failed');
    }

    // Step 3: Apply schema (model-family specific wrapping)
    console.log('[full-cycle-local] STEP 3/4: Applying schema wrappers...');
    const formattedContent = fs.readFileSync(FORMATTED_PATH, 'utf-8');
    const formattedSamples = JSON.parse(formattedContent) as FormattedSample[];

    // Get base model from config (will be loaded below)
    const trainingConfigPath = path.join(systemPaths.etc, 'training.json');
    let baseModel = 'unsloth/Qwen3-14B'; // default
    if (fs.existsSync(trainingConfigPath)) {
      const cfg = JSON.parse(fs.readFileSync(trainingConfigPath, 'utf-8'));
      baseModel = process.env.METAHUMAN_BASE_MODEL || cfg.base_model || baseModel;
    }

    console.log(`[full-cycle-local] Applying schema for base model: ${baseModel}`);
    const schemaAppliedSamples: SchemaAppliedSample[] = applySchemaBatch(formattedSamples, baseModel);
    fs.writeFileSync(SCHEMA_PATH, JSON.stringify(schemaAppliedSamples, null, 2));

    // Step 4: Export to JSONL
    console.log('[full-cycle-local] STEP 4/4: Exporting to JSONL...');
    const jsonlLines: string[] = [];
    for (const sample of schemaAppliedSamples) {
      // Unsloth expects: instruction (user), input (optional context), output (assistant)
      // SchemaAppliedSample has wrapped input/output ready for training
      jsonlLines.push(JSON.stringify({
        instruction: sample.input,  // Wrapped user input (with mode tags)
        input: '',                   // No additional context needed
        output: sample.output        // Wrapped assistant output (with mode tags)
      }));
    }
    fs.writeFileSync(CLEAN_DATA_FILE, jsonlLines.join('\n'));
    fs.writeFileSync(RAW_DATA_FILE, jsonlLines.join('\n')); // For compatibility
    fs.writeFileSync(canonicalRawDataFile, jsonlLines.join('\n'));

    samples_used = schemaAppliedSamples.length;
    console.log(`[full-cycle-local] Advanced curation complete: ${samples_used} high-quality samples`);

  } else {
    // Classic mode: Simple deduplication (legacy behavior)
    console.log('[full-cycle-local] Using classic deduplication strategy');

    const instructionsPath = path.join(datasetDir, 'instructions.jsonl');

    // If dataset doesn't exist, run adapter-builder
    if (!fs.existsSync(datasetDir) || !fs.existsSync(instructionsPath)) {
      console.log('[full-cycle-local] Building new dataset with adapter-builder...');
      const buildRc = await runAgent('adapter-builder');
      if (buildRc !== 0) {
        throw new Error('adapter-builder failed');
      }
    }

    // Copy instructions to raw dataset file
    try {
      fs.copyFileSync(instructionsPath, RAW_DATA_FILE);
      fs.copyFileSync(instructionsPath, canonicalRawDataFile);
    } catch (copyErr) {
      console.warn('[full-cycle-local] Failed to copy dataset:', (copyErr as Error).message);
    }

    // Simple deduplication
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

    if (duplicateCount > 0) {
      console.log(`[full-cycle-local] Removed ${duplicateCount} duplicate samples`);
    }
    console.log(`[full-cycle-local] Kept ${samples_used} unique samples after cleaning`);

    if (samples_used === 0) {
      throw new Error('CLEAN_DATA_FILE ended up empty after cleaning');
    }
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
