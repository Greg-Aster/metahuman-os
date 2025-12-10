/**
 * Trust Coupling API Handlers
 *
 * Unified handlers for trust-cognitive mode coupling configuration.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { loadTrustCoupling, saveTrustCoupling } from '../../trust-coupling.js';

/**
 * GET /api/trust-coupling - Get current coupling state and mappings
 */
export async function handleGetTrustCoupling(_req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const config = loadTrustCoupling();

    return successResponse({
      success: true,
      coupled: config.coupled,
      mappings: config.mappings,
      descriptions: config.description_text,
    });
  } catch (error) {
    console.error('[trust-coupling] GET error:', error);
    return { status: 500, error: (error as Error).message };
  }
}

/**
 * POST /api/trust-coupling - Toggle coupling state (owner only)
 */
export async function handleSetTrustCoupling(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, body } = req;

  if (!user.isAuthenticated) {
    return { status: 401, error: 'Authentication required' };
  }

  if (user.role !== 'owner') {
    return { status: 403, error: 'Owner role required' };
  }

  try {
    const config = loadTrustCoupling();

    if (typeof body?.coupled === 'boolean') {
      config.coupled = body.coupled;
      saveTrustCoupling(config, user.username);
    }

    return successResponse({
      success: true,
      coupled: config.coupled,
      mappings: config.mappings,
    });
  } catch (error) {
    console.error('[trust-coupling] POST error:', error);
    return { status: 500, error: (error as Error).message };
  }
}
