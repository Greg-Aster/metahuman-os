/**
 * Mobile App Update Checker
 *
 * Checks for app updates from the connected server and handles the update process.
 */

import { writable, derived, type Writable } from 'svelte/store';
import { Capacitor } from '@capacitor/core';
import { apiFetch, getApiBaseUrlAsync } from './api-config';

// Types
export interface VersionInfo {
  version: string;
  versionCode: number;
  releaseDate: string;
  releaseNotes: string;
  downloadUrl: string;
  fileSize: number;
  checksum?: string;
  minAndroidVersion: number;
}

export interface UpdateState {
  checking: boolean;
  downloading: boolean;
  downloadProgress: number;
  currentVersion: string;
  currentVersionCode: number;
  latestVersion: VersionInfo | null;
  updateAvailable: boolean;
  error: string | null;
  lastChecked: string | null;
}

export interface AppInfo {
  version: string;
  versionCode: number;
  packageName: string;
}

// Initial state
const initialState: UpdateState = {
  checking: false,
  downloading: false,
  downloadProgress: 0,
  currentVersion: '0.0.0',
  currentVersionCode: 0,
  latestVersion: null,
  updateAvailable: false,
  error: null,
  lastChecked: null,
};

// Stores
export const updateState: Writable<UpdateState> = writable(initialState);

export const isUpdateAvailable = derived(updateState, $state => $state.updateAvailable);
export const isChecking = derived(updateState, $state => $state.checking);
export const isDownloading = derived(updateState, $state => $state.downloading);

// Get current app info from native plugin or fallback
async function getCurrentAppInfo(): Promise<AppInfo> {
  if (!Capacitor.isNativePlatform()) {
    return {
      version: '0.0.0',
      versionCode: 0,
      packageName: 'com.metahuman.os',
    };
  }

  try {
    // Use our custom NativeUpdater plugin to get app info
    const { NativeUpdater } = await import('./plugins/native-updater');
    const info = await NativeUpdater.getAppInfo();
    return info;
  } catch {
    // Fallback to default values
    return {
      version: '1.0.0',
      versionCode: 1,
      packageName: 'com.metahuman.os',
    };
  }
}

/**
 * Check for available updates
 */
export async function checkForUpdates(): Promise<boolean> {
  updateState.update(s => ({ ...s, checking: true, error: null }));

  try {
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
      latestVersion: data.latest,
      updateAvailable: data.updateAvailable,
      lastChecked: new Date().toISOString(),
    }));

    return data.updateAvailable;
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
 * Download and install the update
 */
export async function downloadAndInstall(): Promise<void> {
  const state = await new Promise<UpdateState>(resolve => {
    updateState.subscribe(s => resolve(s))();
  });

  if (!state.latestVersion) {
    throw new Error('No update available to download');
  }

  if (!Capacitor.isNativePlatform()) {
    // On web, just open download URL in new tab
    const baseUrl = await getApiBaseUrlAsync() || window.location.origin;
    window.open(`${baseUrl}${state.latestVersion.downloadUrl}`, '_blank');
    return;
  }

  updateState.update(s => ({ ...s, downloading: true, downloadProgress: 0, error: null }));

  try {
    // Use native plugin for download and install
    const { NativeUpdater } = await import('./plugins/native-updater');

    // Get full download URL
    const baseUrl = await getApiBaseUrlAsync() || window.location.origin;
    const downloadUrl = `${baseUrl}${state.latestVersion.downloadUrl}`;

    // Start download with progress tracking
    await NativeUpdater.addListener('downloadProgress', (event: { progress: number }) => {
      updateState.update(s => ({ ...s, downloadProgress: event.progress }));
    });

    const result = await NativeUpdater.downloadAndInstall({
      url: downloadUrl,
      version: state.latestVersion.version,
    });

    if (!result.success) {
      throw new Error(result.error || 'Download failed');
    }

    // Download complete - install will be triggered by native side
    updateState.update(s => ({ ...s, downloading: false, downloadProgress: 100 }));
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : 'Download failed';
    updateState.update(s => ({
      ...s,
      downloading: false,
      error: errorMsg,
    }));
    throw e;
  }
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
  if (!Capacitor.isNativePlatform()) {
    return; // Only run on mobile
  }

  // Get current app info
  const appInfo = await getCurrentAppInfo();
  updateState.update(s => ({
    ...s,
    currentVersion: appInfo.version,
    currentVersionCode: appInfo.versionCode,
  }));
}
