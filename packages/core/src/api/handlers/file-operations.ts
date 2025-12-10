/**
 * File Operations Handlers
 *
 * Dedicated endpoint for file operations using the skills system
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse, errorResponse, badRequestResponse, forbiddenResponse } from '../types.js';
import { executeSkill, loadTrustLevel, getAvailableSkills } from '../../skills.js';
import { ROOT } from '../../paths.js';
import { getSecurityPolicy } from '../../security-policy.js';
import path from 'node:path';

/**
 * POST /api/file_operations - Execute file operation
 */
export async function handleFileOperation(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { action, filename, content, overwrite } = req.body || {};

  if (!action || !filename) {
    return badRequestResponse('Action and filename are required');
  }

  // Validate filename
  const safeFilename = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
  const fullPath = path.join(ROOT, 'out', safeFilename);

  // Check file access permissions
  const policy = getSecurityPolicy({ username: req.user.username });
  try {
    policy.requireFileAccess(fullPath);
  } catch (error) {
    return forbiddenResponse((error as Error).message);
  }

  const trustLevel = loadTrustLevel();
  const availableSkills = getAvailableSkills(trustLevel);

  try {
    switch (action) {
      case 'create':
      case 'write': {
        if (!availableSkills.some(s => s.id === 'fs_write')) {
          return forbiddenResponse('File writing skill not available at current trust level');
        }

        if (!content) {
          return badRequestResponse('Content is required for create/write operations');
        }

        const writeInputs: Record<string, any> = {
          path: fullPath,
          content: content,
        };

        if (typeof overwrite === 'boolean') {
          writeInputs.overwrite = overwrite;
        }

        const writeResult = await executeSkill('fs_write', writeInputs, trustLevel, true);

        if (writeResult.success) {
          return successResponse({
            success: true,
            message: `Successfully created file "${safeFilename}"`,
            path: fullPath,
          });
        } else {
          return errorResponse(writeResult.error || 'Failed to create file', 500);
        }
      }

      case 'read': {
        if (!availableSkills.some(s => s.id === 'fs_read')) {
          return forbiddenResponse('File reading skill not available at current trust level');
        }

        const readResult = await executeSkill('fs_read', { path: fullPath }, trustLevel);

        if (readResult.success) {
          return successResponse({
            success: true,
            message: `Successfully read file "${safeFilename}"`,
            path: fullPath,
            content: readResult.outputs?.content,
          });
        } else {
          return errorResponse(readResult.error || 'Failed to read file', 500);
        }
      }

      default:
        return badRequestResponse(`Unsupported action: ${action}`);
    }
  } catch (error) {
    console.error('[file_operations_api] Unexpected error:', error);
    return errorResponse(`File operations API error: ${(error as Error).message}`, 500);
  }
}

/**
 * GET /api/file_operations - Get file operations status
 */
export async function handleFileOperationsStatus(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const action = req.query?.action || 'status';

    if (action === 'status') {
      const trustLevel = loadTrustLevel();
      const availableSkills = getAvailableSkills(trustLevel);

      return successResponse({
        status: 'online',
        trustLevel,
        canWrite: availableSkills.some(s => s.id === 'fs_write'),
        canRead: availableSkills.some(s => s.id === 'fs_read'),
        basePath: path.join(ROOT, 'out'),
      });
    }

    return badRequestResponse(`Unknown action: ${action}`);
  } catch (error) {
    console.error('[file_operations_api] Status check error:', error);
    return errorResponse(`Status check error: ${(error as Error).message}`, 500);
  }
}
