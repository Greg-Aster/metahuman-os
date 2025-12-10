/**
 * Memory Validate API Handlers
 *
 * Unified handlers for validating episodic memories.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { storageClient } from '../../storage-client.js';
import { ROOT, timestamp } from '../../paths.js';
import fs from 'node:fs';
import path from 'node:path';

/**
 * POST /api/memories/validate - Validate an episodic memory file
 * Body: { relPath: string, status: 'correct' | 'incorrect' }
 */
export async function handleValidateMemory(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { body } = req;

  try {
    const { relPath, status } = body || {};

    if (!relPath || typeof relPath !== 'string') {
      return { status: 400, error: 'relPath is required' };
    }

    if (status !== 'correct' && status !== 'incorrect') {
      return { status: 400, error: 'status must be "correct" or "incorrect"' };
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

    const raw = fs.readFileSync(normalized, 'utf8');
    const obj = JSON.parse(raw);
    obj.validation = { status, by: 'user', timestamp: timestamp() };
    fs.writeFileSync(normalized, JSON.stringify(obj, null, 2));

    return successResponse({ success: true });
  } catch (error) {
    console.error('[memories/validate] POST error:', error);
    return { status: 500, error: (error as Error).message };
  }
}
