/**
 * Profile Sync
 *
 * Lightweight profile management for mobile independence:
 * - Download essential profile data (memories, tasks, persona configs)
 * - Excludes heavy data (training logs, LoRA adapters, voice training)
 * - Create new profiles locally without server
 * - Sync profile changes bidirectionally
 * - Export/import profiles for backup
 *
 * What gets synced:
 * - Persona configs (core, relationships, routines, decision-rules)
 * - Episodic memories (conversations, observations)
 * - Active tasks
 * - User settings
 *
 * What stays on server only:
 * - Training datasets and LoRA adapters
 * - Voice training data
 * - Audit logs
 * - Vector embeddings index
 */

import { apiFetch, getSyncServerUrl, remoteFetch, normalizeUrl } from './api-config';
import { healthStatus } from './server-health';
import {
  getDB,
  savePersona,
  getAllPersona,
  saveMemory,
  getRecentMemories,
  getUnsyncedMemories,
  markMemoriesSynced,
  importMemories,
  importPersona,
  setSetting,
  getSetting,
  getActiveTasks,
  saveTask,
  type LocalMemory,
  type LocalPersona,
  type LocalTask,
} from './local-memory';
import { get } from 'svelte/store';

export interface ProfileMetadata {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  source: 'local' | 'server' | 'imported';
  serverUrl?: string;
  version: number;
  memoryCount: number;
  personaKeys: string[];
}

export interface SyncableCredentials {
  runpod?: {
    apiKey: string | null;
    endpointId: string | null;  // The actual endpoint ID for API calls
    templateId: string | null;  // Template metadata (not used for API calls)
    gpuType: string | null;
  };
  bigBrother?: {
    enabled: boolean;
    provider: string;
    escalateOnStuck: boolean;
    escalateOnRepeatedFailures: boolean;
    maxRetries: number;
    includeFullScratchpad: boolean;
    autoApplySuggestions: boolean;
  };
  remote?: {
    provider: string;
    serverUrl: string;
    model: string;
  };
}

export interface ProfileData {
  metadata: ProfileMetadata;
  persona: Record<string, any>;
  memories: LocalMemory[];
  tasks: LocalTask[];
  settings: Record<string, any>;
  credentials?: SyncableCredentials;
}

export interface SyncStatus {
  lastSync: string | null;
  pendingUpload: number;
  pendingDownload: number;
  conflicts: number;
  syncing: boolean;
}

export interface DownloadProgress {
  phase: 'metadata' | 'persona' | 'memories' | 'tasks' | 'complete';
  current: number;
  total: number;
  message: string;
}

const PROFILE_KEY = 'activeProfile';
const PROFILES_KEY = 'profiles';
// CREDENTIALS_KEY removed - credentials now stored in filesystem via unified API, not IndexedDB

/**
 * Get list of all profiles stored locally
 */
export async function getLocalProfiles(): Promise<ProfileMetadata[]> {
  return getSetting<ProfileMetadata[]>(PROFILES_KEY, []);
}

/**
 * Get the active profile metadata
 */
export async function getActiveProfile(): Promise<ProfileMetadata | null> {
  const profileId = await getSetting<string | null>(PROFILE_KEY, null);
  if (!profileId) return null;

  const profiles = await getLocalProfiles();
  return profiles.find(p => p.id === profileId) || null;
}

/**
 * Set the active profile
 */
export async function setActiveProfile(profileId: string): Promise<void> {
  await setSetting(PROFILE_KEY, profileId);
}

/**
 * Create a new profile locally (no server required)
 */
export async function createLocalProfile(name: string, persona?: Record<string, any>): Promise<ProfileMetadata> {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  const metadata: ProfileMetadata = {
    id,
    name,
    createdAt: now,
    updatedAt: now,
    source: 'local',
    version: 1,
    memoryCount: 0,
    personaKeys: persona ? Object.keys(persona) : ['core'],
  };

  // Save default persona
  const defaultPersona = persona || {
    core: {
      name,
      traits: [],
      voice: 'neutral',
      values: [],
      summary: `${name}'s digital personality`,
    },
  };

  for (const [key, data] of Object.entries(defaultPersona)) {
    await savePersona(key, data);
  }

  // Add to profiles list
  const profiles = await getLocalProfiles();
  profiles.push(metadata);
  await setSetting(PROFILES_KEY, profiles);

  // Set as active
  await setActiveProfile(id);

  return metadata;
}

/**
 * Download a complete profile from server to device
 */
export async function downloadProfile(
  onProgress?: (progress: DownloadProgress) => void
): Promise<ProfileMetadata> {
  const health = get(healthStatus);
  if (!health.connected) {
    throw new Error('Server not connected. Cannot download profile.');
  }

  const progress = (phase: DownloadProgress['phase'], current: number, total: number, message: string) => {
    onProgress?.({ phase, current, total, message });
  };

  // Phase 1: Get profile metadata
  progress('metadata', 0, 1, 'Fetching profile info...');

  const metaResponse = await apiFetch('/api/profile-sync/metadata');
  if (!metaResponse.ok) {
    throw new Error('Failed to fetch profile metadata');
  }
  const serverMeta = await metaResponse.json();

  progress('metadata', 1, 1, 'Profile info received');

  // Phase 2: Download persona data
  progress('persona', 0, serverMeta.personaKeys?.length || 4, 'Downloading persona...');

  const personaKeys = serverMeta.personaKeys || ['core', 'relationships', 'routines', 'decision-rules'];
  let personaCount = 0;

  for (const key of personaKeys) {
    try {
      const response = await apiFetch(`/api/persona-${key}`);
      if (response.ok) {
        const data = await response.json();
        await savePersona(key, data);
      }
    } catch (e) {
      console.warn(`Failed to download persona ${key}:`, e);
    }
    personaCount++;
    progress('persona', personaCount, personaKeys.length, `Downloaded ${key}`);
  }

  // Phase 3: Download memories (paginated)
  progress('memories', 0, serverMeta.memoryCount || 100, 'Downloading memories...');

  const pageSize = 100;
  let offset = 0;
  let memoriesDownloaded = 0;
  const totalMemories = serverMeta.memoryCount || 0;

  while (offset < totalMemories) {
    try {
      const response = await apiFetch(`/api/profile-sync/memories?offset=${offset}&limit=${pageSize}`);
      if (response.ok) {
        const data = await response.json();
        if (data.memories && data.memories.length > 0) {
          await importMemories(data.memories);
          memoriesDownloaded += data.memories.length;
          progress('memories', memoriesDownloaded, totalMemories, `Downloaded ${memoriesDownloaded} memories`);
        }
        if (!data.hasMore) break;
      } else {
        break;
      }
    } catch (e) {
      console.warn('Failed to download memories batch:', e);
      break;
    }
    offset += pageSize;
  }

  // Phase 4: Download tasks
  progress('tasks', 0, 1, 'Downloading tasks...');

  try {
    const response = await apiFetch('/api/profile-sync/tasks');
    if (response.ok) {
      const data = await response.json();
      if (data.tasks) {
        for (const task of data.tasks) {
          await saveTask(task);
        }
      }
    }
  } catch (e) {
    console.warn('Failed to download tasks:', e);
  }

  progress('tasks', 1, 1, 'Tasks downloaded');

  // Create/update profile metadata
  const now = new Date().toISOString();
  const metadata: ProfileMetadata = {
    id: serverMeta.profileId || crypto.randomUUID(),
    name: serverMeta.name || 'Downloaded Profile',
    createdAt: serverMeta.createdAt || now,
    updatedAt: now,
    source: 'server',
    serverUrl: getSyncServerUrl(),
    version: serverMeta.version || 1,
    memoryCount: memoriesDownloaded,
    personaKeys,
  };

  // Save to profiles list
  const profiles = await getLocalProfiles();
  const existingIndex = profiles.findIndex(p => p.serverUrl === getSyncServerUrl());
  if (existingIndex >= 0) {
    profiles[existingIndex] = metadata;
  } else {
    profiles.push(metadata);
  }
  await setSetting(PROFILES_KEY, profiles);
  await setActiveProfile(metadata.id);

  // Record last sync
  await setSetting('lastProfileSync', now);

  progress('complete', 1, 1, 'Profile download complete');

  return metadata;
}

/**
 * Upload local changes to server
 */
export async function uploadChanges(): Promise<{ uploaded: number; errors: string[] }> {
  const health = get(healthStatus);
  if (!health.connected) {
    throw new Error('Server not connected. Cannot upload changes.');
  }

  const errors: string[] = [];
  let uploaded = 0;

  // Upload unsynced memories
  const unsyncedMemories = await getUnsyncedMemories();

  if (unsyncedMemories.length > 0) {
    try {
      const response = await apiFetch('/api/profile-sync/memories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memories: unsyncedMemories }),
      });

      if (response.ok) {
        const data = await response.json();
        const syncedIds = unsyncedMemories.map(m => m.id);
        await markMemoriesSynced(syncedIds, new Date().toISOString());
        uploaded += syncedIds.length;
      } else {
        errors.push(`Failed to upload memories: ${response.status}`);
      }
    } catch (e) {
      errors.push(`Memory upload error: ${e instanceof Error ? e.message : 'Unknown'}`);
    }
  }

  // Upload persona changes
  const personaData = await getAllPersona();
  for (const item of personaData) {
    if (!item.syncedAt || (item.localModifiedAt && item.localModifiedAt > item.syncedAt)) {
      try {
        const response = await apiFetch(`/api/persona-${item.key}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item.data),
        });

        if (response.ok) {
          await importPersona(item.key, item.data, new Date().toISOString());
          uploaded++;
        } else {
          errors.push(`Failed to upload persona ${item.key}`);
        }
      } catch (e) {
        errors.push(`Persona upload error (${item.key}): ${e instanceof Error ? e.message : 'Unknown'}`);
      }
    }
  }

  // Update last sync
  await setSetting('lastProfileSync', new Date().toISOString());

  // Update profile metadata
  const profile = await getActiveProfile();
  if (profile) {
    profile.updatedAt = new Date().toISOString();
    const profiles = await getLocalProfiles();
    const index = profiles.findIndex(p => p.id === profile.id);
    if (index >= 0) {
      profiles[index] = profile;
      await setSetting(PROFILES_KEY, profiles);
    }
  }

  return { uploaded, errors };
}

/**
 * Full bidirectional sync
 */
export async function syncProfile(): Promise<{
  uploaded: number;
  downloaded: number;
  errors: string[];
}> {
  const health = get(healthStatus);
  if (!health.connected) {
    return { uploaded: 0, downloaded: 0, errors: ['Server not connected'] };
  }

  const errors: string[] = [];
  let uploaded = 0;
  let downloaded = 0;

  // First upload local changes
  const uploadResult = await uploadChanges();
  uploaded = uploadResult.uploaded;
  errors.push(...uploadResult.errors);

  // Then pull new server changes
  const lastSync = await getSetting<string | null>('lastProfileSync', null);

  try {
    const response = await apiFetch(`/api/profile-sync/changes?since=${lastSync || ''}`);
    if (response.ok) {
      const data = await response.json();

      // Import new memories from server
      if (data.memories && data.memories.length > 0) {
        await importMemories(data.memories);
        downloaded += data.memories.length;
      }

      // Import persona updates
      if (data.persona) {
        for (const [key, value] of Object.entries(data.persona)) {
          await importPersona(key, value as Record<string, any>, new Date().toISOString());
          downloaded++;
        }
      }
    }
  } catch (e) {
    errors.push(`Sync pull error: ${e instanceof Error ? e.message : 'Unknown'}`);
  }

  await setSetting('lastProfileSync', new Date().toISOString());

  return { uploaded, downloaded, errors };
}

/**
 * Get current sync status
 */
export async function getSyncStatus(): Promise<SyncStatus> {
  const lastSync = await getSetting<string | null>('lastProfileSync', null);
  const unsyncedMemories = await getUnsyncedMemories();
  const personaData = await getAllPersona();

  const pendingPersona = personaData.filter(
    p => !p.syncedAt || (p.localModifiedAt && p.localModifiedAt > p.syncedAt)
  ).length;

  return {
    lastSync,
    pendingUpload: unsyncedMemories.length + pendingPersona,
    pendingDownload: 0, // Would need server query to know this
    conflicts: 0,
    syncing: false,
  };
}

/**
 * Export profile as JSON (for backup/transfer)
 */
export async function exportProfile(): Promise<ProfileData> {
  const profile = await getActiveProfile();
  if (!profile) {
    throw new Error('No active profile');
  }

  const personaData = await getAllPersona();
  const persona: Record<string, any> = {};
  for (const item of personaData) {
    persona[item.key] = item.data;
  }

  const memories = await getRecentMemories(10000); // Get all recent
  const tasks = await getActiveTasks();

  return {
    metadata: profile,
    persona,
    memories,
    tasks,
    settings: {},
  };
}

/**
 * Import profile from JSON (restore backup)
 */
export async function importProfile(data: ProfileData): Promise<ProfileMetadata> {
  const now = new Date().toISOString();

  // Import persona
  for (const [key, value] of Object.entries(data.persona)) {
    await savePersona(key, value);
  }

  // Import memories
  if (data.memories && data.memories.length > 0) {
    await importMemories(data.memories);
  }

  // Import tasks
  if (data.tasks) {
    for (const task of data.tasks) {
      await saveTask(task);
    }
  }

  // Update metadata
  const metadata: ProfileMetadata = {
    ...data.metadata,
    source: 'imported',
    updatedAt: now,
  };

  // Add to profiles
  const profiles = await getLocalProfiles();
  const existingIndex = profiles.findIndex(p => p.id === metadata.id);
  if (existingIndex >= 0) {
    profiles[existingIndex] = metadata;
  } else {
    profiles.push(metadata);
  }
  await setSetting(PROFILES_KEY, profiles);
  await setActiveProfile(metadata.id);

  return metadata;
}

/**
 * Delete a local profile
 */
export async function deleteLocalProfile(profileId: string): Promise<void> {
  const profiles = await getLocalProfiles();
  const filtered = profiles.filter(p => p.id !== profileId);
  await setSetting(PROFILES_KEY, filtered);

  // If this was active, clear active
  const activeId = await getSetting<string | null>(PROFILE_KEY, null);
  if (activeId === profileId) {
    await setSetting(PROFILE_KEY, null);
  }

  // Note: This doesn't delete the actual data from IndexedDB
  // A full cleanup would require clearing specific memory entries
}

/**
 * Check if device has any local profile data
 */
export async function hasLocalProfile(): Promise<boolean> {
  const profiles = await getLocalProfiles();
  return profiles.length > 0;
}

/**
 * Initialize profile system on app start
 */
export async function initProfileSync(): Promise<void> {
  const profiles = await getLocalProfiles();

  // If no profiles exist, check if we're connected to a server
  if (profiles.length === 0) {
    const health = get(healthStatus);
    if (health.connected) {
      // Try to auto-download profile from connected server
      try {
        await downloadProfile();
      } catch (e) {
        console.warn('Could not auto-download profile:', e);
      }
    }
  }
}

// ============================================================================
// Credentials Sync (UNIFIED: Uses filesystem via local API, NOT IndexedDB)
// ============================================================================

/**
 * Save credentials via unified API (writes to filesystem)
 * Used when credentials are fetched from sync server or entered manually
 *
 * UNIFIED: This calls the local API which writes to user's profile etc/runpod.json
 * NO IndexedDB - same code works on web and mobile
 */
export async function saveLocalCredentials(credentials: SyncableCredentials): Promise<void> {
  const response = await apiFetch('/api/profile-sync/credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credentials }),
  });

  if (!response.ok) {
    console.error('[profile-sync] Failed to save credentials to filesystem:', response.status);
    throw new Error('Failed to save credentials');
  }

  console.log('[profile-sync] Credentials saved to filesystem via unified API');
}

/**
 * Get credentials via unified API (reads from filesystem)
 *
 * UNIFIED: This calls the local API which reads from user's profile etc/runpod.json
 * NO IndexedDB - same code works on web and mobile
 */
export async function getLocalCredentials(): Promise<SyncableCredentials | null> {
  try {
    const response = await apiFetch('/api/profile-sync/credentials');
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    return data.credentials || null;
  } catch (error) {
    console.warn('[profile-sync] Error reading credentials from filesystem:', error);
    return null;
  }
}

/**
 * Fetch credentials from desktop sync server and save to local filesystem
 * Requires active connection to sync server with authentication
 *
 * UNIFIED: Fetches from remote server, saves via local API to filesystem
 *
 * @param authToken Optional auth token for sync server (if using token-based auth)
 * @returns Credentials from server or null if unavailable
 */
export async function fetchCredentialsFromServer(authToken?: string): Promise<SyncableCredentials | null> {
  const syncUrl = getSyncServerUrl();
  if (!syncUrl) {
    console.log('[profile-sync] No sync server configured');
    return null;
  }

  try {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    // Add auth token if provided
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const normalizedUrl = normalizeUrl(syncUrl);
    const response = await remoteFetch(`${normalizedUrl}/api/profile-sync/credentials`, {
      method: 'GET',
      headers,
      credentials: 'include', // Include cookies for session auth
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.warn('[profile-sync] Failed to fetch credentials:', response.status, errorText);
      return null;
    }

    const data = await response.json();
    if (data.success && data.credentials) {
      // Save credentials to filesystem via unified API (NOT IndexedDB!)
      await saveLocalCredentials(data.credentials);
      console.log('[profile-sync] Credentials synced from server to filesystem');
      return data.credentials;
    }

    return null;
  } catch (error) {
    console.warn('[profile-sync] Error fetching credentials:', error);
    return null;
  }
}

/**
 * Sync credentials - tries server first, falls back to local filesystem
 *
 * UNIFIED: All storage is filesystem-based via local API
 */
export async function syncCredentials(authToken?: string): Promise<SyncableCredentials | null> {
  // First try to fetch from server (which also saves to local filesystem)
  const serverCredentials = await fetchCredentialsFromServer(authToken);
  if (serverCredentials) {
    return serverCredentials;
  }

  // Fall back to local filesystem
  return getLocalCredentials();
}

/**
 * Clear credentials (placeholder - credentials live in filesystem)
 */
export async function clearLocalCredentials(): Promise<void> {
  // Credentials are in filesystem - clearing would require API call
  // For now, this is a no-op. User can manually delete etc/runpod.json
  console.log('[profile-sync] clearLocalCredentials is a no-op - credentials are in filesystem');
}

// ============================================================================
// Remote Server Sync (with authentication)
// ============================================================================

import {
  getSyncServerCredentials,
  saveSyncServerCredentials,
  updateSyncTimestamp,
  type SyncServerCredentials,
} from './local-memory';
// NOTE: saveSyncedCredentials REMOVED - was IndexedDB, now use saveLocalCredentials (unified API)
// mobile-fs imports removed - sync now uses unified LOCAL API (filesystem writes handled server-side)

export interface RemoteSyncProgress {
  phase: 'authenticating' | 'fetching-profile' | 'fetching-credentials' | 'importing' | 'complete' | 'error';
  message: string;
  current?: number;
  total?: number;
  error?: string;
}

export interface RemoteSyncResult {
  success: boolean;
  profileFiles?: number;
  memoriesImported?: number;
  credentialsSynced?: boolean;
  error?: string;
}

/**
 * Authenticate with remote server using Basic Auth
 * Returns session cookie if successful
 *
 * Uses remoteFetch() which:
 * - Normalizes URL (adds https:// if missing)
 * - Uses CapacitorHttp on mobile to bypass CORS
 */
async function authenticateWithRemoteServer(
  serverUrl: string,
  username: string,
  password: string
): Promise<{ success: boolean; error?: string; cookie?: string }> {
  try {
    // Normalize URL and build full endpoint
    const normalizedServerUrl = normalizeUrl(serverUrl);
    const url = `${normalizedServerUrl}/api/auth/login`;
    console.log('[profile-sync] Authenticating with', url);

    const response = await remoteFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username, password }),
      credentials: 'include',
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: `Authentication failed: ${response.status} - ${text}` };
    }

    const data = await response.json();

    if (!data.success) {
      return { success: false, error: data.error || 'Authentication failed' };
    }

    // Get session from response body (primary) or headers (fallback)
    // Our auth API returns sessionId in the body
    let sessionId = data.sessionId || data.session;

    // Fallback: try to get from headers
    if (!sessionId) {
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) {
        const match = setCookie.match(/mh_session=([^;]+)/);
        sessionId = match?.[1];
      }
    }

    if (!sessionId) {
      console.error('[profile-sync] No session ID in auth response:', { data, headers: Object.fromEntries(response.headers.entries()) });
      return { success: false, error: 'No session ID returned from server' };
    }

    // Return as cookie format for subsequent requests
    return { success: true, cookie: `mh_session=${sessionId}` };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Fetch credentials from remote server (requires owner role)
 */
async function fetchCredentialsFromRemote(
  serverUrl: string,
  cookie: string
): Promise<{ success: boolean; credentials?: SyncableCredentials; error?: string }> {
  try {
    const normalizedServerUrl = normalizeUrl(serverUrl);
    const url = `${normalizedServerUrl}/api/profile-sync/credentials`;
    console.log('[profile-sync] Fetching credentials from', url);

    const response = await remoteFetch(url, {
      method: 'GET',
      headers: {
        'Cookie': cookie,
      },
      credentials: 'include',
    });

    if (!response.ok) {
      // 403 is expected for non-owner users - just skip credentials
      if (response.status === 403) {
        console.log('[profile-sync] Credentials sync requires owner role - skipping');
        return { success: true, credentials: undefined };
      }
      const text = await response.text();
      return { success: false, error: `Failed to fetch credentials: ${response.status} - ${text}` };
    }

    const data = await response.json();

    if (data.error) {
      return { success: false, error: data.error };
    }

    return { success: true, credentials: data.credentials };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Test connection to remote sync server
 */
export async function testRemoteServerConnection(
  serverUrl: string,
  username: string,
  password: string
): Promise<{ success: boolean; error?: string }> {
  const authResult = await authenticateWithRemoteServer(serverUrl, username, password);
  return { success: authResult.success, error: authResult.error };
}

/**
 * Configure and save sync server credentials
 */
export async function configureRemoteSyncServer(
  serverUrl: string,
  username: string,
  password: string
): Promise<{ success: boolean; error?: string }> {
  // Test connection first
  const testResult = await testRemoteServerConnection(serverUrl, username, password);
  if (!testResult.success) {
    return testResult;
  }

  // Save credentials
  await saveSyncServerCredentials({
    serverUrl: serverUrl.replace(/\/$/, ''), // Remove trailing slash
    username,
    password,
    verified: true,
  });

  return { success: true };
}

/**
 * Sync from configured remote server
 * Downloads profile, credentials, and optionally memories
 *
 * @param onProgress - Progress callback
 * @param options - Sync options
 *   - includeMemories: Download memories (default: true)
 *   - includeCredentials: Download credentials (default: true)
 *   - priorityOnly: Use priority export (persona/config only) (default: true)
 *   - memoryDays: Only sync memories from last N days (default: 7, 0 = all)
 */
export async function syncFromRemoteServer(
  onProgress?: (progress: RemoteSyncProgress) => void,
  options?: {
    includeMemories?: boolean;
    includeCredentials?: boolean;
    priorityOnly?: boolean;
    memoryDays?: number;
  }
): Promise<RemoteSyncResult> {
  const opts = {
    includeMemories: true,
    includeCredentials: true,
    priorityOnly: true,
    memoryDays: 7, // Default to last 7 days
    ...options,
  };

  // Get saved credentials
  const creds = await getSyncServerCredentials();
  if (!creds) {
    return { success: false, error: 'No sync server configured. Please set up sync server first.' };
  }

  const result: RemoteSyncResult = { success: false };

  try {
    // Phase 1: Authenticate
    onProgress?.({ phase: 'authenticating', message: 'Connecting to server...' });

    const authResult = await authenticateWithRemoteServer(creds.serverUrl, creds.username, creds.password);
    if (!authResult.success || !authResult.cookie) {
      onProgress?.({ phase: 'error', message: 'Authentication failed', error: authResult.error });
      return { success: false, error: authResult.error };
    }

    const cookie = authResult.cookie;

    // Phase 2: Fetch profile
    onProgress?.({ phase: 'fetching-profile', message: 'Downloading profile...' });

    const normalizedServerUrl = normalizeUrl(creds.serverUrl);
    const endpoint = opts.priorityOnly ? '/api/profile-sync/export-priority' : '/api/profile-sync/export';

    // Use POST with credentials in body for priority export (avoids cross-origin cookie issues)
    // GET with cookie for full export (legacy support)
    const profileResponse = opts.priorityOnly
      ? await remoteFetch(`${normalizedServerUrl}${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: creds.username, password: creds.password }),
        })
      : await remoteFetch(`${normalizedServerUrl}${endpoint}`, {
          method: 'GET',
          headers: { 'Cookie': cookie },
          credentials: 'include',
        });

    if (!profileResponse.ok) {
      const text = await profileResponse.text();
      onProgress?.({ phase: 'error', message: 'Failed to fetch profile', error: text });
      return { success: false, error: `Failed to fetch profile: ${profileResponse.status}` };
    }

    const profileBundle = await profileResponse.json();
    result.profileFiles = profileBundle.files?.length || 0;

    // Phase 3: Create/authenticate local user BEFORE importing profile
    // This is required because /api/profile-sync/import needs authentication
    // We create the user locally with the same credentials as the remote server
    onProgress?.({
      phase: 'importing',
      message: 'Setting up local user...',
      current: 0,
      total: result.profileFiles
    });

    try {
      // First, create/authenticate the user locally
      // This creates a local session so subsequent API calls work
      const syncUserResponse = await apiFetch('/api/auth/sync-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: creds.username,
          password: creds.password,
          displayName: creds.username,
          role: 'owner', // First user gets owner role
        }),
      });

      if (!syncUserResponse.ok) {
        const errorText = await syncUserResponse.text();
        console.error('[profile-sync] Failed to create local user:', syncUserResponse.status, errorText);
        // Don't fail completely - user might already exist with different password
        // Just log and continue
        console.log('[profile-sync] Continuing despite sync-user error...');
      } else {
        const syncUserResult = await syncUserResponse.json();
        console.log('[profile-sync] Local user created/authenticated:', syncUserResult);
      }

      onProgress?.({
        phase: 'importing',
        message: 'Importing profile files...',
        current: 0,
        total: result.profileFiles
      });

      // Now POST the entire bundle to LOCAL /api/profile-sync/import
      // This writes files to the filesystem (NOT IndexedDB)
      const importResponse = await apiFetch('/api/profile-sync/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profileBundle),
      });

      if (!importResponse.ok) {
        const errorText = await importResponse.text();
        console.error('[profile-sync] Import failed:', importResponse.status, errorText);
        onProgress?.({ phase: 'error', message: 'Failed to import profile', error: errorText });
        return { success: false, error: `Import failed: ${importResponse.status}` };
      }

      const importResult = await importResponse.json();
      console.log('[profile-sync] Import result:', importResult);

      onProgress?.({
        phase: 'importing',
        message: `Imported ${importResult.imported || result.profileFiles} files`,
        current: result.profileFiles,
        total: result.profileFiles,
      });
    } catch (err) {
      console.error('[profile-sync] Import error:', err);
      onProgress?.({ phase: 'error', message: 'Import failed', error: (err as Error).message });
      return { success: false, error: (err as Error).message };
    }

    // Phase 4: Fetch credentials (if requested)
    if (opts.includeCredentials) {
      onProgress?.({ phase: 'fetching-credentials', message: 'Syncing credentials...' });

      const credsResult = await fetchCredentialsFromRemote(creds.serverUrl, cookie);
      if (credsResult.success && credsResult.credentials) {
        // Save to filesystem via unified API (NOT IndexedDB!)
        await saveLocalCredentials(credsResult.credentials);
        result.credentialsSynced = true;
        console.log('[profile-sync] Credentials synced to filesystem:', Object.keys(credsResult.credentials));
      }
    }

    // Phase 5: Fetch memories (if requested)
    // Downloads from remote server, then POSTs to LOCAL API to write to filesystem
    if (opts.includeMemories) {
      // Build memory URL with date filter
      const daysParam = opts.memoryDays > 0 ? `&days=${opts.memoryDays}` : '';
      const daysLabel = opts.memoryDays > 0 ? ` (last ${opts.memoryDays} days)` : '';
      onProgress?.({ phase: 'importing', message: `Checking local memories...` });

      // Get list of local memory IDs to exclude from download (prevents duplicates)
      let localMemoryIds: string[] = [];
      try {
        const localMemResponse = await apiFetch('/api/memories?idsOnly=true');
        if (localMemResponse.ok) {
          const localData = await localMemResponse.json();
          localMemoryIds = localData.ids || [];
          console.log(`[profile-sync] Found ${localMemoryIds.length} local memories to exclude`);
        }
      } catch (err) {
        console.warn('[profile-sync] Could not get local memory IDs:', err);
      }

      // Build exclude parameter (chunked to avoid URL length limits)
      const excludeParam = localMemoryIds.length > 0
        ? `&exclude=${localMemoryIds.slice(0, 500).join(',')}`  // Limit to 500 IDs per request
        : '';

      onProgress?.({ phase: 'importing', message: `Syncing memories${daysLabel}...` });

      let offset = 0;
      let totalMemories = 0;
      let hasMore = true;

      while (hasMore) {
        const memResponse = await remoteFetch(
          `${normalizedServerUrl}/api/profile-sync/memories?offset=${offset}&limit=100${daysParam}${excludeParam}`,
          {
            method: 'GET',
            headers: { 'Cookie': cookie },
            credentials: 'include',
          }
        );

        if (!memResponse.ok) {
          console.warn('[profile-sync] Memory fetch failed:', memResponse.status);
          break;
        }

        const memData = await memResponse.json();

        if (memData.memories && memData.memories.length > 0) {
          // POST each memory to LOCAL API (writes to filesystem, NOT IndexedDB)
          for (const memory of memData.memories) {
            try {
              const pushResponse = await apiFetch('/api/memory/sync/push', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ memory }),
              });

              if (!pushResponse.ok) {
                // 409 Conflict means memory already exists - that's fine
                if (pushResponse.status !== 409) {
                  console.warn(`[profile-sync] Memory push failed for ${memory.id}:`, pushResponse.status);
                }
              }
            } catch (err) {
              console.warn(`[profile-sync] Memory push error for ${memory.id}:`, err);
            }
          }

          totalMemories += memData.memories.length;

          onProgress?.({
            phase: 'importing',
            message: `Imported ${totalMemories} memories...`,
            current: totalMemories,
            total: memData.total,
          });
        }

        hasMore = memData.hasMore || false;
        offset += 100;
      }

      result.memoriesImported = totalMemories;
    }

    // Update last sync timestamp
    await updateSyncTimestamp();

    onProgress?.({ phase: 'complete', message: 'Sync complete!' });

    result.success = true;
    return result;

  } catch (error) {
    const errorMsg = (error as Error).message;
    onProgress?.({ phase: 'error', message: 'Sync failed', error: errorMsg });
    return { success: false, error: errorMsg };
  }
}

/**
 * Get current remote sync server configuration (without password)
 */
export async function getRemoteSyncConfig(): Promise<{
  configured: boolean;
  serverUrl?: string;
  username?: string;
  lastSyncAt?: string;
  verified?: boolean;
}> {
  const creds = await getSyncServerCredentials();
  if (!creds) {
    return { configured: false };
  }

  return {
    configured: true,
    serverUrl: creds.serverUrl,
    username: creds.username,
    lastSyncAt: creds.lastSyncAt,
    verified: creds.verified,
  };
}

/**
 * Clear remote sync configuration
 * Note: Only clears sync server config. LLM credentials are in filesystem.
 */
export async function clearRemoteSyncConfig(): Promise<void> {
  const { clearSyncServerCredentials } = await import('./local-memory');
  await clearSyncServerCredentials();
  // Note: LLM credentials (runpod.json) are in filesystem - user must delete manually or use settings UI
}

/**
 * Remote server sync comparison result
 */
export interface SyncComparison {
  connected: boolean;
  serverUrl: string;
  serverUsername: string;
  error?: string;
  server: {
    memoryCount: number;
    profileVersion?: string;
    lastUpdated?: string;
  };
  local: {
    memoryCount: number;
    lastSync?: string;
  };
  differences: {
    newMemoriesOnServer: number;
    newerOnServer: boolean;
    syncRecommended: boolean;
  };
}

/**
 * Check remote server status and compare with local data
 * Returns memory counts and sync status for comparison
 */
export async function checkRemoteSyncStatus(): Promise<SyncComparison> {
  const creds = await getSyncServerCredentials();
  if (!creds) {
    throw new Error('No sync server configured');
  }

  // Get local memory count
  const localMemories = await getRecentMemories(100000); // Get all
  const localCount = localMemories.length;
  const lastSync = creds.lastSyncAt || null;

  // Authenticate with remote server
  const authResult = await authenticateWithRemoteServer(creds.serverUrl, creds.username, creds.password);
  if (!authResult.success || !authResult.cookie) {
    return {
      connected: false,
      serverUrl: creds.serverUrl,
      serverUsername: creds.username,
      error: authResult.error || 'Authentication failed',
      server: { memoryCount: 0 },
      local: { memoryCount: localCount, lastSync: lastSync || undefined },
      differences: { newMemoriesOnServer: 0, newerOnServer: false, syncRecommended: false },
    };
  }

  // Fetch server status
  try {
    const normalizedServerUrl = normalizeUrl(creds.serverUrl);
    const response = await remoteFetch(`${normalizedServerUrl}/api/status`, {
      method: 'GET',
      headers: { 'Cookie': authResult.cookie },
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error(`Server status check failed: ${response.status}`);
    }

    const status = await response.json();
    const serverMemoryCount = status.memoryStats?.totalFiles || 0;
    const serverLastUpdated = status.lastUpdated || null;

    // Calculate differences
    const newOnServer = Math.max(0, serverMemoryCount - localCount);
    const newerOnServer = serverLastUpdated && lastSync
      ? new Date(serverLastUpdated) > new Date(lastSync)
      : serverMemoryCount > localCount;

    return {
      connected: true,
      serverUrl: creds.serverUrl,
      serverUsername: creds.username,
      server: {
        memoryCount: serverMemoryCount,
        lastUpdated: serverLastUpdated,
      },
      local: {
        memoryCount: localCount,
        lastSync: lastSync || undefined,
      },
      differences: {
        newMemoriesOnServer: newOnServer,
        newerOnServer,
        syncRecommended: newOnServer > 0 || newerOnServer,
      },
    };
  } catch (error) {
    return {
      connected: true,
      serverUrl: creds.serverUrl,
      serverUsername: creds.username,
      error: (error as Error).message,
      server: { memoryCount: 0 },
      local: { memoryCount: localCount, lastSync: lastSync || undefined },
      differences: { newMemoriesOnServer: 0, newerOnServer: false, syncRecommended: false },
    };
  }
}
