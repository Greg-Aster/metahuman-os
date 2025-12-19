/**
 * Memory Content API Handlers
 *
 * Read and edit memory files with security policy enforcement.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 *
 * Path formats:
 * - "profile:path/to/file" - relative to user's profile root (supports custom storage)
 * - "profiles/user/..." - legacy format, relative to ROOT
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, audit, getProfilePaths } from '../../index.js';

/**
 * Resolve a path for a given user
 * Supports both "profile:" prefix (for custom storage) and legacy paths
 */
function resolvePathForUser(relPath: string, username: string): string {
  // Handle profile: prefix - resolve relative to user's profile root
  if (relPath.startsWith('profile:')) {
    const profilePaths = getProfilePaths(username);
    const profileRelPath = relPath.slice('profile:'.length);
    const absolute = path.resolve(profilePaths.root, profileRelPath);
    // Security: ensure path stays within profile root
    if (!absolute.startsWith(profilePaths.root)) {
      throw new Error('Invalid path: traversal outside profile directory');
    }
    return absolute;
  }

  // Legacy: resolve relative to ROOT
  const absolute = path.resolve(ROOT, relPath);
  if (!absolute.startsWith(ROOT)) {
    throw new Error('Invalid path');
  }
  return absolute;
}

/**
 * GET /api/memory-content - Read a memory file
 */
export async function handleGetMemoryContent(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const relPath = req.query?.relPath;
    if (!relPath) {
      return {
        status: 400,
        error: 'relPath is required',
      };
    }

    // For profile: paths, require authentication
    // For legacy paths, allow if they're in allowed directories
    if (relPath.startsWith('profile:')) {
      if (!req.user.isAuthenticated) {
        return {
          status: 401,
          error: 'Authentication required for profile paths',
        };
      }
    } else {
      // Legacy security check for non-profile paths
      const allowedPrefixes = ['profiles/', 'persona/', 'memory/', 'etc/'];
      const isAllowed = allowedPrefixes.some(prefix => relPath.startsWith(prefix));
      if (!isAllowed) {
        return {
          status: 403,
          error: 'Access denied: Path not in allowed directories',
        };
      }
    }

    const absolute = resolvePathForUser(relPath, req.user.username || 'anonymous');

    if (!fs.existsSync(absolute)) {
      return {
        status: 404,
        error: 'File not found',
      };
    }

    const raw = fs.readFileSync(absolute, 'utf8');
    let content = raw;
    let format: 'json' | 'text' = 'text';

    if (absolute.endsWith('.json')) {
      try {
        const parsed = JSON.parse(raw);
        content = JSON.stringify(parsed, null, 2);
        format = 'json';
      } catch {
        // Leave as raw text if JSON.parse fails
      }
    }

    return successResponse({ success: true, content, format });
  } catch (error) {
    console.error('[memory-content] GET error:', error);
    return {
      status: 500,
      error: (error as Error).message,
    };
  }
}

/**
 * PUT /api/memory-content - Edit a memory file
 */
export async function handlePutMemoryContent(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, body } = req;

  // Require authentication for writes
  if (!user.isAuthenticated) {
    return {
      status: 401,
      error: 'Authentication required for write operations',
    };
  }

  try {
    const relPath = body?.relPath;
    const content = body?.content;

    if (!relPath || content === undefined) {
      return {
        status: 400,
        error: 'relPath and content are required',
      };
    }

    // For profile: paths, no additional prefix check needed (already scoped to user)
    // For legacy paths, verify allowed directories
    if (!relPath.startsWith('profile:')) {
      const allowedPrefixes = ['profiles/', 'persona/', 'memory/'];
      const isAllowed = allowedPrefixes.some(prefix => relPath.startsWith(prefix));
      if (!isAllowed) {
        return {
          status: 403,
          error: 'Access denied: Cannot write to this path',
        };
      }

      // Additional check: user can only write to their own profile (owners can write anywhere)
      if (relPath.startsWith('profiles/')) {
        const profileMatch = relPath.match(/^profiles\/([^\/]+)\//);
        if (profileMatch && profileMatch[1] !== user.username && user.role !== 'owner') {
          return {
            status: 403,
            error: 'Access denied: Cannot write to other users\' profiles',
          };
        }
      }
    }

    const absolute = resolvePathForUser(relPath, user.username || 'anonymous');

    if (!fs.existsSync(absolute)) {
      return {
        status: 404,
        error: 'File not found',
      };
    }

    // Write the file
    fs.writeFileSync(absolute, content, 'utf8');

    // Audit the change
    audit({
      level: 'info',
      category: 'data',
      event: 'memory_file_edited',
      details: {
        relPath,
        size: content.length,
        username: user.username,
      },
      actor: user.username || 'unknown',
    });

    return successResponse({ success: true });
  } catch (error) {
    console.error('[memory-content] PUT error:', error);
    return {
      status: 500,
      error: (error as Error).message,
    };
  }
}
