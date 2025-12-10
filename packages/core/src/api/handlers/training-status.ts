/**
 * Training Status API Handler
 *
 * GET recent training operations status.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { systemPaths } from '../../paths.js';

/**
 * GET /api/training/status - Get recent training operations
 */
export async function handleGetTrainingStatus(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const statusDir = path.join(systemPaths.logs, 'status');

    if (!existsSync(statusDir)) {
      return successResponse({ operations: [] });
    }

    const files = readdirSync(statusDir)
      .filter(f => f.startsWith('lora-training-') && f.endsWith('.json'))
      .sort()
      .reverse()
      .slice(0, 10); // Last 10 training runs

    const operations = files.map(file => {
      try {
        const content = readFileSync(path.join(statusDir, file), 'utf-8');
        return JSON.parse(content);
      } catch {
        return { file, error: 'Failed to parse' };
      }
    });

    return successResponse({ operations });
  } catch (error) {
    console.error('[training-status] GET failed:', error);
    return { status: 500, error: (error as Error).message };
  }
}
