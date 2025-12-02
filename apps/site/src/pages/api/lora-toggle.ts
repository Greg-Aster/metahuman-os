import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { systemPaths, audit, getAuthenticatedUser, storageClient } from '@metahuman/core';
import { loadModelRegistry } from '@metahuman/core/model-resolver';

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

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    const body = await request.json();
    const enabled = body.enabled ?? false;

    const modelsPath = resolveModelsPath(user.username);
    const registry = JSON.parse(fs.readFileSync(modelsPath, 'utf-8'));

    // Ensure globalSettings exists
    if (!registry.globalSettings) {
      registry.globalSettings = { includePersonaSummary: true, useAdapter: false, activeAdapter: null };
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

export const GET: APIRoute = async ({ cookies }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    const registry = loadModelRegistry(false, user.username);
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
