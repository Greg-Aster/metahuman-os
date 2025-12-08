/**
 * System Handlers
 *
 * Unified handlers for system status and boot endpoints.
 * These work identically on web and mobile.
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { isRunning as isOllamaRunning, OllamaClient } from '../../ollama.js';

/**
 * GET /api/status - Basic system status
 */
export async function handleStatus(req: UnifiedRequest): Promise<UnifiedResponse> {
  const ollamaRunning = await isOllamaRunning().catch(() => false);

  return successResponse({
    status: 'ok',
    ollamaRunning,
    timestamp: new Date().toISOString(),
    platform: process.env.METAHUMAN_MOBILE ? 'mobile' : 'server',
  });
}

/**
 * GET /api/boot - Boot information for UI initialization
 */
export async function handleBoot(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user } = req;

  // Check Ollama status
  let ollamaStatus = { running: false, models: [] as string[] };
  try {
    const running = await isOllamaRunning();
    if (running) {
      const client = new OllamaClient();
      const models = await client.listModels();
      ollamaStatus = {
        running: true,
        models: models.map(m => m.name),
      };
    }
  } catch {
    // Ignore errors
  }

  return successResponse({
    authenticated: user.isAuthenticated,
    user: user.isAuthenticated ? {
      username: user.username,
      role: user.role,
    } : null,
    version: '1.0.0',
    platform: process.env.METAHUMAN_MOBILE ? 'mobile' : 'server',
    ollama: ollamaStatus,
    features: {
      localAgents: !process.env.METAHUMAN_MOBILE,
      localStorage: !!process.env.METAHUMAN_MOBILE,
      llmBridge: !!process.env.METAHUMAN_MOBILE,
    },
  });
}
