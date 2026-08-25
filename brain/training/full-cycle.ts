/**
 * User-Aware Full Cycle Orchestrator - Remote Training Version
 * Runs training on RunPod for a specific user's profile
 *
 * 1) Build dataset
 * 2) Prepare config
 * 3) Run remote training via runRemoteTraining()
 * 4) If successful: register the trained artifact and load it when supported
 * 5) If failed: Write summary and exit with error
 *
 * Usage:
 *   pnpm exec tsx brain/training/full-cycle.ts --username <username>
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { systemPaths, audit, loadUserConfig, setActiveAdapter } from '@metahuman/core';
import { withUserContext, getUserContext } from '@metahuman/core/context';
import { requireUserInfo } from '@metahuman/core/user-resolver';
import dotenv from 'dotenv';
const mkdirpSync = (dir: string) => fs.mkdirSync(dir, { recursive: true });
import { runRemoteTraining } from './lora-trainer';
import { randomBytes } from 'node:crypto';
import type { ActiveAdapterInfo } from '@metahuman/core/adapters';
import { applySchemaBatch } from '@metahuman/core/schema-manager';
import type { FormattedSample, SchemaAppliedSample } from '@metahuman/core/schema-manager';
import { DEFAULT_TRAINING_MODEL } from '@metahuman/core/model-defaults';

// Load environment variables from .env file FIRST
dotenv.config({ path: path.join(systemPaths.root, '.env') });

// Resolve tsx path (installed in node_modules/.bin)
const TSX_PATH = path.join(systemPaths.root, 'node_modules', '.bin', 'tsx');

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

async function runAgent(agentName: string, args: string[] = [], username?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const possiblePaths = [
      path.join(systemPaths.brain, 'agents', agentName, 'cli.ts'),
      path.join(systemPaths.brain, 'training', `${agentName}.ts`),
    ];

    const agentPath = possiblePaths.find(p => fs.existsSync(p));
    if (!agentPath) {
      console.error(`[full-cycle] Agent not found: ${agentName}`);
      console.error(`[full-cycle] Checked paths: ${possiblePaths.join(', ')}`);
      return resolve(1);
    }

    // Pass username to subprocess so it can establish user context
    const allArgs = username ? ['--username', username, ...args] : args;
    console.log(`[full-cycle] Running agent: ${agentName} with args: ${allArgs.join(' ')}`);
    const child = spawn(TSX_PATH, [agentPath, ...allArgs], { cwd: systemPaths.root, stdio: ['inherit', 'pipe', 'pipe'] });

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

async function mainWithContext() {
  const ctx = getUserContext();

  if (!ctx) {
    console.error('[full-cycle] ERROR: No user context found.');
    console.error('[full-cycle] This must be run with withUserContext()');
    process.exit(1);
  }

  currentRunId = randomBytes(8).toString('hex');
  console.log(`[full-cycle] Starting remote full cycle for ${ctx.username} (${currentRunId})`);

  // User-specific paths
  if (!ctx.profilePaths) {
    console.error('[full-cycle] ERROR: User context missing profilePaths');
    process.exit(1);
  }
  const profileRoot = ctx.profilePaths.root;
  const profileTrainingConfig = loadUserConfig<Record<string, any>>(
    'training.json',
    {},
    ctx.username,
  );

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

  // 2.2. Build the canonical curated dataset locally.
  let samples_used = 0;

  {
    console.log('[full-cycle] Using canonical curation pipeline');

    const CURATED_PATH = path.join(OUT_ROOT, 'curated_memories.json');
    const FORMATTED_PATH = path.join(OUT_ROOT, 'formatted_samples.json');
    const SCHEMA_PATH = path.join(OUT_ROOT, 'schema_applied.json');

    // Check if preprocessing should be skipped
    const skipPreprocessing = process.env.METAHUMAN_SKIP_PREPROCESSING === '1';

    if (skipPreprocessing) {
      console.log('[full-cycle] ⚠️ PREPROCESSING DISABLED BY USER');
      console.log('[full-cycle] Skipping LLM curator - will use existing curated conversations only');
    } else {
      // Step 0: Pre-curation pass - LLM curator finishes any uncurated memories
      // This will run BEFORE aggregation to maximize available data
      console.log('[full-cycle] STEP 0/4: Pre-curation pass (LLM curator finishing uncurated memories)...');
      console.log('[full-cycle] Processing remaining uncurated memories before aggregation');

      const llmCuratorCode = await runAgent('curator', ['--all'], ctx.username);
      if (llmCuratorCode !== 0) throw new Error(`Pre-curation pass failed with exit code ${llmCuratorCode}`);
      console.log('[full-cycle] ✅ Pre-curation pass completed successfully');
    }

    // Step 1: Aggregate the canonical curated-conversation store
    console.log('[full-cycle] STEP 1/4: Aggregating curated conversations...');
    if (!skipPreprocessing) {
      console.log('[full-cycle] Using LLM-curated conversations from curator agent');
    } else {
      console.log('[full-cycle] Using existing curated conversations (no new curation)');
    }

    const aggregatorArgs = ['--username', ctx.username, '--output', CURATED_PATH];

    // The bounded --all pass above drains available memories before aggregation.

    // Optional mode filter - set METAHUMAN_MODE_FILTER=dual to only include dual mode samples
    // By default, include all modes since emulation mode IS the AI emulating user voice
    if (process.env.METAHUMAN_MODE_FILTER && process.env.METAHUMAN_MODE_FILTER !== 'all') {
      aggregatorArgs.push('--mode', process.env.METAHUMAN_MODE_FILTER);
      console.log(`[full-cycle] Mode filter: ${process.env.METAHUMAN_MODE_FILTER}`);
    }

    if (process.env.METAHUMAN_MAX_SAMPLES) {
      aggregatorArgs.push('--max', process.env.METAHUMAN_MAX_SAMPLES);
    }

    const aggregatorCode = await runAgent('curated-aggregator', aggregatorArgs, ctx.username);
    if (aggregatorCode !== 0) {
      throw new Error('Curated conversation aggregation failed');
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

    const baseModel = process.env.METAHUMAN_BASE_MODEL
      || profileTrainingConfig.base_model
      || DEFAULT_TRAINING_MODEL;

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
    console.log(`[full-cycle] Curation complete: ${samples_used} high-quality samples`);
  }

  // 2.3. Merge the authenticated profile's training configuration.
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

  const { comment, notes, ...trainingParams } = profileTrainingConfig;
  config = { ...config, ...trainingParams };
  console.log(`[full-cycle] Loaded training config from ${path.join(ctx.profilePaths.etc, 'training.json')}`);

  // Environment variable override for base_model (highest priority)
  if (process.env.METAHUMAN_BASE_MODEL) {
    config.base_model = process.env.METAHUMAN_BASE_MODEL;
    console.log(`[full-cycle] Using base model from env: ${config.base_model}`);
  }

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));

  // Document the base model used for training
  console.log(`[full-cycle] Training base model: ${config.base_model}`);
  console.log('[full-cycle] Ollama output is a merged model; vLLM output is one LoRA adapter\n');

  // 2.4. Call the new remote trainer
  console.log('[full-cycle] Starting remote training', {
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
    username: ctx.username,
  });

  console.log(`[full-cycle] Remote training complete, success=${result.training_success}`);

  if (!result.training_success) {
    console.error('[full-cycle] Remote training failed, stopping early but summary written');
    // Summary is already written by runRemoteTraining, so just exit
    process.exit(1);
  }

  // Continue with post-processing steps if training was successful
  console.log('[full-cycle] Preparing the trained artifact...');
  
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

  // The training backend produces the artifact used by the selected runtime.

  const targetBackend = config.trainingTarget === 'vllm' ? 'vllm' : 'ollama';
  const isVllmMode = targetBackend === 'vllm';

  console.log(`[full-cycle] Training target: ${targetBackend}`);

  // Step 5: Activate adapter based on backend
  const modelName = `${ctx.username}-${isVllmMode ? 'vllm-' : ''}${DATE_STR}`;
  const personaName = ctx.username.charAt(0).toUpperCase() + ctx.username.slice(1);
  const safetensorsAdapter = path.join(OUT_ROOT, 'adapter');
  const trainedGGUF = path.join(OUT_ROOT, 'adapter.gguf');
  const canonicalGGUF = path.join(datasetDir, 'adapter.gguf');

  if (isVllmMode) {
    // vLLM mode: Verify safetensors adapter exists
    const adapterConfigPath = path.join(safetensorsAdapter, 'adapter_config.json');
    if (!fs.existsSync(adapterConfigPath)) {
      throw new Error(`Safetensors adapter not found at ${safetensorsAdapter}. Training may have failed.`);
    }
    console.log(`[full-cycle] vLLM mode: Safetensors adapter verified at ${safetensorsAdapter}`);
  } else {
    // Ollama mode: Verify GGUF exists
    if (!fs.existsSync(trainedGGUF)) {
      throw new Error(`Merged GGUF not found at ${trainedGGUF}. Training may have failed.`);
    }
    console.log('[full-cycle] Ollama mode: GGUF adapter verified');
  }

  // Note: Removed timestamped copy creation - files already exist in run directories
  // Symlinks provide access to latest without duplicating storage

  const activatedAt = new Date().toISOString();
  let modelfilePath: string | undefined;

  if (isVllmMode) {
    audit({
      level: 'info',
      category: 'action',
      event: 'training_artifact_registered',
      details: { date: DATE_STR, backend: 'vllm', adapterPath: safetensorsAdapter, username: ctx.username },
      actor: ctx.username,
    });
    console.log(`[full-cycle] vLLM adapter available: ${safetensorsAdapter}`);
    console.log('[full-cycle] Backend Settings owns loading this adapter into vLLM');

  } else {
    // ========== OLLAMA MODE ==========
    // Create GGUF symlinks and Modelfile for Ollama

    try {
      if (fs.existsSync(canonicalGGUF) || fs.lstatSync(canonicalGGUF)) {
        fs.rmSync(canonicalGGUF);
      }
    } catch {
      // Ignore if nothing to remove
    }

    try {
      const relative = path.relative(datasetDir, trainedGGUF);
      fs.symlinkSync(relative, canonicalGGUF);
    } catch (e) {
      console.warn('[full-cycle] Failed to create adapter.gguf symlink, falling back to copy:', (e as Error).message);
      try {
        fs.copyFileSync(trainedGGUF, canonicalGGUF);
      } catch (copyErr) {
        console.warn('[full-cycle] Failed to copy adapter.gguf into dataset directory:', (copyErr as Error).message);
      }
    }

    const modelfile = `# MetaHuman OS Fully-Merged Model - ${ctx.username} - ${DATE_STR}
# This GGUF contains both the base model and trained adapter (merged on RunPod)
FROM ${trainedGGUF}

TEMPLATE """{{ if .System }}<|im_start|>system
{{ .System }}<|im_end|>
{{ end }}{{ if .Prompt }}<|im_start|>user
{{ .Prompt }}<|im_end|>
{{ end }}<|im_start|>assistant
{{ .Response }}<|im_end|>
"""

SYSTEM You are ${personaName}'s digital personality extension. Speak naturally in first person as ${personaName}.
`;

    console.log('[full-cycle] Using the fully merged training artifact');
    audit({ level: 'info', category: 'action', event: 'full_cycle_merged_modelfile', details: { ggufPath: trainedGGUF, run_label: RUN_LABEL, username: ctx.username }, actor: ctx.username });

    modelfilePath = path.join(OUT_ROOT, 'Modelfile');
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

    const activeInfo: ActiveAdapterInfo = {
      modelName,
      activatedAt,
      adapterPath: trainedGGUF,
      dataset: RUN_LABEL,
      date: DATE_STR,
      modelfilePath,
      status: 'ready_for_ollama_load',
      activatedBy: 'full-cycle',
      runLabel: RUN_LABEL,
      trainingMethod: 'remote',
      ggufAdapterPath: trainedGGUF,
      baseModel: config.base_model,
    };

    setActiveAdapter(activeInfo);
    audit({ level: 'info', category: 'action', event: 'adapter_activated', details: { date: DATE_STR, modelName, backend: 'ollama', auto: true, username: ctx.username }, actor: ctx.username });

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
  } // End of Ollama mode block

  // Common cleanup and completion (both backends)
  try {
    fs.writeFileSync(uniqueRunInfoPath, JSON.stringify({ runId: currentRunId, runLabel: RUN_LABEL, createdAt: new Date().toISOString() }, null, 2));
    fs.writeFileSync(path.join(datasetDir, 'latest-run.json'), JSON.stringify({ runId: currentRunId, runLabel: RUN_LABEL, updatedAt: new Date().toISOString() }, null, 2));
  } catch (e) {
    console.warn('[full-cycle] Failed to record run metadata:', (e as Error).message);
  }

  // Cleanup (only for Ollama mode with GGUF)
  if (!isVllmMode && fs.existsSync(trainedGGUF)) {
    cleanupAfterSuccessfulMerge(OUT_ROOT, WORK_LOCAL);
  }

  audit({ level: 'info', category: 'action', event: 'full_cycle_completed', details: { date: DATE_STR, run_id: currentRunId, run_label: RUN_LABEL, backend: targetBackend, username: ctx.username }, actor: ctx.username });
  console.log(`\n✅ [full-cycle] Training complete for user: ${ctx.username}`);
  console.log(`   Backend: ${targetBackend}`);
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
    console.error('\nUsage: pnpm exec tsx brain/training/full-cycle.ts --username <username>');
    console.error('\nExample: pnpm exec tsx brain/training/full-cycle.ts --username greggles');
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
  } catch (summaryErr) {
    console.error('Failed to write partial summary:', summaryErr);
  }

  audit({ level: 'error', category: 'action', event: 'full_cycle_failed', details: { error: String(err), run_id: currentRunId, run_label: currentRunLabel }, actor: 'full-cycle' });
  process.exit(1);
});
