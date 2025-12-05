/**
 * Profile Sync - Memories API
 *
 * GET: Download memories (paginated)
 * POST: Upload memories from mobile
 */

import type { APIRoute } from 'astro';
import { getAuthenticatedUser, getProfilePaths, audit } from '@metahuman/core';
import fs from 'fs';
import path from 'path';

interface MemoryFile {
  id: string;
  type: string;
  content: string;
  timestamp: string;
  metadata: Record<string, any>;
}

/**
 * Recursively get all memory files from a directory
 */
function getMemoryFiles(dir: string, limit: number, offset: number): { memories: MemoryFile[]; total: number; hasMore: boolean } {
  const allFiles: string[] = [];

  const collectFiles = (currentDir: string) => {
    if (!fs.existsSync(currentDir)) return;
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        collectFiles(fullPath);
      } else if (entry.name.endsWith('.json')) {
        allFiles.push(fullPath);
      }
    }
  };

  collectFiles(dir);

  // Sort by filename (which includes timestamp)
  allFiles.sort().reverse();

  const total = allFiles.length;
  const paginatedFiles = allFiles.slice(offset, offset + limit);

  const memories: MemoryFile[] = [];
  for (const filePath of paginatedFiles) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);
      memories.push({
        id: data.id || path.basename(filePath, '.json'),
        type: data.type || 'observation',
        content: data.content || '',
        timestamp: data.timestamp || data.createdAt || '',
        metadata: data.metadata || {},
      });
    } catch {
      // Skip invalid files
    }
  }

  return {
    memories,
    total,
    hasMore: offset + limit < total,
  };
}

export const GET: APIRoute = async ({ cookies, url }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    const profilePaths = getProfilePaths(user.username);

    const limit = parseInt(url.searchParams.get('limit') || '100', 10);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);

    const result = getMemoryFiles(profilePaths.episodic, limit, offset);

    await audit({
      event: 'profile_sync_memories_download',
      actor: user.username,
      details: {
        count: result.memories.length,
        offset,
        limit,
        total: result.total,
      },
    });

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    if ((error as any)?.message?.includes('Authentication required')) {
      return new Response(JSON.stringify({ error: 'Authentication required' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    console.error('[profile-sync/memories] GET Error:', error);
    return new Response(JSON.stringify({ error: 'Failed to get memories' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const POST: APIRoute = async ({ cookies, request }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    const profilePaths = getProfilePaths(user.username);

    const body = await request.json();
    const memories: MemoryFile[] = body.memories || [];

    if (!Array.isArray(memories) || memories.length === 0) {
      return new Response(JSON.stringify({ error: 'No memories provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let saved = 0;
    const errors: string[] = [];

    for (const memory of memories) {
      try {
        // Determine year folder from timestamp
        const date = new Date(memory.timestamp);
        const year = date.getFullYear().toString();
        const dateStr = date.toISOString().split('T')[0];

        const yearDir = path.join(profilePaths.episodic, year);
        if (!fs.existsSync(yearDir)) {
          fs.mkdirSync(yearDir, { recursive: true });
        }

        const filename = `${dateStr}-${memory.id}.json`;
        const filePath = path.join(yearDir, filename);

        // Prepare memory data
        const memoryData = {
          id: memory.id,
          type: memory.type,
          content: memory.content,
          timestamp: memory.timestamp,
          metadata: {
            ...memory.metadata,
            syncedFromMobile: true,
            syncedAt: new Date().toISOString(),
          },
        };

        fs.writeFileSync(filePath, JSON.stringify(memoryData, null, 2));
        saved++;
      } catch (e) {
        errors.push(`Failed to save memory ${memory.id}: ${e instanceof Error ? e.message : 'Unknown'}`);
      }
    }

    await audit({
      event: 'profile_sync_memories_upload',
      actor: user.username,
      details: {
        attempted: memories.length,
        saved,
        errors: errors.length,
      },
    });

    return new Response(JSON.stringify({
      saved,
      errors,
      timestamp: new Date().toISOString(),
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    if ((error as any)?.message?.includes('Authentication required')) {
      return new Response(JSON.stringify({ error: 'Authentication required' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    console.error('[profile-sync/memories] POST Error:', error);
    return new Response(JSON.stringify({ error: 'Failed to upload memories' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
