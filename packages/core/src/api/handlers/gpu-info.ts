/**
 * GPU Info API Handler
 *
 * GET system GPU information for training capabilities.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { systemPaths } from '../../paths.js';

const execAsync = promisify(exec);

interface GPUInfo {
  hasLocalGPU: boolean;
  gpuModel: string | null;
  vramGB: number | null;
  hasUnsloth: boolean;
  hasRunpodKey: boolean;
  hasPreviousModel: boolean;
  hasS3Configured: boolean;
}

/**
 * GET /api/system/gpu-info - Get system GPU capabilities
 */
export async function handleGetGpuInfo(req: UnifiedRequest): Promise<UnifiedResponse> {
  const info: GPUInfo = {
    hasLocalGPU: false,
    gpuModel: null,
    vramGB: null,
    hasUnsloth: false,
    hasRunpodKey: false,
    hasPreviousModel: false,
    hasS3Configured: false,
  };

  // 1. Check for NVIDIA GPU
  try {
    const { stdout } = await execAsync('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits');
    const lines = stdout.trim().split('\n');
    if (lines.length > 0) {
      const [gpuModel, vramMB] = lines[0].split(', ');
      info.hasLocalGPU = true;
      info.gpuModel = gpuModel.trim();
      info.vramGB = Math.round(parseFloat(vramMB) / 1024);
    }
  } catch {
    // nvidia-smi not found or failed, no GPU
  }

  // 2. Check for unsloth Python package
  try {
    await execAsync('python3 -c "import unsloth"');
    info.hasUnsloth = true;
  } catch {
    // unsloth not installed
  }

  // 3. Check for RunPod API key
  if (process.env.RUNPOD_API_KEY) {
    info.hasRunpodKey = true;
  } else {
    // Check if saved in config
    try {
      const configPath = path.join(systemPaths.etc, 'runpod.json');
      if (existsSync(configPath)) {
        const config = JSON.parse(readFileSync(configPath, 'utf-8'));
        if (config.apiKey) {
          info.hasRunpodKey = true;
        }
      }
    } catch {
      // No config file
    }
  }

  // 4. Check for previous training models
  try {
    const core = await import('../../model-resolver.js');
    const loadModelRegistry = core.loadModelRegistry;
    // System-level check, no user context needed
    const registry = loadModelRegistry();

    // Check if there are any fine-tuned models in the registry
    const hasFinetuned = Object.keys(registry.models || {}).some(key =>
      key.includes('finetune') || key.includes('lora') || key.includes('adapter')
    );

    // Also check if there's an active adapter
    const hasActiveAdapter = !!(registry.globalSettings?.useAdapter &&
                            registry.globalSettings?.activeAdapter?.status === 'loaded');

    info.hasPreviousModel = hasFinetuned || hasActiveAdapter;
  } catch {
    // Model registry error, assume no previous models
  }

  // 5. Check for S3 configuration
  if (process.env.RUNPOD_S3_ACCESS_KEY && process.env.RUNPOD_S3_SECRET_KEY) {
    info.hasS3Configured = true;
  }

  return successResponse(info);
}
