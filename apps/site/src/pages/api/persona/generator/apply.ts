/**
 * Apply Persona Draft API
 *
 * POST /api/persona/generator/apply
 * Applies finalized PersonaDraft to persona/core.json with user-selected merge strategy.
 * This is the final step after user reviews the diff from finalize.
 */

import type { APIRoute } from 'astro';
import { getAuthenticatedUser } from '@metahuman/core';
import { tryResolveProfilePath } from '@metahuman/core/paths';
import {
  loadSession,
  saveSession,
} from '@metahuman/core/persona/session-manager';
import {
  loadExistingPersona,
  mergePersonaDraft,
  savePersona,
  generateDiffText,
  type MergeStrategy,
} from '@metahuman/core/persona/merger';
import { audit } from '@metahuman/core/audit';
import fs from 'node:fs';
import path from 'node:path';

interface ApplyRequest {
  sessionId: string;
  strategy: MergeStrategy; // 'replace' | 'merge' | 'append'
}

const handler: APIRoute = async ({ cookies, request }) => {
  try {
    // Explicit auth - require authentication for persona generation
    const user = getAuthenticatedUser(cookies);

    // Verify write access
    const pathResult = tryResolveProfilePath('personaInterviews');
    if (!pathResult.ok) {
      return new Response(
        JSON.stringify({ error: 'Write access denied' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const personaCoreResult = tryResolveProfilePath('personaCore');
    if (!personaCoreResult.ok) {
      return new Response(
        JSON.stringify({ error: 'Cannot access persona core' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = (await request.json()) as ApplyRequest;
    const { sessionId, strategy } = body;

    // Validate request
    if (!sessionId || !strategy) {
      return new Response(
        JSON.stringify({ error: 'sessionId and strategy are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!['replace', 'merge', 'append'].includes(strategy)) {
      return new Response(
        JSON.stringify({ error: 'strategy must be one of: replace, merge, append' }),
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

    // Verify session is finalized
    if (session.status !== 'finalized') {
      return new Response(
        JSON.stringify({ error: 'Session must be finalized before applying' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Load summary.json to get extracted persona
    const sessionDir = path.join(pathResult.path, sessionId);
    const summaryPath = path.join(sessionDir, 'summary.json');

    if (!fs.existsSync(summaryPath)) {
      return new Response(
        JSON.stringify({ error: 'Summary not found - session may not be finalized' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
    const extracted = summary.extracted;

    // Load current persona
    const currentPersona = loadExistingPersona(personaCoreResult.path);

    // Backup current persona before applying changes
    const backupDir = path.join(sessionDir, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `persona-core-${timestamp}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(currentPersona, null, 2), 'utf-8');

    // Apply merge with user-selected strategy
    const { updated, diff } = mergePersonaDraft(currentPersona, extracted, strategy);

    // Save updated persona to core.json
    savePersona(personaCoreResult.path, updated);

    // Generate diff text for audit
    const diffText = generateDiffText(diff);

    // Mark session as applied
    session.status = 'applied';
    session.appliedAt = new Date().toISOString();
    session.appliedStrategy = strategy;
    await saveSession(user.username, session);

    // Audit application
    await audit('data_change', 'info', {
      action: 'persona_draft_applied',
      sessionId,
      userId: user.userId,
      username: user.username,
      strategy,
      diffSummary: diff.summary,
      backupPath,
      personaPath: personaCoreResult.path,
      actor: user.username,
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: `Persona updated successfully using ${strategy} strategy`,
        diff: {
          changes: diff.changes,
          summary: diff.summary,
          text: diffText,
        },
        backupPath,
        personaPath: personaCoreResult.path,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[persona/generator/apply] Error:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Failed to apply persona draft',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

// MIGRATED: 2025-11-20 - Explicit authentication pattern
// POST requires authentication for persona generation
export const POST = handler;
