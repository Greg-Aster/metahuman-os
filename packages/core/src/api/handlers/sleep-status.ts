/**
 * Sleep Status API Handlers
 *
 * Unified handlers for sleep/dream status.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import fs from 'node:fs';
import path from 'node:path';
import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { storageClient } from '../../storage-client.js';
import { isLocked } from '../../locks.js';

type SleepState = 'awake' | 'sleeping' | 'dreaming';

function determineState(): SleepState {
  if (isLocked('agent-dreamer')) return 'dreaming';
  if (isLocked('service-sleep')) return 'sleeping';
  return 'awake';
}

/**
 * GET /api/sleep-status - Get current sleep/dream state
 */
export async function handleGetSleepStatus(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user } = req;

  try {
    const status = determineState();
    let learningsFile: string | null = null;
    let learningsContent: string | null = null;

    // Try to resolve path - gracefully handle anonymous users
    if (user.isAuthenticated) {
      const pathResult = storageClient.resolvePath({
        username: user.username,
        category: 'memory',
        subcategory: 'procedural',
        relativePath: 'overnight',
      });

      if (pathResult.success && pathResult.path) {
        const overnightDir = pathResult.path;
        if (fs.existsSync(overnightDir)) {
          const files = fs
            .readdirSync(overnightDir)
            .filter(
              (file) => file.startsWith('overnight-learnings-') && file.endsWith('.md')
            )
            .sort()
            .reverse();

          if (files.length > 0) {
            learningsFile = files[0];
            const filepath = path.join(overnightDir, learningsFile);
            learningsContent = fs.readFileSync(filepath, 'utf-8');
          }
        }
      }
    }

    return successResponse({
      status,
      learningsFile,
      learningsContent,
      lastChecked: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[sleep-status] GET error:', error);
    return { status: 500, error: 'Failed to read sleep status' };
  }
}
