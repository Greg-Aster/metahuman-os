/**
 * Code Approvals API
 * Manage code change approval workflow
 */

import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { paths } from '@metahuman/core/paths';
import { audit } from '@metahuman/core/audit';

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

/**
 * GET /api/code-approvals
 * List all pending code approvals
 */
export const GET: APIRoute = async () => {
  try {
    const stagingDir = path.join(paths.out, 'code-drafts');

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

/**
 * POST /api/code-approvals/:id/approve
 * Approve and apply a code change
 */
export const POST: APIRoute = async ({ params, request }) => {
  try {
    const url = new URL(request.url);
    const action = url.pathname.split('/').pop(); // 'approve' or 'reject'

    // Extract ID from URL path (e.g., /api/code-approvals/2025-11-04T12-34-56-789Z-file.ts/approve)
    const pathParts = url.pathname.split('/');
    const idIndex = pathParts.findIndex(p => p === 'code-approvals') + 1;
    const id = pathParts[idIndex];

    if (!id) {
      return new Response(JSON.stringify({ error: 'Missing approval ID' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const stagingDir = path.join(paths.out, 'code-drafts');
    const stagingPath = path.join(stagingDir, `${id}.json`);

    if (!fs.existsSync(stagingPath)) {
      return new Response(JSON.stringify({ error: 'Approval not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Read staged data
    const stagedData: StagedCodeChange = JSON.parse(fs.readFileSync(stagingPath, 'utf-8'));

    if (stagedData.status !== 'pending') {
      return new Response(JSON.stringify({ error: `Approval already ${stagedData.status}` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (action === 'approve') {
      // Apply the code change
      const targetPath = stagedData.absolutePath;

      if (stagedData.newContent) {
        // Write new content
        const targetDir = path.dirname(targetPath);
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }
        fs.writeFileSync(targetPath, stagedData.newContent, 'utf-8');

        // Update staged data
        stagedData.status = 'approved';
        stagedData.appliedAt = new Date().toISOString();
        fs.writeFileSync(stagingPath, JSON.stringify(stagedData, null, 2), 'utf-8');

        audit({
          level: 'info',
          category: 'action',
          event: 'code_change_approved',
          actor: 'user',
          details: {
            filePath: stagedData.filePath,
            explanation: stagedData.explanation,
            timestamp: stagedData.appliedAt,
          },
        });

        return new Response(JSON.stringify({
          success: true,
          filePath: stagedData.filePath,
          message: 'Code change applied successfully',
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } else if (stagedData.patch) {
        // TODO: Implement patch application
        return new Response(JSON.stringify({
          error: 'Patch application not yet implemented - use newContent for now',
        }), {
          status: 501,
          headers: { 'Content-Type': 'application/json' },
        });
      } else {
        return new Response(JSON.stringify({ error: 'No content to apply' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    } else if (action === 'reject') {
      // Reject the code change
      stagedData.status = 'rejected';
      stagedData.rejectedAt = new Date().toISOString();
      fs.writeFileSync(stagingPath, JSON.stringify(stagedData, null, 2), 'utf-8');

      audit({
        level: 'info',
        category: 'action',
        event: 'code_change_rejected',
        actor: 'user',
        details: {
          filePath: stagedData.filePath,
          explanation: stagedData.explanation,
          timestamp: stagedData.rejectedAt,
        },
      });

      return new Response(JSON.stringify({
        success: true,
        message: 'Code change rejected',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } else {
      return new Response(JSON.stringify({ error: 'Invalid action' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (error) {
    console.error('[code-approvals] POST error:', error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
