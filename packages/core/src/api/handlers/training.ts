/**
 * Training API Handlers
 *
 * Unified handlers for training configuration endpoints.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { systemPaths } from '../../paths.js';
import { getProfilePaths } from '../../path-builder.js';
import { audit } from '../../audit.js';
import { safeWriteJSON } from '../../safe-file.js';
import {
  listTrainingProcesses,
  releaseTrainingProcess,
  stopTrainingProcesses,
  trackTrainingProcess,
  type TrainingProcessName,
} from '../../training-process.js';

function ensureProfileTrainingConfig(username: string): string {
  const profilePaths = getProfilePaths(username);
  const profileConfigPath = path.join(profilePaths.etc, 'training.json');
  if (fs.existsSync(profileConfigPath)) return profileConfigPath;

  const seedPath = path.join(systemPaths.etc, 'training.json');
  if (!fs.existsSync(seedPath)) {
    throw new Error('Training configuration seed not found');
  }

  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8')) as Record<string, unknown>;
  safeWriteJSON(profileConfigPath, seed);
  return profileConfigPath;
}

function validateLaunchTrainingConfig(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return 'Training configuration is required';
  }

  const config = value as Record<string, unknown>;
  if (typeof config.base_model !== 'string' || config.base_model.trim().length === 0 || config.base_model.length > 300) {
    return 'base_model must be a non-empty model identifier';
  }

  const positiveIntegers: Array<[string, number, number]> = [
    ['num_train_epochs', 1, 50],
    ['per_device_train_batch_size', 1, 128],
    ['gradient_accumulation_steps', 1, 1024],
    ['max_seq_length', 128, 262_144],
  ];
  for (const [field, minimum, maximum] of positiveIntegers) {
    const valueForField = config[field];
    if (!Number.isInteger(valueForField) || (valueForField as number) < minimum || (valueForField as number) > maximum) {
      return `${field} must be an integer from ${minimum} to ${maximum}`;
    }
  }

  if (config.max_samples !== null && (
    !Number.isInteger(config.max_samples)
    || (config.max_samples as number) < 1
    || (config.max_samples as number) > 1_000_000
  )) {
    return 'max_samples must be null or an integer from 1 to 1000000';
  }

  if (!Number.isInteger(config.lora_rank) || (config.lora_rank as number) < 0 || (config.lora_rank as number) > 1024) {
    return 'lora_rank must be an integer from 0 to 1024';
  }
  if (!Number.isInteger(config.lora_alpha) || (config.lora_alpha as number) < 0 || (config.lora_alpha as number) > 4096) {
    return 'lora_alpha must be an integer from 0 to 4096';
  }
  if (typeof config.learning_rate !== 'number' || !Number.isFinite(config.learning_rate) || config.learning_rate <= 0 || config.learning_rate > 1) {
    return 'learning_rate must be greater than 0 and no more than 1';
  }
  if (typeof config.quantization !== 'string' || !/^[A-Za-z0-9_.-]{1,32}$/.test(config.quantization)) {
    return 'quantization is invalid';
  }

  return null;
}

function terminateDetachedProcess(pid: number): void {
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  }
}

/**
 * GET /api/training-config - Get training configuration
 */
export async function handleGetTrainingConfig(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { user } = req;

    // All users are authenticated (no anonymous access)
    // Get their profile-specific config
    const userConfigPath = ensureProfileTrainingConfig(user.username);

    // Read and parse user's training config
    const content = fs.readFileSync(userConfigPath, 'utf-8');
    const config = JSON.parse(content);

    return successResponse(config);
  } catch (error) {
    console.error('[training-config-handler] Error:', error);
    return {
      status: 500,
      error: (error as Error)?.message || 'Failed to load training configuration',
    };
  }
}

/**
 * POST /api/training-config - Update training configuration
 */
export async function handleUpdateTrainingConfig(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, body } = req;

  if (!user.isAuthenticated) {
    return { status: 401, error: 'Authentication required' };
  }

  if (!body || typeof body !== 'object') {
    return { status: 400, error: 'Invalid configuration data' };
  }

  try {
    const userConfigPath = ensureProfileTrainingConfig(user.username);

    // Load existing config or create new
    let config: Record<string, any> = {};
    if (fs.existsSync(userConfigPath)) {
      config = JSON.parse(fs.readFileSync(userConfigPath, 'utf-8'));
    }

    // Merge updates
    const updatedConfig = {
      ...config,
      ...body,
      lastUpdated: new Date().toISOString(),
    };

    safeWriteJSON(userConfigPath, updatedConfig);

    return successResponse({
      success: true,
      config: updatedConfig,
    });
  } catch (error) {
    console.error('[training-config-handler] Update error:', error);
    return {
      status: 500,
      error: (error as Error)?.message || 'Failed to update training configuration',
    };
  }
}

/**
 * GET /api/training-data - Get training data configuration
 * Returns the authenticated profile's unified training-data settings.
 */
export async function handleGetTrainingData(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const trainingConfigPath = ensureProfileTrainingConfig(req.user.username);

    const content = fs.readFileSync(trainingConfigPath, 'utf-8');
    const unified = JSON.parse(content);

    // Convert unified format to legacy format for backwards compatibility
    const config = {
      curator: unified.curator || getDefaultTrainingDataConfig().curator,
      collection: {
        maxDays: unified.data?.maxDays || 999999,
        maxSamplesPerSource: unified.data?.maxSamplesPerSource || 3000,
        includePersona: unified.data?.includePersona ?? true,
      },
      memoryTypes: unified.data?.memoryTypes || getDefaultTrainingDataConfig().memoryTypes,
      phases: unified.phases || getDefaultTrainingDataConfig().phases,
    };

    return successResponse({
      success: true,
      config,
    });
  } catch (error) {
    console.error('[training-data-handler] Error:', error);
    return {
      status: 500,
      error: (error as Error)?.message || 'Failed to load training data configuration',
    };
  }
}

/**
 * POST /api/training-data - Update training data configuration (owner only)
 * Updates the authenticated profile's unified training-data settings.
 */
export async function handleUpdateTrainingData(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { body } = req;

  if (!body || typeof body !== 'object') {
    return { status: 400, error: 'Invalid configuration data' };
  }

  try {
    const trainingConfigPath = ensureProfileTrainingConfig(req.user.username);

    // Load current unified config or create empty
    let unified: Record<string, any> = {};
    if (fs.existsSync(trainingConfigPath)) {
      unified = JSON.parse(fs.readFileSync(trainingConfigPath, 'utf-8'));
    }

    // Initialize data section if missing
    if (!unified.data) {
      unified.data = {
        maxDays: 999999,
        maxSamplesPerSource: 3000,
        max_samples: 3000,
        includePersona: true,
        memoryTypes: getDefaultTrainingDataConfig().memoryTypes,
      };
    }

    // Update curator settings if provided
    if (body.curator) {
      unified.curator = unified.curator || {};
      if (typeof body.curator.batchSize === 'number' && body.curator.batchSize > 0) {
        unified.curator.batchSize = body.curator.batchSize;
      }
      if (typeof body.curator.qualityThreshold === 'number') {
        unified.curator.qualityThreshold = Math.max(0, Math.min(10, body.curator.qualityThreshold));
      }
      if (typeof body.curator.temperature === 'number') {
        unified.curator.temperature = Math.max(0, Math.min(2, body.curator.temperature));
      }
    }

    // Update collection settings (mapped to data section)
    if (body.collection) {
      if (typeof body.collection.maxDays === 'number' && body.collection.maxDays > 0) {
        unified.data.maxDays = body.collection.maxDays;
      }
      if (typeof body.collection.maxSamplesPerSource === 'number' && body.collection.maxSamplesPerSource > 0) {
        unified.data.maxSamplesPerSource = body.collection.maxSamplesPerSource;
      }
      if (typeof body.collection.includePersona === 'boolean') {
        unified.data.includePersona = body.collection.includePersona;
      }
    }

    // Update memory types (mapped to data.memoryTypes)
    if (body.memoryTypes?.enabled && Array.isArray(body.memoryTypes.enabled)) {
      unified.data.memoryTypes = unified.data.memoryTypes || {};
      unified.data.memoryTypes.enabled = body.memoryTypes.enabled;
    }

    if (body.memoryTypes?.percentages && typeof body.memoryTypes.percentages === 'object') {
      unified.data.memoryTypes = unified.data.memoryTypes || {};
      unified.data.memoryTypes.percentages = unified.data.memoryTypes.percentages || {};
      for (const [type, value] of Object.entries(body.memoryTypes.percentages)) {
        if (typeof value === 'number') {
          unified.data.memoryTypes.percentages[type] = Math.max(0, Math.min(100, value));
        }
      }
    }

    safeWriteJSON(trainingConfigPath, unified);

    // Return legacy format for backwards compatibility
    const config = {
      curator: unified.curator || getDefaultTrainingDataConfig().curator,
      collection: {
        maxDays: unified.data?.maxDays || 999999,
        maxSamplesPerSource: unified.data?.maxSamplesPerSource || 3000,
        includePersona: unified.data?.includePersona ?? true,
      },
      memoryTypes: unified.data?.memoryTypes || getDefaultTrainingDataConfig().memoryTypes,
      phases: unified.phases || getDefaultTrainingDataConfig().phases,
    };

    return successResponse({
      success: true,
      config,
      message: 'Training data configuration updated successfully',
    });
  } catch (error) {
    console.error('[training-data-handler] Update error:', error);
    return {
      status: 500,
      error: (error as Error)?.message || 'Failed to update training data configuration',
    };
  }
}

function getDefaultTrainingDataConfig() {
  return {
    curator: {
      batchSize: 100,
      qualityThreshold: 6.0,
      temperature: 0.3,
    },
    collection: {
      maxDays: 999999,
      maxSamplesPerSource: 3000,
      includePersona: true,
    },
    memoryTypes: {
      enabled: [
        'conversation',
        'observation',
        'reflection',
        'reflection_summary',
        'inner_dialogue',
        'decision',
        'dream',
        'journal',
        'curiosity_question',
        'summary',
      ],
      priorities: {
        therapy_session: 10,
        conversation: 9,
        inner_dialogue: 8,
        reflection: 7,
        reflection_summary: 7,
        decision: 6,
        observation: 5,
        curiosity_question: 4,
        dream: 3,
        journal: 3,
        summary: 2,
      },
      percentages: {
        conversation: 40,
        observation: 25,
        therapy_session: 15,
        reflection: 5,
        reflection_summary: 3,
        inner_dialogue: 3,
        dream: 3,
        curiosity_question: 3,
        decision: 2,
        journal: 1,
        summary: 0,
      },
    },
    phases: {
      description: 'Recommended configurations for different training phases',
      phase1_conservative: {
        curator: { batchSize: 50, maxSamplesPerSource: 1000 },
        expectedSamples: '~800-1200',
        processingTime: '~15 mins',
      },
      phase2_optimal: {
        curator: { batchSize: 100, maxSamplesPerSource: 3000 },
        expectedSamples: '~2500-3000',
        processingTime: '~30 mins',
      },
      phase3_maximum: {
        curator: { batchSize: 150, maxSamplesPerSource: 5000 },
        expectedSamples: '~4000-5000',
        processingTime: '~45-60 mins',
      },
    },
  };
}

interface LaunchRequest {
  method: 'local-lora' | 'remote-lora' | 'fine-tune';
  trainingTarget?: 'ollama' | 'vllm';
  runpodConfig?: {
    apiKey: string;
    templateId: string;
    gpuType: string;
  };
  trainingConfig: {
    base_model: string;
    num_train_epochs: number;
    max_samples: number | null;
    monthly_training?: boolean;
    days_recent?: number;
    old_samples?: number;
    lora_rank: number;
    learning_rate: number;
    per_device_train_batch_size: number;
    gradient_accumulation_steps: number;
    max_seq_length: number;
    quantization: string;
    skipGguf?: boolean;
  };
  advancedSettings?: {
    enableS3Upload: boolean;
    enablePreprocessing: boolean;
  };
}

/**
 * GET /api/training/[operation] - Read training operation status file.
 */
export async function handleGetTrainingOperation(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const operation = req.params?.operation || req.params?.id;
    const statusFile = path.join(process.cwd(), 'logs/status', `${operation}.json`);

    if (!operation || !fs.existsSync(statusFile)) {
      return { status: 404, error: 'Training operation not found' };
    }

    const status = JSON.parse(fs.readFileSync(statusFile, 'utf-8'));
    const lastHeartbeat = new Date(status.lastHeartbeat);
    const now = new Date();
    const minutesSinceHeartbeat = (now.getTime() - lastHeartbeat.getTime()) / 60000;
    status.isHung = minutesSinceHeartbeat > 2 && status.overallStatus === 'running';

    if (status.startedAt) {
      const started = new Date(status.startedAt);
      status.elapsedSeconds = Math.floor((now.getTime() - started.getTime()) / 1000);
    }

    return successResponse(status);
  } catch (error) {
    return { status: 500, error: (error as Error).message };
  }
}

/**
 * POST /api/training/launch - Launch a brain/training job.
 */
export async function handleLaunchTraining(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    if (!req.user.isAuthenticated) {
      return { status: 401, data: { success: false, error: 'Authentication required' } };
    }

    const body = req.body as LaunchRequest | undefined;
    const { method, trainingTarget = 'ollama', runpodConfig, trainingConfig, advancedSettings } = body || {};

    if (method !== 'local-lora' && method !== 'remote-lora' && method !== 'fine-tune') {
      return {
        status: 400,
        data: { success: false, error: `Invalid training method: ${method}` },
      };
    }
    if (!['ollama', 'vllm'].includes(trainingTarget)) {
      return { status: 400, data: { success: false, error: `Invalid training target: ${trainingTarget}` } };
    }
    if (trainingTarget === 'vllm' && method !== 'remote-lora') {
      return {
        status: 400,
        data: { success: false, error: 'vLLM artifacts require remote LoRA training' },
      };
    }

    const configError = validateLaunchTrainingConfig(trainingConfig);
    if (configError) {
      return { status: 400, data: { success: false, error: configError } };
    }
    const launchConfig = trainingConfig as LaunchRequest['trainingConfig'];
    if ((method === 'remote-lora' || method === 'fine-tune') && (
      !runpodConfig
      || typeof runpodConfig.apiKey !== 'string'
      || runpodConfig.apiKey.trim().length === 0
      || typeof runpodConfig.templateId !== 'string'
      || runpodConfig.templateId.trim().length === 0
      || typeof runpodConfig.gpuType !== 'string'
      || runpodConfig.gpuType.trim().length === 0
    )) {
      return { status: 400, data: { success: false, error: 'Complete RunPod configuration is required' } };
    }

    const [running] = listTrainingProcesses();
    if (running) {
      return {
        status: 409,
        data: {
          success: false,
          error: `${running.name} is already running with PID ${running.pid}`,
        },
      };
    }

    const agentMap = {
      'local-lora': 'full-cycle-local.ts',
      'remote-lora': 'full-cycle.ts',
      'fine-tune': 'fine-tune-cycle.ts',
    };
    const agentFileName = agentMap[method];
    const agentPath = path.join(systemPaths.brain, 'training', agentFileName);

    if (!fs.existsSync(agentPath)) {
      return {
        status: 500,
        data: { success: false, error: `Training agent not found: ${agentFileName}` },
      };
    }

    const profilePaths = getProfilePaths(req.user.username);
    const trainingConfigPath = ensureProfileTrainingConfig(req.user.username);
    const shouldConvertToGguf = trainingTarget !== 'vllm' && !launchConfig.skipGguf;
    const {
      monthly_training,
      days_recent,
      old_samples,
      ...sharedTrainingConfig
    } = launchConfig;
    const fullConfig = {
      ...sharedTrainingConfig,
      ...(method === 'fine-tune' ? { monthly_training, days_recent, old_samples } : {}),
      trainingTarget,
      gguf_conversion: {
        enabled: shouldConvertToGguf,
        quantization_type: launchConfig.quantization || 'Q4_K_M',
      },
    };
    safeWriteJSON(trainingConfigPath, fullConfig);

    if ((method === 'remote-lora' || method === 'fine-tune') && runpodConfig) {
      const runpodConfigPath = path.join(profilePaths.etc, 'runpod.json');
      safeWriteJSON(runpodConfigPath, {
        apiKey: runpodConfig.apiKey,
        templateId: runpodConfig.templateId,
        gpuType: runpodConfig.gpuType,
      });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logPath = path.join(systemPaths.logs, 'run', `${agentFileName.replace('.ts', '')}-${timestamp}.log`);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const logStream = fs.openSync(logPath, 'w');

    const agentArgs: string[] = ['--username', req.user.username];
    if (method === 'fine-tune') {
      if (launchConfig.base_model) agentArgs.push('--base-model', launchConfig.base_model);
      if (launchConfig.monthly_training) {
        agentArgs.push('--monthly');
      } else {
        if (launchConfig.days_recent) agentArgs.push('--days-recent', String(launchConfig.days_recent));
        if (launchConfig.old_samples) agentArgs.push('--old-samples', String(launchConfig.old_samples));
      }
      if (launchConfig.max_samples) agentArgs.push('--max', String(launchConfig.max_samples));
    }

    const tsxPath = path.join(systemPaths.root, 'node_modules', '.bin', 'tsx');
    if (!fs.existsSync(tsxPath)) {
      return { status: 500, data: { success: false, error: 'Training runtime is not installed' } };
    }

    const trainingEnv: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_PATH: [
        path.join(systemPaths.root, 'node_modules'),
        path.join(systemPaths.root, 'packages/cli/node_modules'),
        path.join(systemPaths.root, 'apps/site/node_modules'),
      ].join(':'),
    };

    if (advancedSettings?.enableS3Upload === false) {
      trainingEnv.METAHUMAN_DISABLE_S3 = '1';
    }
    if (advancedSettings?.enablePreprocessing === false) {
      trainingEnv.METAHUMAN_SKIP_PREPROCESSING = '1';
    }
    if (runpodConfig?.gpuType) {
      trainingEnv.RUNPOD_GPU_TYPE = runpodConfig.gpuType;
    }
    if (runpodConfig?.apiKey) {
      trainingEnv.RUNPOD_API_KEY = runpodConfig.apiKey;
    }
    if (runpodConfig?.templateId) {
      trainingEnv.RUNPOD_TEMPLATE_ID = runpodConfig.templateId;
    }

    const child = spawn(tsxPath, [agentPath, ...agentArgs], {
      stdio: ['ignore', logStream, logStream],
      cwd: systemPaths.root,
      env: trainingEnv,
      detached: true,
    });

    let logClosed = false;
    let launchEnded = false;
    const closeLog = () => {
      if (logClosed) return;
      logClosed = true;
      fs.closeSync(logStream);
    };

    if (!child.pid) {
      child.once('error', closeLog);
      closeLog();
      return { status: 500, data: { success: false, error: 'Failed to spawn training agent' } };
    }
    const childPid = child.pid;

    const agentName = agentFileName.replace('.ts', '') as TrainingProcessName;
    const finalizeLaunch = (
      event: 'training_completed' | 'training_failed',
      details: Record<string, unknown>,
    ) => {
      if (launchEnded) return;
      launchEnded = true;
      closeLog();
      releaseTrainingProcess(agentName, childPid);
      audit({
        level: event === 'training_completed' ? 'info' : 'error',
        category: 'system',
        event,
        details: {
          agent: agentName,
          method,
          pid: childPid,
          username: req.user.username,
          logPath: path.basename(logPath),
          timestamp: new Date().toISOString(),
          ...details,
        },
        actor: req.user.username,
      });
    };

    child.once('error', (error) => {
      finalizeLaunch('training_failed', { error: error.message });
    });
    child.once('exit', (code, signal) => {
      finalizeLaunch(code === 0 ? 'training_completed' : 'training_failed', {
        exitCode: code,
        signal,
      });
    });

    try {
      trackTrainingProcess(agentName, childPid);
    } catch (error) {
      launchEnded = true;
      terminateDetachedProcess(childPid);
      closeLog();
      return {
        status: 500,
        data: {
          success: false,
          error: `Failed to track training process: ${(error as Error).message}`,
        },
      };
    }

    audit({
      level: 'info',
      category: 'system',
      event: 'training_started',
      details: {
        agent: agentName,
        method,
        trainingTarget,
        pid: childPid,
        username: req.user.username,
        config: launchConfig,
        runpodConfig: runpodConfig ? { templateId: runpodConfig.templateId, gpuType: runpodConfig.gpuType } : undefined,
        commandArgs: agentArgs,
        logPath: path.basename(logPath),
      },
      actor: req.user.username,
    });

    child.unref();

    return successResponse({
      success: true,
      pid: childPid,
      agentName,
      message: `Training agent ${agentName} started with PID ${childPid}`,
    });
  } catch (error) {
    return {
      status: 500,
      data: {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    };
  }
}

/**
 * POST /api/training/cancel - Stop the tracked training job.
 */
export async function handleCancelTraining(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const stopped = stopTrainingProcesses();
    if (stopped.length === 0) {
      return { status: 404, data: { success: false, error: 'No training process is running' } };
    }

    audit({
      level: 'info',
      category: 'action',
      event: 'training_cancelled',
      details: { processes: stopped },
      actor: req.user.username,
    });

    return successResponse({
      success: true,
      message: `Cancellation requested for ${stopped.map(({ name }) => name).join(', ')}`,
      processes: stopped,
    });
  } catch (error) {
    return {
      status: 500,
      data: {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to cancel training',
      },
    };
  }
}
