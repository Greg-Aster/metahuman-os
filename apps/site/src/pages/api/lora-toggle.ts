import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { paths, audit } from '@metahuman/core';

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const enabled = body.enabled ?? false;

    const agentConfigPath = path.join(paths.root, 'etc', 'agent.json');
    const config = JSON.parse(fs.readFileSync(agentConfigPath, 'utf-8'));

    // Update useAdapter flag
    config.useAdapter = enabled;

    fs.writeFileSync(agentConfigPath, JSON.stringify(config, null, 2));

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
    const agentConfigPath = path.join(paths.root, 'etc', 'agent.json');
    const config = JSON.parse(fs.readFileSync(agentConfigPath, 'utf-8'));

    return new Response(
      JSON.stringify({ enabled: config.useAdapter ?? false }),
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
