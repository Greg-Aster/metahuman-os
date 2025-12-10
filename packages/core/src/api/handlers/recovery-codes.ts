/**
 * Recovery Codes API Handlers
 *
 * Unified handlers for password recovery codes.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { getRemainingCodes, generateRecoveryCodes, saveRecoveryCodes } from '../../recovery-codes.js';
import { auditSecurity } from '../../audit.js';

/**
 * GET /api/recovery-codes - View remaining (unused) recovery codes
 */
export async function handleGetRecoveryCodes(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user } = req;

  try {
    if (!user.isAuthenticated) {
      return { status: 401, error: 'Not authenticated' };
    }

    // Get remaining recovery codes
    const remaining = getRemainingCodes(user.username);

    return successResponse({
      success: true,
      codes: remaining,
      total: remaining.length,
    });
  } catch (error) {
    console.error('[recovery-codes] GET error:', error);
    return {
      status: 500,
      error: error instanceof Error ? error.message : 'Failed to fetch recovery codes',
    };
  }
}

/**
 * POST /api/recovery-codes - Regenerate all recovery codes (invalidates old ones)
 */
export async function handleRegenerateRecoveryCodes(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user } = req;

  try {
    if (!user.isAuthenticated) {
      return { status: 401, error: 'Not authenticated' };
    }

    // Generate new recovery codes
    const newCodes = generateRecoveryCodes();
    saveRecoveryCodes(user.username, newCodes);

    // Audit the regeneration
    auditSecurity({
      actor: user.username,
      event: 'recovery_codes_regenerated',
      details: { userId: user.id || user.username },
    });

    return successResponse({
      success: true,
      codes: newCodes,
      message: 'Recovery codes regenerated successfully',
    });
  } catch (error) {
    console.error('[recovery-codes] POST error:', error);
    return {
      status: 500,
      error: error instanceof Error ? error.message : 'Failed to regenerate recovery codes',
    };
  }
}
