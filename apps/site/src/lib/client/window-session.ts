/**
 * Window Session Manager
 *
 * Manages browser window/tab tracking for multi-window support.
 * Uses SSE for real-time updates - NO POLLING.
 *
 * Architecture:
 * - Register window on page load (single POST)
 * - SSE stream for real-time updates from server
 * - BroadcastChannel for instant same-browser coordination
 * - Close window on page unload (single DELETE)
 */

import { writable, derived, type Readable, type Writable } from 'svelte/store';
import { apiFetch } from './api-config';

export interface WindowInfo {
  windowId: string;
  isActive: boolean;
  lastActivity: string;
  title?: string;
  metadata?: Record<string, unknown>;
}

export interface WindowSessionState {
  windowId: string | null;
  isRegistered: boolean;
  multiWindowMode: boolean;
  windowCount: number;
  otherWindows: WindowInfo[];
  connected: boolean;
  error?: string;
}

// Current window session state
const windowState: Writable<WindowSessionState> = writable({
  windowId: null,
  isRegistered: false,
  multiWindowMode: false,
  windowCount: 0,
  otherWindows: [],
  connected: false,
});

// SSE connection
let eventSource: EventSource | null = null;

// BroadcastChannel for instant same-browser coordination
let broadcastChannel: BroadcastChannel | null = null;

/**
 * Register this window with the server (single POST, no polling)
 */
async function registerWindow(): Promise<string | null> {
  try {
    const response = await apiFetch('/api/window-session', {
      method: 'POST',
      body: JSON.stringify({
        title: document.title,
        url: window.location.pathname,
        userAgent: navigator.userAgent,
        viewState: 'chat',
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      windowState.update(s => ({ ...s, error: error.error || 'Registration failed' }));
      return null;
    }

    const data = await response.json();

    windowState.update(s => ({
      ...s,
      windowId: data.windowId,
      isRegistered: true,
      multiWindowMode: data.multiWindow,
      windowCount: data.windowCount,
      error: undefined,
    }));

    // Store window ID in sessionStorage for recovery
    sessionStorage.setItem('mh_window_id', data.windowId);

    // Notify other tabs via BroadcastChannel
    broadcastChannel?.postMessage({
      type: 'window-registered',
      windowId: data.windowId,
    });

    console.log(`[window-session] Registered window: ${data.windowId}`);
    return data.windowId;
  } catch (error) {
    console.error('[window-session] Failed to register window:', error);
    windowState.update(s => ({ ...s, error: 'Network error' }));
    return null;
  }
}

/**
 * Connect to SSE stream for real-time updates
 */
function connectSSE(): void {
  if (eventSource) {
    eventSource.close();
  }

  eventSource = new EventSource('/api/window-session/stream');

  eventSource.onopen = () => {
    console.log('[window-session] SSE connected');
    windowState.update(s => ({ ...s, connected: true, error: undefined }));
  };

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      let currentWindowId: string | null = null;
      windowState.subscribe(s => currentWindowId = s.windowId)();

      windowState.update(s => ({
        ...s,
        multiWindowMode: data.multiWindow,
        windowCount: data.windowCount,
        otherWindows: data.windows?.filter((w: WindowInfo) => w.windowId !== currentWindowId) || [],
      }));
    } catch (error) {
      console.error('[window-session] Failed to parse SSE message:', error);
    }
  };

  eventSource.onerror = () => {
    console.warn('[window-session] SSE connection error, will reconnect...');
    windowState.update(s => ({ ...s, connected: false }));

    // EventSource auto-reconnects, but we track state
    setTimeout(() => {
      let connected = false;
      windowState.subscribe(s => connected = s.connected)();
      if (!connected && eventSource?.readyState === EventSource.CLOSED) {
        // Connection fully closed, reconnect
        connectSSE();
      }
    }, 5000);
  };
}

/**
 * Set up BroadcastChannel for instant same-browser coordination
 */
function setupBroadcastChannel(): void {
  if (typeof BroadcastChannel === 'undefined') {
    console.log('[window-session] BroadcastChannel not supported');
    return;
  }

  broadcastChannel = new BroadcastChannel('mh-window-session');

  broadcastChannel.onmessage = (event) => {
    const { type, windowId } = event.data;

    let currentWindowId: string | null = null;
    windowState.subscribe(s => currentWindowId = s.windowId)();

    if (type === 'window-registered' && windowId !== currentWindowId) {
      // Another tab registered, update our state
      windowState.update(s => ({
        ...s,
        multiWindowMode: true,
        windowCount: s.windowCount + 1,
      }));
    } else if (type === 'window-closed' && windowId !== currentWindowId) {
      // Another tab closed
      windowState.update(s => ({
        ...s,
        windowCount: Math.max(0, s.windowCount - 1),
        multiWindowMode: s.windowCount > 2,
        otherWindows: s.otherWindows.filter(w => w.windowId !== windowId),
      }));
    }
  };
}

/**
 * Close window session (called on beforeunload)
 */
async function closeWindow(): Promise<void> {
  let currentWindowId: string | null = null;
  windowState.subscribe(s => currentWindowId = s.windowId)();

  if (!currentWindowId) return;

  // Notify other tabs immediately via BroadcastChannel
  broadcastChannel?.postMessage({
    type: 'window-closed',
    windowId: currentWindowId,
  });

  // Close SSE connection
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }

  // Use fetch with keepalive for reliable delivery on page unload
  const url = `/api/window-session/${currentWindowId}`;
  try {
    await fetch(url, {
      method: 'DELETE',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    // Ignore errors on unload
  }

  sessionStorage.removeItem('mh_window_id');
}

/**
 * Update window activity (called on focus/blur/visibility change)
 */
function updateActivity(isActive: boolean): void {
  let currentWindowId: string | null = null;
  windowState.subscribe(s => currentWindowId = s.windowId)();

  if (!currentWindowId) return;

  // Fire-and-forget activity update
  apiFetch(`/api/window-session/${currentWindowId}/heartbeat`, {
    method: 'POST',
    body: JSON.stringify({
      isActive,
      metadata: {
        url: window.location.pathname,
        title: document.title,
      },
    }),
  }).catch(() => {
    // Ignore errors for activity updates
  });
}

/**
 * Start window session tracking
 */
export function startWindowSession(): void {
  // Set up BroadcastChannel first for instant same-browser coordination
  setupBroadcastChannel();

  // Check if already registered (e.g., from a previous session)
  const existingWindowId = sessionStorage.getItem('mh_window_id');

  if (existingWindowId) {
    // Try to validate existing session
    apiFetch(`/api/window-session/${existingWindowId}`)
      .then(async response => {
        if (response.ok) {
          const data = await response.json();
          windowState.update(s => ({
            ...s,
            windowId: data.windowId,
            isRegistered: true,
          }));
          console.log('[window-session] Recovered existing window session');
          connectSSE();
        } else {
          // Session expired, register new one
          await registerWindow();
          connectSSE();
        }
      })
      .catch(async () => {
        await registerWindow();
        connectSSE();
      });
  } else {
    registerWindow().then(() => connectSSE());
  }

  // Register cleanup on page unload
  window.addEventListener('beforeunload', closeWindow);

  // Track focus changes (fire-and-forget updates, no polling)
  window.addEventListener('focus', () => updateActivity(true));
  window.addEventListener('blur', () => updateActivity(false));

  // Track visibility changes
  document.addEventListener('visibilitychange', () => {
    updateActivity(document.visibilityState === 'visible');
  });
}

/**
 * Stop window session tracking
 */
export function stopWindowSession(): void {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }

  if (broadcastChannel) {
    broadcastChannel.close();
    broadcastChannel = null;
  }

  window.removeEventListener('beforeunload', closeWindow);
  closeWindow();

  windowState.set({
    windowId: null,
    isRegistered: false,
    multiWindowMode: false,
    windowCount: 0,
    otherWindows: [],
    connected: false,
  });
}

/**
 * Get current window ID (for use in API calls)
 */
export function getWindowId(): string | null {
  let windowId: string | null = null;
  windowState.subscribe(s => windowId = s.windowId)();
  return windowId;
}

/**
 * Check if running in multi-window mode
 */
export function isMultiWindowMode(): boolean {
  let multiWindow = false;
  windowState.subscribe(s => multiWindow = s.multiWindowMode)();
  return multiWindow;
}

// Derived stores for UI
export const windowSession: Readable<WindowSessionState> = { subscribe: windowState.subscribe };
export const isMultiWindow: Readable<boolean> = derived(windowState, $s => $s.multiWindowMode);
export const windowCount: Readable<number> = derived(windowState, $s => $s.windowCount);
export const otherWindows: Readable<WindowInfo[]> = derived(windowState, $s => $s.otherWindows);
export const currentWindowId: Readable<string | null> = derived(windowState, $s => $s.windowId);
export const isConnected: Readable<boolean> = derived(windowState, $s => $s.connected);
