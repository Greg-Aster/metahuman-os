/**
 * Memory Delete API Handlers
 *
 * Unified handlers for deleting episodic memories.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 *
 * Path formats:
 * - "profile:path/to/file" - relative to user's profile root (supports custom storage)
 * - "profiles/user/..." - legacy format, relative to ROOT
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { ROOT, getProfilePaths } from '../../paths.js';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Resolve a path for a given user
 * Supports both "profile:" prefix (for custom storage) and legacy paths
 */
function resolvePathForUser(relPath: string, username: string): { absolute: string; profileRoot: string } {
  // Handle profile: prefix - resolve relative to user's profile root
  if (relPath.startsWith('profile:')) {
    const profilePaths = getProfilePaths(username);
    const profileRelPath = relPath.slice('profile:'.length);
    const absolute = path.resolve(profilePaths.root, profileRelPath);
    // Security: ensure path stays within profile root
    if (!absolute.startsWith(profilePaths.root)) {
      throw new Error('Invalid path: traversal outside profile directory');
    }
    return { absolute, profileRoot: profilePaths.root };
  }

  // Legacy: resolve relative to ROOT
  const absolute = path.resolve(ROOT, relPath);
  if (!absolute.startsWith(ROOT)) {
    throw new Error('Invalid path');
  }
  // For legacy paths, profile root is ROOT/profiles/username
  const profileRoot = path.join(ROOT, 'profiles', username);
  return { absolute, profileRoot };
}

/**
 * POST /api/memories/delete - Delete an episodic memory file
 * Body: { relPath: string }
 */
export async function handleDeleteMemory(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { body, user } = req;

  try {
    const { relPath } = body || {};

    if (!relPath || typeof relPath !== 'string') {
      return { status: 400, error: 'relPath is required' };
    }

    // Require authentication for deletion
    if (!user.isAuthenticated) {
      return { status: 401, error: 'Authentication required' };
    }

    const { absolute, profileRoot } = resolvePathForUser(relPath, user.username || 'anonymous');
    const normalized = path.normalize(absolute);

    // Security: ensure target is inside episodic directory and is a JSON file
    const episodicRoot = path.join(profileRoot, 'memory', 'episodic');
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
