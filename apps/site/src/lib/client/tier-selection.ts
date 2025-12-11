/**
 * Tier Selection Engine
 *
 * Automatically selects the best available compute tier based on:
 * - Network connectivity and quality
 * - Battery level (mobile)
 * - Task complexity requirements
 * - Tier availability
 *
 * Three-tier architecture:
 * - Tier 1 (Offline): On-device Qwen3-1.7B via llama.cpp
 * - Tier 2 (Server): Home Ollama with Qwen3:14B
 * - Tier 3 (Cloud): RunPod with Qwen3-Coder-30B
 */

import { writable, derived, type Readable, type Writable } from 'svelte/store';
import { healthStatus } from './server-health';
import { getApiBaseUrlAsync } from './api-config';

// ============================================================================
// Types
// ============================================================================

export type TierType = 'offline' | 'server' | 'cloud';

export interface TierConfig {
  id: TierType;
  name: string;
  description: string;
  model: string;
  maxTokens: number;
  capabilities: TierCapability[];
  minBatteryPercent: number;
  requiresNetwork: boolean;
  priority: number; // Lower = preferred when available
}

export type TierCapability =
  | 'chat'
  | 'code'
  | 'analysis'
  | 'creative'
  | 'memory-search'
  | 'task-planning'
  | 'long-context';

export interface TierStatus {
  tier: TierType;
  available: boolean;
  lastCheck: Date;
  latencyMs?: number;
  error?: string;
}

export interface DeviceStatus {
  batteryLevel: number; // 0-100
  batteryCharging: boolean;
  networkType: 'none' | 'wifi' | 'cellular' | 'ethernet' | 'unknown';
  networkEffectiveType?: '2g' | '3g' | '4g' | 'slow-2g';
  saveDataMode: boolean;
}

export interface TierSelectionResult {
  selectedTier: TierType;
  reason: string;
  alternatives: TierType[];
  deviceStatus: DeviceStatus;
  tierStatuses: Record<TierType, TierStatus>;
}

export type SelectionMode = 'auto' | 'prefer-offline' | 'prefer-server' | 'prefer-cloud' | 'manual';

export interface TierSelectionConfig {
  mode: SelectionMode;
  manualTier?: TierType;
  lowBatteryThreshold: number; // Switch to offline below this
  offlineLatencyThreshold: number; // Consider offline if server latency exceeds this
  enableCloudFallback: boolean;
}

// ============================================================================
// Tier Definitions
// ============================================================================

export const TIERS: Record<TierType, TierConfig> = {
  offline: {
    id: 'offline',
    name: 'On-Device',
    description: 'Qwen3-1.7B running locally via llama.cpp',
    model: 'qwen3-1.7b',
    maxTokens: 2048,
    capabilities: ['chat', 'memory-search'],
    minBatteryPercent: 5,
    requiresNetwork: false,
    priority: 3, // Last resort but always available
  },
  server: {
    id: 'server',
    name: 'Home Server',
    description: 'Qwen3:14B on local Ollama server',
    model: 'qwen3:14b',
    maxTokens: 8192,
    capabilities: ['chat', 'code', 'analysis', 'creative', 'memory-search', 'task-planning'],
    minBatteryPercent: 10,
    requiresNetwork: true,
    priority: 1, // Preferred when available
  },
  cloud: {
    id: 'cloud',
    name: 'Cloud',
    description: 'Qwen3-Coder-30B on RunPod',
    model: 'qwen3-coder-30b',
    maxTokens: 32768,
    capabilities: ['chat', 'code', 'analysis', 'creative', 'memory-search', 'task-planning', 'long-context'],
    minBatteryPercent: 15,
    requiresNetwork: true,
    priority: 2, // Fallback when server unavailable
  },
};

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: TierSelectionConfig = {
  mode: 'auto',
  lowBatteryThreshold: 15,
  offlineLatencyThreshold: 2000, // 2 seconds
  enableCloudFallback: true,
};

// ============================================================================
// Stores
// ============================================================================

export const tierConfig: Writable<TierSelectionConfig> = writable(DEFAULT_CONFIG);

export const tierStatuses: Writable<Record<TierType, TierStatus>> = writable({
  offline: { tier: 'offline', available: false, lastCheck: new Date() },
  server: { tier: 'server', available: false, lastCheck: new Date() },
  cloud: { tier: 'cloud', available: false, lastCheck: new Date() },
});

export const deviceStatus: Writable<DeviceStatus> = writable({
  batteryLevel: 100,
  batteryCharging: false,
  networkType: 'unknown',
  saveDataMode: false,
});

export const selectedTier: Writable<TierType> = writable('server');

// Derived store for current tier info
export const currentTierInfo: Readable<TierConfig> = derived(
  selectedTier,
  $tier => TIERS[$tier]
);

// ============================================================================
// Device Status Detection
// ============================================================================

async function detectDeviceStatus(): Promise<DeviceStatus> {
  const status: DeviceStatus = {
    batteryLevel: 100,
    batteryCharging: false,
    networkType: 'unknown',
    saveDataMode: false,
  };

  // Battery API (where available)
  if ('getBattery' in navigator) {
    try {
      const battery = await (navigator as any).getBattery();
      status.batteryLevel = Math.round(battery.level * 100);
      status.batteryCharging = battery.charging;
    } catch {
      // Battery API not available or permission denied
    }
  }

  // Network Information API
  const connection = (navigator as any).connection ||
                     (navigator as any).mozConnection ||
                     (navigator as any).webkitConnection;

  if (connection) {
    status.networkEffectiveType = connection.effectiveType;
    status.saveDataMode = connection.saveData || false;

    // Determine network type
    if (connection.type) {
      switch (connection.type) {
        case 'wifi':
          status.networkType = 'wifi';
          break;
        case 'cellular':
          status.networkType = 'cellular';
          break;
        case 'ethernet':
          status.networkType = 'ethernet';
          break;
        case 'none':
          status.networkType = 'none';
          break;
        default:
          status.networkType = 'unknown';
      }
    }
  }

  // Check online status
  if (!navigator.onLine) {
    status.networkType = 'none';
  }

  return status;
}

// ============================================================================
// Tier Availability Checks
// ============================================================================

async function checkOfflineTierAvailable(): Promise<TierStatus> {
  const status: TierStatus = {
    tier: 'offline',
    available: false,
    lastCheck: new Date(),
  };

  // Offline mode not available in React Native (uses Node.js server instead)
  status.error = 'Offline mode not available - use server mode';

  return status;
}

async function checkServerTierAvailable(): Promise<TierStatus> {
  const status: TierStatus = {
    tier: 'server',
    available: false,
    lastCheck: new Date(),
  };

  try {
    const serverUrl = await getApiBaseUrlAsync() || window.location.origin;
    const start = Date.now();
    const response = await fetch(`${serverUrl}/api/boot`, {
      method: 'GET',
      credentials: 'include',
      signal: AbortSignal.timeout(5000),
    });
    status.latencyMs = Date.now() - start;

    if (response.ok) {
      status.available = true;
    } else {
      status.error = `Server returned ${response.status}`;
    }
  } catch (e) {
    status.error = e instanceof Error ? e.message : 'Connection failed';
  }

  return status;
}

async function checkCloudTierAvailable(): Promise<TierStatus> {
  const status: TierStatus = {
    tier: 'cloud',
    available: false,
    lastCheck: new Date(),
  };

  try {
    // Check RunPod endpoint health
    const cloudUrl = 'https://api.metahuman.cloud'; // TODO: Make configurable
    const start = Date.now();
    const response = await fetch(`${cloudUrl}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(10000),
    });
    status.latencyMs = Date.now() - start;

    if (response.ok) {
      status.available = true;
    } else {
      status.error = `Cloud returned ${response.status}`;
    }
  } catch (e) {
    status.error = e instanceof Error ? e.message : 'Cloud connection failed';
  }

  return status;
}

// ============================================================================
// Tier Selection Logic
// ============================================================================

export async function selectBestTier(
  requiredCapabilities: TierCapability[] = ['chat']
): Promise<TierSelectionResult> {
  // Get current states
  const device = await detectDeviceStatus();
  deviceStatus.set(device);

  // Check all tier availability in parallel
  const [offlineStatus, serverStatus, cloudStatus] = await Promise.all([
    checkOfflineTierAvailable(),
    checkServerTierAvailable(),
    checkCloudTierAvailable(),
  ]);

  const statuses: Record<TierType, TierStatus> = {
    offline: offlineStatus,
    server: serverStatus,
    cloud: cloudStatus,
  };
  tierStatuses.set(statuses);

  // Get current config
  let config: TierSelectionConfig = DEFAULT_CONFIG;
  tierConfig.subscribe(c => config = c)();

  // Manual mode - return specified tier if available
  if (config.mode === 'manual' && config.manualTier) {
    const manualStatus = statuses[config.manualTier];
    if (manualStatus.available) {
      selectedTier.set(config.manualTier);
      return {
        selectedTier: config.manualTier,
        reason: 'Manual selection',
        alternatives: getAlternatives(config.manualTier, statuses, device, requiredCapabilities),
        deviceStatus: device,
        tierStatuses: statuses,
      };
    }
  }

  // Filter tiers by capability requirements
  const capableTiers = (Object.keys(TIERS) as TierType[]).filter(tierId => {
    const tier = TIERS[tierId];
    return requiredCapabilities.every(cap => tier.capabilities.includes(cap));
  });

  // Filter by availability and constraints
  const availableTiers = capableTiers.filter(tierId => {
    const tier = TIERS[tierId];
    const status = statuses[tierId];

    // Must be available
    if (!status.available) return false;

    // Battery check
    if (device.batteryLevel < tier.minBatteryPercent && !device.batteryCharging) {
      return false;
    }

    // Network check
    if (tier.requiresNetwork && device.networkType === 'none') {
      return false;
    }

    return true;
  });

  // Apply selection mode preferences
  let selected: TierType;
  let reason: string;

  if (availableTiers.length === 0) {
    // No tiers available - fall back to offline even if not fully available
    selected = 'offline';
    reason = 'No tiers available - offline fallback';
  } else if (config.mode === 'prefer-offline' && availableTiers.includes('offline')) {
    selected = 'offline';
    reason = 'User preference: offline mode';
  } else if (config.mode === 'prefer-server' && availableTiers.includes('server')) {
    selected = 'server';
    reason = 'User preference: home server';
  } else if (config.mode === 'prefer-cloud' && availableTiers.includes('cloud')) {
    selected = 'cloud';
    reason = 'User preference: cloud mode';
  } else {
    // Auto mode - apply smart selection
    selected = autoSelectTier(availableTiers, statuses, device, config);
    reason = getAutoSelectReason(selected, statuses, device, config);
  }

  selectedTier.set(selected);

  return {
    selectedTier: selected,
    reason,
    alternatives: getAlternatives(selected, statuses, device, requiredCapabilities),
    deviceStatus: device,
    tierStatuses: statuses,
  };
}

function autoSelectTier(
  availableTiers: TierType[],
  statuses: Record<TierType, TierStatus>,
  device: DeviceStatus,
  config: TierSelectionConfig
): TierType {
  // Low battery - prefer offline
  if (device.batteryLevel < config.lowBatteryThreshold && !device.batteryCharging) {
    if (availableTiers.includes('offline')) {
      return 'offline';
    }
  }

  // Save data mode - prefer offline or server
  if (device.saveDataMode) {
    if (availableTiers.includes('offline')) return 'offline';
    if (availableTiers.includes('server')) return 'server';
  }

  // Slow network - prefer offline
  if (device.networkEffectiveType === 'slow-2g' || device.networkEffectiveType === '2g') {
    if (availableTiers.includes('offline')) return 'offline';
  }

  // High server latency - consider cloud or offline
  const serverLatency = statuses.server.latencyMs || 0;
  if (serverLatency > config.offlineLatencyThreshold) {
    // Server is slow
    if (config.enableCloudFallback && availableTiers.includes('cloud')) {
      const cloudLatency = statuses.cloud.latencyMs || Infinity;
      if (cloudLatency < serverLatency) {
        return 'cloud';
      }
    }
    if (availableTiers.includes('offline')) {
      return 'offline';
    }
  }

  // Default: prefer server > cloud > offline (by priority)
  return availableTiers.sort((a, b) => TIERS[a].priority - TIERS[b].priority)[0];
}

function getAutoSelectReason(
  selected: TierType,
  statuses: Record<TierType, TierStatus>,
  device: DeviceStatus,
  config: TierSelectionConfig
): string {
  if (selected === 'offline') {
    if (device.batteryLevel < config.lowBatteryThreshold) {
      return `Low battery (${device.batteryLevel}%) - using offline mode`;
    }
    if (device.networkType === 'none') {
      return 'No network connection - using offline mode';
    }
    if (device.saveDataMode) {
      return 'Data saver enabled - using offline mode';
    }
    const serverLatency = statuses.server.latencyMs || 0;
    if (serverLatency > config.offlineLatencyThreshold) {
      return `High server latency (${serverLatency}ms) - using offline mode`;
    }
  }

  if (selected === 'server') {
    const latency = statuses.server.latencyMs;
    return latency ? `Home server connected (${latency}ms)` : 'Home server connected';
  }

  if (selected === 'cloud') {
    if (!statuses.server.available) {
      return 'Home server unavailable - using cloud';
    }
    const serverLatency = statuses.server.latencyMs || 0;
    const cloudLatency = statuses.cloud.latencyMs || 0;
    if (cloudLatency < serverLatency) {
      return `Cloud faster than server (${cloudLatency}ms vs ${serverLatency}ms)`;
    }
    return 'Using cloud backend';
  }

  return 'Auto-selected';
}

function getAlternatives(
  selected: TierType,
  statuses: Record<TierType, TierStatus>,
  device: DeviceStatus,
  requiredCapabilities: TierCapability[]
): TierType[] {
  return (Object.keys(TIERS) as TierType[])
    .filter(tierId => {
      if (tierId === selected) return false;
      const tier = TIERS[tierId];
      const status = statuses[tierId];

      // Must support required capabilities
      if (!requiredCapabilities.every(cap => tier.capabilities.includes(cap))) {
        return false;
      }

      // Must be available
      return status.available;
    })
    .sort((a, b) => TIERS[a].priority - TIERS[b].priority);
}

// ============================================================================
// Configuration Management
// ============================================================================

export async function loadTierConfig(): Promise<void> {
  // Configuration is not persisted in React Native - use defaults
}

export async function saveTierConfig(config: TierSelectionConfig): Promise<void> {
  tierConfig.set(config);
  // Configuration is not persisted in React Native - kept in memory only
}

export async function setSelectionMode(mode: SelectionMode, manualTier?: TierType): Promise<void> {
  let current: TierSelectionConfig = DEFAULT_CONFIG;
  tierConfig.subscribe(c => current = c)();

  await saveTierConfig({
    ...current,
    mode,
    manualTier: mode === 'manual' ? manualTier : undefined,
  });

  // Re-run selection with new mode
  await selectBestTier();
}

// ============================================================================
// Initialization
// ============================================================================

let initialized = false;
let statusCheckInterval: ReturnType<typeof setInterval> | null = null;

export async function initTierSelection(): Promise<TierSelectionResult> {
  if (initialized) {
    // Return current selection
    let current: TierType = 'server';
    selectedTier.subscribe(t => current = t)();

    let device: DeviceStatus = { batteryLevel: 100, batteryCharging: false, networkType: 'unknown', saveDataMode: false };
    deviceStatus.subscribe(d => device = d)();

    let statuses: Record<TierType, TierStatus> = {} as any;
    tierStatuses.subscribe(s => statuses = s)();

    return {
      selectedTier: current,
      reason: 'Previously selected',
      alternatives: [],
      deviceStatus: device,
      tierStatuses: statuses,
    };
  }

  await loadTierConfig();
  const result = await selectBestTier();

  // Start periodic status checks (every 60 seconds)
  statusCheckInterval = setInterval(async () => {
    await selectBestTier();
  }, 60000);

  // Listen for online/offline events
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => selectBestTier());
    window.addEventListener('offline', () => selectBestTier());
  }

  initialized = true;
  return result;
}

export function stopTierSelection(): void {
  if (statusCheckInterval) {
    clearInterval(statusCheckInterval);
    statusCheckInterval = null;
  }
  initialized = false;
}

// ============================================================================
// Utility Exports
// ============================================================================

export function getTierDisplayName(tier: TierType): string {
  return TIERS[tier].name;
}

export function getTierModel(tier: TierType): string {
  return TIERS[tier].model;
}

export function getTierIcon(tier: TierType): string {
  switch (tier) {
    case 'offline': return '📱';
    case 'server': return '🏠';
    case 'cloud': return '☁️';
  }
}

export function getCapabilityIcon(cap: TierCapability): string {
  switch (cap) {
    case 'chat': return '💬';
    case 'code': return '💻';
    case 'analysis': return '🔍';
    case 'creative': return '🎨';
    case 'memory-search': return '🧠';
    case 'task-planning': return '📋';
    case 'long-context': return '📚';
  }
}
