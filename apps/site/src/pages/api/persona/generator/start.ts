/**
 * Start Persona Interview Session API
 *
 * POST /api/persona/generator/start
 * Creates a new persona generation interview session
 */

import type { APIRoute } from 'astro';
import { getAuthenticatedUser, systemPaths, storageClient } from '@metahuman/core';
import { startSession, addQuestion, type Question } from '@metahuman/core/persona/session-manager';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Load baseline questions from configuration
 */
function loadBaselineQuestions(): Question[] {
  const configPath = path.join(systemPaths.root, 'etc', 'persona-generator.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  return config.baselineQuestions.map((q: any) => ({
    id: q.id,
    prompt: q.prompt,
    category: q.category,
    generatedAt: new Date().toISOString(),
  }));
}

const handler: APIRoute = async ({ cookies, request }) => {
  try {
    // Explicit auth - require authentication for persona generation
    const user = getAuthenticatedUser(cookies);

    // Verify write access (not in emulation mode)
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

    // Create new session
    const session = await startSession(user.userId, user.username);

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
    await addQuestion(user.username, session.sessionId, firstQuestion);

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

// MIGRATED: 2025-11-20 - Explicit authentication pattern
// POST requires authentication for persona generation
export const POST = handler;
