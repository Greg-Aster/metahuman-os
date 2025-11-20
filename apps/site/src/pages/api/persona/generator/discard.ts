/**
 * Discard Persona Interview Session API
 *
 * DELETE /api/persona/generator/discard
 * Marks a persona generation interview session as aborted
 */

import type { APIRoute } from 'astro';
import { getAuthenticatedUser } from '@metahuman/core';
import { discardSession, loadSession } from '@metahuman/core/persona/session-manager';
import { tryResolveProfilePath } from '@metahuman/core/paths';

const handler: APIRoute = async ({ cookies, request }) => {
  try {
    const user = getAuthenticatedUser(cookies);

    // Verify write access
    const pathResult = tryResolveProfilePath('personaInterviews');
    if (!pathResult.ok) {
      return new Response(
        JSON.stringify({ error: 'Write access denied' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = await request.json();
    const { sessionId } = body as { sessionId: string };

    if (!sessionId) {
      return new Response(
        JSON.stringify({ error: 'sessionId is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Verify session exists and belongs to user
    const session = await loadSession(user.username, sessionId);
    if (!session) {
      return new Response(
        JSON.stringify({ error: 'Session not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (session.userId !== user.userId) {
      return new Response(
        JSON.stringify({ error: 'Access denied - session belongs to another user' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Discard session
    await discardSession(user.username, sessionId);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Session discarded successfully',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[persona/generator/discard] Error:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Failed to discard session',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

// MIGRATED: 2025-11-20 - Explicit authentication pattern
// POST requires authentication for persona generation
export const POST = handler;
