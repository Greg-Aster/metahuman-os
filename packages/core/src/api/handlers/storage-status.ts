/**
 * Storage Status API Handlers
 *
 * Get current storage configuration and status.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { storageClient } from '../../storage-client.js';

/**
 * GET /api/storage-status - Get storage paths and status
 */
export async function handleGetStorageStatus(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user } = req;

  try {
    if (!user.isAuthenticated) {
      return successResponse({
        authenticated: false,
        status: null,
        paths: null,
      });
    }

    // Get storage status
    const status = storageClient.getStatus(user.username);

    // Resolve key paths for display
    const paths: Record<string, { path?: string; available: boolean }> = {};

    // Memory paths
    const episodicResult = storageClient.resolvePath({
      category: 'memory',
      subcategory: 'episodic',
    });
    paths.episodic = {
      path: episodicResult.path,
      available: episodicResult.success,
    };

    const proceduralResult = storageClient.resolvePath({
      category: 'memory',
      subcategory: 'procedural',
    });
    paths.procedural = {
      path: proceduralResult.path,
      available: proceduralResult.success,
    };

    // Config paths
    const personaResult = storageClient.resolvePath({
      category: 'config',
      subcategory: 'persona',
    });
    paths.persona = {
      path: personaResult.path,
      available: personaResult.success,
    };

    const etcResult = storageClient.resolvePath({
      category: 'config',
      subcategory: 'etc',
    });
    paths.etc = {
      path: etcResult.path,
      available: etcResult.success,
    };

    // Voice paths
    const voiceResult = storageClient.resolvePath({
      category: 'voice',
      subcategory: 'training-data',
    });
    paths.voice = {
      path: voiceResult.path,
      available: voiceResult.success,
    };

    // Training paths
    const trainingResult = storageClient.resolvePath({
      category: 'training',
    });
    paths.training = {
      path: trainingResult.path,
      available: trainingResult.success,
    };

    // Output paths
    const outputResult = storageClient.resolvePath({
      category: 'output',
    });
    paths.output = {
      path: outputResult.path,
      available: outputResult.success,
    };

    return successResponse({
      authenticated: true,
      username: user.username,
      status,
      paths,
    });
  } catch (error) {
    console.error('[storage-status] GET error:', error);
    return {
      status: 500,
      error: 'Failed to get storage status',
      data: { details: (error as Error).message },
    };
  }
}
