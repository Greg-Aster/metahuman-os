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

import { apiFetch } from './api-config';
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

export interface ProfileData {
  metadata: ProfileMetadata;
  persona: Record<string, any>;
  memories: LocalMemory[];
  tasks: LocalTask[];
  settings: Record<string, any>;
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
    serverUrl: health.url,
    version: serverMeta.version || 1,
    memoryCount: memoriesDownloaded,
    personaKeys,
  };

  // Save to profiles list
  const profiles = await getLocalProfiles();
  const existingIndex = profiles.findIndex(p => p.serverUrl === health.url);
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
