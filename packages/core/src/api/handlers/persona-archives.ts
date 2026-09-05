/**
 * Persona Archives API Handlers
 *
 * Transport-only handlers. Persona archive validation, profile resolution,
 * encryption, and persistence belong to the canonical identity/storage owners.
 */

import { audit } from '../../audit.js';
import {
  deletePersonaCoreArchive,
  listPersonaCoreArchives,
  readPersonaCoreArchive,
  restorePersonaCoreArchive,
} from '../../identity.js';
import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';

function archiveError(error: unknown): UnifiedResponse {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'Invalid persona archive filename') return { status: 400, error: message };
  if (message.startsWith('File not found:')) return { status: 404, error: 'Archive not found' };
  console.error('[persona-archives] Storage error:', error);
  return { status: 500, error: message || 'Unknown error' };
}

export async function handleListPersonaArchives(req: UnifiedRequest): Promise<UnifiedResponse> {
  if (!req.user.isAuthenticated) return { status: 401, error: 'Authentication required' };
  try {
    return successResponse({
      success: true,
      archives: await listPersonaCoreArchives(req.user.username),
    });
  } catch (error) {
    return archiveError(error);
  }
}

export async function handlePersonaArchiveAction(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, body } = req;
  if (!user.isAuthenticated) return { status: 401, error: 'Authentication required' };

  const action = body?.action;
  const filename = body?.filename;
  if (typeof action !== 'string' || typeof filename !== 'string') {
    return { status: 400, error: 'action and filename are required' };
  }

  try {
    if (action === 'view') {
      return successResponse({
        success: true,
        persona: readPersonaCoreArchive(filename, user.username),
      });
    }

    if (action === 'restore') {
      const backupFile = restorePersonaCoreArchive(filename, user.username);
      audit({
        level: 'info',
        category: 'data',
        event: 'persona_restored_from_archive',
        details: { archiveFile: filename, backupFile },
        actor: user.username,
      });
      return successResponse({ success: true, message: 'Persona restored successfully', backupFile });
    }

    if (action === 'delete') {
      await deletePersonaCoreArchive(filename, user.username);
      audit({
        level: 'info',
        category: 'data',
        event: 'persona_archive_deleted',
        details: { archiveFile: filename },
        actor: user.username,
      });
      return successResponse({ success: true, message: 'Archive deleted successfully' });
    }

    return { status: 400, error: 'Invalid action' };
  } catch (error) {
    return archiveError(error);
  }
}
