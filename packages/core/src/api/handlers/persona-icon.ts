/**
 * Persona Icon API Handler
 *
 * GET the persona's avatar icon image.
 * Returns binary image data (not JSON).
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loadPersonaCore } from '../../identity.js';
import { storageClient } from '../../storage-client.js';

/**
 * GET /api/persona-icon - Get persona avatar icon image
 */
export async function handleGetPersonaIcon(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    // All users are authenticated (no anonymous access - handled by HTTP adapter)
    const persona = loadPersonaCore();
    const iconConfig = persona.identity?.icon;

    if (!iconConfig) {
      return {
        status: 404,
        error: 'No icon configured',
      };
    }

    // Determine if path is absolute or relative
    let iconPath: string;
    if (path.isAbsolute(iconConfig)) {
      // Use absolute path as-is
      iconPath = iconConfig;
    } else {
      // Relative path - resolve relative to persona/ directory
      const personaPathResult = storageClient.resolvePath({
        category: 'config',
        subcategory: 'persona',
      });
      if (!personaPathResult.success || !personaPathResult.path) {
        return {
          status: 404,
          error: 'Persona directory not available',
        };
      }
      iconPath = path.join(personaPathResult.path, iconConfig);
    }

    if (!existsSync(iconPath)) {
      return {
        status: 404,
        error: 'Icon file not found',
      };
    }

    // Read the file
    const fileBuffer = readFileSync(iconPath);

    // Determine content type based on file extension
    const ext = path.extname(iconPath).toLowerCase();
    let contentType = 'image/png'; // default

    if (ext === '.jpg' || ext === '.jpeg') {
      contentType = 'image/jpeg';
    } else if (ext === '.png') {
      contentType = 'image/png';
    } else if (ext === '.gif') {
      contentType = 'image/gif';
    } else if (ext === '.svg') {
      contentType = 'image/svg+xml';
    } else if (ext === '.webp') {
      contentType = 'image/webp';
    }

    // Return binary data with special flag
    return {
      status: 200,
      binary: fileBuffer,
      contentType,
      headers: {
        'Cache-Control': 'public, max-age=300', // Cache for 5 minutes
      },
    };
  } catch (error) {
    console.error('[persona-icon] GET failed:', error);
    return {
      status: 500,
      error: 'Error loading icon',
    };
  }
}
