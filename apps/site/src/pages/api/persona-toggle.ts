/**
 * Persona Summary Toggle API
 * Toggles includePersonaSummary in models.json
 */

import type { APIRoute } from 'astro';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { audit } from '@metahuman/core/audit';
import { getSecurityPolicy } from '@metahuman/core/security-policy';
import { paths } from '@metahuman/core';

// Use paths.etc for user-specific config (context-aware)
function getModelsConfigPath(): string {
  return join(paths.etc, 'models.json');
}

interface ModelsConfig {
  globalSettings: {
    includePersonaSummary: boolean;
    useAdapter: boolean;
    activeAdapter: string | null;
  };
  [key: string]: any;
}

/**
 * GET - Get current persona summary status
 */
export const GET: APIRoute = async (context) => {
  try {
    const configPath = getModelsConfigPath();
    const config: ModelsConfig = JSON.parse(readFileSync(configPath, 'utf-8'));

    return new Response(
      JSON.stringify({
        success: true,
        includePersonaSummary: config.globalSettings.includePersonaSummary,
        useAdapter: config.globalSettings.useAdapter,
        activeAdapter: config.globalSettings.activeAdapter,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: `Failed to read models config: ${(error as Error).message}`
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

/**
 * POST - Toggle persona summary setting
 */
export const POST: APIRoute = async (context) => {
  try {
    const { request } = context;
    const body = await request.json();
    const { enabled } = body;

    if (typeof enabled !== 'boolean') {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Invalid request: enabled must be a boolean'
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get security policy
    const policy = getSecurityPolicy(context);

    // Emulation mode should always have persona enabled (safety lock)
    if (policy.mode === 'emulation' && !enabled) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Persona context cannot be disabled in emulation mode for safety.',
          locked: true,
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Read current config
    const configPath = getModelsConfigPath();
    const config: ModelsConfig = JSON.parse(readFileSync(configPath, 'utf-8'));

    // Update setting
    config.globalSettings.includePersonaSummary = enabled;

    // Write back to file
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

    // Audit the change
    audit({
      level: 'info',
      category: 'action',
      event: 'persona_summary_toggled',
      details: {
        enabled,
        cognitiveMode: policy.mode,
        hasAdapter: config.globalSettings.useAdapter,
        activeAdapter: config.globalSettings.activeAdapter,
      },
      actor: 'web_ui',
    });

    return new Response(
      JSON.stringify({
        success: true,
        includePersonaSummary: enabled,
        message: enabled
          ? 'Persona context enabled - LLM will receive personality, values, and memory grounding'
          : 'Persona context disabled - LLM will use default behavior without personality scaffold',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[persona-toggle] Error:', error);

    audit({
      level: 'error',
      category: 'system',
      event: 'persona_toggle_error',
      details: { error: (error as Error).message },
      actor: 'web_ui',
    });

    return new Response(
      JSON.stringify({
        success: false,
        error: `Failed to toggle persona summary: ${(error as Error).message}`
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
