/**
 * Native Updater Plugin
 *
 * Capacitor plugin interface for downloading and installing APK updates.
 */

// Type-only import - erased at runtime, safe for web
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

// Helper to check if we're on native platform (without importing Capacitor)
function isCapacitorNative(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (window as any).Capacitor;
  return cap?.isNativePlatform?.() === true;
}

// Lazy-loaded plugin instance
let _nativeUpdaterPlugin: NativeUpdaterPlugin | null = null;

/**
 * Get the NativeUpdater plugin instance.
 * Uses dynamic import to avoid loading @capacitor/core on web.
 */
async function getNativeUpdaterPlugin(): Promise<NativeUpdaterPlugin> {
  if (_nativeUpdaterPlugin) {
    return _nativeUpdaterPlugin;
  }

  // Check if we're on native platform first
  if (!isCapacitorNative()) {
    _nativeUpdaterPlugin = new NativeUpdaterWeb();
    return _nativeUpdaterPlugin;
  }

  // Dynamic import of Capacitor only on native
  const { registerPlugin } = await import('@capacitor/core');
  _nativeUpdaterPlugin = registerPlugin<NativeUpdaterPlugin>('NativeUpdater');
  return _nativeUpdaterPlugin;
}

// Proxy object that lazily initializes the plugin
export const NativeUpdater: NativeUpdaterPlugin = {
  async getAppInfo() {
    const plugin = await getNativeUpdaterPlugin();
    return plugin.getAppInfo();
  },
  async downloadAndInstall(options) {
    const plugin = await getNativeUpdaterPlugin();
    return plugin.downloadAndInstall(options);
  },
  async cancelDownload() {
    const plugin = await getNativeUpdaterPlugin();
    return plugin.cancelDownload();
  },
  async canInstallApk() {
    const plugin = await getNativeUpdaterPlugin();
    return plugin.canInstallApk();
  },
  async requestInstallPermission() {
    const plugin = await getNativeUpdaterPlugin();
    return plugin.requestInstallPermission();
  },
  async addListener(eventName: any, listenerFunc: any) {
    const plugin = await getNativeUpdaterPlugin();
    return plugin.addListener(eventName, listenerFunc);
  },
  async removeAllListeners() {
    const plugin = await getNativeUpdaterPlugin();
    return plugin.removeAllListeners();
  },
};
