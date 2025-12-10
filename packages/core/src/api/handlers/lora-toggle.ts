/**
 * LoRA Toggle API Handlers
 *
 * Unified handlers for toggling LoRA adapter usage.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import fs from 'node:fs';
import path from 'node:path';
import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { systemPaths } from '../../paths.js';
import { storageClient } from '../../storage-client.js';
import { loadModelRegistry } from '../../model-resolver.js';
import { audit } from '../../audit.js';

function resolveModelsPath(username: string): string {
  const result = storageClient.resolvePath({
    username,
    category: 'config',
    subcategory: 'etc',
    relativePath: 'models.json',
  });
  if (result.success && result.path) {
    return result.path;
  }
  return path.join(systemPaths.etc, 'models.json');
}

/**
 * GET /api/lora-toggle - Get LoRA enabled state
 */
export async function handleGetLoraToggle(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user } = req;

  try {
    if (!user.isAuthenticated) {
      return successResponse({ enabled: false });
    }

    const registry = loadModelRegistry(false, user.username);
    const enabled = registry.globalSettings?.useAdapter ?? false;

    return successResponse({ enabled });
  } catch (error) {
    console.error('[lora-toggle] GET error:', error);
    return successResponse({ enabled: false });
  }
}

/**
 * POST /api/lora-toggle - Toggle LoRA adapter usage
 */
export async function handleSetLoraToggle(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, body } = req;

  if (!user.isAuthenticated) {
    return { status: 401, error: 'Authentication required' };
  }

  try {
    const enabled = body?.enabled ?? false;

    const modelsPath = resolveModelsPath(user.username);
    const registry = JSON.parse(fs.readFileSync(modelsPath, 'utf-8'));

    // Ensure globalSettings exists
    if (!registry.globalSettings) {
      registry.globalSettings = {
        includePersonaSummary: true,
        useAdapter: false,
        activeAdapter: null,
      };
    }

    // Update useAdapter flag
    registry.globalSettings.useAdapter = enabled;

    fs.mkdirSync(path.dirname(modelsPath), { recursive: true });
    fs.writeFileSync(modelsPath, JSON.stringify(registry, null, 2));

    audit({
      level: 'info',
      category: 'action',
      event: 'lora_toggled',
      details: { enabled, source: 'settings_ui' },
      actor: user.username,
    });

    return successResponse({ success: true, enabled });
  } catch (error) {
    console.error('[lora-toggle] POST error:', error);
    return { status: 500, error: (error as Error).message };
  }
}
