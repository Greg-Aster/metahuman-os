/**
 * LLM Backend Switch API Handlers
 *
 * POST switch between backends (ollama, vllm, remote, auto).
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';

// Dynamic imports
let switchBackend: any;

async function ensureSwitchBackend(): Promise<boolean> {
  try {
    const core = await import('../../index.js');
    switchBackend = core.switchBackend;
    return !!switchBackend;
  } catch {
    return false;
  }
}

/**
 * POST /api/llm-backend/switch - Switch LLM backend
 */
export async function handleSwitchLlmBackend(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { user, body } = req;

    if (!user.isAuthenticated) {
      return { status: 401, error: 'Authentication required' };
    }

    if (user.role !== 'owner') {
      return { status: 403, error: 'Owner role required' };
    }

    const available = await ensureSwitchBackend();
    if (!available) {
      return { status: 501, error: 'Backend switch not available' };
    }

    const backend = body?.backend;
    const validBackends = ['ollama', 'vllm', 'remote', 'auto'];
    if (!backend || !validBackends.includes(backend)) {
      return { status: 400, error: `Invalid backend. Must be one of: ${validBackends.join(', ')}` };
    }

    const result = await switchBackend(backend, {
      actor: user.username,
    });

    if (!result.success) {
      return { status: 500, error: result.error };
    }

    return successResponse({
      success: true,
      backend,
    });
  } catch (error) {
    console.error('[llm-backend-switch] POST failed:', error);
    return { status: 500, error: (error as Error).message };
  }
}
