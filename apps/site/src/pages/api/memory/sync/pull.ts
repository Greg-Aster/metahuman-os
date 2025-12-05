/**
 * Memory Sync Pull API
 *
 * Returns memories modified since a given timestamp for client sync.
 * Supports incremental sync to minimize data transfer.
 */

import type { APIRoute } from 'astro';
import { getAuthenticatedUser, getProfilePaths } from '@metahuman/core';
import { audit } from '@metahuman/core';
import * as fs from 'fs';
import * as path from 'path';

interface SyncableMemory {
  id: string;
  type: string;
  content: string;
  timestamp: string;
  metadata: Record<string, any>;
}

interface PullResponse {
  memories: SyncableMemory[];
  serverTimestamp: string;
  hasMore: boolean;
}

// GET - Pull memories since timestamp
export const GET: APIRoute = async ({ cookies, request }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    const profilePaths = getProfilePaths(user.username);

    const url = new URL(request.url);
    const since = url.searchParams.get('since');
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);
    const memoryType = url.searchParams.get('type');

    const sinceDate = since ? new Date(since) : new Date(0);
    const memories: SyncableMemory[] = [];

    // Scan episodic memory directory
    const episodicDir = profilePaths.episodic;

    if (!fs.existsSync(episodicDir)) {
      return new Response(JSON.stringify({
        memories: [],
        serverTimestamp: new Date().toISOString(),
        hasMore: false,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Recursive scan for memory files
    const scanDir = (dir: string): void => {
      if (!fs.existsSync(dir)) return;

      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          scanDir(fullPath);
        } else if (entry.name.endsWith('.json')) {
          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const memory = JSON.parse(content);

            // Check modification time
            const stats = fs.statSync(fullPath);
            const modifiedAt = new Date(memory.metadata?.syncedAt || stats.mtime);

            if (modifiedAt > sinceDate) {
              // Filter by type if specified
              if (memoryType && memory.type !== memoryType) {
                return;
              }

              memories.push({
                id: memory.id || path.basename(fullPath, '.json'),
                type: memory.type || 'unknown',
                content: memory.content || '',
                timestamp: memory.timestamp || stats.mtime.toISOString(),
                metadata: memory.metadata || {},
              });
            }
          } catch {
            // Skip invalid files
          }
        }
      }
    };

    scanDir(episodicDir);

    // Sort by timestamp (newest first)
    memories.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // Apply limit
    const hasMore = memories.length > limit;
    const limitedMemories = memories.slice(0, limit);

    // Audit
    audit({
      event: 'memory_sync_pull',
      category: 'data_change',
      level: 'info',
      actor: user.username,
      details: {
        since,
        count: limitedMemories.length,
        hasMore,
      },
    });

    const response: PullResponse = {
      memories: limitedMemories,
      serverTimestamp: new Date().toISOString(),
      hasMore,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[sync/pull] Error:', e);
    return new Response(JSON.stringify({
      error: e instanceof Error ? e.message : 'Internal server error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
