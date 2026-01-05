/**
 * Window Session API
 *
 * Manages browser window/tab registration for multi-window support.
 *
 * POST: Register a new window
 * GET: Get/validate an existing window session
 * DELETE: Close a window session
 */
import type { APIRoute } from 'astro';
import {
  getAuthenticatedUser,
  AuthRequiredError,
  createWindowSession,
  getWindowSession,
  closeWindowSession,
  listUserWindows,
} from '@metahuman/core';

/**
 * POST: Register a new window
 */
export const POST: APIRoute = async ({ cookies, request }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    const body = await request.json();

    const session = createWindowSession({
      userId: user.username,
      title: body.title,
      url: body.url,
      userAgent: body.userAgent,
      viewState: body.viewState,
      metadata: body.metadata,
    });

    const windows = listUserWindows(user.username);

    return new Response(
      JSON.stringify({
        windowId: session.windowId,
        multiWindow: windows.length > 1,
        windowCount: windows.length,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      return new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }
    console.error('[window-session] POST error:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

/**
 * GET: Get/validate an existing window session
 */
export const GET: APIRoute = async ({ cookies, params, url }) => {
  try {
    const user = getAuthenticatedUser(cookies);

    // Check for windowId in URL path or query
    const windowId = url.searchParams.get('windowId');

    if (windowId) {
      const session = getWindowSession(windowId);
      if (!session || session.userId !== user.username) {
        return new Response(
          JSON.stringify({ error: 'Window session not found' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({
          windowId: session.windowId,
          isActive: session.isActive,
          lastActivity: session.lastActivity,
          title: session.title,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // No windowId - return list of windows
    const windows = listUserWindows(user.username);
    return new Response(
      JSON.stringify({
        windows: windows.map(w => ({
          windowId: w.windowId,
          isActive: w.isActive,
          lastActivity: w.lastActivity,
          title: w.title,
        })),
        windowCount: windows.length,
        multiWindow: windows.length > 1,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      return new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }
    console.error('[window-session] GET error:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

/**
 * DELETE: Close a window session
 */
export const DELETE: APIRoute = async ({ cookies, request }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    const body = await request.json().catch(() => ({}));
    const windowId = body.windowId;

    if (!windowId) {
      return new Response(
        JSON.stringify({ error: 'windowId required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const session = getWindowSession(windowId);
    if (!session || session.userId !== user.username) {
      return new Response(
        JSON.stringify({ error: 'Window session not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    closeWindowSession(windowId);

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      return new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }
    console.error('[window-session] DELETE error:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
