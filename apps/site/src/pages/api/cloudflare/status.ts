/**
 * GET /api/cloudflare/status
 * Returns current Cloudflare tunnel status
 */

import type { APIRoute } from 'astro';
import { getTunnelStatus } from '@metahuman/core/cloudflare-tunnel';

export const GET: APIRoute = async () => {
  try {
    const status = getTunnelStatus();

    return new Response(JSON.stringify(status), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[api/cloudflare/status] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to get tunnel status' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
