import type { APIRoute } from 'astro';
import { getAuthenticatedUser, audit, loadDesire, saveDesireManifest, proposalEvents } from '@metahuman/core';
import type { ClarifyingAnswer } from '@metahuman/core';

const LOG_PREFIX = '[API:agency/answer]';

/**
 * POST /api/agency/desires/:id/answer
 * Submit answers to clarifying questions for a desire.
 *
 * Request body:
 * {
 *   answers: Array<{ questionId: string; answer: string }>
 * }
 */
export const POST: APIRoute = async ({ params, request, cookies }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    if (!user) {
      console.log(`${LOG_PREFIX} ❌ Authentication required`);
      return new Response(
        JSON.stringify({ error: 'Authentication required to answer questions.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { id } = params;
    if (!id) {
      return new Response(
        JSON.stringify({ error: 'Desire ID is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    let body: { answers: Array<{ questionId: string; answer: string }> };
    try {
      body = await request.json();
    } catch (e) {
      return new Response(
        JSON.stringify({ error: 'Invalid JSON body' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!body.answers || !Array.isArray(body.answers)) {
      return new Response(
        JSON.stringify({ error: 'answers array is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log(`${LOG_PREFIX} 📝 Answer submitted for desire: ${id}`);
    console.log(`${LOG_PREFIX}    ${body.answers.length} answers provided`);

    const desire = await loadDesire(id, user.username);
    if (!desire) {
      console.log(`${LOG_PREFIX} ❌ Desire not found: ${id}`);
      return new Response(
        JSON.stringify({ error: 'Desire not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check if desire is in questioning status
    if (desire.status !== 'questioning') {
      console.log(`${LOG_PREFIX} ⚠️ Desire not in questioning status: ${desire.status}`);
      return new Response(
        JSON.stringify({ error: `Cannot answer questions for desire in '${desire.status}' status. Expected 'questioning'.` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Verify we have questions to answer
    if (!desire.clarifyingQuestions?.questions?.length) {
      console.log(`${LOG_PREFIX} ❌ No questions to answer`);
      return new Response(
        JSON.stringify({ error: 'No clarifying questions found for this desire.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const now = new Date().toISOString();

    // Convert input answers to ClarifyingAnswer format
    const formattedAnswers: ClarifyingAnswer[] = body.answers.map((a) => ({
      questionId: a.questionId,
      answer: a.answer,
      answeredAt: now,
    }));

    // Validate that required questions are answered
    const requiredQuestionIds = desire.clarifyingQuestions.questions
      .filter((q) => q.required)
      .map((q) => q.id);

    const answeredQuestionIds = new Set(formattedAnswers.map((a) => a.questionId));
    const missingRequired = requiredQuestionIds.filter((id) => !answeredQuestionIds.has(id));

    if (missingRequired.length > 0) {
      console.log(`${LOG_PREFIX} ❌ Missing required answers: ${missingRequired.join(', ')}`);
      return new Response(
        JSON.stringify({
          error: 'Missing required answers',
          missingQuestionIds: missingRequired,
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Update desire with answers
    const updatedDesire = {
      ...desire,
      clarifyingQuestions: {
        ...desire.clarifyingQuestions,
        answers: formattedAnswers,
        completedAt: now,
      },
      status: 'planning' as const, // Move back to planning with context
      currentStage: 'planning' as const,
      updatedAt: now,
    };

    console.log(`${LOG_PREFIX} ✅ Updating desire: questioning → planning`);
    await saveDesireManifest(updatedDesire, user.username);

    audit({
      category: 'agent',
      level: 'info',
      event: 'desire_questions_answered',
      actor: user.username,
      details: {
        desireId: id,
        title: desire.title,
        answerCount: formattedAnswers.length,
        questionsCount: desire.clarifyingQuestions.questions.length,
      },
    });

    // Emit event to wake up the planning agent
    proposalEvents.emit('proposal-resolved', {
      username: user.username,
      proposalId: id,
      response: 'questions_answered',
      taskType: 'desire_plan',
    });
    console.log(`${LOG_PREFIX} 📢 Emitted proposal-resolved event to trigger planning`);

    return new Response(JSON.stringify({
      success: true,
      desire: updatedDesire,
      message: `Answers submitted. Generating plan for "${desire.title}"...`,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error(`${LOG_PREFIX} ❌ Error:`, error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
