#!/usr/bin/env node
/**
 * Profile Sync Agent — Full profile synchronization with remote server
 *
 * This agent FULLY REPLACES the client-side syncFromRemoteServer function.
 * It handles:
 * - Authentication with remote server
 * - Profile bundle download (persona, config files, conversation buffer)
 * - Local user creation/authentication
 * - Profile import to filesystem
 * - Credentials sync (RunPod, BigBrother, etc.)
 * - Memory sync (paginated, with incremental timestamp-based sync)
 *
 * Triggered by:
 * - Manual trigger via UI (SyncManager)
 * - Login event (profile sync on login)
 * - Scheduled interval
 *
 * Command line args:
 *   --pull-only       Only download from server, don't push
 *   --memories-only   Only sync memories, skip profile
 *   --profile-only    Only sync profile, skip memories
 *   --full            Force complete memory sync (ignore lastMemorySyncAt)
 *   --skip-config     Skip etc/ directory (device-specific configs)
 *   --days=N          Only sync memories from last N days
 *   --user=<username> Sync single user (default: all users)
 *
 * Login sync uses: --pull-only --full --skip-config
 * This syncs persona, conversation buffer, and all memories without overwriting
 * device-specific configs like models.json, voice.json, etc.
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
  systemPaths,
} from '@metahuman/core';

interface SyncServerCredentials {
  serverUrl: string;
  username: string;
  password: string;
  sessionId?: string;
  lastSyncAt?: string;
  lastMemorySyncAt?: string;  // Timestamp of last memory sync - used for incremental sync
  verified?: boolean;
}

interface SyncProgress {
  phase: string;
  message: string;
  current?: number;
  total?: number;
}

interface SyncResult {
  success: boolean;
  profileFiles: number;
  memoriesImported: number;
  credentialsSynced: boolean;
  errors: string[];
}

interface SyncOptions {
  pullOnly?: boolean;
  memoriesOnly?: boolean;
  profileOnly?: boolean;
  days?: number;
  fullSync?: boolean;  // Ignore lastMemorySyncAt, do complete sync
  skipConfig?: boolean;  // Skip etc/ directory (device-specific configs)
}

/**
 * Load sync server credentials from user's profile
 */
function loadSyncCredentials(username: string): SyncServerCredentials | null {
  const profilePaths = getProfilePaths(username);
  const credPath = path.join(profilePaths.etc, 'sync-server.json');

  if (!fs.existsSync(credPath)) {
    // Try legacy location
    const legacyPath = path.join(profilePaths.etc, 'remote-server.json');
    if (fs.existsSync(legacyPath)) {
      try {
        return JSON.parse(fs.readFileSync(legacyPath, 'utf-8'));
      } catch {
        return null;
      }
    }
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(credPath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Authenticate with remote server
 */
async function authenticateWithServer(
  serverUrl: string,
  username: string,
  password: string
): Promise<{ success: boolean; sessionId?: string; error?: string }> {
  const baseUrl = serverUrl.replace(/\/$/, '');

  try {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: `Authentication failed: ${response.status} - ${text}` };
    }

    const data = await response.json();

    if (!data.success) {
      return { success: false, error: data.error || 'Authentication failed' };
    }

    // Get session from response
    const sessionId = data.sessionId || data.session;
    if (!sessionId) {
      return { success: false, error: 'No session ID returned from server' };
    }

    return { success: true, sessionId };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Fetch profile bundle from remote server
 */
async function fetchProfileBundle(
  serverUrl: string,
  sessionId: string,
  username: string,
  password: string,
  priorityOnly: boolean = true
): Promise<{ success: boolean; bundle?: any; error?: string }> {
  const baseUrl = serverUrl.replace(/\/$/, '');
  const endpoint = priorityOnly ? '/api/profile-sync/export-priority' : '/api/profile-sync/export';

  try {
    // Use POST with credentials in body (avoids cross-origin cookie issues)
    const response = priorityOnly
      ? await fetch(`${baseUrl}${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        })
      : await fetch(`${baseUrl}${endpoint}`, {
          method: 'GET',
          headers: { 'Cookie': `mh_session=${sessionId}` },
        });

    if (!response.ok) {
      return { success: false, error: `Failed to fetch profile: ${response.status}` };
    }

    const bundle = await response.json();
    return { success: true, bundle };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Import profile bundle to local filesystem
 *
 * @param skipConfig - If true, skip etc/ directory (device-specific configs)
 */
function importProfileBundle(
  username: string,
  bundle: any,
  options: { skipConfig?: boolean } = {}
): { imported: number; skipped: number; errors: string[] } {
  const profilePaths = getProfilePaths(username);
  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  if (!bundle.files || !Array.isArray(bundle.files)) {
    return { imported: 0, skipped: 0, errors: ['Invalid profile bundle'] };
  }

  for (const file of bundle.files) {
    try {
      // Skip etc/ if skipConfig is set (device-specific configs)
      if (options.skipConfig && file.path.startsWith('etc/')) {
        skipped++;
        continue;
      }

      const targetPath = path.join(profilePaths.root, file.path);
      const targetDir = path.dirname(targetPath);

      // Create directory if needed
      fs.mkdirSync(targetDir, { recursive: true });

      // Write file
      const content = typeof file.content === 'string'
        ? file.content
        : JSON.stringify(file.content, null, 2);

      fs.writeFileSync(targetPath, content, 'utf-8');
      imported++;
    } catch (e) {
      errors.push(`Failed to import ${file.path}: ${(e as Error).message}`);
    }
  }

  return { imported, skipped, errors };
}

/**
 * Fetch credentials from remote server
 */
async function fetchCredentials(
  serverUrl: string,
  sessionId: string
): Promise<{ success: boolean; credentials?: any; error?: string }> {
  const baseUrl = serverUrl.replace(/\/$/, '');

  try {
    const response = await fetch(`${baseUrl}/api/profile-sync/credentials`, {
      method: 'GET',
      headers: { 'Cookie': `mh_session=${sessionId}` },
    });

    if (response.status === 403) {
      // Non-owner, skip credentials
      return { success: true, credentials: undefined };
    }

    if (!response.ok) {
      return { success: false, error: `Failed to fetch credentials: ${response.status}` };
    }

    const data = await response.json();
    return { success: true, credentials: data.credentials };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Save credentials to local filesystem
 */
function saveCredentials(username: string, credentials: any): void {
  const profilePaths = getProfilePaths(username);

  // Save RunPod credentials
  if (credentials.runpod) {
    const runpodPath = path.join(profilePaths.etc, 'runpod.json');
    fs.mkdirSync(path.dirname(runpodPath), { recursive: true });
    fs.writeFileSync(runpodPath, JSON.stringify(credentials.runpod, null, 2), 'utf-8');
  }

  // Save full credentials file
  const credsPath = path.join(profilePaths.etc, 'llm-credentials.json');
  fs.writeFileSync(credsPath, JSON.stringify(credentials, null, 2), 'utf-8');
}

/**
 * Get list of local memory IDs
 */
function getLocalMemoryIds(username: string): string[] {
  const profilePaths = getProfilePaths(username);
  const episodicDir = profilePaths.episodic;
  const ids: string[] = [];

  if (!fs.existsSync(episodicDir)) {
    return ids;
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
      ids.push(file.replace('.json', ''));
    }
  }

  return ids;
}

/**
 * Fetch memories from remote server (paginated)
 *
 * Uses timestamp-based incremental sync:
 * - If `since` is provided, only fetches memories created after that timestamp
 * - This is MUCH faster than sending exclusion lists
 * - Falls back to exclusion list if `since` is not available
 */
async function fetchMemories(
  serverUrl: string,
  sessionId: string,
  username: string,
  password: string,
  options: { offset: number; limit: number; days?: number; since?: string; exclude?: string[] }
): Promise<{ success: boolean; memories?: any[]; hasMore?: boolean; total?: number; error?: string }> {
  const baseUrl = serverUrl.replace(/\/$/, '');

  try {
    // Prefer timestamp-based sync (much faster)
    const body: Record<string, any> = {
      username,
      password,
      offset: options.offset,
      limit: options.limit,
    };

    if (options.since) {
      // Use timestamp-based sync - skip ALL memories before this time
      body.since = options.since;
    } else if (options.days) {
      // Fall back to days-based filter
      body.days = options.days;
    }

    // Only send exclusion list if no timestamp (first sync or recovery)
    // Limit to 100 IDs to keep request small
    if (!options.since && options.exclude && options.exclude.length > 0) {
      body.exclude = options.exclude.slice(0, 100).join(',');
    }

    const response = await fetch(`${baseUrl}/api/profile-sync/memories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      return { success: false, error: `Failed to fetch memories: ${response.status}` };
    }

    const data = await response.json();
    return {
      success: true,
      memories: data.memories || [],
      hasMore: data.hasMore || false,
      total: data.total,
    };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Save a memory to local filesystem
 */
function saveMemory(username: string, memory: any): boolean {
  const profilePaths = getProfilePaths(username);
  const id = memory.id;

  if (!id) {
    return false;
  }

  const year = id.slice(0, 4);
  const yearDir = path.join(profilePaths.episodic, year);

  fs.mkdirSync(yearDir, { recursive: true });

  const filePath = path.join(yearDir, `${id}.json`);

  // Skip if already exists
  if (fs.existsSync(filePath)) {
    return false;
  }

  fs.writeFileSync(filePath, JSON.stringify(memory, null, 2), 'utf-8');
  return true;
}

/**
 * Update sync timestamps
 */
function updateSyncTimestamp(username: string, memorySyncTime?: string): void {
  const profilePaths = getProfilePaths(username);
  const credPath = path.join(profilePaths.etc, 'sync-server.json');

  if (!fs.existsSync(credPath)) {
    return;
  }

  try {
    const creds = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
    creds.lastSyncAt = new Date().toISOString();

    // Track memory sync time separately for incremental sync
    if (memorySyncTime) {
      creds.lastMemorySyncAt = memorySyncTime;
    }

    fs.writeFileSync(credPath, JSON.stringify(creds, null, 2), 'utf-8');
  } catch {
    // Ignore errors
  }
}

/**
 * Save sync result to state file for UI to read
 */
function saveSyncState(state: any): void {
  const statePath = path.join(systemPaths.root, 'logs', 'run', 'profile-sync-state.json');
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * Sync profile for a single user
 * Exported for use by mobile-agents.ts (in-process execution)
 */
export async function syncUserProfile(
  username: string,
  options: SyncOptions,
  onProgress?: (progress: SyncProgress) => void
): Promise<SyncResult> {
  const result: SyncResult = {
    success: false,
    profileFiles: 0,
    memoriesImported: 0,
    credentialsSynced: false,
    errors: [],
  };

  // Load credentials
  const creds = loadSyncCredentials(username);
  if (!creds) {
    result.errors.push('No sync server configured');
    console.log(`│  ⚠️  No sync server configured for ${username}`);
    return result;
  }

  printSection(`Syncing user: ${username}`);
  printStatus('🌐', `Server: ${creds.serverUrl}`);
  onProgress?.({ phase: 'authenticating', message: 'Connecting to server...' });

  // Phase 1: Authenticate
  printStatus('🔑', 'Authenticating...');
  const authResult = await authenticateWithServer(creds.serverUrl, creds.username, creds.password);
  if (!authResult.success || !authResult.sessionId) {
    result.errors.push(authResult.error || 'Authentication failed');
    printStatus('❌', `Authentication failed: ${authResult.error}`);
    onProgress?.({ phase: 'error', message: authResult.error || 'Authentication failed' });
    return result;
  }

  const sessionId = authResult.sessionId;
  printStatus('✓', 'Authenticated successfully');

  // Phase 2: Fetch and import profile (unless memories-only)
  if (!options.memoriesOnly) {
    printStatus('📦', 'Downloading profile bundle...');
    onProgress?.({ phase: 'fetching-profile', message: 'Downloading profile...' });

    const bundleResult = await fetchProfileBundle(
      creds.serverUrl,
      sessionId,
      creds.username,
      creds.password,
      true // priorityOnly
    );

    if (bundleResult.success && bundleResult.bundle) {
      onProgress?.({ phase: 'importing', message: 'Importing profile files...' });

      const importResult = importProfileBundle(username, bundleResult.bundle, {
        skipConfig: options.skipConfig,
      });
      result.profileFiles = importResult.imported;
      result.errors.push(...importResult.errors);

      printStatus('📄', `Imported ${importResult.imported} profile files`);
      if (importResult.skipped > 0) {
        printStatus('○', `Skipped ${importResult.skipped} config files (--skip-config)`);
      }
      if (importResult.errors.length > 0) {
        for (const err of importResult.errors) {
          printStatus('⚠️', err);
        }
      }
    } else if (bundleResult.error) {
      result.errors.push(bundleResult.error);
      printStatus('⚠️', `Profile fetch failed: ${bundleResult.error}`);
    }

    // Phase 3: Fetch and save credentials (skip if --skip-config)
    if (options.skipConfig) {
      printStatus('○', 'Skipping credentials (--skip-config)');
    } else {
      printStatus('🔐', 'Syncing credentials...');
      onProgress?.({ phase: 'fetching-credentials', message: 'Syncing credentials...' });

      const credsResult = await fetchCredentials(creds.serverUrl, sessionId);
      if (credsResult.success && credsResult.credentials) {
        saveCredentials(username, credsResult.credentials);
        result.credentialsSynced = true;
        printStatus('✓', 'Credentials synced (RunPod, LLM keys, etc.)');
      } else {
        printStatus('○', 'No credentials to sync (non-owner or none configured)');
      }
    }
  } else {
    printStatus('○', 'Skipping profile (--memories-only)');
  }

  // Phase 4: Fetch and import memories (unless profile-only)
  let memorySyncTime: string | undefined;

  if (!options.profileOnly) {
    printStatus('🧠', 'Syncing memories...');
    onProgress?.({ phase: 'importing', message: 'Syncing memories...' });

    // Use timestamp-based sync if we have a previous sync time
    // This is MUCH faster than sending exclusion lists
    // --full flag forces complete sync by ignoring the timestamp
    const lastMemorySync = options.fullSync ? undefined : creds.lastMemorySyncAt;
    let localIds: string[] = [];

    if (options.fullSync) {
      // Full sync requested - get local IDs to avoid duplicates
      localIds = getLocalMemoryIds(username);
      printStatus('🔄', `Full sync requested - ${localIds.length} local memories to check`);
    } else if (lastMemorySync) {
      printStatus('⚡', `Incremental sync (since ${new Date(lastMemorySync).toLocaleDateString()})`);
    } else {
      // First sync - need to get local IDs to avoid duplicates
      localIds = getLocalMemoryIds(username);
      printStatus('📊', `First sync - ${localIds.length} local memories to check`);
    }

    let offset = 0;
    let hasMore = true;
    let totalImported = 0;
    let batchCount = 0;

    // Track the sync start time for next incremental sync
    memorySyncTime = new Date().toISOString();

    while (hasMore) {
      batchCount++;
      const memResult = await fetchMemories(
        creds.serverUrl,
        sessionId,
        creds.username,
        creds.password,
        {
          offset,
          limit: 100,
          days: options.days,
          since: lastMemorySync,  // Use timestamp if available
          exclude: lastMemorySync ? undefined : localIds,  // Only use exclusion on first sync
        }
      );

      if (!memResult.success) {
        result.errors.push(memResult.error || 'Memory fetch failed');
        printStatus('❌', `Memory fetch failed: ${memResult.error}`);
        break;
      }

      if (memResult.memories && memResult.memories.length > 0) {
        const batchImported = memResult.memories.reduce((count, memory) => {
          return count + (saveMemory(username, memory) ? 1 : 0);
        }, 0);
        totalImported += batchImported;

        // Show progress every batch
        const totalAvailable = memResult.total || 'unknown';
        printStatus('↓', `Batch ${batchCount}: +${batchImported} memories (${totalImported} total, ${totalAvailable} on server)`);

        onProgress?.({
          phase: 'importing',
          message: `Imported ${totalImported} memories...`,
          current: totalImported,
          total: memResult.total,
        });
      } else if (batchCount === 1) {
        printStatus('○', 'No new memories on server');
      }

      hasMore = memResult.hasMore || false;
      offset += 100;
    }

    result.memoriesImported = totalImported;
    if (totalImported > 0) {
      printStatus('✓', `Imported ${totalImported} new memories`);
    }
  } else {
    printStatus('○', 'Skipping memories (--profile-only)');
  }

  // Update sync timestamp (including memory sync time for incremental sync)
  updateSyncTimestamp(username, memorySyncTime);

  result.success = result.errors.length === 0;
  printComplete(`User ${username} sync complete`);
  onProgress?.({ phase: 'complete', message: 'Sync complete!' });

  return result;
}

/**
 * Print a formatted header
 */
function printHeader(text: string): void {
  const line = '═'.repeat(60);
  console.log(`\n${line}`);
  console.log(`  ${text}`);
  console.log(`${line}`);
}

/**
 * Print a formatted section
 */
function printSection(text: string): void {
  console.log(`\n┌─ ${text}`);
}

/**
 * Print a status line
 */
function printStatus(icon: string, text: string): void {
  console.log(`│  ${icon} ${text}`);
}

/**
 * Print completion line
 */
function printComplete(text: string): void {
  console.log(`└─ ✓ ${text}\n`);
}

/**
 * Main agent entry point
 */
async function main() {
  initGlobalLogger('profile-sync');

  // Parse command line args
  const args = process.argv.slice(2);
  const pullOnly = args.includes('--pull-only');
  const memoriesOnly = args.includes('--memories-only');
  const profileOnly = args.includes('--profile-only');
  const fullSync = args.includes('--full');  // Ignore lastMemorySyncAt, do complete sync
  const skipConfig = args.includes('--skip-config');  // Skip etc/ (device-specific configs)
  const daysArg = args.find(a => a.startsWith('--days='));
  const days = daysArg ? parseInt(daysArg.split('=')[1], 10) : undefined;
  const singleUser = args.find(a => a.startsWith('--user='))?.split('=')[1];

  const options: SyncOptions = {
    pullOnly,
    memoriesOnly,
    profileOnly,
    days,
    fullSync,
    skipConfig,
  };

  // Single-instance guard
  let lock;
  try {
    if (isLocked('agent-profile-sync')) {
      console.log('[profile-sync] ⚠️  Another instance is already running. Exiting.');
      return;
    }
    lock = acquireLock('agent-profile-sync');
  } catch {
    console.log('[profile-sync] ⚠️  Failed to acquire lock. Exiting.');
    return;
  }

  try {
    printHeader('PROFILE SYNC AGENT');
    console.log(`  Started: ${new Date().toISOString()}`);
    console.log(`  Mode: ${pullOnly ? 'pull-only' : 'full sync'}`);
    if (memoriesOnly) console.log(`  Scope: memories only`);
    if (profileOnly) console.log(`  Scope: profile only`);
    if (fullSync) console.log(`  Memory sync: full (ignoring timestamp)`);
    if (skipConfig) console.log(`  Config: skipping (device-specific)`);
    if (days) console.log(`  Time range: last ${days} days`);
    if (singleUser) console.log(`  User: ${singleUser}`);

    // Audit cycle start
    audit({
      level: 'info',
      category: 'action',
      event: 'agent_cycle_started',
      details: { agent: 'profile-sync', ...options, singleUser },
      actor: 'agent',
    });

    let totalProfileFiles = 0;
    let totalMemories = 0;
    let totalCredentials = 0;
    const allErrors: string[] = [];

    // Progress callback for UI
    const onProgress = (progress: SyncProgress) => {
      // Save to state file for UI polling
      saveSyncState({
        phase: progress.phase,
        message: progress.message,
        current: progress.current,
        total: progress.total,
        updatedAt: new Date().toISOString(),
      });
    };

    if (singleUser) {
      // Sync single user
      const result = await withUserContext(
        { userId: singleUser, username: singleUser, role: 'owner' },
        async () => syncUserProfile(singleUser, options, onProgress)
      );
      totalProfileFiles = result.profileFiles;
      totalMemories = result.memoriesImported;
      totalCredentials = result.credentialsSynced ? 1 : 0;
      allErrors.push(...result.errors);
    } else {
      // Sync all users
      const users = listUsers();
      console.log(`[profile-sync] Found ${users.length} users to sync`);

      for (const user of users) {
        try {
          const result = await withUserContext(
            { userId: user.id, username: user.username, role: user.role },
            async () => syncUserProfile(user.username, options, onProgress)
          );

          totalProfileFiles += result.profileFiles;
          totalMemories += result.memoriesImported;
          totalCredentials += result.credentialsSynced ? 1 : 0;
          allErrors.push(...result.errors);
        } catch (e) {
          console.error(`[profile-sync] Failed to sync ${user.username}:`, e);
          allErrors.push(`User ${user.username}: ${(e as Error).message}`);
        }
      }
    }

    // Save final state
    saveSyncState({
      phase: 'complete',
      message: `Sync complete: ${totalProfileFiles} profile files, ${totalMemories} memories`,
      profileFiles: totalProfileFiles,
      memoriesImported: totalMemories,
      credentialsSynced: totalCredentials > 0,
      errors: allErrors,
      completedAt: new Date().toISOString(),
    });

    // Print final summary
    printHeader('SYNC COMPLETE');
    console.log(`  📄 Profile files: ${totalProfileFiles}`);
    console.log(`  🧠 Memories imported: ${totalMemories}`);
    console.log(`  🔐 Credentials: ${totalCredentials > 0 ? 'synced' : 'skipped'}`);
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
        agent: 'profile-sync',
        profileFiles: totalProfileFiles,
        memoriesImported: totalMemories,
        credentialsSynced: totalCredentials > 0,
        errors: allErrors.length,
      },
      actor: 'agent',
    });

    auditAction({
      skill: 'profile-sync',
      inputs: options,
      success: allErrors.length === 0,
      output: {
        profileFiles: totalProfileFiles,
        memoriesImported: totalMemories,
        credentialsSynced: totalCredentials > 0,
      },
      error: allErrors.length > 0 ? allErrors.join('; ') : undefined,
    });

  } catch (error) {
    console.error('[profile-sync] Error during sync:', (error as Error).message);

    saveSyncState({
      phase: 'error',
      message: (error as Error).message,
      error: (error as Error).message,
      completedAt: new Date().toISOString(),
    });

    audit({
      level: 'error',
      category: 'action',
      event: 'agent_cycle_failed',
      details: { agent: 'profile-sync', error: (error as Error).message },
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
