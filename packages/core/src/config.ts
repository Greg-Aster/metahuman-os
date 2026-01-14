/**
 * User-Specific Configuration Loading
 *
 * Helper functions for loading and saving configuration files that are
 * user-specific (stored in profiles/{username}/etc/).
 *
 * These functions automatically use the current user context to resolve
 * the correct config file path.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  IMPORTANT: NO SILENT DEFAULTS POLICY                                     ║
 * ╠═══════════════════════════════════════════════════════════════════════════╣
 * ║  This system NEVER uses default values silently.                          ║
 * ║                                                                           ║
 * ║  If a config file is missing from a user's profile:                       ║
 * ║  1. Copy from system template (etc/<file>.template or etc/<file>)         ║
 * ║  2. OR generate default and SAVE to user's profile                        ║
 * ║  3. THEN load from user's profile                                         ║
 * ║                                                                           ║
 * ║  The getDefault*() functions are ONLY for generating initial templates.   ║
 * ║  They should NEVER be returned directly to callers.                       ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { storageClient } from './storage-client.js';
import { safeReadJSON, safeWriteJSON, listBackups, restoreFromBackup, recoverCorruptedFiles, isValidJSON } from './safe-file.js';

// Get project root for fallback paths
const ROOT = process.cwd().includes('/apps/site')
  ? path.resolve(process.cwd(), '../..')
  : process.cwd();

/**
 * Helper to resolve etc directory path via storage router
 *
 * ALL configs are user-specific. No fallback to system etc/.
 * Throws error if username cannot be resolved.
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

  // No fallback to system etc/ - all configs are user-specific
  throw new Error(`Cannot resolve config path: ${result.error || 'No authenticated user context'}`);
}

/**
 * Get the system-level etc/ directory path (for templates)
 */
function getSystemEtcPath(): string {
  return path.join(ROOT, 'etc');
}

/**
 * Ensure a user config file exists by copying from system template if missing.
 *
 * This function implements the NO SILENT DEFAULTS policy:
 * - If user config exists: do nothing
 * - If user config missing: copy from system etc/ (template) OR generate default
 * - Always ensures user has their own copy
 *
 * @param filename - Config filename (e.g., 'runtime.json')
 * @param defaultGenerator - Function to generate default config if no template exists
 * @param username - Optional username for user-specific config
 * @returns true if config was created, false if already existed
 */
function ensureUserConfig<T>(filename: string, defaultGenerator: () => T, username?: string): boolean {
  const userEtcPath = resolveEtcPath(username);
  const userConfigPath = path.join(userEtcPath, filename);

  // If user already has the config, nothing to do
  if (fs.existsSync(userConfigPath)) {
    return false;
  }

  // Ensure user's etc/ directory exists
  if (!fs.existsSync(userEtcPath)) {
    fs.mkdirSync(userEtcPath, { recursive: true });
  }

  // Try to copy from system template first (check both .template and regular name)
  const systemEtcPath = getSystemEtcPath();
  const templatePath = path.join(systemEtcPath, `${filename}.template`);
  const systemConfigPath = path.join(systemEtcPath, filename);

  if (fs.existsSync(templatePath)) {
    // Copy from .template file
    fs.copyFileSync(templatePath, userConfigPath);
    console.log(`[config] ✓ Created ${filename} from template for user profile`);
    return true;
  } else if (fs.existsSync(systemConfigPath)) {
    // Copy from system config (using it as template)
    fs.copyFileSync(systemConfigPath, userConfigPath);
    console.log(`[config] ✓ Created ${filename} from system config for user profile`);
    return true;
  } else {
    // No template exists - generate default and save to user profile
    // Use safeWriteJSON which creates automatic backups
    const defaultConfig = defaultGenerator();
    safeWriteJSON(userConfigPath, defaultConfig);
    console.log(`[config] ✓ Generated default ${filename} for user profile`);
    return true;
  }
}

/**
 * Load user-specific config file
 *
 * Automatically resolves to the correct user's etc/ directory based on
 * username or falls back to system etc/.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  NO SILENT DEFAULTS: If config is missing, it will be created from        ║
 * ║  template or generated default BEFORE loading. The defaultValue param     ║
 * ║  is used as a generator fallback, NOT returned directly.                  ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * @param filename - Config filename (e.g., 'models.json', 'training.json')
 * @param defaultValue - Default value used to GENERATE config if template missing (NOT returned directly)
 * @param username - Optional username to load config for (falls back to system if not provided)
 * @returns Parsed JSON config from user's profile
 *
 * @example
 * ```typescript
 * // Without username - loads from system etc/models.json
 * const config = loadUserConfig('models.json', {});
 *
 * // With username - loads from profiles/alice/etc/models.json
 * // If missing, copies from etc/models.json or generates default
 * const config = loadUserConfig('models.json', {}, 'alice');
 * ```
 */
export function loadUserConfig<T = any>(filename: string, defaultValue: T, username?: string): T {
  const etcPath = resolveEtcPath(username);
  const configPath = path.join(etcPath, filename);

  // Ensure config exists (copies from template or generates if missing)
  // This implements the NO SILENT DEFAULTS policy
  ensureUserConfig(filename, () => defaultValue, username);

  // Now load from user's profile (which is guaranteed to exist)
  // Use safeReadJSON which will auto-recover from corrupted files using backups
  try {
    return safeReadJSON<T>(configPath, defaultValue);
  } catch (error) {
    // This should rarely happen now, but handle gracefully
    console.error(`[config] ✗ CRITICAL: Failed to load ${filename} after ensuring it exists:`, error);
    console.error(`[config] ✗ This indicates a serious configuration issue. Check file permissions.`);
    // Last resort: return the default (but this is now an error condition)
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
    // Use safeWriteJSON which creates automatic backups before writing
    safeWriteJSON(configPath, data);
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
    provider: 'claude-code' | 'open-interpreter' | 'aider' | 'gemini-cli' | 'qwen-code' | 'codex' | 'ollama' | 'openai';
    model?: 'opus' | 'sonnet' | 'haiku' | string; // Claude model to use (default: sonnet for faster responses)
    delegateAll?: boolean; // When true, delegate ALL tasks to Claude CLI instead of local skills
    escalateOnStuck: boolean;
    escalateOnRepeatedFailures: boolean;
    maxRetries: number;
    includeFullScratchpad: boolean;
    autoApplySuggestions: boolean;
    executionTimeout?: number; // Timeout in ms for desire execution (default: 600000 = 10 min)
  };
  humanInTheLoop?: {
    enabled: boolean;
    requireApproval: boolean;
    proposalExpiry: number; // ms before proposal expires
    showPostExecutionFeedback: boolean;
    feedbackBackend: {
      provider: 'memory' | 'big-brother' | 'runpod' | 'system-coder';
      availableProviders: string[];
      escalateRejections: boolean;
      escalateNegativeFeedback: boolean;
      escalationThreshold: number; // number of negative feedbacks before escalation
    };
    approvalByTrustLevel: Record<string, 'block' | 'require' | 'low_risk_auto' | 'medium_risk_auto' | 'auto_with_feedback'>;
  };
}

// Per-user cache for operator config
const operatorConfigCache = new Map<string, OperatorConfig>();

/**
 * Load operator configuration for a user
 *
 * @param username - REQUIRED: Username to load config for. All configs are user-specific.
 * @param skipCache - If true, bypass cache and reload from disk
 */
export function loadOperatorConfig(username: string, skipCache = false): OperatorConfig {
  if (!skipCache) {
    const cached = operatorConfigCache.get(username);
    if (cached) return cached;
  }

  const config = loadUserConfig<OperatorConfig>('operator.json', getDefaultOperatorConfig(), username);
  operatorConfigCache.set(username, config);
  return config;
}

/**
 * Load operator config with guaranteed fresh state (always skips cache).
 *
 * Use this for any code that makes routing/behavior decisions where stale
 * config could cause incorrect behavior (e.g., Big Brother enabled/disabled).
 *
 * Examples of when to use this:
 * - LLM routing decisions (bridge.ts)
 * - Big Brother mode checks
 * - Feature flag checks that affect behavior
 * - Any config read that occurs during user-initiated actions
 *
 * @param username - Username to load config for
 * @returns Fresh OperatorConfig (never from cache)
 */
export function loadFreshOperatorConfig(username: string): OperatorConfig {
  return loadOperatorConfig(username, true);
}

/**
 * Invalidate operator config cache for a user (or all users)
 * Call this after config file changes to ensure fresh config is loaded
 */
export function invalidateOperatorConfigCache(username?: string): void {
  if (username) {
    operatorConfigCache.delete(username);
    console.log(`[config] Cache invalidated for user: ${username}`);
  } else {
    operatorConfigCache.clear();
    console.log(`[config] All operator config caches cleared`);
  }
}

/**
 * Get default operator configuration
 *
 * ⚠️  WARNING: TEMPLATE GENERATOR ONLY ⚠️
 * This function is ONLY for generating initial templates.
 * Do NOT return this directly to callers - always save to user profile first.
 * See ensureUserConfig() for proper usage.
 *
 * @internal Use loadOperatorConfig() instead for runtime config access
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
      delegateAll: false,
      escalateOnStuck: true,
      escalateOnRepeatedFailures: true,
      maxRetries: 1,
      includeFullScratchpad: true,
      autoApplySuggestions: false,
      executionTimeout: 600000 // 10 minutes
    }
  };
}

/**
 * Invalidate operator config cache (for testing)
 */
export function invalidateOperatorConfig(username?: string): void {
  if (username) {
    operatorConfigCache.delete(username);
  } else {
    operatorConfigCache.clear();
  }
}

// ============================================================================
// Runtime Configuration
// ============================================================================

export interface RuntimeConfig {
  cognitive?: {
    useNodePipeline?: boolean;
  };
  [key: string]: any;
}

/**
 * Load runtime configuration for a user
 *
 * @param username - REQUIRED: Username to load config for. All configs are user-specific.
 */
export function loadRuntimeConfig(username: string): RuntimeConfig {
  return loadUserConfig<RuntimeConfig>('runtime.json', {}, username);
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

/**
 * Load curiosity configuration for a user
 *
 * @param username - REQUIRED: Username to load config for. All configs are user-specific.
 */
export function loadCuriosityConfig(username: string): CuriosityConfig {
  const cached = curiosityConfigCache.get(username);
  if (cached) return cached;

  const config = loadUserConfig<CuriosityConfig>('curiosity.json', getDefaultCuriosityConfig(), username);
  curiosityConfigCache.set(username, config);
  return config;
}

/**
 * Save curiosity configuration for a user
 *
 * @param config - Configuration to save
 * @param username - REQUIRED: Username to save config for. All configs are user-specific.
 */
export function saveCuriosityConfig(config: CuriosityConfig, username: string): void {
  saveUserConfig('curiosity.json', config, username);
  curiosityConfigCache.set(username, config);
}

/**
 * Get default curiosity configuration
 *
 * ⚠️  WARNING: TEMPLATE GENERATOR ONLY ⚠️
 * This function is ONLY for generating initial templates.
 * Do NOT return this directly to callers - always save to user profile first.
 * See ensureUserConfig() for proper usage.
 *
 * @internal Use loadCuriosityConfig() instead for runtime config access
 */
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
export function invalidateCuriosityConfig(username?: string): void {
  if (username) {
    curiosityConfigCache.delete(username);
  } else {
    curiosityConfigCache.clear();
  }
}

// ============================================================================
// Config Recovery Utilities
// ============================================================================

export { listBackups, restoreFromBackup, recoverCorruptedFiles, isValidJSON };

/**
 * Recover corrupted config files for a user from their backups
 *
 * This function scans the user's etc/ directory and attempts to recover
 * any corrupted JSON config files from their automatic backups.
 *
 * @param username - Username whose configs to recover
 * @returns Object with arrays of recovered and failed file paths
 */
export function recoverUserConfigs(username: string): { recovered: string[]; failed: string[] } {
  const etcPath = resolveEtcPath(username);
  console.log(`[config] Scanning ${etcPath} for corrupted configs...`);
  return recoverCorruptedFiles(etcPath);
}

/**
 * List available backups for a specific config file
 *
 * @param filename - Config filename (e.g., 'operator.json')
 * @param username - Username whose config to check
 * @returns Array of backup info objects
 */
export function listConfigBackups(filename: string, username: string): Array<{ path: string; timestamp: Date; size: number }> {
  const configPath = path.join(resolveEtcPath(username), filename);
  return listBackups(configPath);
}

/**
 * Restore a specific config file from its most recent backup
 *
 * @param filename - Config filename (e.g., 'operator.json')
 * @param username - Username whose config to restore
 * @returns true if restored successfully
 */
export function restoreConfigFromBackup(filename: string, username: string): boolean {
  const configPath = path.join(resolveEtcPath(username), filename);

  // Invalidate caches for this config
  if (filename === 'operator.json') {
    operatorConfigCache.delete(username);
  } else if (filename === 'curiosity.json') {
    curiosityConfigCache.delete(username);
  }

  return restoreFromBackup(configPath);
}
