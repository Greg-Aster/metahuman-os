/**
 * Vector Index Handlers
 *
 * Semantic search index operations (status, build, query)
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse, errorResponse, unauthorizedResponse, badRequestResponse } from '../types.js';
import { getIndexStatus } from '../../vector-index.js';
import { submitMemoryIndexRefresh } from '../../queue/index.js';
import { getSecurityPolicy } from '../../security-policy.js';
import { audit } from '../../audit.js';

/**
 * GET /api/index - Get index status
 */
export async function handleGetIndex(req: UnifiedRequest): Promise<UnifiedResponse> {
  // Require authentication to access index info
  const policy = getSecurityPolicy({ username: req.user.username });
  if (!policy.canReadMemory) {
    return unauthorizedResponse('Authentication required to access index');
  }

  try {
    const status = await getIndexStatus(undefined, req.user.username);
    return successResponse(status);
  } catch (error) {
    console.error('[api/index] GET error:', error);
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * POST /api/index - Build or rebuild index
 */
export async function handleBuildIndex(req: UnifiedRequest): Promise<UnifiedResponse> {
  // Require authentication to build index
  const policy = getSecurityPolicy({ username: req.user.username });
  if (!policy.canWriteMemory) {
    return unauthorizedResponse('Authentication required to build index');
  }

  const { action } = req.body || {};

  if (action !== 'build') {
    return badRequestResponse('Invalid action. Use action: "build"');
  }

  try {
    const task = await submitMemoryIndexRefresh({
      username: req.user.username,
      source: 'user',
      force: true,
      metadata: { producer: 'api-index-build' },
    });
    const status = getIndexStatus(undefined, req.user.username);

    audit({
      level: 'info',
      category: 'action',
      event: 'index_build_queued',
      details: {
        taskId: task.id,
        currentItems: status.exists ? status.items : 0,
      },
      actor: req.user.username,
    });

    return successResponse({
      success: true,
      queued: true,
      taskId: task.id,
      message: 'Index rebuild queued',
      status,
    }, 202);
  } catch (error) {
    console.error('[api/index] POST error:', error);

    audit({
      level: 'error',
      category: 'system',
      event: 'index_build_queue_error',
      details: { error: (error as Error).message },
      actor: req.user.username,
    });

    return {
      status: 500,
      data: {
        success: false,
        error: (error as Error).message,
      },
    };
  }
}
