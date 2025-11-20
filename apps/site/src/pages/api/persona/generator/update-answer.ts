import type { APIRoute } from 'astro';
import { getAuthenticatedUser } from '@metahuman/core';
import { loadSession, saveSession } from '@metahuman/core/persona/session-manager';
import { tryResolveProfilePath } from '@metahuman/core/paths';

const handler: APIRoute = async ({ cookies, request }) => {
  try {
    const user = getAuthenticatedUser(cookies);

    const pathResult = tryResolveProfilePath('personaInterviews');
    if (!pathResult.ok) {
      return new Response(
        JSON.stringify({ error: 'Access denied' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = await request.json();
    const { sessionId, questionId, content } = body ?? {};

    if (!sessionId || !questionId || typeof content !== 'string') {
      return new Response(
        JSON.stringify({ error: 'sessionId, questionId, and content are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const session = await loadSession(user.username, sessionId);
    if (!session) {
      return new Response(
        JSON.stringify({ error: 'Session not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (session.userId !== user.userId) {
      return new Response(
        JSON.stringify({ error: 'Access denied' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const answerIndex = session.answers.findIndex((a) => a.questionId === questionId);
    if (answerIndex === -1) {
      return new Response(
        JSON.stringify({ error: 'Answer not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    session.answers[answerIndex].content = content;
    session.answers[answerIndex].editedAt = new Date().toISOString();

    await saveSession(user.username, session);

    return new Response(
      JSON.stringify({
        success: true,
        answer: session.answers[answerIndex],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[persona/generator/update-answer] Error:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Failed to update answer',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

// MIGRATED: 2025-11-20 - Explicit authentication pattern
// POST requires authentication for persona generation
export const POST = handler;
