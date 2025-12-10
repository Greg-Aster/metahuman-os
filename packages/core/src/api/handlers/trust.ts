/**
 * Trust API Handlers
 *
 * Unified handlers for trust level management.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { loadDecisionRules, setTrustLevel } from '../../identity.js';
import { audit } from '../../audit.js';

/**
 * GET /api/trust - Get current trust level
 */
export async function handleGetTrust(_req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const rules = loadDecisionRules();
    return successResponse({
      level: rules.trustLevel,
      available: rules.availableModes || [],
    });
  } catch (error) {
    console.error('[trust] GET error:', error);
    return { status: 500, error: (error as Error).message };
  }
}

/**
 * POST /api/trust - Update trust level (owner only)
 */
export async function handleSetTrust(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, body } = req;

  if (!user.isAuthenticated) {
    return { status: 401, error: 'Authentication required' };
  }

  if (user.role !== 'owner') {
    return { status: 403, error: 'Owner role required' };
  }

  const level = String(body?.level || '');

  if (!level) {
    return { status: 400, error: 'Missing level' };
  }

  try {
    const currentRules = loadDecisionRules();

    // Audit the trust level change
    audit({
      level: 'warn',
      category: 'security',
      event: 'trust_level_change',
      details: {
        from: currentRules.trustLevel,
        to: level,
      },
      actor: user.username,
    });

    setTrustLevel(level);
    const rules = loadDecisionRules();

    return successResponse({ ok: true, level: rules.trustLevel });
  } catch (error) {
    console.error('[trust] POST error:', error);
    return { status: 500, error: (error as Error).message };
  }
}
