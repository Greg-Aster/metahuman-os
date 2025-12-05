/**
 * User-Specific Configuration Loading
 *
 * Helper functions for loading and saving configuration files that are
 * user-specific (stored in profiles/{username}/etc/).
 *
 * These functions automatically use the current user context to resolve
 * the correct config file path.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { storageClient } from './storage-client.js';

// Get project root for fallback paths
const ROOT = process.cwd().includes('/apps/site')
  ? path.resolve(process.cwd(), '../..')
  : process.cwd();

/**
 * Helper to resolve etc directory path via storage router
 * Falls back to system etc/ if user context unavailable
 */
function resolveEtcPath(username?: string): string {
  const result = storageClient.resolvePath({
    username,
    category: 'config',
    subcategory: 'etc',
  });

  if (result.success && result.path) {
    return result.path;
  }

  // Fall back to system etc/ for anonymous users or when storage router fails
  const systemEtcPath = path.join(ROOT, 'etc');
  return systemEtcPath;
}

/**
 * Load user-specific config file
 *
 * Automatically resolves to the correct user's etc/ directory based on
 * username or falls back to system etc/.
 *
 * @param filename - Config filename (e.g., 'models.json', 'training.json')
 * @param defaultValue - Default value if file doesn't exist
 * @param username - Optional username to load config for (falls back to system if not provided)
 * @returns Parsed JSON config or default value
 *
 * @example
 * ```typescript
 * // Without username - loads from system etc/models.json
 * const config = loadUserConfig('models.json', {});
 *
 * // With username - loads from profiles/alice/etc/models.json
 * const config = loadUserConfig('models.json', {}, 'alice');
 * ```
 */
export function loadUserConfig<T = any>(filename: string, defaultValue: T, username?: string): T {
  const etcPath = resolveEtcPath(username);
  const configPath = path.join(etcPath, filename);

  if (!fs.existsSync(configPath)) {
    console.log(`[config] Config file not found: ${configPath} - using default value`);
    return defaultValue;
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    console.log(`[config] ✓ Loaded config from: ${configPath}`);
    return JSON.parse(raw) as T;
  } catch (error) {
    console.warn(`[config] Failed to load ${filename}:`, error);
    return defaultValue;
  }
}

/**
 * Save user-specific config file
 *
 * Saves to the user's etc/ directory if username provided,
 * otherwise saves to system etc/.
 *
 * Creates the etc/ directory if it doesn't exist.
 *
 * @param filename - Config filename (e.g., 'models.json', 'training.json')
 * @param data - Data to save (will be JSON.stringify'd)
 * @param username - Optional username to save config for (falls back to system if not provided)
 *
 * @example
 * ```typescript
 * // Without username - saves to system etc/models.json
 * saveUserConfig('models.json', { defaultModel: 'phi3:mini' });
 *
 * // With username - saves to profiles/alice/etc/models.json
 * saveUserConfig('models.json', { defaultModel: 'phi3:mini' }, 'alice');
 * ```
 */
export function saveUserConfig<T = any>(filename: string, data: T, username?: string): void {
  const etcDir = resolveEtcPath(username);
  const configPath = path.join(etcDir, filename);

  // Ensure etc/ directory exists
  if (!fs.existsSync(etcDir)) {
    fs.mkdirSync(etcDir, { recursive: true });
  }

  try {
    const json = JSON.stringify(data, null, 2);
    fs.writeFileSync(configPath, json, 'utf8');
    console.log(`[config] ✓ Saved config to: ${configPath}`);
  } catch (error) {
    console.error(`[config] Failed to save ${filename}:`, error);
    throw error;
  }
}

/**
 * Check if user-specific config file exists
 *
 * @param filename - Config filename to check
 * @param username - Optional username to check config for
 * @returns true if file exists
 */
export function userConfigExists(filename: string, username?: string): boolean {
  const configPath = path.join(resolveEtcPath(username), filename);
  return fs.existsSync(configPath);
}

// ============================================================================
// Operator Configuration (Phase 6)
// ============================================================================

export interface OperatorConfig {
  version: string;
  scratchpad: {
    maxSteps: number;
    trimToLastN: number;
    enableVerbatimMode: boolean;
    enableErrorRetry: boolean;
  };
  models: {
    useSingleModel: boolean;
    planningModel: string;
    responseModel: string;
  };
  logging: {
    enableScratchpadDump: boolean;
    logDirectory: string;
    verboseErrors: boolean;
  };
  performance: {
    cacheCatalog: boolean;
    catalogTTL: number;
    parallelSkillExecution: boolean;
  };
  bigBrotherMode?: {
    enabled: boolean;
    provider: 'claude-code' | 'ollama' | 'openai';
    delegateAll?: boolean; // When true, delegate ALL tasks to Claude CLI instead of local skills
    escalateOnStuck: boolean;
    escalateOnRepeatedFailures: boolean;
    maxRetries: number;
    includeFullScratchpad: boolean;
    autoApplySuggestions: boolean;
  };
}

let operatorConfigCache: OperatorConfig | null = null;

/**
 * Load operator configuration from etc/operator.json
 */
export function loadOperatorConfig(): OperatorConfig {
  if (operatorConfigCache) return operatorConfigCache;

  const config = loadUserConfig<OperatorConfig>('operator.json', getDefaultOperatorConfig());
  operatorConfigCache = config;
  return config;
}

/**
 * Get default operator configuration
 */
export function getDefaultOperatorConfig(): OperatorConfig {
  return {
    version: '2.0',
    scratchpad: {
      maxSteps: 10,
      trimToLastN: 10,
      enableVerbatimMode: true,
      enableErrorRetry: true
    },
    models: {
      useSingleModel: false,
      planningModel: 'default.coder',
      responseModel: 'persona'
    },
    logging: {
      enableScratchpadDump: false,
      logDirectory: 'logs/run/agents',
      verboseErrors: true
    },
    performance: {
      cacheCatalog: true,
      catalogTTL: 60000,
      parallelSkillExecution: false
    },
    bigBrotherMode: {
      enabled: false,
      provider: 'claude-code',
      escalateOnStuck: true,
      escalateOnRepeatedFailures: true,
      maxRetries: 1,
      includeFullScratchpad: true,
      autoApplySuggestions: false
    }
  };
}

/**
 * Invalidate operator config cache (for testing)
 */
export function invalidateOperatorConfig(): void {
  operatorConfigCache = null;
}

// ============================================================================
// Runtime Configuration
// ============================================================================

export interface RuntimeConfig {
  operator?: {
    reactV2?: boolean;
    useReasoningService?: boolean;
    useContextPackage?: boolean;
  };
  [key: string]: any;
}

/**
 * Load runtime configuration from etc/runtime.json
 */
export function loadRuntimeConfig(): RuntimeConfig {
  return loadUserConfig<RuntimeConfig>('runtime.json', {});
}

/**
 * Check if ReAct V2 is enabled
 */
export function isReactV2Enabled(): boolean {
  try {
    const runtime = loadRuntimeConfig();
    return runtime.operator?.reactV2 === true;
  } catch {
    return false; // Default to v1 if config missing
  }
}

/**
 * Check if Reasoning Service should be used instead of inline V2
 */
export function useReasoningService(): boolean {
  try {
    const runtime = loadUserConfig<any>('runtime.json', {});
    return runtime.operator?.useReasoningService === true;
  } catch {
    return false; // Default to inline V2 if config missing
  }
}

/**
 * List all config files in user's etc/ directory
 *
 * @param username - Optional username to list configs for
 * @returns Array of config filenames
 */
export function listUserConfigs(username?: string): string[] {
  const etcDir = resolveEtcPath(username);

  if (!fs.existsSync(etcDir)) {
    return [];
  }

  try {
    return fs.readdirSync(etcDir).filter((file) => file.endsWith('.json'));
  } catch (error) {
    console.warn(`[config] Failed to list configs:`, error);
    return [];
  }
}

// ============================================================================
// Curiosity Configuration
// ============================================================================

export interface CuriosityConfig {
  maxOpenQuestions: number;          // 0 = off, 1 = gentle, 3 = chatty
  researchMode: 'off' | 'local' | 'web';
  inactivityThresholdSeconds: number; // How long to wait before asking
  questionTopics: string[];           // Filter topics (empty = all)
  minTrustLevel: string;              // Minimum trust to ask questions
}

const curiosityConfigCache = new Map<string, CuriosityConfig>();

function getCuriosityCacheKey(username?: string): string {
  // Cache per-user by etc path so multi-user contexts stay isolated
  return path.join(resolveEtcPath(username), 'curiosity.json');
}

export function loadCuriosityConfig(username?: string): CuriosityConfig {
  const cacheKey = getCuriosityCacheKey(username);
  const cached = curiosityConfigCache.get(cacheKey);
  if (cached) return cached;

  const config = loadUserConfig<CuriosityConfig>('curiosity.json', getDefaultCuriosityConfig(), username);
  curiosityConfigCache.set(cacheKey, config);
  return config;
}

export function saveCuriosityConfig(config: CuriosityConfig, username?: string): void {
  saveUserConfig('curiosity.json', config, username);
  curiosityConfigCache.set(getCuriosityCacheKey(username), config);
}

export function getDefaultCuriosityConfig(): CuriosityConfig {
  return {
    maxOpenQuestions: 1,
    researchMode: 'local',
    inactivityThresholdSeconds: 1800, // 30 minutes
    questionTopics: [],
    minTrustLevel: 'observe'
  };
}

/**
 * Invalidate curiosity config cache (for testing)
 */
export function invalidateCuriosityConfig(targetPath?: string): void {
  if (targetPath) {
    curiosityConfigCache.delete(targetPath);
    return;
  }
  curiosityConfigCache.clear();
}
