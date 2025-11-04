/**
 * Code Approvals API - Approve/Reject Endpoint
 * POST /api/code-approvals/:id/approve - Approve and apply a code change
 * POST /api/code-approvals/:id/reject - Reject a code change
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
 * Apply a unified diff patch to file content
 * Simplified implementation - handles basic unified diffs
 */
function applyUnifiedDiff(originalContent: string, patch: string): string | null {
  try {
    const lines = originalContent.split('\n');
    const patchLines = patch.split('\n');

    let lineIndex = 0; // Current position in original file
    const result: string[] = [];

    for (let i = 0; i < patchLines.length; i++) {
      const line = patchLines[i];

      // Skip diff header lines
      if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('diff ') || line.startsWith('index ')) {
        continue;
      }

      // Parse hunk header: @@ -start,count +start,count @@
      if (line.startsWith('@@')) {
        const match = line.match(/@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
        if (!match) continue;

        const oldStart = parseInt(match[1], 10);
        const newStart = parseInt(match[3], 10);

        // Copy lines from original up to the hunk start
        while (lineIndex < oldStart - 1) {
          result.push(lines[lineIndex]);
          lineIndex++;
        }
        continue;
      }

      // Apply changes
      if (line.startsWith('-')) {
        // Remove line - skip it in original
        if (lineIndex < lines.length) {
          const expectedLine = line.substring(1);
          const actualLine = lines[lineIndex];
          if (expectedLine !== actualLine) {
            // Patch doesn't match - abort
            console.error(`Patch mismatch at line ${lineIndex}: expected "${expectedLine}", got "${actualLine}"`);
            return null;
          }
          lineIndex++; // Skip the removed line
        }
      } else if (line.startsWith('+')) {
        // Add line
        result.push(line.substring(1));
      } else if (line.startsWith(' ')) {
        // Context line - should match
        if (lineIndex < lines.length) {
          const expectedLine = line.substring(1);
          const actualLine = lines[lineIndex];
          if (expectedLine !== actualLine) {
            // Context doesn't match - abort
            console.error(`Context mismatch at line ${lineIndex}: expected "${expectedLine}", got "${actualLine}"`);
            return null;
          }
          result.push(actualLine);
          lineIndex++;
        }
      } else if (line.trim() === '') {
        // Empty line in patch - treat as context
        if (lineIndex < lines.length && lines[lineIndex].trim() === '') {
          result.push(lines[lineIndex]);
          lineIndex++;
        }
      }
    }

    // Copy remaining lines from original
    while (lineIndex < lines.length) {
      result.push(lines[lineIndex]);
      lineIndex++;
    }

    return result.join('\n');
  } catch (error) {
    console.error('Patch application error:', error);
    return null;
  }
}

export const POST: APIRoute = async ({ params }) => {
  try {
    // Path will be like "2025-11-04T20-12-22-777Z-test-file-for-coder.ts/approve"
    const fullPath = params.path || '';
    const pathParts = fullPath.split('/');

    if (pathParts.length < 2) {
      return new Response(JSON.stringify({ error: 'Invalid request path' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Last part is the action (approve or reject)
    const action = pathParts[pathParts.length - 1];

    // Everything before the action is the ID
    const id = pathParts.slice(0, -1).join('/');

    if (!id) {
      return new Response(JSON.stringify({ error: 'Missing approval ID' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (action !== 'approve' && action !== 'reject') {
      return new Response(JSON.stringify({ error: 'Invalid action. Must be "approve" or "reject"' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const stagingDir = path.join(paths.out, 'code-drafts');
    const stagingPath = path.join(stagingDir, `${id}.json`);

    if (!fs.existsSync(stagingPath)) {
      return new Response(JSON.stringify({
        error: 'Approval not found',
        requestedId: id,
        stagingPath,
      }), {
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
        // Apply unified diff patch
        if (!fs.existsSync(targetPath)) {
          return new Response(JSON.stringify({
            error: 'Cannot apply patch: target file does not exist',
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        const currentContent = fs.readFileSync(targetPath, 'utf-8');
        const patchedContent = applyUnifiedDiff(currentContent, stagedData.patch);

        if (!patchedContent) {
          return new Response(JSON.stringify({
            error: 'Failed to apply patch - file may have been modified since patch was generated',
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        // Write patched content
        fs.writeFileSync(targetPath, patchedContent, 'utf-8');

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
            patchApplied: true,
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
    }

    return new Response(JSON.stringify({ error: 'Unknown error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[code-approvals] POST error:', error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
