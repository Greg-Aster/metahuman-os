/**
 * User-Aware Full Cycle Orchestrator - Remote Training Version
 * Runs training on RunPod for a specific user's profile
 *
 * 1) Build dataset
 * 2) Prepare config
 * 3) Run remote training via runRemoteTraining()
 * 4) If successful: Evaluate adapter, activate adapter, auto-load to Ollama
 * 5) If failed: Write summary and exit with error
 *
 * Usage:
 *   npx tsx brain/agents/full-cycle.ts --username <username>
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { systemPaths, audit, setActiveAdapter } from '../../packages/core/src/index.js';
import { withUserContext, getUserContext } from '../../packages/core/src/context.js';
import { requireUserInfo } from '../../packages/core/src/user-resolver.js';
import dotenv from 'dotenv';
const mkdirpSync = (dir: string) => fs.mkdirSync(dir, { recursive: true });
import { runRemoteTraining } from './lora-trainer';
import { randomBytes } from 'node:crypto';
import type { ActiveAdapterInfo } from '../../packages/core/src/adapters.js';
import { applySchemaBatch } from '../../packages/core/src/schema-manager.js';
import type { FormattedSample, SchemaAppliedSample } from '../../packages/core/src/schema-manager.js';

// Load environment variables from .env file FIRST
dotenv.config({ path: path.join(systemPaths.root, '.env') });

// This will hold the ID for the current run, so the catch handler can access it.
let currentRunId: string | null = null;
let currentRunLabel: string | null = null;
let currentWorkLocal: string | null = null;
let currentRunOutputDir: string | null = null;

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
    console.warn(`[full-cycle] Failed to remove ${target}: ${(err as Error).message}`);
  }
}

function cleanupAfterSuccessfulMerge(runRoot: string, workLocal?: string) {
  safeRemove(path.join(runRoot, 'merged_gguf_output'));
  if (workLocal) {
    safeRemove(path.join(workLocal, 'adapter_base64.txt'));
    safeRemove(path.join(workLocal, 'temp_adapter_download'));
  }
}

/**
 * ROBUSTNESS: Clean up any stuck training processes before starting
 * Prevents resource conflicts and hung processes from blocking new training runs
 */
function cleanupStuckProcesses(username: string) {
  console.log('[full-cycle] Checking for stuck training processes...');

  try {
    // Find all full-cycle and dataset-builder processes for this user
    const psOutput = execSync(
      `ps aux | grep -E "full-cycle.ts|ai-dataset-builder.ts|adapter-builder.ts" | grep "${username}" | grep -v grep | awk '{print $2}'`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }
    ).trim();

    if (psOutput) {
      const pids = psOutput.split('\n').filter(Boolean);
      const currentPid = process.pid.toString();

      // Filter out our own PID
      const stuckPids = pids.filter(pid => pid !== currentPid);

      if (stuckPids.length > 0) {
        console.log(`[full-cycle] Found ${stuckPids.length} stuck process(es): ${stuckPids.join(', ')}`);
        console.log('[full-cycle] Killing stuck processes...');

        for (const pid of stuckPids) {
          try {
            execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
          } catch (err) {
            // Process may have already exited, ignore
          }
        }

        console.log('[full-cycle] Stuck processes cleaned up');
      } else {
        console.log('[full-cycle] No stuck processes found');
      }
    } else {
      console.log('[full-cycle] No stuck processes found');
    }
  } catch (err) {
    // ps command returned no results or failed - not critical
    console.log('[full-cycle] Process cleanup check complete');
  }

  // Unload Ollama models to free resources
  try {
    console.log('[full-cycle] Unloading Ollama models to free resources...');
    execSync('curl -s http://localhost:11434/api/generate -d \'{"model": "", "keep_alive": 0}\'', {
      timeout: 2000,
      stdio: 'ignore',
    });
    console.log('[full-cycle] Ollama models unloaded');
  } catch (err) {
    // Ollama may not be running or may timeout - not critical
    console.log('[full-cycle] Ollama cleanup skipped (may not be running)');
  }

  // Clean up stale PID files
  try {
    const pidFile = path.join(systemPaths.logs, 'run', `full-cycle-${username}.pid`);
    if (fs.existsSync(pidFile)) {
      fs.rmSync(pidFile, { force: true });
      console.log('[full-cycle] Removed stale PID file');
    }
  } catch (err) {
    // Not critical
  }

  console.log('[full-cycle] Pre-flight cleanup complete\n');
}

async function runAgent(agentName: string, args: string[] = [], username?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const agentPath = path.join(systemPaths.brain, 'agents', `${agentName}.ts`);
    if (!fs.existsSync(agentPath)) {
      console.error(`[full-cycle] Agent not found: ${agentName}`);
      return resolve(1);
    }

    // Pass username to subprocess so it can establish user context
    const allArgs = username ? ['--username', username, ...args] : args;
    console.log(`[full-cycle] Running agent: ${agentName} with args: ${allArgs.join(' ')}`);
    const child = spawn('tsx', [agentPath, ...allArgs], { cwd: systemPaths.root, stdio: ['inherit', 'pipe', 'pipe'] });

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
      console.error(`[full-cycle] Failed to start agent: ${agentName}`, err);
      reject(err);
    });

    child.on('close', (code) => {
      if (code !== 0) {
        console.error(`[full-cycle] Agent ${agentName} exited with code ${code}`);
        audit({
          level: 'error',
          category: 'action',
          event: `${agentName}_failed`,
          details: { args, stdout, stderr },
          actor: 'full-cycle',
        });
      }
      resolve(code || 0);
    });
  });
}

function buildDatasetFromJsonl(rawJsonlPath: string, cleanJsonlPath: string): number {
  console.log('[full-cycle] Building dataset from JSONL...');
  const rawContent = fs.readFileSync(rawJsonlPath, 'utf-8');
  const lines = rawContent.split('\n').filter(Boolean);
  let keptCount = 0;
  let duplicateCount = 0;

  // Use a Set to track unique samples (by stringified content)
  const seenSamples = new Set<string>();

  const outputStream = fs.createWriteStream(cleanJsonlPath);

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.instruction && obj.output) {
        const cleanObj = {
          instruction: obj.instruction,
          input: obj.input || '',
          output: obj.output
        };

        // Create a fingerprint for deduplication
        const fingerprint = JSON.stringify(cleanObj);

        // Skip if we've seen this exact sample before
        if (seenSamples.has(fingerprint)) {
          duplicateCount++;
          continue;
        }

        seenSamples.add(fingerprint);
        outputStream.write(fingerprint + '\n');
        keptCount++;
      }
    } catch (e) {
      console.warn(`[full-cycle] Skipping invalid JSON line:`, line.substring(0, 100));
    }
  }

  outputStream.end();

  if (duplicateCount > 0) {
    console.log(`[full-cycle] Removed ${duplicateCount} duplicate samples`);
  }

  return keptCount;
}

function writeDebugLog(message: string, details?: any) {
  const logPath = '/tmp/full-cycle-debug.log';
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}${details ? '\n' + JSON.stringify(details, null, 2) : ''}`;
  console.log(logMessage);
  fs.appendFileSync(logPath, logMessage + '\n');
}

async function mainWithContext() {
  const ctx = getUserContext();

  if (!ctx) {
    console.error('[full-cycle] ERROR: No user context found.');
    console.error('[full-cycle] This must be run with withUserContext()');
    process.exit(1);
  }

  // ROBUSTNESS: Clean up stuck processes before starting
  cleanupStuckProcesses(ctx.username);

  currentRunId = randomBytes(8).toString('hex');
  writeDebugLog(`=== Starting remote full cycle for user: ${ctx.username} (${currentRunId}) ===`);

  // User-specific paths
  if (!ctx.profilePaths) {
    console.error('[full-cycle] ERROR: User context missing profilePaths');
    process.exit(1);
  }
  const profileRoot = ctx.profilePaths.root;

  // 2.1. Compute run identifiers and paths
  const now = new Date();
  const DATE_STR = now.toISOString().slice(0, 10); // e.g. "2025-10-24"
  const TIME_STR = now.toISOString().slice(11, 19).replace(/:/g, '');
  const runSuffix = (currentRunId || randomBytes(4).toString('hex')).slice(0, 6);
  const RUN_LABEL = `${DATE_STR}-${TIME_STR}-${runSuffix}`;
  currentRunLabel = RUN_LABEL;

  const PROJECT_ROOT = systemPaths.root;
  // User-specific dataset directory
  const datasetDir = path.join(profileRoot, 'out', 'adapters', DATE_STR);
  const OUT_ROOT = path.join(datasetDir, RUN_LABEL);
  const WORK_LOCAL = path.join(PROJECT_ROOT, 'metahuman-runs', ctx.username, DATE_STR, RUN_LABEL);
  const legacyRunRoot = path.join(PROJECT_ROOT, 'metahuman-runs', ctx.username, DATE_STR);
  const FINAL_ADAPTER_DIR = path.join(OUT_ROOT, 'adapter');
  currentWorkLocal = WORK_LOCAL;
  currentRunOutputDir = OUT_ROOT;

  const RAW_DATA_FILE = path.join(OUT_ROOT, `${RUN_LABEL}.jsonl`);
  const CLEAN_DATA_FILE = path.join(WORK_LOCAL, 'unsloth_dataset.jsonl');
  const CONFIG_FILE = path.join(WORK_LOCAL, 'config.json');
  const SUMMARY_FILE = path.join(WORK_LOCAL, 'run-summary.json');
  const UPLOAD_PROOF_REMOTE = "/workspace/input/upload.ok";
  const TAR_STAGING_LOCAL = path.join(WORK_LOCAL, 'adapter_base64.txt');
  const uniqueRunInfoPath = path.join(datasetDir, `${RUN_LABEL}-run.json`);

  console.log('[full-cycle] Preparing dataset...');
  audit({ level: 'info', category: 'action', event: 'full_cycle_started', details: { date: DATE_STR, run_id: currentRunId, run_label: RUN_LABEL, username: ctx.username }, actor: ctx.username });

  // Ensure dirs exist
  try {
    mkdirpSync(WORK_LOCAL);
    mkdirpSync(legacyRunRoot);
    mkdirpSync(FINAL_ADAPTER_DIR);
  } catch (error) {
    console.error('[full-cycle] Failed to create directories:', error);
    // Write a minimal failed summary
    const failedSummary = {
      run_id: currentRunId,
      run_label: RUN_LABEL,
      date: DATE_STR,
      training_success: false,
      terminated: false,
      error: `Failed to create directories: ${(error as Error).message}`
    };
    fs.writeFileSync(SUMMARY_FILE, JSON.stringify(failedSummary, null, 2));
    throw error;
  }

  // 2.2. Build dataset (local)
  const datasetStrategy = process.env.METAHUMAN_DATASET_BUILDER?.toLowerCase() || 'advanced';
  let samples_used = 0;

  if (datasetStrategy === 'advanced') {
    // NEW: Use advanced curation pipeline (same as fine-tune-cycle.ts)
    console.log('[full-cycle] Using advanced curation pipeline');

    const CURATED_PATH = path.join(OUT_ROOT, 'curated_memories.json');
    const FORMATTED_PATH = path.join(OUT_ROOT, 'formatted_samples.json');
    const SCHEMA_PATH = path.join(OUT_ROOT, 'schema_applied.json');

    // Step 1: Curate memories (advanced quality filtering)
    console.log('[full-cycle] STEP 1/4: Curating memories...');
    const curatorArgs = ['--username', ctx.username, '--output', CURATED_PATH];

    // Support monthly training strategy from env vars
    if (process.env.METAHUMAN_DAYS_RECENT || process.env.METAHUMAN_OLD_SAMPLES) {
      const daysRecent = process.env.METAHUMAN_DAYS_RECENT || '30';
      const oldSamples = process.env.METAHUMAN_OLD_SAMPLES || '3000';
      curatorArgs.push('--days-recent', daysRecent);
      curatorArgs.push('--old-samples', oldSamples);
      console.log(`[full-cycle] Using monthly strategy (${daysRecent} days recent + ${oldSamples} old)`);
    }

    if (process.env.METAHUMAN_MAX_SAMPLES) {
      curatorArgs.push('--max', process.env.METAHUMAN_MAX_SAMPLES);
    }

    const curatorCode = await runAgent('memory-curator', curatorArgs, ctx.username);
    if (curatorCode !== 0) {
      throw new Error('Memory curation failed');
    }

    // Step 2: Format samples (add cognitive mode tags)
    console.log('[full-cycle] STEP 2/4: Formatting samples with mode tags...');
    const formatterArgs = ['--input', CURATED_PATH, '--output', FORMATTED_PATH];
    const formatterCode = await runAgent('mode-formatter', formatterArgs, ctx.username);
    if (formatterCode !== 0) {
      throw new Error('Mode formatting failed');
    }

    // Step 3: Apply schema (model-family specific wrapping)
    console.log('[full-cycle] STEP 3/4: Applying schema wrappers...');
    const formattedContent = fs.readFileSync(FORMATTED_PATH, 'utf-8');
    const formattedSamples = JSON.parse(formattedContent) as FormattedSample[];

    // Get base model from config (will be loaded below)
    const trainingConfigPath = path.join(systemPaths.etc, 'training.json');
    let baseModel = 'unsloth/Qwen3-14B'; // default
    if (fs.existsSync(trainingConfigPath)) {
      const cfg = JSON.parse(fs.readFileSync(trainingConfigPath, 'utf-8'));
      baseModel = process.env.METAHUMAN_BASE_MODEL || cfg.base_model || baseModel;
    }

    console.log(`[full-cycle] Applying schema for base model: ${baseModel}`);
    const schemaAppliedSamples: SchemaAppliedSample[] = applySchemaBatch(formattedSamples, baseModel);
    fs.writeFileSync(SCHEMA_PATH, JSON.stringify(schemaAppliedSamples, null, 2));

    // Step 4: Export to JSONL
    console.log('[full-cycle] STEP 4/4: Exporting to JSONL...');
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

    samples_used = schemaAppliedSamples.length;
    console.log(`[full-cycle] Advanced curation complete: ${samples_used} high-quality samples`);

  } else if (datasetStrategy === 'ai') {
    console.log('[full-cycle] Using AI dataset builder strategy');
    const aiBuilderPath = path.join(systemPaths.brain, 'agents', 'ai-dataset-builder.ts');
    const args = ['tsx', aiBuilderPath, '--output', CLEAN_DATA_FILE];
    // BUGFIX: Pass username to ensure we only process this user's memories
    args.push('--username', ctx.username);
    if (process.env.METAHUMAN_DATASET_MAX) {
      args.push('--max', process.env.METAHUMAN_DATASET_MAX);
    }
    if (process.env.METAHUMAN_DATASET_CHUNK) {
      args.push('--chunk', process.env.METAHUMAN_DATASET_CHUNK);
    }
    if (process.env.METAHUMAN_DATASET_MODEL) {
      args.push('--model', process.env.METAHUMAN_DATASET_MODEL);
    }

    console.log(`[full-cycle] Running: ${args.join(' ')}`);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(args[0], args.slice(1), { cwd: systemPaths.root, stdio: 'inherit' });
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
    console.log(`[full-cycle] AI builder produced ${samples_used} samples`);

    // For compatibility write RAW_DATA_FILE as a copy if needed
    try {
      if (!fs.existsSync(RAW_DATA_FILE)) {
        fs.copyFileSync(CLEAN_DATA_FILE, RAW_DATA_FILE);
      }
    } catch (copyErr) {
      console.warn('[full-cycle] Failed to copy AI dataset to raw path:', (copyErr as Error).message);
    }
  } else {
    // First run adapter-builder to generate raw dataset
    writeDebugLog('Checking dataset directory', { datasetDir });
    
    if (!fs.existsSync(datasetDir) || !fs.existsSync(path.join(datasetDir, 'instructions.jsonl'))) {
      writeDebugLog('Dataset directory or instructions.jsonl not found, running adapter-builder');
      const rc = await runAgent('adapter-builder', [], ctx.username);
      writeDebugLog('adapter-builder completed', { exitCode: rc });
      if (rc !== 0) throw new Error('adapter-builder failed');
    } else {
      writeDebugLog('Dataset directory and instructions.jsonl exist, skipping adapter-builder');
    }

    // Copy raw dataset to RAW_DATA_FILE if needed
    const jsonlPath = path.join(datasetDir, 'instructions.jsonl');
    if (!fs.existsSync(RAW_DATA_FILE)) {
      fs.copyFileSync(jsonlPath, RAW_DATA_FILE);
    }

    // Clean the dataset - parse each line and keep only {instruction, input, output}
    samples_used = buildDatasetFromJsonl(RAW_DATA_FILE, CLEAN_DATA_FILE);
    console.log(`[full-cycle] Kept ${samples_used} samples after cleaning`);

    if (samples_used === 0) {
      throw new Error('CLEAN_DATA_FILE ended up empty after cleaning');
    }
  }

  try {
    const legacyDatasetPath = path.join(legacyRunRoot, 'unsloth_dataset.jsonl');
    const uniqueDatasetPath = path.join(legacyRunRoot, `unsloth_dataset-${RUN_LABEL}.jsonl`);
    fs.copyFileSync(CLEAN_DATA_FILE, uniqueDatasetPath);
    fs.copyFileSync(CLEAN_DATA_FILE, legacyDatasetPath);
  } catch (datasetCopyErr) {
    console.warn('[full-cycle] Failed to copy cleaned dataset to legacy location:', (datasetCopyErr as Error).message);
  }

  // 2.3. Load training config from etc/training.json
  const trainingConfigPath = path.join(systemPaths.etc, 'training.json');
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

  // Load from etc/training.json if it exists
  if (fs.existsSync(trainingConfigPath)) {
    try {
      const loadedConfig = JSON.parse(fs.readFileSync(trainingConfigPath, 'utf-8'));
      // Merge loaded config, excluding comment/notes fields
      const { comment, notes, ...trainingParams } = loadedConfig;
      config = { ...config, ...trainingParams };
      console.log(`[full-cycle] Loaded training config from ${trainingConfigPath}`);
    } catch (error) {
      console.warn(`[full-cycle] Failed to load training config: ${(error as Error).message}`);
    }
  }

  // Environment variable override for base_model (highest priority)
  if (process.env.METAHUMAN_BASE_MODEL) {
    config.base_model = process.env.METAHUMAN_BASE_MODEL;
    console.log(`[full-cycle] Using base model from env: ${config.base_model}`);
  }

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));

  // Document the base model used for training
  console.log(`[full-cycle] Training base model: ${config.base_model}`);
  console.log('[full-cycle] Note: The merged GGUF will contain both base model + adapter');
  console.log('[full-cycle] No separate base model is needed in the Modelfile\n');

  // 2.4. Call the new remote trainer
  writeDebugLog('Starting remote training with parameters', {
    run_id: currentRunId,
    DATE_STR,
    WORK_LOCAL,
    OUT_ROOT,
    FINAL_ADAPTER_DIR,
    RAW_DATA_FILE,
    CLEAN_DATA_FILE,
    CONFIG_FILE,
    SUMMARY_FILE,
    samples_used,
  });
  
  const result = await runRemoteTraining({
    run_id: currentRunId,
    DATE_STR,
    RUN_LABEL,
    WORK_LOCAL,
    OUT_ROOT,
    FINAL_ADAPTER_DIR,
    RAW_DATA_FILE,
    CLEAN_DATA_FILE,
    CONFIG_FILE,
    SUMMARY_FILE,
    samples_used,
  });

  console.log(`[full-cycle] Remote training complete, success=${result.training_success}`);

  // Keep legacy summary copies for compatibility
  try {
    mkdirpSync(legacyRunRoot);
    const legacySummaryPath = path.join(legacyRunRoot, 'run-summary.json');
    const uniqueSummaryPath = path.join(legacyRunRoot, `run-summary-${RUN_LABEL}.json`);
    fs.copyFileSync(SUMMARY_FILE, uniqueSummaryPath);
    fs.copyFileSync(SUMMARY_FILE, legacySummaryPath);
    const trainingOutputPath = path.join(WORK_LOCAL, 'training_output.txt');
    if (fs.existsSync(trainingOutputPath)) {
      fs.copyFileSync(trainingOutputPath, path.join(legacyRunRoot, `training_output-${RUN_LABEL}.txt`));
    }
  } catch (copyErr) {
    console.warn('[full-cycle] Failed to copy run summary to legacy location:', (copyErr as Error).message);
  }

  if (!result.training_success) {
    console.error('[full-cycle] Remote training failed, stopping early but summary written');
    // Summary is already written by runRemoteTraining, so just exit
    process.exit(1);
  }

  // Continue with post-processing steps if training was successful
  console.log('[full-cycle] Merging adapters...');
  
  // Now that adapter is downloaded, run the remaining steps
  const adapterPath = path.join(FINAL_ADAPTER_DIR, 'adapter_model.safetensors');

  // If no adapter produced, pause gracefully
  if (!fs.existsSync(adapterPath)) {
    audit({
      level: 'info',
      category: 'action',
      event: 'full_cycle_waiting_for_adapter',
      details: { date: DATE_STR, datasetDir },
      actor: 'full-cycle',
    })
    console.log('[full-cycle] No adapter weights found after remote training.');
    return;
  }

  const canonicalSafetensors = path.join(datasetDir, 'adapter_model.safetensors');
  // Note: We don't create timestamped copies - files already exist in run directories
  // Symlinks provide access without duplicating storage
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
    console.warn('[full-cycle] Failed to symlink adapter_model.safetensors, falling back to copy:', (e as Error).message);
    try {
      fs.copyFileSync(adapterPath, canonicalSafetensors);
    } catch (copyErr) {
      console.warn('[full-cycle] Failed to copy adapter_model.safetensors into dataset directory:', (copyErr as Error).message);
    }
  }

  // Step 4: Evaluation is now obsolete as the training pipeline produces a final GGUF directly.
  // The eval-adapter agent was designed for intermediate safetensors files.
  // We will proceed directly to activation.

  // Step 4.5: Merge historical adapters (if multiple exist and dual mode is enabled)
  const adaptersRoot = path.join(profileRoot, 'out', 'adapters');
  const allAdapterDates = fs.readdirSync(adaptersRoot)
    .filter(name => /^\d{4}-\d{2}-\d{2}$/.test(name) && name !== DATE_STR)
    .sort();

  let mergedAdapterPath: string | null = null;
  const dualModeEnabled = process.env.METAHUMAN_DUAL_MODE === '1';

  // Only merge if dual mode is explicitly enabled or if we have historical adapters and dual mode isn't explicitly disabled
  if ((allAdapterDates.length >= 1) && (dualModeEnabled || process.env.METAHUMAN_DUAL_MODE === undefined)) {
    // Multiple adapters exist, merge historical ones
    audit({ level: 'info', category: 'action', event: 'full_cycle_merging_adapters', details: { historicalCount: allAdapterDates.length, dualMode: dualModeEnabled }, actor: 'full-cycle' })

    const rc = await runAgent('adapter-merger', [], ctx.username);
    if (rc === 0) {
      // Check if merge succeeded
      const mergedDir = path.join(adaptersRoot, 'history-merged');
      const mergedGGUF = path.join(mergedDir, 'adapter-merged.gguf');
      if (fs.existsSync(mergedGGUF)) {
        mergedAdapterPath = mergedGGUF;
        audit({ level: 'info', category: 'action', event: 'full_cycle_merge_completed', details: { mergedPath: mergedAdapterPath }, actor: 'full-cycle' });
      }
    } else {
      console.warn('[full-cycle] Adapter merge failed, continuing with single adapter');
    }
  }

  // GGUF conversion is now done on the RunPod during training
  // The merged GGUF file has already been downloaded to adapter.gguf
  console.log('[full-cycle] Skipping GGUF conversion (already merged on RunPod)...');

  // Step 5: Activate - Create Modelfile that loads the merged GGUF directly
  const modelName = `${ctx.username}-${DATE_STR}`;
  const personaName = ctx.username.charAt(0).toUpperCase() + ctx.username.slice(1);
  const recentGGUF = path.join(OUT_ROOT, 'adapter.gguf');
  const canonicalGGUF = path.join(datasetDir, 'adapter.gguf');

  // Verify the merged GGUF exists
  if (!fs.existsSync(recentGGUF)) {
    throw new Error(`Merged GGUF not found at ${recentGGUF}. Training may have failed.`);
  }

  // Note: Removed timestamped copy creation - files already exist in run directories
  // Symlinks provide access to latest without duplicating storage

  try {
    if (fs.existsSync(canonicalGGUF) || fs.lstatSync(canonicalGGUF)) {
      fs.rmSync(canonicalGGUF);
    }
  } catch {
    // Ignore if nothing to remove
  }

  try {
    const relative = path.relative(datasetDir, recentGGUF);
    fs.symlinkSync(relative, canonicalGGUF);
  } catch (e) {
    console.warn('[full-cycle] Failed to create adapter.gguf symlink, falling back to copy:', (e as Error).message);
    try {
      fs.copyFileSync(recentGGUF, canonicalGGUF);
    } catch (copyErr) {
      console.warn('[full-cycle] Failed to copy adapter.gguf into dataset directory:', (copyErr as Error).message);
    }
  }

  let modelfile: string;
  // Check if dual mode is enabled or if we have both adapters and dual wasn't explicitly disabled
  const shouldUseDual = mergedAdapterPath && fs.existsSync(recentGGUF) && (dualModeEnabled || process.env.METAHUMAN_DUAL_MODE === undefined);

  if (shouldUseDual) {
    // WARNING: Dual-adapter mode may not work with Qwen3-30B (llama.cpp limitation)
    // The merged GGUF is loaded as the base, and historical adapter applied on top
    console.warn('[full-cycle] Warning: Dual-adapter mode may not work with Qwen3-30B architecture');
    console.warn('[full-cycle] Consider disabling dual mode: export METAHUMAN_DUAL_MODE=0');

    modelfile = `# MetaHuman OS Dual-Adapter Model - ${ctx.username} - ${DATE_STR}
# WARNING: This may not work with Qwen3-30B due to llama.cpp limitations
FROM ${recentGGUF}
ADAPTER ${mergedAdapterPath}

SYSTEM You are ${personaName}'s digital personality extension. Speak naturally in first person as ${personaName}.
`;

    audit({ level: 'info', category: 'action', event: 'full_cycle_dual_adapter_modelfile', details: { base: recentGGUF, historical: mergedAdapterPath, username: ctx.username }, actor: ctx.username });
  } else {
    // Single merged model - NO ADAPTER keyword needed
    // This is the recommended approach for Qwen3-30B
    modelfile = `# MetaHuman OS Fully-Merged Model - ${ctx.username} - ${DATE_STR}
# This GGUF contains both the base model and trained adapter (merged on RunPod)
FROM ${recentGGUF}

TEMPLATE """{{ if .System }}<|im_start|>system
{{ .System }}<|im_end|>
{{ end }}{{ if .Prompt }}<|im_start|>user
{{ .Prompt }}<|im_end|>
{{ end }}<|im_start|>assistant
{{ .Response }}<|im_end|>
"""

SYSTEM You are ${personaName}'s digital personality extension. Speak naturally in first person as ${personaName}.
`;

    console.log('[full-cycle] Using single fully-merged model (recommended for Qwen3-30B)');
    audit({ level: 'info', category: 'action', event: 'full_cycle_single_merged_modelfile', details: { ggufPath: recentGGUF, run_label: RUN_LABEL, username: ctx.username }, actor: ctx.username });
  }

  const modelfilePath = path.join(OUT_ROOT, 'Modelfile');
  fs.writeFileSync(modelfilePath, modelfile);

  const canonicalModelfile = path.join(datasetDir, 'Modelfile');
  const uniqueModelfile = path.join(datasetDir, `Modelfile-${RUN_LABEL}`);
  try {
    fs.writeFileSync(uniqueModelfile, modelfile);
  } catch (e) {
    console.warn('[full-cycle] Failed to write unique Modelfile copy:', (e as Error).message);
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
    console.warn('[full-cycle] Failed to symlink Modelfile, falling back to copy:', (e as Error).message);
    try {
      fs.copyFileSync(modelfilePath, canonicalModelfile);
    } catch (copyErr) {
      console.warn('[full-cycle] Failed to copy Modelfile into dataset directory:', (copyErr as Error).message);
    }
  }

  const activatedAt = new Date().toISOString();
  const activeInfo: ActiveAdapterInfo = {
    modelName,
    activatedAt,
    adapterPath: recentGGUF,
    dataset: RUN_LABEL,
    date: DATE_STR,
    modelfilePath,
    status: 'ready_for_ollama_load',
    activatedBy: 'full-cycle',
    isDualAdapter: !!mergedAdapterPath,
    runLabel: RUN_LABEL,
    trainingMethod: mergedAdapterPath ? 'remote-dual' : 'remote',
    ggufAdapterPath: recentGGUF,
    baseModel: config.base_model,
  };

  if (mergedAdapterPath) {
    activeInfo.adapters = {
      historical: mergedAdapterPath,
      recent: recentGGUF,
    };
    activeInfo.mergedPath = mergedAdapterPath;
    activeInfo.dual = true;
  }

  setActiveAdapter(activeInfo);

  audit({ level: 'info', category: 'action', event: 'adapter_activated', details: { date: DATE_STR, modelName, auto: true, username: ctx.username }, actor: ctx.username });

  // Step 6: Auto-load into Ollama (best-effort)
  try {
    const { execSync } = await import('node:child_process');
    console.log(`[full-cycle] Creating Ollama model: ${modelName}`);
    execSync(`ollama create ${modelName} -f ${modelfilePath}`, { stdio: 'inherit' });
    const loadedInfo: ActiveAdapterInfo = { ...activeInfo, status: 'loaded' };
    setActiveAdapter(loadedInfo);
  } catch (e) {
    console.warn('[full-cycle] Failed to auto-load model into Ollama:', (e as Error).message);
  }

  try {
    fs.writeFileSync(uniqueRunInfoPath, JSON.stringify({ runId: currentRunId, runLabel: RUN_LABEL, createdAt: new Date().toISOString() }, null, 2));
    fs.writeFileSync(path.join(datasetDir, 'latest-run.json'), JSON.stringify({ runId: currentRunId, runLabel: RUN_LABEL, updatedAt: new Date().toISOString() }, null, 2));
  } catch (e) {
    console.warn('[full-cycle] Failed to record run metadata:', (e as Error).message);
  }

  if (fs.existsSync(recentGGUF)) {
    cleanupAfterSuccessfulMerge(OUT_ROOT, WORK_LOCAL);
  }

  audit({ level: 'info', category: 'action', event: 'full_cycle_completed', details: { date: DATE_STR, run_id: currentRunId, run_label: RUN_LABEL, username: ctx.username }, actor: ctx.username });
  console.log(`\n✅ [full-cycle] Training complete for user: ${ctx.username}`);
  console.log(`   Model name: ${modelName}`);
  console.log(`   Dataset: ${datasetDir}`);

  // Auto-cleanup: Archive old training runs
  try {
    const { autoCleanupTrainingRuns, cleanupOldWorkDirectories } = await import('@metahuman/core');
    await autoCleanupTrainingRuns(ctx.username, RUN_LABEL, false); // false = LoRA adapter
    cleanupOldWorkDirectories(ctx.username);
  } catch (err) {
    console.warn('[full-cycle] Auto-cleanup failed (non-critical):', (err as Error).message);
  }
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
    console.error('[full-cycle] ERROR: --username <name> is required');
    console.error('\nUsage: npx tsx brain/agents/full-cycle.ts --username <username>');
    console.error('\nExample: npx tsx brain/agents/full-cycle.ts --username greggles');
    process.exit(1);
  }

  // Resolve user info
  const userInfo = requireUserInfo(username);

  console.log(`[full-cycle] Starting remote training for user: ${username}`);

  // Run with user context
  await withUserContext(userInfo, mainWithContext);
}

main().catch(err => {
  console.error('[full-cycle] failed:', err);
  // Try to write a partial summary with what we have
  try {
    const fallbackDate = new Date().toISOString().slice(0, 10);
    const fallbackRunLabel = currentRunLabel || `${fallbackDate}-error`;
    const fallbackWorkLocal = currentWorkLocal || path.join(systemPaths.root, 'metahuman-runs', fallbackDate, fallbackRunLabel);
    mkdirpSync(fallbackWorkLocal); // Ensure directory exists
    
    const partialSummary = {
      run_id: currentRunId,
      run_label: currentRunLabel,
      date: fallbackDate,
      training_success: false,
      terminated: false,
      error: String(err),
      pod_id: null,
      ssh_user: null,
      ssh_host: null,
      connection_mode: 'gateway-no-scp-no-pty',
    };
    
    const SUMMARY_FILE = path.join(fallbackWorkLocal, 'run-summary.json');
    fs.writeFileSync(SUMMARY_FILE, JSON.stringify(partialSummary, null, 2));
    try {
      const legacyDir = path.join(systemPaths.root, 'metahuman-runs', fallbackDate);
      mkdirpSync(legacyDir);
      fs.copyFileSync(SUMMARY_FILE, path.join(legacyDir, 'run-summary.json'));
      fs.copyFileSync(SUMMARY_FILE, path.join(legacyDir, `run-summary-${fallbackRunLabel}.json`));
    } catch {}
  } catch (summaryErr) {
    console.error('Failed to write partial summary:', summaryErr);
  }

  audit({ level: 'error', category: 'action', event: 'full_cycle_failed', details: { error: String(err), run_id: currentRunId, run_label: currentRunLabel }, actor: 'full-cycle' });
  process.exit(1);
});
