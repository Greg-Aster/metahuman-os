/**
 * POST /api/cloudflare/toggle
 * Toggle auto-start configuration for Cloudflare tunnel
 */

import type { APIRoute } from 'astro';
import { saveCloudflareConfig } from '@metahuman/core/cloudflare-tunnel';

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { enabled } = body;

    if (typeof enabled !== 'boolean') {
      return new Response(
        JSON.stringify({ error: 'Invalid request: enabled must be a boolean' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    saveCloudflareConfig({ enabled, autoStart: enabled });

    return new Response(
      JSON.stringify({ success: true, enabled }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[api/cloudflare/toggle] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to toggle tunnel configuration' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
