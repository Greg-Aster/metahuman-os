/**
 * Purge All Sessions API
 *
 * POST: Delete all interview sessions from the user's profile
 * DANGEROUS: This action is irreversible
 */

import type { APIRoute } from 'astro';
import { getAuthenticatedUser } from '@metahuman/core';
import { auditAction } from '@metahuman/core/audit';
import { tryResolveProfilePath } from '@metahuman/core/paths';
import fs from 'node:fs';
import path from 'node:path';

const handler: APIRoute = async ({ cookies }) => {
  try {
    const user = getAuthenticatedUser(cookies);

    // Verify access to interviews directory
    const pathResult = tryResolveProfilePath('personaInterviews');
    if (!pathResult.ok) {
      return new Response(
        JSON.stringify({ error: 'Access denied' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }
    const interviewsDir = pathResult.path;

    // Check if directory exists
    if (!fs.existsSync(interviewsDir)) {
      return new Response(
        JSON.stringify({ success: true, deletedCount: 0 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Delete all session files
    const files = fs.readdirSync(interviewsDir);
    const sessionFiles = files.filter((f) => f.endsWith('.json'));

    for (const file of sessionFiles) {
      fs.unlinkSync(path.join(interviewsDir, file));
    }

    // Audit the purge action
    await auditAction({
      action: 'persona_sessions_purged',
      actor: user.username,
      details: {
        deletedCount: sessionFiles.length,
        timestamp: new Date().toISOString(),
      },
      outcome: 'success',
    });

    return new Response(
      JSON.stringify({
        success: true,
        deletedCount: sessionFiles.length,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[persona/generator/purge-sessions] POST error:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to purge sessions',
        details: (error as Error).message,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};

// MIGRATED: 2025-11-20 - Explicit authentication pattern
// POST requires authentication for persona generation
export const POST = handler;
