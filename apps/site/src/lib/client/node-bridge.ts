/**
 * Node.js Mobile Bridge
 *
 * Provides communication between the Svelte UI and the embedded
 * Node.js runtime (via nodejs-mobile-cordova plugin).
 *
 * LOCAL-FIRST ARCHITECTURE:
 * - Mobile: API calls go through nodejs-mobile LOCALLY
 * - If nodejs-mobile not ready: Return offline response (NEVER call remote server)
 * - Web: Uses standard apiFetch to same-origin server
 *
 * The mobile app is a FULL STANDALONE PROGRAM, not a thin client.
 * Server connections are NEVER automatic - only when user explicitly syncs.
 */

import { isCapacitorNative } from './api-config';
import { apiFetch } from './api-config';

// TypeScript declaration for the nodejs global
declare global {
  interface Window {
    nodejs?: {
      start: (scriptFileName: string, callback: (err?: Error) => void, options?: { redirectOutputToLogcat?: boolean }) => void;
      startWithScript: (scriptBody: string, callback: (err?: Error) => void, options?: { redirectOutputToLogcat?: boolean }) => void;
      channel: {
        on: (event: string, callback: (msg: any) => void) => void;
        post: (event: string, message: any) => void;
        send: (message: any) => void;
        setListener: (callback: (msg: any) => void) => void;
      };
    };
  }
}

// Request/Response types
interface NodeRequest {
  id: string;
  path: string;
  method: string;
  body?: any;
  headers?: Record<string, string>;
}

interface NodeResponse {
  id: string;
  status: number;
  data?: any;
  error?: string;
}

// State
let nodeReady = false;
let nodeStarting = false;
const pendingRequests = new Map<string, {
  resolve: (value: Response) => void;
  reject: (reason: any) => void;
}>();

// Generate unique request ID
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Check if nodejs-mobile is available
 */
export function isNodejsMobileAvailable(): boolean {
  return typeof window !== 'undefined' && window.nodejs !== undefined;
}

/**
 * Check if Node.js backend is ready
 */
export function isNodeReady(): boolean {
  return nodeReady;
}

/**
 * Start the Node.js runtime
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

  return new Promise((resolve, reject) => {
    const nodejs = window.nodejs!;

    // Listen for ready event
    nodejs.channel.on('ready', (msg) => {
      console.log('[node-bridge] Node.js runtime ready:', msg);
      nodeReady = true;
      nodeStarting = false;
      resolve();
    });

    // Listen for responses
    nodejs.channel.on('response', (msg: NodeResponse) => {
      const pending = pendingRequests.get(msg.id);
      if (pending) {
        pendingRequests.delete(msg.id);

        // Convert to Response object
        const body = JSON.stringify(msg.data || { error: msg.error });
        const response = new Response(body, {
          status: msg.status,
          headers: { 'Content-Type': 'application/json' }
        });

        pending.resolve(response);
      }
    });

    // Start Node.js with main.js
    console.log('[node-bridge] Starting Node.js runtime...');
    nodejs.start('main.js', (err) => {
      if (err) {
        console.error('[node-bridge] Failed to start Node.js:', err);
        nodeStarting = false;
        reject(err);
      } else {
        console.log('[node-bridge] Node.js start callback - waiting for ready event');
      }
    }, {
      redirectOutputToLogcat: true
    });

    // Timeout after 10 seconds
    setTimeout(() => {
      if (!nodeReady) {
        nodeStarting = false;
        reject(new Error('Node.js startup timeout'));
      }
    }, 10000);
  });
}

/**
 * Send a request to the Node.js backend
 */
async function sendToNode(path: string, init?: RequestInit): Promise<Response> {
  if (!nodeReady || !window.nodejs) {
    throw new Error('Node.js runtime not ready');
  }

  const id = generateId();
  const method = init?.method || 'GET';
  let body: any = undefined;

  if (init?.body) {
    try {
      body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    } catch {
      body = init.body;
    }
  }

  const request: NodeRequest = {
    id,
    path,
    method,
    body
  };

  return new Promise((resolve, reject) => {
    // Store pending request
    pendingRequests.set(id, { resolve, reject });

    // Set timeout
    const timeout = setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${path}`));
      }
    }, 30000);

    // Send to Node.js
    window.nodejs!.channel.post('request', request);

    // Clear timeout on resolve/reject
    const originalResolve = resolve;
    const originalReject = reject;
    pendingRequests.set(id, {
      resolve: (value) => {
        clearTimeout(timeout);
        originalResolve(value);
      },
      reject: (reason) => {
        clearTimeout(timeout);
        originalReject(reason);
      }
    });
  });
}

/**
 * Create an offline response for mobile when Node.js isn't ready
 */
function createOfflineResponse(path: string, reason: string): Response {
  console.warn(`[node-bridge] Offline response for ${path}: ${reason}`);
  return new Response(
    JSON.stringify({
      success: false,
      error: reason,
      offline: true,
      localFirst: true,
    }),
    {
      status: 503,
      statusText: 'Offline',
      headers: {
        'Content-Type': 'application/json',
        'X-Offline-Response': 'true',
      },
    }
  );
}

/**
 * Smart API fetch that routes to Node.js on mobile, server on web
 *
 * LOCAL-FIRST ARCHITECTURE:
 * - Mobile: Use local nodejs-mobile backend ONLY
 * - Mobile (Node.js not ready): Return offline response - NEVER call remote server
 * - Web: Use apiFetch (same-origin server)
 *
 * Usage:
 *   import { nodeBridge } from './node-bridge';
 *   const response = await nodeBridge('/api/memories');
 */
export async function nodeBridge(path: string, init?: RequestInit): Promise<Response> {
  // Mobile: LOCAL-FIRST - use nodejs-mobile only, NEVER remote server
  if (isCapacitorNative()) {
    // Check if Node.js is available and ready
    if (!isNodejsMobileAvailable()) {
      return createOfflineResponse(path, 'nodejs-mobile not available');
    }

    if (!nodeReady) {
      return createOfflineResponse(path, 'Local runtime not ready');
    }

    // Use local Node.js backend
    try {
      return await sendToNode(path, init);
    } catch (error) {
      // Local request failed - return offline, do NOT fall back to remote server
      const errorMsg = error instanceof Error ? error.message : 'Local request failed';
      return createOfflineResponse(path, errorMsg);
    }
  }

  // Web: Use standard apiFetch to same-origin server (web IS the server)
  return apiFetch(path, init);
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
