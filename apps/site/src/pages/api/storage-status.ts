/**
 * Storage Status API
 *
 * GET: Get current storage configuration and status
 * Returns resolved paths for all storage categories
 */

import type { APIRoute } from 'astro';
import { getUserOrAnonymous, storageClient } from '@metahuman/core';

export const GET: APIRoute = async ({ cookies }) => {
  try {
    const user = getUserOrAnonymous(cookies);
    const isAuthenticated = user.role !== 'anonymous';

    if (!isAuthenticated) {
      return new Response(
        JSON.stringify({
          authenticated: false,
          status: null,
          paths: null,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
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

    return new Response(
      JSON.stringify({
        authenticated: true,
        username: user.username,
        status,
        paths,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[storage-status] GET error:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to get storage status',
        details: (error as Error).message,
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
