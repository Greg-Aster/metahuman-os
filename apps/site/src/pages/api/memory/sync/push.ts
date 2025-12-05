/**
 * Memory Sync Push API
 *
 * Receives memories from mobile/offline clients and saves them to the server.
 * Handles both new memories (POST) and updates (PUT).
 */

import type { APIRoute } from 'astro';
import { getAuthenticatedUser, getProfilePaths } from '@metahuman/core';
import { audit } from '@metahuman/core';
import * as fs from 'fs';
import * as path from 'path';

interface SyncMemory {
  id: string;
  type: string;
  content: string;
  timestamp: string;
  metadata: Record<string, any>;
  syncStatus: string;
  localModifiedAt: string;
  serverModifiedAt?: string;
}

interface PushRequest {
  memory: SyncMemory;
}

// POST - Create new memory
export const POST: APIRoute = async ({ cookies, request }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    const profilePaths = getProfilePaths(user.username);

    const body: PushRequest = await request.json();
    const { memory } = body;

    if (!memory || !memory.id || !memory.type || !memory.content) {
      return new Response(JSON.stringify({ error: 'Invalid memory data' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Determine storage path based on memory type
    let storagePath: string;
    const timestamp = new Date(memory.timestamp);
    const year = timestamp.getFullYear().toString();

    switch (memory.type) {
      case 'episodic':
      case 'observation':
      case 'conversation':
        const yearDir = path.join(profilePaths.episodic, year);
        if (!fs.existsSync(yearDir)) {
          fs.mkdirSync(yearDir, { recursive: true });
        }
        const dateStr = timestamp.toISOString().slice(0, 10);
        storagePath = path.join(yearDir, `${dateStr}-${memory.id}.json`);
        break;

      case 'inner_dialogue':
      case 'reflection':
        const reflectionDir = path.join(profilePaths.episodic, year);
        if (!fs.existsSync(reflectionDir)) {
          fs.mkdirSync(reflectionDir, { recursive: true });
        }
        storagePath = path.join(reflectionDir, `${memory.id}.json`);
        break;

      default:
        storagePath = path.join(profilePaths.episodic, year, `${memory.id}.json`);
        const dir = path.dirname(storagePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
    }

    // Prepare memory for storage
    const serverMemory = {
      id: memory.id,
      type: memory.type,
      content: memory.content,
      timestamp: memory.timestamp,
      metadata: {
        ...memory.metadata,
        syncedAt: new Date().toISOString(),
        syncSource: 'mobile',
      },
    };

    // Check if file already exists (conflict detection)
    if (fs.existsSync(storagePath)) {
      return new Response(JSON.stringify({
        error: 'Memory already exists',
        code: 'CONFLICT',
        existingTimestamp: JSON.parse(fs.readFileSync(storagePath, 'utf-8')).timestamp,
      }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Save memory
    fs.writeFileSync(storagePath, JSON.stringify(serverMemory, null, 2));

    // Audit
    audit({
      event: 'memory_sync_push',
      category: 'data_change',
      level: 'info',
      actor: user.username,
      details: {
        memoryId: memory.id,
        type: memory.type,
        action: 'create',
        path: storagePath,
      },
    });

    return new Response(JSON.stringify({
      success: true,
      serverTimestamp: serverMemory.metadata.syncedAt,
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[sync/push] Error:', e);
    return new Response(JSON.stringify({
      error: e instanceof Error ? e.message : 'Internal server error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

// PUT - Update existing memory
export const PUT: APIRoute = async ({ cookies, request }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    const profilePaths = getProfilePaths(user.username);

    const body: PushRequest = await request.json();
    const { memory } = body;

    if (!memory || !memory.id) {
      return new Response(JSON.stringify({ error: 'Invalid memory data' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Find existing memory file
    const pattern = `**/*${memory.id}*.json`;
    const episodicDir = profilePaths.episodic;

    let existingPath: string | null = null;

    // Search for the memory file
    const findFile = (dir: string): string | null => {
      if (!fs.existsSync(dir)) return null;

      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const found = findFile(fullPath);
          if (found) return found;
        } else if (entry.name.includes(memory.id)) {
          return fullPath;
        }
      }
      return null;
    };

    existingPath = findFile(episodicDir);

    if (!existingPath) {
      return new Response(JSON.stringify({
        error: 'Memory not found',
        code: 'NOT_FOUND',
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Load existing and merge
    const existing = JSON.parse(fs.readFileSync(existingPath, 'utf-8'));

    const updatedMemory = {
      ...existing,
      content: memory.content,
      metadata: {
        ...existing.metadata,
        ...memory.metadata,
        syncedAt: new Date().toISOString(),
        lastModifiedBy: 'mobile_sync',
      },
    };

    // Save updated memory
    fs.writeFileSync(existingPath, JSON.stringify(updatedMemory, null, 2));

    // Audit
    audit({
      event: 'memory_sync_push',
      category: 'data_change',
      level: 'info',
      actor: user.username,
      details: {
        memoryId: memory.id,
        type: memory.type,
        action: 'update',
        path: existingPath,
      },
    });

    return new Response(JSON.stringify({
      success: true,
      serverTimestamp: updatedMemory.metadata.syncedAt,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[sync/push] Error:', e);
    return new Response(JSON.stringify({
      error: e instanceof Error ? e.message : 'Internal server error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
