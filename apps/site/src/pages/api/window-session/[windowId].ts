/**
 * Window Session API - Dynamic route for specific window
 *
 * GET: Get/validate a specific window session
 * DELETE: Close a specific window session
 * PATCH: Update window activity
 */
import type { APIRoute } from 'astro';
import {
  getAuthenticatedUser,
  AuthRequiredError,
  getWindowSession,
  closeWindowSession,
  sendWindowHeartbeat,
} from '@metahuman/core';

/**
 * GET: Get/validate a specific window session
 */
export const GET: APIRoute = async ({ cookies, params }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    const { windowId } = params;

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

    return new Response(
      JSON.stringify({
        windowId: session.windowId,
        isActive: session.isActive,
        lastActivity: session.lastActivity,
        title: session.title,
        url: session.url,
        viewState: session.viewState,
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
 * DELETE: Close a specific window session
 */
export const DELETE: APIRoute = async ({ cookies, params }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    const { windowId } = params;

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

/**
 * PATCH: Update window activity (heartbeat)
 */
export const PATCH: APIRoute = async ({ cookies, params, request }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    const { windowId } = params;

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

    const body = await request.json().catch(() => ({}));

    sendWindowHeartbeat({
      windowId,
      isActive: body.isActive ?? true,
      viewState: body.viewState,
      metadata: body.metadata,
    });

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
    console.error('[window-session] PATCH error:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
