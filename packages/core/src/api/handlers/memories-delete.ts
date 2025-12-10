/**
 * Memory Delete API Handlers
 *
 * Unified handlers for deleting episodic memories.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { storageClient } from '../../storage-client.js';
import { ROOT } from '../../paths.js';
import fs from 'node:fs';
import path from 'node:path';

/**
 * POST /api/memories/delete - Delete an episodic memory file
 * Body: { relPath: string }
 */
export async function handleDeleteMemory(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { body } = req;

  try {
    const { relPath } = body || {};

    if (!relPath || typeof relPath !== 'string') {
      return { status: 400, error: 'relPath is required' };
    }

    const full = path.join(ROOT, relPath);

    // Security: ensure target is inside episodic directory and is a JSON file
    const episodicResult = storageClient.resolvePath({ category: 'memory', subcategory: 'episodic' });
    if (!episodicResult.success || !episodicResult.path) {
      return { status: 500, error: 'Cannot resolve episodic path' };
    }

    const episodicRoot = episodicResult.path;
    const normalized = path.normalize(full);

    if (!normalized.startsWith(path.normalize(episodicRoot))) {
      return { status: 400, error: 'Invalid path' };
    }

    if (!fs.existsSync(normalized) || !normalized.endsWith('.json')) {
      return { status: 404, error: 'File not found' };
    }

    fs.unlinkSync(normalized);

    return successResponse({ success: true });
  } catch (error) {
    console.error('[memories/delete] POST error:', error);
    return { status: 500, error: (error as Error).message };
  }
}
