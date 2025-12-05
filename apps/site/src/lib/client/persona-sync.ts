/**
 * Persona Sync
 *
 * Downloads and caches persona data locally for offline use.
 * Server is the source of truth; local cache enables offline chat.
 */

import { apiFetch } from './api-config';
import { healthStatus } from './server-health';
import { getPersona, savePersona, getAllPersona, type LocalPersona } from './local-memory';
import { get } from 'svelte/store';

export interface PersonaCore {
  name: string;
  traits: string[];
  voice: string;
  values: string[];
  summary: string;
  updatedAt?: string;
}

export interface PersonaRelationships {
  people: Array<{
    name: string;
    relationship: string;
    notes: string;
  }>;
  updatedAt?: string;
}

export interface PersonaRoutines {
  daily: Array<{
    time: string;
    activity: string;
  }>;
  updatedAt?: string;
}

export interface SyncResult {
  synced: string[];
  errors: string[];
  fromCache: boolean;
}

/**
 * Sync all persona data from server to local cache
 */
export async function syncPersona(): Promise<SyncResult> {
  const result: SyncResult = {
    synced: [],
    errors: [],
    fromCache: false,
  };

  const health = get(healthStatus);

  if (!health.connected) {
    result.fromCache = true;
    return result;
  }

  // Sync each persona component
  const components = ['core', 'relationships', 'routines', 'decision-rules'];

  for (const component of components) {
    try {
      const response = await apiFetch(`/api/persona-${component}`);

      if (response.ok) {
        const data = await response.json();
        const serverTimestamp = data.updatedAt || new Date().toISOString();

        // Check if we need to update local cache
        const local = await getPersona(component);

        if (!local || !local.syncedAt || serverTimestamp > local.syncedAt) {
          await savePersona(component, data);
          result.synced.push(component);
        }
      } else if (response.status !== 404) {
        result.errors.push(`Failed to fetch ${component}: ${response.status}`);
      }
    } catch (e) {
      result.errors.push(`Error syncing ${component}: ${e instanceof Error ? e.message : 'Unknown'}`);
    }
  }

  return result;
}

/**
 * Get persona core (with fallback to cache)
 */
export async function getPersonaCore(): Promise<PersonaCore | null> {
  const health = get(healthStatus);

  // Try server first if connected
  if (health.connected) {
    try {
      const response = await apiFetch('/api/persona-core');
      if (response.ok) {
        const data = await response.json();

        // Update local cache
        await savePersona('core', data);

        return data;
      }
    } catch {
      // Fall through to cache
    }
  }

  // Fall back to local cache
  const cached = await getPersona('core');
  if (cached?.data) {
    return cached.data as PersonaCore;
  }

  return null;
}

/**
 * Get persona summary for chat context
 */
export async function getPersonaSummary(): Promise<string> {
  const persona = await getPersonaCore();

  if (persona) {
    if (persona.summary) {
      return persona.summary;
    }

    // Build summary from components
    const parts: string[] = [];
    if (persona.name) parts.push(`${persona.name}`);
    if (persona.traits?.length) parts.push(`traits: ${persona.traits.slice(0, 3).join(', ')}`);
    if (persona.voice) parts.push(`voice: ${persona.voice}`);

    if (parts.length > 0) {
      return parts.join('; ');
    }
  }

  return 'a helpful assistant';
}

/**
 * Check if persona is cached locally
 */
export async function hasLocalPersona(): Promise<boolean> {
  const local = await getPersona('core');
  return local !== undefined && local.data !== undefined;
}

/**
 * Get all cached persona data
 */
export async function getAllCachedPersona(): Promise<Record<string, any>> {
  const all = await getAllPersona();
  const result: Record<string, any> = {};

  for (const item of all) {
    result[item.key] = item.data;
  }

  return result;
}

/**
 * Force refresh persona from server
 */
export async function refreshPersona(): Promise<SyncResult> {
  return syncPersona();
}

/**
 * Initialize persona sync on app start
 */
export async function initPersonaSync(): Promise<void> {
  // Try to sync persona on startup
  try {
    await syncPersona();
  } catch (e) {
    console.warn('Failed to sync persona on startup:', e);
  }
}
