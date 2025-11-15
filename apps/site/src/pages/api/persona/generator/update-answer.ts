import type { APIRoute } from 'astro';
import { getUserContext } from '@metahuman/core/context';
import { withUserContext } from '../../../../middleware/userContext';
import { loadSession, saveSession } from '@metahuman/core/persona/session-manager';
import { tryResolveProfilePath } from '@metahuman/core/paths';

const handler: APIRoute = async ({ request }) => {
  try {
    const ctx = getUserContext();

    if (!ctx || ctx.role === 'anonymous') {
      return new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

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

    const session = await loadSession(ctx.username, sessionId);
    if (!session) {
      return new Response(
        JSON.stringify({ error: 'Session not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (session.userId !== ctx.userId) {
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

    await saveSession(ctx.username, session);

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

export const POST = withUserContext(handler);
