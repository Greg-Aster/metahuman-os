/**
 * Training API Handlers
 *
 * Unified handlers for training configuration endpoints.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse, notFoundResponse } from '../types.js';
import { systemPaths } from '../../paths.js';
import { getProfilePaths } from '../../path-builder.js';
import { audit } from '../../audit.js';

/**
 * GET /api/training-config - Get training configuration
 */
export async function handleGetTrainingConfig(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { user } = req;

    // All users are authenticated (no anonymous access)
    // Get their profile-specific config
    const profilePaths = getProfilePaths(user.username);
    const userConfigPath = path.join(profilePaths.etc, 'training.json');

    // If user doesn't have training.json yet, try to copy from system defaults
    if (!fs.existsSync(userConfigPath)) {
      const systemConfigPath = path.join(systemPaths.etc, 'training.json');

      if (fs.existsSync(systemConfigPath)) {
        // Create user's etc directory if it doesn't exist
        fs.mkdirSync(profilePaths.etc, { recursive: true });

        // Copy system config as starting point
        const systemContent = fs.readFileSync(systemConfigPath, 'utf-8');
        fs.writeFileSync(userConfigPath, systemContent, 'utf-8');
      } else {
        return notFoundResponse('Training configuration not found');
      }
    }

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
    const profilePaths = getProfilePaths(user.username);
    const userConfigPath = path.join(profilePaths.etc, 'training.json');

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

    // Ensure directory exists
    fs.mkdirSync(profilePaths.etc, { recursive: true });

    // Write updated config
    fs.writeFileSync(userConfigPath, JSON.stringify(updatedConfig, null, 2), 'utf-8');

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
 * NOTE: Now reads from unified etc/training.json and extracts data section
 */
export async function handleGetTrainingData(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const trainingConfigPath = path.join(systemPaths.etc, 'training.json');

    // Return default config if file doesn't exist
    if (!fs.existsSync(trainingConfigPath)) {
      return successResponse({
        success: true,
        config: getDefaultTrainingDataConfig(),
      });
    }

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
 * NOTE: Now writes to unified etc/training.json, preserving other sections
 */
export async function handleUpdateTrainingData(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { body } = req;

  if (!body || typeof body !== 'object') {
    return { status: 400, error: 'Invalid configuration data' };
  }

  try {
    const trainingConfigPath = path.join(systemPaths.etc, 'training.json');

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
        monthly_training: true,
        days_recent: 30,
        old_samples: 3000,
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

    // Ensure directory exists
    fs.mkdirSync(path.dirname(trainingConfigPath), { recursive: true });

    // Save updated unified config
    fs.writeFileSync(trainingConfigPath, JSON.stringify(unified, null, 2), 'utf-8');

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
  trainingTarget?: 'ollama' | 'vllm' | 'both';
  runpodConfig?: {
    apiKey: string;
    templateId: string;
    gpuType: string;
  };
  trainingConfig: {
    base_model: string;
    num_train_epochs: number;
    max_samples: number | null;
    monthly_training: boolean;
    days_recent: number;
    old_samples: number;
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

    const body = req.body as LaunchRequest;
    const { method, trainingTarget = 'ollama', runpodConfig, trainingConfig, advancedSettings } = body || {};

    if (!['local-lora', 'remote-lora', 'fine-tune'].includes(method)) {
      return {
        status: 400,
        data: { success: false, error: `Invalid training method: ${method}` },
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

    const trainingConfigPath = path.join(systemPaths.root, 'etc', 'training.json');
    const shouldConvertToGguf = trainingTarget !== 'vllm' && !trainingConfig.skipGguf;
    const fullConfig = {
      ...trainingConfig,
      trainingTarget,
      gguf_conversion: {
        enabled: shouldConvertToGguf,
        quantization_type: trainingConfig.quantization || 'Q4_K_M',
      },
    };
    fs.writeFileSync(trainingConfigPath, JSON.stringify(fullConfig, null, 2));

    if ((method === 'remote-lora' || method === 'fine-tune') && runpodConfig) {
      const runpodConfigPath = path.join(systemPaths.root, 'etc', 'runpod.json');
      fs.writeFileSync(
        runpodConfigPath,
        JSON.stringify(
          {
            apiKey: runpodConfig.apiKey,
            templateId: runpodConfig.templateId,
            gpuType: runpodConfig.gpuType,
          },
          null,
          2
        )
      );
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logPath = path.join(systemPaths.logs, 'run', `${agentFileName.replace('.ts', '')}-${timestamp}.log`);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const logStream = fs.openSync(logPath, 'w');

    const agentArgs: string[] = ['--username', req.user.username];
    if (method === 'fine-tune') {
      if (trainingConfig.base_model) agentArgs.push('--base-model', trainingConfig.base_model);
      if (trainingConfig.monthly_training) {
        agentArgs.push('--monthly');
      } else {
        if (trainingConfig.days_recent) agentArgs.push('--days-recent', String(trainingConfig.days_recent));
        if (trainingConfig.old_samples) agentArgs.push('--old-samples', String(trainingConfig.old_samples));
      }
      if (trainingConfig.max_samples) agentArgs.push('--max', String(trainingConfig.max_samples));
    }

    const tsxPath = path.join(systemPaths.root, 'apps', 'site', 'node_modules', '.bin', 'tsx');
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

    const child = spawn(tsxPath, [agentPath, ...agentArgs], {
      stdio: ['ignore', logStream, logStream],
      cwd: systemPaths.root,
      env: trainingEnv,
      detached: true,
    });

    if (!child.pid) {
      fs.closeSync(logStream);
      return { status: 500, data: { success: false, error: 'Failed to spawn training agent' } };
    }

    const agentName = agentFileName.replace('.ts', '');
    child.on('exit', (code, signal) => {
      fs.closeSync(logStream);
      audit({
        level: code === 0 ? 'info' : 'error',
        category: 'system',
        event: code === 0 ? 'training_completed' : 'training_failed',
        details: {
          agent: agentName,
          method,
          pid: child.pid,
          username: req.user.username,
          exitCode: code,
          signal,
          logPath: path.basename(logPath),
          timestamp: new Date().toISOString(),
        },
        actor: req.user.username,
      });

      const pidPath = path.join(systemPaths.logs, 'run', `${agentName}.pid`);
      if (fs.existsSync(pidPath)) {
        fs.unlinkSync(pidPath);
      }
    });

    const pidPath = path.join(systemPaths.logs, 'run', `${agentName}.pid`);
    fs.writeFileSync(pidPath, String(child.pid), 'utf-8');

    audit({
      level: 'info',
      category: 'system',
      event: 'training_started',
      details: {
        agent: agentName,
        method,
        trainingTarget,
        pid: child.pid,
        username: req.user.username,
        config: trainingConfig,
        runpodConfig: runpodConfig ? { templateId: runpodConfig.templateId, gpuType: runpodConfig.gpuType } : undefined,
        commandArgs: agentArgs,
        logPath: path.basename(logPath),
      },
      actor: req.user.username,
    });

    child.unref();

    return successResponse({
      success: true,
      pid: child.pid,
      agentName,
      message: `Training agent ${agentName} started with PID ${child.pid}`,
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
 * POST /api/training/load-model - Load the most recent trained model into Ollama.
 */
export async function handleLoadTrainingModel(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    if (!req.user.isAuthenticated) {
      return { status: 401, data: { success: false, error: 'Authentication required' } };
    }

    const profilePaths = getProfilePaths(req.user.username);
    const { modelType } = (req.body || {}) as { modelType: 'merged' | 'adapter' | 'both' };
    const adaptersDir = path.join(profilePaths.out, 'adapters');
    if (!fs.existsSync(adaptersDir)) {
      return { status: 404, data: { success: false, error: 'No training outputs found' } };
    }

    const dates = fs.readdirSync(adaptersDir)
      .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
      .sort()
      .reverse();

    if (dates.length === 0) {
      return { status: 404, data: { success: false, error: 'No training outputs found' } };
    }

    let recentRun: string | null = null;
    let recentDate: string | null = null;
    for (const date of dates) {
      const datePath = path.join(adaptersDir, date);
      const runs = fs.readdirSync(datePath)
        .filter((run) => fs.statSync(path.join(datePath, run)).isDirectory())
        .sort()
        .reverse();

      if (runs.length > 0) {
        recentDate = date;
        recentRun = runs[0];
        break;
      }
    }

    if (!recentRun || !recentDate) {
      return { status: 404, data: { success: false, error: 'No recent training run found' } };
    }

    const runDir = path.join(adaptersDir, recentDate, recentRun);
    const mergedGgufPath = path.join(runDir, 'adapter.gguf');
    const adapterDir = path.join(runDir, 'adapter');
    const hasMerged = fs.existsSync(mergedGgufPath);
    const hasAdapter = fs.existsSync(adapterDir) && fs.existsSync(path.join(adapterDir, 'adapter_model.safetensors'));

    if (!hasMerged && !hasAdapter) {
      return { status: 404, data: { success: false, error: 'No trained model files found in recent run' } };
    }

    const modelName = `${req.user.username}-${recentDate}-${recentRun}`;
    const messages: string[] = [];

    try {
      execSync('ollama list', { stdio: 'ignore' });
    } catch {
      return { status: 500, data: { success: false, error: 'Ollama server not running. Please start Ollama first.' } };
    }

    if ((modelType === 'merged' || modelType === 'both') && hasMerged) {
      const modelfilePath = path.join(runDir, 'Modelfile');
      if (!fs.existsSync(modelfilePath)) {
        const modelfileContent = `# MetaHuman OS Fully-Merged Model - ${req.user.username} - ${recentDate}
FROM ${mergedGgufPath}

TEMPLATE """{{ if .System }}<|im_start|>system
{{ .System }}<|im_end|>
{{ end }}{{ if .Prompt }}<|im_start|>user
{{ .Prompt }}<|im_end|>
{{ end }}<|im_start|>assistant
{{ .Response }}<|im_end|>
"""

SYSTEM You are ${req.user.username}'s digital personality extension. Speak naturally in first person as ${req.user.username}.`;
        fs.writeFileSync(modelfilePath, modelfileContent);
      }

      try {
        execSync(`ollama create ${modelName} -f "${modelfilePath}"`, { stdio: 'inherit' });
        messages.push(`Merged model loaded as: ${modelName}`);
        audit({
          level: 'info',
          category: 'action',
          event: 'model_loaded',
          details: { modelType: 'merged', modelName, runDir },
          actor: req.user.username,
        });
      } catch (error) {
        return {
          status: 500,
          data: { success: false, error: `Failed to load merged model: ${(error as Error).message}` },
        };
      }
    }

    if ((modelType === 'adapter' || modelType === 'both') && hasAdapter) {
      messages.push('LoRA adapter available in adapter management system');
      audit({
        level: 'info',
        category: 'action',
        event: 'adapter_noted',
        details: { modelType: 'adapter', adapterPath: adapterDir },
        actor: req.user.username,
      });
    }

    return successResponse({
      success: true,
      message: messages.join('. '),
      modelName,
      runDir,
    });
  } catch (error) {
    console.error('[training-load-model-handler] Error:', error);
    return { status: 500, data: { success: false, error: (error as Error).message } };
  }
}
