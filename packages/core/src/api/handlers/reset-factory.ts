/**
 * Factory Reset API Handler
 *
 * POST to reset the system to factory defaults.
 * DESTRUCTIVE: Deletes all memories, logs, and chat history.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse, forbiddenResponse } from '../types.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { systemPaths, getProfilePaths } from '../../paths.js';

// Dynamic import for audit
let audit: typeof import('../../audit.js').audit | null = null;

async function ensureAudit(): Promise<void> {
  if (!audit) {
    const module = await import('../../audit.js');
    audit = module.audit;
  }
}

async function emptyDirectory(dir: string, preserve: Set<string> = new Set()): Promise<void> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    await Promise.all(entries.map(async (entry) => {
      if (preserve.has(entry.name)) return;
      const fullPath = path.join(dir, entry.name);
      await fs.rm(fullPath, { recursive: true, force: true });
    }));
  } catch (error) {
    // If the directory is missing we recreate it later. Ignore ENOENT.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
    await fs.mkdir(dir, { recursive: true });
  }
}

async function ensureDirectory(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

/**
 * POST /api/reset-factory - Reset to factory defaults
 * DESTRUCTIVE OPERATION - requires owner role and confirmation token
 */
export async function handleResetFactory(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    await ensureAudit();

    // Require owner role
    if (req.user.role !== 'owner') {
      return forbiddenResponse('Only owners can perform factory reset');
    }

    const { confirmToken } = req.body || {};

    // Require explicit confirmation token
    if (confirmToken !== 'CONFIRM_FACTORY_RESET') {
      return {
        status: 400,
        error: 'Confirmation required',
        data: {
          hint: 'Include {"confirmToken": "CONFIRM_FACTORY_RESET"} in request body',
          warning: 'This operation will DELETE ALL memories, logs, and chat history permanently',
        },
      };
    }

    // Get profile paths for the user
    const profilePaths = getProfilePaths(req.user.username);
    const MEMORY_DIR = profilePaths.memory;
    const LOGS_DIR = path.join(systemPaths.logs);
    const CHAT_ARCHIVE_DIR = path.join(profilePaths.out, 'chat');

    // Log critical security event
    if (audit) {
      audit({
        level: 'error',
        category: 'security',
        event: 'factory_reset_executed',
        details: {
          confirmed: true,
          warning: 'ALL DATA WILL BE DELETED',
          username: req.user.username,
        },
        actor: req.user.username,
      });
    }

    await ensureDirectory(MEMORY_DIR);
    await ensureDirectory(LOGS_DIR);
    await ensureDirectory(CHAT_ARCHIVE_DIR);

    await emptyDirectory(MEMORY_DIR, new Set(['README.md', 'schema.json']));
    await emptyDirectory(LOGS_DIR);
    await emptyDirectory(CHAT_ARCHIVE_DIR);

    return successResponse({ success: true });
  } catch (error) {
    console.error('[reset-factory] Failed:', error);
    return {
      status: 500,
      error: (error as Error).message,
    };
  }
}

/**
 * GET /api/reset-factory - Method not allowed
 */
export async function handleResetFactoryGet(req: UnifiedRequest): Promise<UnifiedResponse> {
  return {
    status: 405,
    error: 'Method not allowed',
  };
}
