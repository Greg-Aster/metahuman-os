/**
 * Agent Config API Handlers
 *
 * Unified handlers for agent configuration (globalSettings in models.json).
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

/**
 * Resolve user-specific models.json path via storage router
 */
function getModelsConfigPath(username: string): string {
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
 * GET /api/agent-config - Get global agent settings
 */
export async function handleGetAgentConfig(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user } = req;

  try {
    const username = user.isAuthenticated ? user.username : undefined;
    const registry = loadModelRegistry(false, username);
    const globalSettings = registry.globalSettings || {
      includePersonaSummary: true,
      useAdapter: false,
      activeAdapter: null,
    };

    return successResponse({ success: true, config: globalSettings });
  } catch (error) {
    console.error('[agent-config] GET error:', error);
    return { status: 500, error: (error as Error).message };
  }
}

/**
 * POST /api/agent-config - Update global agent settings (owner only)
 */
export async function handleSetAgentConfig(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, body } = req;

  if (!user.isAuthenticated) {
    return { status: 401, error: 'Authentication required' };
  }

  if (user.role !== 'owner') {
    return { status: 403, error: 'Owner role required' };
  }

  try {
    // Read current registry from user-specific path
    const configPath = getModelsConfigPath(user.username);
    const registry = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

    // Ensure globalSettings exists
    if (!registry.globalSettings) {
      registry.globalSettings = {
        includePersonaSummary: true,
        useAdapter: false,
        activeAdapter: null,
      };
    }

    // Update only the provided fields
    if (body?.includePersonaSummary !== undefined) {
      registry.globalSettings.includePersonaSummary = Boolean(body.includePersonaSummary);
    }

    if (body?.useAdapter !== undefined) {
      registry.globalSettings.useAdapter = Boolean(body.useAdapter);
    }

    // Write updated registry
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(registry, null, 2));

    // Audit the change
    audit({
      level: 'info',
      category: 'security',
      event: 'agent_config_updated',
      details: {
        changes: Object.keys(body || {}),
        includePersonaSummary: registry.globalSettings.includePersonaSummary,
      },
      actor: user.username,
    });

    return successResponse({ success: true, config: registry.globalSettings });
  } catch (error) {
    console.error('[agent-config] POST error:', error);
    return { status: 500, error: (error as Error).message };
  }
}
