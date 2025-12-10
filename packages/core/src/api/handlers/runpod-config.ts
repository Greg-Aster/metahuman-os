/**
 * RunPod Config API Handlers
 *
 * Returns the existing RunPod configuration for owner users.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { systemPaths } from '../../paths.js';
import fs from 'node:fs';
import path from 'node:path';

interface RunpodConfig {
  apiKey: string | null;
  templateId: string | null;
  gpuType: string | null;
}

/**
 * GET /api/runpod/config - Get RunPod configuration (owner only)
 */
export async function handleGetRunpodConfig(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user } = req;

  try {
    if (!user.isAuthenticated) {
      return {
        status: 401,
        error: 'Authentication required',
      };
    }

    // Only owner can access RunPod config
    if (user.role !== 'owner') {
      return {
        status: 403,
        error: 'Owner role required',
      };
    }

    const config: RunpodConfig = {
      apiKey: null,
      templateId: null,
      gpuType: null,
    };

    // 1. Check environment variables
    if (process.env.RUNPOD_API_KEY) {
      config.apiKey = process.env.RUNPOD_API_KEY;
    }
    if (process.env.RUNPOD_GPU_TYPE) {
      config.gpuType = process.env.RUNPOD_GPU_TYPE;
    }
    if (process.env.RUNPOD_TEMPLATE_ID) {
      config.templateId = process.env.RUNPOD_TEMPLATE_ID;
    }

    // 2. Check etc/runpod.json
    const configPath = path.join(systemPaths.root, 'etc', 'runpod.json');
    if (fs.existsSync(configPath)) {
      try {
        const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        config.apiKey = config.apiKey || fileConfig.apiKey || null;
        config.templateId = fileConfig.templateId || null;
        config.gpuType = fileConfig.gpuType || null;
      } catch {
        // Invalid JSON, ignore
      }
    }

    // 3. Check .env file in root directory
    const envPath = path.join(systemPaths.root, '.env');
    if (fs.existsSync(envPath)) {
      try {
        const envContent = fs.readFileSync(envPath, 'utf-8');
        const lines = envContent.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!config.apiKey && trimmed.startsWith('RUNPOD_API_KEY=')) {
            const value = trimmed.substring('RUNPOD_API_KEY='.length).trim();
            // Remove quotes if present
            config.apiKey = value.replace(/^["']|["']$/g, '');
          }
          if (!config.gpuType && trimmed.startsWith('RUNPOD_GPU_TYPE=')) {
            const value = trimmed.substring('RUNPOD_GPU_TYPE='.length).trim();
            config.gpuType = value.replace(/^["']|["']$/g, '');
          }
          if (!config.templateId && trimmed.startsWith('RUNPOD_TEMPLATE_ID=')) {
            const value = trimmed.substring('RUNPOD_TEMPLATE_ID='.length).trim();
            config.templateId = value.replace(/^["']|["']$/g, '');
          }
        }
      } catch {
        // Can't read .env, ignore
      }
    }

    return successResponse(config);
  } catch (error) {
    console.error('[runpod-config] GET error:', error);
    return {
      status: 500,
      error: (error as Error).message,
    };
  }
}
