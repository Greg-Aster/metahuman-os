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
import { paths } from './paths.js';

/**
 * Load user-specific config file
 *
 * Automatically resolves to the correct user's etc/ directory based on
 * current user context. Falls back to root etc/ if no context is set.
 *
 * @param filename - Config filename (e.g., 'models.json', 'training.json')
 * @param defaultValue - Default value if file doesn't exist
 * @returns Parsed JSON config or default value
 *
 * @example
 * ```typescript
 * // Without context - loads from etc/models.json
 * const config = loadUserConfig('models.json', {});
 *
 * // With context - loads from profiles/alice/etc/models.json
 * await withUserContext({ userId: '123', username: 'alice', role: 'owner' }, () => {
 *   const config = loadUserConfig('models.json', {});
 * });
 * ```
 */
export function loadUserConfig<T = any>(filename: string, defaultValue: T): T {
  const configPath = path.join(paths.etc, filename);

  if (!fs.existsSync(configPath)) {
    return defaultValue;
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (error) {
    console.warn(`[config] Failed to load ${filename}:`, error);
    return defaultValue;
  }
}

/**
 * Save user-specific config file
 *
 * Automatically resolves to the correct user's etc/ directory based on
 * current user context. Falls back to root etc/ if no context is set.
 *
 * Creates the etc/ directory if it doesn't exist.
 *
 * @param filename - Config filename (e.g., 'models.json', 'training.json')
 * @param data - Data to save (will be JSON.stringify'd)
 *
 * @example
 * ```typescript
 * // Without context - saves to etc/models.json
 * saveUserConfig('models.json', { defaultModel: 'phi3:mini' });
 *
 * // With context - saves to profiles/alice/etc/models.json
 * await withUserContext({ userId: '123', username: 'alice', role: 'owner' }, () => {
 *   saveUserConfig('models.json', { defaultModel: 'phi3:mini' });
 * });
 * ```
 */
export function saveUserConfig<T = any>(filename: string, data: T): void {
  const etcDir = paths.etc;
  const configPath = path.join(etcDir, filename);

  // Ensure etc/ directory exists
  if (!fs.existsSync(etcDir)) {
    fs.mkdirSync(etcDir, { recursive: true });
  }

  try {
    const json = JSON.stringify(data, null, 2);
    fs.writeFileSync(configPath, json, 'utf8');
  } catch (error) {
    console.error(`[config] Failed to save ${filename}:`, error);
    throw error;
  }
}

/**
 * Check if user-specific config file exists
 *
 * @param filename - Config filename to check
 * @returns true if file exists
 */
export function userConfigExists(filename: string): boolean {
  const configPath = path.join(paths.etc, filename);
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
    }
  };
}

/**
 * Invalidate operator config cache (for testing)
 */
export function invalidateOperatorConfig(): void {
  operatorConfigCache = null;
}

/**
 * Check if ReAct V2 is enabled
 */
export function isReactV2Enabled(): boolean {
  try {
    const runtime = loadUserConfig<any>('runtime.json', {});
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
 * @returns Array of config filenames
 */
export function listUserConfigs(): string[] {
  const etcDir = paths.etc;

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
