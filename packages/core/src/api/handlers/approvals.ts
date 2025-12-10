/**
 * Approvals API Handlers
 *
 * Unified handlers for skill execution approvals.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import {
  getPendingApprovals,
  approveSkillExecution,
  rejectSkillExecution,
} from '../../skills.js';

/**
 * GET /api/approvals - Get pending approval items
 */
export async function handleGetApprovals(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user } = req;

  try {
    if (!user.isAuthenticated) {
      return { status: 401, error: 'Authentication required to view approvals.' };
    }

    const pending = getPendingApprovals();
    return successResponse({ approvals: pending });
  } catch (error) {
    console.error('[approvals] GET error:', error);
    return { status: 500, error: (error as Error).message };
  }
}

/**
 * POST /api/approvals - Approve or reject a skill execution
 * Body: { id: string, action: 'approve' | 'reject' }
 */
export async function handlePostApproval(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, body } = req;

  try {
    if (!user.isAuthenticated) {
      return { status: 401, error: 'Authentication required to modify approvals.' };
    }

    if (user.role !== 'owner') {
      return { status: 403, error: 'Owner role required to modify approvals.' };
    }

    const { id, action } = body || {};

    if (!id || !action) {
      return { status: 400, error: 'Missing required fields: id, action' };
    }

    if (action !== 'approve' && action !== 'reject') {
      return { status: 400, error: 'Invalid action. Must be "approve" or "reject"' };
    }

    if (action === 'approve') {
      // Approve skill execution (unified architecture uses req.user context)
      const result = await approveSkillExecution(id, user.username);
      return {
        status: result.success ? 200 : 400,
        data: { success: result.success, result },
      };
    } else {
      const result = rejectSkillExecution(id, user.username);
      return {
        status: result.success ? 200 : 400,
        data: { success: result.success, error: result.error },
      };
    }
  } catch (error) {
    console.error('[approvals] POST error:', error);
    return { status: 500, error: (error as Error).message };
  }
}
