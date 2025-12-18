/**
 * Tool Executor Migration & Compatibility
 *
 * Helpers for migrating from Big Brother to the new Tool Executor system.
 *
 * The Big Brother system is DEPRECATED and will be removed in a future version.
 * Use the Tool Executor system instead.
 *
 * Migration path:
 * 1. etc/operator.json bigBrotherMode -> etc/tool-executor.json activeBackend
 * 2. Big Brother provider -> Tool Executor backend
 *
 * Provider to Backend mapping:
 * - claude-code -> claude-code
 * - aider -> aider
 * - gemini -> gemini-cli
 * - codex -> claude-code (no direct equivalent, use Claude)
 * - ollama-cli -> local-skills
 * - custom -> open-interpreter
 */

import * as fs from 'fs';
import * as path from 'path';
import { systemPaths, getProfilePaths } from './paths.js';
import { loadToolExecutorConfig, saveToolExecutorConfig } from './tool-executor-config.js';
import { audit } from './audit.js';

// ============================================================================
// Migration Detection
// ============================================================================

/**
 * Check if the user is still using Big Brother mode
 */
export function isUsingLegacyBigBrother(username?: string): boolean {
  try {
    const operatorPath = path.join(systemPaths.etc, 'operator.json');
    if (!fs.existsSync(operatorPath)) {
      return false;
    }

    const operatorConfig = JSON.parse(fs.readFileSync(operatorPath, 'utf-8'));
    return !!operatorConfig.bigBrotherMode?.enabled;
  } catch {
    return false;
  }
}

/**
 * Check if migration is needed (Big Brother enabled but Tool Executor not configured)
 */
export function shouldMigrate(username?: string): boolean {
  // Check if using legacy Big Brother
  if (!isUsingLegacyBigBrother(username)) {
    return false;
  }

  // Check if Tool Executor is already configured
  const profilePaths = username ? getProfilePaths(username) : null;
  const toolExecutorPath = profilePaths
    ? path.join(profilePaths.etc, 'tool-executor.json')
    : path.join(systemPaths.etc, 'tool-executor.json');

  // If tool-executor.json exists and has non-default config, no migration needed
  if (fs.existsSync(toolExecutorPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(toolExecutorPath, 'utf-8'));
      // If user has already switched away from local-skills, they've configured it
      if (config.activeBackend && config.activeBackend !== 'local-skills') {
        return false;
      }
    } catch {
      // Invalid config, might need migration
    }
  }

  return true;
}

// ============================================================================
// Migration
// ============================================================================

/**
 * Provider to backend mapping
 */
const PROVIDER_TO_BACKEND: Record<string, string> = {
  'claude-code': 'claude-code',
  'aider': 'aider',
  'gemini': 'gemini-cli',
  'codex': 'claude-code',
  'ollama-cli': 'local-skills',
  'custom': 'open-interpreter',
};

/**
 * Migrate from Big Brother mode to Tool Executor
 */
export function migrateFromBigBrotherMode(username?: string): {
  success: boolean;
  migratedBackend?: string;
  error?: string;
} {
  try {
    // Load Big Brother config
    const operatorPath = path.join(systemPaths.etc, 'operator.json');
    if (!fs.existsSync(operatorPath)) {
      return { success: false, error: 'operator.json not found' };
    }

    const operatorConfig = JSON.parse(fs.readFileSync(operatorPath, 'utf-8'));
    const bigBrotherConfig = operatorConfig.bigBrotherMode;

    if (!bigBrotherConfig?.enabled) {
      return { success: true, migratedBackend: 'local-skills' };
    }

    // Map Big Brother provider to Tool Executor backend
    const provider = bigBrotherConfig.provider || 'claude-code';
    const backend = PROVIDER_TO_BACKEND[provider] || 'open-interpreter';

    // Load or create Tool Executor config
    const toolConfig = loadToolExecutorConfig(username);

    // Set the active backend
    toolConfig.activeBackend = backend;

    // Enable the backend if not already enabled
    if (toolConfig.backends[backend]) {
      toolConfig.backends[backend].enabled = true;
    }

    // Migrate escalation settings to routing rules
    if (bigBrotherConfig.escalateOnStuck || bigBrotherConfig.escalateOnRepeatedFailures) {
      toolConfig.routing.escalationRules = [
        {
          trigger: 'repeated_failures',
          threshold: bigBrotherConfig.maxRetries || 2,
          escalateTo: backend === 'local-skills' ? 'open-interpreter' : backend,
          enabled: true,
        },
      ];
    }

    // Save the migrated config
    saveToolExecutorConfig(toolConfig, username);

    // Mark Big Brother as deprecated in operator.json
    operatorConfig.bigBrotherMode = {
      ...bigBrotherConfig,
      _deprecated: true,
      _migratedTo: 'tool-executor.json',
      _migrationDate: new Date().toISOString(),
    };

    fs.writeFileSync(operatorPath, JSON.stringify(operatorConfig, null, 2));

    audit({
      level: 'info',
      category: 'system',
      event: 'big_brother_migrated',
      details: {
        fromProvider: provider,
        toBackend: backend,
      },
      actor: username || 'system',
    });

    return {
      success: true,
      migratedBackend: backend,
    };
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message,
    };
  }
}

// ============================================================================
// Compatibility Layer
// ============================================================================

/**
 * For backward compatibility: get the effective "Big Brother mode" status
 *
 * This returns true if either:
 * 1. Legacy Big Brother is enabled in operator.json
 * 2. Tool Executor is using a CLI backend (not local-skills)
 */
export function isBigBrotherEffectivelyEnabled(username?: string): boolean {
  // Check new Tool Executor config
  const toolConfig = loadToolExecutorConfig(username);
  if (toolConfig.activeBackend !== 'local-skills') {
    return true;
  }

  // Check legacy Big Brother
  return isUsingLegacyBigBrother(username);
}

/**
 * Get the effective provider/backend for compatibility
 */
export function getEffectiveProvider(username?: string): string {
  // Prefer new Tool Executor config
  const toolConfig = loadToolExecutorConfig(username);
  if (toolConfig.activeBackend !== 'local-skills') {
    return toolConfig.activeBackend;
  }

  // Fall back to legacy Big Brother
  try {
    const operatorPath = path.join(systemPaths.etc, 'operator.json');
    if (fs.existsSync(operatorPath)) {
      const operatorConfig = JSON.parse(fs.readFileSync(operatorPath, 'utf-8'));
      if (operatorConfig.bigBrotherMode?.enabled) {
        return operatorConfig.bigBrotherMode.provider || 'claude-code';
      }
    }
  } catch {
    // Ignore errors
  }

  return 'local-skills';
}

// ============================================================================
// Export package index updates
// ============================================================================

/**
 * Export all Tool Executor related modules
 *
 * Add this to packages/core/src/index.ts:
 *
 * // Tool Executor (replaces Big Brother)
 * export * from './tool-executor-config.js';
 * export * from './tool-executor-backends.js';
 * export * from './tool-executor-compat.js';
 * export * from './open-interpreter.js';
 * export * from './legacy-cli-adapters.js';
 */
