/**
 * GPU Status API Handlers
 *
 * Unified handlers for GPU status monitoring.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { ollama } from '../../ollama.js';

interface GPUInfo {
  index: number;
  name: string;
  memory: {
    total: number;
    used: number;
    free: number;
    usedPercent: number;
    freePercent: number;
  };
  utilization: {
    gpu: number;
    memory: number;
  };
}

interface GPUProcess {
  pid: number;
  name: string;
  memory: number;
}

interface Recommendation {
  level: 'critical' | 'warning' | 'success' | 'info';
  message: string;
  action: string | null;
}

/**
 * GET /api/gpu-status - Get GPU status and recommendations
 */
export async function handleGetGpuStatus(_req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    // Get GPU information
    let gpuQuery: string;
    try {
      gpuQuery = execFileSync('nvidia-smi', [
        '--query-gpu=index,name,memory.total,memory.used,memory.free,utilization.gpu,utilization.memory',
        '--format=csv,noheader,nounits',
      ], { encoding: 'utf8' });
    } catch {
      return successResponse({
        available: false,
        error: 'No NVIDIA GPU detected (nvidia-smi unavailable)',
      });
    }

    const lines = gpuQuery.trim().split('\n');
    const gpus: GPUInfo[] = lines.map(line => {
      const [index, name, total, used, free, gpuUtil, memUtil] = line
        .split(',')
        .map(s => s.trim());

      const totalNum = parseInt(total, 10);
      const usedNum = parseInt(used, 10);
      const freeNum = parseInt(free, 10);

      return {
        index: parseInt(index, 10),
        name,
        memory: {
          total: totalNum,
          used: usedNum,
          free: freeNum,
          usedPercent: Math.round((usedNum * 100) / totalNum),
          freePercent: Math.round((freeNum * 100) / totalNum),
        },
        utilization: {
          gpu: parseInt(gpuUtil, 10),
          memory: parseInt(memUtil, 10),
        },
      };
    });

    // Check if Ollama is running
    const ollamaRunning = await ollama.isRunning();
    let ollamaVramLimit: string | null = null;

    if (ollamaRunning) {
      // Check if systemd service has VRAM limit configured
      try {
        const serviceActive = execFileSync('systemctl', ['is-active', 'ollama'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();

        if (serviceActive === 'active') {
          const limitPath = '/etc/systemd/system/ollama.service.d/gpu-mem-limit.conf';
          if (fs.existsSync(limitPath)) {
            const match = fs.readFileSync(limitPath, 'utf8').match(/OLLAMA_GPU_MEM_FRACTION=["']?([0-9.]+)["']?/);
            if (match) ollamaVramLimit = match[1];
          }
        }
      } catch {
        // systemd not available or ollama not a service
      }
    }

    // Get GPU processes
    let processes: GPUProcess[] = [];
    try {
      const processOutput = execFileSync('nvidia-smi', [
        '--query-compute-apps=pid,process_name,used_memory',
        '--format=csv,noheader',
      ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

      processes = processOutput
        .trim()
        .split('\n')
        .filter(line => line)
        .map(line => {
          const [pid, name, mem] = line.split(',').map(s => s.trim());
          return {
            pid: parseInt(pid, 10),
            name,
            memory: parseInt(mem, 10),
          };
        });
    } catch {
      // No processes or query failed
    }

    // Generate recommendations
    const recommendations: Recommendation[] = [];
    const primaryGPU = gpus[0];

    if (primaryGPU.memory.free < 3000) {
      recommendations.push({
        level: 'critical',
        message: `Low free VRAM (${primaryGPU.memory.free}MB). Reduce Ollama VRAM usage or limit may cause OOM errors.`,
        action: 'configure-vram',
      });
    } else if (primaryGPU.memory.free < 4000) {
      recommendations.push({
        level: 'warning',
        message: `Limited free VRAM (${primaryGPU.memory.free}MB). RVC may compete with Ollama for VRAM.`,
        action: 'configure-vram',
      });
    } else {
      recommendations.push({
        level: 'success',
        message: `Sufficient free VRAM (${primaryGPU.memory.free}MB) for RVC inference.`,
        action: null,
      });
    }

    if (ollamaRunning && !ollamaVramLimit) {
      recommendations.push({
        level: 'info',
        message: 'Ollama VRAM limit not configured. Consider setting a limit for better GPU sharing.',
        action: 'configure-vram',
      });
    }

    return successResponse({
      available: true,
      gpus,
      ollama: {
        running: ollamaRunning,
        pid: null,
        vramLimit: ollamaVramLimit,
      },
      processes,
      recommendations,
    });
  } catch (error) {
    console.error('[gpu-status] GET error:', error);
    return {
      status: 500,
      error: String(error),
      data: { available: false },
    };
  }
}
