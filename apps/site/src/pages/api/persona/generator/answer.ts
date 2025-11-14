/**
 * Answer Persona Interview Question API
 *
 * POST /api/persona/generator/answer
 * Records user's answer and generates next question (or signals completion)
 */

import type { APIRoute } from 'astro';
import { getUserContext } from '@metahuman/core/context';
import { withUserContext } from '../../../../middleware/userContext';
import {
  loadSession,
  recordAnswer,
  addQuestion,
  saveSession,
} from '@metahuman/core/persona/session-manager';
import { generateNextQuestion, getCompletionStatus } from '@metahuman/core/persona/question-generator';
import { tryResolveProfilePath } from '@metahuman/core/paths';

interface AnswerRequest {
  sessionId: string;
  questionId: string;
  answer: string;
}

const handler: APIRoute = async ({ request }) => {
  try {
    const ctx = getUserContext();

    // Check authentication
    if (!ctx || ctx.role === 'anonymous') {
      return new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Verify write access
    const pathResult = tryResolveProfilePath('personaInterviews');
    if (!pathResult.ok) {
      return new Response(
        JSON.stringify({ error: 'Write access denied' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = (await request.json()) as AnswerRequest;
    const { sessionId, questionId, answer } = body;

    // Validate request
    if (!sessionId || !questionId || !answer) {
      return new Response(
        JSON.stringify({ error: 'sessionId, questionId, and answer are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Load session
    const session = await loadSession(ctx.username, sessionId);
    if (!session) {
      return new Response(
        JSON.stringify({ error: 'Session not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Verify ownership
    if (session.userId !== ctx.userId) {
      return new Response(
        JSON.stringify({ error: 'Access denied - session belongs to another user' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Verify session is active
    if (session.status !== 'active') {
      return new Response(
        JSON.stringify({ error: 'Session is not active' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Record the answer
    await recordAnswer(ctx.username, sessionId, questionId, answer);

    // Reload session to get updated coverage
    const updatedSession = await loadSession(ctx.username, sessionId);
    if (!updatedSession) {
      throw new Error('Failed to reload session after recording answer');
    }

    // Get completion status
    const status = getCompletionStatus(updatedSession);

    // If not complete, generate next question
    let nextQuestion = null;
    let reasoning = null;

    if (!status.isComplete) {
      try {
        const result = await generateNextQuestion(updatedSession);

        if (result) {
          // Add question to session
          await addQuestion(ctx.username, sessionId, result.question);
          nextQuestion = result.question;
          reasoning = result.reasoning;
        } else {
          // Question generator returned null (interview complete)
          status.isComplete = true;
          updatedSession.status = 'completed';
          await saveSession(ctx.username, updatedSession);
        }
      } catch (error) {
        console.error('[persona/generator/answer] Error generating next question:', error);
        // Continue without next question - client can retry
        return new Response(
          JSON.stringify({
            error: 'Failed to generate next question',
            details: error instanceof Error ? error.message : 'Unknown error',
            progress: status.progress,
            isComplete: status.isComplete,
          }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }
    } else {
      // Interview complete - mark session as completed
      updatedSession.status = 'completed';
      await saveSession(ctx.username, updatedSession);
    }

    return new Response(
      JSON.stringify({
        success: true,
        nextQuestion,
        reasoning,
        progress: status.progress,
        isComplete: status.isComplete,
        questionsRemaining: status.questionsRemaining,
        message: status.message,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[persona/generator/answer] Error:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Failed to process answer',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const POST = withUserContext(handler);
