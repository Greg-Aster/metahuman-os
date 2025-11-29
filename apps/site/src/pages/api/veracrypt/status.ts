/**
 * VeraCrypt Status API
 *
 * Returns the VeraCrypt installation status for the current system.
 */

import type { APIRoute } from 'astro';
import { checkVeraCrypt, getInstallInstructions } from '@metahuman/core';

export const GET: APIRoute = async () => {
  try {
    const status = checkVeraCrypt();

    return new Response(
      JSON.stringify({
        ...status,
        installInstructions: status.installed ? undefined : getInstallInstructions(),
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[api/veracrypt/status] Error:', error);
    return new Response(
      JSON.stringify({
        installed: false,
        platform: 'unknown',
        error: (error as Error).message,
      }),
      {
        status: 200, // Return 200 even on error, just with installed: false
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
