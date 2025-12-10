/**
 * Node.js Mobile Bridge
 *
 * UNIFIED ARCHITECTURE - Same code for web and mobile:
 * - Mobile: HTTP requests to local nodejs-mobile server (localhost:4322)
 * - Web: HTTP requests to Astro server (localhost:4321)
 *
 * Both use standard HTTP with cookies - SAME CODE PATH.
 * The only difference is the base URL.
 */

import { isCapacitorNative } from './api-config';
import { NodejsMobile, isNodejsMobileAvailable as checkNodejsMobileAvailable } from './plugins/nodejs-mobile';

// CapacitorHttp types for TypeScript (avoids importing @capacitor/core on web)
type CapacitorHttpType = {
  get: (options: { url: string }) => Promise<{ status: number; data: unknown; headers: Record<string, string> }>;
  request: (options: { url: string; method: string; data?: unknown; headers?: Record<string, string> }) => Promise<{ status: number; data: unknown; headers: Record<string, string> }>;
};

// CapacitorHttp is loaded dynamically only on mobile to avoid breaking web builds
// The browser can't resolve bare module specifiers like "@capacitor/core"
let CapacitorHttp: CapacitorHttpType | null = null;
let capacitorLoaded = false;
let capacitorLoadPromise: Promise<void> | null = null;

// Load CapacitorHttp on mobile (async initialization)
// NOTE: We cannot return CapacitorHttp directly because it has a .then() method
// that throws "CapacitorHttp.then() is not implemented". Returning it would cause
// JavaScript to try to unwrap it as a Promise.
async function ensureCapacitorHttp(): Promise<void> {
  if (capacitorLoaded) return;

  // Avoid multiple concurrent loads
  if (capacitorLoadPromise) {
    await capacitorLoadPromise;
    return;
  }

  capacitorLoadPromise = (async () => {
    if (typeof window !== 'undefined' && isCapacitorNative()) {
      try {
        const mod = await import('@capacitor/core');
        CapacitorHttp = mod.CapacitorHttp as unknown as CapacitorHttpType;
        capacitorLoaded = true;
      } catch {
        console.warn('[node-bridge] Failed to load CapacitorHttp');
        capacitorLoaded = true;
      }
    } else {
      capacitorLoaded = true;
    }
  })();

  await capacitorLoadPromise;
}

// Get CapacitorHttp synchronously (must call ensureCapacitorHttp first)
function getCapacitorHttp(): CapacitorHttpType | null {
  return CapacitorHttp;
}

// Mobile HTTP server port (nodejs-mobile runs on this port)
const MOBILE_HTTP_PORT = 4322;
const MOBILE_BASE_URL = `http://127.0.0.1:${MOBILE_HTTP_PORT}`;

// State
let nodeReady = false;
let nodeStarting = false;
let httpServerReady = false;

/**
 * Check if nodejs-mobile is available
 */
export function isNodejsMobileAvailable(): boolean {
  return checkNodejsMobileAvailable();
}

/**
 * Check if Node.js backend is ready
 */
export function isNodeReady(): boolean {
  return nodeReady && httpServerReady;
}

/**
 * Start the Node.js runtime and wait for HTTP server
 */
export async function startNodeRuntime(): Promise<void> {
  if (!isCapacitorNative() || !isNodejsMobileAvailable()) {
    console.log('[node-bridge] Not on mobile or nodejs not available');
    return;
  }

  if (nodeReady || nodeStarting) {
    return;
  }

  nodeStarting = true;

  try {
    // First check if engine is already running (page reload case)
    const initialStatus = await NodejsMobile.isReady();
    console.log('[node-bridge] Initial status check:', initialStatus);

    if (initialStatus.engineStarted) {
      console.log('[node-bridge] Node.js engine already running');
      nodeReady = true;
      // Check if HTTP server is responding
      await waitForHttpServer();
      nodeStarting = false;
      return;
    }

    // Start Node.js with main.js
    console.log('[node-bridge] Starting Node.js runtime...');
    await NodejsMobile.start({ script: 'main.js', redirectOutputToLogcat: true });
    console.log('[node-bridge] Node.js start called - waiting for HTTP server');

    // Wait for engine to be ready
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!nodeReady) {
          nodeStarting = false;
          reject(new Error('Node.js startup timeout'));
        }
      }, 15000);

      const checkReady = setInterval(async () => {
        try {
          const status = await NodejsMobile.isReady();
          if (status.engineStarted) {
            nodeReady = true;
            clearInterval(checkReady);
            clearTimeout(timeout);
            console.log('[node-bridge] Node.js runtime ready');
            resolve();
          }
        } catch (e) {
          console.error('[node-bridge] isReady check failed:', e);
        }
      }, 500);
    });

    // Wait for HTTP server to be ready
    await waitForHttpServer();
    nodeStarting = false;

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (errorMsg.includes('already started')) {
      console.log('[node-bridge] Engine was already started');
      nodeReady = true;
      await waitForHttpServer();
      nodeStarting = false;
      return;
    }

    console.error('[node-bridge] Failed to start Node.js:', error);
    nodeStarting = false;
    throw error;
  }
}

/**
 * Wait for HTTP server to be responding
 * Uses Capacitor's native HTTP plugin to bypass WebView restrictions
 */
async function waitForHttpServer(timeoutMs: number = 10000): Promise<boolean> {
  const startTime = Date.now();
  await ensureCapacitorHttp();
  const http = getCapacitorHttp();

  if (!http) {
    console.error('[node-bridge] CapacitorHttp not available');
    return false;
  }

  while (Date.now() - startTime < timeoutMs) {
    try {
      // Use Capacitor's native HTTP to bypass WebView restrictions
      const response = await http.get({
        url: `${MOBILE_BASE_URL}/api/status`,
      });

      if (response.status >= 200 && response.status < 300) {
        httpServerReady = true;
        console.log('[node-bridge] HTTP server ready');
        return true;
      }
    } catch {
      // Server not ready yet, keep trying
    }

    await new Promise(resolve => setTimeout(resolve, 200));
  }

  console.error('[node-bridge] HTTP server failed to start');
  return false;
}

/**
 * Wait for Node.js runtime to be ready (with timeout)
 */
async function waitForNodeReady(timeoutMs: number = 10000): Promise<boolean> {
  if (nodeReady && httpServerReady) return true;

  // Try to start the runtime if it hasn't been started
  if (!nodeStarting && !nodeReady) {
    console.log('[node-bridge] Runtime not started, starting now...');
    try {
      await startNodeRuntime();
    } catch (err) {
      console.error('[node-bridge] Failed to start runtime:', err);
      return false;
    }
  }

  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    if (nodeReady && httpServerReady) return true;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return nodeReady && httpServerReady;
}

/**
 * Create an offline response when nodejs-mobile is not available
 */
function createOfflineResponse(path: string, reason: string): Response {
  console.warn(`[node-bridge] Unhandled endpoint ${path}: ${reason}`);
  return new Response(
    JSON.stringify({
      success: false,
      error: reason,
      offline: true,
      localFirst: true,
    }),
    {
      status: 503,
      statusText: 'Service Unavailable',
      headers: {
        'Content-Type': 'application/json',
        'X-Offline-Response': 'true',
      },
    }
  );
}

/**
 * Get session ID from localStorage (stored by AuthGate after login/sync)
 */
function getStoredSessionId(): string | null {
  try {
    const stored = localStorage.getItem('mh_session');
    if (stored) {
      const parsed = JSON.parse(stored);
      return parsed.sessionId || null;
    }
  } catch {
    // Ignore parse errors
  }
  return null;
}

/**
 * Make HTTP request to mobile Node.js server
 * Uses Capacitor's native HTTP to bypass WebView restrictions
 */
async function fetchFromMobile(path: string, init?: RequestInit): Promise<Response> {
  const url = `${MOBILE_BASE_URL}${path}`;
  await ensureCapacitorHttp();
  const http = getCapacitorHttp();

  if (!http) {
    throw new Error('CapacitorHttp not available');
  }

  // Use Capacitor's native HTTP plugin to bypass WebView restrictions
  const method = (init?.method || 'GET').toUpperCase();

  // Parse body if present
  let data: Record<string, unknown> | undefined;
  if (init?.body) {
    try {
      data = typeof init.body === 'string' ? JSON.parse(init.body) : init.body as unknown as Record<string, unknown>;
    } catch {
      // If not JSON, keep as string
      data = { _raw: String(init.body) };
    }
  }

  // Build headers - include session cookie from localStorage
  // CapacitorHttp doesn't always persist cookies for localhost, so we pass it explicitly
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> || {}),
  };

  const sessionId = getStoredSessionId();
  if (sessionId) {
    headers['Cookie'] = `mh_session=${sessionId}`;
  }

  // Make request using Capacitor HTTP
  const response = await http.request({
    url,
    method,
    data,
    headers,
  });

  // Convert CapacitorHttp response to standard Response
  const responseBody = typeof response.data === 'string'
    ? response.data
    : JSON.stringify(response.data);

  return new Response(responseBody, {
    status: response.status,
    headers: new Headers(response.headers),
  });
}

/**
 * Smart API fetch that routes to Node.js on mobile, server on web
 *
 * UNIFIED ARCHITECTURE:
 * - Mobile: HTTP to localhost:4322 (nodejs-mobile HTTP server)
 * - Web: HTTP to same-origin (Astro server)
 *
 * Both use cookies for auth - SAME CODE PATH
 *
 * Usage:
 *   import { nodeBridge } from './node-bridge';
 *   const response = await nodeBridge('/api/memories');
 */
export async function nodeBridge(path: string, init?: RequestInit): Promise<Response> {
  // Mobile: HTTP to local nodejs-mobile server
  if (isCapacitorNative()) {
    if (!isNodejsMobileAvailable()) {
      return createOfflineResponse(path, 'nodejs-mobile not available');
    }

    // Wait for runtime to be ready
    if (!nodeReady || !httpServerReady) {
      console.log(`[node-bridge] Waiting for runtime before ${path}...`);
      const ready = await waitForNodeReady(10000);
      if (!ready) {
        return createOfflineResponse(path, 'Local runtime startup timeout');
      }
      console.log(`[node-bridge] Runtime ready, proceeding with ${path}`);
    }

    // HTTP request to local server - SAME AS WEB, just different port
    try {
      return await fetchFromMobile(path, init);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Local request failed';
      return createOfflineResponse(path, errorMsg);
    }
  }

  // Web: Standard fetch to same-origin server
  return fetch(path, {
    ...init,
    credentials: 'include', // Include cookies
  });
}

/**
 * Initialize the Node.js bridge (call this at app startup)
 */
export async function initNodeBridge(): Promise<void> {
  if (!isCapacitorNative()) {
    console.log('[node-bridge] Not on mobile, skipping Node.js init');
    return;
  }

  if (!isNodejsMobileAvailable()) {
    console.log('[node-bridge] nodejs-mobile not available');
    return;
  }

  try {
    await startNodeRuntime();
    console.log('[node-bridge] Node.js bridge initialized');
  } catch (error) {
    console.error('[node-bridge] Failed to initialize:', error);
  }
}
