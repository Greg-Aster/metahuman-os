/**
 * Runtime Mode API Handlers
 *
 * Unified handlers for headless runtime mode state.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { getRuntimeMode, setRuntimeMode } from '../../runtime-mode.js';

/**
 * GET /api/runtime/mode - Get current runtime mode state
 */
export async function handleGetRuntimeMode(_req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const mode = getRuntimeMode();
    return successResponse(mode);
  } catch (error) {
    console.error('[runtime/mode] GET error:', error);
    return { status: 500, error: 'Failed to load runtime mode' };
  }
}

/**
 * POST /api/runtime/mode - Update runtime mode (owner-only)
 * Body: { headless: boolean, claimedBy?: string }
 */
export async function handleSetRuntimeMode(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, body } = req;

  try {
    if (!user.isAuthenticated) {
      return { status: 401, error: 'Authentication required' };
    }

    if (user.role !== 'owner') {
      return { status: 403, error: 'Owner permission required to change runtime mode' };
    }

    const { headless, claimedBy } = body || {};

    // Validate headless parameter
    if (typeof headless !== 'boolean') {
      return { status: 400, error: 'Invalid request: headless must be a boolean' };
    }

    // Determine if this is a local or remote change
    // In unified handler, we assume local unless explicitly marked
    const isRemote = false; // Could be enhanced based on request metadata
    const actor = `${user.username}${isRemote ? ' (remote)' : ' (local)'}`;

    // Update runtime mode
    setRuntimeMode(
      {
        headless,
        lastChangedBy: isRemote ? 'remote' : 'local',
        claimedBy: claimedBy || null,
      },
      actor
    );

    const updatedMode = getRuntimeMode();

    return successResponse({ success: true, mode: updatedMode });
  } catch (error) {
    console.error('[runtime/mode] POST error:', error);
    return { status: 500, error: 'Failed to update runtime mode' };
  }
}
