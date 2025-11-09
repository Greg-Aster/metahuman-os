/**
 * GET/POST /api/runtime/mode
 * Manage headless runtime mode state
 *
 * GET: Returns current runtime mode state
 * POST: Updates runtime mode (owner-only)
 */

import type { APIRoute } from 'astro';
import { getRuntimeMode, setRuntimeMode, type RuntimeState } from '@metahuman/core';
import { getUserContext } from '@metahuman/core/context';
import { validateSession } from '@metahuman/core/sessions';

export const GET: APIRoute = async () => {
  try {
    const mode = getRuntimeMode();
    return new Response(JSON.stringify(mode), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[api/runtime/mode] GET error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to load runtime mode' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    // Validate authentication
    const sessionCookie = cookies?.get('mh_session');
    if (!sessionCookie) {
      return new Response(
        JSON.stringify({ error: 'Authentication required' }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const session = validateSession(sessionCookie.value);
    if (!session) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired session' }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Owner-only operation
    if (session.role !== 'owner') {
      return new Response(
        JSON.stringify({ error: 'Owner permission required to change runtime mode' }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const body = await request.json();
    const { headless, claimedBy } = body;

    // Validate headless parameter
    if (typeof headless !== 'boolean') {
      return new Response(
        JSON.stringify({ error: 'Invalid request: headless must be a boolean' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Determine if this is a local or remote change based on session metadata
    // (Session metadata is set during createSession with userAgent and ip)
    const isRemote = session.metadata?.ip &&
      session.metadata.ip !== '127.0.0.1' &&
      session.metadata.ip !== '::1' &&
      session.metadata.ip !== 'localhost';
    const actor = `${session.userId}${isRemote ? ' (remote)' : ' (local)'}`;

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

    return new Response(
      JSON.stringify({ success: true, mode: updatedMode }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[api/runtime/mode] POST error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to update runtime mode' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
