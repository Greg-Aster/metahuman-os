/**
 * Window Session API Handlers
 *
 * Manages browser window/tab tracking for multi-window support.
 * Coordinates between windows to prevent race conditions.
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import {
  createWindowSession,
  validateWindowSession,
  sendWindowHeartbeat,
  closeWindowSession,
  listUserWindows,
  hasMultipleWindows,
  getWindowStats,
  cleanupExpiredWindows,
} from '../../window-session.js';

/**
 * POST /api/window-session - Create a new window session
 */
export async function handleCreateWindowSession(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, body } = req;

  if (!user.isAuthenticated) {
    return { status: 401, error: 'Authentication required' };
  }

  try {
    const session = createWindowSession(req.sessionId || '', {
      userAgent: body?.userAgent,
      title: body?.title,
      url: body?.url,
      viewState: body?.viewState,
    });

    if (!session) {
      return { status: 400, error: 'Failed to create window session - parent session invalid' };
    }

    // Check if user now has multiple windows
    const multiWindow = hasMultipleWindows(user.username);
    const windowCount = listUserWindows(user.username).length;

    return successResponse({
      windowId: session.windowId,
      createdAt: session.createdAt,
      multiWindow,
      windowCount,
    });
  } catch (error) {
    console.error('[window-session] Error creating window session:', error);
    return { status: 500, error: 'Failed to create window session' };
  }
}

/**
 * GET /api/window-session/:windowId - Validate a window session
 */
export async function handleValidateWindowSession(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, params } = req;

  if (!user.isAuthenticated) {
    return { status: 401, error: 'Authentication required' };
  }

  const windowId = params?.windowId;
  if (!windowId) {
    return { status: 400, error: 'Window ID required' };
  }

  try {
    const session = validateWindowSession(windowId);

    if (!session) {
      return { status: 404, error: 'Window session not found or expired' };
    }

    // Verify the window belongs to this user
    if (session.userId !== user.username) {
      return { status: 403, error: 'Window does not belong to user' };
    }

    return successResponse({
      windowId: session.windowId,
      isActive: session.isActive,
      lastActivity: session.lastActivity,
      metadata: session.metadata,
    });
  } catch (error) {
    console.error('[window-session] Error validating window session:', error);
    return { status: 500, error: 'Failed to validate window session' };
  }
}

/**
 * POST /api/window-session/:windowId/heartbeat - Send window heartbeat
 */
export async function handleWindowHeartbeat(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, params, body } = req;

  if (!user.isAuthenticated) {
    return { status: 401, error: 'Authentication required' };
  }

  const windowId = params?.windowId;
  if (!windowId) {
    return { status: 400, error: 'Window ID required' };
  }

  try {
    const success = sendWindowHeartbeat({
      windowId,
      timestamp: new Date().toISOString(),
      isActive: body?.isActive ?? true,
      metadata: body?.metadata,
    });

    if (!success) {
      return { status: 404, error: 'Window session not found' };
    }

    // Return current window state
    const windows = listUserWindows(user.username);
    const multiWindow = windows.length > 1;

    return successResponse({
      success: true,
      multiWindow,
      windowCount: windows.length,
      windows: windows.map(w => ({
        windowId: w.windowId,
        isActive: w.isActive,
        lastActivity: w.lastActivity,
        title: w.title,
      })),
    });
  } catch (error) {
    console.error('[window-session] Error sending heartbeat:', error);
    return { status: 500, error: 'Failed to send heartbeat' };
  }
}

/**
 * DELETE /api/window-session/:windowId - Close a window session
 */
export async function handleCloseWindowSession(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, params } = req;

  if (!user.isAuthenticated) {
    return { status: 401, error: 'Authentication required' };
  }

  const windowId = params?.windowId;
  if (!windowId) {
    return { status: 400, error: 'Window ID required' };
  }

  try {
    const success = closeWindowSession(windowId);

    return successResponse({
      success,
      message: success ? 'Window session closed' : 'Window session not found',
    });
  } catch (error) {
    console.error('[window-session] Error closing window session:', error);
    return { status: 500, error: 'Failed to close window session' };
  }
}

/**
 * GET /api/window-session/list - List all windows for current user
 */
export async function handleListWindows(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user } = req;

  if (!user.isAuthenticated) {
    return { status: 401, error: 'Authentication required' };
  }

  try {
    const windows = listUserWindows(user.username);

    return successResponse({
      windows: windows.map(w => ({
        windowId: w.windowId,
        isActive: w.isActive,
        createdAt: w.createdAt,
        lastActivity: w.lastActivity,
        title: w.title,
        metadata: w.metadata,
      })),
      count: windows.length,
      hasMultiple: windows.length > 1,
    });
  } catch (error) {
    console.error('[window-session] Error listing windows:', error);
    return { status: 500, error: 'Failed to list windows' };
  }
}

/**
 * GET /api/window-session/stats - Get window session statistics (admin)
 */
export async function handleWindowStats(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user } = req;

  if (!user.isAuthenticated) {
    return { status: 401, error: 'Authentication required' };
  }

  try {
    // Clean up expired windows first
    const cleaned = cleanupExpiredWindows();
    const stats = getWindowStats();

    return successResponse({
      ...stats,
      cleanedUp: cleaned,
    });
  } catch (error) {
    console.error('[window-session] Error getting stats:', error);
    return { status: 500, error: 'Failed to get window stats' };
  }
}
