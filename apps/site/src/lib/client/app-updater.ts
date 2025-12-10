/**
 * App Update Checker
 *
 * Platform-aware update system:
 * - Mobile (Capacitor): Downloads APK from server and triggers install
 * - Web/Desktop: Uses git pull to update server code
 */

import { writable, derived, type Writable } from 'svelte/store';
import { apiFetch, getApiBaseUrlAsync, isCapacitorNative } from './api-config';

// Types for mobile APK updates
export interface MobileVersionInfo {
  version: string;
  versionCode: number;
  releaseDate: string;
  releaseNotes: string;
  downloadUrl: string;
  fileSize: number;
  checksum?: string;
  minAndroidVersion: number;
}

// Types for server (git) updates
export interface ServerUpdateInfo {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string | null;
  commitsAhead: number;
  commitsBehind: number;
  changesSummary: string[];
  canUpdate: boolean;
  reason?: string;
}

export interface UpdateState {
  // Common state
  checking: boolean;
  updating: boolean;
  updateProgress: number;
  updateAvailable: boolean;
  error: string | null;
  lastChecked: string | null;

  // Platform detection
  platform: 'mobile' | 'server' | 'unknown';

  // Mobile-specific
  currentVersion: string;
  currentVersionCode: number;
  latestMobileVersion: MobileVersionInfo | null;

  // Server-specific
  serverUpdateInfo: ServerUpdateInfo | null;
}

export interface AppInfo {
  version: string;
  versionCode: number;
  packageName: string;
}

// Initial state
const initialState: UpdateState = {
  checking: false,
  updating: false,
  updateProgress: 0,
  updateAvailable: false,
  error: null,
  lastChecked: null,
  platform: 'unknown',
  currentVersion: '0.0.0',
  currentVersionCode: 0,
  latestMobileVersion: null,
  serverUpdateInfo: null,
};

// Stores
export const updateState: Writable<UpdateState> = writable(initialState);

export const isUpdateAvailable = derived(updateState, $state => $state.updateAvailable);
export const isChecking = derived(updateState, $state => $state.checking);
export const isUpdating = derived(updateState, $state => $state.updating);
// Legacy alias
export const isDownloading = isUpdating;

/**
 * Detect current platform
 */
export function detectPlatform(): 'mobile' | 'server' {
  return isCapacitorNative() ? 'mobile' : 'server';
}

/**
 * Get current app info from native plugin (mobile only)
 */
async function getCurrentAppInfo(): Promise<AppInfo> {
  if (!isCapacitorNative()) {
    return {
      version: '0.0.0',
      versionCode: 0,
      packageName: 'com.metahuman.os',
    };
  }

  try {
    const { NativeUpdater } = await import('./plugins/native-updater');
    const info = await NativeUpdater.getAppInfo();
    return info;
  } catch {
    return {
      version: '1.0.0',
      versionCode: 1,
      packageName: 'com.metahuman.os',
    };
  }
}

/**
 * Check for available updates (platform-aware)
 */
export async function checkForUpdates(): Promise<boolean> {
  const platform = detectPlatform();

  updateState.update(s => ({
    ...s,
    checking: true,
    error: null,
    platform,
  }));

  try {
    if (platform === 'mobile') {
      return await checkMobileUpdate();
    } else {
      return await checkServerUpdate();
    }
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : 'Failed to check for updates';
    updateState.update(s => ({
      ...s,
      checking: false,
      error: errorMsg,
    }));
    return false;
  }
}

/**
 * Check for mobile APK updates
 */
async function checkMobileUpdate(): Promise<boolean> {
  const appInfo = await getCurrentAppInfo();

  updateState.update(s => ({
    ...s,
    currentVersion: appInfo.version,
    currentVersionCode: appInfo.versionCode,
  }));

  const response = await apiFetch(
    `/api/mobile/version?current=${appInfo.version}&versionCode=${appInfo.versionCode}`
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(errorData.error || `Server returned ${response.status}`);
  }

  const data = await response.json();

  updateState.update(s => ({
    ...s,
    checking: false,
    latestMobileVersion: data.latest,
    updateAvailable: data.updateAvailable,
    lastChecked: new Date().toISOString(),
  }));

  return data.updateAvailable;
}

/**
 * Check for server (git) updates
 */
async function checkServerUpdate(): Promise<boolean> {
  const response = await apiFetch('/api/server-update');

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(errorData.error || `Server returned ${response.status}`);
  }

  const data: ServerUpdateInfo = await response.json();

  updateState.update(s => ({
    ...s,
    checking: false,
    serverUpdateInfo: data,
    updateAvailable: data.updateAvailable,
    currentVersion: data.currentVersion,
    lastChecked: new Date().toISOString(),
  }));

  return data.updateAvailable;
}

/**
 * Perform update (platform-aware)
 */
export async function performUpdate(): Promise<void> {
  const state = await new Promise<UpdateState>(resolve => {
    updateState.subscribe(s => resolve(s))();
  });

  if (!state.updateAvailable) {
    throw new Error('No update available');
  }

  if (state.platform === 'mobile') {
    return await downloadAndInstallMobile();
  } else {
    return await updateServer();
  }
}

/**
 * Download and install APK (mobile)
 */
async function downloadAndInstallMobile(): Promise<void> {
  const state = await new Promise<UpdateState>(resolve => {
    updateState.subscribe(s => resolve(s))();
  });

  if (!state.latestMobileVersion) {
    throw new Error('No update available to download');
  }

  updateState.update(s => ({ ...s, updating: true, updateProgress: 0, error: null }));

  try {
    const { NativeUpdater } = await import('./plugins/native-updater');

    // Get full download URL
    const baseUrl = await getApiBaseUrlAsync() || window.location.origin;
    const downloadUrl = `${baseUrl}${state.latestMobileVersion.downloadUrl}`;

    // Listen for progress
    await NativeUpdater.addListener('downloadProgress', (event: { progress: number }) => {
      updateState.update(s => ({ ...s, updateProgress: event.progress }));
    });

    const result = await NativeUpdater.downloadAndInstall({
      url: downloadUrl,
      version: state.latestMobileVersion.version,
    });

    if (!result.success) {
      throw new Error(result.error || 'Download failed');
    }

    updateState.update(s => ({ ...s, updating: false, updateProgress: 100 }));
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : 'Download failed';
    updateState.update(s => ({
      ...s,
      updating: false,
      error: errorMsg,
    }));
    throw e;
  }
}

/**
 * Update server via git pull
 */
async function updateServer(): Promise<void> {
  const state = await new Promise<UpdateState>(resolve => {
    updateState.subscribe(s => resolve(s))();
  });

  if (!state.serverUpdateInfo?.canUpdate) {
    throw new Error(state.serverUpdateInfo?.reason || 'Cannot update');
  }

  updateState.update(s => ({ ...s, updating: true, updateProgress: 0, error: null }));

  try {
    // Perform git pull
    updateState.update(s => ({ ...s, updateProgress: 30 }));

    const response = await apiFetch('/api/server-update', {
      method: 'POST',
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(errorData.error || 'Update failed');
    }

    const result = await response.json();
    updateState.update(s => ({ ...s, updateProgress: 80 }));

    if (!result.success) {
      throw new Error(result.message || 'Update failed');
    }

    updateState.update(s => ({
      ...s,
      updating: false,
      updateProgress: 100,
      updateAvailable: false,
      serverUpdateInfo: {
        ...s.serverUpdateInfo!,
        updateAvailable: false,
        currentVersion: result.newCommit,
        commitsBehind: 0,
      },
    }));

    // Show restart message
    if (result.restartMessage) {
      console.log('[app-updater]', result.restartMessage);
    }
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : 'Update failed';
    updateState.update(s => ({
      ...s,
      updating: false,
      error: errorMsg,
    }));
    throw e;
  }
}

/**
 * Restart server (web/desktop only)
 */
export async function restartServer(): Promise<void> {
  if (isCapacitorNative()) {
    throw new Error('Server restart is not available on mobile');
  }

  try {
    const response = await apiFetch('/api/server-update/restart', {
      method: 'POST',
    });

    // Server will exit, so connection may be lost
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(errorData.error || 'Restart failed');
    }

    // Server is restarting - page will need to reload
    console.log('[app-updater] Server restarting...');
  } catch (e) {
    // Connection reset is expected when server exits
    if (e instanceof TypeError && e.message.includes('fetch')) {
      console.log('[app-updater] Server is restarting...');
      return;
    }
    throw e;
  }
}

/**
 * Legacy alias for downloadAndInstall
 */
export async function downloadAndInstall(): Promise<void> {
  return performUpdate();
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Format relative time
 */
export function formatRelativeTime(isoString: string | null): string {
  if (!isoString) return 'Never';

  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
  return date.toLocaleDateString();
}

/**
 * Initialize update checker (call on app start)
 */
export async function initUpdateChecker(): Promise<void> {
  const platform = detectPlatform();

  updateState.update(s => ({ ...s, platform }));

  if (platform === 'mobile') {
    const appInfo = await getCurrentAppInfo();
    updateState.update(s => ({
      ...s,
      currentVersion: appInfo.version,
      currentVersionCode: appInfo.versionCode,
    }));
  }
}

/**
 * Get human-readable update description
 */
export function getUpdateDescription(state: UpdateState): string {
  if (state.platform === 'mobile' && state.latestMobileVersion) {
    return `Version ${state.latestMobileVersion.version} available (${formatFileSize(state.latestMobileVersion.fileSize)})`;
  }

  if (state.platform === 'server' && state.serverUpdateInfo) {
    const { commitsBehind, changesSummary } = state.serverUpdateInfo;
    if (commitsBehind === 1) {
      return `1 commit behind: ${changesSummary[0] || 'Update available'}`;
    }
    return `${commitsBehind} commits behind`;
  }

  return 'Update available';
}

/**
 * Get update action text
 */
export function getUpdateActionText(state: UpdateState): string {
  if (state.updating) {
    return state.platform === 'mobile' ? 'Downloading...' : 'Updating...';
  }
  return state.platform === 'mobile' ? 'Download & Install' : 'Update Now';
}
