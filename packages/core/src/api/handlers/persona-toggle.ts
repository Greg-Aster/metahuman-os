/**
 * Persona Toggle API Handlers
 *
 * Toggles includePersonaSummary in models.json.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { systemPaths } from '../../paths.js';
import { audit } from '../../audit.js';
import fs from 'node:fs';
import path from 'node:path';

interface ModelsConfig {
  globalSettings: {
    includePersonaSummary: boolean;
    useAdapter: boolean;
    activeAdapter: string | null;
  };
  [key: string]: any;
}

function getModelsConfigPath(): string {
  return path.join(systemPaths.etc, 'models.json');
}

/**
 * GET /api/persona-toggle - Get current persona summary status
 */
export async function handleGetPersonaToggle(_req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const configPath = getModelsConfigPath();
    const config: ModelsConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

    return successResponse({
      success: true,
      includePersonaSummary: config.globalSettings.includePersonaSummary,
      useAdapter: config.globalSettings.useAdapter,
      activeAdapter: config.globalSettings.activeAdapter,
    });
  } catch (error) {
    console.error('[persona-toggle] GET error:', error);
    return {
      status: 500,
      error: `Failed to read models config: ${(error as Error).message}`,
    };
  }
}

/**
 * POST /api/persona-toggle - Toggle persona summary setting
 * Body: { enabled: boolean }
 */
export async function handleSetPersonaToggle(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, body } = req;

  try {
    const { enabled } = body || {};

    if (typeof enabled !== 'boolean') {
      return {
        status: 400,
        error: 'Invalid request: enabled must be a boolean',
      };
    }

    // Read current config
    const configPath = getModelsConfigPath();
    const config: ModelsConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

    // Update setting
    config.globalSettings.includePersonaSummary = enabled;

    // Write back to file
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

    // Audit the change
    audit({
      level: 'info',
      category: 'action',
      event: 'persona_summary_toggled',
      details: {
        enabled,
        hasAdapter: config.globalSettings.useAdapter,
        activeAdapter: config.globalSettings.activeAdapter,
      },
      actor: user.username || 'anonymous',
    });

    return successResponse({
      success: true,
      includePersonaSummary: enabled,
      message: enabled
        ? 'Persona context enabled - LLM will receive personality, values, and memory grounding'
        : 'Persona context disabled - LLM will use default behavior without personality scaffold',
    });
  } catch (error) {
    console.error('[persona-toggle] POST error:', error);

    audit({
      level: 'error',
      category: 'system',
      event: 'persona_toggle_error',
      details: { error: (error as Error).message },
      actor: req.user.username || 'anonymous',
    });

    return {
      status: 500,
      error: `Failed to toggle persona summary: ${(error as Error).message}`,
    };
  }
}
