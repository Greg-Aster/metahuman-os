/**
 * Audit Control API Handlers
 *
 * Unified handlers for audit settings management.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import {
  isAuditEnabled,
  setAuditEnabled,
  setAuditRetention,
  purgeOldAuditLogs,
} from '../../audit.js';

/**
 * GET /api/audit-control - Get audit settings (owner only)
 */
export async function handleGetAuditControl(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user } = req;

  if (!user.isAuthenticated) {
    return { status: 401, error: 'Authentication required' };
  }

  if (user.role !== 'owner') {
    return { status: 403, error: 'Owner role required' };
  }

  try {
    return successResponse({
      enabled: isAuditEnabled(),
    });
  } catch (error) {
    console.error('[audit-control] GET error:', error);
    return { status: 500, error: (error as Error).message };
  }
}

/**
 * POST /api/audit-control - Update audit settings (owner only)
 */
export async function handleSetAuditControl(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, body } = req;

  if (!user.isAuthenticated) {
    return { status: 401, error: 'Authentication required' };
  }

  if (user.role !== 'owner') {
    return { status: 403, error: 'Owner role required' };
  }

  try {
    const { enabled, retentionDays, purgeOld } = body || {};

    if (typeof enabled === 'boolean') {
      setAuditEnabled(enabled);
    }

    if (typeof retentionDays === 'number' && retentionDays > 0) {
      setAuditRetention(retentionDays);
    }

    if (purgeOld === true) {
      purgeOldAuditLogs();
    }

    return successResponse({
      success: true,
      enabled: isAuditEnabled(),
    });
  } catch (error) {
    console.error('[audit-control] POST error:', error);
    return { status: 500, error: (error as Error).message };
  }
}
