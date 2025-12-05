/**
 * Deployment Mode Configuration
 *
 * Determines whether MetaHuman OS runs in local or server mode.
 * - Local mode: Single-user, local Ollama, filesystem storage
 * - Server mode: Multi-user, cloud GPU (RunPod), network volume storage
 *
 * This module is the single source of truth for deployment configuration.
 * Individual users (local mode) don't need any server infrastructure.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { ROOT } from './path-builder.js';

// ============================================================================
// Types
// ============================================================================

export type DeploymentMode = 'local' | 'server';

export interface LocalConfig {
  /** LLM provider for local mode (default: ollama) */
  llmProvider: 'ollama' | 'mock';
  /** Base storage path (default: repo root) */
  storagePath: string;
  /** Ollama API endpoint */
  ollamaEndpoint: string;
}

export interface RunPodEndpointTier {
  /** Description of this tier */
  description: string;
  /** Max model params for this tier */
  maxParams: string;
  /** Whether LoRA is supported */
  enableLora: boolean;
  /** Path for LoRA storage (if enabled) */
  loraStoragePath?: string;
}

export interface RunPodConfig {
  /** RunPod API key (from env: RUNPOD_API_KEY) */
  apiKey: string;
  /** Endpoint IDs by tier (default, 14b, 30b, embed) */
  endpoints: {
    default: string;
    '14b'?: string;
    '30b'?: string;
    embed?: string;
    [tier: string]: string | undefined;
  };
  /** Endpoint tier configurations */
  endpointTiers?: Record<string, RunPodEndpointTier>;
  /** Optional: Custom base URL (for self-hosted) */
  customEndpoint?: string;
}

export interface RedisConfig {
  /** Redis connection URL */
  url: string;
  /** Key prefix for this deployment */
  keyPrefix?: string;
}

export interface ScalingConfig {
  /** Max concurrent inference requests */
  maxConcurrentInference: number;
  /** Queue timeout in milliseconds */
  queueTimeout: number;
  /** Show cold start warning after this many ms */
  coldStartWarningMs: number;
  /** Keep model warm with periodic pings (ms, 0 = disabled) */
  keepWarmIntervalMs?: number;
}

export interface ServerConfig {
  /** LLM provider for server mode */
  llmProvider: 'runpod_serverless' | 'huggingface' | 'ollama';
  /** Base storage path on network volume */
  storagePath: string;
  /** RunPod configuration (required if llmProvider is runpod_serverless) */
  runpod?: RunPodConfig;
  /** HuggingFace configuration (required if llmProvider is huggingface) */
  huggingface?: {
    apiKey: string;
    endpointUrl: string;
  };
  /** Redis configuration for request queuing */
  redis?: RedisConfig;
  /** Scaling configuration */
  scaling: ScalingConfig;
}

export interface DeploymentConfig {
  /** Current deployment mode */
  mode: DeploymentMode;
  /** Local mode configuration */
  local: LocalConfig;
  /** Server mode configuration */
  server: ServerConfig;
}

// ============================================================================
// Environment Variable Resolution
// ============================================================================

/**
 * Resolve environment variables in a string
 * Supports ${VAR_NAME} syntax
 */
function resolveEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, varName) => {
    return process.env[varName] || '';
  });
}

/**
 * Recursively resolve environment variables in an object
 */
function resolveEnvVarsInObject<T>(obj: T): T {
  if (typeof obj === 'string') {
    return resolveEnvVars(obj) as unknown as T;
  }
  if (Array.isArray(obj)) {
    return obj.map(item => resolveEnvVarsInObject(item)) as unknown as T;
  }
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = resolveEnvVarsInObject(value);
    }
    return result as T;
  }
  return obj;
}

// ============================================================================
// Default Configuration
// ============================================================================

/**
 * Default deployment configuration
 * Local mode is the default - individual users don't need server setup
 */
export function getDefaultDeploymentConfig(): DeploymentConfig {
  return {
    mode: 'local',

    local: {
      llmProvider: 'ollama',
      storagePath: ROOT,
      ollamaEndpoint: 'http://localhost:11434',
    },

    server: {
      llmProvider: 'runpod_serverless',
      storagePath: '/runpod-volume/metahuman',
      runpod: {
        apiKey: '${RUNPOD_API_KEY}',
        endpoints: {
          default: '${RUNPOD_ENDPOINT_ID}',
          '14b': '${RUNPOD_ENDPOINT_14B}',
          '30b': '${RUNPOD_ENDPOINT_30B}',
          embed: '${RUNPOD_ENDPOINT_EMBED}',
        },
      },
      redis: {
        url: '${REDIS_URL}',
        keyPrefix: 'mh:',
      },
      scaling: {
        maxConcurrentInference: 3,
        queueTimeout: 60000,
        coldStartWarningMs: 15000,
        keepWarmIntervalMs: 0, // Disabled by default
      },
    },
  };
}

// ============================================================================
// Configuration Loading
// ============================================================================

let deploymentConfigCache: DeploymentConfig | null = null;

/**
 * Load deployment configuration from etc/deployment.json
 *
 * Falls back to defaults if file doesn't exist.
 * Environment variables are resolved at load time.
 */
export function loadDeploymentConfig(): DeploymentConfig {
  if (deploymentConfigCache) {
    return deploymentConfigCache;
  }

  const configPath = path.join(ROOT, 'etc', 'deployment.json');
  let config = getDefaultDeploymentConfig();

  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(raw);

      // Deep merge with defaults
      config = {
        ...config,
        ...parsed,
        local: { ...config.local, ...parsed.local },
        server: {
          ...config.server,
          ...parsed.server,
          runpod: {
            ...config.server.runpod,
            ...parsed.server?.runpod,
            endpoints: {
              ...config.server.runpod?.endpoints,
              ...parsed.server?.runpod?.endpoints,
            },
            endpointTiers: {
              ...config.server.runpod?.endpointTiers,
              ...parsed.server?.runpod?.endpointTiers,
            },
          },
          redis: { ...config.server.redis, ...parsed.server?.redis },
          scaling: { ...config.server.scaling, ...parsed.server?.scaling },
        },
      };

      console.log(`[deployment] Loaded config from ${configPath}`);
    } else {
      console.log(`[deployment] Using default config (${configPath} not found)`);
    }
  } catch (error) {
    console.warn(`[deployment] Failed to load config, using defaults:`, error);
  }

  // Check for environment variable override
  const envMode = process.env.DEPLOYMENT_MODE as DeploymentMode | undefined;
  if (envMode && (envMode === 'local' || envMode === 'server')) {
    config.mode = envMode;
    console.log(`[deployment] Mode overridden by DEPLOYMENT_MODE env var: ${envMode}`);
  }

  // Check for METAHUMAN_ROOT override
  if (process.env.METAHUMAN_ROOT) {
    if (config.mode === 'local') {
      config.local.storagePath = process.env.METAHUMAN_ROOT;
    } else {
      config.server.storagePath = process.env.METAHUMAN_ROOT;
    }
    console.log(`[deployment] Storage path overridden by METAHUMAN_ROOT: ${process.env.METAHUMAN_ROOT}`);
  }

  // Resolve environment variables in config values
  config = resolveEnvVarsInObject(config);

  deploymentConfigCache = config;
  return config;
}

/**
 * Invalidate configuration cache (for testing or hot reload)
 */
export function invalidateDeploymentConfig(): void {
  deploymentConfigCache = null;
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Get current deployment mode
 */
export function getDeploymentMode(): DeploymentMode {
  return loadDeploymentConfig().mode;
}

/**
 * Check if running in server mode
 */
export function isServerMode(): boolean {
  return getDeploymentMode() === 'server';
}

/**
 * Check if running in local mode
 */
export function isLocalMode(): boolean {
  return getDeploymentMode() === 'local';
}

/**
 * Get the current LLM provider name based on deployment mode
 */
export function getCurrentLLMProvider(): string {
  const config = loadDeploymentConfig();
  return config.mode === 'server'
    ? config.server.llmProvider
    : config.local.llmProvider;
}

/**
 * Get the current storage path based on deployment mode
 */
export function getStoragePath(): string {
  const config = loadDeploymentConfig();
  return config.mode === 'server'
    ? config.server.storagePath
    : config.local.storagePath;
}

/**
 * Get server-specific configuration
 * Returns null if in local mode
 */
export function getServerConfig(): ServerConfig | null {
  const config = loadDeploymentConfig();
  return config.mode === 'server' ? config.server : null;
}

/**
 * Get local-specific configuration
 * Returns null if in server mode
 */
export function getLocalConfig(): LocalConfig | null {
  const config = loadDeploymentConfig();
  return config.mode === 'local' ? config.local : null;
}

/**
 * Check if RunPod is configured and available
 */
export function isRunPodConfigured(): boolean {
  const config = loadDeploymentConfig();
  if (config.mode !== 'server') return false;
  if (config.server.llmProvider !== 'runpod_serverless') return false;

  const runpod = config.server.runpod;
  return !!(runpod?.apiKey && runpod?.endpoints?.default);
}

/**
 * Check if Redis is configured for server mode
 */
export function isRedisConfigured(): boolean {
  const config = loadDeploymentConfig();
  if (config.mode !== 'server') return false;

  return !!config.server.redis?.url;
}

// ============================================================================
// Deployment Info (for UI/debugging)
// ============================================================================

export interface DeploymentInfo {
  mode: DeploymentMode;
  llmProvider: string;
  storagePath: string;
  runpodConfigured: boolean;
  redisConfigured: boolean;
  features: {
    queuing: boolean;
    coldStartHandling: boolean;
    multiUser: boolean;
  };
}

/**
 * Get deployment info for display in UI or debugging
 */
export function getDeploymentInfo(): DeploymentInfo {
  const config = loadDeploymentConfig();
  const isServer = config.mode === 'server';

  return {
    mode: config.mode,
    llmProvider: isServer ? config.server.llmProvider : config.local.llmProvider,
    storagePath: isServer ? config.server.storagePath : config.local.storagePath,
    runpodConfigured: isRunPodConfigured(),
    redisConfigured: isRedisConfigured(),
    features: {
      queuing: isServer && isRedisConfigured(),
      coldStartHandling: isServer,
      multiUser: isServer,
    },
  };
}
