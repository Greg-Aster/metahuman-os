/**
 * Node.js Mobile Plugin
 *
 * Capacitor plugin interface for running Node.js on mobile devices.
 * This enables the mobile app to run the SAME server code as the web app.
 *
 * LOCAL-FIRST ARCHITECTURE:
 * - Mobile: API handlers run locally via nodejs-mobile
 * - Web: API handlers run on the server
 * - SAME CODE, SAME FUNCTIONALITY
 */

// Type-only import - erased at runtime, safe for web
import type { PluginListenerHandle } from '@capacitor/core';

export interface NodejsStartOptions {
  script?: string;
  redirectOutputToLogcat?: boolean;
}

export interface NodejsStatusResult {
  ready: boolean;
  initialized: boolean;
  engineStarted: boolean;
  librariesLoaded?: boolean;
}

export interface NodejsSendOptions {
  channel?: string;
  message: string;
}

export interface NodejsMessageEvent {
  channel: string;
  message: string;
}

export interface NodejsMobilePlugin {
  start(options?: NodejsStartOptions): Promise<void>;
  send(options: NodejsSendOptions): Promise<void>;
  isReady(): Promise<NodejsStatusResult>;
  addListener(
    eventName: 'message' | 'ready',
    listenerFunc: (event: any) => void
  ): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}

// Helper to check if we're on native platform
function isCapacitorNative(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (window as any).Capacitor;
  return cap?.isNativePlatform?.() === true;
}

/**
 * Get the native plugin directly from Capacitor's registry.
 * This avoids issues with dynamic imports and bundler wrapping.
 */
function getNativePlugin(): NodejsMobilePlugin | null {
  if (typeof window === 'undefined') return null;

  const cap = (window as any).Capacitor;
  if (!cap?.isNativePlatform?.()) return null;

  // Capacitor exposes registered plugins on the Capacitor.Plugins object
  // This is set up automatically when the native plugin loads
  const plugins = cap.Plugins;
  if (plugins?.NodejsMobile) {
    return plugins.NodejsMobile as NodejsMobilePlugin;
  }

  // Fallback: try to register the plugin if not yet registered
  // This should rarely be needed as the plugin auto-registers on native
  try {
    const { registerPlugin } = cap;
    if (registerPlugin) {
      return registerPlugin('NodejsMobile') as NodejsMobilePlugin;
    }
  } catch (e) {
    console.error('[nodejs-mobile] Failed to register plugin:', e);
  }

  return null;
}

// Cached plugin instance
let _plugin: NodejsMobilePlugin | null = null;

/**
 * Get the NodejsMobile plugin instance.
 * Returns native plugin on mobile, web fallback on web.
 */
function getPlugin(): NodejsMobilePlugin {
  if (_plugin) return _plugin;

  // Try to get native plugin
  const native = getNativePlugin();
  if (native) {
    _plugin = native;
    return _plugin;
  }

  // Web fallback - no-op since Node.js doesn't run on web
  _plugin = {
    async start(_options?: NodejsStartOptions): Promise<void> {
      console.log('[nodejs-mobile] Not available on web platform');
    },
    async send(_options: NodejsSendOptions): Promise<void> {
      console.log('[nodejs-mobile] Not available on web platform');
    },
    async isReady(): Promise<NodejsStatusResult> {
      return { ready: false, initialized: false, engineStarted: false };
    },
    async addListener(
      _eventName: string,
      _listenerFunc: (event: any) => void
    ): Promise<PluginListenerHandle> {
      return { remove: async () => {} };
    },
    async removeAllListeners(): Promise<void> {}
  };

  return _plugin;
}

/**
 * NodejsMobile plugin interface.
 *
 * On native: calls the actual Capacitor plugin
 * On web: returns no-op fallbacks
 */
export const NodejsMobile: NodejsMobilePlugin = {
  start(options?: NodejsStartOptions): Promise<void> {
    return getPlugin().start(options);
  },
  send(options: NodejsSendOptions): Promise<void> {
    return getPlugin().send(options);
  },
  isReady(): Promise<NodejsStatusResult> {
    return getPlugin().isReady();
  },
  addListener(
    eventName: 'message' | 'ready',
    listenerFunc: (event: any) => void
  ): Promise<PluginListenerHandle> {
    return getPlugin().addListener(eventName, listenerFunc);
  },
  removeAllListeners(): Promise<void> {
    return getPlugin().removeAllListeners();
  }
};

/**
 * Check if nodejs-mobile is available (must be on native platform)
 */
export function isNodejsMobileAvailable(): boolean {
  return isCapacitorNative();
}

/**
 * Convenience function to get plugin status
 */
export function getNodejsStatus(): Promise<NodejsStatusResult> {
  return NodejsMobile.isReady();
}
