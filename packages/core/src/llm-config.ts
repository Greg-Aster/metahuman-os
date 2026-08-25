/**
 * Per-user LLM credential resolution.
 *
 * Extends the existing models.json system with:
 * - Per-user API key storage (not in env vars)
 * - Explicit provider priority and system-key fallback policy
 *
 * INTEGRATES WITH existing architecture:
 * - etc/models.json - System model definitions & role mapping
 * - etc/runpod.json - System-wide RunPod credentials
 * - profiles/<username>/etc/models.json - User model preferences
 *
 * NEW files this module manages:
 * - profiles/<username>/etc/llm-credentials.json - User's API keys
 * - etc/llm-provider-policy.json - System fallback policy
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
  /** Remote MetaHuman server (via Cloudflare tunnel, etc.) */
  server?: {
    /** Server URL (e.g., https://mh.example.com) */
    serverUrl: string;
    /** Session ID from remote server login (mh_session cookie value) */
    sessionId: string;
    /** Username for display purposes */
    username?: string;
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
 * Provider fallback policy set by the system owner.
 */
export interface ProviderPolicy {
  allowSystemFallback: boolean;
  providerPriority: string[];
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
 * Load provider fallback policy.
 */
export function loadProviderPolicy(): ProviderPolicy {
  const policyPath = path.join(systemPaths.etc, 'llm-provider-policy.json');

  const defaults: ProviderPolicy = {
    allowSystemFallback: false,
    providerPriority: ['runpod', 'claude', 'openrouter', 'openai'],
  };

  if (!fs.existsSync(policyPath)) {
    return defaults;
  }

  try {
    const raw = fs.readFileSync(policyPath, 'utf-8');
    return { ...defaults, ...JSON.parse(raw) };
  } catch (e) {
    console.warn('[llm-config] Failed to load llm-provider-policy.json:', e);
    return defaults;
  }
}

/**
 * Load user's credentials
 * Checks llm-credentials.json (unified), runpod.json (legacy), and remote-server.json
 */
export function loadUserCredentials(username: string): UserCredentials | null {
  try {
    let creds: UserCredentials = {};

    // First try the new unified credentials file
    const credPath = resolveUserConfigPath(username, 'llm-credentials.json');
    if (fs.existsSync(credPath)) {
      creds = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
    }

    // Merge in runpod.json if it exists and creds doesn't have runpod
    if (!creds.runpod) {
      const runpodPath = resolveUserConfigPath(username, 'runpod.json');
      if (fs.existsSync(runpodPath)) {
        const runpodConfig = JSON.parse(fs.readFileSync(runpodPath, 'utf-8'));
        if (runpodConfig.apiKey) {
          creds.runpod = {
            apiKey: runpodConfig.apiKey,
            endpointId: runpodConfig.endpointId || runpodConfig.templateId,
          };
        }
      }
    }

    // Merge in remote-server.json if it exists and creds doesn't have server
    if (!creds.server) {
      const serverPath = resolveUserConfigPath(username, 'remote-server.json');
      if (fs.existsSync(serverPath)) {
        const serverConfig = JSON.parse(fs.readFileSync(serverPath, 'utf-8'));
        if (serverConfig.serverUrl && serverConfig.sessionId) {
          creds.server = {
            serverUrl: serverConfig.serverUrl,
            sessionId: serverConfig.sessionId,
            username: serverConfig.username,
          };
        }
      }
    }

    // Return null if no credentials found at all
    if (Object.keys(creds).length === 0) {
      return null;
    }

    return creds;
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
 * Save remote-server credentials for a user
 * Writes to remote-server.json in the user's profile config directory
 *
 * @param username - Local username (profile owner)
 * @param serverUrl - Remote server URL
 * @param sessionId - Session ID from remote server login (mh_session cookie value)
 * @param remoteUsername - Username on the remote server (for display)
 */
export function saveRemoteServerCredentials(
  username: string,
  serverUrl: string,
  sessionId: string,
  remoteUsername?: string
): void {
  const serverPath = resolveUserConfigPath(username, 'remote-server.json');

  const config = {
    serverUrl,
    sessionId,
    username: remoteUsername,
    savedAt: new Date().toISOString(),
  };

  fs.mkdirSync(path.dirname(serverPath), { recursive: true });
  fs.writeFileSync(serverPath, JSON.stringify(config, null, 2), 'utf-8');
  console.log(`[llm-config] Saved remote-server session for ${username} to ${serverPath}`);
}

/**
 * Delete remote-server credentials for a user
 */
export function deleteRemoteServerCredentials(username: string): boolean {
  const serverPath = resolveUserConfigPath(username, 'remote-server.json');
  try {
    if (fs.existsSync(serverPath)) {
      fs.unlinkSync(serverPath);
      console.log(`[llm-config] Deleted remote-server credentials for ${username}`);
      return true;
    }
    return false;
  } catch (e) {
    console.warn(`[llm-config] Failed to delete remote-server credentials:`, e);
    return false;
  }
}

// ============================================================================
// Provider Resolution
// ============================================================================

/**
 * Resolve which provider/credentials to use for a user
 *
 * Priority:
 * 1. User's own API keys (if configured)
 * 2. System credentials (if the provider policy allows fallback)
 * 3. null (no provider available)
 */
export function resolveCredentials(
  username: string,
  preferredProvider?: string
): ResolvedCredentials | null {
  const userCreds = loadUserCredentials(username);
  const systemCreds = loadSystemCredentials();
  const policy = loadProviderPolicy();

  // Build provider order
  const providerOrder = preferredProvider
    ? [preferredProvider, ...policy.providerPriority.filter(p => p !== preferredProvider)]
    : policy.providerPriority;

  // Try each provider
  for (const provider of providerOrder) {
    // Special handling for 'server' (remote-server) provider - different credential structure
    if (provider === 'server' || provider === 'remote-server') {
      const serverCreds = userCreds?.server;
      if (serverCreds?.serverUrl && serverCreds?.sessionId) {
        return {
          provider: 'server',
          apiKey: serverCreds.sessionId,  // sessionId for mh_session cookie
          endpoint: serverCreds.serverUrl,
          source: 'user',
        };
      }
      continue; // No system fallback for remote-server (it's user-specific)
    }

    // Try user credentials first (standard providers)
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
    const canUseSystem = userCreds?.allowSystemFallback !== false && policy.allowSystemFallback;
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
