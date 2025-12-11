/**
 * Server Health Monitor
 *
 * LOCAL-FIRST ARCHITECTURE:
 * - Mobile (React Native): Checks local Node.js server at 127.0.0.1:4322
 * - Web: Checks same-origin server health
 *
 * This monitors the LOCAL system health, not remote server connectivity.
 * Remote server connectivity is only relevant for explicit sync operations.
 */

import { writable, derived, type Readable, type Writable } from 'svelte/store';
import { isReactNativeWebView } from './api-config';

export interface HealthStatus {
  connected: boolean;
  latencyMs: number;
  quality: 'excellent' | 'good' | 'fair' | 'poor' | 'offline';
  lastCheck: Date;
  consecutiveFailures: number;
  serverVersion?: string;
  error?: string;
}

export interface HealthConfig {
  checkIntervalMs: number;      // How often to check (default: 30s)
  timeoutMs: number;            // Connection timeout (default: 5s)
  maxConsecutiveFailures: number; // Before marking offline (default: 3)
}

// Quality thresholds (in milliseconds)
const QUALITY_THRESHOLDS = {
  excellent: 100,   // < 100ms
  good: 250,        // < 250ms
  fair: 500,        // < 500ms
  poor: 1000,       // < 1000ms
  // >= 1000ms or failed = offline
};

// Default configuration
const DEFAULT_CONFIG: HealthConfig = {
  checkIntervalMs: 30000,  // 30 seconds
  timeoutMs: 5000,         // 5 seconds
  maxConsecutiveFailures: 3,
};

// Current health status store
const healthStatus: Writable<HealthStatus> = writable({
  connected: false,
  latencyMs: 0,
  quality: 'offline',
  lastCheck: new Date(),
  consecutiveFailures: 0,
});

// Configuration store
const config: Writable<HealthConfig> = writable({ ...DEFAULT_CONFIG });

// Health check interval reference
let checkInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Calculate quality rating based on latency
 */
function calculateQuality(latencyMs: number, connected: boolean): HealthStatus['quality'] {
  if (!connected) return 'offline';
  if (latencyMs < QUALITY_THRESHOLDS.excellent) return 'excellent';
  if (latencyMs < QUALITY_THRESHOLDS.good) return 'good';
  if (latencyMs < QUALITY_THRESHOLDS.fair) return 'fair';
  if (latencyMs < QUALITY_THRESHOLDS.poor) return 'poor';
  return 'offline';
}

/**
 * Perform a single health check
 *
 * LOCAL-FIRST ARCHITECTURE:
 * - Mobile (React Native): Check local Node.js server at 127.0.0.1:4322
 * - Web: Check same-origin server health via local fetch
 */
export async function checkHealth(): Promise<HealthStatus> {
  let status: HealthStatus;
  const start = Date.now();

  // Determine health check URL based on platform
  const healthUrl = isReactNativeWebView()
    ? 'http://127.0.0.1:4322/api/status'
    : '/api/boot';

  // Check server health
  try {
    const response = await fetch(healthUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });

    const latencyMs = Date.now() - start;

    // 401/403 means server is reachable, just needs auth
    if (response.ok || response.status === 401 || response.status === 403) {
      let version: string | undefined;
      if (response.ok) {
        try {
          const data = await response.json();
          version = data.version;
        } catch { /* ignore */ }
      }

      status = {
        connected: true,
        latencyMs,
        quality: calculateQuality(latencyMs, true),
        lastCheck: new Date(),
        consecutiveFailures: 0,
        serverVersion: version,
      };
    } else {
      let currentFailures = 0;
      healthStatus.subscribe(s => { currentFailures = s.consecutiveFailures; })();

      status = {
        connected: false,
        latencyMs,
        quality: 'offline',
        lastCheck: new Date(),
        consecutiveFailures: currentFailures + 1,
        error: `Server returned ${response.status}`,
      };
    }
  } catch (err) {
    let currentFailures = 0;
    healthStatus.subscribe(s => { currentFailures = s.consecutiveFailures; })();

    status = {
      connected: false,
      latencyMs: Date.now() - start,
      quality: 'offline',
      lastCheck: new Date(),
      consecutiveFailures: currentFailures + 1,
      error: err instanceof Error ? err.message : 'Health check failed',
    };
  }

  healthStatus.set(status);
  return status;
}

/**
 * Start periodic health monitoring
 */
export function startHealthMonitor(customConfig?: Partial<HealthConfig>): void {
  // Stop existing monitor if running
  stopHealthMonitor();

  // Apply custom config
  if (customConfig) {
    config.update(c => ({ ...c, ...customConfig }));
  }

  // Get current config
  let currentConfig: HealthConfig = DEFAULT_CONFIG;
  config.subscribe(c => { currentConfig = c; })();

  // Perform initial check
  checkHealth();

  // Start periodic checks
  checkInterval = setInterval(() => {
    checkHealth();
  }, currentConfig.checkIntervalMs);

  console.log('[server-health] Monitor started with interval:', currentConfig.checkIntervalMs, 'ms');
}

/**
 * Stop health monitoring
 */
export function stopHealthMonitor(): void {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
    console.log('[server-health] Monitor stopped');
  }
}

/**
 * Force an immediate health check
 */
export async function forceHealthCheck(): Promise<HealthStatus> {
  return checkHealth();
}

/**
 * Update monitor configuration
 */
export function updateHealthConfig(newConfig: Partial<HealthConfig>): void {
  config.update(c => ({ ...c, ...newConfig }));

  // Restart monitor with new config if running
  if (checkInterval) {
    let currentConfig: HealthConfig = DEFAULT_CONFIG;
    config.subscribe(c => { currentConfig = c; })();

    clearInterval(checkInterval);
    checkInterval = setInterval(() => {
      checkHealth();
    }, currentConfig.checkIntervalMs);

    console.log('[server-health] Monitor restarted with new config');
  }
}

/**
 * Get quality color for UI display
 */
export function getQualityColor(quality: HealthStatus['quality']): string {
  switch (quality) {
    case 'excellent': return '#10b981'; // green-500
    case 'good': return '#22c55e';      // green-400
    case 'fair': return '#eab308';      // yellow-500
    case 'poor': return '#f97316';      // orange-500
    case 'offline': return '#ef4444';   // red-500
    default: return '#6b7280';          // gray-500
  }
}

/**
 * Get quality label for UI display
 */
export function getQualityLabel(quality: HealthStatus['quality']): string {
  switch (quality) {
    case 'excellent': return 'Excellent';
    case 'good': return 'Good';
    case 'fair': return 'Fair';
    case 'poor': return 'Poor';
    case 'offline': return 'Offline';
    default: return 'Unknown';
  }
}

/**
 * Get quality emoji for compact display
 */
export function getQualityEmoji(quality: HealthStatus['quality']): string {
  switch (quality) {
    case 'excellent': return '🟢';
    case 'good': return '🟢';
    case 'fair': return '🟡';
    case 'poor': return '🟠';
    case 'offline': return '🔴';
    default: return '⚪';
  }
}

// Derived store for simplified connection state
export const isConnected: Readable<boolean> = derived(
  healthStatus,
  $status => $status.connected
);

// Derived store for connection quality
export const connectionQuality: Readable<HealthStatus['quality']> = derived(
  healthStatus,
  $status => $status.quality
);

// Export stores
export { healthStatus, config };

// Auto-start monitor when in browser context
if (typeof window !== 'undefined') {
  // Start after a short delay to allow initial app load
  setTimeout(() => {
    startHealthMonitor();
  }, 1000);

  // Handle visibility changes - pause when tab is hidden
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopHealthMonitor();
    } else {
      startHealthMonitor();
    }
  });
}
