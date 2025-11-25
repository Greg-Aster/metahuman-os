/**
 * API endpoint for listing and restoring persona archives
 */
import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { getAuthenticatedUser } from '@metahuman/core/auth';
import { getProfilePaths } from '@metahuman/core/paths';
import { audit } from '@metahuman/core/audit';

export const GET: APIRoute = async ({ cookies }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    const profilePaths = getProfilePaths(user.username);

    const personaDir = path.dirname(profilePaths.personaCore);
    const archivesDir = path.join(personaDir, 'archives');

    // Check if archives directory exists
    if (!fs.existsSync(archivesDir)) {
      return new Response(JSON.stringify({ success: true, archives: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Read all archive files
    const files = fs.readdirSync(archivesDir)
      .filter(f => f.endsWith('.json'))
      .sort()
      .reverse(); // Most recent first

    // Get metadata for each archive
    const archives = files.map(file => {
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

    return new Response(JSON.stringify({ success: true, archives }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error listing persona archives:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    const profilePaths = getProfilePaths(user.username);

    const { action, filename } = await request.json();

    if (action === 'restore') {
      const personaDir = path.dirname(profilePaths.personaCore);
      const archivePath = path.join(personaDir, 'archives', filename);

      // Verify archive exists
      if (!fs.existsSync(archivePath)) {
        return new Response(
          JSON.stringify({ success: false, error: 'Archive not found' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Create a backup of current persona before restoring
      const currentPersona = JSON.parse(fs.readFileSync(profilePaths.personaCore, 'utf-8'));
      const backupTimestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const backupPath = path.join(personaDir, 'archives', `${backupTimestamp}-pre-restore.json`);
      fs.writeFileSync(backupPath, JSON.stringify(currentPersona, null, 2), 'utf-8');

      // Restore the archive
      const archivedPersona = JSON.parse(fs.readFileSync(archivePath, 'utf-8'));
      archivedPersona.lastUpdated = new Date().toISOString();

      // Add note about restoration
      if (!archivedPersona.notes) archivedPersona.notes = '';
      archivedPersona.notes += `\n\n[${new Date().toISOString()}] Restored from archive: ${filename}`;

      fs.writeFileSync(profilePaths.personaCore, JSON.stringify(archivedPersona, null, 2), 'utf-8');

      // Audit the restoration
      await audit('data_change', 'info', {
        action: 'persona_restored_from_archive',
        archiveFile: filename,
        backupFile: `${backupTimestamp}-pre-restore.json`,
        actor: user.username,
      });

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Persona restored successfully',
          backupFile: `${backupTimestamp}-pre-restore.json`
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'view') {
      const personaDir = path.dirname(profilePaths.personaCore);
      const archivePath = path.join(personaDir, 'archives', filename);

      if (!fs.existsSync(archivePath)) {
        return new Response(
          JSON.stringify({ success: false, error: 'Archive not found' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const archivedPersona = JSON.parse(fs.readFileSync(archivePath, 'utf-8'));

      return new Response(
        JSON.stringify({ success: true, persona: archivedPersona }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'delete') {
      const personaDir = path.dirname(profilePaths.personaCore);
      const archivePath = path.join(personaDir, 'archives', filename);

      if (!fs.existsSync(archivePath)) {
        return new Response(
          JSON.stringify({ success: false, error: 'Archive not found' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }

      fs.unlinkSync(archivePath);

      await audit('data_change', 'info', {
        action: 'persona_archive_deleted',
        archiveFile: filename,
        actor: user.username,
      });

      return new Response(
        JSON.stringify({ success: true, message: 'Archive deleted successfully' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: false, error: 'Invalid action' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error managing persona archive:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
