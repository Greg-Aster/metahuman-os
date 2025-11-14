/**
 * Start Persona Interview Session API
 *
 * POST /api/persona/generator/start
 * Creates a new persona generation interview session
 */

import type { APIRoute } from 'astro';
import { getUserContext } from '@metahuman/core/context';
import { withUserContext } from '../../../../middleware/userContext';
import { startSession, addQuestion, type Question } from '@metahuman/core/persona/session-manager';
import { tryResolveProfilePath } from '@metahuman/core/paths';
import fs from 'node:fs';
import path from 'node:path';
import { paths } from '@metahuman/core/paths';

/**
 * Load baseline questions from configuration
 */
function loadBaselineQuestions(): Question[] {
  const configPath = path.join(paths.root, 'etc', 'persona-generator.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  return config.baselineQuestions.map((q: any) => ({
    id: q.id,
    prompt: q.prompt,
    category: q.category,
    generatedAt: new Date().toISOString(),
  }));
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

    // Verify write access (not in emulation mode)
    const pathResult = tryResolveProfilePath('personaInterviews');
    if (!pathResult.ok) {
      return new Response(
        JSON.stringify({ error: 'Write access denied' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Create new session
    const session = await startSession(ctx.userId, ctx.username);

    // Load first question from baseline questions
    const baselineQuestions = loadBaselineQuestions();
    if (baselineQuestions.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No baseline questions configured' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const firstQuestion = baselineQuestions[0];

    // Add first question to session
    await addQuestion(ctx.username, session.sessionId, firstQuestion);

    return new Response(
      JSON.stringify({
        success: true,
        sessionId: session.sessionId,
        question: firstQuestion,
        progress: session.categoryCoverage,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[persona/generator/start] Error:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Failed to start session',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const POST = withUserContext(handler);
