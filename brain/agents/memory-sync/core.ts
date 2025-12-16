/**
 * Memory Sync Agent — Core Logic
 *
 * Background sync of memories with remote server.
 * - Pull new memories from remote server
 * - Push local memories to remote server
 * - Handle conflicts gracefully (local-first - local wins)
 */

import type { AgentContext, AgentInput, AgentResult } from '@metahuman/agent-runtime';
import fs from 'node:fs';
import path from 'node:path';
import {
  audit,
  auditAction,
  getLoggedInUsers,
  withUserContext,
  getProfilePaths,
} from '@metahuman/core';
import { loadUserCredentials } from '@metahuman/core/llm-config';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface SyncConfig {
  serverUrl: string;
  sessionId: string;
  username?: string;
  lastMemorySyncAt?: string;
}

interface MemoryFile {
  id: string;
  path: string;
  content: any;
  timestamp: string;
}

export interface SyncResult {
  pulled: number;
  pushed: number;
  conflicts: number;
  errors: string[];
}

export interface MemorySyncOptions {
  pullOnly?: boolean;
  pushOnly?: boolean;
  days?: number;
  username?: string;
}

// ─────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────

function loadSyncConfig(username: string): SyncConfig | null {
  const creds = loadUserCredentials(username);

  if (!creds?.server?.serverUrl || !creds?.server?.sessionId) {
    return null;
  }

  let lastMemorySyncAt: string | undefined;
  try {
    const profilePaths = getProfilePaths(username);
    const syncServerPath = path.join(profilePaths.etc, 'sync-server.json');
    if (fs.existsSync(syncServerPath)) {
      const syncServerData = JSON.parse(fs.readFileSync(syncServerPath, 'utf-8'));
      lastMemorySyncAt = syncServerData.lastMemorySyncAt;
    }
  } catch {
    // Ignore errors
  }

  return {
    serverUrl: creds.server.serverUrl,
    sessionId: creds.server.sessionId,
    username: creds.server.username,
    lastMemorySyncAt,
  };
}

function getLocalMemories(username: string): MemoryFile[] {
  const profilePaths = getProfilePaths(username);
  const episodicDir = profilePaths.episodic;
  const memories: MemoryFile[] = [];

  if (!fs.existsSync(episodicDir)) {
    return memories;
  }

  const years = fs.readdirSync(episodicDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  for (const year of years) {
    const yearDir = path.join(episodicDir, year);
    const files = fs.readdirSync(yearDir)
      .filter(f => f.endsWith('.json'));

    for (const file of files) {
      try {
        const filePath = path.join(yearDir, file);
        const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        const id = file.replace('.json', '');
        const stat = fs.statSync(filePath);

        memories.push({
          id,
          path: filePath,
          content,
          timestamp: stat.mtime.toISOString(),
        });
      } catch (e) {
        console.warn(`[memory-sync] Failed to read memory ${file}:`, e);
      }
    }
  }

  return memories;
}

function saveMemoryLocal(username: string, memory: any): string {
  const profilePaths = getProfilePaths(username);
  const id = memory.id || `${new Date().toISOString().slice(0, 10)}-${Date.now()}`;
  const year = id.slice(0, 4);
  const yearDir = path.join(profilePaths.episodic, year);

  fs.mkdirSync(yearDir, { recursive: true });

  const filePath = path.join(yearDir, `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(memory, null, 2), 'utf-8');

  return filePath;
}

async function pullMemoriesFromServer(
  config: SyncConfig,
  localMemoryIds: Set<string>,
  options: { days?: number; limit?: number; since?: string } = {}
): Promise<{ memories: any[]; hasMore: boolean; error?: string }> {
  const { serverUrl, sessionId } = config;
  const baseUrl = serverUrl.replace(/\/$/, '');
  const { days = 30, limit = 100, since } = options;

  try {
    const params = new URLSearchParams({
      limit: limit.toString(),
    });

    if (since) {
      params.set('since', since);
    } else {
      params.set('days', days.toString());
      if (localMemoryIds.size > 0) {
        const recentIds = Array.from(localMemoryIds).slice(0, 100);
        params.set('exclude', recentIds.join(','));
      }
    }

    const response = await fetch(`${baseUrl}/api/profile-sync/memories?${params}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Cookie': `mh_session=${sessionId}`,
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        return { memories: [], hasMore: false, error: 'Authentication expired - please reconnect to server' };
      }
      return { memories: [], hasMore: false, error: `Server returned ${response.status}` };
    }

    const data = await response.json();
    return {
      memories: data.memories || [],
      hasMore: data.hasMore || false,
    };
  } catch (e) {
    return {
      memories: [],
      hasMore: false,
      error: (e as Error).message,
    };
  }
}

async function pushMemoriesToServer(
  config: SyncConfig,
  memories: MemoryFile[]
): Promise<{ pushed: number; errors: string[] }> {
  const { serverUrl, sessionId } = config;
  const baseUrl = serverUrl.replace(/\/$/, '');
  let pushed = 0;
  const errors: string[] = [];

  for (const memory of memories) {
    try {
      const response = await fetch(`${baseUrl}/api/profile-sync/memory`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': `mh_session=${sessionId}`,
        },
        body: JSON.stringify(memory.content),
      });

      if (response.ok || response.status === 409) {
        pushed++;
      } else {
        errors.push(`Failed to push ${memory.id}: ${response.status}`);
      }
    } catch (e) {
      errors.push(`Failed to push ${memory.id}: ${(e as Error).message}`);
    }
  }

  return { pushed, errors };
}

function updateMemorySyncTimestamp(username: string, timestamp: string): void {
  try {
    const profilePaths = getProfilePaths(username);
    const syncServerPath = path.join(profilePaths.etc, 'sync-server.json');

    let data: Record<string, any> = {};
    if (fs.existsSync(syncServerPath)) {
      data = JSON.parse(fs.readFileSync(syncServerPath, 'utf-8'));
    }

    data.lastMemorySyncAt = timestamp;
    fs.mkdirSync(path.dirname(syncServerPath), { recursive: true });
    fs.writeFileSync(syncServerPath, JSON.stringify(data, null, 2), 'utf-8');
  } catch {
    // Ignore errors
  }
}

// ─────────────────────────────────────────────────────────────
// Core Sync Logic
// ─────────────────────────────────────────────────────────────

/**
 * Sync memories for a single user
 */
export async function syncUserMemories(
  username: string,
  options: { pullOnly?: boolean; pushOnly?: boolean; days?: number } = {}
): Promise<SyncResult> {
  const result: SyncResult = { pulled: 0, pushed: 0, conflicts: 0, errors: [] };

  const config = loadSyncConfig(username);
  if (!config) {
    result.errors.push('No remote server configured');
    console.log(`[memory-sync] No remote server configured for ${username}`);
    return result;
  }

  console.log(`[memory-sync] Syncing user: ${username}`);
  console.log(`[memory-sync] Server: ${config.serverUrl}`);

  const lastMemorySync = config.lastMemorySyncAt;
  let localMemories: MemoryFile[] = [];
  let localMemoryIds = new Set<string>();

  if (!lastMemorySync) {
    localMemories = getLocalMemories(username);
    localMemoryIds = new Set(localMemories.map(m => m.id));
    console.log(`[memory-sync] First sync - ${localMemories.length} local memories`);
  } else {
    console.log(`[memory-sync] Incremental sync (since ${new Date(lastMemorySync).toLocaleDateString()})`);
    localMemories = getLocalMemories(username);
  }

  const syncStartTime = new Date().toISOString();

  // Pull from server
  if (!options.pushOnly) {
    console.log('[memory-sync] Pulling from server...');
    const pullResult = await pullMemoriesFromServer(config, localMemoryIds, {
      days: options.days || 30,
      limit: 500,
      since: lastMemorySync,
    });

    if (pullResult.error) {
      result.errors.push(`Pull failed: ${pullResult.error}`);
      console.log(`[memory-sync] Pull failed: ${pullResult.error}`);
    } else {
      for (const memory of pullResult.memories) {
        const memId = memory.id;
        if (localMemoryIds.has(memId)) {
          result.conflicts++;
          continue;
        }
        try {
          saveMemoryLocal(username, memory);
          result.pulled++;
        } catch (e) {
          result.errors.push(`Failed to save ${memId}: ${(e as Error).message}`);
        }
      }
      console.log(`[memory-sync] Pulled ${result.pulled} memories`);
      updateMemorySyncTimestamp(username, syncStartTime);
    }
  }

  // Push to server
  if (!options.pullOnly) {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const memoriesToPush = localMemories.filter(m => {
      const memDate = new Date(m.timestamp);
      return memDate > sevenDaysAgo;
    });

    if (memoriesToPush.length > 0) {
      console.log(`[memory-sync] Pushing ${memoriesToPush.length} recent memories...`);
      const pushResult = await pushMemoriesToServer(config, memoriesToPush);
      result.pushed = pushResult.pushed;
      result.errors.push(...pushResult.errors);
      console.log(`[memory-sync] Pushed ${result.pushed} memories`);
    }
  }

  return result;
}

/**
 * Run memory sync for all users or a specific user
 */
export async function runMemorySync(options: MemorySyncOptions = {}): Promise<{
  totalPulled: number;
  totalPushed: number;
  totalConflicts: number;
  errors: string[];
}> {
  let totalPulled = 0;
  let totalPushed = 0;
  let totalConflicts = 0;
  const allErrors: string[] = [];

  if (options.username) {
    const result = await withUserContext(
      { userId: options.username, username: options.username, role: 'owner' },
      async () => syncUserMemories(options.username!, options)
    );
    totalPulled = result.pulled;
    totalPushed = result.pushed;
    totalConflicts = result.conflicts;
    allErrors.push(...result.errors);
  } else {
    const users = getLoggedInUsers();
    console.log(`[memory-sync] Found ${users.length} logged-in users to sync`);

    for (const user of users) {
      try {
        const result = await withUserContext(
          { userId: user.userId, username: user.username, role: user.role },
          async () => syncUserMemories(user.username, options)
        );

        totalPulled += result.pulled;
        totalPushed += result.pushed;
        totalConflicts += result.conflicts;
        allErrors.push(...result.errors);
      } catch (e) {
        console.error(`[memory-sync] Failed to sync ${user.username}:`, e);
        allErrors.push(`User ${user.username}: ${(e as Error).message}`);
      }
    }
  }

  return { totalPulled, totalPushed, totalConflicts, errors: allErrors };
}

// ─────────────────────────────────────────────────────────────
// Agent Runtime Entry Point
// ─────────────────────────────────────────────────────────────

/**
 * Agent runtime entry point for mobile/runtime execution
 */
export async function run(ctx: AgentContext, input: AgentInput): Promise<AgentResult> {
  const startTime = Date.now();
  const args = input.args || [];
  const opts = input.options || {};

  const options: MemorySyncOptions = {
    pullOnly: args.includes('--pull-only') || opts.pullOnly === true,
    pushOnly: args.includes('--push-only') || opts.pushOnly === true,
    username: args.find(a => a.startsWith('--user='))?.split('=')[1] || opts.username as string,
  };

  audit({
    level: 'info',
    category: 'action',
    event: 'agent_cycle_started',
    details: { agent: 'memory-sync', ...options },
    actor: 'agent',
  });

  try {
    const result = await runMemorySync(options);

    audit({
      level: 'info',
      category: 'action',
      event: 'agent_cycle_completed',
      details: {
        agent: 'memory-sync',
        pulled: result.totalPulled,
        pushed: result.totalPushed,
        conflicts: result.totalConflicts,
        errors: result.errors.length,
      },
      actor: 'agent',
    });

    auditAction({
      skill: 'memory-sync',
      inputs: options,
      success: result.errors.length === 0,
      output: result,
      error: result.errors.length > 0 ? result.errors.join('; ') : undefined,
    });

    return {
      success: result.errors.length === 0,
      data: result,
      errors: result.errors.length > 0 ? result.errors : undefined,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    audit({
      level: 'error',
      category: 'action',
      event: 'agent_cycle_failed',
      details: { agent: 'memory-sync', error: (error as Error).message },
      actor: 'agent',
    });

    return {
      success: false,
      error: (error as Error).message,
      durationMs: Date.now() - startTime,
    };
  }
}
