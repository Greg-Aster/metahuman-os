/**
 * Memory Sync Delete API
 *
 * Handles deletion of individual memories during sync.
 */

import type { APIRoute } from 'astro';
import { getAuthenticatedUser, getProfilePaths } from '@metahuman/core';
import { audit } from '@metahuman/core';
import * as fs from 'fs';
import * as path from 'path';

// DELETE - Remove memory by ID
export const DELETE: APIRoute = async ({ cookies, params }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    const profilePaths = getProfilePaths(user.username);

    const { id } = params;

    if (!id) {
      return new Response(JSON.stringify({ error: 'Memory ID required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Search for the memory file
    const episodicDir = profilePaths.episodic;

    const findFile = (dir: string): string | null => {
      if (!fs.existsSync(dir)) return null;

      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const found = findFile(fullPath);
          if (found) return found;
        } else if (entry.name.includes(id)) {
          return fullPath;
        }
      }
      return null;
    };

    const filePath = findFile(episodicDir);

    if (!filePath) {
      return new Response(JSON.stringify({
        error: 'Memory not found',
        code: 'NOT_FOUND',
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Archive instead of delete (soft delete)
    const archiveDir = path.join(profilePaths.root, 'memory', 'archive');
    if (!fs.existsSync(archiveDir)) {
      fs.mkdirSync(archiveDir, { recursive: true });
    }

    const archivePath = path.join(archiveDir, `${Date.now()}-${path.basename(filePath)}`);
    fs.renameSync(filePath, archivePath);

    // Audit
    audit({
      event: 'memory_sync_delete',
      category: 'data_change',
      level: 'info',
      actor: user.username,
      details: {
        memoryId: id,
        originalPath: filePath,
        archivePath,
      },
    });

    return new Response(JSON.stringify({
      success: true,
      archived: true,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[sync/delete] Error:', e);
    return new Response(JSON.stringify({
      error: e instanceof Error ? e.message : 'Internal server error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

// GET - Check if memory exists
export const GET: APIRoute = async ({ cookies, params }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    const profilePaths = getProfilePaths(user.username);

    const { id } = params;

    if (!id) {
      return new Response(JSON.stringify({ error: 'Memory ID required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Search for the memory file
    const episodicDir = profilePaths.episodic;

    const findFile = (dir: string): string | null => {
      if (!fs.existsSync(dir)) return null;

      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const found = findFile(fullPath);
          if (found) return found;
        } else if (entry.name.includes(id)) {
          return fullPath;
        }
      }
      return null;
    };

    const filePath = findFile(episodicDir);

    if (!filePath) {
      return new Response(JSON.stringify({
        exists: false,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const memory = JSON.parse(content);
    const stats = fs.statSync(filePath);

    return new Response(JSON.stringify({
      exists: true,
      memory: {
        id: memory.id || id,
        type: memory.type,
        timestamp: memory.timestamp,
        modifiedAt: stats.mtime.toISOString(),
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[sync/get] Error:', e);
    return new Response(JSON.stringify({
      error: e instanceof Error ? e.message : 'Internal server error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
