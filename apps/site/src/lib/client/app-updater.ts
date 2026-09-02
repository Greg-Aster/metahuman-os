/**
 * App Update Checker
 *
 * Platform-aware update system:
 * - Mobile (React Native): Opens the configured server's APK download
 * - Web/Desktop: Uses git pull to update server code
 */

import { writable, derived, type Writable } from 'svelte/store';
import { apiFetch, isMobileApp, isReactNativeWebView } from './api-config';
import { getRemoteSyncConfig } from './profile-sync';

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
  restartRequired: boolean;
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
  restartRequired: false,
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
let nativeUpdateListenerInstalled = false;
let mobileReleaseBaseUrl: string | null = null;

function handleNativeUpdateMessage(event: Event): void {
  const raw = (event as MessageEvent).data;
  if (typeof raw !== 'string') return;

  let message: Record<string, unknown>;
  try {
    message = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return;
  }

  if (message.type !== 'url-opened' || typeof message.url !== 'string' || !message.url.includes('/api/mobile/download')) {
    return;
  }

  if (message.success === true) {
    updateState.update(state => ({
      ...state,
      updating: false,
      updateProgress: 100,
      error: null,
    }));
    return;
  }

  const error = typeof message.error === 'string' ? message.error : 'The mobile release download could not be opened';
  updateState.update(state => ({
    ...state,
    updating: false,
    error,
  }));
}

function installNativeUpdateListener(): void {
  if (nativeUpdateListenerInstalled || typeof window === 'undefined') return;
  window.addEventListener('message', handleNativeUpdateMessage);
  document.addEventListener('message', handleNativeUpdateMessage);
  nativeUpdateListenerInstalled = true;
}

function parseAppInfo(value: unknown): AppInfo {
  if (!value || typeof value !== 'object') {
    throw new Error('App information response must be an object');
  }
  const record = value as Record<string, unknown>;
  if (typeof record.version !== 'string' || record.version.trim().length === 0) {
    throw new Error('App information is missing a version');
  }
  if (!Number.isInteger(record.versionCode) || (record.versionCode as number) < 0) {
    throw new Error('App information contains an invalid version code');
  }
  if (typeof record.packageName !== 'string' || record.packageName.trim().length === 0) {
    throw new Error('App information is missing a package name');
  }
  return {
    version: record.version.trim(),
    versionCode: record.versionCode as number,
    packageName: record.packageName.trim(),
  };
}

/**
 * Detect current platform
 */
export function detectPlatform(): 'mobile' | 'server' {
  return isMobileApp() ? 'mobile' : 'server';
}

/**
 * Get current app info from the maintained React Native bridge
 */
async function getCurrentAppInfo(): Promise<AppInfo> {
  if (!isMobileApp()) {
    throw new Error('Mobile app information was requested outside the mobile app');
  }

  if (isReactNativeWebView()) {
    const response = await apiFetch('/api/app-info');
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(errorData.error || `App information request returned ${response.status}`);
    }
    return parseAppInfo(await response.json());
  }

  throw new Error('This mobile runtime does not expose the maintained React Native update bridge');
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
    throw e instanceof Error ? e : new Error(errorMsg);
  }
}

/**
 * Check for mobile APK updates
 */
async function checkMobileUpdate(): Promise<boolean> {
  const appInfo = await getCurrentAppInfo();
  const remoteConfig = await getRemoteSyncConfig();
  if (!remoteConfig.configured || !remoteConfig.serverUrl) {
    throw new Error('Configure a remote MetaHuman server before checking for mobile updates');
  }
  const versionUrl = new URL('/api/mobile/version', remoteConfig.serverUrl);
  versionUrl.searchParams.set('current', appInfo.version);
  versionUrl.searchParams.set('versionCode', String(appInfo.versionCode));

  updateState.update(s => ({
    ...s,
    currentVersion: appInfo.version,
    currentVersionCode: appInfo.versionCode,
  }));

  const response = await fetch(versionUrl, { credentials: 'omit' });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(errorData.error || `Server returned ${response.status}`);
  }

  const data = await response.json();
  if (!data?.latest || typeof data.latest.downloadUrl !== 'string') {
    throw new Error('Mobile update server returned invalid release metadata');
  }
  mobileReleaseBaseUrl = remoteConfig.serverUrl;

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
    return await downloadMobileRelease();
  } else {
    return await updateServer();
  }
}

/**
 * Download and install APK (mobile)
 */
async function downloadMobileRelease(): Promise<void> {
  const state = await new Promise<UpdateState>(resolve => {
    updateState.subscribe(s => resolve(s))();
  });

  if (!state.latestMobileVersion) {
    throw new Error('No update available to download');
  }

  updateState.update(s => ({ ...s, updating: true, updateProgress: 0, error: null }));

  try {
    // Get full download URL
    if (!mobileReleaseBaseUrl) {
      throw new Error('Check for mobile updates before starting a download');
    }
    const downloadUrl = new URL(state.latestMobileVersion.downloadUrl, mobileReleaseBaseUrl).toString();

    if (isReactNativeWebView()) {
      // React Native: ask the native layer to open the signed APK download.
      if (!(window as any).ReactNativeWebView) {
        throw new Error('React Native update bridge is unavailable');
      }
      (window as any).ReactNativeWebView.postMessage(JSON.stringify({
        type: 'open-url',
        url: downloadUrl,
        purpose: 'mobile-update',
      }));
      updateState.update(s => ({ ...s, updateProgress: 10 }));
    } else {
      throw new Error('This mobile runtime cannot install MetaHuman updates');
    }
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
      restartRequired: result.restartRequired === true,
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
  if (isMobileApp()) {
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
    installNativeUpdateListener();
    try {
      const appInfo = await getCurrentAppInfo();
      updateState.update(s => ({
        ...s,
        currentVersion: appInfo.version,
        currentVersionCode: appInfo.versionCode,
        error: null,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load mobile app information';
      updateState.update(s => ({ ...s, error: message }));
      throw error instanceof Error ? error : new Error(message);
    }
  }
}
