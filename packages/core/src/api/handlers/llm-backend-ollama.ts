/**
 * Ollama Backend Control API Handlers
 *
 * POST control Ollama (unload models, stop/start service).
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';

// Dynamic imports
let ollama: any;
let stopOllamaService: any;
let startOllamaService: any;

async function ensureOllamaFunctions(): Promise<boolean> {
  try {
    const core = await import('../../index.js');
    ollama = core.ollama;
    stopOllamaService = core.stopOllamaService;
    startOllamaService = core.startOllamaService;
    return !!(ollama && stopOllamaService && startOllamaService);
  } catch {
    return false;
  }
}

/**
 * POST /api/llm-backend/ollama - Control Ollama service
 */
export async function handleOllamaControl(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { user, body } = req;

    if (!user.isAuthenticated) {
      return { status: 401, error: 'Authentication required' };
    }

    if (user.role !== 'owner') {
      return { status: 403, error: 'Owner role required' };
    }

    const available = await ensureOllamaFunctions();
    if (!available) {
      return { status: 501, error: 'Ollama functions not available' };
    }

    const action = body?.action;

    switch (action) {
      case 'unload': {
        const result = await ollama.unloadAllModels();
        return successResponse({
          success: true,
          unloaded: result.unloaded,
          errors: result.errors,
        });
      }

      case 'stop': {
        const result = await stopOllamaService();
        if (!result.success) {
          return { status: 500, error: result.error };
        }
        return successResponse({ success: true });
      }

      case 'start': {
        const result = await startOllamaService();
        if (!result.success) {
          return { status: 500, error: result.error };
        }
        return successResponse({ success: true });
      }

      default:
        return { status: 400, error: 'Invalid action. Must be "unload", "stop", or "start"' };
    }
  } catch (error) {
    console.error('[llm-backend-ollama] POST failed:', error);
    return { status: 500, error: (error as Error).message };
  }
}
