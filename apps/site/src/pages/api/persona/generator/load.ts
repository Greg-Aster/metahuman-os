/**
 * Load Persona Interview Session API
 *
 * GET /api/persona/generator/load?sessionId=<id>
 * Retrieves an existing persona generation interview session
 */

import type { APIRoute } from 'astro';
import { getAuthenticatedUser } from '@metahuman/core';
import { loadSession, listSessions } from '@metahuman/core/persona/session-manager';
import { tryResolveProfilePath } from '@metahuman/core/paths';

const handler: APIRoute = async ({ cookies, request }) => {
  try {
    const user = getAuthenticatedUser(cookies);

    // Verify access to interviews
    const pathResult = tryResolveProfilePath('personaInterviews');
    if (!pathResult.ok) {
      return new Response(
        JSON.stringify({ error: 'Access denied' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const url = new URL(request.url);
    const sessionId = url.searchParams.get('sessionId');

    // If no sessionId provided, return list of all sessions
    if (!sessionId) {
      const sessions = await listSessions(user.username);
      return new Response(
        JSON.stringify({
          success: true,
          sessions,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Load specific session
    const session = await loadSession(user.username, sessionId);

    if (!session) {
      return new Response(
        JSON.stringify({ error: 'Session not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Verify ownership (loadSession already checks this, but double-check)
    if (session.userId !== user.userId) {
      return new Response(
        JSON.stringify({ error: 'Access denied - session belongs to another user' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        session,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[persona/generator/load] Error:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Failed to load session',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

// MIGRATED: 2025-11-20 - Explicit authentication pattern
// GET requires authentication for persona generation
export const GET = handler;
