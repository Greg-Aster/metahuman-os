#!/usr/bin/env node
/**
 * Memory Sync Agent — Background sync of memories with remote server
 *
 * Runs as a background agent to:
 * - Pull new memories from remote server
 * - Push local memories to remote server
 * - Handle conflicts gracefully (local-first - local wins)
 *
 * Triggered by:
 * - Manual trigger via UI
 * - Login event (pull-only)
 * - Scheduled interval
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  audit,
  auditAction,
  acquireLock,
  isLocked,
  listUsers,
  withUserContext,
  initGlobalLogger,
  getProfilePaths,
} from '@metahuman/core';
import { loadUserCredentials } from '@metahuman/core/llm-config';

interface SyncConfig {
  serverUrl: string;
  sessionId: string;
  username?: string;
  lastMemorySyncAt?: string;  // For incremental sync
}

interface MemoryFile {
  id: string;
  path: string;
  content: any;
  timestamp: string;
}

interface SyncResult {
  pulled: number;
  pushed: number;
  conflicts: number;
  errors: string[];
}

/**
 * Load sync configuration from user's profile
 */
function loadSyncConfig(username: string): SyncConfig | null {
  const creds = loadUserCredentials(username);

  if (!creds?.server?.serverUrl || !creds?.server?.sessionId) {
    return null;
  }

  // Also load lastMemorySyncAt from sync-server.json for incremental sync
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

/**
 * Get local memories from user's profile
 */
function getLocalMemories(username: string): MemoryFile[] {
  const profilePaths = getProfilePaths(username);
  const episodicDir = profilePaths.episodic;
  const memories: MemoryFile[] = [];

  if (!fs.existsSync(episodicDir)) {
    return memories;
  }

  // Walk year directories
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

/**
 * Save a memory to local storage
 */
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

/**
 * Fetch memories from remote server
 *
 * Uses timestamp-based incremental sync:
 * - If `since` is provided, only fetches memories created after that timestamp
 * - This is MUCH faster than sending exclusion lists
 */
async function pullMemoriesFromServer(
  config: SyncConfig,
  localMemoryIds: Set<string>,
  options: { days?: number; limit?: number; since?: string } = {}
): Promise<{ memories: any[]; hasMore: boolean; error?: string }> {
  const { serverUrl, sessionId } = config;
  const baseUrl = serverUrl.replace(/\/$/, '');
  const { days = 30, limit = 100, since } = options;

  try {
    // Build query params - prefer timestamp-based sync
    const params = new URLSearchParams({
      limit: limit.toString(),
    });

    if (since) {
      // Use timestamp-based sync - skip ALL memories before this time
      params.set('since', since);
    } else {
      // Fall back to days-based filter
      params.set('days', days.toString());

      // Only send exclusion list if no timestamp (first sync)
      // Limit to 100 IDs to keep request small
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

/**
 * Push memories to remote server
 */
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

      if (response.ok) {
        pushed++;
      } else if (response.status === 409) {
        // Conflict - memory already exists, treat as success
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

/**
 * Update the lastMemorySyncAt timestamp
 */
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

/**
 * Sync memories for a single user
 */
async function syncUserMemories(
  username: string,
  options: { pullOnly?: boolean; pushOnly?: boolean; days?: number } = {}
): Promise<SyncResult> {
  const result: SyncResult = { pulled: 0, pushed: 0, conflicts: 0, errors: [] };

  // Load sync config
  const config = loadSyncConfig(username);
  if (!config) {
    result.errors.push('No remote server configured');
    printStatus('⚠️', `No remote server configured for ${username}`);
    return result;
  }

  console.log(`\n  👤 User: ${username}`);
  printStatus('🌐', `Server: ${config.serverUrl}`);

  // Get local memories (only needed if no timestamp for incremental sync)
  const lastMemorySync = config.lastMemorySyncAt;
  let localMemories: MemoryFile[] = [];
  let localMemoryIds = new Set<string>();

  if (!lastMemorySync) {
    // First sync - need to get local IDs to avoid duplicates
    localMemories = getLocalMemories(username);
    localMemoryIds = new Set(localMemories.map(m => m.id));
    printStatus('📊', `First sync - ${localMemories.length} local memories to check`);
  } else {
    printStatus('⚡', `Incremental sync (since ${new Date(lastMemorySync).toLocaleDateString()})`);
    // Still need local memories for push
    localMemories = getLocalMemories(username);
  }

  // Track sync start time for next incremental sync
  const syncStartTime = new Date().toISOString();

  // Pull from server (unless pushOnly)
  if (!options.pushOnly) {
    if (lastMemorySync) {
      printStatus('↓', 'Pulling new memories since last sync...');
    } else {
      printStatus('↓', `Pulling from server (last ${options.days || 30} days)...`);
    }

    const pullResult = await pullMemoriesFromServer(config, localMemoryIds, {
      days: options.days || 30,
      limit: 500,
      since: lastMemorySync,  // Use timestamp if available
    });

    if (pullResult.error) {
      result.errors.push(`Pull failed: ${pullResult.error}`);
      printStatus('❌', `Pull failed: ${pullResult.error}`);
    } else {
      if (pullResult.memories.length === 0) {
        printStatus('○', 'No new memories on server');
      } else {
        // Save new memories locally
        for (const memory of pullResult.memories) {
          const memId = memory.id;

          // Skip if we already have it (shouldn't happen with incremental sync)
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

        printStatus('✓', `Pulled ${result.pulled} new memories`);
        if (result.conflicts > 0) {
          printStatus('○', `Skipped ${result.conflicts} existing memories`);
        }
      }

      // Update sync timestamp on successful pull
      updateMemorySyncTimestamp(username, syncStartTime);
    }
  } else {
    printStatus('○', 'Skipping pull (--push-only)');
  }

  // Push to server (unless pullOnly)
  if (!options.pullOnly) {
    // Find memories to push (local memories not yet on server)
    // For now, we push all local memories created in the last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const memoriesToPush = localMemories.filter(m => {
      const memDate = new Date(m.timestamp);
      return memDate > sevenDaysAgo;
    });

    if (memoriesToPush.length > 0) {
      printStatus('↑', `Pushing ${memoriesToPush.length} recent memories...`);
      const pushResult = await pushMemoriesToServer(config, memoriesToPush);
      result.pushed = pushResult.pushed;
      result.errors.push(...pushResult.errors);

      printStatus('✓', `Pushed ${result.pushed} memories`);
    } else {
      printStatus('○', 'No recent memories to push');
    }
  } else {
    printStatus('○', 'Skipping push (--pull-only)');
  }

  return result;
}

/**
 * Print a formatted header
 */
function printHeader(text: string): void {
  const line = '═'.repeat(50);
  console.log(`\n${line}`);
  console.log(`  ${text}`);
  console.log(`${line}`);
}

/**
 * Print a status line
 */
function printStatus(icon: string, text: string): void {
  console.log(`  ${icon} ${text}`);
}

/**
 * Main agent entry point
 */
async function main() {
  initGlobalLogger('memory-sync');

  // Parse command line args
  const args = process.argv.slice(2);
  const pullOnly = args.includes('--pull-only');
  const pushOnly = args.includes('--push-only');
  const singleUser = args.find(a => a.startsWith('--user='))?.split('=')[1];

  // Single-instance guard
  let lock;
  try {
    if (isLocked('agent-memory-sync')) {
      console.log('[memory-sync] ⚠️  Another instance is already running. Exiting.');
      return;
    }
    lock = acquireLock('agent-memory-sync');
  } catch {
    console.log('[memory-sync] ⚠️  Failed to acquire lock. Exiting.');
    return;
  }

  try {
    printHeader('MEMORY SYNC AGENT');
    console.log(`  Started: ${new Date().toISOString()}`);
    console.log(`  Mode: ${pullOnly ? 'pull-only' : pushOnly ? 'push-only' : 'full sync'}`);
    if (singleUser) console.log(`  User: ${singleUser}`);

    // Audit cycle start
    audit({
      level: 'info',
      category: 'action',
      event: 'agent_cycle_started',
      details: { agent: 'memory-sync', pullOnly, pushOnly, singleUser },
      actor: 'agent',
    });

    let totalPulled = 0;
    let totalPushed = 0;
    let totalConflicts = 0;
    const allErrors: string[] = [];

    if (singleUser) {
      // Sync single user
      const result = await withUserContext(
        { userId: singleUser, username: singleUser, role: 'owner' },
        async () => syncUserMemories(singleUser, { pullOnly, pushOnly })
      );
      totalPulled = result.pulled;
      totalPushed = result.pushed;
      totalConflicts = result.conflicts;
      allErrors.push(...result.errors);
    } else {
      // Sync all users
      const users = listUsers();
      console.log(`[memory-sync] Found ${users.length} users to sync`);

      for (const user of users) {
        try {
          const result = await withUserContext(
            { userId: user.id, username: user.username, role: user.role },
            async () => syncUserMemories(user.username, { pullOnly, pushOnly })
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

    // Print final summary
    printHeader('SYNC COMPLETE');
    printStatus('↓', `Pulled: ${totalPulled} memories`);
    printStatus('↑', `Pushed: ${totalPushed} memories`);
    if (totalConflicts > 0) {
      printStatus('⚡', `Conflicts: ${totalConflicts} (skipped)`);
    }
    console.log(`  ⏱️  Finished: ${new Date().toISOString()}`);

    if (allErrors.length > 0) {
      console.log(`\n  ⚠️  Errors (${allErrors.length}):`);
      for (const err of allErrors) {
        console.log(`     - ${err}`);
      }
    } else {
      console.log(`\n  ✓ No errors`);
    }
    console.log('');

    // Audit completion
    audit({
      level: 'info',
      category: 'action',
      event: 'agent_cycle_completed',
      details: {
        agent: 'memory-sync',
        pulled: totalPulled,
        pushed: totalPushed,
        conflicts: totalConflicts,
        errors: allErrors.length,
      },
      actor: 'agent',
    });

    auditAction({
      skill: 'memory-sync',
      inputs: { pullOnly, pushOnly },
      success: allErrors.length === 0,
      output: { pulled: totalPulled, pushed: totalPushed, conflicts: totalConflicts },
      error: allErrors.length > 0 ? allErrors.join('; ') : undefined,
    });

  } catch (error) {
    console.error('[memory-sync] Error during sync:', (error as Error).message);
    audit({
      level: 'error',
      category: 'action',
      event: 'agent_cycle_failed',
      details: { agent: 'memory-sync', error: (error as Error).message },
      actor: 'agent',
    });
  } finally {
    lock.release();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
