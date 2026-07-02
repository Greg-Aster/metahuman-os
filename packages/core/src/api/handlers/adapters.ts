/**
 * Adapter Management API Handlers
 *
 * Core owns the HTTP contract and adapter metadata/config writes. Long-running
 * training work remains in brain scripts launched as background processes.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import {
  listAdapterDatasets,
  readAutoApprovalConfig,
  writeAutoApprovalConfig,
  getActiveAdapter,
  setActiveAdapter,
  type ActiveAdapterInfo,
} from '../../adapters.js';
import { audit } from '../../audit.js';
import { systemPaths } from '../../paths.js';
import { loadModelRegistry } from '../../model-resolver.js';

function ownerRequired(req: UnifiedRequest, message: string): UnifiedResponse | null {
  if (!req.user.isAuthenticated) {
    return {
      status: 401,
      data: { success: false, error: 'Authentication required' },
    };
  }
  if (req.user.role !== 'owner') {
    return {
      status: 403,
      data: { success: false, error: message },
    };
  }
  return null;
}

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

function backgroundTrainingScript(scriptFile: string, args: string[] = [], options?: {
  env?: NodeJS.ProcessEnv;
  stdio?: 'ignore' | Array<'ignore' | number>;
}): void {
  const scriptPath = path.join(systemPaths.brain, 'training', scriptFile);
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Training script not found: ${scriptFile}`);
  }

  const child = spawn('tsx', [scriptPath, ...args], {
    cwd: systemPaths.root,
    stdio: options?.stdio ?? 'ignore',
    detached: true,
    env: options?.env,
  });
  child.unref();
}

function backgroundAgent(agentFile: string, args: string[] = []): void {
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

  const historyMergedPath = path.join(systemPaths.out, 'adapters', 'history-merged', 'adapter-merged.gguf');
  const hasHistoricalAdapter = fs.existsSync(historyMergedPath);
  const modelName = `greg-${date}`;
  const modelfilePath = path.join(dir, 'Modelfile');
  const baseModel = process.env.METAHUMAN_BASE_MODEL || 'dolphin-mistral:latest';

  let modelfile = `# MetaHuman OS LoRA Adapter - ${date}\nFROM ${baseModel}\n`;
  if (hasHistoricalAdapter) {
    modelfile += `ADAPTER ${historyMergedPath}\n`;
  }
  const recentAdapterPath = fs.existsSync(ggufAdapterPath) ? ggufAdapterPath : adapterPath;
  modelfile += `ADAPTER ${recentAdapterPath}\n`;

  fs.writeFileSync(modelfilePath, modelfile);

  const activeInfo: ActiveAdapterInfo = {
    modelName,
    activatedAt: new Date().toISOString(),
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
  const evalScore = fs.existsSync(evalPath) ? JSON.parse(fs.readFileSync(evalPath, 'utf-8')).score : undefined;
  const cfg: ActiveAdapterInfo = {
    modelName,
    activatedAt: new Date().toISOString(),
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
  } catch {
    // Activation metadata is still useful if Ollama is unavailable.
  }
}

function readRecentAdapterLogs(limit = 50): Array<{ timestamp: string; event: string; actor?: string; details?: unknown }> {
  const logs: Array<{ timestamp: string; event: string; actor?: string; details?: unknown }> = [];
  try {
    const today = new Date().toISOString().slice(0, 10);
    const file = path.join(systemPaths.logs, 'audit', `${today}.ndjson`);
    if (!fs.existsSync(file)) return [];

    const content = execSync(`tail -n 200 "${file}"`, { encoding: 'utf-8' });
    const lines = content.trim().split('\n');

    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        const event = String(obj.event || '');
        if (/adapter_|lora_|full_cycle_|gguf_/.test(event)) {
          logs.push({ timestamp: obj.timestamp, event, actor: obj.actor, details: obj.details });
        }
      } catch {
        // Ignore malformed audit lines.
      }
    }
  } catch {
    // Audit logs are best effort.
  }

  logs.sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));
  return logs.slice(-limit);
}

export async function handleGetAdapters(req: UnifiedRequest): Promise<UnifiedResponse> {
  const denied = ownerRequired(req, 'Owner role required to access adapter management');
  if (denied) return denied;

  try {
    const datasets = listAdapterDatasets();
    const autoApproval = readAutoApprovalConfig();
    const activeAdapter = getActiveAdapter();
    const recentLogs = readRecentAdapterLogs(10);
    let loraEnabled = false;

    try {
      const sleepPath = path.join(systemPaths.etc, 'sleep.json');
      if (fs.existsSync(sleepPath)) {
        const sleep = JSON.parse(fs.readFileSync(sleepPath, 'utf-8'));
        loraEnabled = Boolean(sleep?.adapters?.lora);
      }
    } catch {
      // Preserve legacy best-effort behavior.
    }

    return successResponse({
      success: true,
      datasets,
      autoApproval,
      activeAdapter,
      sleep: { loraEnabled },
      recentLogs,
    });
  } catch (error) {
    return {
      status: 500,
      data: { success: false, error: (error as Error).message },
    };
  }
}

export async function handlePostAdapters(req: UnifiedRequest): Promise<UnifiedResponse> {
  const denied = ownerRequired(req, 'Owner role required to manage adapters');
  if (denied) return denied;

  try {
    const body = req.body || {};
    const action = body.action;

    if (!action) {
      return { status: 400, data: { success: false, error: 'Missing action' } };
    }

    switch (action) {
      case 'config': {
        const registry = loadModelRegistry(false, req.user.username);
        const defaults = registry.defaults as Record<string, string> | undefined;
        const fallbackId = defaults?.fallback || 'default.fallback';
        const fallbackModel = registry.models?.[fallbackId];
        const model = fallbackModel?.model || 'phi3:mini';
        return successResponse({ success: true, model });
      }
      case 'sleep': {
        const sleepPath = path.join(systemPaths.etc, 'sleep.json');
        if (!fs.existsSync(sleepPath)) throw new Error('sleep.json not found');
        const sleep = JSON.parse(fs.readFileSync(sleepPath, 'utf-8'));
        if (typeof body.loraEnabled === 'boolean') {
          sleep.adapters = sleep.adapters || {};
          sleep.adapters.lora = body.loraEnabled;
        }
        fs.writeFileSync(sleepPath, JSON.stringify(sleep, null, 2));
        audit({
          level: 'info',
          category: 'action',
          event: 'sleep_config_updated',
          details: { adapters: sleep.adapters },
          actor: req.user.username,
        });
        return successResponse({ success: true, sleep: { loraEnabled: Boolean(sleep.adapters?.lora) } });
      }
      case 'runBuilder': {
        backgroundTrainingScript('adapter-builder.ts');
        audit({
          level: 'info',
          category: 'action',
          event: 'adapter_builder_queued',
          details: { actor: req.user.username },
          actor: req.user.username,
        });

        try {
          const aa = readAutoApprovalConfig() as any;
          if (aa?.enabled && aa.dryRun === false && aa.autoTrain !== false) {
            backgroundTrainingScript('full-cycle.ts');
            audit({
              level: 'info',
              category: 'action',
              event: 'full_cycle_queued',
              details: {
                trigger: 'runBuilder',
                autoTrain: aa.autoTrain !== false,
                autoEval: aa.autoEval !== false,
                autoActivate: aa.autoActivate !== false,
              },
              actor: req.user.username,
            });
          }
        } catch {
          // Preserve legacy best-effort auto-cycle behavior.
        }

        return successResponse({ success: true, message: 'Adapter-builder started in background' });
      }
      case 'runDreamer': {
        backgroundAgent('dreamer.ts');
        audit({ level: 'info', category: 'action', event: 'dreamer_queued', details: { actor: req.user.username }, actor: req.user.username });
        return successResponse({ success: true, message: 'Dreamer started in background' });
      }
      case 'runNightProcessor': {
        backgroundAgent('night-processor.ts');
        audit({ level: 'info', category: 'action', event: 'night_processor_queued', details: { actor: req.user.username }, actor: req.user.username });
        return successResponse({ success: true, message: 'Night processor started in background' });
      }
      case 'startSleepService': {
        backgroundAgent('sleep-service.ts');
        audit({ level: 'info', category: 'system', event: 'sleep_service_started_from_ui', details: { actor: req.user.username }, actor: req.user.username });
        return successResponse({ success: true, message: 'Sleep service started (long-running)' });
      }
      case 'fullCycle': {
        const env = { ...process.env };
        if (body.model) env.METAHUMAN_BASE_MODEL = body.model;
        if (typeof body.dualMode === 'boolean') env.METAHUMAN_DUAL_MODE = body.dualMode ? '1' : '0';

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const logPath = path.join(systemPaths.logs, 'run', `full-cycle-${timestamp}.log`);
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
        const logStream = fs.openSync(logPath, 'w');
        const scriptPath = path.join(systemPaths.brain, 'training', 'full-cycle.ts');
        const child = spawn('tsx', [scriptPath, '--username', req.user.username], {
          cwd: systemPaths.root,
          stdio: ['ignore', logStream, logStream],
          detached: true,
          env,
        });
        child.unref();

        const pidPath = path.join(systemPaths.logs, 'run', 'full-cycle.pid');
        fs.writeFileSync(pidPath, String(child.pid), 'utf-8');

        audit({
          level: 'info',
          category: 'action',
          event: 'full_cycle_queued',
          details: { actor: req.user.username, model: body.model, dualMode: body.dualMode, logPath, pid: child.pid },
          actor: req.user.username,
        });
        return successResponse({ success: true, message: 'Full cycle started in background', logPath, pid: child.pid });
      }
      case 'cancelFullCycle': {
        const pidPath = path.join(systemPaths.logs, 'run', 'full-cycle.pid');
        const killedPids: number[] = [];

        if (fs.existsSync(pidPath)) {
          const pid = parseInt(fs.readFileSync(pidPath, 'utf-8').trim(), 10);
          if (!Number.isNaN(pid)) {
            try {
              process.kill(-pid, 'SIGTERM');
              killedPids.push(pid);
              fs.unlinkSync(pidPath);
            } catch (error: any) {
              if (error.code !== 'ESRCH') {
                console.warn(`[cancelFullCycle] Failed to kill process ${pid}:`, error.message);
              }
            }
          }
        }

        try {
          const psOutput = execSync(
            `ps aux | grep -E "full-cycle.ts" | grep "${req.user.username}" | grep -v grep | awk '{print $2}'`,
            { encoding: 'utf-8' }
          ).trim();
          if (psOutput) {
            for (const pid of psOutput.split('\n').map((p) => parseInt(p, 10)).filter((p) => !Number.isNaN(p))) {
              try {
                process.kill(pid, 'SIGTERM');
                killedPids.push(pid);
              } catch (error: any) {
                if (error.code !== 'ESRCH') {
                  console.warn(`[cancelFullCycle] Failed to kill process ${pid}:`, error.message);
                }
              }
            }
          }
        } catch (error: any) {
          console.warn('[cancelFullCycle] Fallback process killing failed:', error.message);
        }

        if (fs.existsSync(pidPath)) {
          fs.unlinkSync(pidPath);
        }

        try {
          execSync('curl -s http://localhost:11434/api/generate -d \'{"model": "", "keep_alive": 0}\'', {
            timeout: 2000,
            stdio: 'ignore',
          });
        } catch (error) {
          console.warn('[cancelFullCycle] Failed to unload Ollama models:', error);
        }

        if (killedPids.length === 0) {
          return { status: 404, data: { success: false, error: 'No training processes found' } };
        }

        audit({
          level: 'info',
          category: 'action',
          event: 'full_cycle_cancelled',
          details: { pids: killedPids, actor: req.user.username },
          actor: req.user.username,
        });
        return successResponse({
          success: true,
          message: `Cancelled ${killedPids.length} training process(es)`,
          pids: killedPids,
        });
      }
      case 'approve': {
        if (!body.date) throw new Error('Missing dataset date');
        createApproval(body.date, req.user.username, body.notes);
        audit({ level: 'info', category: 'action', event: 'adapter_approved', details: { date: body.date, notes: body.notes, actor: req.user.username }, actor: req.user.username });
        return successResponse({ success: true, message: 'Dataset approved' });
      }
      case 'reject': {
        if (!body.date) throw new Error('Missing dataset date');
        const destination = rejectDataset(body.date, body.reason || 'Not specified', req.user.username);
        audit({ level: 'info', category: 'action', event: 'adapter_rejected', details: { date: body.date, reason: body.reason, actor: req.user.username }, actor: req.user.username });
        return successResponse({ success: true, message: 'Dataset rejected', archive: destination });
      }
      case 'train': {
        if (!body.date) throw new Error('Missing dataset date');
        const dir = ensureDataset(body.date);
        const aa = readAutoApprovalConfig();
        const approvedPath = path.join(dir, 'approved.json');
        if (!fs.existsSync(approvedPath)) {
          if (aa.enabled && !aa.dryRun) {
            createApproval(body.date, `${req.user.username}:auto`, 'Auto-approved before training');
            audit({ level: 'info', category: 'action', event: 'lora_dataset_auto_approved', details: { date: body.date, actor: req.user.username }, actor: req.user.username });
          } else {
            return {
              status: 400,
              data: { success: false, error: 'Dataset is not approved. Enable live auto-approval or approve manually first.' },
            };
          }
        }
        backgroundTrainingScript('lora-trainer.ts', [body.date]);
        audit({ level: 'info', category: 'action', event: 'adapter_training_queued', details: { date: body.date, actor: req.user.username }, actor: req.user.username });
        return successResponse({ success: true, message: 'Training started in background' });
      }
      case 'eval': {
        if (!body.date) throw new Error('Missing dataset date');
        ensureDataset(body.date);
        backgroundTrainingScript('eval-adapter.ts', [body.date]);
        audit({ level: 'info', category: 'action', event: 'adapter_evaluation_queued', details: { date: body.date, actor: req.user.username }, actor: req.user.username });
        return successResponse({ success: true, message: 'Evaluation started in background' });
      }
      case 'activate': {
        if (!body.date) throw new Error('Missing dataset date');
        activateAdapter(body.date, req.user.username);
        try {
          const dir = ensureDataset(body.date);
          const modelfilePath = path.join(dir, 'Modelfile');
          const modelName = `greg-${body.date}`;
          execSync(`ollama create ${modelName} -f "${modelfilePath}"`, { stdio: 'inherit', cwd: systemPaths.root });
          const current = getActiveAdapter();
          if (current && current.dataset === body.date) {
            setActiveAdapter({ ...current, status: 'loaded' });
          }
          audit({ level: 'info', category: 'action', event: 'adapter_activated', details: { date: body.date, modelName, status: 'loaded' }, actor: req.user.username });
          return successResponse({ success: true, message: 'Adapter loaded into Ollama and activated.' });
        } catch (error) {
          audit({ level: 'warn', category: 'action', event: 'adapter_activation_partial', details: { date: body.date, error: (error as Error).message }, actor: req.user.username });
          return successResponse({
            success: true,
            message: 'Adapter activation metadata updated. Manual step required: ollama create greg-<date> -f Modelfile',
          });
        }
      }
      case 'activateDual': {
        if (!body.date) throw new Error('Missing dataset date');
        activateDualAdapter(body.date, req.user.username);
        audit({ level: 'info', category: 'action', event: 'adapter_activation_requested_dual', details: { date: body.date, actor: req.user.username }, actor: req.user.username });
        return successResponse({
          success: true,
          message: 'Dual adapter activated (history-merged + recent). If Ollama was running, it was auto-loaded.',
        });
      }
      case 'autoApproval': {
        const config = readAutoApprovalConfig();
        if (typeof body.enabled === 'boolean') config.enabled = body.enabled;
        if (typeof body.dryRun === 'boolean') config.dryRun = body.dryRun;
        if (body.thresholds && typeof body.thresholds === 'object') {
          config.thresholds = { ...config.thresholds, ...body.thresholds };
        }
        if (typeof body.autoTrain === 'boolean') (config as any).autoTrain = body.autoTrain;
        if (typeof body.autoEval === 'boolean') (config as any).autoEval = body.autoEval;
        if (typeof body.autoActivate === 'boolean') (config as any).autoActivate = body.autoActivate;
        writeAutoApprovalConfig(config);
        audit({ level: 'info', category: 'action', event: 'auto_approval_updated', details: config, actor: req.user.username });
        return successResponse({ success: true, config });
      }
      case 'mergeAdapters': {
        backgroundTrainingScript('adapter-merger.ts');
        audit({ level: 'info', category: 'action', event: 'adapter_merge_started', details: { actor: req.user.username }, actor: req.user.username });
        return successResponse({ success: true, message: 'Adapter merge started. Check audit logs for progress.' });
      }
      default:
        return { status: 400, data: { success: false, error: `Unknown action: ${action}` } };
    }
  } catch (error) {
    return {
      status: 500,
      data: { success: false, error: (error as Error).message },
    };
  }
}
