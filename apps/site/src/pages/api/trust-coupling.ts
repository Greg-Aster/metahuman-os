import type { APIRoute } from 'astro';
import { loadTrustCoupling, toggleCoupling, saveTrustCoupling } from '@metahuman/core';
import { requireOwner } from '../../middleware/cognitiveModeGuard';

/**
 * GET /api/trust-coupling
 * Get current coupling state and mappings
 */
export const GET: APIRoute = async () => {
  try {
    const config = loadTrustCoupling();

    return new Response(
      JSON.stringify({
        success: true,
        coupled: config.coupled,
        mappings: config.mappings,
        descriptions: config.description_text,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[trust-coupling] Failed to load config:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

/**
 * POST /api/trust-coupling
 * Toggle coupling state (owner only)
 * Body: { coupled: boolean }
 */
const postHandler: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();

    const config = loadTrustCoupling();

    if (typeof body.coupled === 'boolean') {
      config.coupled = body.coupled;
      saveTrustCoupling(config, 'web_ui');
    }

    return new Response(
      JSON.stringify({
        success: true,
        coupled: config.coupled,
        mappings: config.mappings,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[trust-coupling] Failed to update config:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

// Wrap POST with owner-only guard
export const POST = requireOwner(postHandler);
