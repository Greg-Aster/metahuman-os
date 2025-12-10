/**
 * Code Approvals Handlers
 *
 * Manages pending code change approvals from the coder agent.
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse, errorResponse, unauthorizedResponse, notFoundResponse, badRequestResponse } from '../types.js';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, audit } from '../../index.js';

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

const STAGING_DIR = path.join(ROOT, 'out', 'code-drafts');

/**
 * Apply a unified diff patch to file content
 * Simplified implementation - handles basic unified diffs
 */
function applyUnifiedDiff(originalContent: string, patch: string): string | null {
  try {
    const lines = originalContent.split('\n');
    const patchLines = patch.split('\n');

    let lineIndex = 0;
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
            console.error(`Patch mismatch at line ${lineIndex}: expected "${expectedLine}", got "${actualLine}"`);
            return null;
          }
          lineIndex++;
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

/**
 * GET /api/code-approvals - List all pending code approvals
 */
export async function handleListCodeApprovals(req: UnifiedRequest): Promise<UnifiedResponse> {
  if (!req.user.isAuthenticated) {
    return unauthorizedResponse('Authentication required to view code approvals.');
  }

  try {
    if (!fs.existsSync(STAGING_DIR)) {
      return successResponse({ approvals: [] });
    }

    const files = fs.readdirSync(STAGING_DIR)
      .filter(f => f.endsWith('.json'))
      .sort((a, b) => b.localeCompare(a)); // Newest first

    const approvals = files.map(file => {
      try {
        const content = fs.readFileSync(path.join(STAGING_DIR, file), 'utf-8');
        const data: StagedCodeChange = JSON.parse(content);

        // Read preview if available
        let preview = null;
        const previewPath = path.join(STAGING_DIR, file.replace('.json', '-preview.txt'));
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

    return {
      status: 200,
      data: { approvals: pending },
      headers: { 'Cache-Control': 'no-store' },
    };
  } catch (error) {
    console.error('[code-approvals] GET error:', error);
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * GET /api/code-approvals/[id] - Get a specific code approval
 */
export async function handleGetCodeApproval(req: UnifiedRequest): Promise<UnifiedResponse> {
  if (!req.user.isAuthenticated) {
    return unauthorizedResponse('Authentication required.');
  }

  const id = req.params?.id || req.path.split('/').pop();
  if (!id) {
    return badRequestResponse('Approval ID required');
  }

  const filePath = path.join(STAGING_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) {
    return notFoundResponse('Code approval not found');
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const data: StagedCodeChange = JSON.parse(content);

    // Read preview if available
    let preview = null;
    const previewPath = path.join(STAGING_DIR, `${id}-preview.txt`);
    if (fs.existsSync(previewPath)) {
      preview = fs.readFileSync(previewPath, 'utf-8');
    }

    return successResponse({
      id,
      ...data,
      preview,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * POST /api/code-approvals/[id]/approve - Approve and apply a code change
 */
export async function handleApproveCodeChange(req: UnifiedRequest): Promise<UnifiedResponse> {
  if (!req.user.isAuthenticated) {
    return unauthorizedResponse('Authentication required.');
  }

  // Extract ID from path: /api/code-approvals/[id]/approve
  const pathParts = req.path.split('/');
  const approveIndex = pathParts.indexOf('approve');
  const id = approveIndex > 0 ? pathParts[approveIndex - 1] : req.params?.id;

  if (!id) {
    return badRequestResponse('Approval ID required');
  }

  const filePath = path.join(STAGING_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) {
    return notFoundResponse('Code approval not found');
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const data: StagedCodeChange = JSON.parse(content);

    if (data.status !== 'pending') {
      return badRequestResponse(`Cannot approve: status is ${data.status}`);
    }

    // Apply the change
    if (data.newContent !== null) {
      // Full file replacement
      const dir = path.dirname(data.absolutePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(data.absolutePath, data.newContent, 'utf-8');
    } else if (data.patch) {
      // Apply unified diff patch
      if (!fs.existsSync(data.absolutePath)) {
        return badRequestResponse('Cannot apply patch: target file does not exist');
      }

      const currentContent = fs.readFileSync(data.absolutePath, 'utf-8');
      const patchedContent = applyUnifiedDiff(currentContent, data.patch);

      if (!patchedContent) {
        return badRequestResponse('Failed to apply patch - file may have been modified since patch was generated');
      }

      fs.writeFileSync(data.absolutePath, patchedContent, 'utf-8');
    } else {
      return badRequestResponse('No content to apply');
    }

    // Update status
    data.status = 'approved';
    data.appliedAt = new Date().toISOString();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

    audit({
      level: 'info',
      category: 'action',
      event: 'code_change_approved',
      details: { id, filePath: data.filePath, patchApplied: !!data.patch },
      actor: req.user.username,
    });

    return successResponse({
      success: true,
      filePath: data.filePath,
      message: `Code change applied to ${data.filePath}`,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * POST /api/code-approvals/[id]/reject - Reject a code change
 */
export async function handleRejectCodeChange(req: UnifiedRequest): Promise<UnifiedResponse> {
  if (!req.user.isAuthenticated) {
    return unauthorizedResponse('Authentication required.');
  }

  // Extract ID from path
  const pathParts = req.path.split('/');
  const rejectIndex = pathParts.indexOf('reject');
  const id = rejectIndex > 0 ? pathParts[rejectIndex - 1] : req.params?.id;

  if (!id) {
    return badRequestResponse('Approval ID required');
  }

  const filePath = path.join(STAGING_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) {
    return notFoundResponse('Code approval not found');
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const data: StagedCodeChange = JSON.parse(content);

    if (data.status !== 'pending') {
      return badRequestResponse(`Cannot reject: status is ${data.status}`);
    }

    // Update status
    data.status = 'rejected';
    data.rejectedAt = new Date().toISOString();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

    audit({
      level: 'info',
      category: 'action',
      event: 'code_change_rejected',
      details: { id, filePath: data.filePath },
      actor: req.user.username,
    });

    return successResponse({
      success: true,
      message: 'Code change rejected',
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}
