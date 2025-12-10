/**
 * Persona Archives API Handlers
 *
 * List, view, restore, and delete persona archives.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import fs from 'node:fs';
import path from 'node:path';
import { getProfilePaths } from '../../paths.js';
import { audit } from '../../audit.js';

interface ArchiveInfo {
  filename: string;
  timestamp: string;
  createdAt: string;
  version: string;
  lastUpdated: string | null;
  identity: {
    name: string;
    role: string;
  };
  size: number;
}

/**
 * GET /api/persona-archives - List persona archives
 */
export async function handleListPersonaArchives(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user } = req;

  if (!user.isAuthenticated) {
    return {
      status: 401,
      error: 'Authentication required',
    };
  }

  try {
    const profilePaths = getProfilePaths(user.username);
    const personaDir = path.dirname(profilePaths.personaCore);
    const archivesDir = path.join(personaDir, 'archives');

    // Check if archives directory exists
    if (!fs.existsSync(archivesDir)) {
      return successResponse({ success: true, archives: [] });
    }

    // Read all archive files
    const files = fs.readdirSync(archivesDir)
      .filter(f => f.endsWith('.json'))
      .sort()
      .reverse(); // Most recent first

    // Get metadata for each archive
    const archives: ArchiveInfo[] = files.map(file => {
      const filePath = path.join(archivesDir, file);
      const stats = fs.statSync(filePath);
      const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

      return {
        filename: file,
        timestamp: file.replace('.json', ''),
        createdAt: stats.mtime.toISOString(),
        version: content.version || 'unknown',
        lastUpdated: content.lastUpdated || null,
        identity: {
          name: content.identity?.name || 'Unknown',
          role: content.identity?.role || 'Unknown',
        },
        size: stats.size,
      };
    });

    return successResponse({ success: true, archives });
  } catch (error) {
    console.error('[persona-archives] GET error:', error);
    return {
      status: 500,
      error: (error as Error).message || 'Unknown error',
    };
  }
}

/**
 * POST /api/persona-archives - Handle archive actions (restore, view, delete)
 */
export async function handlePersonaArchiveAction(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, body } = req;

  if (!user.isAuthenticated) {
    return {
      status: 401,
      error: 'Authentication required',
    };
  }

  try {
    const profilePaths = getProfilePaths(user.username);
    const { action, filename } = body || {};

    if (!action || !filename) {
      return {
        status: 400,
        error: 'action and filename are required',
      };
    }

    const personaDir = path.dirname(profilePaths.personaCore);
    const archivePath = path.join(personaDir, 'archives', filename);

    // Security: Validate filename to prevent path traversal
    if (filename.includes('..') || filename.includes('/')) {
      return {
        status: 400,
        error: 'Invalid filename',
      };
    }

    if (action === 'restore') {
      // Verify archive exists
      if (!fs.existsSync(archivePath)) {
        return {
          status: 404,
          error: 'Archive not found',
        };
      }

      // Create a backup of current persona before restoring
      const currentPersona = JSON.parse(fs.readFileSync(profilePaths.personaCore, 'utf-8'));
      const backupTimestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const backupPath = path.join(personaDir, 'archives', `${backupTimestamp}-pre-restore.json`);

      // Ensure archives directory exists
      const archivesDir = path.join(personaDir, 'archives');
      if (!fs.existsSync(archivesDir)) {
        fs.mkdirSync(archivesDir, { recursive: true });
      }

      fs.writeFileSync(backupPath, JSON.stringify(currentPersona, null, 2), 'utf-8');

      // Restore the archive
      const archivedPersona = JSON.parse(fs.readFileSync(archivePath, 'utf-8'));
      archivedPersona.lastUpdated = new Date().toISOString();

      // Add note about restoration
      if (!archivedPersona.notes) archivedPersona.notes = '';
      archivedPersona.notes += `\n\n[${new Date().toISOString()}] Restored from archive: ${filename}`;

      fs.writeFileSync(profilePaths.personaCore, JSON.stringify(archivedPersona, null, 2), 'utf-8');

      // Audit the restoration
      audit({
        level: 'info',
        category: 'data',
        event: 'persona_restored_from_archive',
        details: {
          archiveFile: filename,
          backupFile: `${backupTimestamp}-pre-restore.json`,
        },
        actor: user.username,
      });

      return successResponse({
        success: true,
        message: 'Persona restored successfully',
        backupFile: `${backupTimestamp}-pre-restore.json`,
      });
    }

    if (action === 'view') {
      if (!fs.existsSync(archivePath)) {
        return {
          status: 404,
          error: 'Archive not found',
        };
      }

      const archivedPersona = JSON.parse(fs.readFileSync(archivePath, 'utf-8'));

      return successResponse({ success: true, persona: archivedPersona });
    }

    if (action === 'delete') {
      if (!fs.existsSync(archivePath)) {
        return {
          status: 404,
          error: 'Archive not found',
        };
      }

      fs.unlinkSync(archivePath);

      audit({
        level: 'info',
        category: 'data',
        event: 'persona_archive_deleted',
        details: {
          archiveFile: filename,
        },
        actor: user.username,
      });

      return successResponse({ success: true, message: 'Archive deleted successfully' });
    }

    return {
      status: 400,
      error: 'Invalid action',
    };
  } catch (error) {
    console.error('[persona-archives] POST error:', error);
    return {
      status: 500,
      error: (error as Error).message || 'Unknown error',
    };
  }
}
