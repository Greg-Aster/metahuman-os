/**
 * POST /api/cloudflare/stop
 * Manually stop the Cloudflare tunnel
 */

import type { APIRoute } from 'astro';
import { stopTunnel } from '@metahuman/core/cloudflare-tunnel';

export const POST: APIRoute = async () => {
  try {
    const success = stopTunnel();

    if (success) {
      return new Response(
        JSON.stringify({ success: true, message: 'Tunnel stopped successfully' }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    } else {
      return new Response(
        JSON.stringify({ error: 'Failed to stop tunnel' }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  } catch (error) {
    console.error('[api/cloudflare/stop] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to stop tunnel' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
