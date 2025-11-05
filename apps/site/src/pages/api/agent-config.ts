import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { paths } from '@metahuman/core';
import { audit } from '@metahuman/core';
import { requireOwner } from '../../middleware/cognitiveModeGuard';

const AGENT_CONFIG_PATH = path.join(paths.root, 'etc', 'agent.json');

/**
 * GET /api/agent-config
 * Retrieve current agent configuration
 */
export const GET: APIRoute = async () => {
  try {
    if (!fs.existsSync(AGENT_CONFIG_PATH)) {
      return new Response(
        JSON.stringify({ error: 'Agent config not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const configData = fs.readFileSync(AGENT_CONFIG_PATH, 'utf-8');
    const config = JSON.parse(configData);

    return new Response(
      JSON.stringify({ success: true, config }),
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
 * Update agent configuration (owner only)
 * Body: { includePersonaSummary?: boolean, model?: string, useAdapter?: boolean }
 */
const postHandler: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();

    // Read current config
    if (!fs.existsSync(AGENT_CONFIG_PATH)) {
      return new Response(
        JSON.stringify({ error: 'Agent config not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const configData = fs.readFileSync(AGENT_CONFIG_PATH, 'utf-8');
    const config = JSON.parse(configData);

    // Update only the provided fields
    if (body.includePersonaSummary !== undefined) {
      config.includePersonaSummary = Boolean(body.includePersonaSummary);
    }

    if (body.model !== undefined) {
      config.model = String(body.model);
    }

    if (body.useAdapter !== undefined) {
      config.useAdapter = Boolean(body.useAdapter);
    }

    // Write updated config
    fs.writeFileSync(AGENT_CONFIG_PATH, JSON.stringify(config, null, 2));

    // Audit the change
    audit({
      level: 'info',
      category: 'security',
      event: 'agent_config_updated',
      details: {
        changes: Object.keys(body),
        includePersonaSummary: config.includePersonaSummary,
      },
      actor: 'web_ui',
    });

    return new Response(
      JSON.stringify({ success: true, config }),
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
