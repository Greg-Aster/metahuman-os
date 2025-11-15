/**
 * Finalize Persona Interview API
 *
 * POST /api/persona/generator/finalize
 * Extracts PersonaDraft from completed session, generates diff preview,
 * saves summary for user review, and optionally copies transcript to training data.
 */

import type { APIRoute } from 'astro';
import { getUserContext } from '@metahuman/core/context';
import { withUserContext } from '../../../../middleware/userContext';
import { tryResolveProfilePath } from '@metahuman/core/paths';
import {
  loadSession,
  saveSession,
  type Session,
} from '@metahuman/core/persona/session-manager';
import { extractPersonaFromSession } from '@metahuman/core/persona/extractor';
import {
  loadExistingPersona,
  mergePersonaDraft,
  generateDiffText,
  type MergeStrategy,
} from '@metahuman/core/persona/merger';
import fs from 'node:fs';
import path from 'node:path';
import { audit } from '@metahuman/core/audit';

interface FinalizeRequest {
  sessionId: string;
  strategy?: MergeStrategy; // Optional preview strategy (default: 'merge')
  copyToTraining?: boolean; // Copy transcript to training data (default: false)
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

    const body = (await request.json()) as FinalizeRequest;
    const { sessionId, strategy = 'merge', copyToTraining = false } = body;

    // Validate request
    if (!sessionId) {
      return new Response(
        JSON.stringify({ error: 'sessionId is required' }),
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

    // Verify session is not already finalized
    if (session.status === 'finalized') {
      return new Response(
        JSON.stringify({ error: 'Session already finalized' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Extract persona from session
    const extracted = await extractPersonaFromSession(session);

    // Load existing persona for diff generation
    const personaCoreResult = tryResolveProfilePath('personaCore');
    if (!personaCoreResult.ok) {
      throw new Error('Failed to resolve persona core path');
    }
    const currentPersona = loadExistingPersona(personaCoreResult.path);

    // Generate diff preview (don't apply yet)
    const { updated, diff } = mergePersonaDraft(currentPersona, extracted, strategy);

    // Generate human-readable diff text
    const diffText = generateDiffText(diff);

    // Save summary to interviews/<sessionId>/summary.json
    const sessionDir = path.join(pathResult.path, sessionId);
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }
    const summaryPath = path.join(sessionDir, 'summary.json');
    const summary = {
      sessionId,
      userId: ctx.userId,
      username: ctx.username,
      finalizedAt: new Date().toISOString(),
      extracted,
      diff: {
        changes: diff.changes,
        summary: diff.summary,
      },
      diffText,
      strategy,
      previewPersona: updated,
    };
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');

    // Mark session as finalized
    session.status = 'finalized';
    session.finalizedAt = new Date().toISOString();
    await saveSession(ctx.username, session);

    // Optional: Copy transcript to training data
    let trainingPath: string | null = null;
    if (copyToTraining) {
      try {
        const trainingDir = path.join(
          pathResult.path,
          '..',
          '..',
          'memory',
          'training',
          'persona-interviews'
        );
        fs.mkdirSync(trainingDir, { recursive: true });

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        trainingPath = path.join(trainingDir, `${sessionId}-${timestamp}.jsonl`);

        // Convert Q&A pairs to JSONL format for training
        const lines: string[] = [];
        for (const question of session.questions) {
          const answer = session.answers.find((a) => a.questionId === question.id);
          if (answer) {
            lines.push(
              JSON.stringify({
                messages: [
                  { role: 'assistant', content: question.prompt },
                  { role: 'user', content: answer.content },
                ],
                category: question.category,
                timestamp: answer.answeredAt,
              })
            );
          }
        }

        fs.writeFileSync(trainingPath, lines.join('\n'), 'utf-8');

        await audit('action', 'info', {
          action: 'persona_training_data_exported',
          sessionId,
          trainingPath,
          questionCount: session.questions.length,
          actor: ctx.username,
        });
      } catch (error) {
        console.error('[finalize] Failed to copy to training data:', error);
        // Non-fatal - continue without training export
      }
    }

    // Audit finalization
    await audit('action', 'info', {
      action: 'persona_session_finalized',
      sessionId,
      userId: ctx.userId,
      username: ctx.username,
      questionCount: session.questions.length,
      answerCount: session.answers.length,
      confidence: extracted.confidence,
      diffSummary: diff.summary,
      trainingExported: copyToTraining,
      actor: ctx.username,
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Session finalized successfully',
        extracted,
        diff: {
          changes: diff.changes,
          summary: diff.summary,
          text: diffText,
        },
        summaryPath,
        trainingPath,
        confidence: extracted.confidence,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[persona/generator/finalize] Error:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Failed to finalize session',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const POST = withUserContext(handler);
