/**
 * Vector Index Handlers
 *
 * Semantic search index operations (status, build, query)
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse, errorResponse, unauthorizedResponse, badRequestResponse } from '../types.js';
import { getIndexStatus, buildMemoryIndex } from '../../vector-index.js';
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
    const status = await getIndexStatus();
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
    console.log('[api/index] Starting index build...');
    // buildMemoryIndex returns the file path as a string
    await buildMemoryIndex();

    // Get the status to know how many items were indexed
    const status = await getIndexStatus();

    audit({
      level: 'info',
      category: 'action',
      event: 'index_built',
      details: {
        items: status.items,
        model: status.model,
        provider: status.provider,
      },
      actor: req.user.username,
    });

    return successResponse({
      success: true,
      message: `Index built with ${status.items || 0} items`,
      status,
    });
  } catch (error) {
    console.error('[api/index] POST error:', error);

    audit({
      level: 'error',
      category: 'system',
      event: 'index_build_error',
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
