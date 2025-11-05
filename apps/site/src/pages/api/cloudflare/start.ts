/**
 * POST /api/cloudflare/start
 * Manually start the Cloudflare tunnel
 */

import type { APIRoute } from 'astro';
import { startTunnel, isCloudflaredInstalled } from '@metahuman/core/cloudflare-tunnel';

export const POST: APIRoute = async () => {
  try {
    if (!isCloudflaredInstalled()) {
      return new Response(
        JSON.stringify({ error: 'cloudflared is not installed' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const success = startTunnel();

    if (success) {
      return new Response(
        JSON.stringify({ success: true, message: 'Tunnel started successfully' }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    } else {
      return new Response(
        JSON.stringify({ error: 'Failed to start tunnel' }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  } catch (error) {
    console.error('[api/cloudflare/start] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to start tunnel' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
