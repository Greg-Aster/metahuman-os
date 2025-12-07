/**
 * Sync Settings
 *
 * Manages profile data sync preferences for local-first architecture.
 * Sync is expensive, so we provide controls:
 * - WiFi-only sync (default for mobile)
 * - Manual sync only
 * - Sync on login
 * - Background sync interval
 */

import { getSetting, setSetting } from './local-memory';
import { isCapacitorNative } from './api-config';

export interface SyncSettings {
  // When to sync
  syncOnLogin: boolean;          // Sync when logging in (default: true)
  syncOnWifiOnly: boolean;       // Only sync on WiFi, not cellular (default: true for mobile)
  manualSyncOnly: boolean;       // Disable auto-sync, only sync when user requests (default: false)

  // Frequency control
  minSyncIntervalMinutes: number;  // Minimum time between syncs (default: 15)
  backgroundSyncIntervalMinutes: number; // How often to sync in background (default: 60)
  backgroundSyncEnabled: boolean;  // Enable periodic background sync (default: false)

  // What to sync
  syncPersona: boolean;          // Sync persona/identity data (default: true)
  syncSettings: boolean;         // Sync app settings (default: true)
  syncConversationBuffer: boolean; // Sync conversation history (default: false - can be large)
}

export interface SyncState {
  lastSyncTimestamp: string | null;  // ISO timestamp of last successful sync
  lastSyncResult: 'success' | 'failed' | 'skipped' | null;
  pendingChanges: number;            // Number of local changes waiting to sync
}

const DEFAULT_SYNC_SETTINGS: SyncSettings = {
  syncOnLogin: true,
  syncOnWifiOnly: true,  // Conservative default - don't use cellular data
  manualSyncOnly: false,
  minSyncIntervalMinutes: 15,  // Don't sync more than once per 15 minutes
  backgroundSyncIntervalMinutes: 60,
  backgroundSyncEnabled: false,
  syncPersona: true,
  syncSettings: true,
  syncConversationBuffer: false,  // Large, sync manually
};

const DEFAULT_SYNC_STATE: SyncState = {
  lastSyncTimestamp: null,
  lastSyncResult: null,
  pendingChanges: 0,
};

const SETTINGS_KEY = 'syncSettings';
const STATE_KEY = 'syncState';

/**
 * Get current sync settings
 */
export async function getSyncSettings(): Promise<SyncSettings> {
  const stored = await getSetting<Partial<SyncSettings>>(SETTINGS_KEY, {});
  return { ...DEFAULT_SYNC_SETTINGS, ...stored };
}

/**
 * Update sync settings
 */
export async function updateSyncSettings(updates: Partial<SyncSettings>): Promise<SyncSettings> {
  const current = await getSyncSettings();
  const updated = { ...current, ...updates };
  await setSetting(SETTINGS_KEY, updated);
  return updated;
}

/**
 * Reset sync settings to defaults
 */
export async function resetSyncSettings(): Promise<SyncSettings> {
  await setSetting(SETTINGS_KEY, DEFAULT_SYNC_SETTINGS);
  return DEFAULT_SYNC_SETTINGS;
}

export type NetworkType = 'wifi' | 'cellular' | 'none' | 'unknown';

/**
 * Get current network connection type
 * Uses Capacitor Network plugin on mobile, navigator.connection on web
 */
export async function getNetworkType(): Promise<NetworkType> {
  // Mobile: Use Capacitor Network plugin
  if (isCapacitorNative()) {
    try {
      const { Network } = await import('@capacitor/network');
      const status = await Network.getStatus();

      if (!status.connected) {
        return 'none';
      }

      // Capacitor returns 'wifi', 'cellular', 'none', or 'unknown'
      return status.connectionType as NetworkType;
    } catch (e) {
      console.warn('[sync-settings] Failed to get network status:', e);
      return 'unknown';
    }
  }

  // Web: Use navigator.connection if available
  if (typeof navigator !== 'undefined') {
    const connection = (navigator as any).connection ||
                       (navigator as any).mozConnection ||
                       (navigator as any).webkitConnection;

    if (connection) {
      const type = connection.type || connection.effectiveType;
      if (type === 'wifi' || type === 'ethernet') {
        return 'wifi';
      }
      if (type === 'cellular' || type === '4g' || type === '3g' || type === '2g') {
        return 'cellular';
      }
    }

    // Fallback: if online, assume wifi (desktop usually is)
    if (navigator.onLine) {
      return 'wifi';
    }
    return 'none';
  }

  return 'unknown';
}

/**
 * Check if sync is currently allowed based on settings and network
 */
export async function isSyncAllowed(): Promise<{
  allowed: boolean;
  reason?: string;
}> {
  const settings = await getSyncSettings();

  // Manual sync only - never auto-sync
  if (settings.manualSyncOnly) {
    return { allowed: false, reason: 'Manual sync only enabled' };
  }

  // Check WiFi requirement
  if (settings.syncOnWifiOnly) {
    const networkType = await getNetworkType();

    if (networkType === 'none') {
      return { allowed: false, reason: 'No network connection' };
    }

    if (networkType === 'cellular') {
      return { allowed: false, reason: 'WiFi-only sync enabled, currently on cellular' };
    }

    // wifi or unknown - allow (be permissive on unknown)
  }

  return { allowed: true };
}

/**
 * Check if sync on login is allowed
 */
export async function canSyncOnLogin(): Promise<boolean> {
  const settings = await getSyncSettings();

  if (!settings.syncOnLogin) {
    return false;
  }

  const { allowed } = await isSyncAllowed();
  return allowed;
}

/**
 * Listen for network changes (mobile only)
 * Returns unsubscribe function
 */
export async function onNetworkChange(
  callback: (type: NetworkType) => void
): Promise<() => void> {
  if (isCapacitorNative()) {
    try {
      const { Network } = await import('@capacitor/network');
      const handle = await Network.addListener('networkStatusChange', (status) => {
        callback(status.connected ? status.connectionType as NetworkType : 'none');
      });
      return () => handle.remove();
    } catch (e) {
      console.warn('[sync-settings] Failed to add network listener:', e);
    }
  }

  // Web fallback
  if (typeof window !== 'undefined') {
    const handleOnline = () => getNetworkType().then(callback);
    const handleOffline = () => callback('none');

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }

  return () => {};
}
