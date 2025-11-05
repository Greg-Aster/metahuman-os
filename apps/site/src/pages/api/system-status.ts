import type { APIRoute } from 'astro';
import { getSystemStatus } from '@metahuman/core/env-config';

/**
 * GET /api/system-status
 *
 * Returns system configuration status including active triggers
 * and allowed cognitive modes.
 */
export const GET: APIRoute = async () => {
  try {
    const status = getSystemStatus();

    return new Response(
      JSON.stringify({
        success: true,
        ...status,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store', // Don't cache, env vars can change
        },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: (error as Error).message,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
