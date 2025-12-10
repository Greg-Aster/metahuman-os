/**
 * Credentials Sync API Handlers
 *
 * Provides secure credential export for mobile devices to fetch from desktop server.
 * Returns masked credentials for display and full credentials for authenticated sync.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { getProfilePaths } from '../../paths.js';
import fs from 'node:fs';
import path from 'node:path';

interface OperatorConfig {
  bigBrotherMode?: {
    enabled?: boolean;
    provider?: string;
    escalateOnStuck?: boolean;
    escalateOnRepeatedFailures?: boolean;
    maxRetries?: number;
    includeFullScratchpad?: boolean;
    autoApplySuggestions?: boolean;
  };
}

/**
 * Load operator config from user's profile etc/operator.json
 * Single source of truth - no fallbacks
 */
function loadOperatorConfigForUser(username: string): OperatorConfig {
  const profilePaths = getProfilePaths(username);
  const configPath = path.join(profilePaths.etc, 'operator.json');

  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch {
      // Invalid JSON
    }
  }
  return {};
}

export interface SyncableCredentials {
  runpod?: {
    apiKey: string | null;
    endpointId: string | null;  // The actual endpoint ID for API calls
    templateId: string | null;  // Template metadata (not used for API calls)
    gpuType: string | null;
  };
  bigBrother?: {
    enabled: boolean;
    provider: string;
    escalateOnStuck: boolean;
    escalateOnRepeatedFailures: boolean;
    maxRetries: number;
    includeFullScratchpad: boolean;
    autoApplySuggestions: boolean;
  };
  remote?: {
    provider: string;
    serverUrl: string;
    model: string;
  };
}

/**
 * GET /api/profile-sync/credentials - Export credentials for mobile sync (owner only)
 *
 * This endpoint is called by mobile devices to fetch credentials from the desktop server.
 * Requires authentication and owner role for security.
 */
export async function handleGetCredentialsSync(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user } = req;

  try {
    if (!user.isAuthenticated) {
      return {
        status: 401,
        error: 'Authentication required',
      };
    }

    // Only owner can access credentials
    if (user.role !== 'owner') {
      return {
        status: 403,
        error: 'Owner role required',
      };
    }

    const credentials: SyncableCredentials = {};

    // 1. Gather RunPod credentials from user's profile etc/runpod.json
    const runpodConfig = await getRunPodConfig(user.username);
    if (runpodConfig.apiKey) {
      credentials.runpod = runpodConfig;
    }

    // 2. Gather Big Brother config from user's profile etc/operator.json
    const operatorConfig = loadOperatorConfigForUser(user.username);
    if (operatorConfig.bigBrotherMode) {
      credentials.bigBrother = {
        enabled: operatorConfig.bigBrotherMode.enabled ?? false,
        provider: operatorConfig.bigBrotherMode.provider || 'claude-code',
        escalateOnStuck: operatorConfig.bigBrotherMode.escalateOnStuck ?? true,
        escalateOnRepeatedFailures: operatorConfig.bigBrotherMode.escalateOnRepeatedFailures ?? true,
        maxRetries: operatorConfig.bigBrotherMode.maxRetries ?? 1,
        includeFullScratchpad: operatorConfig.bigBrotherMode.includeFullScratchpad ?? true,
        autoApplySuggestions: operatorConfig.bigBrotherMode.autoApplySuggestions ?? false,
      };
    }

    // 3. Gather remote backend config from user's profile etc/llm-backend.json
    const profilePaths = getProfilePaths(user.username);
    const backendConfigPath = path.join(profilePaths.etc, 'llm-backend.json');
    if (fs.existsSync(backendConfigPath)) {
      try {
        const backendConfig = JSON.parse(fs.readFileSync(backendConfigPath, 'utf-8'));
        if (backendConfig.remote) {
          credentials.remote = {
            provider: backendConfig.remote.provider || 'runpod',
            serverUrl: backendConfig.remote.serverUrl || '',
            model: backendConfig.remote.model || '',
          };
        }
      } catch {
        // Invalid JSON, ignore
      }
    }

    return successResponse({
      success: true,
      credentials,
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[credentials-sync] GET error:', error);
    return {
      status: 500,
      error: (error as Error).message,
    };
  }
}

/**
 * POST /api/profile-sync/credentials - Save credentials received from sync (owner only)
 *
 * Used by mobile devices to store credentials locally after fetching from desktop.
 * On mobile, this saves to IndexedDB/local storage since there's no filesystem.
 */
export async function handleSaveCredentialsSync(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, body } = req;

  try {
    if (!user.isAuthenticated) {
      return {
        status: 401,
        error: 'Authentication required',
      };
    }

    if (user.role !== 'owner') {
      return {
        status: 403,
        error: 'Owner role required',
      };
    }

    const credentials = body?.credentials as SyncableCredentials | undefined;
    if (!credentials) {
      return {
        status: 400,
        error: 'No credentials provided',
      };
    }

    // Save credentials to user's profile etc/ directory
    // Single source of truth - both web and mobile use the same location
    const profilePaths = getProfilePaths(user.username);

    // Ensure profile etc/ directory exists
    if (!fs.existsSync(profilePaths.etc)) {
      fs.mkdirSync(profilePaths.etc, { recursive: true });
    }

    // Save RunPod config to profile etc/runpod.json
    if (credentials.runpod) {
      const runpodPath = path.join(profilePaths.etc, 'runpod.json');
      fs.writeFileSync(runpodPath, JSON.stringify(credentials.runpod, null, 2));
    }

    // Save remote backend config to profile etc/llm-backend.json
    if (credentials.remote) {
      const backendPath = path.join(profilePaths.etc, 'llm-backend.json');
      let backendConfig: Record<string, unknown> = {};
      if (fs.existsSync(backendPath)) {
        try {
          backendConfig = JSON.parse(fs.readFileSync(backendPath, 'utf-8'));
        } catch {
          // Invalid JSON, start fresh
        }
      }
      backendConfig.remote = credentials.remote;
      fs.writeFileSync(backendPath, JSON.stringify(backendConfig, null, 2));
    }

    return successResponse({
      success: true,
      saved: Object.keys(credentials),
    });
  } catch (error) {
    console.error('[credentials-sync] POST error:', error);
    return {
      status: 500,
      error: (error as Error).message,
    };
  }
}

/**
 * Helper to get RunPod config from user's profile etc/runpod.json
 * Also loads endpoint ID from deployment config or environment
 */
async function getRunPodConfig(username: string): Promise<{
  apiKey: string | null;
  endpointId: string | null;
  templateId: string | null;
  gpuType: string | null;
}> {
  const config = {
    apiKey: null as string | null,
    endpointId: null as string | null,
    templateId: null as string | null,
    gpuType: null as string | null,
  };

  // Read from user's profile etc/runpod.json
  const profilePaths = getProfilePaths(username);
  const configPath = path.join(profilePaths.etc, 'runpod.json');

  if (fs.existsSync(configPath)) {
    try {
      const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      config.apiKey = fileConfig.apiKey || null;
      config.templateId = fileConfig.templateId || null;
      config.gpuType = fileConfig.gpuType || null;
      // Check if endpoint ID is in the file (new format)
      if (fileConfig.endpointId) {
        config.endpointId = fileConfig.endpointId;
      }
    } catch {
      // Invalid JSON, ignore
    }
  }

  // If no endpoint ID in profile, check environment variable
  if (!config.endpointId && process.env.RUNPOD_ENDPOINT_ID) {
    config.endpointId = process.env.RUNPOD_ENDPOINT_ID;
  }

  // If still no endpoint ID, check system deployment config
  if (!config.endpointId) {
    const systemConfigPath = path.join(process.cwd(), 'etc', 'deployment.json');
    if (fs.existsSync(systemConfigPath)) {
      try {
        const deployConfig = JSON.parse(fs.readFileSync(systemConfigPath, 'utf-8'));
        const defaultEndpoint = deployConfig?.server?.runpod?.endpoints?.default;
        // Check if it's not a template variable
        if (defaultEndpoint && !defaultEndpoint.startsWith('${')) {
          config.endpointId = defaultEndpoint;
        }
      } catch {
        // Invalid JSON, ignore
      }
    }
  }

  return config;
}
