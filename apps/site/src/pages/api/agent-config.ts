import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { paths, audit } from '@metahuman/core';
import { loadModelRegistry } from '@metahuman/core/model-resolver';
import { requireOwner } from '../../middleware/cognitiveModeGuard';

// Use paths.etc for user-specific config (context-aware)
function getModelsConfigPath(): string {
  return path.join(paths.etc, 'models.json');
}

/**
 * GET /api/agent-config
 * Retrieve global settings from models.json
 */
export const GET: APIRoute = async () => {
  try {
    const registry = loadModelRegistry();
    const globalSettings = registry.globalSettings || {
      includePersonaSummary: true,
      useAdapter: false,
      activeAdapter: null,
    };

    return new Response(
      JSON.stringify({ success: true, config: globalSettings }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[agent-config] Failed to load config:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

/**
 * POST /api/agent-config
 * Update global settings in models.json (owner only)
 * Body: { includePersonaSummary?: boolean, useAdapter?: boolean }
 */
const postHandler: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();

    // Read current registry
    const configPath = getModelsConfigPath();
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
    if (body.includePersonaSummary !== undefined) {
      registry.globalSettings.includePersonaSummary = Boolean(body.includePersonaSummary);
    }

    if (body.useAdapter !== undefined) {
      registry.globalSettings.useAdapter = Boolean(body.useAdapter);
    }

    // Write updated registry
    fs.writeFileSync(configPath, JSON.stringify(registry, null, 2));

    // Audit the change
    audit({
      level: 'info',
      category: 'security',
      event: 'agent_config_updated',
      details: {
        changes: Object.keys(body),
        includePersonaSummary: registry.globalSettings.includePersonaSummary,
      },
      actor: 'web_ui',
    });

    return new Response(
      JSON.stringify({ success: true, config: registry.globalSettings }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[agent-config] Failed to update config:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

// Wrap POST with owner-only guard
export const POST = requireOwner(postHandler);
