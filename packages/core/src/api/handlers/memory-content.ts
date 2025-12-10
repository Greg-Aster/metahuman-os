/**
 * Memory Content API Handlers
 *
 * Read and edit memory files with security policy enforcement.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, audit } from '../../index.js';

function resolvePath(relPath: string): string {
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

    const absolute = resolvePath(relPath);

    // Security check: Ensure path is within allowed directories
    const allowedPrefixes = ['profiles/', 'persona/', 'memory/', 'etc/'];
    const isAllowed = allowedPrefixes.some(prefix => relPath.startsWith(prefix));
    if (!isAllowed) {
      return {
        status: 403,
        error: 'Access denied: Path not in allowed directories',
      };
    }

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

    const absolute = resolvePath(relPath);

    // Security check: Ensure path is within allowed directories
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
