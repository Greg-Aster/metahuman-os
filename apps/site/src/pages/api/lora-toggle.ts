import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { paths, audit } from '@metahuman/core';
import { loadModelRegistry } from '@metahuman/core/model-resolver';

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const enabled = body.enabled ?? false;

    const modelsPath = path.join(paths.etc, 'models.json');
    const registry = JSON.parse(fs.readFileSync(modelsPath, 'utf-8'));

    // Ensure globalSettings exists
    if (!registry.globalSettings) {
      registry.globalSettings = { includePersonaSummary: true, useAdapter: false, activeAdapter: null };
    }

    // Update useAdapter flag
    registry.globalSettings.useAdapter = enabled;

    fs.writeFileSync(modelsPath, JSON.stringify(registry, null, 2));

    audit({
      level: 'info',
      category: 'action',
      event: 'lora_toggled',
      details: { enabled, source: 'settings_ui' },
      actor: 'user',
    });

    return new Response(
      JSON.stringify({ success: true, enabled }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: (error as Error).message }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};

export const GET: APIRoute = async () => {
  try {
    const registry = loadModelRegistry();
    const enabled = registry.globalSettings?.useAdapter ?? false;

    return new Response(
      JSON.stringify({ enabled }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ enabled: false }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
