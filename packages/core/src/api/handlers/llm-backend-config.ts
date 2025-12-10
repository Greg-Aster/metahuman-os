/**
 * LLM Backend Config API Handlers
 *
 * GET/PUT LLM backend configuration.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';

// Dynamic imports
let loadBackendConfig: any;
let saveBackendConfig: any;

async function ensureBackendFunctions(): Promise<boolean> {
  try {
    const core = await import('../../index.js');
    loadBackendConfig = core.loadBackendConfig;
    saveBackendConfig = core.saveBackendConfig;
    return !!(loadBackendConfig && saveBackendConfig);
  } catch {
    return false;
  }
}

/**
 * GET /api/llm-backend/config - Get LLM backend configuration
 */
export async function handleGetLlmBackendConfig(_req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const available = await ensureBackendFunctions();
    if (!available) {
      return { status: 501, error: 'Backend functions not available' };
    }

    const config = loadBackendConfig();
    return successResponse(config);
  } catch (error) {
    console.error('[llm-backend-config] GET failed:', error);
    return { status: 500, error: (error as Error).message };
  }
}

/**
 * PUT /api/llm-backend/config - Update LLM backend configuration
 */
export async function handleSetLlmBackendConfig(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { user, body } = req;

    if (!user.isAuthenticated) {
      return { status: 401, error: 'Authentication required' };
    }

    if (user.role !== 'owner') {
      return { status: 403, error: 'Owner role required' };
    }

    const available = await ensureBackendFunctions();
    if (!available) {
      return { status: 501, error: 'Backend functions not available' };
    }

    const updates = body || {};

    // Validate updates
    const validBackends = ['ollama', 'vllm', 'remote', 'auto'];
    if (updates.activeBackend && !validBackends.includes(updates.activeBackend)) {
      return { status: 400, error: `Invalid activeBackend. Must be one of: ${validBackends.join(', ')}` };
    }

    if (updates.vllm?.gpuMemoryUtilization !== undefined) {
      const util = updates.vllm.gpuMemoryUtilization;
      if (util < 0.1 || util > 0.99) {
        return { status: 400, error: 'gpuMemoryUtilization must be between 0.1 and 0.99' };
      }
    }

    saveBackendConfig(updates);
    const newConfig = loadBackendConfig(true);

    return successResponse({
      success: true,
      config: newConfig,
    });
  } catch (error) {
    console.error('[llm-backend-config] PUT failed:', error);
    return { status: 500, error: (error as Error).message };
  }
}
