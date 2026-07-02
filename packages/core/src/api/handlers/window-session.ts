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
  getWindowSession,
  sendWindowHeartbeat,
  closeWindowSession,
  listUserWindows,
  getWindowStats,
  cleanupExpiredWindows,
} from '../../window-session.js';

function windowSummary(window: ReturnType<typeof listUserWindows>[number]) {
  return {
    windowId: window.windowId,
    isActive: window.isActive,
    lastActivity: window.lastActivity,
    title: window.title,
  };
}

function windowDetail(window: NonNullable<ReturnType<typeof getWindowSession>>) {
  return {
    windowId: window.windowId,
    isActive: window.isActive,
    lastActivity: window.lastActivity,
    title: window.title,
    url: window.metadata?.url,
    viewState: window.metadata?.viewState,
  };
}

function getWindowIdFromRequest(req: UnifiedRequest): string | undefined {
  if (req.params?.windowId) return req.params.windowId;
  if (req.params?.id && req.params.id !== 'heartbeat') return req.params.id;
  if (req.query?.windowId) return req.query.windowId;

  const segments = req.path.split('?')[0].split('/').filter(Boolean);
  const sessionIndex = segments.indexOf('window-session');
  if (sessionIndex >= 0) {
    const windowId = segments[sessionIndex + 1];
    if (windowId && !['stream', 'list', 'stats'].includes(windowId)) {
      return decodeURIComponent(windowId);
    }
  }

  return undefined;
}

function listCurrentUserWindows(user: UnifiedRequest['user']) {
  const windows = new Map<string, ReturnType<typeof listUserWindows>[number]>();
  for (const window of listUserWindows(user.userId)) {
    windows.set(window.windowId, window);
  }
  for (const window of listUserWindows(user.username)) {
    windows.set(window.windowId, window);
  }
  return [...windows.values()];
}

function verifyWindowForUser(windowId: string, user: UnifiedRequest['user']) {
  const session = getWindowSession(windowId);
  if (!session || (session.userId !== user.userId && session.userId !== user.username)) {
    return null;
  }
  return session;
}

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

    const windows = listCurrentUserWindows(user);
    const multiWindow = windows.length > 1;
    const windowCount = windows.length;

    return successResponse({
      windowId: session.windowId,
      multiWindow,
      windowCount,
    });
  } catch (error) {
    console.error('[window-session] Error creating window session:', error);
    return { status: 500, error: 'Failed to create window session' };
  }
}

/**
 * GET /api/window-session - List windows or validate query windowId
 */
export async function handleGetWindowSessionIndex(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user } = req;

  if (!user.isAuthenticated) {
    return { status: 401, error: 'Authentication required' };
  }

  try {
    const windowId = req.query?.windowId;
    if (windowId) {
      const session = verifyWindowForUser(windowId, user);
      if (!session) {
        return { status: 404, error: 'Window session not found' };
      }

      return successResponse(windowSummary(session));
    }

    const windows = listCurrentUserWindows(user);
    return successResponse({
      windows: windows.map(windowSummary),
      windowCount: windows.length,
      multiWindow: windows.length > 1,
    });
  } catch (error) {
    console.error('[window-session] GET error:', error);
    return { status: 500, error: (error as Error).message };
  }
}

/**
 * GET /api/window-session/:windowId - Get/validate a window session
 */
export async function handleValidateWindowSession(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user } = req;

  if (!user.isAuthenticated) {
    return { status: 401, error: 'Authentication required' };
  }

  const windowId = getWindowIdFromRequest(req);
  if (!windowId) {
    return { status: 400, error: 'windowId required' };
  }

  try {
    const session = verifyWindowForUser(windowId, user);
    if (!session) {
      return { status: 404, error: 'Window session not found' };
    }

    return successResponse(windowDetail(session));
  } catch (error) {
    console.error('[window-session] GET error:', error);
    return { status: 500, error: (error as Error).message };
  }
}

/**
 * POST /api/window-session/:windowId/heartbeat - Send window heartbeat
 */
export async function handleWindowHeartbeat(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, body } = req;

  if (!user.isAuthenticated) {
    return { status: 401, error: 'Authentication required' };
  }

  const windowId = getWindowIdFromRequest(req);
  if (!windowId) {
    return { status: 400, error: 'windowId required' };
  }

  try {
    const session = verifyWindowForUser(windowId, user);
    if (!session) {
      return { status: 404, error: 'Window session not found' };
    }

    const success = sendWindowHeartbeat({
      windowId,
      timestamp: new Date().toISOString(),
      isActive: body?.isActive ?? true,
      metadata: {
        ...(body?.metadata || {}),
        ...(body?.viewState !== undefined ? { viewState: body.viewState } : {}),
      },
    });

    if (!success) {
      return { status: 404, error: 'Window session not found' };
    }

    const windows = listCurrentUserWindows(user);
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
    console.error('[window-session] PATCH error:', error);
    return { status: 500, error: (error as Error).message };
  }
}

/**
 * PATCH /api/window-session/:windowId - Update window activity
 */
export async function handlePatchWindowSession(req: UnifiedRequest): Promise<UnifiedResponse> {
  const response = await handleWindowHeartbeat(req);
  if (response.status >= 400) {
    return response;
  }
  return successResponse({ success: true });
}

/**
 * DELETE /api/window-session/:windowId - Close a window session
 */
export async function handleCloseWindowSession(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, body } = req;

  if (!user.isAuthenticated) {
    return { status: 401, error: 'Authentication required' };
  }

  const windowId = getWindowIdFromRequest(req) || body?.windowId;
  if (!windowId) {
    return { status: 400, error: 'windowId required' };
  }

  try {
    const session = verifyWindowForUser(windowId, user);
    if (!session) {
      return { status: 404, error: 'Window session not found' };
    }

    closeWindowSession(windowId);

    return successResponse({ success: true });
  } catch (error) {
    console.error('[window-session] DELETE error:', error);
    return { status: 500, error: (error as Error).message };
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
    const windows = listCurrentUserWindows(user);

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
      windowCount: windows.length,
      multiWindow: windows.length > 1,
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
