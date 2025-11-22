import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  listAdapterDatasets,
  readAutoApprovalConfig,
  writeAutoApprovalConfig,
  getActiveAdapter,
  setActiveAdapter,
  systemPaths,
  audit,
  getAuthenticatedUser,
} from '@metahuman/core';
import { execSync } from 'node:child_process';
import type { ActiveAdapterInfo } from '@metahuman/core';

function datasetDir(date: string): string {
  return path.join(systemPaths.out, 'adapters', date);
}

function ensureDataset(date: string): string {
  const dir = datasetDir(date);
  if (!fs.existsSync(dir)) {
    throw new Error(`Dataset not found for date ${date}`);
  }
  return dir;
}

function backgroundAgent(agentFile: string, args: string[]): void {
  const agentPath = path.join(systemPaths.brain, 'agents', agentFile);
  if (!fs.existsSync(agentPath)) {
    throw new Error(`Agent not found: ${agentFile}`);
  }
  const child = spawn('tsx', [agentPath, ...args], {
    cwd: systemPaths.root,
    stdio: 'ignore',
    detached: true,
  });
  child.unref();
}

function createApproval(date: string, approvedBy: string, notes?: string): void {
  const dir = ensureDataset(date);
  const jsonlPath = path.join(dir, 'instructions.jsonl');
  if (!fs.existsSync(jsonlPath)) {
    throw new Error('instructions.jsonl not found for dataset');
  }
  const approvalPath = path.join(dir, 'approved.json');
  if (fs.existsSync(approvalPath)) {
    throw new Error('Dataset already approved');
  }
  const pairCount = fs.readFileSync(jsonlPath, 'utf-8').trim().split('\n').filter(Boolean).length;
  const approval = {
    approvedAt: new Date().toISOString(),
    approvedBy,
    notes: notes ?? '',
    pairCount,
    autoApproved: false,
    qualityScore: null,
    dryRun: false,
  };
  fs.writeFileSync(approvalPath, JSON.stringify(approval, null, 2));
}

function rejectDataset(date: string, reason: string, actor: string): string {
  const dir = ensureDataset(date);
  const archiveDir = path.join(systemPaths.out, 'adapters', '_rejected');
  fs.mkdirSync(archiveDir, { recursive: true });
  const destination = path.join(archiveDir, date);
  fs.renameSync(dir, destination);
  const rejection = {
    rejectedAt: new Date().toISOString(),
    rejectedBy: actor,
    reason,
  };
  fs.writeFileSync(path.join(destination, 'rejected.json'), JSON.stringify(rejection, null, 2));
  return destination;
}

function activateAdapter(date: string, actor: string): void {
  const dir = ensureDataset(date);
  const evalPath = path.join(dir, 'eval.json');
  const adapterPath = path.join(dir, 'adapter_model.safetensors');
  const ggufAdapterPath = path.join(dir, 'adapter.gguf');

  if (!fs.existsSync(evalPath)) {
    throw new Error('Adapter has not been evaluated yet');
  }
  if (!fs.existsSync(adapterPath) && !fs.existsSync(ggufAdapterPath)) {
    throw new Error('adapter_model.safetensors or adapter.gguf not found');
  }

  const evalResult = JSON.parse(fs.readFileSync(evalPath, 'utf-8')) as { score?: number; passed?: boolean };
  if (!evalResult.passed) {
    throw new Error('Adapter eval has not passed threshold');
  }

  // Check for historical merged adapter (dual-adapter system)
  const historyMergedPath = path.join(systemPaths.out, 'adapters', 'history-merged', 'adapter-merged.gguf');
  const hasHistoricalAdapter = fs.existsSync(historyMergedPath);

  const modelName = `greg-${date}`;
  const modelfilePath = path.join(dir, 'Modelfile');
  const baseModel = process.env.METAHUMAN_BASE_MODEL || 'dolphin-mistral:latest';

  // Always regenerate Modelfile to ensure it includes both adapters if available
  let modelfile = `# MetaHuman OS LoRA Adapter - ${date}
FROM ${baseModel}
`;

  // Add historical adapter first (if exists) for dual-adapter mode
  if (hasHistoricalAdapter) {
    modelfile += `ADAPTER ${historyMergedPath}\n`;
  }

  // Add recent adapter (use GGUF if available, otherwise safetensors)
  const recentAdapterPath = fs.existsSync(ggufAdapterPath) ? ggufAdapterPath : adapterPath;
  modelfile += `ADAPTER ${recentAdapterPath}\n`;

  fs.writeFileSync(modelfilePath, modelfile);

  const activatedAt = new Date().toISOString();
  const activeInfo: ActiveAdapterInfo = {
    modelName,
    activatedAt,
    adapterPath,
    ggufAdapterPath: fs.existsSync(ggufAdapterPath) ? ggufAdapterPath : undefined,
    evalScore: evalResult.score,
    dataset: date,
    modelfilePath,
    status: 'ready_for_ollama_load',
    activatedBy: actor,
    trainingMethod: 'remote',
    baseModel,
    isDualAdapter: hasHistoricalAdapter,
    dual: hasHistoricalAdapter,
  };

  setActiveAdapter(activeInfo);
}

function activateDualAdapter(date: string, actor: string): void {
  const dir = ensureDataset(date);
  const recentGGUF = path.join(dir, 'adapter.gguf');
  const mergedGGUF = path.join(systemPaths.out, 'adapters', 'history-merged', 'adapter-merged.gguf');
  if (!fs.existsSync(recentGGUF)) throw new Error('Recent adapter.gguf not found');
  if (!fs.existsSync(mergedGGUF)) throw new Error('history-merged/adapter-merged.gguf not found');

  const modelName = `greg-dual-${date}`;
  const modelfilePath = path.join(dir, 'DualModelfile');
  const baseModel = process.env.METAHUMAN_BASE_MODEL || 'dolphin-mistral:latest';
  const modelfile = `# MetaHuman OS Dual LoRA - ${date}\nFROM ${baseModel}\nADAPTER ${mergedGGUF}\nADAPTER ${recentGGUF}\n`;
  fs.writeFileSync(modelfilePath, modelfile);

  const evalPath = path.join(dir, 'eval.json');
  const evalScore = fs.existsSync(evalPath) ? (JSON.parse(fs.readFileSync(evalPath, 'utf-8')).score) : undefined;
  const activatedAt = new Date().toISOString();
  const cfg: ActiveAdapterInfo = {
    modelName,
    activatedAt,
    adapterPath: recentGGUF,
    evalScore,
    dataset: date,
    modelfilePath,
    status: 'ready_for_ollama_load',
    dual: true,
    mergedPath: mergedGGUF,
    activatedBy: actor,
    trainingMethod: 'remote-dual',
    baseModel,
    ggufAdapterPath: recentGGUF,
    adapters: {
      historical: mergedGGUF,
      recent: recentGGUF,
    },
    isDualAdapter: true,
  };
  setActiveAdapter(cfg);

  try {
    execSync(`ollama create ${modelName} -f "${modelfilePath}"`, { stdio: 'ignore', cwd: systemPaths.root });
    cfg.status = 'loaded';
    setActiveAdapter(cfg);
  } catch {}
}

function readRecentAdapterLogs(limit = 50): Array<{ timestamp: string; event: string; actor?: string; details?: any }> {
  const logs: Array<{ timestamp: string; event: string; actor?: string; details?: any }> = []
  try {
    const today = new Date().toISOString().slice(0, 10)
    const file = path.join(systemPaths.logs, 'audit', `${today}.ndjson`)
    if (!fs.existsSync(file)) return []

    // PERFORMANCE: Use tail to read only last 200 lines instead of entire file
    const content = execSync(`tail -n 200 "${file}"`, { encoding: 'utf-8' })
    const lines = content.trim().split('\n')

    for (const line of lines) {
      try {
        const obj = JSON.parse(line)
        const e = String(obj.event || '')
        if (/adapter_|lora_|full_cycle_|gguf_/.test(e)) {
          logs.push({ timestamp: obj.timestamp, event: e, actor: obj.actor, details: obj.details })
        }
      } catch {}
    }
  } catch {}
  // sort asc by time and slice last N
  logs.sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1))
  return logs.slice(-limit)
}

export const GET: APIRoute = async ({ cookies }) => {
  // SECURITY FIX: 2025-11-20 - Require owner role for adapter management
  try {
    const user = getAuthenticatedUser(cookies);

    if (user.role !== 'owner') {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Owner role required to access adapter management'
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const datasets = listAdapterDatasets();
    const autoApproval = readAutoApprovalConfig();
    const activeAdapter = getActiveAdapter();
    // PERFORMANCE: Reduced from 75 to 10 since UI only displays first 5
    const recentLogs = readRecentAdapterLogs(10)
    // Read sleep config for LoRA enabled flag
    let loraEnabled = false;
    try {
      const sleepPath = path.join(systemPaths.etc, 'sleep.json');
      if (fs.existsSync(sleepPath)) {
        const sleep = JSON.parse(fs.readFileSync(sleepPath, 'utf-8'));
        loraEnabled = !!(sleep?.adapters?.lora);
      }
    } catch {}

    return new Response(
      JSON.stringify({ success: true, datasets, autoApproval, activeAdapter, sleep: { loraEnabled }, recentLogs }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    // Check if it's an authentication error
    if (error instanceof Error && (
      error.message.includes('Authentication required') ||
      error.message.includes('UNAUTHORIZED')
    )) {
      return new Response(
        JSON.stringify({ success: false, error: 'Authentication required' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(
      JSON.stringify({ success: false, error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const POST: APIRoute = async ({ cookies, request }) => {
  // SECURITY FIX: 2025-11-20 - Require owner role for adapter management
  try {
    const user = getAuthenticatedUser(cookies);

    if (user.role !== 'owner') {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Owner role required to manage adapters'
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = await request.json();
    const action = body?.action;

    if (!action) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing action' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    // Handle special case for getting config
    if (action === 'config') {
      try {
        const { loadModelRegistry } = await import('@metahuman/core');
        const registry = loadModelRegistry();
        const fallbackId = registry.defaults?.fallback || 'default.fallback';
        const fallbackModel = registry.models?.[fallbackId];
        const model = fallbackModel?.model || 'phi3:mini';
        return new Response(
          JSON.stringify({ success: true, model }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      } catch (error) {
        return new Response(
          JSON.stringify({ success: false, error: (error as Error).message }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    switch (action) {
      case 'sleep': {
        const { loraEnabled } = body || {};
        const sleepPath = path.join(systemPaths.etc, 'sleep.json');
        if (!fs.existsSync(sleepPath)) throw new Error('sleep.json not found');
        const sleep = JSON.parse(fs.readFileSync(sleepPath, 'utf-8'));
        if (typeof loraEnabled === 'boolean') {
          sleep.adapters = sleep.adapters || {};
          sleep.adapters.lora = loraEnabled;
        }
        fs.writeFileSync(sleepPath, JSON.stringify(sleep, null, 2));

        audit({
          level: 'info',
          category: 'action',
          event: 'sleep_config_updated',
          details: { adapters: sleep.adapters },
          actor: user.username,
        });

        return new Response(JSON.stringify({ success: true, sleep: { loraEnabled: !!sleep.adapters?.lora } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      case 'runBuilder': {
        backgroundAgent('adapter-builder.ts', []);
        audit({
          level: 'info',
          category: 'action',
          event: 'adapter_builder_queued',
          details: { actor: user.username },
          actor: user.username,
        });
        // If auto-approval is enabled (live) and auto pipeline flags are set,
        // kick off the full cycle orchestrator to approve→train→eval→activate.
        try {
          const aa = readAutoApprovalConfig() as any;
          if (aa && aa.enabled && aa.dryRun === false && (aa.autoTrain !== false)) {
            backgroundAgent('full-cycle.ts', []);
            audit({
              level: 'info',
              category: 'action',
              event: 'full_cycle_queued',
              details: { trigger: 'runBuilder', autoTrain: aa.autoTrain !== false, autoEval: aa.autoEval !== false, autoActivate: aa.autoActivate !== false },
              actor: user.username,
            });
          }
        } catch {}

        return new Response(JSON.stringify({ success: true, message: 'Adapter-builder started in background' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      case 'runDreamer': {
        backgroundAgent('dreamer.ts', []);
        audit({
          level: 'info',
          category: 'action',
          event: 'dreamer_queued',
          details: { actor: user.username },
          actor: user.username,
        });
        return new Response(JSON.stringify({ success: true, message: 'Dreamer started in background' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      case 'runNightProcessor': {
        backgroundAgent('night-processor.ts', []);
        audit({
          level: 'info',
          category: 'action',
          event: 'night_processor_queued',
          details: { actor: user.username },
          actor: user.username,
        });
        return new Response(JSON.stringify({ success: true, message: 'Night processor started in background' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      case 'startSleepService': {
        backgroundAgent('sleep-service.ts', []);
        audit({
          level: 'info',
          category: 'system',
          event: 'sleep_service_started_from_ui',
          details: { actor: user.username },
          actor: user.username,
        });
        return new Response(JSON.stringify({ success: true, message: 'Sleep service started (long-running)' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      case 'fullCycle': {
        const { model, dualMode } = body;
        // Set environment variables for the full cycle
        const env = { ...process.env };
        if (model) {
          env.METAHUMAN_BASE_MODEL = model;
        }
        if (typeof dualMode === 'boolean') {
          env.METAHUMAN_DUAL_MODE = dualMode ? '1' : '0';
        }

        // Create log file for full-cycle output
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const logPath = path.join(systemPaths.logs, 'run', `full-cycle-${timestamp}.log`);
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
        const logStream = fs.openSync(logPath, 'w');

        // Create a child process with the specified environment
        const agentPath = path.join(systemPaths.brain, 'agents', 'full-cycle.ts');
        const child = spawn('tsx', [agentPath, '--username', user.username], {
          cwd: systemPaths.root,
          stdio: ['ignore', logStream, logStream], // stdout and stderr to log file
          detached: true,
          env
        });
        child.unref();

        // Store PID for cancellation
        const pidPath = path.join(systemPaths.logs, 'run', 'full-cycle.pid');
        fs.writeFileSync(pidPath, String(child.pid), 'utf-8');

        audit({
          level: 'info',
          category: 'action',
          event: 'full_cycle_queued',
          details: { actor: user.username, model, dualMode, logPath, pid: child.pid },
          actor: user.username,
        });
        return new Response(JSON.stringify({ success: true, message: 'Full cycle started in background', logPath, pid: child.pid }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      case 'cancelFullCycle': {
        const pidPath = path.join(systemPaths.logs, 'run', 'full-cycle.pid');
        let killedPids: number[] = [];

        // Try PID file first
        if (fs.existsSync(pidPath)) {
          const pidStr = fs.readFileSync(pidPath, 'utf-8').trim();
          const pid = parseInt(pidStr, 10);

          if (!isNaN(pid)) {
            try {
              // Kill the process group (negative PID kills the whole process tree)
              process.kill(-pid, 'SIGTERM');
              killedPids.push(pid);
              fs.unlinkSync(pidPath);
            } catch (err: any) {
              if (err.code !== 'ESRCH') {
                console.warn(`[cancelFullCycle] Failed to kill process ${pid}:`, err.message);
              }
            }
          }
        }

        // FALLBACK: If PID file doesn't exist or failed, find processes by name
        try {
          // Find all full-cycle and ai-dataset-builder processes for this user
          const psOutput = execSync(
            `ps aux | grep -E "full-cycle.ts|ai-dataset-builder.ts" | grep "${user.username}" | grep -v grep | awk '{print $2}'`,
            { encoding: 'utf-8' }
          ).trim();

          if (psOutput) {
            const pids = psOutput.split('\n').map(p => parseInt(p, 10)).filter(p => !isNaN(p));

            for (const pid of pids) {
              try {
                process.kill(pid, 'SIGTERM');
                killedPids.push(pid);
              } catch (err: any) {
                if (err.code !== 'ESRCH') {
                  console.warn(`[cancelFullCycle] Failed to kill process ${pid}:`, err.message);
                }
              }
            }
          }
        } catch (err: any) {
          console.warn('[cancelFullCycle] Fallback process killing failed:', err.message);
        }

        // Clean up PID file if it exists
        if (fs.existsSync(pidPath)) {
          fs.unlinkSync(pidPath);
        }

        // ROBUSTNESS: Stop any stuck Ollama models to free up resources
        try {
          // Unload all loaded models to free GPU/CPU
          execSync('curl -s http://localhost:11434/api/generate -d \'{"model": "", "keep_alive": 0}\'', {
            timeout: 2000,
            stdio: 'ignore',
          });
        } catch (err) {
          // Non-critical - Ollama may not be running or may timeout
          console.warn('[cancelFullCycle] Failed to unload Ollama models:', err);
        }

        if (killedPids.length === 0) {
          return new Response(JSON.stringify({
            success: false,
            error: 'No training processes found'
          }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        audit({
          level: 'info',
          category: 'action',
          event: 'full_cycle_cancelled',
          details: { pids: killedPids, actor: user.username },
          actor: user.username,
        });

        return new Response(JSON.stringify({
          success: true,
          message: `Cancelled ${killedPids.length} training process(es)`,
          pids: killedPids
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      case 'approve': {
        const { date, notes } = body;
        if (!date) throw new Error('Missing dataset date');
        createApproval(date, user.username, notes);
        audit({
          level: 'info',
          category: 'action',
          event: 'adapter_approved',
          details: { date, notes, actor: user.username },
          actor: user.username,
        });
        return new Response(JSON.stringify({ success: true, message: 'Dataset approved' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      case 'reject': {
        const { date, reason } = body;
        if (!date) throw new Error('Missing dataset date');
        const destination = rejectDataset(date, reason || 'Not specified', user.username);
        audit({
          level: 'info',
          category: 'action',
          event: 'adapter_rejected',
          details: { date, reason, actor: user.username },
          actor: user.username,
        });
        return new Response(JSON.stringify({ success: true, message: 'Dataset rejected', archive: destination }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      case 'train': {
        const { date } = body;
        if (!date) throw new Error('Missing dataset date');
        const dir = ensureDataset(date);
        // Auto-approve if enabled and not in dry run
        const aa = readAutoApprovalConfig();
        const approvedPath = path.join(dir, 'approved.json');
        if (!fs.existsSync(approvedPath)) {
          if (aa.enabled && !aa.dryRun) {
            createApproval(date, `${user.username}:auto`, 'Auto-approved before training');
            audit({
              level: 'info',
              category: 'action',
              event: 'lora_dataset_auto_approved',
              details: { date, actor: user.username },
              actor: user.username,
            });
          } else {
            return new Response(
              JSON.stringify({ success: false, error: 'Dataset is not approved. Enable live auto-approval or approve manually first.' }),
              { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
          }
        }
        backgroundAgent('lora-trainer.ts', [date]);
        audit({
          level: 'info',
          category: 'action',
          event: 'adapter_training_queued',
          details: { date, actor: user.username },
          actor: user.username,
        });
        return new Response(JSON.stringify({ success: true, message: 'Training started in background' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      case 'eval': {
        const { date } = body;
        if (!date) throw new Error('Missing dataset date');
        ensureDataset(date);
        backgroundAgent('eval-adapter.ts', [date]);
        audit({
          level: 'info',
          category: 'action',
          event: 'adapter_evaluation_queued',
          details: { date, actor: user.username },
          actor: user.username,
        });
        return new Response(JSON.stringify({ success: true, message: 'Evaluation started in background' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      case 'activate': {
        const { date } = body;
        if (!date) throw new Error('Missing dataset date');
        // Stage activation metadata and Modelfile
        activateAdapter(date, user.username);

        // Attempt to load into Ollama automatically
        try {
          const dir = ensureDataset(date);
          const modelfilePath = path.join(dir, 'Modelfile');
          const modelName = `greg-${date}`;

          execSync(`ollama create ${modelName} -f "${modelfilePath}"`, {
            stdio: 'inherit',
            cwd: systemPaths.root,
          });

          const current = getActiveAdapter();
          if (current && current.dataset === date) {
            setActiveAdapter({ ...current, status: 'loaded' });
          }

          audit({
            level: 'info',
            category: 'action',
            event: 'adapter_activated',
            details: { date, modelName, status: 'loaded' },
            actor: user.username,
          });

          return new Response(
            JSON.stringify({ success: true, message: 'Adapter loaded into Ollama and activated.' }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        } catch (e) {
          // Leave status as ready_for_ollama_load and return instructions
          audit({
            level: 'warn',
            category: 'action',
            event: 'adapter_activation_partial',
            details: { date, error: (e as Error).message },
            actor: user.username,
          });
          return new Response(
            JSON.stringify({
              success: true,
              message: 'Adapter activation metadata updated. Manual step required: ollama create greg-<date> -f Modelfile',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
      }
      case 'activateDual': {
        const { date } = body;
        if (!date) throw new Error('Missing dataset date');
        activateDualAdapter(date, user.username);
        audit({ level: 'info', category: 'action', event: 'adapter_activation_requested_dual', details: { date, actor: user.username }, actor: user.username });
        return new Response(JSON.stringify({ success: true, message: 'Dual adapter activated (history-merged + recent). If Ollama was running, it was auto-loaded.' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      case 'autoApproval': {
        const { enabled, dryRun, thresholds, autoTrain, autoEval, autoActivate } = body;
        const config = readAutoApprovalConfig();
        if (typeof enabled === 'boolean') config.enabled = enabled;
        if (typeof dryRun === 'boolean') config.dryRun = dryRun;
        if (thresholds && typeof thresholds === 'object') {
          config.thresholds = {
            ...config.thresholds,
            ...thresholds,
          };
        }
        if (typeof autoTrain === 'boolean') (config as any).autoTrain = autoTrain;
        if (typeof autoEval === 'boolean') (config as any).autoEval = autoEval;
        if (typeof autoActivate === 'boolean') (config as any).autoActivate = autoActivate;
        writeAutoApprovalConfig(config);
        audit({
          level: 'info',
          category: 'action',
          event: 'auto_approval_updated',
          details: config,
          actor: user.username,
        });
        return new Response(JSON.stringify({ success: true, config }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      case 'mergeAdapters': {
        // Run adapter-merger agent to merge historical adapters
        const agentPath = path.join(systemPaths.brain, 'agents', 'adapter-merger.ts');
        if (!fs.existsSync(agentPath)) {
          throw new Error('adapter-merger.ts not found');
        }

        backgroundAgent('adapter-merger.ts', []);

        audit({
          level: 'info',
          category: 'action',
          event: 'adapter_merge_started',
          details: { actor: user.username },
          actor: user.username,
        });

        return new Response(
          JSON.stringify({ success: true, message: 'Adapter merge started. Check audit logs for progress.' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      default:
        return new Response(
          JSON.stringify({ success: false, error: `Unknown action: ${action}` }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
    }
  } catch (error) {
    // Check if it's an authentication error
    if (error instanceof Error && (
      error.message.includes('Authentication required') ||
      error.message.includes('UNAUTHORIZED')
    )) {
      return new Response(
        JSON.stringify({ success: false, error: 'Authentication required' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(
      JSON.stringify({ success: false, error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

// MIGRATED: 2025-11-20 - Explicit authentication pattern
// SECURITY FIX: 2025-11-20 - Require owner role for adapter management (system files)
// Both GET and POST now authenticate and check for owner role
