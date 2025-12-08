/**
 * App Update Checker
 *
 * Checks for app updates from the sync server and provides update UI state.
 * Only runs on mobile (Capacitor) - web version always uses latest server code.
 *
 * LOCAL-FIRST ARCHITECTURE:
 * - App checks for updates only when user explicitly syncs
 * - Update is optional - app continues to work without updating
 * - Download URL points to server's APK hosting
 */

import { writable, get } from 'svelte/store';
import { isCapacitorNative } from './api-config';

// Bundled version info - this gets baked into the app at build time
// In a real build, this would be imported from a generated file
const BUNDLED_VERSION = {
  version: '1.0',
  versionCode: 1,
};

export interface AppVersionInfo {
  version: string;
  versionCode: number;
  releaseDate: string;
  releaseNotes: string;
  minAndroidVersion?: number;
  fileSize?: number;
  checksum?: string;
  downloadUrl?: string;
}

export interface UpdateState {
  currentVersion: string;
  currentVersionCode: number;
  latestVersion: string | null;
  latestVersionCode: number | null;
  updateAvailable: boolean;
  releaseNotes: string | null;
  downloadUrl: string | null;
  fileSize: number | null;
  lastChecked: string | null;
  isChecking: boolean;
  error: string | null;
}

// Svelte store for update state
export const updateState = writable<UpdateState>({
  currentVersion: BUNDLED_VERSION.version,
  currentVersionCode: BUNDLED_VERSION.versionCode,
  latestVersion: null,
  latestVersionCode: null,
  updateAvailable: false,
  releaseNotes: null,
  downloadUrl: null,
  fileSize: null,
  lastChecked: null,
  isChecking: false,
  error: null,
});

// Derived store for easy "update available" check
export const hasUpdate = writable(false);

/**
 * Get current app version from Capacitor App plugin or bundled version
 */
export async function getCurrentVersion(): Promise<{ version: string; versionCode: number }> {
  if (!isCapacitorNative()) {
    return BUNDLED_VERSION;
  }

  try {
    // Dynamic import - @capacitor/app only available on mobile
    const module = await import('@capacitor/app' as string);
    const App = module.App;
    const info = await App.getInfo();
    return {
      version: info.version,
      versionCode: parseInt(info.build, 10) || BUNDLED_VERSION.versionCode,
    };
  } catch (e) {
    console.warn('[app-update] Could not get app info from Capacitor:', e);
    return BUNDLED_VERSION;
  }
}

/**
 * Check for updates from the sync server
 *
 * @param serverUrl - The sync server URL to check (e.g., https://mh.dndiy.org)
 * @returns Update state with latest version info
 */
export async function checkForUpdate(serverUrl: string): Promise<UpdateState> {
  // Only check on mobile
  if (!isCapacitorNative()) {
    const state = get(updateState);
    return { ...state, error: 'Updates only available on mobile' };
  }

  updateState.update(s => ({ ...s, isChecking: true, error: null }));

  try {
    // Get current version
    const current = await getCurrentVersion();

    // Normalize server URL
    const baseUrl = serverUrl.replace(/\/$/, '');

    // Fetch latest version from server
    const response = await fetch(`${baseUrl}/api/app-version`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }

    const latest: AppVersionInfo = await response.json();

    // Compare versions
    const updateAvailable = latest.versionCode > current.versionCode;

    const newState: UpdateState = {
      currentVersion: current.version,
      currentVersionCode: current.versionCode,
      latestVersion: latest.version,
      latestVersionCode: latest.versionCode,
      updateAvailable,
      releaseNotes: latest.releaseNotes || null,
      downloadUrl: latest.downloadUrl || `${baseUrl}/downloads/metahuman-os.apk`,
      fileSize: latest.fileSize || null,
      lastChecked: new Date().toISOString(),
      isChecking: false,
      error: null,
    };

    updateState.set(newState);
    hasUpdate.set(updateAvailable);

    if (updateAvailable) {
      console.log(`[app-update] Update available: ${current.version} -> ${latest.version}`);
    } else {
      console.log(`[app-update] App is up to date (${current.version})`);
    }

    return newState;
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : 'Failed to check for updates';
    console.error('[app-update] Check failed:', e);

    updateState.update(s => ({
      ...s,
      isChecking: false,
      error: errorMsg,
    }));

    return get(updateState);
  }
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number | null): string {
  if (!bytes) return 'Unknown size';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Open the download URL in browser (triggers APK download)
 */
export async function downloadUpdate(): Promise<void> {
  const state = get(updateState);

  if (!state.downloadUrl) {
    console.error('[app-update] No download URL available');
    return;
  }

  if (isCapacitorNative()) {
    try {
      // Dynamic import - @capacitor/browser only available on mobile
      const module = await import('@capacitor/browser' as string);
      const Browser = module.Browser;
      await Browser.open({ url: state.downloadUrl });
    } catch (e) {
      // Fallback to window.open
      window.open(state.downloadUrl, '_blank');
    }
  } else {
    window.open(state.downloadUrl, '_blank');
  }
}

/**
 * Clear update notification (user dismissed it)
 */
export function dismissUpdate(): void {
  hasUpdate.set(false);
}

/**
 * Reset update state
 */
export function resetUpdateState(): void {
  updateState.set({
    currentVersion: BUNDLED_VERSION.version,
    currentVersionCode: BUNDLED_VERSION.versionCode,
    latestVersion: null,
    latestVersionCode: null,
    updateAvailable: false,
    releaseNotes: null,
    downloadUrl: null,
    fileSize: null,
    lastChecked: null,
    isChecking: false,
    error: null,
  });
  hasUpdate.set(false);
}
