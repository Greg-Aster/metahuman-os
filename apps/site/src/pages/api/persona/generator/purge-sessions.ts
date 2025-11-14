/**
 * Purge All Sessions API
 *
 * POST: Delete all interview sessions from the user's profile
 * DANGEROUS: This action is irreversible
 */

import type { APIRoute } from 'astro';
import { getUserContext } from '@metahuman/core/context';
import { withUserContext } from '../../../../middleware/userContext';
import { auditAction } from '@metahuman/core/audit';
import fs from 'node:fs';
import path from 'node:path';

const handler: APIRoute = async () => {
  try {
    const context = getUserContext();

    if (!context || context.username === 'anonymous') {
      return new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const interviewsDir = path.join(
      context.profilePaths.root,
      'persona',
      'interviews'
    );

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
      actor: context.username,
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

export const POST = withUserContext(handler);
