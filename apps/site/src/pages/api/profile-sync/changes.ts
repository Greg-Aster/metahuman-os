/**
 * Profile Sync - Changes API
 *
 * GET: Get changes since a timestamp (for incremental sync)
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
 * Get memories modified since a timestamp
 */
function getMemoriesSince(dir: string, since: Date | null, limit: number): MemoryFile[] {
  const memories: MemoryFile[] = [];

  const collectFiles = (currentDir: string) => {
    if (!fs.existsSync(currentDir)) return;
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        collectFiles(fullPath);
      } else if (entry.name.endsWith('.json')) {
        try {
          const stats = fs.statSync(fullPath);
          // Check if modified since the timestamp
          if (!since || stats.mtime > since) {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const data = JSON.parse(content);
            memories.push({
              id: data.id || path.basename(fullPath, '.json'),
              type: data.type || 'observation',
              content: data.content || '',
              timestamp: data.timestamp || data.createdAt || '',
              metadata: {
                ...data.metadata,
                serverModifiedAt: stats.mtime.toISOString(),
              },
            });
          }
        } catch {
          // Skip invalid files
        }
      }
    }
  };

  collectFiles(dir);

  // Sort by timestamp descending and limit
  return memories
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, limit);
}

/**
 * Get persona files modified since timestamp
 */
function getPersonaSince(dir: string, since: Date | null): Record<string, any> {
  const persona: Record<string, any> = {};

  if (!fs.existsSync(dir)) return persona;

  const files = fs.readdirSync(dir);
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const fullPath = path.join(dir, file);
      const stats = fs.statSync(fullPath);

      if (!since || stats.mtime > since) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const key = file.replace('.json', '');
        persona[key] = JSON.parse(content);
      }
    } catch {
      // Skip invalid files
    }
  }

  return persona;
}

export const GET: APIRoute = async ({ cookies, url }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    const profilePaths = getProfilePaths(user.username);

    const sinceParam = url.searchParams.get('since');
    const limit = parseInt(url.searchParams.get('limit') || '500', 10);

    let since: Date | null = null;
    if (sinceParam) {
      since = new Date(sinceParam);
      if (isNaN(since.getTime())) {
        since = null;
      }
    }

    // Get changed memories
    const memories = getMemoriesSince(profilePaths.episodic, since, limit);

    // Get changed persona files
    const persona = getPersonaSince(profilePaths.persona, since);

    await audit({
      event: 'profile_sync_changes',
      actor: user.username,
      details: {
        since: sinceParam,
        memoriesChanged: memories.length,
        personaChanged: Object.keys(persona).length,
      },
    });

    return new Response(JSON.stringify({
      memories,
      persona,
      timestamp: new Date().toISOString(),
      hasMore: memories.length === limit,
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
    console.error('[profile-sync/changes] Error:', error);
    return new Response(JSON.stringify({ error: 'Failed to get changes' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
