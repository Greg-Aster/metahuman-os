/**
 * Native Updater Plugin
 *
 * Capacitor plugin interface for downloading and installing APK updates.
 */

import { registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';

export interface AppInfo {
  version: string;
  versionCode: number;
  packageName: string;
}

export interface DownloadOptions {
  url: string;
  version: string;
}

export interface DownloadResult {
  success: boolean;
  filePath?: string;
  error?: string;
}

export interface DownloadProgressEvent {
  progress: number;
  bytesDownloaded: number;
  totalBytes: number;
}

export interface NativeUpdaterPlugin {
  /**
   * Get current app version info
   */
  getAppInfo(): Promise<AppInfo>;

  /**
   * Download APK and trigger installation
   */
  downloadAndInstall(options: DownloadOptions): Promise<DownloadResult>;

  /**
   * Cancel ongoing download
   */
  cancelDownload(): Promise<void>;

  /**
   * Check if app has permission to install APKs
   */
  canInstallApk(): Promise<{ canInstall: boolean }>;

  /**
   * Request permission to install APKs (Android 8+)
   */
  requestInstallPermission(): Promise<{ granted: boolean }>;

  /**
   * Listen for download progress events
   */
  addListener(
    eventName: 'downloadProgress',
    listenerFunc: (event: DownloadProgressEvent) => void
  ): Promise<PluginListenerHandle>;

  /**
   * Listen for download completion
   */
  addListener(
    eventName: 'downloadComplete',
    listenerFunc: (event: { filePath: string }) => void
  ): Promise<PluginListenerHandle>;

  /**
   * Listen for download errors
   */
  addListener(
    eventName: 'downloadError',
    listenerFunc: (event: { error: string }) => void
  ): Promise<PluginListenerHandle>;

  /**
   * Remove all listeners
   */
  removeAllListeners(): Promise<void>;
}

// Web fallback implementation
class NativeUpdaterWeb implements NativeUpdaterPlugin {
  async getAppInfo(): Promise<AppInfo> {
    return {
      version: '0.0.0',
      versionCode: 0,
      packageName: 'com.metahuman.os',
    };
  }

  async downloadAndInstall(_options: DownloadOptions): Promise<DownloadResult> {
    return {
      success: false,
      error: 'APK installation is only available in the mobile app',
    };
  }

  async cancelDownload(): Promise<void> {
    // No-op on web
  }

  async canInstallApk(): Promise<{ canInstall: boolean }> {
    return { canInstall: false };
  }

  async requestInstallPermission(): Promise<{ granted: boolean }> {
    return { granted: false };
  }

  async addListener(
    _eventName: string,
    _listenerFunc: (event: any) => void
  ): Promise<PluginListenerHandle> {
    return {
      remove: async () => {},
    };
  }

  async removeAllListeners(): Promise<void> {
    // No-op on web
  }
}

// Register the plugin or use web fallback
import { Capacitor } from '@capacitor/core';

export const NativeUpdater: NativeUpdaterPlugin = Capacitor.isNativePlatform()
  ? registerPlugin<NativeUpdaterPlugin>('NativeUpdater')
  : new NativeUpdaterWeb();
