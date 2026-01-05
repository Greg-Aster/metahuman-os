/**
 * Profile Sync Agent — Core Logic
 *
 * This module contains all the sync logic that can be used both:
 * - CLI: via cli.ts wrapper
 * - Mobile: imported directly and run in-process
 *
 * Handles:
 * - Authentication with remote server
 * - Profile bundle download (persona, config files, conversation buffer)
 * - Profile import to filesystem
 * - Credentials sync (RunPod, BigBrother, etc.)
 * - Memory sync (paginated, with incremental timestamp-based sync)
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  audit,
  auditAction,
  getProfilePaths,
  systemPaths,
} from '@metahuman/core';
import type { AgentContext, AgentInput, AgentResult } from '@metahuman/agent-runtime';

// ============================================================================
// Types
// ============================================================================

export interface SyncServerCredentials {
  serverUrl: string;
  username: string;
  password: string;
  sessionId?: string;
  lastSyncAt?: string;
  lastMemorySyncAt?: string;
}

export interface SyncProgress {
  phase: string;
  message: string;
  current?: number;
  total?: number;
}

export interface SyncResult {
  success: boolean;
  profileFiles: number;
  memoriesImported: number;
  credentialsSynced: boolean;
  errors: string[];
}

export interface SyncOptions {
  pullOnly?: boolean;
  memoriesOnly?: boolean;
  profileOnly?: boolean;
  days?: number;
  fullSync?: boolean;
  skipConfig?: boolean;
}

// ============================================================================
// Credential Loading
// ============================================================================

export function loadSyncCredentials(username: string): SyncServerCredentials | null {
  const profilePaths = getProfilePaths(username);
  const credPath = path.join(profilePaths.etc, 'sync-server.json');

  if (!fs.existsSync(credPath)) {
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

// ============================================================================
// Server Communication
// ============================================================================

/**
 * Parse and format error response for human-readable display
 * Handles HTML error pages (Cloudflare, nginx, etc.) by extracting key info
 */
function formatErrorResponse(status: number, text: string): string {
  // Check if it's an HTML error page
  if (text.includes('<!doctype html') || text.includes('<html')) {
    // Extract title if available
    const titleMatch = text.match(/<title>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : null;

    // Common Cloudflare tunnel errors
    if (text.includes('Cloudflare Tunnel error') || text.includes('cloudflared')) {
      return `Server unreachable (Cloudflare Tunnel error ${status}). The remote server may be offline.`;
    }

    // Generic Cloudflare errors
    if (text.includes('cloudflare') || text.includes('Cloudflare')) {
      return `Server unreachable (Cloudflare ${status}${title ? `: ${title}` : ''}). Check if the remote server is running.`;
    }

    // Nginx/Apache default error pages
    if (text.includes('nginx') || text.includes('Apache')) {
      return `Server error (${status}${title ? `: ${title}` : ''}). The remote server returned an error page.`;
    }

    // Generic HTML error page
    return `Server error (${status}${title ? `: ${title}` : ''}). Server may be offline or misconfigured.`;
  }

  // Non-HTML response - truncate if too long
  if (text.length > 200) {
    return `${text.substring(0, 200)}...`;
  }

  return text;
}

export async function authenticateWithServer(
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
      const formattedError = formatErrorResponse(response.status, text);
      return { success: false, error: formattedError };
    }

    const data = await response.json();

    if (!data.success) {
      return { success: false, error: data.error || 'Authentication failed' };
    }

    const sessionId = data.sessionId || data.session;
    if (!sessionId) {
      return { success: false, error: 'No session ID returned from server' };
    }

    return { success: true, sessionId };
  } catch (error) {
    const errMsg = (error as Error).message;
    // Make common network errors more friendly
    if (errMsg.includes('ECONNREFUSED')) {
      return { success: false, error: 'Connection refused. Server may be offline.' };
    }
    if (errMsg.includes('ETIMEDOUT') || errMsg.includes('timeout')) {
      return { success: false, error: 'Connection timed out. Server may be unreachable.' };
    }
    if (errMsg.includes('ENOTFOUND')) {
      return { success: false, error: 'Server not found. Check the server URL.' };
    }
    return { success: false, error: errMsg };
  }
}

export async function fetchProfileBundle(
  serverUrl: string,
  sessionId: string,
  username: string,
  password: string,
  priorityOnly: boolean = true
): Promise<{ success: boolean; bundle?: any; error?: string }> {
  const baseUrl = serverUrl.replace(/\/$/, '');
  const endpoint = priorityOnly ? '/api/profile-sync/export-priority' : '/api/profile-sync/export';

  try {
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

export async function fetchCredentials(
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

export async function fetchMemories(
  serverUrl: string,
  sessionId: string,
  username: string,
  password: string,
  options: { offset: number; limit: number; days?: number; since?: string; exclude?: string[] }
): Promise<{ success: boolean; memories?: any[]; hasMore?: boolean; total?: number; error?: string }> {
  const baseUrl = serverUrl.replace(/\/$/, '');

  try {
    const body: Record<string, any> = {
      username,
      password,
      offset: options.offset,
      limit: options.limit,
    };

    if (options.since) {
      body.since = options.since;
    } else if (options.days) {
      body.days = options.days;
    }

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

// ============================================================================
// Local Filesystem Operations
// ============================================================================

export function importProfileBundle(
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
      if (options.skipConfig && file.path.startsWith('etc/')) {
        skipped++;
        continue;
      }

      const targetPath = path.join(profilePaths.root, file.path);
      const targetDir = path.dirname(targetPath);

      fs.mkdirSync(targetDir, { recursive: true });

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

export function saveCredentials(username: string, credentials: any): void {
  const profilePaths = getProfilePaths(username);

  if (credentials.runpod) {
    const runpodPath = path.join(profilePaths.etc, 'runpod.json');
    fs.mkdirSync(path.dirname(runpodPath), { recursive: true });
    fs.writeFileSync(runpodPath, JSON.stringify(credentials.runpod, null, 2), 'utf-8');
  }

  const credsPath = path.join(profilePaths.etc, 'llm-credentials.json');
  fs.writeFileSync(credsPath, JSON.stringify(credentials, null, 2), 'utf-8');
}

export function getLocalMemoryIds(username: string): string[] {
  const profilePaths = getProfilePaths(username);
  const episodicDir = profilePaths.episodic;
  const ids: string[] = [];

  if (!fs.existsSync(episodicDir)) {
    return ids;
  }

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

export function saveMemory(username: string, memory: any): boolean {
  const profilePaths = getProfilePaths(username);
  const id = memory.id;

  if (!id) {
    return false;
  }

  const year = id.slice(0, 4);
  const yearDir = path.join(profilePaths.episodic, year);

  fs.mkdirSync(yearDir, { recursive: true });

  const filePath = path.join(yearDir, `${id}.json`);

  if (fs.existsSync(filePath)) {
    return false;
  }

  fs.writeFileSync(filePath, JSON.stringify(memory, null, 2), 'utf-8');
  return true;
}

export function updateSyncTimestamp(username: string, memorySyncTime?: string): void {
  const profilePaths = getProfilePaths(username);
  const credPath = path.join(profilePaths.etc, 'sync-server.json');

  if (!fs.existsSync(credPath)) {
    return;
  }

  try {
    const creds = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
    creds.lastSyncAt = new Date().toISOString();

    if (memorySyncTime) {
      creds.lastMemorySyncAt = memorySyncTime;
    }

    fs.writeFileSync(credPath, JSON.stringify(creds, null, 2), 'utf-8');
  } catch {
    // Ignore errors
  }
}

export function saveSyncState(state: any): void {
  const statePath = path.join(systemPaths.root, 'logs', 'run', 'profile-sync-state.json');
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
}

// ============================================================================
// Logging Helpers
// ============================================================================

export function printHeader(text: string): void {
  const line = '═'.repeat(60);
  console.log(`\n${line}`);
  console.log(`  ${text}`);
  console.log(`${line}`);
}

export function printSection(text: string): void {
  console.log(`\n┌─ ${text}`);
}

export function printStatus(icon: string, text: string): void {
  console.log(`│  ${icon} ${text}`);
}

export function printComplete(text: string): void {
  console.log(`└─ ✓ ${text}\n`);
}

// ============================================================================
// Main Sync Logic
// ============================================================================

/**
 * Sync profile for a single user
 * This is the core function that both CLI and mobile use
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
      true
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

    const lastMemorySync = options.fullSync ? undefined : creds.lastMemorySyncAt;
    let localIds: string[] = [];

    if (options.fullSync) {
      localIds = getLocalMemoryIds(username);
      printStatus('🔄', `Full sync requested - ${localIds.length} local memories to check`);
    } else if (lastMemorySync) {
      printStatus('⚡', `Incremental sync (since ${new Date(lastMemorySync).toLocaleDateString()})`);
    } else {
      localIds = getLocalMemoryIds(username);
      printStatus('📊', `First sync - ${localIds.length} local memories to check`);
    }

    let offset = 0;
    let hasMore = true;
    let totalImported = 0;
    let batchCount = 0;

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
          since: lastMemorySync,
          exclude: lastMemorySync ? undefined : localIds,
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

  updateSyncTimestamp(username, memorySyncTime);

  result.success = result.errors.length === 0;
  printComplete(`User ${username} sync complete`);
  onProgress?.({ phase: 'complete', message: 'Sync complete!' });

  return result;
}

// ============================================================================
// Agent Runtime Interface
// ============================================================================

/**
 * Run function for agent-runtime
 * Converts AgentContext/AgentInput to our internal format
 */
export async function run(ctx: AgentContext, input: AgentInput): Promise<AgentResult> {
  const startTime = Date.now();
  const args = input.args || [];
  const opts = input.options || {};

  // Parse options from args or options object
  const options: SyncOptions = {
    pullOnly: args.includes('--pull-only') || opts.pullOnly === true,
    memoriesOnly: args.includes('--memories-only') || opts.memoriesOnly === true,
    profileOnly: args.includes('--profile-only') || opts.profileOnly === true,
    fullSync: args.includes('--full') || opts.fullSync === true,
    skipConfig: args.includes('--skip-config') || opts.skipConfig === true,
    days: opts.days as number | undefined,
  };

  // Parse days from args if not in options
  if (!options.days) {
    const daysArg = args.find(a => a.startsWith('--days='));
    if (daysArg) {
      options.days = parseInt(daysArg.split('=')[1], 10);
    }
  }

  // Progress callback
  const onProgress = (progress: SyncProgress) => {
    saveSyncState({
      phase: progress.phase,
      message: progress.message,
      current: progress.current,
      total: progress.total,
      updatedAt: new Date().toISOString(),
    });
    ctx.log?.(`[${progress.phase}] ${progress.message}`, 'info');
  };

  try {
    printHeader('PROFILE SYNC AGENT');
    console.log(`  Started: ${new Date().toISOString()}`);
    console.log(`  User: ${ctx.username}`);

    audit({
      level: 'info',
      category: 'action',
      event: 'agent_cycle_started',
      details: { agent: 'profile-sync', ...options, username: ctx.username },
      actor: 'agent',
    });

    const result = await syncUserProfile(ctx.username, options, onProgress);

    saveSyncState({
      phase: 'complete',
      message: `Sync complete: ${result.profileFiles} profile files, ${result.memoriesImported} memories`,
      profileFiles: result.profileFiles,
      memoriesImported: result.memoriesImported,
      credentialsSynced: result.credentialsSynced,
      errors: result.errors,
      completedAt: new Date().toISOString(),
    });

    printHeader('SYNC COMPLETE');
    console.log(`  📄 Profile files: ${result.profileFiles}`);
    console.log(`  🧠 Memories imported: ${result.memoriesImported}`);
    console.log(`  🔐 Credentials: ${result.credentialsSynced ? 'synced' : 'skipped'}`);

    audit({
      level: 'info',
      category: 'action',
      event: 'agent_cycle_completed',
      details: {
        agent: 'profile-sync',
        profileFiles: result.profileFiles,
        memoriesImported: result.memoriesImported,
        credentialsSynced: result.credentialsSynced,
        errors: result.errors.length,
      },
      actor: 'agent',
    });

    auditAction({
      skill: 'profile-sync',
      inputs: options,
      success: result.success,
      output: {
        profileFiles: result.profileFiles,
        memoriesImported: result.memoriesImported,
        credentialsSynced: result.credentialsSynced,
      },
      error: result.errors.length > 0 ? result.errors.join('; ') : undefined,
    });

    return {
      success: result.success,
      data: result,
      duration: Date.now() - startTime,
      itemsProcessed: result.profileFiles + result.memoriesImported,
    };
  } catch (error) {
    const errorMessage = (error as Error).message;

    saveSyncState({
      phase: 'error',
      message: errorMessage,
      error: errorMessage,
      completedAt: new Date().toISOString(),
    });

    audit({
      level: 'error',
      category: 'action',
      event: 'agent_cycle_failed',
      details: { agent: 'profile-sync', error: errorMessage },
      actor: 'agent',
    });

    return {
      success: false,
      error: errorMessage,
      duration: Date.now() - startTime,
    };
  }
}
