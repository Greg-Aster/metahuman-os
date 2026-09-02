/**
 * Sync Settings
 *
 * Manages profile data sync preferences for local-first architecture.
 * Sync is expensive, so we provide controls:
 * - WiFi-only sync (default for mobile)
 * - Manual sync only
 * - Sync on login
 */

import { getSetting, setSetting } from './local-memory';

export interface SyncSettings {
  // When to sync
  syncOnLogin: boolean;          // Sync when logging in (default: true)
  syncOnWifiOnly: boolean;       // Only sync on WiFi, not cellular (default: true for mobile)
  manualSyncOnly: boolean;       // Disable auto-sync, only sync when user requests (default: false)

}

const DEFAULT_SYNC_SETTINGS: SyncSettings = {
  syncOnLogin: true,
  syncOnWifiOnly: true,  // Conservative default - don't use cellular data
  manualSyncOnly: false,
};

const SETTINGS_KEY = 'syncSettings';

/**
 * Get current sync settings
 */
export async function getSyncSettings(): Promise<SyncSettings> {
  const stored = await getSetting<Partial<SyncSettings>>(SETTINGS_KEY, {});
  return {
    syncOnLogin: stored.syncOnLogin ?? DEFAULT_SYNC_SETTINGS.syncOnLogin,
    syncOnWifiOnly: stored.syncOnWifiOnly ?? DEFAULT_SYNC_SETTINGS.syncOnWifiOnly,
    manualSyncOnly: stored.manualSyncOnly ?? DEFAULT_SYNC_SETTINGS.manualSyncOnly,
  };
}

/**
 * Update sync settings
 */
export async function updateSyncSettings(updates: Partial<SyncSettings>): Promise<SyncSettings> {
  const current = await getSyncSettings();
  const updated: SyncSettings = {
    syncOnLogin: updates.syncOnLogin ?? current.syncOnLogin,
    syncOnWifiOnly: updates.syncOnWifiOnly ?? current.syncOnWifiOnly,
    manualSyncOnly: updates.manualSyncOnly ?? current.manualSyncOnly,
  };
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
 * Uses navigator.connection API where available
 */
export async function getNetworkType(): Promise<NetworkType> {
  if (typeof navigator === 'undefined') {
    return 'unknown';
  }

  // Use navigator.connection if available
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
 * Listen for network changes
 * Returns unsubscribe function
 */
export async function onNetworkChange(
  callback: (type: NetworkType) => void
): Promise<() => void> {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleOnline = () => getNetworkType().then(callback);
  const handleOffline = () => callback('none');

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);

  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
  };
}
