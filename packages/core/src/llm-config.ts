/**
 * Per-User LLM Configuration & Usage Tracking
 *
 * Extends the existing models.json system with:
 * - Per-user API key storage (not in env vars)
 * - Usage tracking and quotas (both local and centralized)
 * - Mobile-compatible provider resolution
 *
 * INTEGRATES WITH existing architecture:
 * - etc/models.json - System model definitions & role mapping
 * - etc/runpod.json - System-wide RunPod credentials
 * - profiles/<username>/etc/models.json - User model preferences
 *
 * NEW files this module manages:
 * - profiles/<username>/etc/llm-credentials.json - User's API keys
 * - profiles/<username>/etc/usage-quota.json - Per-user usage tracking
 * - etc/usage-policy.json - System owner's usage policy
 * - logs/usage/YYYY-MM.ndjson - Centralized usage logs (for billing)
 */

import fs from 'node:fs';
import path from 'node:path';
import { getProfilePaths, systemPaths } from './paths.js';
import { storageClient } from './storage-client.js';

/**
 * Resolve the correct path for user config files
 * Uses storage router (handles external drives, encryption, device-specific paths)
 * This is the ONLY source of truth for user profile locations.
 */
function resolveUserConfigPath(username: string, filename: string): string {
  // ALWAYS use storage router for proper path resolution
  // Handles: external drives, encrypted storage, device-specific paths
  try {
    const result = storageClient.resolvePath({
      username,
      category: 'config',
      subcategory: 'etc',
      relativePath: filename,
    });
    if (result.success && result.path) {
      return result.path;
    }
    console.warn(`[llm-config] Storage router returned failure for ${username}/${filename}:`, result.error);
  } catch (e) {
    console.warn(`[llm-config] Storage router error for ${username}/${filename}:`, e);
  }

  // Fallback to getProfilePaths (only if storage router completely fails)
  const profilePaths = getProfilePaths(username);
  return path.join(profilePaths.etc, filename);
}

// ============================================================================
// Types
// ============================================================================

/**
 * User's API credentials
 * File: profiles/<username>/etc/llm-credentials.json
 */
export interface UserCredentials {
  /** User's preferred cloud provider when offline */
  offlineProvider?: 'runpod' | 'claude' | 'openrouter' | 'openai';

  /** Provider API keys */
  runpod?: {
    apiKey: string;
    endpointId?: string;
  };
  claude?: {
    apiKey: string;
  };
  openrouter?: {
    apiKey: string;
  };
  openai?: {
    apiKey: string;
    endpoint?: string;
  };

  /** Whether to fall back to system defaults if user has no keys */
  allowSystemFallback?: boolean;
}

/**
 * System-wide credentials (loaded from etc/runpod.json, etc.)
 */
export interface SystemCredentials {
  runpod?: {
    apiKey: string;
    endpointId?: string;
  };
  claude?: {
    apiKey: string;
  };
  openrouter?: {
    apiKey: string;
  };
}

/**
 * Usage policy set by system owner
 * File: etc/usage-policy.json
 */
export interface UsagePolicy {
  /** Whether guests can use system API keys */
  allowGuestUsage: boolean;

  /** Default quotas for new users */
  defaultQuotas: {
    dailyTokenLimit: number;
    monthlyTokenLimit: number;
    requestsPerMinute: number;
  };

  /** Provider priority for system fallback */
  providerPriority: string[];
}

/**
 * Per-user usage quota
 * File: profiles/<username>/etc/usage-quota.json
 */
export interface UsageQuota {
  dailyTokenLimit: number;
  monthlyTokenLimit: number;
  requestsPerMinute: number;
  usage: {
    dailyTokens: number;
    monthlyTokens: number;
    lastReset: string;
    recentRequests: number[];
  };
}

/**
 * Centralized usage log entry (for billing/audit)
 * File: logs/usage/YYYY-MM.ndjson
 */
export interface UsageLogEntry {
  timestamp: string;
  username: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  source: 'user' | 'system';
  costEstimate?: number;
}

export interface ResolvedCredentials {
  provider: string;
  apiKey: string;
  endpoint?: string;
  model?: string;
  source: 'user' | 'system';
}

// ============================================================================
// Loaders
// ============================================================================

/**
 * Load system credentials from etc/*.json files
 */
export function loadSystemCredentials(): SystemCredentials {
  const creds: SystemCredentials = {};

  // Load RunPod credentials
  const runpodPath = path.join(systemPaths.etc, 'runpod.json');
  if (fs.existsSync(runpodPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(runpodPath, 'utf-8'));
      if (data.apiKey) {
        creds.runpod = {
          apiKey: data.apiKey,
          // Prefer endpointId over templateId (templateId is just metadata)
          endpointId: data.endpointId || data.templateId,
        };
      }
    } catch (e) {
      console.warn('[llm-config] Failed to load runpod.json:', e);
    }
  }

  // Load Claude credentials (if etc/claude.json exists)
  const claudePath = path.join(systemPaths.etc, 'claude.json');
  if (fs.existsSync(claudePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(claudePath, 'utf-8'));
      if (data.apiKey) {
        creds.claude = { apiKey: data.apiKey };
      }
    } catch (e) {
      console.warn('[llm-config] Failed to load claude.json:', e);
    }
  }

  // Check environment variables as fallback
  if (!creds.runpod?.apiKey && process.env.RUNPOD_API_KEY) {
    creds.runpod = {
      apiKey: process.env.RUNPOD_API_KEY,
      endpointId: process.env.RUNPOD_ENDPOINT_ID,
    };
  }
  if (!creds.claude?.apiKey && process.env.ANTHROPIC_API_KEY) {
    creds.claude = { apiKey: process.env.ANTHROPIC_API_KEY };
  }
  if (!creds.openrouter && process.env.OPENROUTER_API_KEY) {
    creds.openrouter = { apiKey: process.env.OPENROUTER_API_KEY };
  }

  return creds;
}

/**
 * Load usage policy
 */
export function loadUsagePolicy(): UsagePolicy {
  const policyPath = path.join(systemPaths.etc, 'usage-policy.json');

  const defaults: UsagePolicy = {
    allowGuestUsage: false,
    defaultQuotas: {
      dailyTokenLimit: 100000,    // 100k tokens/day
      monthlyTokenLimit: 1000000, // 1M tokens/month
      requestsPerMinute: 10,
    },
    providerPriority: ['runpod', 'claude', 'openrouter', 'openai'],
  };

  if (!fs.existsSync(policyPath)) {
    return defaults;
  }

  try {
    const raw = fs.readFileSync(policyPath, 'utf-8');
    return { ...defaults, ...JSON.parse(raw) };
  } catch (e) {
    console.warn('[llm-config] Failed to load usage-policy.json:', e);
    return defaults;
  }
}

/**
 * Load user's credentials
 * Checks both llm-credentials.json (new format) and runpod.json (legacy/sync format)
 */
export function loadUserCredentials(username: string): UserCredentials | null {
  try {
    // First try the new unified credentials file
    const credPath = resolveUserConfigPath(username, 'llm-credentials.json');
    if (fs.existsSync(credPath)) {
      return JSON.parse(fs.readFileSync(credPath, 'utf-8'));
    }

    // Fallback: check profile's runpod.json (used by mobile sync and credentials-sync)
    const runpodPath = resolveUserConfigPath(username, 'runpod.json');
    if (fs.existsSync(runpodPath)) {
      const runpodConfig = JSON.parse(fs.readFileSync(runpodPath, 'utf-8'));
      if (runpodConfig.apiKey) {
        // Convert runpod.json format to UserCredentials format
        // Prefer endpointId over templateId (templateId is just metadata)
        return {
          offlineProvider: 'runpod',
          runpod: {
            apiKey: runpodConfig.apiKey,
            endpointId: runpodConfig.endpointId || runpodConfig.templateId,
          },
        };
      }
    }

    return null;
  } catch (e) {
    console.warn(`[llm-config] Failed to load credentials for ${username}:`, e);
    return null;
  }
}

/**
 * Save user's credentials
 */
export function saveUserCredentials(username: string, creds: UserCredentials): void {
  const credPath = resolveUserConfigPath(username, 'llm-credentials.json');

  fs.mkdirSync(path.dirname(credPath), { recursive: true });
  fs.writeFileSync(credPath, JSON.stringify(creds, null, 2), 'utf-8');
}

/**
 * Load user's usage quota
 */
export function loadUsageQuota(username: string): UsageQuota {
  const quotaPath = resolveUserConfigPath(username, 'usage-quota.json');
  const policy = loadUsagePolicy();

  const defaults: UsageQuota = {
    dailyTokenLimit: policy.defaultQuotas.dailyTokenLimit,
    monthlyTokenLimit: policy.defaultQuotas.monthlyTokenLimit,
    requestsPerMinute: policy.defaultQuotas.requestsPerMinute,
    usage: {
      dailyTokens: 0,
      monthlyTokens: 0,
      lastReset: new Date().toISOString().split('T')[0],
      recentRequests: [],
    },
  };

  if (!fs.existsSync(quotaPath)) {
    return defaults;
  }

  try {
    const quota = JSON.parse(fs.readFileSync(quotaPath, 'utf-8'));
    const today = new Date().toISOString().split('T')[0];

    // Reset daily usage if new day
    if (quota.usage?.lastReset !== today) {
      quota.usage.dailyTokens = 0;
      quota.usage.lastReset = today;
    }

    // Reset monthly if new month
    const thisMonth = today.slice(0, 7);
    const lastMonth = quota.usage?.lastReset?.slice(0, 7);
    if (lastMonth && lastMonth !== thisMonth) {
      quota.usage.monthlyTokens = 0;
    }

    return { ...defaults, ...quota };
  } catch (e) {
    console.warn(`[llm-config] Failed to load quota for ${username}:`, e);
    return defaults;
  }
}

/**
 * Save user's usage quota
 */
export function saveUsageQuota(username: string, quota: UsageQuota): void {
  const quotaPath = resolveUserConfigPath(username, 'usage-quota.json');

  fs.mkdirSync(path.dirname(quotaPath), { recursive: true });
  fs.writeFileSync(quotaPath, JSON.stringify(quota, null, 2), 'utf-8');
}

// ============================================================================
// Provider Resolution
// ============================================================================

/**
 * Resolve which provider/credentials to use for a user
 *
 * Priority:
 * 1. User's own API keys (if configured)
 * 2. System credentials (if policy allows guest usage)
 * 3. null (no provider available)
 */
export function resolveCredentials(
  username: string,
  preferredProvider?: string
): ResolvedCredentials | null {
  const userCreds = loadUserCredentials(username);
  const systemCreds = loadSystemCredentials();
  const policy = loadUsagePolicy();

  // Build provider order
  const providerOrder = preferredProvider
    ? [preferredProvider, ...policy.providerPriority.filter(p => p !== preferredProvider)]
    : (userCreds?.offlineProvider
      ? [userCreds.offlineProvider, ...policy.providerPriority.filter(p => p !== userCreds.offlineProvider)]
      : policy.providerPriority);

  // Try each provider
  for (const provider of providerOrder) {
    // Try user credentials first
    const userProvider = userCreds?.[provider as keyof UserCredentials] as { apiKey?: string; endpointId?: string } | undefined;
    if (userProvider?.apiKey) {
      return {
        provider,
        apiKey: userProvider.apiKey,
        endpoint: userProvider.endpointId,
        source: 'user',
      };
    }

    // Try system credentials if allowed
    const canUseSystem = userCreds?.allowSystemFallback !== false && policy.allowGuestUsage;
    if (canUseSystem) {
      const systemProvider = systemCreds[provider as keyof SystemCredentials];
      if (systemProvider?.apiKey) {
        return {
          provider,
          apiKey: systemProvider.apiKey,
          endpoint: (systemProvider as any).endpointId,
          source: 'system',
        };
      }
    }
  }

  return null;
}

// ============================================================================
// Usage Tracking (Local + Centralized)
// ============================================================================

/**
 * Check if user has quota remaining
 */
export function checkQuota(username: string): { allowed: boolean; reason?: string } {
  const quota = loadUsageQuota(username);

  if (quota.dailyTokenLimit > 0 && quota.usage.dailyTokens >= quota.dailyTokenLimit) {
    return { allowed: false, reason: `Daily limit reached (${quota.dailyTokenLimit.toLocaleString()} tokens)` };
  }

  if (quota.monthlyTokenLimit > 0 && quota.usage.monthlyTokens >= quota.monthlyTokenLimit) {
    return { allowed: false, reason: `Monthly limit reached (${quota.monthlyTokenLimit.toLocaleString()} tokens)` };
  }

  const now = Date.now();
  const recentRequests = quota.usage.recentRequests.filter(t => t > now - 60000);
  if (recentRequests.length >= quota.requestsPerMinute) {
    return { allowed: false, reason: `Rate limit (${quota.requestsPerMinute}/min)` };
  }

  return { allowed: true };
}

/**
 * Record usage (local quota + centralized log)
 */
export function recordUsage(
  username: string,
  usage: {
    provider: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    source: 'user' | 'system';
  }
): void {
  const totalTokens = usage.promptTokens + usage.completionTokens;

  // Update local quota
  const quota = loadUsageQuota(username);
  quota.usage.dailyTokens += totalTokens;
  quota.usage.monthlyTokens += totalTokens;
  quota.usage.recentRequests.push(Date.now());
  quota.usage.recentRequests = quota.usage.recentRequests.filter(t => t > Date.now() - 300000);
  saveUsageQuota(username, quota);

  // Write to centralized usage log
  const logEntry: UsageLogEntry = {
    timestamp: new Date().toISOString(),
    username,
    provider: usage.provider,
    model: usage.model,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens,
    source: usage.source,
  };

  const yearMonth = new Date().toISOString().slice(0, 7);
  const logDir = path.join(systemPaths.logs, 'usage');
  const logPath = path.join(logDir, `${yearMonth}.ndjson`);

  try {
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(logPath, JSON.stringify(logEntry) + '\n', 'utf-8');
  } catch (e) {
    console.warn('[llm-config] Failed to write usage log:', e);
  }
}

/**
 * Get usage summary for a user (for billing display)
 */
export function getUsageSummary(username: string): {
  daily: { tokens: number; limit: number; percent: number };
  monthly: { tokens: number; limit: number; percent: number };
} {
  const quota = loadUsageQuota(username);

  return {
    daily: {
      tokens: quota.usage.dailyTokens,
      limit: quota.dailyTokenLimit,
      percent: quota.dailyTokenLimit > 0 ? (quota.usage.dailyTokens / quota.dailyTokenLimit) * 100 : 0,
    },
    monthly: {
      tokens: quota.usage.monthlyTokens,
      limit: quota.monthlyTokenLimit,
      percent: quota.monthlyTokenLimit > 0 ? (quota.usage.monthlyTokens / quota.monthlyTokenLimit) * 100 : 0,
    },
  };
}
