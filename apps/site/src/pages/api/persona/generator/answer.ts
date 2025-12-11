/**
 * Answer Persona Interview Question API
 *
 * POST /api/persona/generator/answer
 * Records user's answer and generates next question (or signals completion)
 */

import type { APIRoute } from 'astro';
import { getAuthenticatedUser, storageClient } from '@metahuman/core';
import {
  loadSession,
  recordAnswer,
  addQuestion,
  saveSession,
} from '@metahuman/core/persona/session-manager';
import { generateNextQuestion, getCompletionStatus } from '@metahuman/core/persona/question-generator';

interface AnswerRequest {
  sessionId: string;
  questionId: string;
  answer: string;
}

const handler: APIRoute = async ({ cookies, request }) => {
  try {
    // Explicit auth - require authentication for persona generation
    const user = getAuthenticatedUser(cookies);

    // Verify write access
    const pathResult = storageClient.resolvePath({
      category: 'config',
      subcategory: 'persona',
      relativePath: 'therapy',
    });
    if (!pathResult.success || !pathResult.path) {
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
    const session = await loadSession(user.username, sessionId);
    if (!session) {
      return new Response(
        JSON.stringify({ error: 'Session not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Verify ownership
    if (session.userId !== user.userId) {
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
    await recordAnswer(user.username, sessionId, questionId, answer);

    // Reload session to get updated coverage
    const updatedSession = await loadSession(user.username, sessionId);
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
          await addQuestion(user.username, sessionId, result.question);
          nextQuestion = result.question;
          reasoning = result.reasoning;
        } else {
          // Question generator returned null (interview complete)
          status.isComplete = true;
          updatedSession.status = 'completed';
          await saveSession(user.username, updatedSession);
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
      await saveSession(user.username, updatedSession);
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

// MIGRATED: 2025-11-20 - Explicit authentication pattern
// POST requires authentication for persona generation
export const POST = handler;
