/**
 * Code Approvals API - List Endpoint
 * GET /api/code-approvals - List all pending code approvals
 */

import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { getAuthenticatedUser, getUserOrAnonymous } from '@metahuman/core';
import { ROOT } from '@metahuman/core/paths';

interface StagedCodeChange {
  filePath: string;
  absolutePath: string;
  patch: string | null;
  newContent: string | null;
  explanation: string;
  testCommands: string[];
  timestamp: string;
  status: 'pending' | 'approved' | 'rejected';
  appliedAt?: string;
  rejectedAt?: string;
}

const handler: APIRoute = async ({ cookies }) => {
  try {
    const user = getUserOrAnonymous(cookies);

    if (user.role === 'anonymous') {
      return new Response(
        JSON.stringify({ error: 'Authentication required to view code approvals.' }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const stagingDir = path.join(ROOT, 'out', 'code-drafts');

    if (!fs.existsSync(stagingDir)) {
      return new Response(JSON.stringify({ approvals: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const files = fs.readdirSync(stagingDir)
      .filter(f => f.endsWith('.json'))
      .sort((a, b) => b.localeCompare(a)); // Newest first

    const approvals = files.map(file => {
      try {
        const content = fs.readFileSync(path.join(stagingDir, file), 'utf-8');
        const data: StagedCodeChange = JSON.parse(content);

        // Read preview if available
        let preview = null;
        const previewPath = path.join(stagingDir, file.replace('.json', '-preview.txt'));
        if (fs.existsSync(previewPath)) {
          preview = fs.readFileSync(previewPath, 'utf-8');
        }

        return {
          id: file.replace('.json', ''),
          ...data,
          preview,
        };
      } catch (error) {
        console.error(`[code-approvals] Failed to load ${file}:`, error);
        return null;
      }
    }).filter(Boolean);

    // Only return pending approvals by default
    const pending = approvals.filter(a => a?.status === 'pending');

    return new Response(JSON.stringify({ approvals: pending }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('[code-approvals] GET error:', error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

// MIGRATED: 2025-11-20 - Explicit authentication pattern
export const GET = handler;
