import type { APIRoute } from 'astro';
import { loadPersonaCore } from '@metahuman/core/identity';
import { tryResolveProfilePath, getAuthenticatedUser } from '@metahuman/core';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * API endpoint to serve the persona icon
 * Returns the icon image if it exists, otherwise returns a 404
 *
 * Supports both:
 * - Absolute paths: "/home/greggles/metahuman/persona/avatar.png"
 * - Relative paths: "persona-icon.png" (resolved relative to persona/ directory)
 *
 * For anonymous users, returns 404 (no icon available)
 */
export const GET: APIRoute = async ({ cookies }) => {
  try {
    // Check authentication
    const user = getAuthenticatedUser(cookies);
    const isAuthenticated = user !== null;

    if (!isAuthenticated) {
      // Anonymous users don't have persona icons
      return new Response('No icon available for anonymous users', { status: 404 });
    }

    const persona = loadPersonaCore();
    const iconConfig = persona.identity.icon;

    if (!iconConfig) {
      return new Response('No icon configured', { status: 404 });
    }

    // Determine if path is absolute or relative
    let iconPath: string;
    if (path.isAbsolute(iconConfig)) {
      // Use absolute path as-is
      iconPath = iconConfig;
    } else {
      // Relative path - resolve relative to persona/ directory
      const personaPathResult = tryResolveProfilePath('persona');
      if (!personaPathResult.ok) {
        return new Response('Persona directory not available', { status: 404 });
      }
      iconPath = path.join(personaPathResult.path, iconConfig);
    }

    if (!existsSync(iconPath)) {
      return new Response('Icon file not found', { status: 404 });
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

    return new Response(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=300', // Cache for 5 minutes
      },
    });
  } catch (error) {
    console.error('Error serving persona icon:', error);
    return new Response('Error loading icon', { status: 500 });
  }
};
